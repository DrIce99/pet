// AI services the pet can think with. Anthropic uses its own SDK; Ollama its
// native API; everything else speaks the OpenAI-compatible chat API.

export const PROVIDER_IDS = ["anthropic", "ollama", "gemini", "groq", "openrouter", "custom"] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

export interface ProviderInfo {
  label: string;
  /** Short name used inside sentences ("la chiave di …"). */
  name: string;
  /** API family. */
  kind: "anthropic" | "ollama" | "openai";
  free: boolean;
  needsKey: boolean;
  /** OpenAI-compatible base URL for hosted services. */
  baseUrl?: string;
  envKey?: string;
  keyHelp?: string;
  note: string;
  /** Example models; "Rileva modelli" fetches the real list. */
  suggestions: string[];
}

export const PROVIDERS: Record<ProviderId, ProviderInfo> = {
  anthropic: {
    label: "Claude (Anthropic)",
    name: "Claude",
    kind: "anthropic",
    free: false,
    needsKey: true,
    envKey: "ANTHROPIC_API_KEY",
    keyHelp: "console.anthropic.com → API Keys",
    note: "A pagamento, il più capace: personalità, memoria e visione al meglio.",
    suggestions: ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "claude-fable-5-1"],
  },
  ollama: {
    label: "Ollama (sul tuo PC, gratis)",
    name: "Ollama",
    kind: "ollama",
    free: true,
    needsKey: false,
    note: "Gratis e privato: il modello gira sul tuo computer. Installa Ollama da ollama.com, poi scarica un modello, per esempio \"ollama pull qwen3\" (per vedere lo schermo: \"ollama pull qwen2.5vl\" o \"mistral-small3.2\"). Serve un PC abbastanza potente.",
    suggestions: ["qwen3", "qwen2.5vl", "mistral-small3.2", "llama3.2", "gemma3"],
  },
  gemini: {
    label: "Google Gemini (gratis con limiti)",
    name: "Gemini",
    kind: "openai",
    free: true,
    needsKey: true,
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    envKey: "GEMINI_API_KEY",
    keyHelp: "aistudio.google.com → Get API key",
    note: "Piano gratuito con limiti giornalieri, vede le immagini. Attenzione: sul piano gratuito Google può usare i contenuti inviati (anche gli screenshot) per migliorare i suoi servizi.",
    suggestions: ["gemini-flash-lite-latest", "gemini-flash-latest", "gemini-3.8-flash"],
  },
  groq: {
    label: "Groq (gratis con limiti)",
    name: "Groq",
    kind: "openai",
    free: true,
    needsKey: true,
    baseUrl: "https://api.groq.com/openai/v1",
    envKey: "GROQ_API_KEY",
    keyHelp: "console.groq.com → API Keys",
    note: "Gratis con limiti e velocissimo. Per vedere lo schermo serve un modello con visione (per esempio Llama 4 Scout).",
    suggestions: ["llama-3.3-70b-versatile", "meta-llama/llama-4-scout-17b-16e-instruct", "openai/gpt-oss-20b"],
  },
  openrouter: {
    label: "OpenRouter (modelli :free)",
    name: "OpenRouter",
    kind: "openai",
    free: true,
    needsKey: true,
    baseUrl: "https://openrouter.ai/api/v1",
    envKey: "OPENROUTER_API_KEY",
    keyHelp: "openrouter.ai → Keys",
    note: "Un'unica chiave per tanti modelli: quelli che finiscono con \":free\" sono gratuiti (con limiti). Usa \"Rileva modelli\" per vederli.",
    suggestions: [],
  },
  custom: {
    label: "Altro servizio compatibile OpenAI",
    name: "questo servizio",
    kind: "openai",
    free: false,
    needsKey: false,
    note: "LM Studio, OpenAI, Mistral, DeepSeek e altri: indica l'indirizzo base dell'API (di solito finisce con /v1) e, se serve, la chiave.",
    suggestions: [],
  },
};

export function isProvider(value: unknown): value is ProviderId {
  return typeof value === "string" && (PROVIDER_IDS as readonly string[]).includes(value);
}

export const DEFAULT_OLLAMA_URL = "http://localhost:11434";
