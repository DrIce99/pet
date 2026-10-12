import assert from "node:assert/strict";
import test, { mock } from "node:test";
import type { Body } from "../src/main/body";
import { CursorGame, type Playmate } from "../src/main/play";

/** A pet standing with its feet at (500, 1000), 82x92 pixels. */
function setup() {
  const cursor = { x: 0, y: 0 };
  const leaps: { x: number; y: number }[] = [];
  let land: (jumped: boolean) => void = () => undefined;
  const body = {
    position: () => ({ x: 500, feetY: 1000 }),
    headPoint: () => ({ x: 500, y: 950 }),
    box: () => ({ left: 459, top: 908, right: 541, bottom: 1000 }),
    pawPoint: () => ({ x: 525, y: 950 }),
    isBusy: () => false,
    face: () => undefined,
    leap: (target: { x: number; y: number }) => {
      leaps.push({ ...target });
      return new Promise<boolean>((resolve) => {
        land = resolve;
      });
    },
  } as unknown as Body;
  const calls: string[] = [];
  const pet: Playmate = {
    canPlay: () => true,
    setPlaying: (on) => calls.push(`playing:${on}`),
    play: (animation) => calls.push(`play:${animation}`),
    setEmotion: (emotion) => calls.push(`emotion:${emotion}`),
    effect: (effect) => calls.push(`effect:${effect}`),
  };
  const game = new CursorGame(body, pet, { enabled: () => true, cursor: () => cursor, scale: () => 2 });
  return { cursor, leaps, calls, game, land: (jumped: boolean) => land(jumped) };
}

/** Moves the cursor through `points`, one per game tick. */
function move(cursor: { x: number; y: number }, points: [number, number][]) {
  for (const [x, y] of points) {
    cursor.x = x;
    cursor.y = y;
    mock.timers.tick(60);
  }
}

const wiggle = (y: number, from: number, to: number): [number, number][] =>
  Array.from({ length: 24 }, (_, i) => [i % 8 < 4 ? from + (i % 4) * ((to - from) / 3) : to - (i % 4) * ((to - from) / 3), y]);

test("wiggling the pointer near the pet starts a hunt and a pounce", async () => {
  mock.timers.enable({ apis: ["setInterval", "Date"], now: 1_000_000 });
  try {
    const t = setup();
    t.game.start();
    move(t.cursor, wiggle(880, 600, 700));
    assert.ok(t.calls.includes("play:stalk"), "it crouches to stalk the pointer");
    // Keep the pointer still nearby until it pounces
    move(t.cursor, Array.from({ length: 30 }, () => [640, 880] as [number, number]));
    assert.equal(t.leaps.length, 1);
    assert.deepEqual(t.leaps[0], { x: 640, y: 880 });
    // The pointer ends up between its paws mid-air: caught!
    move(t.cursor, [[530, 945]]);
    t.land(true);
    await Promise.resolve();
    assert.ok(t.calls.includes("effect:sparkles"));
    assert.ok(t.calls.includes("play:celebrate"));
    assert.equal(t.calls.at(-1), "playing:false");
    t.game.stop();
  } finally {
    mock.timers.reset();
  }
});

test("a miss means another try, then the pet gives up", async () => {
  mock.timers.enable({ apis: ["setInterval", "Date"], now: 1_000_000 });
  try {
    const t = setup();
    t.game.start();
    move(t.cursor, wiggle(880, 600, 700));
    for (let attempt = 1; attempt <= 3; attempt++) {
      move(t.cursor, Array.from({ length: 30 }, () => [700, 860] as [number, number]));
      assert.equal(t.leaps.length, attempt);
      t.land(true);
      await Promise.resolve();
    }
    assert.ok(t.calls.includes("play:sit"), "after three misses it sits down");
    assert.ok(!t.calls.includes("effect:sparkles"));
    // Resting: more wiggling right away doesn't start a new game
    move(t.cursor, wiggle(880, 600, 700));
    assert.equal(t.calls.filter((c) => c === "play:stalk").length, 3);
    t.game.stop();
  } finally {
    mock.timers.reset();
  }
});

test("passing by, petting and the taskbar are not games", () => {
  mock.timers.enable({ apis: ["setInterval", "Date"], now: 1_000_000 });
  try {
    const t = setup();
    t.game.start();
    // Straight across, without turning back
    move(
      t.cursor,
      Array.from({ length: 24 }, (_, i) => [350 + i * 15, 900] as [number, number]),
    );
    // Back and forth over the pet: that's petting
    move(t.cursor, wiggle(950, 470, 530));
    // Back and forth below its feet, on the taskbar
    move(t.cursor, wiggle(1020, 560, 700));
    assert.deepEqual(t.calls, []);
    t.game.stop();
  } finally {
    mock.timers.reset();
  }
});
