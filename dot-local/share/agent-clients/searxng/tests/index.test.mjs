import assert from "node:assert/strict";
import test from "node:test";

import {SearXNGClient, SearXNGError, normalizeServerUrl} from "../index.js";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {"Content-Type": "application/json"},
  });
}

test("normalizes an explicit server URL and rejects invalid URLs", () => {
  assert.equal(normalizeServerUrl("http://searxng.localhost/"), "http://searxng.localhost");
  assert.equal(normalizeServerUrl("https://search.example/searx/"), "https://search.example/searx");
  assert.throws(() => normalizeServerUrl(""), SearXNGError);
  assert.throws(() => normalizeServerUrl("ftp://search.example"), SearXNGError);
});

test("requests JSON search results and discards malformed entries", async () => {
  let request;
  const client = new SearXNGClient({
    serverUrl: "http://searxng.localhost",
    fetch: async (url, init) => {
      request = {url: String(url), init};
      return json({results: [
        {url: "https://opencode.ai", title: "OpenCode", content: "An AI coding agent"},
        {title: "Missing URL"},
      ]});
    },
  });

  assert.deepEqual(await client.search("opencode"), [{
    url: "https://opencode.ai",
    title: "OpenCode",
    content: "An AI coding agent",
  }]);
  assert.equal(request.url, "http://searxng.localhost/search?q=opencode&format=json");
  assert.equal(request.init.headers.Accept, "application/json");
});

test("reports unavailable servers and SearXNG error statuses", async () => {
  const unavailable = new SearXNGClient({
    serverUrl: "http://searxng.localhost",
    fetch: async () => { throw new TypeError("fetch failed"); },
  });
  await assert.rejects(
    () => unavailable.search("opencode"),
    /SearXNG: server not available at http:\/\/searxng\.localhost/,
  );

  const limited = new SearXNGClient({
    serverUrl: "http://searxng.localhost",
    fetch: async () => new Response("Too Many Requests", {status: 429, statusText: "Too Many Requests"}),
  });
  await assert.rejects(
    () => limited.search("opencode"),
    (error) => error instanceof SearXNGError
      && error.status === 429
      && error.message === "SearXNG search failed (429): Too Many Requests",
  );
});

test("rejects missing queries and invalid JSON responses", async () => {
  const client = new SearXNGClient({
    serverUrl: "http://searxng.localhost",
    fetch: async () => new Response("not json", {status: 200}),
  });
  await assert.rejects(() => client.search("query"), /invalid JSON search response/);
  await assert.rejects(() => client.search("  "), /search query is required/);
});
