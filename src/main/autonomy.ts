// Decides when the pet gets an autonomous moment with Claude. The interval
// follows the talkativeness setting; Claude can move the next moment with
// schedule_next_check, within limits that keep costs predictable.
import type { Talkativeness } from "../shared/types";

/** Typical minutes between autonomous moments, by talkativeness. */
const BASE_MINUTES: Record<Talkativeness, number> = { 0: Infinity, 1: 15, 2: 6, 3: 3 };
/** The earliest Claude may ask to be woken again. */
const MIN_MINUTES: Record<Talkativeness, number> = { 0: Infinity, 1: 5, 2: 2, 3: 1 };

export class Autonomy {
  private nextAt: number;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly talkativeness: () => Talkativeness,
    /** Whether a moment may run now (API available, user present, budget left...). */
    private readonly canRun: () => boolean,
    private readonly run: () => void,
    private readonly now: () => number = () => Date.now(),
  ) {
    this.nextAt = this.now() + 2 * 60_000;
  }

  start(): void {
    this.timer = setInterval(() => this.check(), 10_000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Claude asked for its next moment in `minutes`. */
  scheduleIn(minutes: number): void {
    const t = this.talkativeness();
    const clamped = Math.min(120, Math.max(MIN_MINUTES[t], minutes));
    if (Number.isFinite(clamped)) this.nextAt = this.now() + clamped * 60_000;
  }

  /** Pushes the next moment back (rate limits, outages). */
  backOff(minutes: number): void {
    this.nextAt = Math.max(this.nextAt, this.now() + minutes * 60_000);
  }

  millisUntilNext(): number {
    return this.nextAt - this.now();
  }

  check(): void {
    if (this.now() < this.nextAt) return;
    const base = BASE_MINUTES[this.talkativeness()];
    if (!Number.isFinite(base) || !this.canRun()) {
      this.nextAt = this.now() + 60_000;
      return;
    }
    // Default for the following moment; the run may override it via scheduleIn
    this.nextAt = this.now() + base * (0.75 + Math.random() * 0.5) * 60_000;
    this.run();
  }
}
