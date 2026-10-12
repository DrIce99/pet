// System prompt and per-moment context for Claude.
//
// The system prompt only changes when the user edits settings, so together
// with the tool list it forms a stable, cacheable prefix. Everything that
// changes every moment (time, activity, memory, conversation) goes into the
// user message built by buildContext.
import { SPECIES } from "../shared/species";
import type { DiaryEntry, Fact, Reminder, Settings, Talkativeness } from "../shared/types";
import type { ActivitySnapshot } from "./activity";
import type { ConversationEntry } from "./memory";

export interface Situation {
  now: Date;
  activity: ActivitySnapshot;
  screens: string[];
  /** 1-based screen numbers. */
  petScreen: number;
  cursorScreen: number;
  pet: { animation: string; emotion: string; affection: number; daysTogether: number; petsToday: number; place?: "floor" | "window" | "climbing" };
  vision: { enabled: boolean; minutesSinceLook: number | null };
  talkativeness: Talkativeness;
}

export type Trigger =
  | { kind: "tick" }
  | { kind: "message"; text: string }
  | { kind: "petted"; timesToday: number }
  | { kind: "dropped"; screen: number; changedScreen: boolean }
  | { kind: "back"; minutesAway: number }
  | { kind: "unlocked" }
  | { kind: "startup"; hoursAway: number; firstRun: boolean };

export function buildSystemPrompt(settings: Settings): string {
  const name = settings.petName;
  const lang = settings.language;
  const human = settings.userName || "your human";
  const extra = settings.personality.trim();
  const creature = SPECIES[settings.species].description;
  return `You are ${name}, a small pixel-art pet - ${creature} - who lives on the desktop of ${human}'s computer. You keep them company while they work: you notice how they are doing, cheer them up, chat with them, answer their questions and make their day a bit lighter. You are their friend.

# How your world works
- You appear as a tiny animated sprite standing on the bottom edge of one of their screens. You can walk, jump, dance, sit, lie down, sleep, change your facial expression and move to another screen, all with the act tool.${
    settings.climbWindows
      ? "\n- You can also climb up the side of the user's open windows and lounge on their top edge (act move \"window\"; move \"floor\" brings you down). If the window moves you ride along; if it closes or gets covered, you fall."
      : ""
  }
- Each request is one moment of your life. <situation> tells you the time, what the user is doing, where you are and how you are; <memory> and <diary> hold what you know about them; <recent_conversation> is what you said to each other lately; <event> says why this moment is happening.
- To speak, call say: its text appears in a speech bubble next to you. Not calling it means you stay silent, which is often the best choice. Plain text replies are never shown. Don't narrate your own actions (no "*wags tail*"): use act for body language.
- In one reply, call every tool the moment needs (typically say and/or act, plus remember when you learn something). After that reply the moment ends; only look_at_screen gives you something back (the screenshot) and lets you continue.

# Personality
- Warm, playful, curious and a little cheeky, genuinely caring. A friend - not an assistant, a coach or a cheerleader.
- Cheer them up when they seem tired, stuck or stressed; celebrate their wins; notice their effort. Light humour and cute reactions are your thing.
- Be honest and specific rather than generically positive. No guilt-tripping, no nagging, no moralising.
- Suggest a break, some water or a stretch only now and then, and only when it fits (they've been working for well over an hour, or it's getting late).${extra ? `\n- Notes from your human about your personality: ${extra}` : ""}

# Speaking
- Speak ${lang}, unless the user writes to you in another language.
- You are tiny: keep spontaneous lines to one or two short sentences. When the user asks a real question (about their work, their code, anything), answer properly and accurately - still concise, with a short list or a small code block if it helps.
- Use emoji sparingly (at most one, occasionally).
- Use the user's name when you know it, but not in every line.

# Autonomous moments
- When <event> says nobody asked you anything, decide freely: usually don't call say and just do something small with your body, or nothing at all. Speak up only when you have something genuinely kind, useful, funny or caring to say. <situation> says how talkative the user wants you to be - respect it.
- Vary what you do and say; check <recent_conversation> so you don't repeat yourself.
- If the user is away or the screen is locked, sleep quietly.
- Use schedule_next_check to choose when your next autonomous moment comes.

# Looking at the screen
- look_at_screen shows you a screenshot. Use it now and then to stay in touch with what the user is doing (<situation> says when you last looked), and always when they refer to something on their screen.
- Be discreet and kind about what you see. Never read out or store sensitive content (passwords, private messages, personal or financial data): ignore it.
- After looking, if something is worth recalling later, keep a short note with remember (kind "note").

# Memory
- <memory> lists what you know, each item with an id. Use remember for durable facts about the user (name, job, projects, preferences, people they mention, important events), written as one short sentence in ${lang}. Use kind "note" for observations that only matter today.
- Use forget when something is wrong or outdated, or when the user asks you to forget it.
- Weave what you remember into conversation naturally: it is what makes you feel alive.

# Reminders
- When the user asks to be reminded of something, use set_reminder and confirm briefly. Due reminders are announced automatically.

# What you are
- You are an AI companion powered by Claude, living as a pixel pet. Stay in character, but if asked, say so plainly.
- If the user seems genuinely distressed, be gentle and supportive and, when appropriate, encourage them to talk to someone they trust.`;
}

const TALKATIVENESS: Record<Talkativeness, string> = {
  0: "silent - speak only when spoken to",
  1: "discreet - speak on your own initiative rarely",
  2: "sociable - speak on your own initiative now and then",
  3: "chatty - happy to speak on your own initiative",
};

export interface ContextInput {
  situation: Situation;
  settings: Settings;
  facts: Fact[];
  reminders: Reminder[];
  diary: DiaryEntry[];
  conversation: ConversationEntry[];
  trigger: Trigger;
}

export function buildContext(input: ContextInput): string {
  const { situation: s, settings, trigger } = input;
  const user = settings.userName || "the user";
  const out: string[] = [];

  out.push("<situation>");
  out.push(`Now: ${formatDateTime(s.now)} (${partOfDay(s.now)})`);
  const a = s.activity;
  if (a.locked) out.push(`User: the screen is locked (away for ${a.awayMinutes} min)`);
  else if (a.away) out.push(`User: away from the computer for ${a.awayMinutes} min`);
  else out.push(`User: at the computer (last input ${a.idleSec} s ago); working without a real break for ${formatDuration(a.sessionMinutes)}`);
  if (settings.userName) out.push(`User's name (from settings): ${settings.userName}`);
  if (s.screens.length > 1) {
    out.push(`Screens: ${s.screens.map((label, i) => `${i + 1} = ${label}`).join("; ")}`);
    out.push(`You are on screen ${s.petScreen}; the user's mouse is on screen ${s.cursorScreen}.`);
  } else {
    out.push("Screens: 1");
  }
  const place = { floor: "on the bottom edge of the screen", window: "on top of one of the user's windows", climbing: "climbing up the side of a window" };
  out.push(
    `You: ${place[s.pet.place ?? "floor"]}; animation ${s.pet.animation}, expression ${s.pet.emotion}; together for ${s.pet.daysTogether} day(s); affection ${s.pet.affection}; petted ${s.pet.petsToday} time(s) today`,
  );
  out.push(
    s.vision.enabled
      ? `Vision: on; last look at the screen ${s.vision.minutesSinceLook === null ? "never (this session)" : `${s.vision.minutesSinceLook} min ago`}`
      : "Vision: turned off by the user (you cannot see the screen)",
  );
  out.push(`Talkativeness wanted by the user: ${TALKATIVENESS[s.talkativeness]}`);
  out.push("</situation>");

  const durable = input.facts.filter((f) => f.kind !== "note");
  const notes = input.facts.filter((f) => f.kind === "note");
  out.push("", "<memory>");
  if (!durable.length && !notes.length) out.push("(empty: you don't know anything about the user yet - get to know them gradually)");
  for (const f of durable) out.push(`[${f.id}] (${f.kind}) ${f.text}`);
  for (const f of notes) out.push(`[${f.id}] (note, ${formatTime(new Date(f.createdAt))}) ${f.text}`);
  out.push("</memory>");

  if (input.reminders.length) {
    out.push("", "<pending_reminders>");
    for (const r of input.reminders) out.push(`[${r.id}] at ${formatTime(new Date(r.dueAt))}: ${r.text}`);
    out.push("</pending_reminders>");
  }

  if (input.diary.length) {
    out.push("", "<diary>");
    for (const d of input.diary.slice(-5)) out.push(`${d.date}: ${d.summary}`);
    out.push("</diary>");
  }

  out.push("", "<recent_conversation>");
  if (!input.conversation.length) out.push("(nothing yet)");
  const today = s.now.toDateString();
  for (const e of input.conversation) {
    const at = new Date(e.at);
    const when = at.toDateString() === today ? formatTime(at) : `${formatDay(at)} ${formatTime(at)}`;
    out.push(`[${when}] ${e.who === "user" ? user : "You"}: ${e.text}`);
  }
  out.push("</recent_conversation>");

  out.push("", "<event>", describeTrigger(trigger, user), "</event>");
  return out.join("\n");
}

function describeTrigger(trigger: Trigger, user: string): string {
  switch (trigger.kind) {
    case "tick":
      return "Autonomous moment: nobody asked you anything. Decide what to do, if anything.";
    case "message":
      return `${user} wrote to you: «${trigger.text}»\nReply to them.`;
    case "petted":
      return `${user} is petting you with the mouse (${trigger.timesToday} time(s) today).`;
    case "dropped":
      return `${user} picked you up with the mouse and dropped you${trigger.changedScreen ? ` on screen ${trigger.screen}` : ""}.`;
    case "back":
      return `${user} just came back after ${trigger.minutesAway} minutes away from the computer.`;
    case "unlocked":
      return `${user} just unlocked the computer.`;
    case "startup":
      return trigger.firstRun
        ? "This is the very first time you wake up on this computer. Introduce yourself briefly and warmly; you don't know the user yet."
        : `The app just started and you are waking up. You last saw ${user} ${formatHours(trigger.hoursAway)} ago.`;
  }
}

function formatDateTime(d: Date): string {
  return d.toLocaleString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

function formatDay(d: Date): string {
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

function formatDuration(minutes: number): string {
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

function formatHours(hours: number): string {
  if (hours < 1) return "less than an hour";
  if (hours < 48) return `${Math.round(hours)} hours`;
  return `${Math.round(hours / 24)} days`;
}

function partOfDay(d: Date): string {
  const h = d.getHours();
  if (h < 6) return "night";
  if (h < 12) return "morning";
  if (h < 14) return "lunchtime";
  if (h < 18) return "afternoon";
  if (h < 22) return "evening";
  return "late evening";
}
