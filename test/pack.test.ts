import assert from "node:assert/strict";
import test from "node:test";
import { chooseStrip, FALLBACK, frameAt, LOCOMOTIONS, STRIP_SPECS, stripNames } from "../src/shared/sprite/pack";
import { ANIMATIONS } from "../src/shared/types";

test("every animation and movement has an exported strip, and every fallback ends at idle", () => {
  for (const name of [...ANIMATIONS, ...LOCOMOTIONS, "talk"]) {
    assert.ok(STRIP_SPECS[name], `${name} has a spec`);
    let current: string = name;
    for (let i = 0; current !== "idle"; i++) {
      assert.ok(i < 10 && FALLBACK[current], `${name} falls back to idle (stuck at ${current})`);
      current = FALLBACK[current];
    }
  }
  assert.ok(stripNames().includes("idle_happy"));
  assert.ok(stripNames().includes("sit_sad"));
});

test("the strip shown prefers movement, then talking and emotion variants, then fallbacks", () => {
  const only = (...names: string[]) => (n: string) => names.includes(n);
  const state = { animation: "pounce" as const, locomotion: "none" as const, emotion: "neutral" as const, talking: false };
  assert.equal(chooseStrip(only("idle", "stalk", "pounce"), state), "pounce");
  assert.equal(chooseStrip(only("idle", "sit"), state), "sit", "pounce -> stalk -> sit");
  assert.equal(chooseStrip(only("idle"), state), "idle");
  assert.equal(chooseStrip(only("idle", "walk", "pounce"), { ...state, locomotion: "run" }), "walk", "moving wins over the animation");
  assert.equal(chooseStrip(only("idle", "idle_happy"), { ...state, animation: "idle", emotion: "happy" }), "idle_happy");
  assert.equal(chooseStrip(only("idle", "idle_happy", "talk"), { ...state, animation: "idle", emotion: "happy", talking: true }), "talk");
  assert.equal(chooseStrip(only("idle", "idle_happy"), { ...state, animation: "idle", emotion: "happy", talking: true }), "idle_happy");
});

test("strips loop at their speed", () => {
  const frames = [0, 1, 2].map((n) => new Uint8Array([n]));
  const strip = { fps: 4, frames };
  assert.equal(frameAt(strip, 0)[0], 0);
  assert.equal(frameAt(strip, 0.26)[0], 1);
  assert.equal(frameAt(strip, 0.76)[0], 0, "after the last frame it starts again");
  assert.equal(frameAt(strip, -1)[0], 0);
});
