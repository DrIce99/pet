// Speech bubbles. Replies to the user appear immediately; things the pet
// says on its own initiative wait for a pause in the user's typing so they
// don't pop up mid-sentence.
import type { BubbleKind } from "../shared/types";
import type { SpeechHandle } from "./brain";
import type { PetWindow } from "./petWindow";

const PAUSE_SEC = 1.5;
const MAX_WAIT_MS = 20_000;

export function holdTime(text: string, expectsReply: boolean): number {
  return Math.min(45_000, Math.max(6000, 3500 + text.length * 60)) + (expectsReply ? 15_000 : 0);
}

export class Speech {
  private nextId = 1;
  private pending: { text: string; expectsReply: boolean; since: number } | null = null;
  private readonly timer: NodeJS.Timeout;

  constructor(
    private readonly view: PetWindow,
    private readonly idleSec: () => number,
    private readonly silenced: () => boolean,
  ) {
    this.timer = setInterval(() => this.deliverPending(), 500);
  }

  dispose(): void {
    clearInterval(this.timer);
  }

  /** A bubble filled while the text is still being generated. */
  start(): SpeechHandle {
    const id = this.nextId++;
    this.view.bubbleStart({ id, kind: "speech" });
    return {
      append: (delta) => this.view.bubbleChunk({ id, text: delta }),
      end: (finalText, expectsReply) => {
        if (finalText) this.view.bubbleEnd({ id, finalText, holdMs: holdTime(finalText, expectsReply), expectsReply });
        else this.view.bubbleHide();
      },
    };
  }

  say(text: string, options: { spontaneous: boolean; expectsReply: boolean; kind?: BubbleKind }): void {
    if (options.spontaneous) {
      // Only the latest unsaid thought matters
      this.pending = { text, expectsReply: options.expectsReply, since: Date.now() };
      return;
    }
    this.show(text, options.expectsReply, options.kind ?? "speech");
  }

  private deliverPending(): void {
    if (!this.pending) return;
    if (this.idleSec() < PAUSE_SEC && Date.now() - this.pending.since < MAX_WAIT_MS) return;
    const { text, expectsReply } = this.pending;
    this.pending = null;
    if (!this.silenced()) this.show(text, expectsReply, "speech");
  }

  private show(text: string, expectsReply: boolean, kind: BubbleKind): void {
    const id = this.nextId++;
    this.view.bubbleStart({ id, kind });
    this.view.bubbleChunk({ id, text });
    this.view.bubbleEnd({ id, finalText: text, holdMs: holdTime(text, expectsReply), expectsReply });
  }
}
