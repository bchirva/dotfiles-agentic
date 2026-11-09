import type {
  BeforeProviderRequestEvent,
  ExtensionAPI,
  ExtensionContext,
  ModelSelectEvent,
  ProviderModelConfig,
} from "@earendil-works/pi-coding-agent";
import {realpathSync} from "node:fs";
import {homedir} from "node:os";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";

const PROVIDER_ID = "llama.cpp";

interface LlamaCppSettings {
  serverUrl?: unknown;
}

interface LlamaModel {
  id: string;
  aliases?: string[];
  architecture?: {input_modalities?: string[]};
}

interface ModelInfo {
  contextWindow?: number;
}

interface LlamaCppClient {
  apiUrl: string;
  ensureModelReady(modelID: string): Promise<void>;
  getModelInfo(modelID: string): Promise<ModelInfo>;
  listModels(): Promise<LlamaModel[]>;
}

interface LlamaCppModule {
  LlamaCppClient: new (options: {serverUrl: string}) => LlamaCppClient;
}

export default async function (pi: ExtensionAPI) {
  let client: LlamaCppClient | undefined;

  const register = async () => {
    const readyClient = await initialize();
    pi.registerProvider(PROVIDER_ID, {
      name: "llama.cpp",
      baseUrl: readyClient.apiUrl,
      apiKey: "local",
      api: "openai-completions",
      models: await listProviderModels(readyClient),
    });
  };

  const initialize = async (): Promise<LlamaCppClient> => {
    if (client) return client;
    const settings = readSettings(pi);
    const {LlamaCppClient} = await loadClient();
    client = new LlamaCppClient({serverUrl: settings.serverUrl});
    return client;
  };

  pi.on("session_start", async (_event, ctx) => {
    try {
      await register();
    } catch (error) {
      if (!isServerUnavailable(error)) throw error;
      ctx.ui.notify(message(error), "warning");
    }
  });

  pi.on("model_select", async (event: ModelSelectEvent, ctx: ExtensionContext) => {
    if (event.model.provider !== PROVIDER_ID) return;
    await prepareModel(await initialize(), event.model.id, ctx, register);
  });

  pi.on(
    "before_provider_request",
    async (event: BeforeProviderRequestEvent, ctx: ExtensionContext) => {
      const payload = event.payload as {model?: string};
      if (!payload.model || ctx.model?.provider !== PROVIDER_ID) return;
      await prepareModel(await initialize(), payload.model, ctx, register);
      return payload;
    },
  );
}

function readSettings(pi: ExtensionAPI): {serverUrl: string} {
  const raw = (pi.getSettings() as Record<string, unknown>).llamaCpp;
  const settings = (raw ?? {}) as LlamaCppSettings;
  if (typeof settings.serverUrl !== "string" || !settings.serverUrl.trim()) {
    throw new Error(
      "Pi llama.cpp extension requires llamaCpp.serverUrl in settings.json",
    );
  }
  return {serverUrl: settings.serverUrl};
}

function isServerUnavailable(error: unknown): boolean {
  return message(error).startsWith("llama.cpp: server not available at ");
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function loadClient(): Promise<LlamaCppModule> {
  return import(pathToFileURL(realpathSync(resolveAgentClientPath("llama.cpp"))).href);
}

function resolveAgentClientPath(client: string, xdgDataHome = process.env.XDG_DATA_HOME): string {
  const dataHome = xdgDataHome || resolve(homedir(), ".local", "share");
  return resolve(dataHome, "agent-clients", client, "index.ts");
}

async function prepareModel(
  client: LlamaCppClient,
  modelID: string,
  ctx: ExtensionContext,
  register: () => Promise<void>,
): Promise<void> {
  ctx.ui.notify(`Preparing llama.cpp model ${modelID}…`, "info");
  try {
    await client.ensureModelReady(modelID);
    await register();
  } catch (error) {
    ctx.ui.notify(`llama.cpp model ${modelID} is unavailable: ${message(error)}`, "error");
    throw error;
  }
}

async function listProviderModels(client: LlamaCppClient): Promise<ProviderModelConfig[]> {
  const models = await client.listModels();
  const info = await Promise.all(
    models.map(async (model) => {
      try {
        return await client.getModelInfo(model.id);
      } catch {
        return undefined;
      }
    }),
  );
  return models.map((model, index) => toProviderModel(model, info[index]));
}

function toProviderModel(
  model: LlamaModel,
  info: ModelInfo | undefined,
): ProviderModelConfig {
  const contextWindow = info?.contextWindow ?? 0;
  return {
    id: model.id,
    name: model.aliases?.[0] ?? model.id,
    reasoning: true,
    input: model.architecture?.input_modalities?.includes("image")
      ? ["text", "image"]
      : ["text"],
    cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0},
    contextWindow,
    maxTokens: contextWindow,
  };
}

export {
  PROVIDER_ID,
  isServerUnavailable,
  readSettings,
  resolveAgentClientPath,
  toProviderModel,
};
