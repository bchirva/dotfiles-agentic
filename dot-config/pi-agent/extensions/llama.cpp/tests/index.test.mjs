import assert from "node:assert/strict";
import test from "node:test";

import llamaCppExtension, {
  isServerUnavailable,
  readSettings,
  toProviderModel,
} from "../index.js";

test("reads llamaCpp.serverUrl from Pi's effective settings", () => {
  assert.deepEqual(
    readSettings({getSettings: () => ({llamaCpp: {serverUrl: "http://127.0.0.1:12741"}})}),
    {serverUrl: "http://127.0.0.1:12741"},
  );
  assert.throws(
    () => readSettings({getSettings: () => ({})}),
    /llamaCpp\.serverUrl/,
  );
});

test("uses the discovered context without a numeric fallback", () => {
  const model = {id: "qwen", aliases: ["Qwen"], architecture: {input_modalities: ["text"]}};
  assert.equal(toProviderModel(model, {contextWindow: 32768}).contextWindow, 32768);
  assert.equal(toProviderModel(model, undefined).contextWindow, 0);
});

test("recognizes the shared unavailable-server error for startup notification", () => {
  assert.equal(
    isServerUnavailable(new Error("llama.cpp: server not available at http://127.0.0.1:12741")),
    true,
  );
  assert.equal(isServerUnavailable(new Error("fetch failed")), false);
});

test("reports an unavailable server during startup without throwing", async () => {
  const handlers = new Map();
  const notices = [];
  const fetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new TypeError("fetch failed");
  };

  try {
    await llamaCppExtension({
      getSettings: () => ({llamaCpp: {serverUrl: "http://127.0.0.1:12741"}}),
      on: (event, handler) => handlers.set(event, handler),
      registerProvider: () => assert.fail("the unavailable server must not register a provider"),
    });
    await handlers.get("session_start")({type: "session_start", reason: "startup"}, {
      ui: {notify: (text, level) => notices.push({text, level})},
    });
  } finally {
    globalThis.fetch = fetch;
  }

  assert.deepEqual(notices, [{
    text: "llama.cpp: server not available at http://127.0.0.1:12741",
    level: "warning",
  }]);
});
