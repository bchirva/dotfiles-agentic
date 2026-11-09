import assert from "node:assert/strict";
import test from "node:test";

import {
  PROVIDER_ID,
  requireServerUrl,
  resolveAgentClientPath,
  toOpenCodeResults,
} from "../index.js";

test("uses a stable SearXNG websearch provider ID", () => {
  assert.equal(PROVIDER_ID, "searxng");
});

test("requires an explicit OpenCode plugin serverUrl", () => {
  assert.equal(
    requireServerUrl({serverUrl: "http://searxng.localhost"}),
    "http://searxng.localhost",
  );
  assert.throws(() => requireServerUrl({}), /options\.serverUrl/);
});

test("projects SearXNG results into OpenCode websearch results", () => {
  assert.deepEqual(toOpenCodeResults([{
    url: "https://opencode.ai",
    title: "OpenCode",
    content: "An AI coding agent",
  }]), [{
    url: "https://opencode.ai",
    title: "OpenCode",
    content: "An AI coding agent",
    time: {},
  }]);
});

test("loads shared clients from XDG_DATA_HOME", () => {
  assert.equal(
    resolveAgentClientPath("searxng", "/var/lib/user-data"),
    "/var/lib/user-data/agent-clients/searxng/index.ts",
  );
});
