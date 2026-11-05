/** A small, dependency-free client for a llama.cpp `llama-server` instance. */

export type ServerMode = "single" | "router";
export type ModelStatus =
  | "loaded"
  | "loading"
  | "failed"
  | "sleeping"
  | "unloaded";

export interface LlamaModel {
  id: string;
  /** Unix timestamp in seconds, as returned by llama.cpp's `/v1/models`. */
  created?: number;
  aliases?: string[];
  status?: {
    value?: string;
    args?: string[];
    exit_code?: number;
    failed?: boolean;
  };
  architecture?: {
    input_modalities?: string[];
    output_modalities?: string[];
  };
  meta?: {
    n_ctx?: number;
    n_ctx_train?: number;
  };
}

export interface LlamaModelsResponse {
  object: string;
  data: LlamaModel[];
}

interface PropsError {
  code?: number;
  message?: string;
}

interface ModelPropsResponse {
  is_sleeping?: boolean;
  error?: PropsError;
}

interface ServerPropsResponse {
  role?: string;
}

export interface ModelInfo {
  model: LlamaModel;
  mode: ServerMode;
  status: ModelStatus;
  /** Actual or router-preset context window. Undefined means the server did not expose one. */
  contextWindow?: number;
}

export interface LlamaCppClientOptions {
  serverUrl: string;
  fetch?: typeof globalThis.fetch;
  pollingIntervalMs?: number;
  pollingTimeoutMs?: number;
}

export class LlamaCppError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "LlamaCppError";
  }
}

export function normalizeServerUrl(serverUrl: string): string {
  if (!serverUrl?.trim()) {
    throw new LlamaCppError("llama.cpp serverUrl is required");
  }

  let url: URL;
  try {
    url = new URL(serverUrl);
  } catch {
    throw new LlamaCppError(`Invalid llama.cpp serverUrl: ${serverUrl}`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new LlamaCppError("llama.cpp serverUrl must use http:// or https://");
  }

  url.pathname = url.pathname.replace(/\/+$/, "").replace(/\/v1$/, "") || "/";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

export class LlamaCppClient {
  readonly serverUrl: string;
  private readonly fetchFn: typeof globalThis.fetch;
  private readonly pollingIntervalMs: number;
  private readonly pollingTimeoutMs: number;

  constructor(options: LlamaCppClientOptions) {
    this.serverUrl = normalizeServerUrl(options.serverUrl);
    this.fetchFn = options.fetch ?? globalThis.fetch;
    this.pollingIntervalMs = options.pollingIntervalMs ?? 1_000;
    this.pollingTimeoutMs = options.pollingTimeoutMs ?? 120_000;
  }

  get apiUrl(): string {
    return `${this.serverUrl}/v1`;
  }

  async listModels(): Promise<LlamaModel[]> {
    const response = await this.request<LlamaModelsResponse>("/v1/models");
    return response.data ?? [];
  }

  async getMode(): Promise<ServerMode> {
    const props = await this.request<ServerPropsResponse>("/props?autoload=false");
    return props.role === "router" ? "router" : "single";
  }

  async getModelStatus(modelId: string): Promise<ModelStatus> {
    const props = await this.request<ModelPropsResponse>(
      `/props?model=${encodeURIComponent(modelId)}&autoload=false`,
    );

    if (props.is_sleeping) return "sleeping";
    if (!props.error) return "loaded";
    if (props.error.code === 503) return "loading";
    if (props.error.code === 400 && props.error.message === "model is not loaded") {
      return "unloaded";
    }
    return "failed";
  }

  async getModelInfo(modelId: string): Promise<ModelInfo> {
    const [mode, models, status] = await Promise.all([
      this.getMode(),
      this.listModels(),
      this.getModelStatus(modelId),
    ]);
    const model = models.find((item) => item.id === modelId);
    if (!model) {
      throw new LlamaCppError(`llama.cpp model not found: ${modelId}`);
    }

    return {
      model,
      mode,
      status,
      contextWindow: this.resolveContextWindow(model, mode, status),
    };
  }

  async loadModel(modelId: string): Promise<void> {
    await this.request("/models/load", "POST", {model: modelId});
  }

  async unloadModel(modelId: string): Promise<void> {
    await this.request("/models/unload", "POST", {model: modelId});
  }

  async waitForModel(modelId: string): Promise<ModelStatus> {
    const deadline = Date.now() + this.pollingTimeoutMs;
    let status = await this.getModelStatus(modelId);

    while (status === "loading") {
      if (Date.now() >= deadline) {
        throw new LlamaCppError(
          `Timed out waiting for llama.cpp model to load: ${modelId}`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, this.pollingIntervalMs));
      status = await this.getModelStatus(modelId);
    }

    return status;
  }

  /**
   * Makes a model ready to serve and returns its actual loaded context window.
   * Router presets may disclose a prospective context before loading, but that
   * value is deliberately not used here: a request must use `meta.n_ctx` from
   * the model that llama.cpp actually loaded.
   */
  async ensureModelReady(modelId: string): Promise<ModelInfo> {
    let info = await this.getModelInfo(modelId);

    if (info.status === "unloaded") {
      if (info.mode !== "router") {
        throw new LlamaCppError(
          `llama.cpp single server reports its model as unloaded: ${modelId}`,
        );
      }
      await this.loadModel(modelId);
      info = await this.getModelInfo(modelId);
    }

    if (info.status === "loading") {
      const status = await this.waitForModel(modelId);
      if (status !== "loaded" && status !== "sleeping") {
        throw new LlamaCppError(`llama.cpp model failed to load: ${modelId}`);
      }
      info = await this.getModelInfo(modelId);
    }

    if (info.status !== "loaded" && info.status !== "sleeping") {
      throw new LlamaCppError(`llama.cpp model is not ready: ${modelId}`);
    }

    const contextWindow = info.model.meta?.n_ctx;
    if (!isContextWindow(contextWindow)) {
      throw new LlamaCppError(
        `llama.cpp did not report meta.n_ctx for loaded model: ${modelId}`,
      );
    }

    return {...info, contextWindow};
  }

  private resolveContextWindow(
    model: LlamaModel,
    mode: ServerMode,
    status: ModelStatus,
  ): number | undefined {
    if (isContextWindow(model.meta?.n_ctx)) return model.meta.n_ctx;
    if (mode !== "router" || status === "loaded" || status === "sleeping") {
      return undefined;
    }
    return contextFromArgs(model.status?.args);
  }

  private async request<T>(
    path: string,
    method: "GET" | "POST" = "GET",
    body?: Record<string, unknown>,
  ): Promise<T> {
    let response: Response;
    try {
      response = await this.fetchFn(`${this.serverUrl}${path}`, {
        method,
        headers: body ? {"Content-Type": "application/json"} : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (error) {
      throw new LlamaCppError(
        `llama.cpp: server not available at ${this.serverUrl}`,
      );
    }

    const payload = await readJson(response);
    if (!response.ok) {
      const message = payload && typeof payload === "object" && "error" in payload
        ? JSON.stringify(payload.error)
        : response.statusText;
      throw new LlamaCppError(
        `llama.cpp request ${method} ${path} failed (${response.status}): ${message}`,
        response.status,
      );
    }
    return payload as T;
  }
}

function contextFromArgs(args: string[] | undefined): number | undefined {
  if (!args) return undefined;
  for (const option of ["--ctx-size", "--fit-ctx"]) {
    const index = args.indexOf(option);
    const value = index >= 0 ? Number.parseInt(args[index + 1] ?? "", 10) : NaN;
    if (isContextWindow(value)) return value;
  }
  return undefined;
}

function isContextWindow(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
