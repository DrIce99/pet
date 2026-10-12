import assert from "node:assert/strict";
import test from "node:test";
import { buildContext, buildSystemPrompt, type Situation } from "../src/main/prompt";
import { DEFAULT_SETTINGS, type Fact } from "../src/shared/types";

const situation: Situation = {
  now: new Date("2026-10-12T15:30:00"),
  activity: { idleSec: 2, away: false, locked: false, sessionMinutes: 95, awayMinutes: 0 },
  screens: ["1920x1080 (primary)", "2560x1440"],
  petScreen: 1,
  cursorScreen: 2,
  pet: { animation: "sit", emotion: "happy", affection: 12, daysTogether: 3, petsToday: 2 },
  vision: { enabled: false, minutesSinceLook: null },
  talkativeness: 1,
};

test("the system prompt is stable for the same settings and reflects them", () => {
  const settings = { ...DEFAULT_SETTINGS, petName: "Biscotto", language: "inglese", personality: "un po' sarcastico" };
  const a = buildSystemPrompt(settings);
  assert.equal(a, buildSystemPrompt(settings), "no timestamps or randomness in the cached prefix");
  assert.match(a, /You are Biscotto/);
  assert.match(a, /Speak inglese/);
  assert.match(a, /un po' sarcastico/);
  assert.doesNotMatch(buildSystemPrompt(DEFAULT_SETTINGS), /Notes from your human/);
  assert.match(a, /climb up the side of the user's open windows/);
  assert.doesNotMatch(buildSystemPrompt({ ...settings, climbWindows: false }), /climb/);
});

test("the context carries situation, memory, conversation and the event", () => {
  const facts: Fact[] = [
    { id: "f1", text: "Si chiama Diego", kind: "user", createdAt: "2026-10-10T10:00:00Z" },
    { id: "n7", text: "Sta scrivendo codice RPGLE", kind: "note", createdAt: "2026-10-12T14:00:00Z", expiresAt: "2026-10-13T02:00:00Z" },
  ];
  const text = buildContext({
    situation,
    settings: { ...DEFAULT_SETTINGS, userName: "Diego" },
    facts,
    reminders: [{ id: "r3", text: "Chiamare Marco", dueAt: "2026-10-12T16:00:00Z" }],
    diary: [{ date: "2026-10-11", summary: "Abbiamo festeggiato un rilascio." }],
    conversation: [
      { at: "2026-10-12T15:00:00", who: "user", text: "ciao" },
      { at: "2026-10-12T15:00:05", who: "pet", text: "Ciao Diego!" },
    ],
    trigger: { kind: "message", text: "come va?" },
  });
  assert.match(text, /working without a real break for 1 h 35 min/);
  assert.match(text, /Screens: 1 = 1920x1080 \(primary\); 2 = 2560x1440/);
  assert.match(text, /the user's mouse is on screen 2/);
  assert.match(text, /Vision: turned off/);
  assert.match(text, /You: on the bottom edge of the screen; animation sit/);
  assert.match(text, /\[f1\] \(user\) Si chiama Diego/);
  assert.match(text, /\[n7\] \(note, \d\d:\d\d\) Sta scrivendo codice RPGLE/);
  assert.match(text, /\[r3\] at \d\d:\d\d: Chiamare Marco/);
  assert.match(text, /2026-10-11: Abbiamo festeggiato un rilascio\./);
  assert.match(text, /\] Diego: ciao/);
  assert.match(text, /\] You: Ciao Diego!/);
  assert.match(text, /<event>\nDiego wrote to you: «come va\?»/);
});

test("every trigger is described", () => {
  const base = { situation, settings: DEFAULT_SETTINGS, facts: [], reminders: [], diary: [], conversation: [] };
  const events = [
    buildContext({ ...base, trigger: { kind: "tick" } }),
    buildContext({ ...base, trigger: { kind: "petted", timesToday: 4 } }),
    buildContext({ ...base, trigger: { kind: "dropped", screen: 2, changedScreen: true } }),
    buildContext({ ...base, trigger: { kind: "back", minutesAway: 25 } }),
    buildContext({ ...base, trigger: { kind: "unlocked" } }),
    buildContext({ ...base, trigger: { kind: "startup", hoursAway: 0, firstRun: true } }),
    buildContext({ ...base, trigger: { kind: "startup", hoursAway: 50, firstRun: false } }),
  ];
  assert.match(events[0], /nobody asked you anything/);
  assert.match(events[1], /petting you .*4 time/);
  assert.match(events[2], /dropped you on screen 2/);
  assert.match(events[3], /came back after 25 minutes/);
  assert.match(events[4], /unlocked the computer/);
  assert.match(events[5], /very first time/);
  assert.match(events[6], /2 days ago/);
  assert.match(events[0], /you don't know anything about the user yet/);
});
