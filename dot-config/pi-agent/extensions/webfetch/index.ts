import {Type} from "@earendil-works/pi-ai";
import type {ExtensionAPI} from "@earendil-works/pi-coding-agent";

const MAX_CONTENT_LENGTH = 100_000;

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "webfetch",
    label: "Web fetch",
    description: "Fetch a web page or HTTP API response and return its readable content.",
    promptSnippet: "Fetch a URL to read its current content.",
    parameters: Type.Object({
      url: Type.String({description: "HTTP or HTTPS URL to retrieve"}),
    }),
    executionMode: "parallel",
    async execute(_toolCallId, {url}, signal) {
      const result = await fetchUrl(url, signal);
      return {
        content: [{type: "text", text: result.content}],
        details: {url: result.url, contentType: result.contentType, truncated: result.truncated},
      };
    },
  });
}

interface FetchResult {
  url: string;
  contentType: string;
  content: string;
  truncated: boolean;
}

async function fetchUrl(input: string, signal?: AbortSignal): Promise<FetchResult> {
  const url = requireWebUrl(input);
  let response: Response;
  try {
    response = await fetch(url, {
      headers: {Accept: "text/html, text/plain, application/json, application/xml, text/xml;q=0.9, */*;q=0.1"},
      signal,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new Error(`Web fetch: server not available at ${url.toString()}`);
  }

  if (!response.ok) {
    throw new Error(`Web fetch failed (${response.status}): ${response.statusText}`);
  }

  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  const body = await response.text();
  const content = contentType.includes("text/html") ? htmlToText(body) : body;
  const truncated = content.length > MAX_CONTENT_LENGTH;
  return {
    url: response.url || url.toString(),
    contentType,
    content: truncated ? `${content.slice(0, MAX_CONTENT_LENGTH)}\n\n[Content truncated]` : content,
    truncated,
  };
}

function requireWebUrl(input: string): URL {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error(`Invalid web URL: ${input}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Web fetch URL must use http:// or https://");
  }
  return url;
}

function htmlToText(html: string): string {
  return decodeHtmlEntities(html
    .replace(/<(script|style|svg|noscript|template)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/?(article|aside|blockquote|div|figcaption|footer|h[1-6]|header|li|main|p|pre|section|table|tr|ul|ol)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\r/g, "")
    .replace(/[^\S\n]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim());
}

function decodeHtmlEntities(value: string): string {
  const named: Record<string, string> = {
    amp: "&", apos: "'", gt: ">", lt: "<", nbsp: " ", quot: '"',
  };
  return value.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity, code) => {
    const normalized = code.toLowerCase();
    if (normalized in named) return named[normalized];
    const number = normalized.startsWith("#x")
      ? Number.parseInt(normalized.slice(2), 16)
      : normalized.startsWith("#") ? Number.parseInt(normalized.slice(1), 10) : NaN;
    return Number.isInteger(number) && number >= 0 && number <= 0x10ffff
      ? String.fromCodePoint(number)
      : entity;
  });
}

export {decodeHtmlEntities, fetchUrl, htmlToText, requireWebUrl, MAX_CONTENT_LENGTH};
