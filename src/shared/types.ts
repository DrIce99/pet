// Types and constants shared by the main process, preloads and renderers.
import { DEFAULT_OLLAMA_URL, type ProviderId } from "./providers";
import type { SpeciesId } from "./species";
import type { SpritePack } from "./sprite/pack";

/** Body animations. Timed ones end on their own, the others last until replaced. */
export const ANIMATIONS = [
  "idle",
  "sit",
  "lie",
  "sleep",
  "jump",
  "dance",
  "wave",
  "spin",
  "stretch",
  "celebrate",
  "nod",
  "shake_head",
  "think",
  "look_around",
  "yawn",
  "groom",
  "scratch",
  "chase_tail",
  "pounce",
  "roll",
  "hop",
  "knead",
  "wag",
  "peek",
  "play_ball",
  "butterfly",
  "sneeze",
  "sing",
  "stalk",
] as const;
export type AnimationName = (typeof ANIMATIONS)[number];

/** Seconds each timed animation lasts; missing entries are continuous. */
export const ANIMATION_DURATION: Partial<Record<AnimationName, number>> = {
  jump: 1.1,
  dance: 4,
  wave: 2,
  spin: 1.2,
  stretch: 2.6,
  celebrate: 2.4,
  nod: 1.2,
  shake_head: 1.2,
  think: 3,
  look_around: 3,
  yawn: 2.2,
  groom: 3.6,
  scratch: 2.4,
  chase_tail: 2.4,
  pounce: 2.2,
  roll: 3,
  hop: 1.8,
  knead: 3.5,
  wag: 3,
  peek: 2.5,
  play_ball: 4.5,
  butterfly: 5,
  sneeze: 1.4,
  sing: 3.2,
};

export const EMOTIONS = [
  "neutral",
  "happy",
  "excited",
  "love",
  "sad",
  "surprised",
  "sleepy",
  "thinking",
  "wink",
  "embarrassed",
  "proud",
  "worried",
  "angry",
] as const;
export type Emotion = (typeof EMOTIONS)[number];

export type Facing = "left" | "right";
export type Locomotion = "none" | "walk" | "run" | "drag" | "fall" | "climb" | "leap";

export interface VisualState {
  animation: AnimationName;
  /** Bumped every time an animation is (re)started, so the renderer restarts it. */
  animationSeq: number;
  emotion: Emotion;
  facing: Facing;
  locomotion: Locomotion;
  talking: boolean;
  /** Waiting for the model's answer. */
  thinking: boolean;
  /** Taking a screenshot. */
  looking: boolean;
}

export type OneShotEffect = "hearts" | "sparkles" | "exclamation" | "question" | "sweat" | "notes";

export interface PetLayout {
  scale: number;
  /** Center of the sprite in window coordinates (DIP). */
  spriteX: number;
  windowWidth: number;
  windowHeight: number;
  species: SpeciesId;
  theme: string;
  name: string;
}

/** Gaze direction, each axis in -1..1. */
export interface LookDirection {
  x: number;
  y: number;
}

export type BubbleKind = "speech" | "system";

export interface BubbleStart {
  id: number;
  kind: BubbleKind;
}

export interface BubbleChunk {
  id: number;
  text: string;
}

export interface BubbleEnd {
  id: number;
  /** Authoritative final text; replaces what was streamed if they differ. */
  finalText: string;
  holdMs: number;
  expectsReply: boolean;
}

/** API exposed by the pet window preload as `window.pet`. */
export interface PetBridge {
  onLayout(cb: (layout: PetLayout) => void): void;
  onVisual(cb: (visual: VisualState) => void): void;
  onLook(cb: (look: LookDirection) => void): void;
  onEffect(cb: (effect: OneShotEffect) => void): void;
  onBubbleStart(cb: (msg: BubbleStart) => void): void;
  onBubbleChunk(cb: (msg: BubbleChunk) => void): void;
  onBubbleEnd(cb: (msg: BubbleEnd) => void): void;
  onBubbleHide(cb: () => void): void;
  onInputOpen(cb: () => void): void;
  onInputClose(cb: () => void): void;
  /** A hand-drawn sprite pack to use, or null for the sprites drawn by code. */
  onSpritePack(cb: (pack: SpritePack | null) => void): void;
  ready(): void;
  setInteractive(interactive: boolean): void;
  click(): void;
  petted(): void;
  dragStart(): void;
  dragEnd(): void;
  contextMenu(): void;
  send(text: string): void;
  closeInput(): void;
  bubbleClicked(): void;
}

/** Prices of Anthropic models (other providers are not charged by the app). */
export interface ModelInfo {
  id: string;
  label: string;
  /** USD per million tokens. */
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  /** Whether the API offers server-side refusal fallbacks for this model. */
  serverFallback: boolean;
}

export const MODELS: ModelInfo[] = [
  { id: "claude-opus-5-5", label: "Claude Opus 5.5", input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5, serverFallback: true },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5, serverFallback: true },
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5", input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125, serverFallback: false },
  { id: "claude-fable-5-1", label: "Claude Fable 5.1", input: 10, output: 50, cacheRead: 0.25, cacheWrite: 12.5, serverFallback: true },
];

export const DEFAULT_MODEL = "claude-opus-5-5";

/** Pricing for a Claude model; unknown ids are priced like the default model. */
export function modelInfo(id: string): ModelInfo {
  return MODELS.find((m) => m.id === id) ?? { ...MODELS[0], id, label: id, serverFallback: false };
}

/** 0 = speaks only when spoken to, 3 = very chatty. */
export type Talkativeness = 0 | 1 | 2 | 3;

export interface Settings {
  petName: string;
  userName: string;
  language: string;
  species: SpeciesId;
  theme: string;
  scale: number;
  personality: string;
  chatProvider: ProviderId;
  chatModel: string;
  autonomousProvider: ProviderId;
  autonomousModel: string;
  ollamaUrl: string;
  customUrl: string;
  talkativeness: Talkativeness;
  doNotDisturb: boolean;
  dailyBudgetUsd: number;
  visionEnabled: boolean;
  visionMinIntervalSec: number;
  visionMaxWidth: number;
  followCursorScreen: boolean;
  /** Climb on the other windows and sit on top of them. */
  climbWindows: boolean;
  /** Pounce on the mouse pointer when it wiggles nearby. */
  chaseCursor: boolean;
  /** Folder of a hand-drawn sprite pack; "" for the sprites drawn by the app. */
  spritePack: string;
  hotkey: string;
  launchAtLogin: boolean;
  hideFromCapture: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  petName: "Mochi",
  userName: "",
  language: "italiano",
  species: "cat",
  theme: "arancio",
  scale: 3,
  personality: "",
  chatProvider: "anthropic",
  chatModel: DEFAULT_MODEL,
  autonomousProvider: "anthropic",
  autonomousModel: DEFAULT_MODEL,
  ollamaUrl: DEFAULT_OLLAMA_URL,
  customUrl: "",
  talkativeness: 2,
  doNotDisturb: false,
  dailyBudgetUsd: 3,
  visionEnabled: true,
  visionMinIntervalSec: 120,
  visionMaxWidth: 1280,
  followCursorScreen: true,
  climbWindows: true,
  chaseCursor: true,
  spritePack: "",
  hotkey: "Control+Alt+P",
  launchAtLogin: false,
  hideFromCapture: true,
};

export type FactKind = "user" | "work" | "preference" | "event" | "pet" | "note";
export const FACT_KINDS: FactKind[] = ["user", "work", "preference", "event", "pet", "note"];

export interface Fact {
  id: string;
  text: string;
  kind: FactKind;
  createdAt: string;
  /** Notes expire; durable facts don't. */
  expiresAt?: string;
}

export interface Reminder {
  id: string;
  text: string;
  dueAt: string;
}

export interface DiaryEntry {
  date: string;
  summary: string;
}

export type KeySource = "settings" | "environment" | "none";

export interface SettingsSnapshot {
  settings: Settings;
  keys: Record<ProviderId, KeySource>;
  usage: { todayUsd: number; todayRequests: number };
  facts: Fact[];
  reminders: Reminder[];
  diary: DiaryEntry[];
  dataPath: string;
  sprites: { packs: string[]; folder: string; problem: string };
}

export interface ConnectionReport {
  ok: boolean;
  message: string;
}

/** API exposed by the settings window preload as `window.settingsApi`. */
export interface SettingsBridge {
  load(): Promise<SettingsSnapshot>;
  /** `keys`: missing providers keep their key, "" removes it. */
  save(settings: Settings, keys: Partial<Record<ProviderId, string>>): Promise<SettingsSnapshot>;
  testConnection(): Promise<ConnectionReport[]>;
  listModels(provider: ProviderId): Promise<{ ok: boolean; models: string[]; message: string }>;
  forgetFact(id: string): Promise<SettingsSnapshot>;
  clearMemory(): Promise<SettingsSnapshot>;
  openDataFolder(): Promise<void>;
  /** Saves the current sprites as a new pack to edit. */
  exportSprites(): Promise<{ snapshot: SettingsSnapshot; message: string }>;
  openSpritesFolder(): Promise<void>;
}
