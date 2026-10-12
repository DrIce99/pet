// Body poses for every animation, shared by all species: each species turns
// the same Pose into its own pixels.
import type { Emotion } from "../types";
import type { Face, Pose, SpriteInput, View } from "./core";

export const FACES: Record<Emotion, Face> = {
  neutral: { eyes: "normal", mouth: "cat", brows: "none", blush: 1 },
  happy: { eyes: "happy", mouth: "smile", brows: "none", blush: 1 },
  excited: { eyes: "sparkle", mouth: "laugh", brows: "none", blush: 1 },
  love: { eyes: "heart", mouth: "smile", brows: "none", blush: 2 },
  sad: { eyes: "normal", mouth: "frown", brows: "sad", blush: 0 },
  surprised: { eyes: "big", mouth: "o", brows: "raised", blush: 0 },
  sleepy: { eyes: "sleepy", mouth: "cat", brows: "none", blush: 0 },
  thinking: { eyes: "normal", mouth: "flat", brows: "none", blush: 0 },
  wink: { eyes: "wink", mouth: "smile", brows: "none", blush: 1 },
  embarrassed: { eyes: "squint", mouth: "wavy", brows: "none", blush: 2 },
  proud: { eyes: "happy", mouth: "smile", brows: "none", blush: 1 },
  worried: { eyes: "normal", mouth: "wavy", brows: "sad", blush: 0 },
  angry: { eyes: "normal", mouth: "pout", brows: "angry", blush: 0 },
};

export function jumpCurve(t: number, duration: number, height: number): { squash: number; lift: number } {
  const crouch = 0.22 * duration;
  const air = 0.5 * duration;
  const land = 0.18 * duration;
  if (t < crouch) return { squash: 0.14 * Math.sin(((t / crouch) * Math.PI) / 2), lift: 0 };
  if (t < crouch + air) return { squash: -0.1, lift: Math.round(height * Math.sin(((t - crouch) / air) * Math.PI)) };
  if (t < crouch + air + land) return { squash: 0.12 * (1 - (t - crouch - air) / land), lift: 0 };
  return { squash: 0, lift: 0 };
}

const SPIN: [View, boolean][] = [
  ["side", false],
  ["narrow", false],
  ["back", false],
  ["narrow", true],
  ["side", true],
  ["narrow", true],
  ["back", true],
  ["narrow", false],
];

export function poseFor(input: SpriteInput): Pose {
  // The first animation frame can be timestamped just before the animation started
  const clock = Math.max(0, input.clock);
  const t = Math.max(0, input.t);
  const breathe = 0.025 * Math.sin((clock * Math.PI * 2) / 2.6);
  const pose: Pose = {
    squash: breathe,
    dx: 0,
    lift: 0,
    step: null,
    tucked: false,
    lying: false,
    armL: "none",
    armR: "none",
    tailWag: Math.sin((clock * Math.PI * 2) / 2),
    tailMode: "up",
    earDroop: 0,
    earWiggle: clock % 7 < 0.25 ? 1 : 0,
    view: "side",
    flip: false,
    faceDx: 0,
    faceDy: 0,
    continuous: [],
  };
  if (input.thinking) pose.continuous.push("dots");
  if (input.looking) {
    pose.continuous.push("lens");
    pose.eyes = "big";
  }
  if (input.emotion === "embarrassed" || input.emotion === "worried") pose.continuous.push("sweat");
  if (input.emotion === "love") pose.continuous.push("hearts");

  switch (input.locomotion) {
    case "walk": {
      const step = Math.floor(clock * 8) % 4;
      return { ...pose, step, squash: step % 2 === 1 ? -0.035 : 0.01, tailWag: Math.sin(clock * Math.PI * 3) };
    }
    case "run": {
      const step = Math.floor(clock * 14) % 4;
      return { ...pose, step, squash: step % 2 === 1 ? -0.06 : 0.03, earDroop: 1, tailWag: Math.sin(clock * Math.PI * 5) };
    }
    case "drag": {
      const calm = input.emotion !== "neutral";
      return {
        ...pose,
        squash: -0.14,
        armL: "out",
        armR: "out",
        step: Math.floor(clock * 10) % 4,
        tailMode: "down",
        eyes: calm ? pose.eyes : "big",
        mouth: calm ? pose.mouth : "o",
      };
    }
    case "fall":
      return { ...pose, squash: -0.08, armL: "up", armR: "up", tailMode: "down", eyes: "big", mouth: "o" };
    case "leap":
      // Pouncing: paws stretched forward, eyes on the prize
      return { ...pose, squash: -0.12, armL: "out", armR: "out", eyes: "big", mouth: "open", earDroop: 0.6, tailWag: 0 };
    case "climb": {
      // Seen from behind, going up the side of a window: the paws reach up in turn
      const pull = Math.floor(clock * 5) % 2;
      return {
        ...pose,
        view: "back",
        squash: -0.1 + 0.03 * pull,
        armL: pull ? "reach" : "grip",
        armR: pull ? "grip" : "reach",
        step: pull ? 1 : 3,
        tailMode: "down",
        tailWag: 0.4 * Math.sin(clock * Math.PI * 2),
      };
    }
    case "none":
      break;
  }

  const sit = { tucked: true, tailMode: "curl" as const };
  switch (input.animation) {
    case "idle":
      return pose;
    case "sit":
      return { ...pose, ...sit, squash: 0.05 + breathe };
    case "lie":
      // Stretched out but awake, with a lazy tail
      return { ...pose, ...sit, lying: true, squash: 0.2 + breathe, earDroop: 0.5, tailWag: Math.sin((clock * Math.PI * 2) / 4) };
    case "sleep":
      pose.continuous.push("zzz");
      return {
        ...pose,
        ...sit,
        lying: true,
        squash: 0.2 + 0.03 * Math.sin((clock * Math.PI * 2) / 3.5),
        earDroop: 1.5,
        earWiggle: 0,
        eyes: "closed",
        mouth: "cat",
      };
    case "jump": {
      const up = t > 0.2 && t < 0.8;
      return { ...pose, ...jumpCurve(t, 1.1, 9), armL: up ? "up" : "none", armR: up ? "up" : "none" };
    }
    case "celebrate":
      pose.continuous.push("sparkles");
      return { ...pose, ...jumpCurve(t % 1.2, 1.2, 8), armL: "up", armR: "up", eyes: "happy", mouth: "laugh" };
    case "dance": {
      pose.continuous.push("notes");
      const beat = Math.floor(t / 0.25);
      return {
        ...pose,
        dx: [0, 1, 0, -1][beat % 4],
        squash: beat % 2 === 0 ? 0.06 : -0.04,
        flip: Math.floor(t) % 2 === 1,
        armL: beat % 2 === 0 ? "up" : "none",
        armR: beat % 2 === 0 ? "none" : "up",
        step: beat % 4,
        tailWag: Math.sin(clock * Math.PI * 4),
      };
    }
    case "wave":
      return { ...pose, armR: Math.floor(t / 0.25) % 2 === 0 ? "wave_hi" : "wave_lo" };
    case "spin": {
      const [view, flip] = SPIN[Math.min(7, Math.floor(t / 0.15))];
      return { ...pose, view, flip, lift: Math.round(3 * Math.sin((Math.PI * Math.min(t, 1.2)) / 1.2)) };
    }
    case "stretch": {
      const u = t / 2.6;
      if (u < 0.3) return { ...pose, squash: -0.15 * (u / 0.3), armL: "up", armR: "up" };
      if (u < 0.7) return { ...pose, squash: -0.15, armL: "up", armR: "up", eyes: "happy", mouth: "yawn" };
      return { ...pose, squash: -0.15 * Math.max(0, (1 - u) / 0.3) };
    }
    case "nod":
      return { ...pose, faceDy: Math.floor(t / 0.2) % 2 === 1 && t < 1.2 ? 1 : 0 };
    case "shake_head":
      return { ...pose, faceDx: [0, -1, 0, 1][Math.floor(t / 0.15) % 4] };
    case "think":
      pose.continuous.push("question");
      return { ...pose, look: { x: 0.8, y: -1 }, step: Math.floor(t / 0.4) % 2 === 1 ? 3 : null, tailWag: Math.sin(clock * Math.PI) };
    case "look_around":
      return { ...pose, look: t < 1 ? { x: -1, y: 0 } : t < 2 ? { x: 1, y: 0 } : { x: 0, y: 0 } };

    // ---- idle pastimes ----
    case "yawn": {
      const u = t / 2.2;
      const open = u > 0.2 && u < 0.8;
      return { ...pose, squash: -0.07 * Math.min(1, u / 0.2) * (u > 0.8 ? (1 - u) / 0.2 : 1), eyes: "closed", mouth: open ? "yawn" : "o", earDroop: open ? 0.5 : 0 };
    }
    case "groom": {
      const lick = t % 0.6 < 0.3;
      return { ...pose, ...sit, armR: lick ? "face" : "face_hi", eyes: "closed", mouth: lick ? "tongue" : "cat" };
    }
    case "scratch": {
      const fast = Math.floor(t / 0.09) % 2 === 0;
      return { ...pose, ...sit, armL: fast ? "scratch_hi" : "scratch_lo", faceDx: -1, eyes: "happy", mouth: "smile", earWiggle: fast ? 1 : 0 };
    }
    case "chase_tail": {
      const [view, flip] = SPIN[Math.floor(t / 0.1) % 8];
      return { ...pose, view, flip, step: Math.floor(clock * 14) % 4, lift: Math.round(2 * Math.abs(Math.sin(t * Math.PI * 2.5))), tailWag: Math.sin(clock * Math.PI * 6) };
    }
    case "pounce": {
      if (t < 1.2) {
        return { ...pose, squash: 0.18, dx: [0, 1, 0, -1][Math.floor(t / 0.12) % 4], eyes: "big", lookFront: { x: 1, y: 0 }, tailWag: Math.sin(clock * Math.PI * 6) };
      }
      const air = Math.max(0, Math.sin(((t - 1.2) / 0.6) * Math.PI));
      return { ...pose, lift: t < 1.8 ? Math.round(7 * air) : 0, squash: t < 1.8 ? -0.12 : 0.1, armL: "out", armR: "out", eyes: "big", mouth: "open" };
    }
    case "roll":
      return {
        ...pose,
        ...sit,
        lying: true,
        squash: 0.2,
        flip: Math.floor(t / 0.5) % 2 === 1,
        dx: [0, 1, 0, -1][Math.floor(t / 0.25) % 4],
        armL: "up",
        armR: "up",
        eyes: "happy",
        mouth: "smile",
      };
    case "hop": {
      const air = Math.sin(((t % 0.6) / 0.6) * Math.PI);
      return { ...pose, lift: Math.round(4 * air), squash: air > 0.25 ? -0.06 : 0.08 };
    }
    case "knead": {
      pose.continuous.push("purr");
      const left = Math.floor(t / 0.35) % 2 === 0;
      return { ...pose, ...sit, armL: left ? "press" : "lift", armR: left ? "lift" : "press", eyes: "closed", mouth: "cat" };
    }
    case "wag":
      return { ...pose, ...sit, tailMode: "up", tailWag: Math.sin(clock * Math.PI * 7), eyes: "happy", mouth: "smile" };
    case "peek": {
      const lean = t > 0.3 && t < 2.1;
      return lean
        ? { ...pose, squash: -0.05, faceDy: 1, faceDx: Math.floor(t / 0.6) % 2 === 0 ? 1 : 0, eyes: "big", mouth: "o", lookFront: { x: 0, y: 0 } }
        : pose;
    }
    case "play_ball": {
      const u = t / 4.5;
      const batting = u >= 0.3 && u < 0.7;
      const x = u < 0.3 ? 17 - (u / 0.3) * 7 : batting ? 10 + Math.sin((u - 0.3) * 25) * 1.5 : 10 + ((u - 0.7) / 0.3) * 10;
      return {
        ...pose,
        armR: batting && Math.floor(t / 0.25) % 2 === 0 ? "out" : "none",
        eyes: "sparkle",
        mouth: "smile",
        lookFront: { x: 1, y: 1 },
        prop: { kind: "ball", x, y: 0, anchor: "ground", frame: Math.floor(x) % 2 },
      };
    }
    case "butterfly": {
      const leaving = Math.max(0, t - 4.2);
      const x = 8 + 5 * Math.sin(t * 1.9) + leaving * 12;
      const y = -2 + 3 * Math.cos(t * 2.7) - leaving * 14;
      const jump = t > 3.4 && t < 4.2 ? jumpCurve(t - 3.4, 0.8, 6) : { squash: 0, lift: 0 };
      return {
        ...pose,
        ...jump,
        eyes: "big",
        mouth: t > 3.4 ? "open" : "o",
        lookFront: { x: x > 3 ? 1 : 0, y: -1 },
        armR: t > 3.6 && t < 4.1 ? "up" : "none",
        prop: { kind: "butterfly", x, y, anchor: "head", frame: Math.floor(t / 0.15) % 2 },
      };
    }
    case "sneeze": {
      if (t < 0.7) return { ...pose, squash: -0.06 * (t / 0.7), eyes: "squint", mouth: "o" };
      if (t < 0.95) {
        return { ...pose, squash: 0.15, lift: 1, eyes: "squint", mouth: "open", prop: { kind: "puff", x: 3 + (t - 0.7) * 16, y: 0, anchor: "mouth", frame: 0 } };
      }
      return { ...pose, eyes: "big", mouth: "wavy" };
    }
    case "stalk":
      // Crouched, rear wiggling, ready to pounce; the eyes follow the target (the mouse)
      return {
        ...pose,
        squash: 0.17,
        dx: [0, 0, 1, 0, 0, -1][Math.floor(t / 0.08) % 6],
        eyes: "big",
        tailWag: Math.sin(clock * Math.PI * 9),
      };
    case "sing": {
      pose.continuous.push("notes");
      const beat = Math.floor(t / 0.25);
      return { ...pose, ...sit, dx: [0, 0, 1, 1, 0, 0, -1, -1][beat % 8], mouth: beat % 2 === 0 ? "open" : "o", eyes: "closed" };
    }
  }
}
