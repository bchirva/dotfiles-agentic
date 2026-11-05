import assert from "node:assert/strict";
import test from "node:test";

import {
  LlamaCppClient,
  LlamaCppError,
  normalizeServerUrl,
} from "../index.js";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("normalizes an explicit server URL and rejects missing URLs", () => {
  assert.equal(
    normalizeServerUrl("http://127.0.0.1:8080/v1/"),
    "http://127.0.0.1:8080",
  );
  assert.throws(() => normalizeServerUrl(""), LlamaCppError);
  assert.throws(() => normalizeServerUrl("ftp://localhost"), LlamaCppError);
});

test("reports an unavailable server without exposing the fetch error", async () => {
  const client = new LlamaCppClient({
    serverUrl: "http://127.0.0.1:12741",
    fetch: async () => {
      throw new TypeError("fetch failed");
    },
  });

  await assert.rejects(
    () => client.listModels(),
    (error) => error instanceof LlamaCppError
      && error.message === "llama.cpp: server not available at http://127.0.0.1:12741",
  );
});

test("reads a loaded single-server model context from meta.n_ctx", async () => {
  const client = new LlamaCppClient({
    serverUrl: "http://server",
    fetch: async (url) => {
      const path = String(url);
      if (path.endsWith("/props?autoload=false")) return json({});
      if (path.includes("/props?model=")) return json({});
      if (path.endsWith("/v1/models")) {
        return json({ object: "list", data: [{ id: "qwen", meta: { n_ctx: 32768 } }] });
      }
      throw new Error(`Unexpected request: ${path}`);
    },
  });

  const info = await client.ensureModelReady("qwen");
  assert.equal(info.mode, "single");
  assert.equal(info.contextWindow, 32768);
});

test("uses router arguments before loading and actual meta.n_ctx afterwards", async () => {
  let loaded = false;
  const requests = [];
  const client = new LlamaCppClient({
    serverUrl: "http://server",
    pollingIntervalMs: 1,
    fetch: async (url, init = {}) => {
      const path = String(url);
      requests.push({ path, method: init.method ?? "GET", body: init.body });
      if (path.endsWith("/props?autoload=false")) return json({ role: "router" });
      if (path.includes("/props?model=")) {
        return loaded
          ? json({})
          : json({ error: { code: 400, message: "model is not loaded" } });
      }
      if (path.endsWith("/v1/models")) {
        return json({
          object: "list",
          data: [{
            id: "qwen",
            status: { args: ["--ctx-size", "8192"] },
            ...(loaded ? { meta: { n_ctx: 16384 } } : {}),
          }],
        });
      }
      if (path.endsWith("/models/load")) {
        loaded = true;
        return json({});
      }
      throw new Error(`Unexpected request: ${path}`);
    },
  });

  const beforeLoad = await client.getModelInfo("qwen");
  assert.equal(beforeLoad.contextWindow, 8192);

  const ready = await client.ensureModelReady("qwen");
  assert.equal(ready.contextWindow, 16384);
  assert.deepEqual(
    requests.find((request) => request.path.endsWith("/models/load")),
    { path: "http://server/models/load", method: "POST", body: '{"model":"qwen"}' },
  );
});

test("loads and unloads models through the router endpoints", async () => {
  const calls = [];
  const client = new LlamaCppClient({
    serverUrl: "http://server",
    fetch: async (url, init = {}) => {
      calls.push({ url: String(url), method: init.method, body: init.body });
      return json({});
    },
  });

  await client.loadModel("model/a");
  await client.unloadModel("model/a");
  assert.deepEqual(calls, [
    { url: "http://server/models/load", method: "POST", body: '{"model":"model/a"}' },
    { url: "http://server/models/unload", method: "POST", body: '{"model":"model/a"}' },
  ]);
});

test("refuses a ready model when llama.cpp does not report its actual context", async () => {
  const client = new LlamaCppClient({
    serverUrl: "http://server",
    fetch: async (url) => {
      const path = String(url);
      if (path.endsWith("/props?autoload=false") || path.includes("/props?model=")) return json({});
      if (path.endsWith("/v1/models")) return json({ object: "list", data: [{ id: "qwen" }] });
      throw new Error(`Unexpected request: ${path}`);
    },
  });

  await assert.rejects(() => client.ensureModelReady("qwen"), /did not report meta\.n_ctx/);
});
