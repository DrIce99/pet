// Pet window renderer: draws the sprite, shows speech bubbles and the chat
// box, and turns mouse gestures into clicks, petting and drags. The window is
// click-through except where the pet, the bubble or the chat box are.
import {
  chooseStrip,
  EFFECT_DURATION,
  frameAt,
  paletteFor,
  PX,
  renderEffects,
  renderSprite,
  silhouetteTop,
  SPRITE_H,
  SPRITE_W,
  type ActiveEffect,
  type SpriteInput,
  type SpritePack,
} from "../shared/sprite";
import type { LookDirection, PetBridge, PetLayout, VisualState } from "../shared/types";

declare global {
  interface Window {
    pet: PetBridge;
  }
}

const api = window.pet;
const canvas = document.getElementById("pet") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
const bubble = document.getElementById("bubble") as HTMLDivElement;
const bubbleText = document.getElementById("bubble-text") as HTMLDivElement;
const bubbleClose = document.getElementById("bubble-close") as HTMLButtonElement;
const chat = document.getElementById("chat") as HTMLFormElement;
const chatInput = document.getElementById("chat-input") as HTMLTextAreaElement;

canvas.width = SPRITE_W;
canvas.height = SPRITE_H;
const image = ctx.createImageData(SPRITE_W, SPRITE_H);

let layout: PetLayout = { scale: 3, spriteX: 170, windowWidth: 340, windowHeight: 440, species: "cat", theme: "arancio", name: "Mochi" };
let colors = rgbPalette(layout);
let visual: VisualState = {
  animation: "idle",
  animationSeq: 0,
  emotion: "neutral",
  facing: "right",
  locomotion: "none",
  talking: false,
  thinking: false,
  looking: false,
};
let look: LookDirection = { x: 0, y: 0 };
const effects: ActiveEffect[] = [];
let animationStart = performance.now();
let lastSeq = -1;
let blinkUntil = 0;
let nextBlink = performance.now() + 3000;
/** Pixels belonging to the pet's body, for clicks and petting. */
let solid = new Uint8Array(SPRITE_W * SPRITE_H);
let lift = 0;
/** A hand-drawn sprite pack, when the user chose one. */
let pack: SpritePack | null = null;
/** Top row of the pack's idle frame (the bubble goes above it). */
let packTop: number | null = null;
let lastFrame = 0;

// ---------------- drawing ----------------

function rgbPalette(look: Pick<PetLayout, "species" | "theme">): (number[] | null)[] {
  return paletteFor(look.species, look.theme).map((hex) =>
    hex ? [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)] : null,
  );
}

function draw(now: number): void {
  const clock = now / 1000;
  if (visual.animationSeq !== lastSeq) {
    lastSeq = visual.animationSeq;
    animationStart = now;
  }
  if (now > nextBlink) {
    blinkUntil = now + 140;
    nextBlink = now + 2500 + Math.random() * 4500;
  }
  for (let i = effects.length - 1; i >= 0; i--) {
    if (clock - effects[i].start > EFFECT_DURATION[effects[i].kind]) effects.splice(i, 1);
  }
  const input: SpriteInput = {
    species: layout.species,
    animation: visual.animation,
    emotion: visual.emotion,
    locomotion: visual.locomotion,
    facing: visual.facing,
    talking: visual.talking || typing,
    thinking: visual.thinking,
    looking: visual.looking,
    t: Math.max(0, (now - animationStart) / 1000),
    clock,
    blink: now < blinkUntil,
    look,
    effects,
  };
  const frameLift = pack ? drawPack(pack, input) : drawCode(input);
  ctx.putImageData(image, 0, 0);
  if (frameLift !== lift) {
    lift = frameLift;
    canvas.style.transform = lift ? `translateY(${-lift * layout.scale}px)` : "";
  }
}

/** The sprites drawn by code, in the theme's palette. */
function drawCode(input: SpriteInput): number {
  const frame = renderSprite(input);
  const pixels = frame.pixels;
  const data = image.data;
  for (let i = 0; i < pixels.length; i++) {
    const c = colors[pixels[i]];
    const o = i * 4;
    solid[i] = pixels[i] !== PX.none && pixels[i] <= PX.mouth ? 1 : 0;
    if (!c) {
      data[o + 3] = 0;
      continue;
    }
    data[o] = c[0];
    data[o + 1] = c[1];
    data[o + 2] = c[2];
    data[o + 3] = 255;
  }
  return frame.lift;
}

/** A frame of the hand-drawn pack (mirrored when facing left) with the app's effects on top. */
function drawPack(p: SpritePack, input: SpriteInput): number {
  const name = chooseStrip((n) => Object.hasOwn(p.strips, n), input);
  // Walking and the like loop on the clock; animations start from their first frame
  const rgba = frameAt(p.strips[name], input.locomotion !== "none" ? input.clock : input.t);
  const fx = renderEffects(input, p.anchors);
  const mirror = input.facing === "left";
  const data = image.data;
  for (let y = 0; y < SPRITE_H; y++) {
    for (let x = 0; x < SPRITE_W; x++) {
      const i = y * SPRITE_W + x;
      const o = i * 4;
      const s = (y * SPRITE_W + (mirror ? SPRITE_W - 1 - x : x)) * 4;
      const effect = colors[fx.pixels[i]];
      solid[i] = rgba[s + 3] > 0 ? 1 : 0;
      if (effect) {
        data.set([effect[0], effect[1], effect[2], 255], o);
      } else {
        data.set([rgba[s], rgba[s + 1], rgba[s + 2], rgba[s + 3]], o);
      }
    }
  }
  return fx.lift;
}

/** Topmost row with an opaque pixel. */
function topRow(rgba: Uint8Array): number {
  for (let y = 0; y < SPRITE_H; y++) {
    for (let x = 0; x < SPRITE_W; x++) if (rgba[(y * SPRITE_W + x) * 4 + 3] > 0) return y;
  }
  return 0;
}

function loop(now: number): void {
  requestAnimationFrame(loop);
  if (now - lastFrame < 1000 / 12) return;
  lastFrame = now;
  draw(now);
}

// ---------------- layout ----------------

const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), Math.max(min, max));

/** Distance from the window bottom to just above the pet's ears. */
const anchor = () => (SPRITE_H - (packTop ?? silhouetteTop(layout.species)) + 2) * layout.scale;

function applyLayout(): void {
  const s = layout.scale;
  canvas.style.width = `${SPRITE_W * s}px`;
  canvas.style.height = `${SPRITE_H * s}px`;
  canvas.style.left = `${Math.round(layout.spriteX - (SPRITE_W * s) / 2)}px`;
  chatInput.placeholder = `Scrivi a ${layout.name}…`;
  placeOverlays();
}

function placeOverlays(): void {
  let bottom = anchor();
  if (!chat.hidden) {
    const w = chat.offsetWidth;
    chat.style.left = `${clamp(layout.spriteX - w / 2, 6, layout.windowWidth - w - 6)}px`;
    chat.style.bottom = `${bottom}px`;
    bottom += chat.offsetHeight + 14;
  } else {
    bottom += 6;
  }
  if (!bubble.hidden) {
    bubbleText.style.maxHeight = `${Math.max(80, Math.min(210, layout.windowHeight - bottom - 30))}px`;
    const w = bubble.offsetWidth;
    const left = clamp(layout.spriteX - w / 2, 10, layout.windowWidth - w - 10);
    bubble.style.left = `${left}px`;
    bubble.style.bottom = `${bottom}px`;
    bubble.style.setProperty("--tail-x", `${clamp(layout.spriteX - left, 18, w - 18)}px`);
  }
}

// ---------------- mouse: hover, click, petting, drag ----------------

let interactive = false;
let press: { x: number; y: number } | null = null;
let dragging = false;
let strokes = 0;
let lastStrokeDir = 0;
let strokeWindowStart = 0;
let lastPetAt = 0;

function setInteractive(on: boolean): void {
  if (on === interactive) return;
  interactive = on;
  api.setInteractive(on);
}

function overPet(x: number, y: number): boolean {
  const r = canvas.getBoundingClientRect();
  if (x < r.left || x >= r.right || y < r.top || y >= r.bottom) return false;
  const px = Math.floor(((x - r.left) / r.width) * SPRITE_W);
  const py = Math.floor(((y - r.top) / r.height) * SPRITE_H);
  // One pixel of tolerance makes the little body easier to grab
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const xx = px + dx;
      const yy = py + dy;
      if (xx < 0 || yy < 0 || xx >= SPRITE_W || yy >= SPRITE_H) continue;
      if (solid[yy * SPRITE_W + xx]) return true;
    }
  }
  return false;
}

function inside(el: HTMLElement, x: number, y: number): boolean {
  if (el.hidden) return false;
  const r = el.getBoundingClientRect();
  return x >= r.left - 4 && x <= r.right + 4 && y >= r.top - 12 && y <= r.bottom + 4;
}

function endDrag(): void {
  if (!dragging) return;
  dragging = false;
  press = null;
  canvas.classList.remove("dragging");
  api.dragEnd();
}

function detectPetting(movementX: number): void {
  if (Math.abs(movementX) < 2) return;
  const now = performance.now();
  if (now - strokeWindowStart > 1500) {
    strokes = 0;
    strokeWindowStart = now;
  }
  const dir = Math.sign(movementX);
  if (dir !== lastStrokeDir) {
    strokes++;
    lastStrokeDir = dir;
  }
  if (strokes >= 5 && now - lastPetAt > 1800) {
    lastPetAt = now;
    strokes = 0;
    api.petted();
  }
}

document.addEventListener("mousemove", (e) => {
  if (dragging && (e.buttons & 1) === 0) endDrag();
  const onPet = overPet(e.clientX, e.clientY);
  setInteractive(dragging || press !== null || onPet || inside(bubble, e.clientX, e.clientY) || inside(chat, e.clientX, e.clientY));
  if (press && !dragging && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 5) {
    dragging = true;
    canvas.classList.add("dragging");
    api.dragStart();
  }
  if (!press && onPet) detectPetting(e.movementX);
});

document.addEventListener("mouseleave", () => {
  if (!dragging && !press) setInteractive(false);
});

canvas.addEventListener("mousedown", (e) => {
  if (e.button !== 0 || !overPet(e.clientX, e.clientY)) return;
  press = { x: e.clientX, y: e.clientY };
  e.preventDefault();
});

window.addEventListener("mouseup", (e) => {
  if (e.button !== 0 || !press) return;
  if (dragging) {
    endDrag();
    return;
  }
  press = null;
  if (overPet(e.clientX, e.clientY)) api.click();
});

canvas.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  api.contextMenu();
});

// ---------------- speech bubble ----------------

let bubbleId = 0;
let target = "";
let shownChars = 0;
let ended = false;
let holdMs = 8000;
let typing = false;
let hovering = false;
let typeTimer: number | undefined;
let hideTimer: number | undefined;

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Just enough markdown for a speech bubble: code blocks, `code`, **bold**, bullet lists. */
function markdown(src: string): string {
  return src
    .split("```")
    .map((part, i) => {
      if (i % 2 === 1) return `<pre><code>${escapeHtml(part.replace(/^[\w+#-]*\n/, ""))}</code></pre>`;
      return escapeHtml(part)
        .replace(/`([^`\n]+)`/g, "<code>$1</code>")
        .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
        .split("\n")
        .map((line) => (/^\s*[-*•]\s+/.test(line) ? `<span class="li">• ${line.replace(/^\s*[-*•]\s+/, "")}</span>` : line))
        .join("\n")
        .replace(/^\n+|\n+$/g, "")
        .replace(/\n/g, "<br>");
    })
    .join("");
}

function renderBubble(text: string): void {
  bubbleText.innerHTML = markdown(text);
  bubbleText.scrollTop = bubbleText.scrollHeight;
  placeOverlays();
}

function startTyping(): void {
  if (typeTimer !== undefined) return;
  typeTimer = window.setInterval(() => {
    if (shownChars < target.length) {
      shownChars = Math.min(target.length, shownChars + Math.max(1, Math.ceil((target.length - shownChars) / 30)));
      typing = true;
      renderBubble(target.slice(0, shownChars));
      return;
    }
    typing = false;
    window.clearInterval(typeTimer);
    typeTimer = undefined;
    if (ended) scheduleHide(holdMs);
  }, 28);
}

function scheduleHide(ms: number): void {
  window.clearTimeout(hideTimer);
  if (!hovering) hideTimer = window.setTimeout(hideBubble, ms);
}

function hideBubble(): void {
  window.clearTimeout(hideTimer);
  window.clearInterval(typeTimer);
  typeTimer = undefined;
  typing = false;
  bubble.hidden = true;
  placeOverlays();
}

api.onBubbleStart(({ id, kind }) => {
  bubbleId = id;
  target = "";
  shownChars = 0;
  ended = false;
  window.clearTimeout(hideTimer);
  bubble.className = `bubble ${kind}`;
  bubbleText.innerHTML = "";
  bubble.hidden = false;
  placeOverlays();
});

api.onBubbleChunk(({ id, text }) => {
  if (id !== bubbleId) return;
  target += text;
  startTyping();
});

api.onBubbleEnd(({ id, finalText, holdMs: hold }) => {
  if (id !== bubbleId) return;
  if (!finalText.startsWith(target.slice(0, shownChars))) shownChars = 0;
  target = finalText;
  ended = true;
  holdMs = hold;
  startTyping();
});

api.onBubbleHide(() => hideBubble());

bubble.addEventListener("mouseenter", () => {
  hovering = true;
  window.clearTimeout(hideTimer);
});
bubble.addEventListener("mouseleave", () => {
  hovering = false;
  if (ended && !typing && !bubble.hidden) scheduleHide(4000);
});
bubbleText.addEventListener("click", () => {
  if (!window.getSelection()?.toString()) api.bubbleClicked();
});
bubbleClose.addEventListener("click", () => hideBubble());

// ---------------- chat box ----------------

function autoGrow(): void {
  chatInput.style.height = "auto";
  chatInput.style.height = `${Math.min(96, chatInput.scrollHeight)}px`;
  placeOverlays();
}

function sendChat(): void {
  const text = chatInput.value.trim();
  if (!text) return;
  api.send(text);
  chatInput.value = "";
  autoGrow();
}

function closeChat(): void {
  if (chat.hidden) return;
  chat.hidden = true;
  placeOverlays();
  api.closeInput();
}

api.onInputOpen(() => {
  chat.hidden = false;
  autoGrow();
  window.setTimeout(() => chatInput.focus(), 30);
});
api.onInputClose(() => {
  chat.hidden = true;
  placeOverlays();
});

chat.addEventListener("submit", (e) => {
  e.preventDefault();
  sendChat();
});
chatInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    sendChat();
  } else if (e.key === "Escape") {
    closeChat();
  }
});
chatInput.addEventListener("input", autoGrow);
window.addEventListener("blur", () => {
  endDrag();
  closeChat();
});

// ---------------- state from the main process ----------------

api.onLayout((next) => {
  if (next.theme !== layout.theme || next.species !== layout.species) colors = rgbPalette(next);
  layout = next;
  applyLayout();
});
api.onVisual((next) => {
  visual = next;
});
api.onSpritePack((next) => {
  pack = next;
  packTop = next ? topRow(next.strips.idle.frames[0]) : null;
  placeOverlays();
});
api.onLook((next) => {
  look = next;
});
api.onEffect((kind) => {
  effects.push({ kind, start: performance.now() / 1000 });
});

applyLayout();
requestAnimationFrame(loop);
api.ready();
