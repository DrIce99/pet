import assert from "node:assert/strict";
import test from "node:test";
import { localDate, UsageTracker } from "../src/main/usage";

const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

test("costs use the model's input, output and cache prices", () => {
  const usage = new UsageTracker(null);
  const cost = usage.record("anthropic", "claude-opus-5-5", {
    input_tokens: 1000,
    output_tokens: 500,
    cache_read_input_tokens: 2000,
    cache_creation_input_tokens: 100,
  });
  // $4 in, $20 out, $0.20 cache read, $5 cache write per million tokens
  close(cost, (1000 * 4 + 500 * 20 + 2000 * 0.2 + 100 * 5) / 1e6);
  const today = usage.today();
  assert.equal(today.requests, 1);
  assert.equal(today.cacheReadTokens, 2000);
});

test("1-hour cache writes cost twice the input price", () => {
  const usage = new UsageTracker(null);
  const cost = usage.record("anthropic", "claude-opus-5-5", {
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 3000,
    cache_creation: { ephemeral_5m_input_tokens: 1000, ephemeral_1h_input_tokens: 2000 },
  });
  close(cost, (1000 * 5 + 2000 * 4 * 2) / 1e6);
  assert.equal(usage.today().cacheWriteTokens, 3000);
});

test("fallback iterations are priced with the model that ran them", () => {
  const usage = new UsageTracker(null);
  const cost = usage.record("anthropic", "claude-opus-5-5", {
    input_tokens: 1000,
    output_tokens: 0,
    iterations: [
      { type: "message", model: "claude-opus-5-5", input_tokens: 1000, output_tokens: 0 },
      { type: "fallback_message", model: "claude-haiku-5-5", input_tokens: 1000, output_tokens: 0 },
    ],
  });
  close(cost, (1000 * 4 + 1000 * 0.1) / 1e6);
});

test("the daily budget resets at local midnight and 0 means unlimited", () => {
  let now = new Date("2026-10-12T23:00:00");
  const usage = new UsageTracker(null, () => now);
  usage.record("anthropic", "claude-opus-5-5", { input_tokens: 500_000, output_tokens: 0 });
  assert.equal(usage.overBudget(1), true);
  assert.equal(usage.overBudget(3), false);
  assert.equal(usage.overBudget(0), false);
  now = new Date("2026-10-13T00:30:00");
  assert.equal(usage.overBudget(1), false);
  assert.equal(usage.today().date, "2026-10-13");
});

test("free and local services are counted but cost nothing", () => {
  const usage = new UsageTracker(null);
  assert.equal(usage.record("ollama", "qwen3", { input_tokens: 5000, output_tokens: 300 }), 0);
  assert.equal(usage.record("gemini", "gemini-flash-latest", null), 0);
  assert.equal(usage.today().requests, 2);
  assert.equal(usage.today().inputTokens, 5000);
  assert.equal(usage.overBudget(0.01), false);
});

test("localDate uses the local calendar day", () => {
  assert.equal(localDate(new Date(2026, 0, 5, 23, 59)), "2026-01-05");
});
