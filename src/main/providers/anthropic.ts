// Claude through the Anthropic SDK: streaming, eager tool input streaming,
// prompt caching and server-side refusal fallbacks.
import Anthropic from "@anthropic-ai/sdk";
import type { BetaMessageStreamParams } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { modelInfo } from "../../shared/types";
import { log } from "../log";
import { TOOLS } from "../tools";
import { partialStringField } from "./text";
import { ProviderError, type ChatProvider, type MomentOptions, type MomentSession, type RoundResult, type ToolResultIn } from "./types";

type BetaMessage = Anthropic.Beta.BetaMessage;
type BetaMessageParam = Anthropic.Beta.BetaMessageParam;
type BetaContentBlock = Anthropic.Beta.BetaContentBlock;
type BetaContentBlockParam = Anthropic.Beta.BetaContentBlockParam;
type BetaToolUseBlock = Anthropic.Beta.BetaToolUseBlock;
type BetaToolResultBlockParam = Anthropic.Beta.BetaToolResultBlockParam;
export type StreamParams = BetaMessageStreamParams;
type Effort = "low" | "medium" | "high";

/** The slice of the SDK's BetaMessageStream used here; tests substitute a fake. */
export interface MessageStreamLike {
  on(event: "streamEvent", listener: (event: unknown, snapshot: BetaMessage) => void): unknown;
  finalMessage(): Promise<BetaMessage>;
  abort(): void;
}

export interface Streamer {
  stream(params: StreamParams): MessageStreamLike;
}

export function sdkStreamer(client: Anthropic): Streamer {
  return { stream: (params) => client.beta.messages.stream(params) };
}

const FALLBACK_BETA = "server-side-fallback-2026-07-01";
// Blocks that must not be echoed back from before a mid-output fallback
const DROP_BEFORE_FALLBACK = new Set(["thinking", "redacted_thinking", "tool_use", "server_tool_use"]);

export function requestParams(model: string, effort: Effort, system: string, messages: BetaMessageParam[], withTools = true): StreamParams {
  return {
    model,
    max_tokens: 16000,
    // Moments are minutes apart, beyond the default 5-minute cache lifetime:
    // the 1-hour TTL turns most of them into cheap cache reads.
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral", ttl: "1h" } }],
    ...(withTools ? { tools: TOOLS } : {}),
    messages,
    output_config: { effort },
    // Server-side refusal fallback: a classifier decline is retried on the model
    // Anthropic recommends for that category instead of failing the moment.
    ...(modelInfo(model).serverFallback ? { betas: [FALLBACK_BETA], fallbacks: "default" as const } : {}),
  };
}

export class AnthropicProvider implements ChatProvider {
  readonly id = "anthropic" as const;

  constructor(private readonly streamer: Streamer) {}

  start(options: MomentOptions): MomentSession {
    return new AnthropicSession(this.streamer, options);
  }

  async complete(options: { model: string; system: string; prompt: string }) {
    try {
      const message = await this.streamer
        .stream(requestParams(options.model, "low", options.system, [{ role: "user", content: options.prompt }], false))
        .finalMessage();
      const text = message.stop_reason === "refusal" ? "" : textOf(afterLastFallback(message.content));
      return { text, usage: message.usage, model: options.model };
    } catch (err) {
      throw toProviderError(err);
    }
  }
}

class AnthropicSession implements MomentSession {
  private readonly messages: BetaMessageParam[];
  private last: BetaMessage | null = null;
  private current: MessageStreamLike | null = null;

  constructor(
    private readonly streamer: Streamer,
    private readonly options: MomentOptions,
  ) {
    this.messages = [{ role: "user", content: options.context }];
  }

  async next(onSay?: (textSoFar: string) => void): Promise<RoundResult> {
    const { model, effort, system } = this.options;
    let message: BetaMessage | null = null;
    for (let attempt = 0; !message; attempt++) {
      const stream = this.streamer.stream(requestParams(model, effort, system, this.messages));
      this.current = stream;
      if (onSay) {
        // The SDK parses a tool input only when its block ends, so collect the
        // raw JSON fragments of say blocks and read the partial text from them.
        const sayJson = new Map<number, string>();
        stream.on("streamEvent", (event) => {
          const e = event as StreamEventLike;
          const index = e.index ?? -1;
          if (e.type === "content_block_start" && e.content_block?.type === "tool_use" && e.content_block.name === "say") {
            sayJson.set(index, "");
            return;
          }
          if (e.type !== "content_block_delta" || e.delta?.type !== "input_json_delta" || !sayJson.has(index)) return;
          sayJson.set(index, sayJson.get(index) + (e.delta.partial_json ?? ""));
          const live = [...sayJson.values()]
            .map((json) => partialStringField(json, "text"))
            .filter(Boolean)
            .join("\n\n");
          if (live) onSay(live);
        });
      }
      try {
        message = await stream.finalMessage();
      } catch (err) {
        // With eager input streaming the SDK rejects on tool input JSON it
        // cannot parse; re-issue that request a couple of times. API errors
        // (aborts included) are not retried here.
        if (err instanceof Anthropic.APIError || attempt >= 2) throw toProviderError(err);
        log.warn("Tool input was not parseable JSON, re-issuing the request", err);
      } finally {
        this.current = null;
      }
    }
    this.last = message;
    if (message.stop_reason === "refusal") {
      log.warn(`Request declined (${message.stop_details?.category ?? "no category"})`);
      return { toolCalls: [], text: "", stop: "refused", usage: message.usage, model };
    }
    const content = afterLastFallback(message.content);
    const toolCalls = content
      .filter((b): b is BetaToolUseBlock => b.type === "tool_use")
      .map((b) => ({ id: b.id, name: b.name, input: b.input }));
    return {
      toolCalls,
      text: textOf(content),
      stop: message.stop_reason === "max_tokens" ? "length" : toolCalls.length ? "tools" : "end",
      usage: message.usage,
      model,
    };
  }

  addResults(results: ToolResultIn[]): void {
    if (!this.last) return;
    this.messages.push({ role: "assistant", content: replayable(this.last.content) });
    this.messages.push({
      role: "user",
      content: results.map((r): BetaToolResultBlockParam => {
        const base = { type: "tool_result" as const, tool_use_id: r.id, ...(r.isError ? { is_error: true } : {}) };
        if (!r.images.length) return { ...base, content: r.text };
        return {
          ...base,
          content: [
            // The API rejects empty text blocks
            ...(r.text ? [{ type: "text" as const, text: r.text }] : []),
            ...r.images.flatMap((image) => [
              { type: "text" as const, text: image.label },
              { type: "image" as const, source: { type: "base64" as const, media_type: "image/jpeg" as const, data: image.jpegBase64 } },
            ]),
          ],
        };
      }),
    });
  }

  abort(): void {
    this.current?.abort();
  }
}

export function toProviderError(err: unknown): ProviderError {
  if (err instanceof ProviderError) return err;
  const message = err instanceof Error ? err.message : String(err);
  if (err instanceof Anthropic.APIUserAbortError) return new ProviderError("aborted", message, err);
  if (err instanceof Anthropic.AuthenticationError) return new ProviderError("auth", message, err);
  if (err instanceof Anthropic.PermissionDeniedError) return new ProviderError("permission", message, err);
  if (err instanceof Anthropic.NotFoundError) return new ProviderError("not_found", message, err);
  if (err instanceof Anthropic.RateLimitError) return new ProviderError("rate_limit", message, err);
  if (err instanceof Anthropic.BadRequestError) return new ProviderError("bad_request", message, err);
  if (err instanceof Anthropic.InternalServerError) return new ProviderError("overloaded", message, err);
  if (err instanceof Anthropic.APIConnectionError) return new ProviderError("connection", message, err);
  return new ProviderError("unknown", message, err);
}

/** The fields of raw stream events that live speech reads. */
interface StreamEventLike {
  type: string;
  index?: number;
  content_block?: { type: string; name?: string };
  delta?: { type: string; partial_json?: string };
}

function textOf(content: BetaContentBlock[]): string {
  return content
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("")
    .trim();
}

/** Blocks produced by the model that finally served the response (after the last fallback switch). */
function afterLastFallback(content: BetaContentBlock[]): BetaContentBlock[] {
  const last = content.map((b) => b.type).lastIndexOf("fallback");
  return last < 0 ? content : content.slice(last + 1);
}

/** Assistant content to echo back in the next request of the same moment. */
function replayable(content: BetaContentBlock[]): BetaContentBlockParam[] {
  const last = content.map((b) => b.type).lastIndexOf("fallback");
  const kept = content.filter((b, i) => b.type !== "fallback" && !(i < last && DROP_BEFORE_FALLBACK.has(b.type)));
  return kept as BetaContentBlockParam[];
}
