// Runs the brain against the real SDK client with an intercepted fetch, so the
// request the SDK builds and the stream parsing it does are both exercised.
import assert from "node:assert/strict";
import test from "node:test";
import Anthropic from "@anthropic-ai/sdk";
import { Brain, type BrainHost } from "../src/main/brain";
import { AnthropicProvider, sdkStreamer } from "../src/main/providers/anthropic";
import { muteConsole } from "../src/main/log";
import { Memory } from "../src/main/memory";
import { UsageTracker } from "../src/main/usage";
import { DEFAULT_SETTINGS } from "../src/shared/types";

muteConsole();

function sse(events: Record<string, unknown>[]): Response {
  const body = events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

const sayResponse = (fragments: string[]) =>
  sse([
    {
      type: "message_start",
      message: {
        id: "msg_1",
        type: "message",
        role: "assistant",
        model: "claude-opus-5-5",
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 1200, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 2000 },
      },
    },
    { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "", signature: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "c2ln" } },
    { type: "content_block_stop", index: 0 },
    { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "toolu_1", name: "say", input: {} } },
    ...fragments.map((partial_json) => ({ type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json } })),
    { type: "content_block_stop", index: 1 },
    { type: "content_block_start", index: 2, content_block: { type: "tool_use", id: "toolu_2", name: "act", input: {} } },
    { type: "content_block_delta", index: 2, delta: { type: "input_json_delta", partial_json: '{"emotion": "happy"}' } },
    { type: "content_block_stop", index: 2 },
    { type: "message_delta", delta: { stop_reason: "tool_use", stop_sequence: null }, usage: { output_tokens: 60 } },
    { type: "message_stop" },
  ]);

test("the real SDK stream: request shape, live say text and usage", async () => {
  const requests: { url: string; headers: Headers; body: Record<string, unknown> }[] = [];
  const fetch = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    requests.push({ url: String(url), headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) });
    return sayResponse(['{"text": "Ciao', "! Oggi ti vedo", ' in forma, come va?"}']);
  };
  const client = new Anthropic({ apiKey: "sk-ant-test", fetch, maxRetries: 0 });

  const memory = new Memory(null);
  const usage = new UsageTracker(null);
  const live: string[] = [];
  const ended: string[] = [];
  const performed: unknown[] = [];
  const host: BrainHost = {
    settings: () => DEFAULT_SETTINGS,
    memory,
    usage,
    provider: () => ({ provider: new AnthropicProvider(sdkStreamer(client)), model: "claude-opus-5-5" }),
    situation: () => ({
      now: new Date(),
      activity: { idleSec: 1, away: false, locked: false, sessionMinutes: 10, awayMinutes: 0 },
      screens: ["1920x1080 (primary)"],
      petScreen: 1,
      cursorScreen: 1,
      pet: { animation: "idle", emotion: "neutral", affection: 0, daysTogether: 1, petsToday: 0 },
      vision: { enabled: true, minutesSinceLook: null },
      talkativeness: 2,
    }),
    perform: (steps) => performed.push(...steps),
    lookAtScreen: async () => ({ notes: [], images: [] }),
    startSpeech: () => {
      let text = "";
      return {
        append: (delta) => live.push((text += delta)),
        end: (finalText) => ended.push(finalText),
      };
    },
    say: () => assert.fail("replies to the user are streamed, not said at once"),
    setThinking: () => undefined,
    scheduleNextCheck: () => undefined,
    backOff: () => undefined,
  };

  await new Brain(host).handle({ kind: "message", text: "ciao!" });

  assert.equal(requests.length, 1);
  const [request] = requests;
  assert.match(request.url, /\/v1\/messages\?beta=true$/);
  assert.match(request.headers.get("anthropic-beta") ?? "", /server-side-fallback-2026-07-01/);
  assert.equal(request.headers.get("x-api-key"), "sk-ant-test");
  assert.equal(request.body.stream, true);
  assert.equal(request.body.fallbacks, "default");
  assert.equal(request.body.model, "claude-opus-5-5");
  assert.deepEqual(request.body.output_config, { effort: "medium" });
  assert.equal("betas" in request.body, false, "betas travel as a header");

  assert.ok(live.length >= 2, `text should arrive progressively, got ${JSON.stringify(live)}`);
  assert.equal(live.at(-1), "Ciao! Oggi ti vedo in forma, come va?");
  assert.deepEqual(ended, ["Ciao! Oggi ti vedo in forma, come va?"]);
  assert.deepEqual(performed, [{ emotion: "happy", animation: undefined, move: undefined, screen: undefined, seconds: undefined }]);
  assert.equal(usage.today().inputTokens, 1200);
  assert.equal(usage.today().outputTokens, 60);
  assert.equal(usage.today().cacheReadTokens, 2000);
});
