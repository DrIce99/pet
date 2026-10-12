// Hand-drawn sprite packs. A pack is a folder of PNG strips, one per
// animation, with frames of SPRITE_W x SPRITE_H side by side, drawn facing
// right (the app mirrors them). Missing strips fall back to similar ones, so
// a pack works with "idle" alone. Effects and props (hearts, zzz, the ball...)
// are still drawn by the app, positioned with the pack's anchors.
import { ANIMATIONS, EMOTIONS, type AnimationName, type Emotion, type Locomotion } from "../types";
import type { Geometry } from "./core";

export const LOCOMOTIONS = ["walk", "run", "drag", "fall", "climb", "leap"] as const satisfies readonly Exclude<Locomotion, "none">[];

/** Frames and speed of each strip in an exported pack (also the default speed when loading). */
export const STRIP_SPECS: Record<string, { frames: number; fps: number }> = {
  // moving around
  walk: { frames: 4, fps: 8 },
  run: { frames: 4, fps: 14 },
  drag: { frames: 4, fps: 10 },
  fall: { frames: 1, fps: 1 },
  climb: { frames: 2, fps: 5 },
  leap: { frames: 1, fps: 1 },
  // animations
  idle: { frames: 4, fps: 2 },
  sit: { frames: 2, fps: 1.5 },
  lie: { frames: 2, fps: 1 },
  sleep: { frames: 2, fps: 1 },
  jump: { frames: 6, fps: 5.5 },
  dance: { frames: 8, fps: 4 },
  wave: { frames: 2, fps: 4 },
  spin: { frames: 8, fps: 6.67 },
  stretch: { frames: 6, fps: 2.3 },
  celebrate: { frames: 6, fps: 5 },
  nod: { frames: 2, fps: 5 },
  shake_head: { frames: 4, fps: 6.67 },
  think: { frames: 2, fps: 2.5 },
  look_around: { frames: 3, fps: 1 },
  yawn: { frames: 5, fps: 2.27 },
  groom: { frames: 2, fps: 3.33 },
  scratch: { frames: 2, fps: 11 },
  chase_tail: { frames: 8, fps: 10 },
  pounce: { frames: 8, fps: 3.64 },
  roll: { frames: 4, fps: 4 },
  hop: { frames: 3, fps: 5 },
  knead: { frames: 2, fps: 2.86 },
  wag: { frames: 2, fps: 6 },
  peek: { frames: 4, fps: 1.6 },
  play_ball: { frames: 6, fps: 1.33 },
  butterfly: { frames: 5, fps: 1 },
  sneeze: { frames: 4, fps: 2.9 },
  sing: { frames: 4, fps: 4 },
  stalk: { frames: 6, fps: 12.5 },
  // optional extras: mouth moving while talking, faces for each emotion
  talk: { frames: 2, fps: 6.25 },
};

/** Frames of the optional `<animation>_<emotion>` strips in an exported pack (only for idle). */
export const EMOTION_FRAMES = 2;

/** What to show when a strip is missing; every chain ends at idle, the only required strip. */
export const FALLBACK: Record<string, string> = {
  run: "walk",
  walk: "idle",
  drag: "fall",
  fall: "jump",
  leap: "jump",
  climb: "walk",
  jump: "hop",
  hop: "idle",
  sit: "idle",
  lie: "sleep",
  sleep: "sit",
  dance: "hop",
  wave: "idle",
  spin: "idle",
  stretch: "idle",
  celebrate: "jump",
  nod: "idle",
  shake_head: "idle",
  think: "sit",
  look_around: "idle",
  yawn: "sit",
  groom: "sit",
  scratch: "sit",
  chase_tail: "spin",
  pounce: "stalk",
  stalk: "sit",
  roll: "lie",
  knead: "sit",
  wag: "idle",
  peek: "idle",
  play_ball: "idle",
  butterfly: "idle",
  sneeze: "idle",
  sing: "sit",
  talk: "idle",
};

/** Every strip name a pack may contain. */
export function stripNames(): string[] {
  const base = [...LOCOMOTIONS, ...ANIMATIONS, "talk"];
  const emotional = [...ANIMATIONS, "talk"].flatMap((a) => EMOTIONS.filter((e) => e !== "neutral").map((e) => `${a}_${e}`));
  return [...base, ...emotional];
}

export interface PackStrip {
  fps: number;
  /** RGBA frames of SPRITE_W x SPRITE_H, facing right. */
  frames: Uint8Array[];
}

/** A loaded pack, as sent to the pet window. */
export interface SpritePack {
  name: string;
  strips: Record<string, PackStrip>;
  /** Where effects go (the same geometry the drawn sprites report), facing right. */
  anchors: Geometry;
}

/** The strip to show: the moving one when moving, emotion and talking variants first, then the fallbacks. */
export function chooseStrip(
  has: (name: string) => boolean,
  state: { animation: AnimationName; locomotion: Locomotion; emotion: Emotion; talking: boolean },
): string {
  let name: string = state.locomotion !== "none" ? state.locomotion : state.talking && state.animation === "idle" ? "talk" : state.animation;
  for (let guard = 0; guard < 12; guard++) {
    if (state.emotion !== "neutral" && has(`${name}_${state.emotion}`)) return `${name}_${state.emotion}`;
    if (has(name)) return name;
    const next = FALLBACK[name];
    if (!next) break;
    name = next;
  }
  return "idle";
}

/** The frame of a strip at a given time (strips loop). */
export function frameAt(strip: PackStrip, seconds: number): Uint8Array {
  const i = Math.floor(Math.max(0, seconds) * strip.fps) % strip.frames.length;
  return strip.frames[i];
}
