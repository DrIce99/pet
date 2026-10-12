// What the pet does from moment to moment: runs the plans Claude decides,
// reacts to the mouse, and fills the time in between with small instinctive
// behaviours (wandering, climbing on windows, sitting, sleeping while the
// user is away). This is what keeps the pet alive without spending API calls.
import type { Display } from "electron";
import {
  ANIMATION_DURATION,
  type AnimationName,
  type Emotion,
  type Facing,
  type Locomotion,
  type OneShotEffect,
  type VisualState,
} from "../shared/types";
import type { Body } from "./body";

export const MOVE_TARGETS = ["stay", "left", "right", "center", "random", "to_cursor", "other_screen", "window", "floor"] as const;
export type MoveTarget = (typeof MOVE_TARGETS)[number];

export interface ActStep {
  emotion?: Emotion;
  animation?: AnimationName;
  move?: MoveTarget;
  /** 1-based screen number for move=other_screen. */
  screen?: number;
  /** How long to hold a continuous animation. */
  seconds?: number;
}

export interface BehaviorEnv {
  displays(): Display[];
  cursorDisplay(): Display;
  cursorPoint(): { x: number; y: number };
  activity(): { away: boolean; idleSec: number };
  followCursorScreen(): boolean;
  /** Whether climbing on windows is allowed. */
  climbing(): boolean;
  brainBusy(): boolean;
  send(visual: VisualState): void;
  effect(effect: OneShotEffect): void;
}

const CURSOR_FOLLOW_DELAY_MS = 90_000;

export class Behavior {
  private visual: VisualState = {
    animation: "idle",
    animationSeq: 0,
    emotion: "neutral",
    facing: "right",
    locomotion: "none",
    talking: false,
    thinking: false,
    looking: false,
  };
  private emotionUntil = 0;
  private animationUntil = 0;
  private plan: ActStep[] = [];
  private planRunning = false;
  private generation = 0;
  private nextInstinctAt = Date.now() + 8000;
  private cursorAwaySince: number | null = null;
  private timer: NodeJS.Timeout | null = null;
  /** Sleeping because the user left (as opposed to a nap): wake up when they're back. */
  private awaySleep = false;
  private lastInstinct = "";
  /** Playing with the mouse pointer (see play.ts): instincts wait. */
  private playing = false;

  constructor(
    private readonly body: Body,
    private readonly env: BehaviorEnv,
  ) {}

  start(): void {
    this.env.send(this.visual);
    this.timer = setInterval(() => this.tick(), 500);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  state(): Readonly<VisualState> {
    return this.visual;
  }

  /** Re-sends the full visual state (e.g. after the renderer reloads). */
  resend(): void {
    this.env.send(this.visual);
  }

  setLocomotion(locomotion: Locomotion): void {
    this.update({ locomotion });
  }

  setFacing(facing: Facing): void {
    this.update({ facing });
  }

  setThinking(thinking: boolean): void {
    this.update({ thinking });
  }

  setLooking(looking: boolean): void {
    this.update({ looking });
  }

  effect(effect: OneShotEffect): void {
    this.env.effect(effect);
  }

  setEmotion(emotion: Emotion, holdSec = 20): void {
    this.emotionUntil = Date.now() + holdSec * 1000;
    this.update({ emotion });
  }

  play(animation: AnimationName, seconds?: number): void {
    this.awaySleep = false;
    const hold = ANIMATION_DURATION[animation] ?? (animation === "idle" ? 0 : (seconds ?? 30));
    this.animationUntil = hold ? Date.now() + hold * 1000 : 0;
    this.update({ animation, animationSeq: this.visual.animationSeq + 1 });
  }

  /** Runs a plan from Claude, replacing whatever the pet was doing. */
  perform(steps: ActStep[]): void {
    if (!steps.length) return;
    this.generation++;
    this.plan = [...steps];
    if (!this.body.isHeld()) this.body.stop();
    void this.runPlan(this.generation);
  }

  /** Free to start a game: awake, quiet and not busy with a plan. */
  canPlay(): boolean {
    const v = this.visual;
    return !this.planRunning && !this.playing && v.animation !== "sleep" && !v.talking && !v.thinking && !this.env.brainBusy() && this.body.where() !== "climbing";
  }

  setPlaying(playing: boolean): void {
    this.playing = playing;
    if (!playing) this.nextInstinctAt = Date.now() + 8000;
  }

  // ---- reactions to the user ----

  petted(): void {
    this.effect("hearts");
    if (this.visual.animation !== "sleep") this.setEmotion("love", 6);
  }

  poked(): void {
    if (this.visual.animation === "sleep") {
      this.play("idle");
      this.setEmotion("surprised", 3);
      this.effect("exclamation");
      return;
    }
    this.setEmotion("happy", 5);
  }

  pickedUp(): void {
    this.generation++;
    this.plan = [];
    if (this.visual.animation === "sleep") this.play("idle");
  }

  dropped(): void {
    this.setEmotion("surprised", 2.5);
    this.nextInstinctAt = Date.now() + 6000;
  }

  /** The window under the pet moved away or closed. */
  slipped(): void {
    if (this.visual.animation !== "idle") this.play("idle");
    this.setEmotion("surprised", 3);
    this.effect("exclamation");
    this.nextInstinctAt = Date.now() + 6000;
  }

  wakeUp(): void {
    if (this.visual.animation !== "sleep") return;
    this.play("stretch");
    this.setEmotion("happy", 8);
  }

  // ---- internals ----

  private async runPlan(generation: number): Promise<void> {
    this.planRunning = true;
    try {
      while (this.plan.length && generation === this.generation) {
        const step = this.plan.shift()!;
        if (step.emotion) this.setEmotion(step.emotion, 25);
        if (step.move && step.move !== "stay") {
          await this.moveTo(step.move, step.screen);
          if (generation !== this.generation) return;
        }
        if (step.animation) {
          this.play(step.animation, step.seconds);
          const duration = ANIMATION_DURATION[step.animation];
          if (duration) await sleep(duration * 1000);
        }
      }
    } finally {
      if (generation === this.generation) {
        this.planRunning = false;
        this.nextInstinctAt = Date.now() + 10_000;
      }
    }
  }

  private async moveTo(target: MoveTarget, screenNumber?: number): Promise<boolean> {
    const wa = this.body.currentDisplay().workArea;
    switch (target) {
      case "stay":
        return true;
      case "left":
        return this.body.walkTo(wa.x + wa.width * 0.1, false, true);
      case "right":
        return this.body.walkTo(wa.x + wa.width * 0.9, false, true);
      case "center":
        return this.body.walkTo(wa.x + wa.width / 2, false, true);
      case "random":
        // On a window this is a stroll along its edge
        return this.body.walkTo(wa.x + wa.width * (0.1 + Math.random() * 0.8));
      case "to_cursor": {
        const display = this.env.cursorDisplay();
        if (display.id !== this.body.currentDisplay().id && !(await this.body.goToDisplay(display))) return false;
        return this.body.walkTo(this.env.cursorPoint().x, true, true);
      }
      case "window":
        return this.body.climbWindow();
      case "floor":
        return this.body.getDown();
      case "other_screen": {
        const displays = this.env.displays();
        if (displays.length < 2) return false;
        const current = displays.findIndex((d) => d.id === this.body.currentDisplay().id);
        const index = screenNumber ? screenNumber - 1 : (current + 1) % displays.length;
        return this.body.goToDisplay(displays[Math.min(Math.max(index, 0), displays.length - 1)]);
      }
    }
  }

  private tick(): void {
    const now = Date.now();
    if (this.emotionUntil && now > this.emotionUntil) {
      this.emotionUntil = 0;
      this.update({ emotion: this.baselineEmotion() });
    }
    if (this.animationUntil && now > this.animationUntil) {
      this.animationUntil = 0;
      this.update({ animation: "idle", animationSeq: this.visual.animationSeq + 1 });
    }
    if (this.planRunning || this.playing || this.body.isBusy() || this.env.brainBusy()) return;

    const { away } = this.env.activity();
    if (away) {
      if (this.visual.animation !== "sleep") {
        this.play("sleep", 12 * 3600);
        this.awaySleep = true;
      }
      return;
    }
    if (this.visual.animation === "sleep" && this.awaySleep) {
      this.wakeUp();
      return;
    }
    if (this.followCursorScreen(now)) return;
    if (now < this.nextInstinctAt || this.animationUntil) return;
    this.nextInstinctAt = now + 7000 + Math.random() * 16000;
    this.randomInstinct();
  }

  /** Picks something to do, weighted by the time of day and what the user is doing. */
  private randomInstinct(): void {
    const hour = new Date().getHours();
    const late = hour >= 22 || hour < 6;
    const { idleSec } = this.env.activity();
    // The user paused (reading, thinking) but is still there
    const calm = idleSec > 60;
    const sameScreen = this.env.cursorDisplay().id === this.body.currentDisplay().id;
    const rnd = (min: number, max: number) => min + Math.random() * (max - min);
    const playful = late ? 0.4 : 1;
    const sleepy = late ? 3 : calm ? 1.5 : 1;

    // Up on a window the pet mostly lounges and enjoys the view
    const perched = this.body.where() === "window";
    const lounge = perched ? 2.5 : 1;
    const settleOnTop = () => this.play(Math.random() < 0.5 ? "sit" : "lie", rnd(20, 60));

    const options: [string, number, () => void][] = [
      ["walk", (perched ? 8 : 30) * playful, () => void this.body.walkTo(this.body.position().x + (Math.random() < 0.5 ? -1 : 1) * rnd(60, 320))],
      ["to_cursor", sameScreen && !perched ? 5 : 0, () => void this.body.walkTo(this.env.cursorPoint().x)],
      ["climb", !perched && this.env.climbing() && this.body.canClimb() ? 6 * playful : 0, () => {
        void this.body.climbWindow().then((ok) => ok && settleOnTop());
      }],
      ["get_down", perched ? 4 : 0, () => void this.body.getDown()],
      ["sit", 7 * sleepy * lounge, () => this.play("sit", rnd(10, 40))],
      ["lie", 4 * sleepy * lounge, () => this.play("lie", rnd(15, 50))],
      ["nap", 2 * sleepy * lounge, () => this.play("sleep", rnd(25, 70))],
      ["yawn", 3 * sleepy, () => this.play("yawn")],
      ["look_around", 5 * lounge, () => this.play("look_around")],
      ["stretch", 3, () => this.play("stretch")],
      ["groom", 5 * (calm ? 1.5 : 1), () => this.play("groom")],
      ["scratch", 4, () => this.play("scratch")],
      ["knead", 3 * (calm ? 2 : 1), () => this.play("knead")],
      ["wag", 3, () => this.play("wag")],
      ["peek", 3, () => this.play("peek")],
      ["sing", 2, () => this.play("sing")],
      ["sneeze", 1, () => this.play("sneeze")],
      ["jump", 3 * playful, () => this.play("jump")],
      ["hop", 3 * playful, () => this.play("hop")],
      ["chase_tail", 3 * playful, () => this.play("chase_tail")],
      ["pounce", 3 * playful, () => this.play("pounce")],
      ["roll", 3 * playful, () => this.play("roll")],
      ["play_ball", 4 * playful, () => {
        this.play("play_ball");
        this.setEmotion("excited", 5);
      }],
      ["butterfly", 4 * playful, () => {
        this.play("butterfly");
        this.setEmotion("excited", 6);
      }],
    ];
    const available = options.filter(([name, weight]) => weight > 0 && name !== this.lastInstinct);
    let pick = Math.random() * available.reduce((sum, [, weight]) => sum + weight, 0);
    for (const [name, weight, run] of available) {
      pick -= weight;
      if (pick <= 0) {
        this.lastInstinct = name;
        run();
        return;
      }
    }
  }

  /** Follows the user to the screen they've been using for a while. Returns true if it started moving. */
  private followCursorScreen(now: number): boolean {
    if (!this.env.followCursorScreen() || this.env.displays().length < 2) return false;
    const cursorDisplay = this.env.cursorDisplay();
    if (cursorDisplay.id === this.body.currentDisplay().id) {
      this.cursorAwaySince = null;
      return false;
    }
    this.cursorAwaySince ??= now;
    if (now - this.cursorAwaySince < CURSOR_FOLLOW_DELAY_MS) return false;
    this.cursorAwaySince = null;
    void this.body.goToDisplay(cursorDisplay);
    return true;
  }

  private baselineEmotion(): Emotion {
    const hour = new Date().getHours();
    return hour >= 23 || hour < 6 ? "sleepy" : "neutral";
  }

  private update(patch: Partial<VisualState>): void {
    let changed = false;
    for (const key of Object.keys(patch) as (keyof VisualState)[]) {
      if (this.visual[key] !== patch[key]) changed = true;
    }
    if (!changed) return;
    this.visual = { ...this.visual, ...patch };
    this.env.send(this.visual);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
