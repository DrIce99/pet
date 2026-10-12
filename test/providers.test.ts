// Ollama and OpenAI-compatible services, with fetch replaced by fakes that
// answer like the real APIs.
import assert from "node:assert/strict";
import test from "node:test";
import type { ActStep } from "../src/main/behavior";
import { Brain, type BrainHost } from "../src/main/brain";
import { muteConsole } from "../src/main/log";
import { Memory } from "../src/main/memory";
import { CompatProvider } from "../src/main/providers/compat";
import { OllamaTransport } from "../src/main/providers/ollama";
import { OpenAITransport } from "../src/main/providers/openai";
import { parseJsonReply, stripThinking } from "../src/main/providers/text";
import type { ChatProvider } from "../src/main/providers/types";
import { UsageTracker } from "../src/main/usage";
import { DEFAULT_SETTINGS } from "../src/shared/types";

muteConsole();

interface Captured {
  url: string;
  body: Record<string, unknown> & { messages: Record<string, unknown>[] };
}

/** Replaces fetch for the duration of `fn`. */
async function withFetch(reply: (request: Captured, n: number) => Response | Promise<Response>, fn: (requests: Captured[]) => Promise<void>) {
  const original = globalThis.fetch;
  const requests: Captured[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const request = { url: String(input), body: init?.body ? JSON.parse(String(init.body)) : { messages: [] } };
    requests.push(request);
    return reply(request, requests.length);
  }) as typeof fetch;
  try {
    await fn(requests);
  } finally {
    globalThis.fetch = original;
  }
}

const sse = (chunks: unknown[]) =>
  new Response(chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n", {
    headers: { "content-type": "text/event-stream" },
  });
const ndjson = (lines: unknown[]) => new Response(lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
const toolDelta = (index: number, fields: Record<string, unknown>) => ({ choices: [{ delta: { tool_calls: [{ index, ...fields }] } }] });

function host(provider: ChatProvider, model: string) {
  const performed: ActStep[] = [];
  const live: string[] = [];
  const ended: string[] = [];
  const said: string[] = [];
  const looks: string[] = [];
  const h: BrainHost = {
    settings: () => DEFAULT_SETTINGS,
    memory: new Memory(null),
    usage: new UsageTracker(null),
    provider: () => ({ provider, model }),
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
    lookAtScreen: async (which) => {
      looks.push(which);
      return { notes: [], images: [{ label: "Screen 1 (primary), 1280x720", jpegBase64: "QUJD" }] };
    },
    startSpeech: () => {
      let text = "";
      return { append: (d) => live.push((text += d)), end: (t) => ended.push(t) };
    },
    say: (text) => said.push(text),
    setThinking: () => undefined,
    scheduleNextCheck: () => undefined,
    backOff: () => undefined,
  };
  return { h, performed, live, ended, said, looks };
}

test("OpenAI-compatible: tools, live speech and the screenshot follow-up", async () => {
  const provider = new CompatProvider("groq", new OpenAITransport("https://api.example/v1", "gsk-test", "Groq"));
  const t = host(provider, "llama-test");
  await withFetch(
    (_request, n) =>
      n === 1
        ? sse([
            toolDelta(0, { id: "call_a", function: { name: "look_at_screen", arguments: "" } }),
            toolDelta(0, { function: { arguments: '{"screen": "cursor"}' } }),
            { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
          ])
        : sse([
            toolDelta(0, { id: "call_b", function: { name: "say", arguments: '{"text": "Vedo' } }),
            toolDelta(0, { function: { arguments: ' un errore' } }),
            toolDelta(0, { function: { arguments: ' alla riga 3!"}' } }),
            toolDelta(1, { id: "call_c", function: { name: "act", arguments: '{"emotion": "surprised"}' } }),
            { choices: [{ delta: {}, finish_reason: "tool_calls" }], usage: { prompt_tokens: 900, completion_tokens: 40 } },
          ]),
    async (requests) => {
      await new Brain(t.h).handle({ kind: "message", text: "guarda qui" });
      assert.equal(requests.length, 2);
      assert.equal(requests[0].url, "https://api.example/v1/chat/completions");
      const first = requests[0].body;
      assert.equal(first.stream, true);
      const tools = first.tools as { function: { name: string; parameters: Record<string, unknown> } }[];
      assert.equal(tools[0].function.name, "say");
      assert.ok(tools.every((tool) => !JSON.stringify(tool.function.parameters).includes("additionalProperties")));

      const second = requests[1].body.messages;
      assert.equal(second[2].role, "assistant");
      assert.deepEqual(second[3], { role: "tool", tool_call_id: "call_a", content: "Done." });
      const image = (second[4].content as { type: string; image_url?: { url: string } }[]).find((c) => c.type === "image_url");
      assert.equal(image?.image_url?.url, "data:image/jpeg;base64,QUJD");
    },
  );
  assert.deepEqual(t.looks, ["cursor"]);
  assert.ok(t.live.length >= 2, "speech arrives progressively");
  assert.deepEqual(t.ended, ["Vedo un errore alla riga 3!"]);
  assert.equal(t.performed[0].emotion, "surprised");
});

test("Gemini: whole tool calls without index, thought signatures and usage", async () => {
  const provider = new CompatProvider("gemini", new OpenAITransport("https://gemini.example/openai", "key", "Gemini"));
  const t = host(provider, "gemini-flash-latest");
  // Gemini's stream: each call complete in its own chunk, no `index`, usage in every chunk
  const call = (id: string, name: string, args: unknown, extra?: unknown) => ({
    choices: [{ index: 0, delta: { role: "assistant", tool_calls: [{ id, type: "function", function: { name, arguments: JSON.stringify(args) }, ...(extra ? { extra_content: extra } : {}) }] } }],
    usage: { prompt_tokens: 160, completion_tokens: 20 },
  });
  const signature = { google: { thought_signature: "c2lnbmF0dXJl" } };
  await withFetch(
    (_request, n) =>
      n === 1
        ? sse([
            call("call_1", "say", { text: "Ciao Diego!" }, signature),
            call("call_2", "act", { emotion: "happy", animation: "wag" }),
            call("call_3", "look_at_screen", { screen: "cursor" }),
            { choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: "stop" }], usage: { prompt_tokens: 160, completion_tokens: 58 } },
          ])
        : sse([call("call_4", "say", { text: "Che bel codice!" }), { choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }]),
    async (requests) => {
      await new Brain(t.h).handle({ kind: "message", text: "ciao" });
      assert.equal(requests.length, 2);
      assert.deepEqual(requests[0].body.stream_options, { include_usage: true });
      const reply = requests[1].body.messages[2] as { tool_calls: { id: string; function: { name: string }; extra_content?: unknown }[] };
      assert.deepEqual(
        reply.tool_calls.map((c) => [c.id, c.function.name]),
        [
          ["call_1", "say"],
          ["call_2", "act"],
          ["call_3", "look_at_screen"],
        ],
      );
      assert.deepEqual(reply.tool_calls[0].extra_content, signature, "the thought signature goes back to Gemini");
      assert.equal(reply.tool_calls[1].extra_content, undefined);
    },
  );
  assert.deepEqual(t.ended, ["Ciao Diego!\n\nChe bel codice!"]);
  assert.equal(t.performed[0].animation, "wag");
  assert.deepEqual(t.looks, ["cursor"]);
  assert.equal(t.h.usage.today().outputTokens, 58 + 20, "the last usage of each stream is counted");
});

test("a message that only gets an action is answered in one more round", async () => {
  const provider = new CompatProvider("gemini", new OpenAITransport("https://gemini.example/openai", "key", "Gemini"));
  const actOnly = () => sse([toolDelta(0, { id: "call_a", function: { name: "act", arguments: '{"animation": "wave"}' } })]);
  const chat = host(provider, "gemini-flash-lite-latest");
  await withFetch(
    (_request, n) => (n === 1 ? actOnly() : sse([toolDelta(0, { id: "call_b", function: { name: "say", arguments: '{"text": "Vedo il tuo codice!"}' } })])),
    async (requests) => {
      await new Brain(chat.h).handle({ kind: "message", text: "cosa vedi?" });
      assert.equal(requests.length, 2);
      assert.match(String(requests[1].body.messages[3].content), /still waiting for an answer/);
    },
  );
  assert.deepEqual(chat.ended, ["Vedo il tuo codice!"]);

  // autonomous moments may stay silent
  const quiet = host(provider, "gemini-flash-lite-latest");
  await withFetch(actOnly, async (requests) => {
    await new Brain(quiet.h).handle({ kind: "tick" });
    assert.equal(requests.length, 1);
  });
  assert.deepEqual(quiet.said, []);
});

test("an overloaded service gets one more try", async () => {
  const provider = new CompatProvider("gemini", new OpenAITransport("https://gemini.example/openai", "key", "Gemini"));
  const t = host(provider, "gemini-flash-latest");
  await withFetch(
    (_request, n) =>
      n === 1
        ? new Response(JSON.stringify([{ error: { code: 503, message: "This model is currently experiencing high demand.", status: "UNAVAILABLE" } }]), { status: 503 })
        : sse([toolDelta(0, { id: "call_a", function: { name: "say", arguments: '{"text": "Eccomi!"}' } })]),
    async (requests) => {
      await new Brain(t.h).handle({ kind: "message", text: "ci sei?" });
      assert.equal(requests.length, 2);
    },
  );
  assert.deepEqual(t.ended, ["Eccomi!"]);
});

test("services that reject stream_options are asked again without it", async () => {
  const provider = new CompatProvider("custom", new OpenAITransport("http://localhost:1234/v1", null, "questo servizio"));
  await withFetch(
    (request) =>
      request.body.stream_options
        ? new Response(JSON.stringify({ error: { message: "Unrecognized request argument supplied: stream_options" } }), { status: 400 })
        : sse([{ choices: [{ delta: { content: "Ciao!" }, finish_reason: "stop" }] }]),
    async (requests) => {
      const first = await provider.complete({ model: "local", system: "s", prompt: "p" });
      const second = await provider.complete({ model: "local", system: "s", prompt: "p" });
      assert.equal(first.text, "Ciao!");
      assert.equal(second.text, "Ciao!");
      assert.equal(requests.length, 3, "the option is dropped for the model after the first refusal");
    },
  );
});

test("a model without tool support switches to JSON replies and stays there", async () => {
  const provider = new CompatProvider("openrouter", new OpenAITransport("https://api.example/v1", "key", "OpenRouter"));
  const t = host(provider, "tiny-model:free");
  await withFetch(
    (request) =>
      request.body.tools
        ? new Response(JSON.stringify({ error: { message: "This model does not support tools" } }), { status: 400 })
        : sse([
            { choices: [{ delta: { content: '{"say": "Ciao! Pausa caff' } }] },
            { choices: [{ delta: { content: 'è?", "emotion": "happy", "animation": "wave", "remember": [{"text": "Ama il caffè", "kind": "preference"}]}' } }] },
            { choices: [{ delta: {}, finish_reason: "stop" }] },
          ]),
    async (requests) => {
      const brain = new Brain(t.h);
      await brain.handle({ kind: "message", text: "ciao" });
      assert.equal(requests.length, 2);
      assert.equal(requests[1].body.tools, undefined);
      assert.deepEqual(requests[1].body.response_format, { type: "json_object" });
      assert.match(String(requests[1].body.messages[0].content), /Reply format/);

      await brain.handle({ kind: "message", text: "come va?" });
      assert.equal(requests.length, 3, "the next moment goes straight to JSON mode");
    },
  );
  assert.equal(t.ended[0], "Ciao! Pausa caffè?");
  assert.equal(t.performed[0].emotion, "happy");
  assert.equal(t.performed[0].animation, "wave");
  assert.deepEqual(
    t.h.memory.facts().map((f) => f.text),
    ["Ama il caffè"],
  );
});

test("Ollama: native API with a larger context, tools and images", async () => {
  const provider = new CompatProvider("ollama", new OllamaTransport("http://localhost:11434"));
  const t = host(provider, "qwen3");
  await withFetch(
    (_request, n) =>
      n === 1
        ? ndjson([
            { message: { role: "assistant", content: "", tool_calls: [{ function: { name: "look_at_screen", arguments: {} } }] }, done: false },
            { message: { role: "assistant", content: "" }, done: true, done_reason: "stop", prompt_eval_count: 1500, eval_count: 20 },
          ])
        : ndjson([
            { message: { role: "assistant", content: "", tool_calls: [{ function: { name: "say", arguments: { text: "Che bel codice!" } } }] }, done: false },
            { message: { role: "assistant", content: "" }, done: true, done_reason: "stop" },
          ]),
    async (requests) => {
      await new Brain(t.h).handle({ kind: "message", text: "che ne pensi?" });
      assert.equal(requests[0].url, "http://localhost:11434/api/chat");
      assert.deepEqual(requests[0].body.options, { num_ctx: 8192, num_predict: 4096 });
      assert.equal(requests[0].body.think, false);
      const second = requests[1].body.messages;
      assert.deepEqual(second[3], { role: "tool", content: "Done.", tool_name: "look_at_screen" });
      assert.deepEqual(second[4].images, ["QUJD"]);
    },
  );
  assert.deepEqual(t.ended, ["Che bel codice!"]);
});

test("Ollama errors become clear messages", async () => {
  const provider = new CompatProvider("ollama", new OllamaTransport("http://localhost:11434"));
  const offline = host(provider, "qwen3");
  const original = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new TypeError("fetch failed");
  }) as typeof fetch;
  try {
    await new Brain(offline.h).handle({ kind: "message", text: "ciao" });
  } finally {
    globalThis.fetch = original;
  }
  assert.match(offline.said[0], /Ollama: è avviato/);

  const missing = host(provider, "llama9");
  await withFetch(
    () => new Response(JSON.stringify({ error: "model 'llama9' not found, try pulling it first" }), { status: 404 }),
    async () => {
      await new Brain(missing.h).handle({ kind: "message", text: "ciao" });
    },
  );
  assert.match(missing.said[0], /ollama pull llama9/);
});

test("the app's network stack is used and certificate failures are explained", async () => {
  const urls: string[] = [];
  const rejected = new TypeError("fetch failed", { cause: Object.assign(new Error("unable to get local issuer certificate"), { code: "UNABLE_TO_GET_ISSUER_CERT_LOCALLY" }) });
  const injected = async (input: string | URL | Request) => {
    urls.push(String(input));
    throw rejected;
  };
  const provider = new CompatProvider("gemini", new OpenAITransport("https://example.test/v1", "key", "Gemini", {}, injected));
  const pet = host(provider, "gemini-flash-lite-latest");
  // the global fetch must not be touched when another one is given
  await withFetch(
    () => {
      throw new Error("global fetch used");
    },
    async () => {
      await new Brain(pet.h).handle({ kind: "message", text: "ciao" });
    },
  );
  assert.deepEqual(urls, ["https://example.test/v1/chat/completions"]);
  assert.match(pet.said[0], /certificato di Gemini/);
});

test("JSON replies and inline thinking are parsed robustly", () => {
  assert.equal(stripThinking("<think>devo salutare</think>Ciao!"), "Ciao!");
  assert.equal(stripThinking("<think>ragiono ancora"), "");
  assert.deepEqual(
    parseJsonReply('```json\n{"say": "Ehi!", "look_at_screen": 2, "next_check_minutes": 15}\n```').map((c) => [c.name, c.input]),
    [
      ["say", { text: "Ehi!" }],
      ["look_at_screen", { screen: "2" }],
      ["schedule_next_check", { minutes: 15 }],
    ],
  );
  assert.deepEqual(
    parseJsonReply("Ciao, come stai?").map((c) => c.input),
    [{ text: "Ciao, come stai?" }],
  );
  assert.deepEqual(parseJsonReply('{"say": "Ciao, tronc'), [{ id: "json_say", name: "say", input: { text: "Ciao, tronc" } }]);
  assert.deepEqual(parseJsonReply("{}"), []);
});
