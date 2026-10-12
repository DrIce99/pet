// Token and cost accounting with a daily budget.
import type { ProviderId } from "../shared/providers";
import { modelInfo } from "../shared/types";
import { DebouncedWriter, readJson } from "./jsonStore";

export interface UsageDay {
  date: string;
  costUsd: number;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

interface IterationLike {
  model?: string | null;
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  /** Cache writes split by TTL: 1-hour writes cost twice the input price, 5-minute ones 1.25x. */
  cache_creation?: { ephemeral_5m_input_tokens?: number | null; ephemeral_1h_input_tokens?: number | null } | null;
}

/** The subset of the API `usage` object this module reads. */
export interface UsageLike extends IterationLike {
  /** Per-attempt usage when a server-side fallback ran; top-level usage then covers only the last attempt. */
  iterations?: readonly unknown[] | null;
}

const KEEP_DAYS = 31;

export function localDate(d: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export class UsageTracker {
  private days: Record<string, UsageDay>;
  private readonly writer: DebouncedWriter | null;

  constructor(
    file: string | null,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.days = (file && readJson<Record<string, UsageDay>>(file)) || {};
    this.writer = file ? new DebouncedWriter(file, () => this.days) : null;
  }

  /**
   * Adds one response to today's totals and returns its cost in USD. Only
   * Anthropic is priced: the other services are free tiers or run locally.
   */
  record(provider: ProviderId, requestedModel: string, usage: UsageLike | null): number {
    const day = this.today();
    day.requests += 1;
    if (!usage) {
      this.writer?.schedule();
      return 0;
    }
    const parts: IterationLike[] = usage.iterations?.length
      ? usage.iterations.filter((it): it is IterationLike => typeof it === "object" && it !== null)
      : [usage];
    const priced = provider === "anthropic";
    let cost = 0;
    for (const part of parts) {
      const rates = modelInfo(part.model ?? requestedModel);
      const input = part.input_tokens ?? 0;
      const output = part.output_tokens ?? 0;
      const cacheRead = part.cache_read_input_tokens ?? 0;
      const cacheWrite = part.cache_creation_input_tokens ?? 0;
      const write1h = part.cache_creation?.ephemeral_1h_input_tokens ?? 0;
      const writeCost = part.cache_creation
        ? (part.cache_creation.ephemeral_5m_input_tokens ?? 0) * rates.cacheWrite + write1h * rates.input * 2
        : cacheWrite * rates.cacheWrite;
      if (priced) cost += (input * rates.input + output * rates.output + cacheRead * rates.cacheRead + writeCost) / 1e6;
      day.inputTokens += input;
      day.outputTokens += output;
      day.cacheReadTokens += cacheRead;
      day.cacheWriteTokens += cacheWrite;
    }
    day.costUsd += cost;
    this.prune();
    this.writer?.schedule();
    return cost;
  }

  today(): UsageDay {
    const date = localDate(this.now());
    this.days[date] ??= { date, costUsd: 0, requests: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
    return this.days[date];
  }

  /** A budget of 0 means unlimited. */
  overBudget(dailyBudgetUsd: number): boolean {
    return dailyBudgetUsd > 0 && this.today().costUsd >= dailyBudgetUsd;
  }

  flush(): void {
    this.writer?.flush();
  }

  private prune(): void {
    const dates = Object.keys(this.days).sort();
    for (const date of dates.slice(0, Math.max(0, dates.length - KEEP_DAYS))) delete this.days[date];
  }
}
