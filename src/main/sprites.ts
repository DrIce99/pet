// Hand-drawn sprite packs on disk (see shared/sprite/pack.ts for the format):
// listing, loading (and reloading while the user edits them), and exporting
// the drawn-by-code sprites as a starting point.
import { nativeImage } from "electron";
import { existsSync, mkdirSync, readdirSync, readFileSync, watch, writeFileSync, type FSWatcher } from "node:fs";
import { join } from "node:path";
import type { SpeciesId } from "../shared/species";
import { SPECIES, themeFor } from "../shared/species";
import {
  ANIMATIONS,
  EMOTIONS,
  type AnimationName,
  type Emotion,
  type Locomotion,
} from "../shared/types";
import {
  EMOTION_FRAMES,
  LOCOMOTIONS,
  paletteFor,
  renderSprite,
  SPRITE_H,
  SPRITE_W,
  STRIP_SPECS,
  stripNames,
  type Geometry,
  type PackStrip,
  type SpritePack,
} from "../shared/sprite";
import { log } from "./log";
import { encodePng } from "./png";

interface PackFile {
  name?: string;
  frameWidth?: number;
  frameHeight?: number;
  fps?: Record<string, number>;
  anchors?: Geometry;
}

/** Folder names are used as pack ids: keep them simple. */
export function isPackId(id: string): boolean {
  return /^[\w .-]{1,60}$/.test(id) && !id.startsWith(".");
}

export class SpritePacks {
  private watcher: FSWatcher | null = null;
  private reloadTimer: NodeJS.Timeout | null = null;

  constructor(readonly dir: string) {}

  /** Folders that contain a pack.json. */
  list(): string[] {
    if (!existsSync(this.dir)) return [];
    return readdirSync(this.dir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && isPackId(d.name) && existsSync(join(this.dir, d.name, "pack.json")))
      .map((d) => d.name)
      .sort((a, b) => a.localeCompare(b));
  }

  /** Reads a pack; null (with the reason in the log) when it can't be used. */
  load(id: string): SpritePack | null {
    if (!isPackId(id)) return null;
    const folder = join(this.dir, id);
    let meta: PackFile;
    try {
      meta = JSON.parse(readFileSync(join(folder, "pack.json"), "utf8")) as PackFile;
    } catch (err) {
      log.warn(`Sprite pack "${id}": can't read pack.json`, err);
      return null;
    }
    if ((meta.frameWidth ?? SPRITE_W) !== SPRITE_W || (meta.frameHeight ?? SPRITE_H) !== SPRITE_H) {
      log.warn(`Sprite pack "${id}": frames must be ${SPRITE_W}x${SPRITE_H} pixels`);
      return null;
    }
    const known = new Set(stripNames());
    const strips: Record<string, PackStrip> = {};
    for (const file of readdirSync(folder)) {
      const match = /^(.+)\.png$/i.exec(file);
      if (!match) continue;
      const name = match[1].toLowerCase();
      if (!known.has(name)) {
        log.warn(`Sprite pack "${id}": unknown strip ${file} (ignored)`);
        continue;
      }
      const frames = readStrip(join(folder, file));
      if (!frames) {
        log.warn(`Sprite pack "${id}": ${file} must be ${SPRITE_H} pixels tall and a multiple of ${SPRITE_W} wide`);
        continue;
      }
      // Emotion variants default to the speed of their animation
      const fps = meta.fps?.[name] ?? meta.fps?.[stripBase(name)] ?? STRIP_SPECS[name]?.fps ?? STRIP_SPECS[stripBase(name)]?.fps ?? 4;
      strips[name] = { fps: Math.min(30, Math.max(0.2, fps)), frames };
    }
    if (!strips.idle) {
      log.warn(`Sprite pack "${id}": idle.png is required`);
      return null;
    }
    return { name: meta.name || id, strips, anchors: meta.anchors ?? defaultAnchors() };
  }

  /** Calls `changed` (debounced) whenever something in the pack's folder changes. */
  watch(id: string | null, changed: () => void): void {
    this.watcher?.close();
    this.watcher = null;
    if (!id || !isPackId(id) || !existsSync(join(this.dir, id))) return;
    try {
      this.watcher = watch(join(this.dir, id), () => {
        if (this.reloadTimer) clearTimeout(this.reloadTimer);
        this.reloadTimer = setTimeout(changed, 400);
      });
    } catch (err) {
      log.warn(`Can't watch sprite pack "${id}"`, err);
    }
  }

  /** Writes the drawn-by-code sprites of a species as a new pack; returns its id. */
  exportDrawn(species: SpeciesId, theme: string): { id: string; frames: number; files: number } {
    const label = `${SPECIES[species].label} ${themeFor(species, theme).colors.label}`.replace(/[^\w .-]/g, "");
    let id = label;
    for (let n = 2; existsSync(join(this.dir, id)); n++) id = `${label} ${n}`;
    const folder = join(this.dir, id);
    mkdirSync(folder, { recursive: true });

    const palette = paletteFor(species, theme).map((hex) => (hex ? [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) : null));
    const frame = (state: { animation?: AnimationName; locomotion?: Locomotion; emotion?: Emotion; talking?: boolean }, time: number) =>
      renderSprite(
        {
          species,
          animation: state.animation ?? "idle",
          emotion: state.emotion ?? "neutral",
          locomotion: state.locomotion ?? "none",
          facing: "right",
          talking: state.talking ?? false,
          thinking: false,
          looking: false,
          t: time,
          clock: time,
          blink: false,
          look: { x: 0, y: 0 },
          effects: [],
        },
        { effects: false },
      ).pixels;
    let frames = 0;
    let files = 0;
    const strip = (name: string, count: number, fps: number, state: Parameters<typeof frame>[0]) => {
      const rgba = new Uint8Array(SPRITE_W * count * SPRITE_H * 4);
      for (let f = 0; f < count; f++) {
        const pixels = frame(state, f / fps);
        for (let y = 0; y < SPRITE_H; y++) {
          for (let x = 0; x < SPRITE_W; x++) {
            const c = palette[pixels[y * SPRITE_W + x]];
            if (!c) continue;
            rgba.set([c[0], c[1], c[2], 255], ((y * SPRITE_W * count) + f * SPRITE_W + x) * 4);
          }
        }
      }
      writeFileSync(join(folder, `${name}.png`), encodePng(SPRITE_W * count, SPRITE_H, rgba));
      frames += count;
      files++;
    };
    for (const name of LOCOMOTIONS) strip(name, STRIP_SPECS[name].frames, STRIP_SPECS[name].fps, { locomotion: name });
    for (const name of ANIMATIONS) strip(name, STRIP_SPECS[name].frames, STRIP_SPECS[name].fps, { animation: name });
    // The talking mouth opens every 0.16 s: two frames show it
    strip("talk", STRIP_SPECS.talk.frames, STRIP_SPECS.talk.fps, { talking: true });
    for (const emotion of EMOTIONS) {
      if (emotion !== "neutral") strip(`idle_${emotion}`, EMOTION_FRAMES, STRIP_SPECS.idle.fps, { emotion });
    }

    const fps = Object.fromEntries(Object.entries(STRIP_SPECS).map(([name, spec]) => [name, spec.fps]));
    const anchors = renderSprite({ ...baseInput(species) }, { effects: false }).geometry;
    const pack: PackFile = { name: id, frameWidth: SPRITE_W, frameHeight: SPRITE_H, fps, anchors };
    writeFileSync(join(folder, "pack.json"), JSON.stringify(pack, null, 2));
    writeFileSync(join(folder, "LEGGIMI.txt"), readme());
    return { id, frames, files };
  }
}

/** Decodes a strip into RGBA frames, or null if its size is wrong. */
function readStrip(file: string): Uint8Array[] | null {
  const image = nativeImage.createFromPath(file);
  if (image.isEmpty()) return null;
  const { width, height } = image.getSize();
  if (height !== SPRITE_H || width % SPRITE_W !== 0 || width === 0) return null;
  // toBitmap() is BGRA with premultiplied alpha on Windows
  const bgra = image.toBitmap();
  const count = width / SPRITE_W;
  const frames: Uint8Array[] = [];
  for (let f = 0; f < count; f++) {
    const rgba = new Uint8Array(SPRITE_W * SPRITE_H * 4);
    for (let y = 0; y < SPRITE_H; y++) {
      for (let x = 0; x < SPRITE_W; x++) {
        const i = (y * width + f * SPRITE_W + x) * 4;
        const o = (y * SPRITE_W + x) * 4;
        const a = bgra[i + 3];
        if (!a) continue;
        const k = a === 255 ? 1 : 255 / a;
        rgba[o] = Math.min(255, Math.round(bgra[i + 2] * k));
        rgba[o + 1] = Math.min(255, Math.round(bgra[i + 1] * k));
        rgba[o + 2] = Math.min(255, Math.round(bgra[i] * k));
        rgba[o + 3] = a;
      }
    }
    frames.push(rgba);
  }
  return frames;
}

/** `idle_happy` -> `idle`, `talk_sad` -> `talk`. */
function stripBase(name: string): string {
  const i = name.lastIndexOf("_");
  return i > 0 && (EMOTIONS as readonly string[]).includes(name.slice(i + 1)) ? name.slice(0, i) : name;
}

function baseInput(species: SpeciesId) {
  return {
    species,
    animation: "idle" as const,
    emotion: "neutral" as const,
    locomotion: "none" as const,
    facing: "right" as const,
    talking: false,
    thinking: false,
    looking: false,
    t: 0,
    clock: 0,
    blink: false,
    look: { x: 0, y: 0 },
    effects: [],
  };
}

/** Anchors of the cat, for packs that don't say where their head is. */
function defaultAnchors(): Geometry {
  return renderSprite(baseInput("cat"), { effects: false }).geometry;
}

function readme(): string {
  return `PACCHETTO DI SPRITE DI PIXEL PET
================================

Ogni file PNG è un'animazione: i fotogrammi sono affiancati da sinistra a
destra, ognuno di ${SPRITE_W}x${SPRITE_H} pixel (quindi un file con 4 fotogrammi è
largo ${SPRITE_W * 4} pixel e alto ${SPRITE_H}). Disegna il pet rivolto verso DESTRA:
quando va a sinistra l'app lo specchia da sola. I piedi stanno sull'ultima
riga in basso. Lo sfondo deve essere trasparente.

Puoi modificare questi file, toglierne o aggiungerne fotogrammi (basta
allungare o accorciare l'immagine). Se un'animazione manca, l'app ne usa una
simile (per esempio "run" -> "walk" -> "idle"): l'unico file obbligatorio è
idle.png. Mentre l'app è aperta e il pacchetto è selezionato, ogni volta che
salvi un file il pet si aggiorna da solo.

Velocità: in pack.json, "fps" dice quanti fotogrammi al secondo mostrare per
ogni animazione. Le animazioni ricominciano da capo quando finiscono.

Emozioni: "idle_happy.png", "idle_sad.png"... sono il pet fermo con quella
espressione. Puoi aggiungere varianti anche per altre animazioni con lo
stesso schema, per esempio "sit_happy.png" o "talk_happy.png". Se una
variante manca, si usa l'animazione normale.

talk.png è il pet fermo mentre parla (bocca che si apre e chiude).

Gli effetti (cuori, zzz, note, sudore, la palla, la farfalla...) li disegna
l'app sopra ai tuoi sprite: in pack.json, "anchors" dice dove sono la testa
("headTop" è la riga in alto della testa, "cx" la colonna centrale), gli occhi
("face") e la bocca ("mouth"), contando i pixel da sinistra e dall'alto.
Anche l'altezza dei salti la aggiunge l'app.

Animazioni:
${Object.entries(STRIP_SPECS)
  .map(([name, spec]) => `  ${name.padEnd(12)} ${spec.frames} fotogrammi, ${spec.fps} al secondo`)
  .join("\n")}
`;
}
