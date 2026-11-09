import {Type} from "@earendil-works/pi-ai";
import type {ExtensionAPI} from "@earendil-works/pi-coding-agent";
import {realpathSync} from "node:fs";
import {homedir} from "node:os";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";

interface SearXNGSettings {
  serverUrl?: unknown;
}

interface SearXNGResult {
  url: string;
  title?: string;
  content?: string;
}

interface SearXNGClient {
  search(query: string, signal?: AbortSignal): Promise<SearXNGResult[]>;
}

interface SearXNGModule {
  SearXNGClient: new (options: {serverUrl: string}) => SearXNGClient;
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

async function loadClient(): Promise<SearXNGModule> {
  return import(pathToFileURL(realpathSync(resolveAgentClientPath("searxng"))).href);
}

function resolveAgentClientPath(client: string, xdgDataHome = process.env.XDG_DATA_HOME): string {
  const dataHome = xdgDataHome || resolve(homedir(), ".local", "share");
  return resolve(dataHome, "agent-clients", client, "index.ts");
}

function formatResults(results: readonly SearXNGResult[]): string {
  if (!results.length) return "No results found.";
  return results.map((result, index) => [
    `${index + 1}. ${result.title ?? result.url}`,
    result.url,
    result.content,
  ].filter(Boolean).join("\n")).join("\n\n");
}

export {formatResults, readSettings, resolveAgentClientPath};
