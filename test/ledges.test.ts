import assert from "node:assert/strict";
import test from "node:test";
import { climbSide, findLedges, landingLedge, ledgeUnder, usableLedges, type WindowBox } from "../src/main/ledges";

const box = (id: string, left: number, top: number, right: number, bottom: number): WindowBox => ({ id, left, top, right, bottom });
const area = { x: 0, y: 0, width: 1920, height: 1040 };

test("windows above hide parts of the edges below them", () => {
  // "front" covers the middle of "back"'s top edge; "low" starts below that edge and hides nothing
  const ledges = findLedges([box("front", 600, 200, 900, 700), box("low", 0, 500, 400, 900), box("back", 300, 300, 1400, 800)]);
  assert.deepEqual(
    ledges.map((l) => [l.id, l.left, l.right, l.y]),
    [
      ["front", 600, 900, 200],
      ["low", 0, 400, 500],
      ["back", 300, 600, 300],
      ["back", 900, 1400, 300],
    ],
  );
});

test("only edges with room for the pet are usable", () => {
  const ledges = findLedges([
    box("maximized", 0, 0, 1920, 1040),
    box("narrow", 100, 400, 150, 800),
    box("near-floor", 300, 1020, 900, 1040),
    box("good", 500, 300, 1100, 900),
  ]);
  const usable = usableLedges(ledges, area, 82, 92);
  assert.deepEqual(
    usable.map((l) => l.id),
    [],
    "the maximized window covers every other edge and has no room above",
  );
  const alone = usableLedges(findLedges([box("narrow", 100, 400, 150, 800), box("near-floor", 300, 1020, 900, 1040), box("good", 500, 300, 1100, 900)]), area, 82, 92);
  assert.deepEqual(
    alone.map((l) => l.id),
    ["good"],
  );
});

test("a window is climbed from its nearest visible side that's on screen", () => {
  const [ledge] = findLedges([box("w", 500, 300, 1100, 900)]);
  assert.equal(climbSide(ledge, area, 82, 200)?.side, "left");
  assert.equal(climbSide(ledge, area, 82, 1500)?.side, "right");
  // Against the left screen edge only the right side can be climbed
  const [edge] = findLedges([box("w", 0, 300, 700, 900)]);
  assert.equal(climbSide(edge, area, 82, 10)?.side, "right");
  // With both corners covered there's nothing to grab
  const [middle] = findLedges([box("a", 400, 100, 600, 500), box("b", 1000, 100, 1200, 500), box("w", 500, 300, 1100, 900)]).filter((l) => l.id === "w");
  assert.equal(climbSide(middle, area, 82, 200), null);
});

test("falling things land on the first edge below them", () => {
  const ledges = findLedges([box("high", 400, 300, 900, 600), box("low", 300, 700, 1000, 1000)]);
  assert.equal(landingLedge(ledges, 600, 100, 1040, 10)?.id, "high");
  assert.equal(landingLedge(ledges, 600, 400, 1040, 10)?.id, "low", "edges above the start are ignored");
  assert.equal(landingLedge(ledges, 350, 100, 1040, 10)?.id, "low");
  assert.equal(landingLedge(ledges, 200, 100, 1040, 10), null);
  assert.equal(ledgeUnder(ledges, "high", 650)?.id, "high");
  assert.equal(ledgeUnder(ledges, "high", 950), null);
});
