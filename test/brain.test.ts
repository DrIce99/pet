import assert from "node:assert/strict";
import test from "node:test";
import Anthropic from "@anthropic-ai/sdk";
import type { ActStep } from "../src/main/behavior";
import { Brain, type BrainHost } from "../src/main/brain";
import { AnthropicProvider, requestParams, type MessageStreamLike, type StreamParams, type Streamer } from "../src/main/providers/anthropic";
import { partialStringField } from "../src/main/providers/text";
import { Memory } from "../src/main/memory";
import type { Situation } from "../src/main/prompt";
import { UsageTracker } from "../src/main/usage";
import { DEFAULT_SETTINGS, type Settings } from "../src/shared/types";
import { muteConsole } from "../src/main/log";

muteConsole();

type Block = Record<string, unknown>;
interface Step {
  content?: Block[];
  stop_reason?: string;
  error?: Error;
  /** Never resolves until aborted. */
  hang?: boolean;
}

const say = (id: string, text: string): Block => ({ type: "tool_use", id, name: "say", input: { text } });
const tool = (id: string, name: string, input: unknown): Block => ({ type: "tool_use", id, name, input });

function message(step: Step, content = step.content ?? []): Anthropic.Beta.BetaMessage {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-opus-5-5",
    content,
    stop_reason: step.stop_reason ?? (content.some((b) => b.type === "tool_use") ? "tool_use" : "end_turn"),
    stop_details: null,
    usage: { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, iterations: null },
  } as unknown as Anthropic.Beta.BetaMessage;
}

/** Replays scripted responses and streams say inputs in fragments, like eager input streaming. */
class FakeStreamer implements Streamer {
  readonly requests: StreamParams[] = [];
  constructor(private readonly script: Step[]) {}

  stream(params: StreamParams): MessageStreamLike {
    this.requests.push(structuredClone(params));
    const step = this.script.shift();
    if (!step) throw new Error("Unexpected request");
    let listener: ((event: unknown, snapshot: Anthropic.Beta.BetaMessage) => void) | null = null;
    let abort: () => void = () => undefined;
    return {
      on(_event: "streamEvent", l: (event: unknown, snapshot: Anthropic.Beta.BetaMessage) => void) {
        listener = l;
        return this;
      },
      abort: () => abort(),
      finalMessage: async () => {
        if (step.hang) {
          return new Promise<Anthropic.Beta.BetaMessage>((_resolve, reject) => {
            abort = () => reject(new Anthropic.APIUserAbortError());
          });
        }
        if (step.error) throw step.error;
        // Raw events as the API sends them: tool inputs arrive as JSON fragments
        const snapshot = message(step);
        (step.content ?? []).forEach((block, index) => {
          const start = block.type === "tool_use" ? { ...block, input: {} } : block;
          listener?.({ type: "content_block_start", index, content_block: start }, snapshot);
          if (block.type === "tool_use") {
            const json = JSON.stringify(block.input);
            for (let i = 0; i < json.length; i += 5) {
              listener?.({ type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: json.slice(i, i + 5) } }, snapshot);
            }
          }
          listener?.({ type: "content_block_stop", index }, snapshot);
        });
        await new Promise((resolve) => setTimeout(resolve, 0));
        return snapshot;
      },
    };
  }
}

const situation: Situation = {
  now: new Date("2026-10-12T10:00:00"),
  activity: { idleSec: 3, away: false, locked: false, sessionMinutes: 42, awayMinutes: 0 },
  screens: ["1920x1080 (primary)"],
  petScreen: 1,
  cursorScreen: 1,
  pet: { animation: "idle", emotion: "neutral", affection: 3, daysTogether: 2, petsToday: 1 },
  vision: { enabled: true, minutesSinceLook: null },
  talkativeness: 2,
};

function setup(script: Step[] | null, overrides: Partial<Settings> = {}, memory = new Memory(null)) {
  const usage = new UsageTracker(null);
  const streamer = script ? new FakeStreamer(script) : null;
  const settings: Settings = { ...DEFAULT_SETTINGS, ...overrides };
  const record = {
    performed: [] as ActStep[][],
    said: [] as { text: string; spontaneous: boolean }[],
    live: [] as string[],
    liveEnd: [] as string[],
    thinking: [] as boolean[],
    scheduled: [] as number[],
    backOff: [] as number[],
    looks: [] as { which: string; byUser: boolean }[],
  };
  const host: BrainHost = {
    settings: () => settings,
    memory,
    usage,
    provider: (purpose) =>
      streamer ? { provider: new AnthropicProvider(streamer), model: purpose === "chat" ? settings.chatModel : settings.autonomousModel } : null,
    situation: () => situation,
    perform: (steps) => record.performed.push(steps),
    lookAtScreen: async (which, byUser) => {
      record.looks.push({ which, byUser });
      return { notes: [], images: [{ label: "Screen 1 (primary), 1280x720", jpegBase64: "QUJD" }] };
    },
    startSpeech: () => {
      let text = "";
      return {
        append: (delta) => {
          text += delta;
          record.live.push(text);
        },
        end: (finalText) => record.liveEnd.push(finalText),
      };
    },
    say: (text, options) => record.said.push({ text, spontaneous: options.spontaneous }),
    setThinking: (thinking) => record.thinking.push(thinking),
    scheduleNextCheck: (minutes) => record.scheduled.push(minutes),
    backOff: (minutes) => record.backOff.push(minutes),
  };
  return { brain: new Brain(host), streamer, memory, usage, record, settings };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test("a user message streams the say text live and runs the body actions", async () => {
  const { brain, streamer, memory, usage, record } = setup([
    {
      content: [
        { type: "thinking", thinking: "", signature: "sig" },
        say("s1", "Ciao Diego! Tutto bene oggi?"),
        tool("a1", "act", { emotion: "happy", animation: "wave" }),
      ],
    },
  ]);
  await brain.handle({ kind: "message", text: "ciao Mochi" });

  assert.equal(streamer!.requests.length, 1);
  assert.ok(record.live.length > 1, "the bubble fills progressively");
  assert.equal(record.live.at(-1), "Ciao Diego! Tutto bene oggi?");
  assert.deepEqual(record.liveEnd, ["Ciao Diego! Tutto bene oggi?"]);
  assert.equal(record.said.length, 0);
  assert.equal(record.performed.length, 1);
  assert.equal(record.performed[0][0].emotion, "happy");
  assert.equal(record.performed[0][0].animation, "wave");
  assert.deepEqual(
    memory.recentConversation(10).map((e) => [e.who, e.text]),
    [
      ["user", "ciao Mochi"],
      ["pet", "Ciao Diego! Tutto bene oggi?"],
    ],
  );
  assert.equal(usage.today().requests, 1);
  assert.equal(record.thinking[0], true);
  assert.equal(record.thinking.at(-1), false);
});

test("request shape: cached system prompt, eager tools, effort and default fallbacks", async () => {
  const { brain, streamer } = setup([{ content: [say("s1", "Eccomi")] }]);
  await brain.handle({ kind: "message", text: "ehi" });
  const params = streamer!.requests[0] as unknown as Record<string, unknown> & {
    system: { cache_control?: unknown; text: string }[];
    tools: { name: string; eager_input_streaming?: boolean }[];
    messages: { role: string; content: string }[];
  };
  assert.equal(params.model, DEFAULT_SETTINGS.chatModel);
  assert.deepEqual(params.output_config, { effort: "medium" });
  assert.deepEqual(params.betas, ["server-side-fallback-2026-07-01"]);
  assert.equal(params.fallbacks, "default");
  assert.equal(params.thinking, undefined, "thinking is left at the model default");
  assert.equal(params.tool_choice, undefined, "forced tool choice is rejected by current models");
  assert.deepEqual(params.system[0].cache_control, { type: "ephemeral", ttl: "1h" });
  assert.equal(params.tools[0].name, "say");
  assert.ok(params.tools.every((t) => t.eager_input_streaming === true));
  assert.equal(params.messages.length, 1);
  assert.match(params.messages[0].content, /<event>\n.*«ehi»/s);
  assert.doesNotMatch(params.messages[0].content, /<recent_conversation>[^]*\] the user: ehi/, "the new message is not duplicated in the history");
});

test("requestParams omits server fallbacks for Haiku", () => {
  const haiku = requestParams("claude-haiku-5-5", "low", "sys", []) as unknown as Record<string, unknown>;
  assert.equal(haiku.fallbacks, undefined);
  assert.equal(haiku.betas, undefined);
  const noTools = requestParams("claude-opus-5-5", "low", "sys", [], false) as unknown as Record<string, unknown>;
  assert.equal(noTools.tools, undefined);
});

test("look_at_screen returns the screenshot to Claude and the moment continues", async () => {
  const { brain, streamer, record } = setup([
    { content: [say("s0", "Fammi vedere…"), tool("l1", "look_at_screen", {})] },
    { content: [say("s1", "Vedo un errore alla riga 12!")] },
  ]);
  await brain.handle({ kind: "message", text: "guarda qui" });

  assert.equal(streamer!.requests.length, 2);
  assert.deepEqual(record.looks, [{ which: "cursor", byUser: true }]);
  const second = streamer!.requests[1].messages;
  assert.equal(second.length, 3);
  assert.equal(second[1].role, "assistant");
  const results = second[2].content as { type: string; tool_use_id: string; content: { type: string; source?: { data: string } }[] }[];
  const lookResult = results.find((r) => r.tool_use_id === "l1")!;
  assert.ok(lookResult.content.some((c) => c.type === "image" && c.source?.data === "QUJD"));
  assert.deepEqual(record.liveEnd, ["Fammi vedere…\n\nVedo un errore alla riga 12!"]);
});

test("an autonomous moment uses the autonomous model at low effort and speaks spontaneously", async () => {
  const { brain, streamer, record, memory } = setup(
    [{ content: [say("s1", "Pausa caffè? ☕"), tool("n1", "schedule_next_check", { minutes: 12 })] }],
    { autonomousModel: "claude-haiku-5-5" },
  );
  await brain.handle({ kind: "tick" });
  const params = streamer!.requests[0] as unknown as Record<string, unknown>;
  assert.equal(params.model, "claude-haiku-5-5");
  assert.deepEqual(params.output_config, { effort: "low" });
  assert.equal(record.live.length, 0, "spontaneous lines are not streamed");
  assert.deepEqual(record.said, [{ text: "Pausa caffè? ☕", spontaneous: true }]);
  assert.deepEqual(record.scheduled, [12]);
  assert.equal(memory.recentConversation(5).length, 1);
});

test("silent autonomous moments only move the body", async () => {
  const { brain, record } = setup([{ content: [tool("a1", "act", { animation: "sit", seconds: 60 })] }]);
  await brain.handle({ kind: "tick" });
  assert.equal(record.said.length, 0);
  assert.equal(record.performed[0][0].animation, "sit");
  assert.equal(record.performed[0][0].seconds, 60);
});

test("memory, reminder and schedule tools update state", async () => {
  const { brain, memory } = setup([
    {
      content: [
        tool("r1", "remember", { text: "Si chiama Diego e lavora su IBM i", kind: "user" }),
        tool("r2", "set_reminder", { minutes: 30, text: "Chiamare Marco" }),
        say("s1", "Segnato!"),
      ],
    },
  ]);
  const before = Date.now();
  await brain.handle({ kind: "message", text: "mi chiamo Diego, ricordami di chiamare Marco tra mezz'ora" });
  assert.deepEqual(
    memory.facts().map((f) => f.text),
    ["Si chiama Diego e lavora su IBM i"],
  );
  const [reminder] = memory.reminders();
  assert.equal(reminder.text, "Chiamare Marco");
  const due = Date.parse(reminder.dueAt) - before;
  assert.ok(due >= 29 * 60_000 && due <= 31 * 60_000);
});

test("invalid tool inputs are not executed; act keeps its valid fields", async () => {
  const { brain, record } = setup([
    {
      content: [tool("a1", "act", { emotion: "furious" }), tool("a2", "act", { emotion: "happy", extra: 1 }), say("s1", "ok")],
    },
  ]);
  await brain.handle({ kind: "message", text: "test" });
  assert.deepEqual(
    record.performed.flat().map((s) => s.emotion),
    ["happy"],
  );
  assert.deepEqual(record.liveEnd, ["ok"]);
});

test("tool inputs cut off at max_tokens are not run", async () => {
  const { brain, record } = setup([{ content: [tool("a1", "act", { emotion: "happy" })], stop_reason: "max_tokens" }]);
  await brain.handle({ kind: "tick" });
  assert.equal(record.performed.length, 0);
});

test("a refusal gets a gentle line instead of an error", async () => {
  const { brain, record } = setup([{ content: [], stop_reason: "refusal" }]);
  await brain.handle({ kind: "message", text: "?" });
  assert.equal(record.said.length, 1);
  assert.match(record.said[0].text, /preferisco non rispondere/);
});

test("after a mid-output fallback only the serving model's content counts", async () => {
  const { brain, record } = setup([
    {
      content: [
        say("s0", "parziale"),
        { type: "fallback", from: { model: "claude-opus-5-5" }, to: { model: "claude-opus-4-8" }, trigger: { type: "refusal" } },
        say("s1", "Risposta finale"),
      ],
    },
  ]);
  await brain.handle({ kind: "tick" });
  assert.deepEqual(record.said, [{ text: "Risposta finale", spontaneous: true }]);
});

test("without credentials the pet explains how to connect it", async () => {
  const { brain, record } = setup(null);
  await brain.handle({ kind: "message", text: "ciao" });
  assert.equal(brain.isAvailable(), false);
  assert.match(record.said[0].text, /cervello/);
});

test("once the daily budget is spent no request is made", async () => {
  const { brain, streamer, usage, record } = setup([], { dailyBudgetUsd: 0.01 });
  usage.record("anthropic", "claude-opus-5-5", { input_tokens: 10_000, output_tokens: 0 });
  await brain.handle({ kind: "message", text: "ciao" });
  await brain.handle({ kind: "tick" });
  assert.equal(streamer!.requests.length, 0);
  assert.equal(record.said.length, 1);
  assert.match(record.said[0].text, /budget/);
});

test("an authentication error disables the brain until the key changes", async () => {
  const { brain, record } = setup([{ error: new Anthropic.AuthenticationError(401, {}, "invalid x-api-key", new Headers()) }]);
  await brain.handle({ kind: "message", text: "ciao" });
  assert.equal(brain.isAvailable(), false);
  assert.match(record.said.at(-1)!.text, /chiave API/);
  assert.equal(record.performed[0][0].emotion, "sad");
  brain.credentialsChanged();
  assert.equal(brain.isAvailable(), true);
});

test("rate limits back off autonomous moments", async () => {
  const { brain, record } = setup([{ error: new Anthropic.RateLimitError(429, {}, "rate limited", new Headers()) }]);
  await brain.handle({ kind: "tick" });
  assert.deepEqual(record.backOff, [10]);
  assert.equal(record.said.length, 0, "background failures stay quiet");
});

test("a user message interrupts an autonomous moment and is answered", async () => {
  const { brain, streamer, record } = setup([{ hang: true }, { content: [say("s1", "Eccomi!")] }]);
  const tick = brain.handle({ kind: "tick" });
  await sleep(5);
  assert.equal(brain.isBusy(), true);
  await brain.handle({ kind: "message", text: "ehi" });
  await tick;
  while (brain.isBusy()) await sleep(5);
  assert.equal(streamer!.requests.length, 2);
  assert.deepEqual(record.liveEnd, ["Eccomi!"]);
});

test("finished days are summarized into the diary", async () => {
  let now = new Date("2026-10-11T18:00:00");
  const memory = new Memory(null, () => now);
  memory.addMessage("user", "Oggi ho finito il refactoring!");
  memory.addMessage("pet", "Grandissimo!");
  now = new Date("2026-10-12T09:00:00");
  memory.addMessage("user", "buongiorno");
  const { brain, streamer } = setup([{ content: [{ type: "text", text: "Ieri Diego ha finito un refactoring." }] }], {}, memory);
  await brain.writeDiary();
  assert.deepEqual(memory.diary(), [{ date: "2026-10-11", summary: "Ieri Diego ha finito un refactoring." }]);
  assert.equal(memory.recentConversation(10).length, 1, "only today's conversation remains");
  const params = streamer!.requests[0] as unknown as Record<string, unknown>;
  assert.equal(params.tools, undefined);
});

test("partial say JSON yields the text written so far", () => {
  const bs = "\\"; // one backslash, as it appears in JSON escapes
  assert.equal(partialStringField('{"te', "text"), null);
  assert.equal(partialStringField('{"text": "Ciao! Co', "text"), "Ciao! Co");
  assert.equal(partialStringField(`{"text":"riga 1${bs}nriga 2`, "text"), "riga 1\nriga 2");
  assert.equal(partialStringField(`{"text": "a ${bs}"b${bs}" c ${bs}${bs} d"}`, "text"), `a "b" c ${bs} d`);
  assert.equal(partialStringField(`{"text": "spezzato ${bs}`, "text"), "spezzato ", "a split escape waits for the next fragment");
  assert.equal(partialStringField(`{"text": "caff${bs}u00e8 ${bs}ud83d${bs}ude00`, "text"), "caffè 😀");
  assert.equal(partialStringField(`{"text": "caff${bs}u00`, "text"), "caff");
  assert.equal(partialStringField('{"text": "fatto", "extra": 1}', "text"), "fatto");
});
