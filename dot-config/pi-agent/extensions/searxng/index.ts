import {Type} from "@earendil-works/pi-ai";
import type {ExtensionAPI} from "@earendil-works/pi-coding-agent";
import {realpathSync} from "node:fs";
import {dirname, resolve} from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";
import type {
  SearXNGClient,
  SearXNGResult,
} from "../../../../dot-local/share/agent-clients/searxng/index";

interface SearXNGSettings {
  serverUrl?: unknown;
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "websearch",
    label: "Web search",
    description: "Search the web through the configured SearXNG instance.",
    promptSnippet: "Search the web for current information.",
    parameters: Type.Object({
      query: Type.String({description: "Search query"}),
    }),
    executionMode: "parallel",
    async execute(_toolCallId, {query}, signal) {
      const client = await initialize(pi);
      const results = await client.search(query, signal);
      return {
        content: [{type: "text", text: formatResults(results)}],
        details: {results},
      };
    },
  });
}

function readSettings(pi: ExtensionAPI): {serverUrl: string} {
  const raw = (pi.getSettings() as Record<string, unknown>).searxng;
  const settings = (raw ?? {}) as SearXNGSettings;
  if (typeof settings.serverUrl !== "string" || !settings.serverUrl.trim()) {
    throw new Error("Pi SearXNG extension requires searxng.serverUrl in settings.json");
  }
  return {serverUrl: settings.serverUrl};
}

async function initialize(pi: ExtensionAPI): Promise<SearXNGClient> {
  const {serverUrl} = readSettings(pi);
  const {SearXNGClient} = await loadClient();
  return new SearXNGClient({serverUrl});
}

async function loadClient(): Promise<typeof import("../../../../dot-local/share/agent-clients/searxng/index")> {
  const extensionDirectory = dirname(realpathSync(fileURLToPath(import.meta.url)));
  const clientPath = resolve(
    extensionDirectory,
    "../../../../dot-local/share/agent-clients/searxng/index.ts",
  );
  return import(pathToFileURL(clientPath).href);
}

function formatResults(results: readonly SearXNGResult[]): string {
  if (!results.length) return "No results found.";
  return results.map((result, index) => [
    `${index + 1}. ${result.title ?? result.url}`,
    result.url,
    result.content,
  ].filter(Boolean).join("\n")).join("\n\n");
}

export {formatResults, readSettings};
