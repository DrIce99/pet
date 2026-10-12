import assert from "node:assert/strict";
import test from "node:test";
import { parseToolCall, TOOLS } from "../src/main/tools";

test("tool definitions are unique, closed and stream eagerly", () => {
  const names = TOOLS.map((t) => t.name);
  assert.equal(new Set(names).size, names.length);
  assert.equal(names[0], "say");
  for (const t of TOOLS) {
    assert.equal(t.eager_input_streaming, true, t.name);
    assert.equal((t.input_schema as { additionalProperties?: boolean }).additionalProperties, false, t.name);
    assert.ok(t.description && t.description.length > 40, t.name);
  }
});

test("valid inputs are parsed", () => {
  assert.deepEqual(parseToolCall("say", { text: " ciao " }), { name: "say", text: "ciao" });
  const act = parseToolCall("act", { emotion: "happy", move: "other_screen", screen: 2 });
  assert.equal(act?.name, "act");
  assert.equal(act?.name === "act" && act.step.screen, 2);
  assert.deepEqual(parseToolCall("look_at_screen", {}), { name: "look_at_screen", screen: "cursor" });
  assert.deepEqual(parseToolCall("look_at_screen", { screen: "ALL" }), { name: "look_at_screen", screen: "all" });
  assert.deepEqual(parseToolCall("remember", { text: "Ama il caffè", kind: "preference" }), {
    name: "remember",
    text: "Ama il caffè",
    kind: "preference",
  });
  assert.deepEqual(parseToolCall("forget", { id: "f3" }), { name: "forget", id: "f3" });
  assert.deepEqual(parseToolCall("set_reminder", { minutes: 15, text: "Pausa" }), { name: "set_reminder", minutes: 15, text: "Pausa" });
  assert.deepEqual(parseToolCall("schedule_next_check", { minutes: 5 }), { name: "schedule_next_check", minutes: 5 });
});

test("act keeps its valid fields and reports the others", () => {
  const act = parseToolCall("act", { emotion: "curious", animation: "look_around", move: "stay", mood: "x" });
  assert.deepEqual(act, {
    name: "act",
    step: { emotion: undefined, animation: "look_around", move: "stay", screen: undefined, seconds: undefined },
    ignored: ["mood", 'emotion "curious"'],
  });
  const move = parseToolCall("act", { move: "other_screen", screen: 1.5, seconds: 0 });
  assert.deepEqual(move?.name === "act" && [move.step.move, move.step.screen, move.step.seconds, move.ignored], [
    "other_screen",
    undefined,
    undefined,
    ["screen 1.5", "seconds 0"],
  ]);
});

test("invalid inputs are rejected", () => {
  const invalid: [string, unknown][] = [
    ["say", { text: "" }],
    ["say", { text: "ok", mood: "x" }],
    ["say", "ciao"],
    ["say", null],
    ["act", {}],
    ["act", { emotion: "furious" }],
    ["act", { emotion: "curious", mood: "x" }],
    ["remember", { text: "x" }],
    ["remember", { text: "x", kind: "secret" }],
    ["set_reminder", { minutes: 0, text: "x" }],
    ["set_reminder", { minutes: "10", text: "x" }],
    ["schedule_next_check", { minutes: 500 }],
    ["unknown_tool", {}],
  ];
  for (const [name, input] of invalid) assert.equal(parseToolCall(name, input), null, `${name} ${JSON.stringify(input)}`);
});
