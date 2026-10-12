// Text helpers shared by the providers: partial JSON reading, thinking
// removal, and the JSON reply format for models without tool support.
import { ANIMATIONS, EMOTIONS, FACT_KINDS } from "../../shared/types";
import { MOVE_TARGETS } from "../behavior";
import type { ToolCallOut } from "./types";

const JSON_ESCAPES: Record<string, string> = { n: "\n", t: "\t", r: "\r", b: "\b", f: "\f", '"': '"', "\\": "\\", "/": "/" };

/** Reads the possibly unterminated string value of `key` from a JSON prefix such as `{"text": "Ciao! Co`. */
export function partialStringField(json: string, key: string): string | null {
  const start = new RegExp(`"${key}"\\s*:\\s*"`).exec(json);
  if (!start) return null;
  let out = "";
  for (let i = start.index + start[0].length; i < json.length; i++) {
    const ch = json[i];
    if (ch === '"') return out;
    if (ch !== "\\") {
      out += ch;
      continue;
    }
    const next = json[i + 1];
    // An escape split across two fragments is completed by the next one
    if (next === undefined) return out;
    if (next === "u") {
      const hex = json.slice(i + 2, i + 6);
      if (hex.length < 4) return out;
      out += String.fromCharCode(parseInt(hex, 16));
      i += 5;
    } else {
      out += JSON_ESCAPES[next] ?? next;
      i++;
    }
  }
  return out;
}

/** Removes reasoning that some open models write inline as <think>...</think>. */
export function stripThinking(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/g, "")
    .replace(/<think>[\s\S]*$/, "")
    .trim();
}

/** Instructions appended to the system prompt when the model can't call tools. */
export const JSON_REPLY_FORMAT = `

# Reply format
In this conversation you cannot call tools. Reply ONLY with one JSON object, with no other text and no code fences. Every field is optional and corresponds to the tools described above:
{"say": "your words for the speech bubble (leave it out to stay silent)",
 "emotion": "${EMOTIONS.join("|")}",
 "animation": "${ANIMATIONS.join("|")}",
 "move": "${MOVE_TARGETS.join("|")}",
 "screen": 2,
 "seconds": 30,
 "remember": [{"text": "one short sentence", "kind": "${FACT_KINDS.join("|")}"}],
 "forget": ["f12"],
 "reminder": {"minutes": 20, "text": "what to remind"},
 "look_at_screen": "cursor",
 "next_check_minutes": 10}
"look_at_screen" ("cursor", "mine", "all" or a screen number) asks for a screenshot: you will receive it and reply again.
Example: {"say": "Ciao! Come va?", "emotion": "happy", "animation": "wave"}`;

/** Finds the JSON object in a reply, tolerating code fences and stray text. */
function extractObject(text: string): Record<string, unknown> | null {
  const cleaned = text.replace(/```(?:json)?/gi, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const value: unknown = JSON.parse(cleaned.slice(start, end + 1));
    return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Turns a JSON-format reply into the same tool calls a tool-capable model
 * would make. A reply that isn't JSON at all is treated as speech.
 */
export function parseJsonReply(raw: string): ToolCallOut[] {
  const text = stripThinking(raw);
  const o = extractObject(text);
  if (!o) {
    if (!text || text.startsWith("{")) {
      const said = partialStringField(text, "say");
      return said ? [{ id: "json_say", name: "say", input: { text: said } }] : [];
    }
    return [{ id: "json_say", name: "say", input: { text } }];
  }
  const calls: ToolCallOut[] = [];
  let n = 0;
  const add = (name: string, input: unknown) => calls.push({ id: `json_${++n}`, name, input });
  if (typeof o.say === "string" && o.say.trim()) add("say", { text: o.say });
  const act: Record<string, unknown> = {};
  for (const key of ["emotion", "animation", "move", "screen", "seconds"]) if (o[key] !== undefined && o[key] !== null && o[key] !== "") act[key] = o[key];
  if (Object.keys(act).length) add("act", act);
  if (Array.isArray(o.remember)) for (const item of o.remember) add("remember", item);
  if (Array.isArray(o.forget)) for (const id of o.forget) add("forget", { id });
  if (o.reminder && typeof o.reminder === "object") add("set_reminder", o.reminder);
  if (o.look_at_screen) {
    const which = o.look_at_screen;
    add("look_at_screen", typeof which === "string" || typeof which === "number" ? { screen: String(which) } : {});
  }
  if (typeof o.next_check_minutes === "number") add("schedule_next_check", { minutes: o.next_check_minutes });
  return calls;
}
