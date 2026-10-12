// The mouse pointer as a toy: wiggle it close to the pet and it crouches,
// wiggles its rear and pounces on it. Passing by doesn't count, nor does the
// pointer on the pet itself (that's petting) or below its feet (the taskbar).
// The real pointer is never touched: catching it is just for show.
import type { AnimationName, Emotion, OneShotEffect } from "../shared/types";
import type { Body } from "./body";

export interface Playmate {
  /** Free to play: not sleeping, talking or running a plan. */
  canPlay(): boolean;
  /** While playing, idle instincts wait. */
  setPlaying(playing: boolean): void;
  play(animation: AnimationName, seconds?: number): void;
  setEmotion(emotion: Emotion, holdSec?: number): void;
  effect(effect: OneShotEffect): void;
}

export interface PlayEnv {
  enabled(): boolean;
  cursor(): { x: number; y: number };
  /** Sprite scale: distances grow with the pet. */
  scale(): number;
}

interface Sample {
  t: number;
  x: number;
  y: number;
}

const TICK_MS = 60;
/** How far (at scale 2) the pointer can be and still look like a toy. */
const REACH = 230;
const TEASE_WINDOW_MS = 1200;
const MAX_ATTEMPTS = 3;

export class CursorGame {
  private state: "idle" | "stalk" | "leap" = "idle";
  private samples: Sample[] = [];
  private pounceAt = 0;
  private farSince = 0;
  private attempts = 0;
  private caught = false;
  private restUntil = 0;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly body: Body,
    private readonly pet: Playmate,
    private readonly env: PlayEnv,
  ) {}

  start(): void {
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Something more important happened (dragged, a plan from the brain): stop playing. */
  interrupt(): void {
    if (this.state !== "idle") this.end(8000);
  }

  isPlaying(): boolean {
    return this.state !== "idle";
  }

  private tick(): void {
    const now = Date.now();
    const cursor = this.env.cursor();
    this.samples.push({ t: now, x: cursor.x, y: cursor.y });
    while (this.samples.length && now - this.samples[0].t > TEASE_WINDOW_MS) this.samples.shift();

    switch (this.state) {
      case "idle":
        if (!this.env.enabled() || now < this.restUntil || !this.pet.canPlay() || this.body.isBusy()) return;
        if (this.teased()) this.stalk(now, 700 + Math.random() * 700);
        return;
      case "stalk": {
        if (!this.env.enabled() || this.body.isBusy() || this.overPet(cursor)) {
          this.end(5000);
          return;
        }
        this.body.face(cursor.x);
        if (this.distance(cursor) > this.reach() * 1.5) {
          this.farSince ||= now;
          if (now - this.farSince > 700) this.end(4000);
          return;
        }
        this.farSince = 0;
        if (now >= this.pounceAt) this.pounce(cursor);
        return;
      }
      case "leap": {
        const paw = this.body.pawPoint();
        const k = this.env.scale() / 2;
        if (Math.hypot(cursor.x - paw.x, cursor.y - paw.y) < 34 * k) this.caught = true;
        return;
      }
    }
  }

  /** The pointer has been wiggling near the pet: changing direction, not just passing by. */
  private teased(): boolean {
    if (this.samples.length < 8) return false;
    const k = this.env.scale() / 2;
    const { bottom } = this.body.box();
    let path = 0;
    let turns = 0;
    let lastDir = 0;
    for (let i = 0; i < this.samples.length; i++) {
      const p = this.samples[i];
      if (this.distance(p) > this.reach() || this.overPet(p) || p.y > bottom + 4) return false;
      if (i === 0) continue;
      const q = this.samples[i - 1];
      path += Math.hypot(p.x - q.x, p.y - q.y);
      const move = Math.abs(p.x - q.x) >= Math.abs(p.y - q.y) ? p.x - q.x : p.y - q.y;
      if (Math.abs(move) < 3) continue;
      const dir = Math.sign(move);
      if (lastDir && dir !== lastDir) turns++;
      lastDir = dir;
    }
    return path > 140 * k && turns >= 2;
  }

  private stalk(now: number, wait: number): void {
    this.state = "stalk";
    this.pounceAt = now + wait;
    this.farSince = 0;
    this.pet.setPlaying(true);
    this.pet.play("stalk");
    this.pet.setEmotion("excited", 6);
  }

  private pounce(cursor: { x: number; y: number }): void {
    const k = this.env.scale() / 2;
    const { x, feetY } = this.body.position();
    const reachable = Math.abs(cursor.x - x) < 380 * k && cursor.y < feetY + 6 && cursor.y > feetY - 360 * k;
    if (!reachable) {
      this.pet.play("idle");
      this.end(4000);
      return;
    }
    this.state = "leap";
    this.caught = false;
    this.attempts++;
    this.pet.play("idle");
    void this.body.leap(cursor).then((jumped) => this.landed(jumped));
  }

  private landed(jumped: boolean): void {
    if (this.state !== "leap") return;
    if (!jumped) {
      this.end(5000);
      return;
    }
    if (this.caught) {
      this.pet.effect("sparkles");
      this.pet.setEmotion("proud", 8);
      this.pet.play("celebrate");
      this.end(30_000);
      return;
    }
    const cursor = this.env.cursor();
    if (this.attempts < MAX_ATTEMPTS && this.distance(cursor) < this.reach() * 1.3 && !this.overPet(cursor)) {
      // Missed: one more try, quicker this time
      this.pet.setEmotion("surprised", 1);
      this.stalk(Date.now(), 350 + Math.random() * 450);
      return;
    }
    this.pet.setEmotion(this.attempts >= MAX_ATTEMPTS ? "embarrassed" : "neutral", 4);
    this.pet.play("sit", 15);
    this.end(20_000);
  }

  private end(restMs: number): void {
    this.state = "idle";
    this.attempts = 0;
    this.samples = [];
    this.restUntil = Date.now() + restMs;
    this.pet.setPlaying(false);
  }

  private reach(): number {
    return REACH * (this.env.scale() / 2);
  }

  private distance(p: { x: number; y: number }): number {
    const head = this.body.headPoint();
    return Math.hypot(p.x - head.x, p.y - head.y);
  }

  private overPet(p: { x: number; y: number }): boolean {
    const b = this.body.box();
    return p.x > b.left - 6 && p.x < b.right + 6 && p.y > b.top - 6 && p.y < b.bottom + 6;
  }
}
