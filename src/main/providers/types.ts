// Provider-neutral interface between the brain and the AI services.
import type { ProviderId } from "../../shared/providers";
import type { UsageLike } from "../usage";

export type ProviderErrorKind =
  | "auth"
  | "permission"
  | "not_found"
  | "rate_limit"
  | "overloaded"
  | "connection"
  | "bad_request"
  | "aborted"
  | "unknown";

export class ProviderError extends Error {
  constructor(
    readonly kind: ProviderErrorKind,
    message: string,
    readonly cause?: unknown,
    /** HTTP status, when the service answered with an error. */
    readonly status?: number,
  ) {
    super(message);
    this.name = "ProviderError";
  }

  /** The connection was refused because of an untrusted certificate (e.g. a network that inspects HTTPS). */
  get certificate(): boolean {
    return this.kind === "connection" && /CERT|certificate|SSL|TLS/i.test(this.message);
  }
}

export interface ToolCallOut {
  id: string;
  name: string;
  input: unknown;
}

export interface RoundResult {
  toolCalls: ToolCallOut[];
  /** Plain text the model wrote (thinking removed). */
  text: string;
  stop: "end" | "tools" | "length" | "refused";
  /** Token usage when the service reports it. */
  usage: UsageLike | null;
  model: string;
}

export interface ToolResultIn {
  id: string;
  name: string;
  text: string;
  images: { label: string; jpegBase64: string }[];
  isError: boolean;
}

export interface MomentOptions {
  model: string;
  /** Only used by services that support it (Anthropic). */
  effort: "low" | "medium";
  system: string;
  context: string;
}

/** One moment of the pet's life: a request, plus follow-ups after look_at_screen. */
export interface MomentSession {
  /** Runs one request. `onSay` receives the say text written so far, for live bubbles. */
  next(onSay?: (textSoFar: string) => void): Promise<RoundResult>;
  /** Appends the last reply and the tool results, ready for the follow-up request. */
  addResults(results: ToolResultIn[]): void;
  abort(): void;
}

export interface ChatProvider {
  readonly id: ProviderId;
  start(options: MomentOptions): MomentSession;
  /** A single completion without tools (diary summaries, connection tests). */
  complete(options: { model: string; system: string; prompt: string }): Promise<{ text: string; usage: UsageLike | null; model: string }>;
}
