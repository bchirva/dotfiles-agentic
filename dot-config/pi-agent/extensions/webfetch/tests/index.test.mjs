import assert from "node:assert/strict";
import test from "node:test";

import {decodeHtmlEntities, fetchUrl, htmlToText, requireWebUrl} from "../index.js";

test("accepts only HTTP(S) URLs", () => {
  assert.equal(requireWebUrl("https://example.com/page").href, "https://example.com/page");
  assert.throws(() => requireWebUrl("not a URL"), /Invalid web URL/);
  assert.throws(() => requireWebUrl("file:///etc/passwd"), /http:\/\/ or https:\/\//);
});

test("turns HTML into readable text while removing non-content elements", () => {
  assert.equal(
    htmlToText("<main><h1>Title &amp; more</h1><p>Hello <strong>world</strong>.</p><script>ignore()</script></main>"),
    "Title & more\n\nHello world.",
  );
  assert.equal(decodeHtmlEntities("&#169; &#x1f680; &unknown;"), "© 🚀 &unknown;");
});

test("fetches HTML content and reports HTTP failures", async () => {
  const fetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("<h1>Current data</h1><p>Updated today.</p>", {
    headers: {"content-type": "text/html; charset=utf-8"},
  });
  try {
    const result = await fetchUrl("https://example.com/data");
    assert.equal(result.url, "https://example.com/data");
    assert.equal(result.content, "Current data\n\nUpdated today.");
    assert.equal(result.truncated, false);
  } finally {
    globalThis.fetch = fetch;
  }

  globalThis.fetch = async () => new Response("Not Found", {status: 404, statusText: "Not Found"});
  try {
    await assert.rejects(() => fetchUrl("https://example.com/missing"), /Web fetch failed \(404\): Not Found/);
  } finally {
    globalThis.fetch = fetch;
  }
});
