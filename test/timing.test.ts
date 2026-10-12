import assert from "node:assert/strict";
import test from "node:test";
import { Activity } from "../src/main/activity";
import { Autonomy } from "../src/main/autonomy";
import { sanitizeSettings } from "../src/main/settings";
import { DEFAULT_SETTINGS, type Talkativeness } from "../src/shared/types";

test("activity notices when the user leaves and comes back", () => {
  let now = 0;
  let idle = 0;
  const activity = new Activity(
    () => idle,
    () => now,
  );
  const events: string[] = [];
  activity.on("away", () => events.push("away"));
  activity.on("back", (minutes) => events.push(`back ${minutes}`));

  now = 60 * 60_000;
  idle = 10;
  activity.poll();
  assert.equal(activity.snapshot().sessionMinutes, 60);

  idle = 400;
  now += 400_000;
  activity.poll();
  assert.deepEqual(events, ["away"]);
  assert.equal(activity.snapshot().away, true);

  now += 20 * 60_000;
  idle = 1;
  activity.poll();
  assert.deepEqual(events, ["away", "back 27"]);
  assert.equal(activity.snapshot().sessionMinutes, 0, "a long absence starts a new working session");

  activity.setLocked(true);
  assert.equal(activity.snapshot().away, true);
  assert.equal(activity.snapshot().locked, true);
});

test("autonomous moments follow talkativeness, Claude's schedule and back-offs", () => {
  let now = 0;
  let talk: Talkativeness = 2;
  let allowed = true;
  let runs = 0;
  const autonomy = new Autonomy(
    () => talk,
    () => allowed,
    () => runs++,
    () => now,
  );

  autonomy.check();
  assert.equal(runs, 0, "nothing in the first two minutes");
  now = 2 * 60_000;
  autonomy.check();
  assert.equal(runs, 1);
  const wait = autonomy.millisUntilNext();
  assert.ok(wait >= 4.5 * 60_000 && wait <= 7.5 * 60_000, `default interval around 6 minutes, got ${wait}`);

  autonomy.scheduleIn(0.1);
  assert.equal(autonomy.millisUntilNext(), 2 * 60_000, "clamped to the minimum for this talkativeness");
  autonomy.backOff(10);
  assert.equal(autonomy.millisUntilNext(), 10 * 60_000);

  now += 10 * 60_000;
  allowed = false;
  autonomy.check();
  assert.equal(runs, 1, "not allowed right now");
  assert.equal(autonomy.millisUntilNext(), 60_000, "retries a minute later");

  talk = 0;
  allowed = true;
  now += 5 * 60_000;
  autonomy.check();
  assert.equal(runs, 1, "a silent pet never starts a moment on its own");
});

test("settings are sanitized", () => {
  assert.deepEqual(sanitizeSettings({}), DEFAULT_SETTINGS);
  const s = sanitizeSettings({
    petName: "   ",
    scale: 9,
    chatModel: "  qwen3:8b ",
    chatProvider: "ollama",
    autonomousProvider: "nonsense" as never,
    species: "eevee",
    theme: "arancio",
    talkativeness: 2.6 as never,
    dailyBudgetUsd: 1.239,
    visionMaxWidth: 10,
    hotkey: " Alt+Shift+Space ",
  });
  assert.equal(s.petName, DEFAULT_SETTINGS.petName);
  assert.equal(s.scale, 5);
  assert.equal(s.chatProvider, "ollama");
  assert.equal(s.chatModel, "qwen3:8b");
  assert.equal(s.autonomousProvider, DEFAULT_SETTINGS.autonomousProvider);
  assert.equal(s.species, "eevee");
  assert.equal(s.theme, "classico", "a cat theme falls back to the species' first theme");
  assert.equal(sanitizeSettings({ chatProvider: "openrouter", chatModel: "" }).chatModel, "", "no default model for OpenRouter");
  assert.equal(sanitizeSettings({ chatProvider: "gemini", chatModel: "" }).chatModel, "gemini-flash-lite-latest");
  assert.equal(s.talkativeness, 3);
  assert.equal(s.dailyBudgetUsd, 1.24);
  assert.equal(s.visionMaxWidth, 640);
  assert.equal(s.hotkey, "Alt+Shift+Space");
});
