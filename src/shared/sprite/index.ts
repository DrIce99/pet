// Procedural pixel-art pets. Pure and DOM-free: the renderer draws the frames
// on a canvas and the main process turns the icons into tray images.
import { themeFor, type SpeciesId } from "../species";
import { CAT_FACE, CAT_ICON, drawCatBody, drawCatPaws } from "./cat";
import { Grid, paletteFor as themePalette, PX, SPRITE_H, SPRITE_W, type Geometry, type Pose, type SpriteFrame, type SpriteInput } from "./core";
import { drawEeveeBody, drawEeveeLimbs, EEVEE_FACE, EEVEE_ICON } from "./eevee";
import { drawEffects } from "./effects";
import { drawFace, type FaceMetrics } from "./face";
import { FACES, poseFor } from "./pose";

export { EFFECT_DURATION, PX, SPRITE_H, SPRITE_W } from "./core";
export type { ActiveEffect, Geometry, SpriteFrame, SpriteInput } from "./core";
export * from "./pack";

interface SpeciesArt {
  body(g: Grid, pose: Pose): Geometry;
  /** Limbs drawn over the face and body. */
  limbs(g: Grid, pose: Pose, geo: Geometry): void;
  face: FaceMetrics;
  icon: Uint8Array;
}

const ART: Record<SpeciesId, SpeciesArt> = {
  cat: { body: drawCatBody, limbs: drawCatPaws, face: CAT_FACE, icon: CAT_ICON },
  eevee: { body: drawEeveeBody, limbs: drawEeveeLimbs, face: EEVEE_FACE, icon: EEVEE_ICON },
};

export function renderSprite(input: SpriteInput, options: { effects?: boolean } = {}): SpriteFrame {
  const art = ART[input.species] ?? ART.cat;
  const pose = poseFor(input);
  const face = { ...FACES[input.emotion] };
  if (pose.eyes) face.eyes = pose.eyes;
  if (pose.mouth) face.mouth = pose.mouth;
  if (input.talking && Math.floor(input.clock / 0.16) % 2 === 0 && face.mouth !== "laugh" && face.mouth !== "yawn") face.mouth = "open";

  const facingRight = (input.facing === "right") !== pose.flip;
  const look = pose.look ?? input.look;
  // Everything is drawn facing right, so screen-space gaze is mirrored when facing left
  const gaze = pose.lookFront ?? { x: facingRight ? look.x : -look.x, y: look.y };

  const grid = new Grid();
  const geo = art.body(grid, pose);
  if (pose.view === "side") {
    drawFace(grid, geo.face.m, geo.face.er, art.face, face, gaze, input.blink);
  } else if (pose.view === "narrow") {
    for (let dy = 0; dy < art.face.eyeH; dy++) grid.set(geo.face.m + 1, geo.face.er + dy, PX.eye);
  }
  art.limbs(grid, pose, geo);
  if (!facingRight) grid.mirror();
  if (options.effects !== false) drawEffects(grid, input, pose, geo, facingRight ? 1 : -1);
  return { pixels: grid.px, lift: pose.lift, geometry: geo };
}

/**
 * Only the effects and props of a moment (hearts, zzz, the ball...), placed
 * with a hand-drawn pack's anchors; drawn over the pack's frame.
 */
export function renderEffects(input: SpriteInput, anchors: Geometry): SpriteFrame {
  const pose = poseFor(input);
  const grid = new Grid();
  drawEffects(grid, input, pose, anchors, input.facing === "right" ? 1 : -1);
  return { pixels: grid.px, lift: pose.lift, geometry: anchors };
}

/** CSS colors for a species' theme, indexed by palette value. */
export function paletteFor(species: SpeciesId, theme: string): string[] {
  return themePalette(themeFor(species, theme).colors);
}

/** Palette-indexed 16x16 face for the tray icon. */
export function iconPixels(species: SpeciesId): Uint8Array {
  return (ART[species] ?? ART.cat).icon;
}

const tops = new Map<SpeciesId, number>();

/** Topmost row of the pet standing still (ear tips), to place the speech bubble above it. */
export function silhouetteTop(species: SpeciesId): number {
  let top = tops.get(species);
  if (top === undefined) {
    const { pixels } = renderSprite({
      species,
      animation: "idle",
      emotion: "neutral",
      locomotion: "none",
      facing: "right",
      talking: false,
      thinking: false,
      looking: false,
      t: 0,
      clock: 0,
      blink: false,
      look: { x: 0, y: 0 },
      effects: [],
    });
    const row = pixels.findIndex((c) => c !== PX.none && c <= PX.mouth);
    top = row < 0 ? 0 : Math.floor(row / SPRITE_W);
    tops.set(species, top);
  }
  return top;
}

export const SPRITE_SIZE = { width: SPRITE_W, height: SPRITE_H };
