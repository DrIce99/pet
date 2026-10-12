import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Memory } from "../src/main/memory";
import { muteConsole } from "../src/main/log";

muteConsole();

function clock(start: string) {
  const state = { now: new Date(start) };
  return { state, now: () => state.now, advance: (ms: number) => (state.now = new Date(state.now.getTime() + ms)) };
}

test("remember deduplicates and forget removes by id", () => {
  const memory = new Memory(null);
  const fact = memory.remember("  Si chiama   Diego ", "user");
  assert.equal(fact.text, "Si chiama Diego");
  assert.match(fact.id, /^f\d+$/);
  assert.equal(memory.remember("si chiama diego", "user").id, fact.id);
  assert.equal(memory.forget(fact.id), true);
  assert.equal(memory.forget(fact.id), false);
  assert.equal(memory.facts().length, 0);
});

test("notes expire after 12 hours, durable facts don't", () => {
  const c = clock("2026-10-12T09:00:00");
  const memory = new Memory(null, c.now);
  memory.remember("Lavora su un programma RPGLE", "note");
  memory.remember("Ama il caffè", "preference");
  assert.equal(memory.facts().length, 2);
  c.advance(13 * 3600_000);
  assert.deepEqual(
    memory.facts().map((f) => f.text),
    ["Ama il caffè"],
  );
});

test("conversation is capped and grouped into past days for the diary", () => {
  const c = clock("2026-10-10T10:00:00");
  const memory = new Memory(null, c.now);
  for (let i = 0; i < 130; i++) memory.addMessage(i % 2 ? "pet" : "user", `messaggio ${i}`);
  assert.equal(memory.recentConversation(1000).length, 120);
  c.advance(24 * 3600_000);
  memory.addMessage("user", "oggi");
  const pending = memory.pendingDiaryDays();
  assert.deepEqual(
    pending.map((p) => [p.date, p.entries.length]),
    [["2026-10-10", 119]],
  );
  memory.addDiary("2026-10-10", "Una giornata piena di messaggi.");
  assert.equal(memory.pendingDiaryDays().length, 0);
  assert.deepEqual(
    memory.recentConversation(10).map((e) => e.text),
    ["oggi"],
  );
});

test("due reminders are returned once", () => {
  const c = clock("2026-10-12T09:00:00");
  const memory = new Memory(null, c.now);
  memory.addReminder("Chiamare Marco", new Date("2026-10-12T09:30:00"));
  memory.addReminder("Riunione", new Date("2026-10-12T11:00:00"));
  assert.equal(memory.takeDueReminders().length, 0);
  c.advance(31 * 60_000);
  assert.deepEqual(
    memory.takeDueReminders().map((r) => r.text),
    ["Chiamare Marco"],
  );
  assert.equal(memory.takeDueReminders().length, 0);
  assert.equal(memory.reminders().length, 1);
});

test("petting counts reset every day and raise affection", () => {
  const c = clock("2026-10-12T09:00:00");
  const memory = new Memory(null, c.now);
  memory.recordPetting();
  assert.equal(memory.recordPetting(), 2);
  c.advance(24 * 3600_000);
  assert.equal(memory.recordPetting(), 1);
  assert.equal(memory.stats().affection, 3);
});

test("memory survives a restart and clear keeps the birthday", () => {
  const dir = mkdtempSync(join(tmpdir(), "pet-memory-"));
  try {
    const file = join(dir, "memory.json");
    const first = new Memory(file);
    first.remember("Ha un gatto di nome Pixel", "user");
    first.addMessage("user", "ciao");
    first.flush();
    const bornAt = first.stats().bornAt;

    const second = new Memory(file);
    assert.deepEqual(
      second.facts().map((f) => f.text),
      ["Ha un gatto di nome Pixel"],
    );
    assert.equal(second.recentConversation(5).length, 1);
    second.clear();
    assert.equal(second.facts().length, 0);
    assert.equal(second.stats().bornAt, bornAt);
    second.flush();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
