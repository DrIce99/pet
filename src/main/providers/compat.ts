// Moments for non-Anthropic services (Ollama, OpenAI-compatible APIs). The
// conversation is kept in a simple neutral form that each transport converts.
// Models that reject tools fall back to a JSON reply format; models that
// reject images get a note instead of the screenshot.
import type { ProviderId } from "../../shared/providers";
import { log } from "../log";
import { TOOLS } from "../tools";
import { JSON_REPLY_FORMAT, parseJsonReply, partialStringField, stripThinking } from "./text";
import { ProviderError, type ChatProvider, type MomentOptions, type MomentSession, type RoundResult, type ToolResultIn } from "./types";

export type SimpleMessage =
  | { role: "system"; text: string }
  | { role: "user"; text: string; images?: string[] }
  | { role: "assistant"; text: string; toolCalls?: StreamedCall[] }
  | { role: "tool"; id: string; name: string; text: string };

export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface StreamRequest {
  model: string;
  messages: SimpleMessage[];
  tools: ToolSpec[] | null;
  /** Ask the service for a JSON object (models without tools). */
  json: boolean;
  maxTokens: number;
}

export interface StreamDelta {
  text?: string;
  /** A tool call fragment: `args` is appended to the call at `index`. */
  tool?: { index: number; id?: string; name?: string; args?: string; extra?: unknown };
}

export interface StreamedCall {
  id: string;
  name: string;
  args: string;
  /** Opaque data the service wants back with the call (Gemini's thought signatures). */
  extra?: unknown;
}

export interface StreamOutcome {
  finish: "stop" | "tool_calls" | "length" | "content_filter";
  usage: { input_tokens: number; output_tokens: number } | null;
}

/**
 * The fetch the providers use. Defaults to the global one, looked up at call
 * time so tests can swap it; the app passes Electron's net.fetch.
 */
export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
export const defaultFetch: FetchLike = (input, init) => globalThis.fetch(input, init);

export interface ChatTransport {
  stream(request: StreamRequest, onDelta: (delta: StreamDelta) => void, signal: AbortSignal): Promise<StreamOutcome>;
}

/** Tool definitions without the JSON Schema keywords some services reject. */
export const TOOL_SPECS: ToolSpec[] = TOOLS.map((t) => ({
  name: t.name,
  description: t.description ?? "",
  parameters: withoutAdditionalProperties(t.input_schema as Record<string, unknown>),
}));

function withoutAdditionalProperties(schema: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === "additionalProperties") continue;
    out[key] = value && typeof value === "object" && !Array.isArray(value) ? withoutAdditionalProperties(value as Record<string, unknown>) : value;
  }
  return out;
}

const MAX_TOKENS = 4096;
const RETRY_DELAY_MS = 2000;

function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

export class CompatProvider implements ChatProvider {
  /** Models discovered at runtime not to support tools or images. */
  readonly noTools = new Set<string>();
  readonly noVision = new Set<string>();

  constructor(
    readonly id: ProviderId,
    readonly transport: ChatTransport,
  ) {}

  start(options: MomentOptions): MomentSession {
    return new CompatSession(this, options);
  }

  async complete(options: { model: string; system: string; prompt: string }) {
    let text = "";
    const outcome = await this.transport.stream(
      {
        model: options.model,
        messages: [
          { role: "system", text: options.system },
          { role: "user", text: options.prompt },
        ],
        tools: null,
        json: false,
        maxTokens: MAX_TOKENS,
      },
      (delta) => {
        if (delta.text) text += delta.text;
      },
      AbortSignal.timeout(180_000),
    );
    return { text: stripThinking(text), usage: outcome.usage, model: options.model };
  }
}

class CompatSession implements MomentSession {
  private readonly messages: SimpleMessage[];
  private jsonMode: boolean;
  private lastReply: SimpleMessage | null = null;
  private controller = new AbortController();

  constructor(
    private readonly provider: CompatProvider,
    private readonly options: MomentOptions,
  ) {
    this.jsonMode = provider.noTools.has(options.model);
    this.messages = [
      { role: "system", text: this.systemText() },
      { role: "user", text: options.context },
    ];
  }

  async next(onSay?: (textSoFar: string) => void): Promise<RoundResult> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.request(onSay);
      } catch (err) {
        if (!(err instanceof ProviderError) || attempt >= 2) throw err;
        // Free tiers often answer "high demand" (503) for a moment: try once more
        if (err.kind === "overloaded" && err.status && attempt === 0) {
          log.warn(`${this.provider.id}/${this.options.model} is overloaded (${err.status}): retrying`);
          await pause(RETRY_DELAY_MS, this.controller.signal);
          if (this.controller.signal.aborted) throw new ProviderError("aborted", "Moment interrupted");
          continue;
        }
        if (err.kind !== "bad_request") throw err;
        if (!this.jsonMode && /tool|function/i.test(err.message)) {
          log.warn(`${this.provider.id}/${this.options.model} doesn't support tools: switching to JSON replies`);
          this.provider.noTools.add(this.options.model);
          this.jsonMode = true;
          this.messages[0] = { role: "system", text: this.systemText() };
          continue;
        }
        if (/image|vision|multimodal|modalit/i.test(err.message) && this.dropImages()) {
          log.warn(`${this.provider.id}/${this.options.model} doesn't accept images: retrying without the screenshot`);
          this.provider.noVision.add(this.options.model);
          continue;
        }
        throw err;
      }
    }
  }

  addResults(results: ToolResultIn[]): void {
    if (this.lastReply) this.messages.push(this.lastReply);
    const images = this.provider.noVision.has(this.options.model) ? [] : results.flatMap((r) => r.images);
    const labels = results.flatMap((r) => r.images.map((i) => i.label));
    const blind = this.provider.noVision.has(this.options.model) && labels.length ? " (this model can't see images: the screenshot was not attached)" : "";
    if (this.jsonMode) {
      const lines = results.map((r) => `${r.name}: ${r.text || (r.isError ? "error" : "done")}`).join("\n");
      this.messages.push({
        role: "user",
        text: `Results:\n${lines}${labels.length ? `\nScreenshot: ${labels.join(", ")}${blind}` : ""}\nReply again with the JSON object.`,
        images: images.map((i) => i.jpegBase64),
      });
      return;
    }
    for (const r of results) this.messages.push({ role: "tool", id: r.id, name: r.name, text: r.text || (r.isError ? "Error." : "Done.") });
    // Tool messages can't carry images in these APIs: the screenshot follows as a user message
    if (labels.length) {
      this.messages.push({ role: "user", text: `Screenshot from look_at_screen: ${labels.join(", ")}${blind}`, images: images.map((i) => i.jpegBase64) });
    }
  }

  abort(): void {
    this.controller.abort();
  }

  private systemText(): string {
    return this.jsonMode ? this.options.system + JSON_REPLY_FORMAT : this.options.system;
  }

  private dropImages(): boolean {
    let dropped = false;
    for (const m of this.messages) {
      if (m.role === "user" && m.images?.length) {
        m.images = [];
        m.text += " (this model can't see images: the screenshot was not attached)";
        dropped = true;
      }
    }
    return dropped;
  }

  private async request(onSay?: (textSoFar: string) => void): Promise<RoundResult> {
    if (this.controller.signal.aborted) this.controller = new AbortController();
    let text = "";
    const calls = new Map<number, StreamedCall>();
    const liveSay = () => {
      if (!onSay) return;
      const live = this.jsonMode
        ? partialStringField(stripThinking(text), "say")
        : [...calls.values()]
            .filter((c) => c.name === "say")
            .map((c) => partialStringField(c.args, "text"))
            .filter(Boolean)
            .join("\n\n");
      if (live) onSay(live);
    };
    const outcome = await this.provider.transport.stream(
      { model: this.options.model, messages: this.messages, tools: this.jsonMode ? null : TOOL_SPECS, json: this.jsonMode, maxTokens: MAX_TOKENS },
      (delta) => {
        if (delta.text) {
          text += delta.text;
          if (this.jsonMode) liveSay();
        }
        if (delta.tool) {
          const call = calls.get(delta.tool.index) ?? { id: "", name: "", args: "" };
          if (delta.tool.id) call.id = delta.tool.id;
          if (delta.tool.name) call.name = delta.tool.name;
          if (delta.tool.args) call.args += delta.tool.args;
          if (delta.tool.extra !== undefined) call.extra = delta.tool.extra;
          calls.set(delta.tool.index, call);
          if (call.name === "say") liveSay();
        }
      },
      AbortSignal.any([this.controller.signal, AbortSignal.timeout(this.provider.id === "ollama" ? 300_000 : 120_000)]),
    );

    const stop = (hasCalls: boolean): RoundResult["stop"] =>
      outcome.finish === "content_filter" ? "refused" : outcome.finish === "length" ? "length" : hasCalls ? "tools" : "end";
    if (this.jsonMode) {
      this.lastReply = { role: "assistant", text };
      const toolCalls = parseJsonReply(text);
      return { toolCalls, text: "", stop: stop(toolCalls.length > 0), usage: outcome.usage, model: this.options.model };
    }
    const list = [...calls.values()].filter((c) => c.name).map((c, i) => ({ ...c, id: c.id || `call_${i + 1}` }));
    this.lastReply = { role: "assistant", text, toolCalls: list.length ? list : undefined };
    const toolCalls = list.map((c) => ({ id: c.id, name: c.name, input: parseArgs(c.args) }));
    return { toolCalls, text: stripThinking(text), stop: stop(toolCalls.length > 0), usage: outcome.usage, model: this.options.model };
  }
}

/** Tool arguments arrive as a JSON string; anything unparseable is passed on for validation to reject. */
function parseArgs(args: string): unknown {
  if (!args.trim()) return {};
  try {
    return JSON.parse(args);
  } catch {
    return args;
  }
}

/** Maps an HTTP failure to a provider error. */
export async function httpError(res: Response, service: string): Promise<ProviderError> {
  let detail = "";
  try {
    const body = await res.text();
    try {
      const parsed = JSON.parse(body) as { error?: string | { message?: string } | null; message?: string };
      detail = typeof parsed.error === "string" ? parsed.error : (parsed.error?.message ?? parsed.message ?? body);
    } catch {
      detail = body;
    }
  } catch {
    // no body
  }
  const message = `${service} ${res.status}: ${detail.slice(0, 300) || res.statusText}`;
  const kind =
    res.status === 401
      ? "auth"
      : res.status === 403
        ? "permission"
        : res.status === 404
          ? "not_found"
          : res.status === 429
            ? "rate_limit"
            : res.status >= 500
              ? "overloaded"
              : res.status === 400 || res.status === 422
                ? "bad_request"
                : "unknown";
  return new ProviderError(kind, message, undefined, res.status);
}

/** Maps a fetch failure (no HTTP response) to a provider error. */
export function fetchError(err: unknown, service: string, aborted: boolean): ProviderError {
  if (err instanceof ProviderError) return err;
  if (aborted) return new ProviderError("aborted", `${service}: request aborted`, err);
  const name = err instanceof Error ? err.name : "";
  if (name === "TimeoutError") return new ProviderError("overloaded", `${service}: no answer in time`, err);
  // "fetch failed" hides the real reason (DNS, refused connection, certificate...) in `cause`
  const cause = err instanceof Error && err.cause && typeof err.cause === "object" ? (err.cause as { code?: string; message?: string }) : null;
  const detail = [err instanceof Error ? err.message : String(err), cause?.code ?? cause?.message].filter(Boolean).join(": ");
  return new ProviderError("connection", `${service}: ${detail}`, err);
}

/** Splits a streamed response body into lines. */
export async function* lines(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newline: number;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      yield buffer.slice(0, newline).replace(/\r$/, "");
      buffer = buffer.slice(newline + 1);
    }
  }
  buffer += decoder.decode();
  if (buffer) yield buffer;
}
