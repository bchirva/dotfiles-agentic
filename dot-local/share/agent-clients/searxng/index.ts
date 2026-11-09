/** A small, dependency-free client for SearXNG's JSON search API. */

export interface SearXNGResult {
  url: string;
  title?: string;
  content?: string;
}

interface SearXNGResponse {
  results?: unknown;
}

export interface SearXNGClientOptions {
  serverUrl: string;
  fetch?: typeof globalThis.fetch;
}

export class SearXNGError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "SearXNGError";
  }
}

export function normalizeServerUrl(serverUrl: string): string {
  if (!serverUrl?.trim()) {
    throw new SearXNGError("SearXNG serverUrl is required");
  }

  let url: URL;
  try {
    url = new URL(serverUrl);
  } catch {
    throw new SearXNGError(`Invalid SearXNG serverUrl: ${serverUrl}`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new SearXNGError("SearXNG serverUrl must use http:// or https://");
  }

  url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

export class SearXNGClient {
  readonly serverUrl: string;
  private readonly fetchFn: typeof globalThis.fetch;

  constructor(options: SearXNGClientOptions) {
    this.serverUrl = normalizeServerUrl(options.serverUrl);
    this.fetchFn = options.fetch ?? globalThis.fetch;
  }

  async search(query: string, signal?: AbortSignal): Promise<SearXNGResult[]> {
    if (!query.trim()) throw new SearXNGError("SearXNG search query is required");

    const url = new URL(`${this.serverUrl}/search`);
    url.searchParams.set("q", query);
    url.searchParams.set("format", "json");

    let response: Response;
    try {
      response = await this.fetchFn(url, {
        headers: {Accept: "application/json"},
        signal,
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new SearXNGError(`SearXNG: server not available at ${this.serverUrl}`);
    }

    const payload = await readJson(response);
    if (!response.ok) {
      const detail = errorDetail(payload) ?? response.statusText;
      throw new SearXNGError(
        `SearXNG search failed (${response.status}): ${detail}`,
        response.status,
      );
    }

    const results = payload && typeof payload === "object"
      ? (payload as SearXNGResponse).results
      : undefined;
    if (!Array.isArray(results)) {
      throw new SearXNGError("SearXNG returned an invalid JSON search response");
    }
    return results.flatMap(toResult);
  }
}

function toResult(value: unknown): SearXNGResult[] {
  if (!value || typeof value !== "object") return [];
  const result = value as Record<string, unknown>;
  if (typeof result.url !== "string" || !result.url) return [];
  return [{
    url: result.url,
    ...(typeof result.title === "string" && result.title ? {title: result.title} : {}),
    ...(typeof result.content === "string" && result.content ? {content: result.content} : {}),
  }];
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function errorDetail(payload: unknown): string | undefined {
  if (typeof payload === "string" && payload) return payload;
  if (payload && typeof payload === "object" && "error" in payload) {
    const error = (payload as {error?: unknown}).error;
    return typeof error === "string" ? error : JSON.stringify(error);
  }
  return undefined;
}
