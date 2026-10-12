// Tool definitions offered to Claude and validation of the inputs it sends.
// Requests stream with eager_input_streaming, so the API doesn't validate
// tool inputs: every input is checked here before anything runs.
import type Anthropic from "@anthropic-ai/sdk";
import { ANIMATIONS, EMOTIONS, FACT_KINDS, type AnimationName, type Emotion, type FactKind } from "../shared/types";
import { MOVE_TARGETS, type ActStep, type MoveTarget } from "./behavior";

// Order and content must stay stable: tools are part of the cached prompt prefix.
// Speech goes through the say tool rather than plain text: on recent models
// text written between tool calls can come back as hidden thinking blocks.
export const TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: "say",
    description:
      "Say something out loud: the text appears in your speech bubble. This is the only way the user hears you - plain text replies are not shown. Call it whenever you want to talk and leave it out to stay silent; use one call per moment, with everything you want to say.",
    input_schema: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: "What you say, in the language you speak with the user. Light markdown is rendered: **bold**, `code`, code blocks, short lists.",
        },
      },
      required: ["text"],
      additionalProperties: false,
    },
    eager_input_streaming: true,
  },
  {
    name: "act",
    description:
      "Control your body: a facial expression, a body animation and/or walking somewhere. This is your body language - use it in most moments, silent ones included (sit when calm, dance when happy, celebrate the user's wins, sleep when they're away). Several calls run in order, as a sequence.",
    input_schema: {
      type: "object",
      properties: {
        emotion: { type: "string", enum: [...EMOTIONS], description: "Facial expression to show (lasts about 20 seconds)." },
        animation: {
          type: "string",
          enum: [...ANIMATIONS],
          description:
            "Body animation. idle, sit, lie (lying down, awake) and sleep last until something else happens; the others end by themselves.",
        },
        move: {
          type: "string",
          enum: [...MOVE_TARGETS],
          description:
            "Where to go before the animation. to_cursor walks to the user's mouse pointer (switching screen if needed); other_screen moves you to another monitor; window climbs onto the top edge of one of the user's open windows (when there's one you can reach); floor hops back down to the bottom of the screen.",
        },
        screen: { type: "integer", minimum: 1, description: "Target screen number when move is other_screen (default: the next screen)." },
        seconds: { type: "number", minimum: 1, maximum: 3600, description: "How long to hold sit, lie, sleep or idle." },
      },
      additionalProperties: false,
    },
    eager_input_streaming: true,
  },
  {
    name: "look_at_screen",
    description:
      "Take a screenshot to see what the user is doing. Use it now and then to stay in touch with their activity, and always when they refer to something on their screen ('guarda', 'cosa ne pensi', 'ho un errore'). The image comes back to you so you can react. Don't use it in every moment.",
    input_schema: {
      type: "object",
      properties: {
        screen: {
          type: "string",
          description: "'cursor' (default: the screen with the user's mouse), 'mine' (the screen you are on), 'all', or a screen number such as '2'.",
        },
      },
      additionalProperties: false,
    },
    eager_input_streaming: true,
  },
  {
    name: "remember",
    description:
      "Save something to your long-term memory. Call it whenever you learn something worth keeping about the user (name, job, projects, preferences, people they mention, important events, how they feel about things), or to keep a short observation for today (kind 'note', forgotten after 12 hours). One short sentence, in the language you speak with the user. Don't save what is already in memory.",
    input_schema: {
      type: "object",
      properties: {
        text: { type: "string", description: "The fact, as one short sentence." },
        kind: {
          type: "string",
          enum: [...FACT_KINDS],
          description:
            "user: who they are. work: job and projects. preference: likes, dislikes, habits. event: something that happened or will happen. pet: about you and your relationship. note: temporary observation for today.",
        },
      },
      required: ["text", "kind"],
      additionalProperties: false,
    },
    eager_input_streaming: true,
  },
  {
    name: "forget",
    description: "Delete a memory by id (for example 'f12' or 'n30') when it is wrong or outdated, or when the user asks you to forget it.",
    input_schema: {
      type: "object",
      properties: { id: { type: "string", description: "Id of the memory, as shown in <memory>." } },
      required: ["id"],
      additionalProperties: false,
    },
    eager_input_streaming: true,
  },
  {
    name: "set_reminder",
    description:
      "Schedule a reminder that you will announce out loud later. Use it when the user asks to be reminded of something ('ricordami tra 20 minuti...', 'alle 15 ho una call'); compute the minutes from the current time in <situation>.",
    input_schema: {
      type: "object",
      properties: {
        minutes: { type: "number", minimum: 1, maximum: 10080, description: "Minutes from now." },
        text: { type: "string", description: "What to tell the user when it is time, in the language you speak with them." },
      },
      required: ["minutes", "text"],
      additionalProperties: false,
    },
    eager_input_streaming: true,
  },
  {
    name: "schedule_next_check",
    description:
      "Choose when your next autonomous moment happens: sooner if something interesting is going on, later if the user is focused or away. If you don't call it, a default interval is used.",
    input_schema: {
      type: "object",
      properties: { minutes: { type: "number", minimum: 1, maximum: 120, description: "Minutes until your next moment." } },
      required: ["minutes"],
      additionalProperties: false,
    },
    eager_input_streaming: true,
  },
];

export type ToolCall =
  | { name: "say"; text: string }
  | { name: "act"; step: ActStep; ignored: string[] }
  | { name: "look_at_screen"; screen: string }
  | { name: "remember"; text: string; kind: FactKind }
  | { name: "forget"; id: string }
  | { name: "set_reminder"; minutes: number; text: string }
  | { name: "schedule_next_check"; minutes: number };

/** Validates a tool call against its schema; returns null when the input doesn't match. */
export function parseToolCall(name: string, input: unknown): ToolCall | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
  const o = input as Record<string, unknown>;
  const allowed: Record<string, string[]> = {
    say: ["text"],
    act: ["emotion", "animation", "move", "screen", "seconds"],
    look_at_screen: ["screen"],
    remember: ["text", "kind"],
    forget: ["id"],
    set_reminder: ["minutes", "text"],
    schedule_next_check: ["minutes"],
  };
  // act is lenient (see below); every other tool must match its schema exactly
  if (!allowed[name] || (name !== "act" && Object.keys(o).some((k) => !allowed[name].includes(k)))) return null;

  const optionalEnum = <T extends string>(value: unknown, options: readonly T[]): T | undefined | null =>
    value === undefined ? undefined : typeof value === "string" && (options as readonly string[]).includes(value) ? (value as T) : null;
  const text = (value: unknown, max: number): string | null =>
    typeof value === "string" && value.trim() && value.length <= max ? value.trim() : null;
  const number = (value: unknown, min: number, max: number): number | null =>
    typeof value === "number" && Number.isFinite(value) && value >= min && value <= max ? value : null;

  switch (name) {
    case "say": {
      const value = text(o.text, 6000);
      return value ? { name, text: value } : null;
    }
    case "act": {
      // Smaller models invent values ("curious"): keep the valid fields and report the rest
      const ignored = Object.keys(o).filter((k) => !allowed.act.includes(k));
      const keep = <T>(key: string, value: T | null | undefined): T | undefined => {
        if (value === null) ignored.push(`${key} ${JSON.stringify(o[key])}`);
        return value ?? undefined;
      };
      const emotion = keep("emotion", optionalEnum<Emotion>(o.emotion, EMOTIONS));
      const animation = keep("animation", optionalEnum<AnimationName>(o.animation, ANIMATIONS));
      const move = keep("move", optionalEnum<MoveTarget>(o.move, MOVE_TARGETS));
      const screenNumber = o.screen === undefined ? undefined : number(o.screen, 1, 16);
      const screen = keep("screen", screenNumber !== undefined && screenNumber !== null && !Number.isInteger(screenNumber) ? null : screenNumber);
      const seconds = keep("seconds", o.seconds === undefined ? undefined : number(o.seconds, 1, 3600));
      if (!emotion && !animation && !move) return null;
      return { name, step: { emotion, animation, move, screen, seconds }, ignored };
    }
    case "look_at_screen": {
      if (o.screen === undefined) return { name, screen: "cursor" };
      const screen = text(o.screen, 10);
      return screen ? { name, screen: screen.toLowerCase() } : null;
    }
    case "remember": {
      const value = text(o.text, 400);
      const kind = optionalEnum<FactKind>(o.kind, FACT_KINDS);
      return value && kind ? { name, text: value, kind } : null;
    }
    case "forget": {
      const id = text(o.id, 20);
      return id ? { name, id } : null;
    }
    case "set_reminder": {
      const minutes = number(o.minutes, 1, 10080);
      const value = text(o.text, 400);
      return minutes !== null && value ? { name, minutes, text: value } : null;
    }
    case "schedule_next_check": {
      const minutes = number(o.minutes, 1, 120);
      return minutes !== null ? { name, minutes } : null;
    }
  }
  return null;
}
