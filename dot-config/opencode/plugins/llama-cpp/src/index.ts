import {Model, Plugin, Provider} from "@opencode/plugin";
import {realpathSync} from "node:fs";
import {dirname, resolve} from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";
import type {
  LlamaCppClient,
  LlamaModel,
  ModelInfo,
} from "../../../../../dot-local/share/agent-clients/llama.cpp/index";

const PROVIDER_ID = "llama.cpp";
const PROVIDER_PACKAGE = "@opencode/ai/providers/openai-compatible";
const REFRESH_INTERVAL_MS = 10_000;

interface Options {
  serverUrl?: unknown;
}

interface ProviderSource {
  info: Provider.Info;
  models: readonly Model.Info[];
}

export default Plugin.define({
  id: "local-llama-cpp",
  async setup(ctx) {
    const serverUrl = requireServerUrl(ctx.options as Options);
    const {LlamaCppClient} = await loadClient();
    const client = new LlamaCppClient({serverUrl});
    const source: {current: ProviderSource} = {
      current: await safeBuildProviderSource(client),
    };

    await ctx.provider.transform((editor) => {
      editor.add(source.current);
    });

    await ctx.session.hook(
      "context",
      async ({model}) => {
        try {
          await client.ensureModelReady(model.id);
          source.current = await buildProviderSource(client);
          await ctx.provider.reload();
        } catch (error) {
          throw new Error(modelRequestError(model.id, error));
        }
      },
      {providerID: PROVIDER_ID},
    );

    const refreshTimer = setInterval(() => {
      void (async () => {
        source.current = await safeBuildProviderSource(client);
        await ctx.provider.reload();
      })();
    }, REFRESH_INTERVAL_MS);

    return () => clearInterval(refreshTimer);
  },
});

function requireServerUrl(options: Options): string {
  if (typeof options.serverUrl !== "string" || !options.serverUrl.trim()) {
    throw new Error(
      "OpenCode llama.cpp plugin requires plugins[].options.serverUrl",
    );
  }
  return options.serverUrl;
}

async function loadClient(): Promise<typeof import("../../../../../dot-local/share/agent-clients/llama.cpp/index")> {
  const pluginDirectory = dirname(realpathSync(fileURLToPath(import.meta.url)));
  const clientPath = resolve(
    pluginDirectory,
    "../../../../../dot-local/share/agent-clients/llama.cpp/index.ts",
  );
  return import(pathToFileURL(clientPath).href);
}

async function buildProviderSource(client: LlamaCppClient): Promise<ProviderSource> {
  const models = await client.listModels();
  const modelInfo = await Promise.all(
    models.map(async (model) => {
      try {
        return await client.getModelInfo(model.id);
      } catch {
        // A model that the server lists but whose props endpoint is temporarily
        // unavailable remains selectable; a request will surface the real error.
        return undefined;
      }
    }),
  );

  const providerID = Provider.ID.make(PROVIDER_ID);
  return {
    info: {
      ...Provider.Info.empty(providerID),
      name: "llama.cpp",
      activation: "enabled",
      package: PROVIDER_PACKAGE,
      settings: {baseURL: client.apiUrl},
    },
    models: models.map((model, index) => toOpenCodeModel(model, modelInfo[index])),
  };
}

async function safeBuildProviderSource(client: LlamaCppClient): Promise<ProviderSource> {
  try {
    return await buildProviderSource(client);
  } catch (error) {
    console.warn(`[local-llama-cpp] model discovery failed: ${message(error)}`);
    return emptyProviderSource(client);
  }
}

function emptyProviderSource(client: LlamaCppClient): ProviderSource {
  const providerID = Provider.ID.make(PROVIDER_ID);
  return {
    info: {
      ...Provider.Info.empty(providerID),
      name: "llama.cpp",
      activation: "enabled",
      package: PROVIDER_PACKAGE,
      settings: {baseURL: client.apiUrl},
    },
    models: [],
  };
}

function toOpenCodeModel(model: LlamaModel, info: ModelInfo | undefined): Model.Info {
  const providerID = Provider.ID.make(PROVIDER_ID);
  const modelID = Model.ID.make(model.id);
  const base = Model.Info.default(providerID, modelID);
  const context = info?.contextWindow ?? 0;
  const released = releaseTime(model.created);
  const input = model.architecture?.input_modalities?.includes("image")
    ? ["text", "image"]
    : ["text"];

  return {
    ...base,
    name: model.aliases?.[0] ?? model.id,
    ...(released === undefined ? {} : {time: {...base.time, released}}),
    capabilities: {
      ...base.capabilities,
      input,
      output: ["text"],
      tools: true,
    },
    limit: {
      ...base.limit,
      context,
      output: context,
    },
  };
}

function releaseTime(created: number | undefined): number | undefined {
  if (typeof created !== "number" || !Number.isFinite(created) || created <= 0) {
    return undefined;
  }
  return Math.floor(created * 1_000);
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function modelRequestError(modelID: string, error: unknown): string {
  return `Cannot use llama.cpp model '${modelID}': ${message(error)}`;
}

export {modelRequestError, PROVIDER_ID, releaseTime, requireServerUrl, toOpenCodeModel};
