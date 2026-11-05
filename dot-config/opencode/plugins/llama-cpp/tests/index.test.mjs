import assert from "node:assert/strict";
import test from "node:test";

import {
  modelRequestError,
  releaseTime,
  requireServerUrl,
  toOpenCodeModel,
} from "../src/index.js";

test("requires an explicit OpenCode plugin serverUrl", () => {
  assert.equal(
    requireServerUrl({serverUrl: "http://127.0.0.1:12741"}),
    "http://127.0.0.1:12741",
  );
  assert.throws(() => requireServerUrl({}), /options\.serverUrl/);
});

test("projects the discovered context into OpenCode model limits", () => {
  const model = toOpenCodeModel(
    {id: "qwen", aliases: ["Qwen"]},
    {contextWindow: 32768},
  );
  assert.equal(model.limit.context, 32768);
  assert.equal(model.limit.output, 32768);
});

test("uses llama.cpp's created timestamp as the model release time", () => {
  assert.equal(releaseTime(1_793_821_948), 1_793_821_948_000);
  assert.equal(releaseTime(0), undefined);
  assert.equal(releaseTime(Number.NaN), undefined);
});

test("keeps the shared unavailable-server message in model request errors", () => {
  assert.equal(
    modelRequestError(
      "qwen",
      new Error("llama.cpp: server not available at http://127.0.0.1:12741"),
    ),
    "Cannot use llama.cpp model 'qwen': llama.cpp: server not available at http://127.0.0.1:12741",
  );
});
