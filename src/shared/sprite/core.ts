// Shared building blocks of the procedural pixel art: palette indices, the
// drawing grid, geometry helpers and the types every species uses.
import type { SpeciesTheme } from "../species";
import type { AnimationName, Emotion, Facing, Locomotion, OneShotEffect } from "../types";

export const SPRITE_W = 41;
export const SPRITE_H = 46;
/** Center column; SPRITE_W is odd so mirroring keeps it in place. */
export const CENTER = 20;
export const GROUND = SPRITE_H - 1;

/** Palette indices. Everything up to `mouth` belongs to the pet's body (used for hit testing). */
export const PX = {
  none: 0,
  outline: 1,
  body: 2,
  shade: 3,
  light: 4,
  belly: 5,
  belly2: 6,
  ear: 7,
  eye: 8,
  iris: 9,
  shine: 10,
  blush: 11,
  mouth: 12,
  heart: 13,
  zzz: 14,
  note: 15,
  spark: 16,
  sweat: 17,
  white: 18,
  red: 19,
  yarn: 20,
  wing: 21,
} as const;
export type Color = (typeof PX)[keyof typeof PX];

const EFFECT_COLORS = {
  shine: "#ffffff",
  mouth: "#c8435b",
  heart: "#ff4f7b",
  zzz: "#8fc8ff",
  note: "#8a7cff",
  spark: "#ffd84d",
  sweat: "#7cc6ff",
  white: "#ffffff",
  red: "#ef4452",
  yarn: "#ff6f91",
  wing: "#ffb3e0",
};

/** CSS colors indexed by PX value (index 0 is transparent). */
export function paletteFor(theme: SpeciesTheme): string[] {
  const p = new Array<string>(22).fill("");
  p[PX.outline] = theme.outline;
  p[PX.body] = theme.body;
  p[PX.shade] = theme.shade;
  p[PX.light] = theme.light;
  p[PX.belly] = theme.belly;
  p[PX.belly2] = theme.belly2;
  p[PX.ear] = theme.ear;
  p[PX.eye] = theme.eye;
  p[PX.iris] = theme.iris;
  p[PX.blush] = theme.blush;
  p[PX.shine] = EFFECT_COLORS.shine;
  p[PX.mouth] = EFFECT_COLORS.mouth;
  p[PX.heart] = EFFECT_COLORS.heart;
  p[PX.zzz] = EFFECT_COLORS.zzz;
  p[PX.note] = EFFECT_COLORS.note;
  p[PX.spark] = EFFECT_COLORS.spark;
  p[PX.sweat] = EFFECT_COLORS.sweat;
  p[PX.white] = EFFECT_COLORS.white;
  p[PX.red] = EFFECT_COLORS.red;
  p[PX.yarn] = EFFECT_COLORS.yarn;
  p[PX.wing] = EFFECT_COLORS.wing;
  return p;
}

export type Point = [number, number];
export type ArmPose =
  | "none"
  | "up"
  | "out"
  | "wave_hi"
  | "wave_lo"
  | "face"
  | "face_hi"
  | "scratch_hi"
  | "scratch_lo"
  | "press"
  | "lift"
  /** Climbing, seen from behind: a paw up by the head, or holding on lower down. */
  | "reach"
  | "grip";
export type View = "side" | "narrow" | "back";
export type EyeStyle = "normal" | "big" | "sparkle" | "happy" | "closed" | "sleepy" | "heart" | "wink" | "squint";
export type MouthStyle = "cat" | "smile" | "open" | "laugh" | "frown" | "flat" | "o" | "pout" | "wavy" | "yawn" | "tongue";
export type BrowStyle = "none" | "sad" | "angry" | "raised";
export type Continuous = "zzz" | "notes" | "sparkles" | "question" | "dots" | "lens" | "sweat" | "hearts" | "purr";

/** A small object the pet plays with, positioned relative to the pet and its facing direction. */
export interface Prop {
  kind: "ball" | "butterfly" | "puff";
  /** Columns toward the facing direction from the pet's center (or mouth). */
  x: number;
  /** Rows from the anchor (negative = up). */
  y: number;
  anchor: "ground" | "head" | "mouth";
  frame: number;
}

export interface Pose {
  squash: number;
  dx: number;
  lift: number;
  /** Walk cycle phase 0..3, null when standing still. */
  step: number | null;
  tucked: boolean;
  lying: boolean;
  armL: ArmPose;
  armR: ArmPose;
  tailWag: number;
  tailMode: "up" | "down" | "curl";
  earDroop: number;
  earWiggle: number;
  view: View;
  flip: boolean;
  faceDx: number;
  faceDy: number;
  eyes?: EyeStyle;
  mouth?: MouthStyle;
  /** Gaze in screen terms (mirrored when facing left). */
  look?: { x: number; y: number };
  /** Gaze relative to the facing direction (x > 0 = forward). */
  lookFront?: { x: number; y: number };
  continuous: Continuous[];
  prop?: Prop;
}

export interface Face {
  eyes: EyeStyle;
  mouth: MouthStyle;
  brows: BrowStyle;
  blush: 0 | 1 | 2;
}

/** Where things are, in facing-right coordinates. */
export interface Geometry {
  cx: number;
  /** Top row of the head (below ears and tufts); effects float above it. */
  headTop: number;
  /** Face anchor: center column and top row of the eyes. */
  face: { m: number; er: number };
  mouth: { x: number; y: number };
}

export interface ActiveEffect {
  kind: OneShotEffect;
  /** `clock` value when the effect started. */
  start: number;
}

export interface SpriteInput {
  species: import("../species").SpeciesId;
  animation: AnimationName;
  emotion: Emotion;
  locomotion: Locomotion;
  facing: Facing;
  talking: boolean;
  thinking: boolean;
  looking: boolean;
  /** Seconds since the current animation started. */
  t: number;
  /** Monotonic seconds; drives idle loops and effects. */
  clock: number;
  blink: boolean;
  look: { x: number; y: number };
  effects: ActiveEffect[];
}

export interface SpriteFrame {
  pixels: Uint8Array;
  /** Jump height in sprite pixels; the renderer moves the canvas up. */
  lift: number;
  /** Where the head and mouth are, facing right. */
  geometry: Geometry;
}

export const EFFECT_DURATION: Record<OneShotEffect, number> = {
  hearts: 1.8,
  sparkles: 1.4,
  exclamation: 1.3,
  question: 1.6,
  sweat: 1.6,
  notes: 2,
};

export class Grid {
  readonly px = new Uint8Array(SPRITE_W * SPRITE_H);

  set(x: number, y: number, c: Color): void {
    if (x >= 0 && x < SPRITE_W && y >= 0 && y < SPRITE_H) this.px[y * SPRITE_W + x] = c;
  }

  get(x: number, y: number): number {
    if (x < 0 || x >= SPRITE_W || y < 0 || y >= SPRITE_H) return PX.none;
    return this.px[y * SPRITE_W + x];
  }

  mirror(): void {
    for (let y = 0; y < SPRITE_H; y++) {
      for (let x = 0; x < CENTER; x++) {
        const a = y * SPRITE_W + x;
        const b = y * SPRITE_W + (SPRITE_W - 1 - x);
        const tmp = this.px[a];
        this.px[a] = this.px[b];
        this.px[b] = tmp;
      }
    }
  }

  /**
   * Draws a glyph with a 1px outline. `colors` maps glyph letters to palette
   * entries ('X' when a single color is given). Unless `over` is set, pet
   * pixels are left untouched so the glyph appears behind the pet.
   */
  glyph(rows: string[], x0: number, y0: number, colors: Color | Record<string, Color>, over = false): void {
    const map: Record<string, Color> = typeof colors === "number" ? { X: colors } : colors;
    const own = new Map<string, Color>();
    rows.forEach((row, dy) => {
      for (let dx = 0; dx < row.length; dx++) {
        const c = map[row[dx]];
        if (c !== undefined) own.set(`${x0 + dx},${y0 + dy}`, c);
      }
    });
    const free = (x: number, y: number) => over || this.get(x, y) === PX.none || this.get(x, y) === PX.outline;
    for (const key of own.keys()) {
      const [x, y] = key.split(",").map(Number);
      for (const [nx, ny] of [
        [x + 1, y],
        [x - 1, y],
        [x, y + 1],
        [x, y - 1],
      ]) {
        if (!own.has(`${nx},${ny}`) && (over ? true : this.get(nx, ny) === PX.none)) this.set(nx, ny, PX.outline);
      }
    }
    for (const [key, c] of own) {
      const [x, y] = key.split(",").map(Number);
      if (free(x, y)) this.set(x, y, c);
    }
  }

  /**
   * Paints a limb in front of everything else: the shape is filled and gets
   * its own outline ring, so it reads even over the body.
   */
  limb(inside: (px: number, py: number) => boolean, fill: Color): void {
    const mask = new Uint8Array(SPRITE_W * SPRITE_H);
    for (let y = 0; y < SPRITE_H; y++) {
      for (let x = 0; x < SPRITE_W; x++) if (inside(x + 0.5, y + 0.5)) mask[y * SPRITE_W + x] = 1;
    }
    for (let y = 0; y < SPRITE_H; y++) {
      for (let x = 0; x < SPRITE_W; x++) {
        if (mask[y * SPRITE_W + x]) continue;
        const near =
          (x > 0 && mask[y * SPRITE_W + x - 1]) ||
          (x < SPRITE_W - 1 && mask[y * SPRITE_W + x + 1]) ||
          (y > 0 && mask[(y - 1) * SPRITE_W + x]) ||
          (y < SPRITE_H - 1 && mask[(y + 1) * SPRITE_W + x]);
        if (near) this.set(x, y, PX.outline);
      }
    }
    for (let i = 0; i < mask.length; i++) if (mask[i]) this.px[i] = fill;
  }
}

/** Collects silhouette pixels so a single outline can surround all of them. */
export class Silhouette {
  readonly mask = new Uint8Array(SPRITE_W * SPRITE_H);

  constructor(private readonly grid: Grid) {}

  paint(x: number, y: number, c: Color): void {
    if (x < 0 || x >= SPRITE_W || y < 0 || y >= SPRITE_H) return;
    this.mask[y * SPRITE_W + x] = 1;
    this.grid.set(x, y, c);
  }

  /** Calls `fn` for every pixel center. */
  each(fn: (x: number, y: number, px: number, py: number) => void): void {
    for (let y = 0; y < SPRITE_H; y++) for (let x = 0; x < SPRITE_W; x++) fn(x, y, x + 0.5, y + 0.5);
  }

  /** Draws the 4-neighbour outline around everything painted so far. */
  outline(): void {
    const m = this.mask;
    for (let y = 0; y < SPRITE_H; y++) {
      for (let x = 0; x < SPRITE_W; x++) {
        if (m[y * SPRITE_W + x]) continue;
        const near =
          (x > 0 && m[y * SPRITE_W + x - 1]) ||
          (x < SPRITE_W - 1 && m[y * SPRITE_W + x + 1]) ||
          (y > 0 && m[(y - 1) * SPRITE_W + x]) ||
          (y < SPRITE_H - 1 && m[(y + 1) * SPRITE_W + x]);
        if (near) this.grid.set(x, y, PX.outline);
      }
    }
  }
}

export function segmentDistance(px: number, py: number, a: Point, b: Point): number {
  const vx = b[0] - a[0];
  const vy = b[1] - a[1];
  const len2 = vx * vx + vy * vy || 1;
  const t = Math.max(0, Math.min(1, ((px - a[0]) * vx + (py - a[1]) * vy) / len2));
  return Math.hypot(px - (a[0] + t * vx), py - (a[1] + t * vy));
}

/** Distance to a polyline and how far along it (0..1) the closest point is. */
export function polylineDistance(px: number, py: number, pts: Point[]): { d: number; u: number } {
  let best = { d: Infinity, u: 0 };
  for (let i = 0; i < pts.length - 1; i++) {
    const [a, b] = [pts[i], pts[i + 1]];
    const vx = b[0] - a[0];
    const vy = b[1] - a[1];
    const len2 = vx * vx + vy * vy || 1;
    const t = Math.max(0, Math.min(1, ((px - a[0]) * vx + (py - a[1]) * vy) / len2));
    const d = Math.hypot(px - (a[0] + t * vx), py - (a[1] + t * vy));
    if (d < best.d) best = { d, u: (i + t) / (pts.length - 1) };
  }
  return best;
}

export function inTriangle(px: number, py: number, a: Point, b: Point, c: Point): boolean {
  const s = (p: Point, q: Point) => (px - q[0]) * (p[1] - q[1]) - (p[0] - q[0]) * (py - q[1]);
  const d1 = s(a, b);
  const d2 = s(b, c);
  const d3 = s(c, a);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
}

export function inEllipse(px: number, py: number, cx: number, cy: number, rx: number, ry: number): boolean {
  const nx = (px - cx) / rx;
  const ny = (py - cy) / ry;
  return nx * nx + ny * ny <= 1;
}

/** Parses a 16x16 icon drawn with letters into palette indices. */
export function parseIcon(rows: string[], map: Record<string, Color>): Uint8Array {
  const px = new Uint8Array(16 * 16);
  rows.forEach((row, y) => {
    for (let x = 0; x < 16; x++) px[y * 16 + x] = map[row[x]] ?? PX.none;
  });
  return px;
}
