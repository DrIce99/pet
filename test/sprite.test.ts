import assert from "node:assert/strict";
import test from "node:test";
import { inflateSync } from "node:zlib";
import { encodePng, indexedToRgba } from "../src/main/png";
import { SPECIES, type SpeciesId } from "../src/shared/species";
import { EFFECT_DURATION, iconPixels, paletteFor, PX, renderSprite, silhouetteTop, SPRITE_H, SPRITE_W, type SpriteInput } from "../src/shared/sprite";
import { ANIMATIONS, EMOTIONS, type Locomotion, type OneShotEffect } from "../src/shared/types";

const SPECIES_IDS = Object.keys(SPECIES) as SpeciesId[];

const base = (species: SpeciesId): SpriteInput => ({
  species,
  animation: "idle",
  emotion: "neutral",
  locomotion: "none",
  facing: "right",
  talking: false,
  thinking: false,
  looking: false,
  t: 0,
  clock: 10,
  blink: false,
  look: { x: 0, y: 0 },
  effects: [],
});

test("every species renders every animation, emotion and locomotion", () => {
  const locomotions: Locomotion[] = ["none", "walk", "run", "drag", "fall"];
  for (const species of SPECIES_IDS) {
    for (const animation of ANIMATIONS) {
      for (const emotion of EMOTIONS) {
        for (const locomotion of locomotions) {
          for (const t of [0.4, 1.3]) {
            const frame = renderSprite({ ...base(species), animation, emotion, locomotion, t, clock: 3 + t, talking: t > 1, thinking: t > 1 });
            assert.equal(frame.pixels.length, SPRITE_W * SPRITE_H);
            assert.ok(frame.pixels.includes(PX.outline) && frame.pixels.includes(PX.body), `${species}/${animation}/${emotion}/${locomotion}`);
            assert.ok(frame.lift >= 0 && frame.lift < 12);
          }
        }
      }
    }
  }
});

test("facing left mirrors facing right around the fixed center column", () => {
  for (const species of SPECIES_IDS) {
    const right = renderSprite(base(species)).pixels;
    const left = renderSprite({ ...base(species), facing: "left" }).pixels;
    for (let y = 0; y < SPRITE_H; y++) {
      for (let x = 0; x < SPRITE_W; x++) assert.equal(left[y * SPRITE_W + x], right[y * SPRITE_W + (SPRITE_W - 1 - x)], species);
    }
  }
});

test("one-shot effects draw something and then expire", () => {
  for (const species of SPECIES_IDS) {
    // Same moment with and without the effect, so only the effect can differ
    const plain = renderSprite({ ...base(species), clock: 10.5 }).pixels;
    for (const kind of Object.keys(EFFECT_DURATION) as OneShotEffect[]) {
      const during = renderSprite({ ...base(species), clock: 10.5, effects: [{ kind, start: 10.2 }] }).pixels;
      assert.notDeepEqual(during, plain, `${species}: ${kind} is visible`);
      const after = renderSprite({ ...base(species), clock: 20, effects: [{ kind, start: 10 }] }).pixels;
      assert.deepEqual(after, renderSprite({ ...base(species), clock: 20 }).pixels, `${species}: ${kind} expired`);
    }
  }
});

test("idle pastimes show their props", () => {
  const props: [string, number][] = [
    ["play_ball", PX.yarn],
    ["butterfly", PX.wing],
  ];
  for (const species of SPECIES_IDS) {
    for (const [animation, color] of props) {
      const frame = renderSprite({ ...base(species), animation: animation as SpriteInput["animation"], t: 2 });
      assert.ok(frame.pixels.includes(color), `${species}: ${animation}`);
    }
  }
});

test("Eevee's long ears stand above the cat's", () => {
  assert.ok(silhouetteTop("eevee") < silhouetteTop("cat"));
  assert.ok(silhouetteTop("eevee") > 0);
});

test("tray icons and palettes exist for every species and theme", () => {
  for (const species of SPECIES_IDS) {
    const icon = iconPixels(species);
    assert.equal(icon.length, 256);
    assert.ok(icon.includes(PX.eye) && icon.includes(PX.body));
    for (const theme of Object.keys(SPECIES[species].themes)) {
      const palette = paletteFor(species, theme);
      assert.ok(palette[PX.body].startsWith("#") && palette[PX.none] === "", `${species}/${theme}`);
    }
  }
});

test("PNG encoding produces a valid RGBA image", () => {
  const rgba = indexedToRgba(iconPixels("eevee"), 16, paletteFor("eevee", "classico"), 2);
  assert.equal(rgba.length, 32 * 32 * 4);
  const png = encodePng(32, 32, rgba);
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(png.toString("ascii", 12, 16), "IHDR");
  assert.equal(png.readUInt32BE(16), 32);
  assert.equal(png.readUInt32BE(20), 32);
  const idatLength = png.readUInt32BE(33);
  assert.equal(png.toString("ascii", 37, 41), "IDAT");
  assert.equal(inflateSync(png.subarray(41, 41 + idatLength)).length, 32 * (32 * 4 + 1));
  assert.equal(png.toString("ascii", png.length - 8, png.length - 4), "IEND");
});
