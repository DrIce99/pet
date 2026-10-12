// Settings window: the pet, the AI services and their keys, behaviour,
// vision and memory.
import { PROVIDER_IDS, PROVIDERS, type ProviderId } from "../shared/providers";
import { SPECIES, themeFor, type SpeciesId } from "../shared/species";
import { paletteFor, renderSprite, SPRITE_H, SPRITE_W } from "../shared/sprite";
import type { AnimationName, Emotion, Settings, SettingsBridge, SettingsSnapshot, Talkativeness } from "../shared/types";

declare global {
  interface Window {
    settingsApi: SettingsBridge;
  }
}

const api = window.settingsApi;
const $ = <T extends HTMLElement = HTMLInputElement>(id: string) => document.getElementById(id) as T;

let snapshot: SettingsSnapshot | null = null;
let species: SpeciesId = "cat";
let theme = "arancio";
const removeKeys = new Set<ProviderId>();
const fetchedModels: Partial<Record<ProviderId, string[]>> = {};

// ---------------- tabs ----------------

document.querySelectorAll<HTMLButtonElement>(".tab").forEach((tab) =>
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t === tab));
    document.querySelectorAll<HTMLElement>(".panel").forEach((p) => p.classList.toggle("active", p.dataset.panel === tab.dataset.tab));
  }),
);

// ---------------- animated previews ----------------

const previews: { canvas: HTMLCanvasElement; species: () => SpeciesId; theme: () => string }[] = [];
const moods: [AnimationName, Emotion][] = [
  ["idle", "neutral"],
  ["wave", "happy"],
  ["play_ball", "excited"],
  ["idle", "love"],
  ["dance", "excited"],
  ["groom", "neutral"],
];
const started = performance.now();

function drawPreviews(now: number): void {
  // requestAnimationFrame timestamps can precede `started`
  const clock = Math.max(0, (now - started) / 1000);
  const [animation, emotion] = moods[Math.floor(clock / 4) % moods.length];
  for (const preview of previews) {
    const ctx = preview.canvas.getContext("2d")!;
    const image = ctx.createImageData(SPRITE_W, SPRITE_H);
    const frame = renderSprite({
      species: preview.species(),
      animation,
      emotion,
      locomotion: "none",
      facing: "right",
      talking: false,
      thinking: false,
      looking: false,
      t: clock % 4,
      clock,
      blink: clock % 3.7 < 0.14,
      look: { x: 0, y: 0 },
      effects: [],
    });
    const palette = paletteFor(preview.species(), preview.theme());
    for (let i = 0; i < frame.pixels.length; i++) {
      const hex = palette[frame.pixels[i]];
      if (!hex) continue;
      image.data[i * 4] = parseInt(hex.slice(1, 3), 16);
      image.data[i * 4 + 1] = parseInt(hex.slice(3, 5), 16);
      image.data[i * 4 + 2] = parseInt(hex.slice(5, 7), 16);
      image.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
    preview.canvas.style.transform = frame.lift ? `translateY(${-frame.lift * 2}px)` : "";
  }
  setTimeout(() => requestAnimationFrame(drawPreviews), 80);
}
previews.push({ canvas: $<HTMLCanvasElement>("preview"), species: () => species, theme: () => theme });
requestAnimationFrame(drawPreviews);

// ---------------- pet ----------------

function renderSpecies(): void {
  const box = $<HTMLDivElement>("species");
  if (!box.childElementCount) {
    for (const id of Object.keys(SPECIES) as SpeciesId[]) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "species-card";
      button.dataset.species = id;
      const canvas = document.createElement("canvas");
      canvas.width = SPRITE_W;
      canvas.height = SPRITE_H;
      const label = document.createElement("span");
      label.textContent = SPECIES[id].label;
      button.append(canvas, label);
      button.addEventListener("click", () => selectSpecies(id));
      previews.push({ canvas, species: () => id, theme: () => (id === species ? theme : themeFor(id, "").id) });
      box.append(button);
    }
  }
  box.querySelectorAll<HTMLButtonElement>(".species-card").forEach((b) => b.classList.toggle("selected", b.dataset.species === species));
}

function selectSpecies(id: SpeciesId): void {
  if (id === species) return;
  // Keep a custom name, but follow the species when the name was its default
  const name = $("petName");
  if (!name.value.trim() || name.value.trim() === SPECIES[species].defaultName) name.value = SPECIES[id].defaultName;
  species = id;
  theme = themeFor(id, theme).id;
  renderSpecies();
  renderThemes();
}

function renderThemes(): void {
  const themes = SPECIES[species].themes as Record<string, { label: string; body: string }>;
  $<HTMLDivElement>("themes").replaceChildren(
    ...Object.entries(themes).map(([id, colors]) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `swatch${id === theme ? " selected" : ""}`;
      const dot = document.createElement("i");
      dot.style.background = colors.body;
      button.append(dot, colors.label);
      button.addEventListener("click", () => {
        theme = id;
        renderThemes();
      });
      return button;
    }),
  );
}

// ---------------- brain: services and models ----------------

type Purpose = "chat" | "autonomous";

function providerOptions(select: HTMLSelectElement, value: ProviderId): void {
  if (!select.childElementCount) {
    select.append(
      ...PROVIDER_IDS.map((id) => {
        const option = document.createElement("option");
        option.value = id;
        option.textContent = PROVIDERS[id].label;
        return option;
      }),
    );
  }
  select.value = value;
}

function modelSuggestions(purpose: Purpose): void {
  const provider = $<HTMLSelectElement>(`${purpose}Provider`).value as ProviderId;
  const models = [...new Set([...(fetchedModels[provider] ?? []), ...PROVIDERS[provider].suggestions])];
  $<HTMLDataListElement>(`${purpose}Models`).replaceChildren(
    ...models.map((m) => {
      const option = document.createElement("option");
      option.value = m;
      return option;
    }),
  );
  const info = PROVIDERS[provider];
  const key = snapshot?.keys[provider] ?? "none";
  const needs = info.needsKey && key === "none" && !$(`key-${provider}`)?.value ? " Manca la chiave: inseriscila qui sotto." : "";
  $<HTMLElement>(`${purpose}Hint`).textContent = (info.free ? "Gratuito. " : info.kind === "anthropic" ? "A pagamento. " : "") + needs;
}

function onProviderChange(purpose: Purpose): void {
  const provider = $<HTMLSelectElement>(`${purpose}Provider`).value as ProviderId;
  const model = $(`${purpose}Model`);
  // A model name from another service makes no sense here
  const known = new Set([...(fetchedModels[provider] ?? []), ...PROVIDERS[provider].suggestions]);
  const foreign = PROVIDER_IDS.some((other) => other !== provider && PROVIDERS[other].suggestions.includes(model.value));
  if (!model.value || (foreign && !known.has(model.value))) model.value = PROVIDERS[provider].suggestions[0] ?? "";
  modelSuggestions(purpose);
}

async function detectModels(purpose: Purpose): Promise<void> {
  const provider = $<HTMLSelectElement>(`${purpose}Provider`).value as ProviderId;
  const hint = $<HTMLElement>(`${purpose}Hint`);
  hint.textContent = "Cerco i modelli…";
  await save(false);
  const result = await api.listModels(provider);
  if (result.ok) fetchedModels[provider] = result.models;
  modelSuggestions(purpose);
  hint.textContent = result.ok ? `${result.message} Scegline uno dalla lista del campo modello.` : result.message;
}

function renderProviders(next: SettingsSnapshot): void {
  const box = $<HTMLDivElement>("providers");
  const typed = new Map<string, string>();
  box.querySelectorAll<HTMLInputElement>("input").forEach((input) => typed.set(input.id, input.value));
  box.replaceChildren(
    ...PROVIDER_IDS.map((id) => {
      const info = PROVIDERS[id];
      const card = document.createElement("div");
      card.className = "provider";
      const header = document.createElement("header");
      const title = document.createElement("h3");
      title.textContent = info.label;
      header.append(title);
      if (id !== "custom") {
        const badge = document.createElement("span");
        badge.className = `badge${info.free ? "" : " paid"}`;
        badge.textContent = info.free ? "Gratis" : "A pagamento";
        header.append(badge);
      }
      const note = document.createElement("p");
      note.textContent = info.note;
      card.append(header, note);

      const addInput = (inputId: string, value: string, placeholder: string, type = "text") => {
        const input = document.createElement("input");
        input.id = inputId;
        input.type = type;
        input.placeholder = placeholder;
        input.autocomplete = "off";
        input.spellcheck = false;
        input.value = typed.get(inputId) ?? value;
        return input;
      };
      if (id === "ollama") card.append(addInput("ollamaUrl", next.settings.ollamaUrl, "http://localhost:11434"));
      if (id === "custom") card.append(addInput("customUrl", next.settings.customUrl, "https://…/v1"));
      if (info.needsKey || id === "custom") {
        const row = document.createElement("div");
        row.className = "row";
        const key = addInput(`key-${id}`, "", info.needsKey ? "chiave API" : "chiave API (se serve)", "password");
        key.addEventListener("input", () => removeKeys.delete(id));
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "secondary";
        remove.textContent = "Rimuovi";
        remove.addEventListener("click", () => {
          removeKeys.add(id);
          key.value = "";
          setStatus(`La chiave di ${info.name} verrà rimossa quando salvi.`);
        });
        row.append(key, remove);
        const status = document.createElement("small");
        status.className = "hint";
        const source = next.keys[id];
        status.textContent =
          (source === "settings" ? "✓ Chiave salvata (cifrata). " : source === "environment" ? `Uso la variabile d'ambiente ${info.envKey}. ` : "Nessuna chiave. ") +
          (info.keyHelp ? `Si ottiene da ${info.keyHelp}.` : "");
        card.append(row, status);
      }
      return card;
    }),
  );
}

// ---------------- form ----------------

function listItems(id: string, items: { tag: string; text: string; action?: () => void }[], empty: string): void {
  const list = $<HTMLUListElement>(id);
  if (!items.length) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = empty;
    list.replaceChildren(li);
    return;
  }
  list.replaceChildren(
    ...items.map((item) => {
      const li = document.createElement("li");
      const tag = document.createElement("span");
      tag.className = "tag";
      tag.textContent = item.tag;
      const text = document.createElement("span");
      text.className = "text";
      text.textContent = item.text;
      li.append(tag, text);
      if (item.action) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = "Dimentica";
        button.addEventListener("click", item.action);
        li.append(button);
      }
      return li;
    }),
  );
}

const KIND_LABEL: Record<string, string> = {
  user: "chi sei",
  work: "lavoro",
  preference: "gusti",
  event: "evento",
  pet: "noi due",
  note: "nota di oggi",
};

function fill(next: SettingsSnapshot): void {
  snapshot = next;
  const s = next.settings;
  species = s.species;
  theme = s.theme;
  $("petName").value = s.petName;
  $("userName").value = s.userName;
  $("language").value = s.language;
  $<HTMLTextAreaElement>("personality").value = s.personality;
  $("scale").value = String(s.scale);
  $<HTMLOutputElement>("scaleOut").textContent = `×${s.scale}`;
  renderSpecies();
  renderThemes();
  renderSpritePacks(next);

  renderProviders(next);
  for (const purpose of ["chat", "autonomous"] as const) {
    providerOptions($<HTMLSelectElement>(`${purpose}Provider`), purpose === "chat" ? s.chatProvider : s.autonomousProvider);
    $(`${purpose}Model`).value = purpose === "chat" ? s.chatModel : s.autonomousModel;
    modelSuggestions(purpose);
  }

  $<HTMLSelectElement>("talkativeness").value = String(s.talkativeness);
  $("doNotDisturb").checked = s.doNotDisturb;
  $("followCursorScreen").checked = s.followCursorScreen;
  $("climbWindows").checked = s.climbWindows;
  $("chaseCursor").checked = s.chaseCursor;
  $("dailyBudgetUsd").value = String(s.dailyBudgetUsd);
  $("hotkey").value = s.hotkey;
  $("launchAtLogin").checked = s.launchAtLogin;
  $("visionEnabled").checked = s.visionEnabled;
  $("visionMinIntervalSec").value = String(s.visionMinIntervalSec);
  $<HTMLSelectElement>("visionMaxWidth").value = String(s.visionMaxWidth);
  $("hideFromCapture").checked = s.hideFromCapture;
  document.title = `Impostazioni di ${s.petName}`;
  $<HTMLHeadingElement>("title").textContent = `Impostazioni di ${s.petName}`;
  $<HTMLElement>("spend").textContent = `Spesa di oggi con Claude: $${next.usage.todayUsd.toFixed(3)} (richieste totali: ${next.usage.todayRequests}).`;

  listItems(
    "facts",
    next.facts.map((f) => ({ tag: KIND_LABEL[f.kind] ?? f.kind, text: f.text, action: () => void api.forgetFact(f.id).then(fill) })),
    "Non ricorda ancora niente di te.",
  );
  listItems(
    "reminders",
    next.reminders.map((r) => ({ tag: new Date(r.dueAt).toLocaleString("it-IT", { weekday: "short", hour: "2-digit", minute: "2-digit" }), text: r.text })),
    "Nessun promemoria.",
  );
  listItems(
    "diary",
    [...next.diary].reverse().map((d) => ({ tag: d.date, text: d.summary })),
    "Il diario si riempie giorno dopo giorno.",
  );
}

/** The hand-drawn sprite packs found in the sprites folder. */
function renderSpritePacks(next: SettingsSnapshot): void {
  const select = $<HTMLSelectElement>("spritePack");
  const chosen = next.settings.spritePack;
  const packs = next.sprites.packs.includes(chosen) || !chosen ? next.sprites.packs : [...next.sprites.packs, chosen];
  select.replaceChildren(new Option("Disegnati dall'app", ""), ...packs.map((id) => new Option(`Pacchetto: ${id}`, id)));
  select.value = chosen;
  $<HTMLElement>("spritesHint").textContent =
    next.sprites.problem ||
    `I pacchetti sono cartelle di immagini PNG in ${next.sprites.folder}. "Crea un pacchetto da disegnare" salva gli sprite attuali di questo pet come punto di partenza: modificali con un programma di pixel art e il pet si aggiorna appena salvi.`;
}

function collect(): Settings {
  if (!snapshot) throw new Error("not loaded");
  const num = (id: string, fallback: number) => {
    const value = Number($(id).value);
    return Number.isFinite(value) ? value : fallback;
  };
  const s = snapshot.settings;
  return {
    petName: $("petName").value,
    userName: $("userName").value,
    language: $("language").value,
    species,
    theme,
    scale: num("scale", s.scale),
    personality: $<HTMLTextAreaElement>("personality").value,
    chatProvider: $<HTMLSelectElement>("chatProvider").value as ProviderId,
    chatModel: $("chatModel").value,
    autonomousProvider: $<HTMLSelectElement>("autonomousProvider").value as ProviderId,
    autonomousModel: $("autonomousModel").value,
    ollamaUrl: $("ollamaUrl")?.value ?? s.ollamaUrl,
    customUrl: $("customUrl")?.value ?? s.customUrl,
    talkativeness: num("talkativeness", s.talkativeness) as Talkativeness,
    doNotDisturb: $("doNotDisturb").checked,
    dailyBudgetUsd: num("dailyBudgetUsd", s.dailyBudgetUsd),
    visionEnabled: $("visionEnabled").checked,
    visionMinIntervalSec: num("visionMinIntervalSec", s.visionMinIntervalSec),
    visionMaxWidth: num("visionMaxWidth", s.visionMaxWidth),
    followCursorScreen: $("followCursorScreen").checked,
    climbWindows: $("climbWindows").checked,
    chaseCursor: $("chaseCursor").checked,
    spritePack: $<HTMLSelectElement>("spritePack").value,
    hotkey: $("hotkey").value,
    launchAtLogin: $("launchAtLogin").checked,
    hideFromCapture: $("hideFromCapture").checked,
  };
}

/** Typed keys to store and keys marked for removal. */
function keyChanges(): Partial<Record<ProviderId, string>> {
  const changes: Partial<Record<ProviderId, string>> = {};
  for (const id of PROVIDER_IDS) {
    const typed = $(`key-${id}`)?.value.trim();
    if (typed) changes[id] = typed;
    else if (removeKeys.has(id)) changes[id] = "";
  }
  return changes;
}

function setStatus(text: string): void {
  const status = $<HTMLElement>("status");
  status.textContent = text;
  window.setTimeout(() => {
    if (status.textContent === text) status.textContent = "";
  }, 5000);
}

async function save(announce = true): Promise<void> {
  try {
    const keys = keyChanges();
    fill(await api.save(collect(), keys));
    for (const id of Object.keys(keys)) {
      const input = $(`key-${id}`);
      if (input) input.value = "";
    }
    removeKeys.clear();
    if (announce) setStatus("Salvato ✓");
  } catch (err) {
    setStatus(`Errore: ${err instanceof Error ? err.message : String(err)}`);
  }
}

$("scale").addEventListener("input", () => {
  $<HTMLOutputElement>("scaleOut").textContent = `×${$("scale").value}`;
});
$<HTMLButtonElement>("save").addEventListener("click", () => void save());
for (const purpose of ["chat", "autonomous"] as const) {
  $<HTMLSelectElement>(`${purpose}Provider`).addEventListener("change", () => onProviderChange(purpose));
  $<HTMLButtonElement>(`${purpose}Detect`).addEventListener("click", () => void detectModels(purpose));
}
$<HTMLButtonElement>("test").addEventListener("click", async () => {
  const list = $<HTMLUListElement>("testResult");
  list.replaceChildren(Object.assign(document.createElement("li"), { textContent: "Provo…" }));
  await save(false);
  const reports = await api.testConnection();
  list.replaceChildren(
    ...reports.map((r) => {
      const li = document.createElement("li");
      li.className = r.ok ? "ok" : "fail";
      li.textContent = r.message;
      return li;
    }),
  );
  fill(await api.load());
});
$<HTMLButtonElement>("openData").addEventListener("click", () => void api.openDataFolder());
$<HTMLButtonElement>("openSprites").addEventListener("click", () => void api.openSpritesFolder());
$<HTMLButtonElement>("exportSprites").addEventListener("click", () => {
  void api.exportSprites().then(({ snapshot: next, message }) => {
    if (!snapshot) return;
    // Only the pack list changes: keep whatever the user is editing
    snapshot = { ...snapshot, sprites: next.sprites };
    const current = $<HTMLSelectElement>("spritePack").value;
    renderSpritePacks({ ...next, settings: { ...next.settings, spritePack: current } });
    setStatus(message);
  });
});

const clearButton = $<HTMLButtonElement>("clearMemory");
let armedUntil = 0;
clearButton.addEventListener("click", async () => {
  if (Date.now() > armedUntil) {
    armedUntil = Date.now() + 4000;
    clearButton.classList.add("armed");
    clearButton.textContent = "Sicuro? Clicca di nuovo";
    window.setTimeout(() => {
      clearButton.classList.remove("armed");
      clearButton.textContent = "Dimentica tutto";
    }, 4000);
    return;
  }
  armedUntil = 0;
  fill(await api.clearMemory());
  setStatus("Memoria cancellata.");
});

void api.load().then(fill);
