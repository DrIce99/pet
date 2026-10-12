// Builds the provider for a service from the user's settings and keys.
import Anthropic from "@anthropic-ai/sdk";
import { PROVIDERS, type ProviderId } from "../../shared/providers";
import { AnthropicProvider, sdkStreamer } from "./anthropic";
import { CompatProvider, type FetchLike } from "./compat";
import { OllamaTransport } from "./ollama";
import { OpenAITransport } from "./openai";
import { ProviderError, type ChatProvider } from "./types";

export interface ProviderConfig {
  apiKey: string | null;
  ollamaUrl: string;
  customUrl: string;
  /** Network stack to use; the app passes Electron's net.fetch. */
  fetch?: FetchLike;
}

/** The provider for a service, or null when it isn't configured (missing key or address). */
export function createProvider(id: ProviderId, config: ProviderConfig): ChatProvider | null {
  const info = PROVIDERS[id];
  if (info.needsKey && !config.apiKey) return null;
  switch (info.kind) {
    case "anthropic":
      return new AnthropicProvider(
        sdkStreamer(new Anthropic({ apiKey: config.apiKey!, maxRetries: 2, timeout: 120_000, ...(config.fetch ? { fetch: config.fetch } : {}) })),
      );
    case "ollama":
      return new CompatProvider(id, new OllamaTransport(trimUrl(config.ollamaUrl), config.fetch));
    case "openai": {
      const base = id === "custom" ? trimUrl(config.customUrl) : info.baseUrl!;
      if (!base) return null;
      const extra: Record<string, string> = id === "openrouter" ? { "X-Title": "Pixel Pet" } : {};
      return new CompatProvider(id, new OpenAITransport(base, config.apiKey, info.name, extra, config.fetch));
    }
  }
}

/** Models offered by a service, for the settings window. */
export async function listModels(id: ProviderId, config: ProviderConfig): Promise<string[]> {
  const info = PROVIDERS[id];
  if (info.kind === "anthropic") return [...info.suggestions];
  if (info.needsKey && !config.apiKey) throw new ProviderError("auth", "Inserisci prima la chiave API.");
  if (info.kind === "ollama") return new OllamaTransport(trimUrl(config.ollamaUrl), config.fetch).listModels();
  const base = id === "custom" ? trimUrl(config.customUrl) : info.baseUrl!;
  if (!base) throw new ProviderError("bad_request", "Indica prima l'indirizzo del servizio.");
  const models = await new OpenAITransport(base, config.apiKey, info.name, {}, config.fetch).listModels();
  // OpenRouter lists hundreds of models: show the free ones first
  return id === "openrouter" ? [...models.filter((m) => m.endsWith(":free")), ...models.filter((m) => !m.endsWith(":free"))] : models;
}

function trimUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

export { ProviderError } from "./types";
export type { ChatProvider } from "./types";
export type { FetchLike } from "./compat";
