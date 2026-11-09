import {Plugin, WebSearch} from "@opencode/plugin";
import {realpathSync} from "node:fs";
import {homedir} from "node:os";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";

const PROVIDER_ID = "searxng";

interface Options {
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

export default Plugin.define({
  id: "local-searxng-websearch",
  async setup(ctx) {
    const serverUrl = requireServerUrl(ctx.options as Options);
    const {SearXNGClient} = await loadClient();
    const client = new SearXNGClient({serverUrl});

    await ctx.websearch.transform((editor) => {
      editor.add({
        id: PROVIDER_ID,
        name: "SearXNG",
        execute: async ({query}, {signal}) => toOpenCodeResults(await client.search(query, signal)),
      });
      editor.default.set(PROVIDER_ID);
    });
  },
});

function requireServerUrl(options: Options): string {
  if (typeof options.serverUrl !== "string" || !options.serverUrl.trim()) {
    throw new Error("OpenCode SearXNG plugin requires plugins[].options.serverUrl");
  }
  return options.serverUrl;
}

async function loadClient(): Promise<SearXNGModule> {
  return import(pathToFileURL(realpathSync(resolveAgentClientPath("searxng"))).href);
}

function resolveAgentClientPath(client: string, xdgDataHome = process.env.XDG_DATA_HOME): string {
  const dataHome = xdgDataHome || resolve(homedir(), ".local", "share");
  return resolve(dataHome, "agent-clients", client, "index.ts");
}

function toOpenCodeResults(results: readonly SearXNGResult[]): WebSearch.Result[] {
  return results.map((result) => ({
    url: result.url,
    ...(result.title === undefined ? {} : {title: result.title}),
    ...(result.content === undefined ? {} : {content: result.content}),
    time: {},
  }));
}

export {PROVIDER_ID, requireServerUrl, resolveAgentClientPath, toOpenCodeResults};
