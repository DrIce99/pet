// Persistent user settings (non-secret). API keys live in secrets.ts.
import { join } from "node:path";
import { DEFAULT_OLLAMA_URL, isProvider, PROVIDERS, type ProviderId } from "../shared/providers";
import { isSpecies, themeFor } from "../shared/species";
import { DEFAULT_SETTINGS, type Settings, type Talkativeness } from "../shared/types";
import { readJson, writeJson } from "./jsonStore";

type Listener = (next: Settings, prev: Settings) => void;

export class SettingsStore {
  private current: Settings;
  private readonly listeners = new Set<Listener>();
  private readonly file: string;

  constructor(dir: string) {
    this.file = join(dir, "settings.json");
    this.current = sanitizeSettings(readJson<Partial<Settings>>(this.file) ?? {});
  }

  get(): Settings {
    return this.current;
  }

  update(patch: Partial<Settings>): Settings {
    const prev = this.current;
    this.current = sanitizeSettings({ ...prev, ...patch });
    writeJson(this.file, this.current);
    for (const listener of this.listeners) listener(this.current, prev);
    return this.current;
  }

  onChange(listener: Listener): void {
    this.listeners.add(listener);
  }
}

/** Fills defaults and clamps values coming from disk or from the settings window. */
export function sanitizeSettings(raw: Partial<Record<keyof Settings, unknown>>): Settings {
  const d = DEFAULT_SETTINGS;
  const str = (v: unknown, fallback: string, max: number) => (typeof v === "string" ? v.slice(0, max) : fallback);
  const num = (v: unknown, fallback: number, min: number, max: number) =>
    typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
  const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);
  const provider = (v: unknown, fallback: ProviderId): ProviderId => (isProvider(v) ? v : fallback);
  // An empty model falls back to the service's first suggestion
  const model = (v: unknown, service: ProviderId, fallback: string) => {
    const value = str(v, "", 200).trim();
    return value || PROVIDERS[service].suggestions[0] || (service === d.chatProvider ? fallback : "");
  };
  const species = isSpecies(raw.species) ? raw.species : d.species;
  const chatProvider = provider(raw.chatProvider, d.chatProvider);
  const autonomousProvider = provider(raw.autonomousProvider, d.autonomousProvider);

  return {
    petName: str(raw.petName, d.petName, 30).trim() || d.petName,
    userName: str(raw.userName, d.userName, 50).trim(),
    language: str(raw.language, d.language, 40).trim() || d.language,
    species,
    theme: themeFor(species, str(raw.theme, d.theme, 40)).id,
    scale: Math.round(num(raw.scale, d.scale, 2, 5)),
    personality: str(raw.personality, d.personality, 2000),
    chatProvider,
    chatModel: model(raw.chatModel, chatProvider, d.chatModel),
    autonomousProvider,
    autonomousModel: model(raw.autonomousModel, autonomousProvider, d.autonomousModel),
    ollamaUrl: str(raw.ollamaUrl, d.ollamaUrl, 300).trim() || DEFAULT_OLLAMA_URL,
    customUrl: str(raw.customUrl, d.customUrl, 300).trim(),
    talkativeness: Math.round(num(raw.talkativeness, d.talkativeness, 0, 3)) as Talkativeness,
    doNotDisturb: bool(raw.doNotDisturb, d.doNotDisturb),
    dailyBudgetUsd: Math.round(num(raw.dailyBudgetUsd, d.dailyBudgetUsd, 0, 1000) * 100) / 100,
    visionEnabled: bool(raw.visionEnabled, d.visionEnabled),
    visionMinIntervalSec: Math.round(num(raw.visionMinIntervalSec, d.visionMinIntervalSec, 30, 3600)),
    visionMaxWidth: Math.round(num(raw.visionMaxWidth, d.visionMaxWidth, 640, 1920)),
    followCursorScreen: bool(raw.followCursorScreen, d.followCursorScreen),
    climbWindows: bool(raw.climbWindows, d.climbWindows),
    chaseCursor: bool(raw.chaseCursor, d.chaseCursor),
    spritePack: /^[\w .-]{0,60}$/.test(str(raw.spritePack, "", 60)) ? str(raw.spritePack, "", 60).trim() : "",
    hotkey: str(raw.hotkey, d.hotkey, 60).trim(),
    launchAtLogin: bool(raw.launchAtLogin, d.launchAtLogin),
    hideFromCapture: bool(raw.hideFromCapture, d.hideFromCapture),
  };
}
