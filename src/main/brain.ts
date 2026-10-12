// The pet's mind: turns events into requests to the chosen AI service, runs
// the tools the model calls (speech, body, memory, screen, reminders) and
// delivers what it says.
//
// Each moment is a fresh request: a stable system prompt plus one user
// message carrying the situation, memory and recent conversation. Within a
// moment the loop only continues after look_at_screen, whose screenshot the
// model needs to see; every other tool is fire-and-forget, so most moments
// cost a single request.
import { PROVIDERS } from "../shared/providers";
import type { Settings } from "../shared/types";
import type { ActStep } from "./behavior";
import { log } from "./log";
import type { Memory } from "./memory";
import { buildContext, buildSystemPrompt, type Situation, type Trigger } from "./prompt";
import { ProviderError, type ChatProvider, type MomentSession, type ToolCallOut, type ToolResultIn } from "./providers/types";
import { parseToolCall, type ToolCall } from "./tools";
import type { UsageTracker } from "./usage";

export interface LookResult {
  notes: string[];
  images: { label: string; jpegBase64: string }[];
}

export interface SpeechHandle {
  append(delta: string): void;
  /** Settles the bubble on the final text (empty hides it). */
  end(finalText: string, expectsReply: boolean): void;
}

export type Purpose = "chat" | "autonomous";

export interface BrainHost {
  settings(): Settings;
  readonly memory: Memory;
  readonly usage: UsageTracker;
  /** The service and model configured for a purpose, or null when none is usable. */
  provider(purpose: Purpose): { provider: ChatProvider; model: string } | null;
  situation(): Situation;
  perform(steps: ActStep[]): void;
  lookAtScreen(which: string, requestedByUser: boolean): Promise<LookResult>;
  /** Opens a bubble that fills while the model is still writing. */
  startSpeech(): SpeechHandle;
  /** Shows a complete line; spontaneous lines wait for a pause in the user's typing. */
  say(text: string, options: { spontaneous: boolean; expectsReply: boolean }): void;
  setThinking(thinking: boolean): void;
  scheduleNextCheck(minutes: number): void;
  /** Delays autonomous moments after rate limits and outages. */
  backOff(minutes: number): void;
}

const MAX_ROUNDS = 4;

export class Brain {
  private busy = false;
  private currentIsMessage = false;
  private current: MomentSession | null = null;
  private readonly queue: string[] = [];
  private authFailed = false;

  constructor(private readonly host: BrainHost) {}

  isBusy(): boolean {
    return this.busy;
  }

  isAvailable(purpose: Purpose = "autonomous"): boolean {
    return !this.authFailed && this.host.provider(purpose) !== null;
  }

  /** Call after keys or services change so a previous auth failure is retried. */
  credentialsChanged(): void {
    this.authFailed = false;
  }

  /** User messages queue behind a running moment (and cut short an autonomous one); other events are dropped while busy. */
  async handle(trigger: Trigger): Promise<void> {
    if (this.busy) {
      if (trigger.kind === "message") {
        this.queue.push(trigger.text);
        if (!this.currentIsMessage) this.current?.abort();
      }
      return;
    }
    this.busy = true;
    this.currentIsMessage = trigger.kind === "message";
    try {
      await this.turn(trigger);
    } catch (err) {
      log.error("Unexpected error in a moment", err);
    } finally {
      this.busy = false;
      this.currentIsMessage = false;
      this.current = null;
      const next = this.queue.shift();
      if (next !== undefined) void this.handle({ kind: "message", text: next });
    }
  }

  /** Turns finished days of conversation into diary entries. */
  async writeDiary(): Promise<void> {
    const settings = this.host.settings();
    for (const day of this.host.memory.pendingDiaryDays()) {
      let summary = `Abbiamo scambiato ${day.entries.length} messaggi.`;
      const chosen = this.authFailed ? null : this.host.provider("chat");
      if (chosen && day.entries.length >= 2 && !this.host.usage.overBudget(settings.dailyBudgetUsd)) {
        const user = settings.userName || "Utente";
        const transcript = day.entries.map((e) => `${e.who === "user" ? user : settings.petName}: ${e.text}`).join("\n");
        try {
          const result = await chosen.provider.complete({
            model: chosen.model,
            system: `You keep the diary of ${settings.petName}, a pixel pet who lives on the user's desktop. Summarize the day in ${settings.language}, in two to four short sentences written in first person as ${settings.petName}: what the user did, said or felt, and anything worth remembering tomorrow. Output only the summary.`,
            prompt: `Conversation of ${day.date}:\n${transcript}`,
          });
          this.host.usage.record(chosen.provider.id, chosen.model, result.usage);
          if (result.text) summary = result.text;
        } catch (err) {
          log.warn(`Diary summary for ${day.date} failed`, err);
        }
      }
      this.host.memory.addDiary(day.date, summary);
    }
  }

  private async turn(trigger: Trigger): Promise<void> {
    const host = this.host;
    const settings = host.settings();
    const isMessage = trigger.kind === "message";
    const context = buildContext({
      situation: host.situation(),
      settings,
      facts: host.memory.facts(),
      reminders: host.memory.reminders(),
      diary: host.memory.diary(),
      conversation: host.memory.recentConversation(16),
      trigger,
    });
    if (isMessage) host.memory.addMessage("user", trigger.text);

    const chosen = this.authFailed ? null : host.provider(isMessage ? "chat" : "autonomous");
    if (!chosen) {
      if (isMessage || trigger.kind === "startup") {
        host.say(
          `Ciao! Sono ${settings.petName}. Per parlare con te mi serve un "cervello": clic destro su di me → Impostazioni → Cervello. Ci sono anche opzioni gratuite!`,
          { spontaneous: false, expectsReply: false },
        );
      }
      return;
    }
    if (host.usage.overBudget(settings.dailyBudgetUsd)) {
      if (isMessage) {
        host.say(`Per oggi ho finito le energie: ho raggiunto il budget giornaliero di $${settings.dailyBudgetUsd.toFixed(2)}. Puoi alzarlo nelle impostazioni.`, {
          spontaneous: false,
          expectsReply: false,
        });
      }
      return;
    }

    const { provider, model } = chosen;
    const session = provider.start({ model, effort: isMessage ? "medium" : "low", system: buildSystemPrompt(settings), context });
    this.current = session;
    const spoken: string[] = [];
    const steps: ActStep[] = [];
    const bubble: { speech: SpeechHandle | null; shown: string } = { speech: null, shown: "" };
    let nudged = false;

    if (isMessage) host.setThinking(true);
    try {
      for (let round = 0; round < MAX_ROUNDS; round++) {
        const before = spoken.join("\n\n");
        const onSay = (live: string) => {
          const full = before ? `${before}\n\n${live}` : live;
          if (!full.startsWith(bubble.shown) || full.length === bubble.shown.length) return;
          if (!bubble.speech) {
            host.setThinking(false);
            bubble.speech = host.startSpeech();
          }
          bubble.speech.append(full.slice(bubble.shown.length));
          bubble.shown = full;
        };
        const result = await session.next(isMessage ? onSay : undefined);
        host.usage.record(provider.id, model, result.usage);
        if (result.stop === "refused") {
          if (isMessage && !spoken.length) spoken.push("Mmh, su questo preferisco non rispondere.");
          break;
        }
        if (result.stop === "length" && result.toolCalls.length) {
          // A cut-off tool input can still look valid: run nothing from this reply
          log.warn("Reply cut at the token limit with tool calls; skipping them");
          break;
        }
        const ran = await this.runTools(result.toolCalls, steps, isMessage);
        // Plain text counts as speech only in conversations: some open models
        // answer in text instead of calling say, but in autonomous moments
        // that text is often just their reasoning.
        const text = ran.said || (isMessage ? result.text : "");
        if (text) spoken.push(text);
        if (!ran.followUp) {
          // Small models sometimes only act after a message: give them one more round to answer
          if (!isMessage || spoken.length || !ran.results.length || nudged) break;
          nudged = true;
          const last = ran.results[ran.results.length - 1];
          last.text = [last.text, "The user is still waiting for an answer to their message: reply now with say."].filter(Boolean).join(" ");
        }
        session.addResults(ran.results);
      }
    } catch (err) {
      this.reportError(err, isMessage, provider, model);
    } finally {
      host.setThinking(false);
    }

    if (steps.length) host.perform(steps);
    const text = spoken.join("\n\n").trim();
    const expectsReply = /\?[\s\p{Extended_Pictographic}]*$/u.test(text);
    if (text) host.memory.addMessage("pet", text);
    if (bubble.speech) bubble.speech.end(text, expectsReply);
    else if (text) host.say(text, { spontaneous: !isMessage, expectsReply });
  }

  private async runTools(
    calls: ToolCallOut[],
    steps: ActStep[],
    requestedByUser: boolean,
  ): Promise<{ results: ToolResultIn[]; said: string; followUp: boolean }> {
    const results: ToolResultIn[] = [];
    const said: string[] = [];
    let followUp = false;
    for (const call of calls) {
      const parsed = parseToolCall(call.name, call.input);
      if (!parsed) {
        log.warn(`Invalid input for tool ${call.name}`, call.input);
        results.push({ id: call.id, name: call.name, text: JSON.stringify({ INVALID_JSON: JSON.stringify(call.input) }), images: [], isError: true });
        continue;
      }
      if (parsed.name === "look_at_screen") followUp = true;
      try {
        const out = await this.execute(parsed, steps, said, requestedByUser);
        results.push({ id: call.id, name: call.name, text: out.text, images: out.images, isError: false });
      } catch (err) {
        log.error(`Tool ${parsed.name} failed`, err);
        results.push({ id: call.id, name: call.name, text: err instanceof Error ? err.message : String(err), images: [], isError: true });
      }
    }
    return { results, said: said.join("\n\n"), followUp };
  }

  private async execute(call: ToolCall, steps: ActStep[], said: string[], requestedByUser: boolean): Promise<{ text: string; images: LookResult["images"] }> {
    const memory = this.host.memory;
    const done = (text: string) => ({ text, images: [] });
    switch (call.name) {
      case "say":
        said.push(call.text);
        return done("Said.");
      case "act":
        steps.push(call.step);
        return done(call.ignored.length ? `Done, but these values aren't valid and were ignored: ${call.ignored.join(", ")}.` : "Done.");
      case "look_at_screen": {
        const look = await this.host.lookAtScreen(call.screen, requestedByUser);
        return { text: look.notes.join("\n") || (look.images.length ? "" : "Nothing to show."), images: look.images };
      }
      case "remember":
        return done(`Saved as [${memory.remember(call.text, call.kind).id}].`);
      case "forget":
        return done(memory.forget(call.id) ? `Forgot [${call.id}].` : `There is no memory with id ${call.id}.`);
      case "set_reminder": {
        const due = new Date(Date.now() + call.minutes * 60_000);
        const reminder = memory.addReminder(call.text, due);
        return done(`Reminder [${reminder.id}] set for ${due.toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit" })}.`);
      }
      case "schedule_next_check":
        this.host.scheduleNextCheck(call.minutes);
        return done("Scheduled.");
    }
  }

  private reportError(err: unknown, isMessage: boolean, provider: ChatProvider, model: string): void {
    const e = err instanceof ProviderError ? err : new ProviderError("unknown", err instanceof Error ? err.message : String(err), err);
    if (e.kind === "aborted") {
      log.info("Moment interrupted");
      return;
    }
    log.error(`Request to ${provider.id} (${model}) failed`, e.cause ?? e);
    const service = PROVIDERS[provider.id].name;
    const ollama = provider.id === "ollama";
    let line: string;
    switch (e.kind) {
      case "auth":
        this.authFailed = true;
        line = `La chiave API di ${service} non viene accettata 😿 Controllala nelle impostazioni (clic destro su di me).`;
        break;
      case "permission":
        line = `La chiave di ${service} non può usare "${model}": prova un altro modello nelle impostazioni.`;
        break;
      case "not_found":
        line = ollama
          ? `Ollama non ha il modello "${model}": scaricalo con "ollama pull ${model}" oppure scegline un altro nelle impostazioni.`
          : `Il modello "${model}" non esiste su ${service}: scegline un altro nelle impostazioni.`;
        break;
      case "rate_limit":
        this.host.backOff(10);
        line = "Ho fatto troppe richieste tutte insieme: mi riposo un attimo e poi ci riprovo.";
        break;
      case "overloaded":
        this.host.backOff(5);
        line = ollama ? "Ollama ci sta mettendo troppo a rispondere: forse il modello è troppo pesante per questo PC." : `Nessuna risposta da ${service}, forse è sovraccarico: riprovo più tardi.`;
        break;
      case "connection":
        this.host.backOff(5);
        line = ollama
          ? "Non riesco a parlare con Ollama: è avviato sul tuo PC?"
          : e.certificate
            ? `La rete non si fida del certificato di ${service}, quindi non riesco a collegarmi (i dettagli sono nel log).`
            : "Non riesco a collegarmi a internet.";
        break;
      case "bad_request":
        line = "Ho avuto un problema tecnico con la richiesta (i dettagli sono nel log).";
        break;
      default:
        line = "Qualcosa è andato storto (i dettagli sono nel log).";
    }
    if (isMessage || e.kind === "auth") {
      this.host.perform([{ emotion: "sad" }]);
      this.host.say(line, { spontaneous: false, expectsReply: false });
    }
  }
}
