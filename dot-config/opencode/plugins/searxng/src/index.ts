import {Plugin, WebSearch} from "@opencode/plugin";
import {realpathSync} from "node:fs";
import {dirname, resolve} from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";
import type {
  SearXNGClient,
  SearXNGResult,
} from "../../../../../dot-local/share/agent-clients/searxng/index";

const PROVIDER_ID = "searxng";

interface Options {
  serverUrl?: unknown;
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

async function loadClient(): Promise<typeof import("../../../../../dot-local/share/agent-clients/searxng/index")> {
  const pluginDirectory = dirname(realpathSync(fileURLToPath(import.meta.url)));
  const clientPath = resolve(
    pluginDirectory,
    "../../../../../dot-local/share/agent-clients/searxng/index.ts",
  );
  return import(pathToFileURL(clientPath).href);
}

function toOpenCodeResults(results: readonly SearXNGResult[]): WebSearch.Result[] {
  return results.map((result) => ({
    url: result.url,
    ...(result.title === undefined ? {} : {title: result.title}),
    ...(result.content === undefined ? {} : {content: result.content}),
    time: {},
  }));
}

export {PROVIDER_ID, requireServerUrl, toOpenCodeResults};
