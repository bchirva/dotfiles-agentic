import assert from "node:assert/strict";
import test from "node:test";

import {formatResults, readSettings, resolveAgentClientPath} from "../index.js";

test("reads searxng.serverUrl from Pi's effective settings", () => {
  assert.deepEqual(
    readSettings({getSettings: () => ({searxng: {serverUrl: "http://searxng.localhost"}})}),
    {serverUrl: "http://searxng.localhost"},
  );
  assert.throws(
    () => readSettings({getSettings: () => ({})}),
    /searxng\.serverUrl/,
  );
});

test("formats concise, source-preserving SearXNG results for the model", () => {
  assert.equal(formatResults([{
    url: "https://opencode.ai",
    title: "OpenCode",
    content: "An AI coding agent",
  }]), "1. OpenCode\nhttps://opencode.ai\nAn AI coding agent");
  assert.equal(formatResults([]), "No results found.");
});

test("loads shared clients from XDG_DATA_HOME", () => {
  assert.equal(
    resolveAgentClientPath("searxng", "/var/lib/user-data"),
    "/var/lib/user-data/agent-clients/searxng/index.ts",
  );
});
