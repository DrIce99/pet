// Faces: eyes, brows, cheeks, nose and mouth, parameterized by each species'
// proportions so every emotion works for every pet.
import { PX, type Color, type Face, type Grid, type MouthStyle } from "./core";

export interface FaceMetrics {
  eyeW: 2 | 3;
  eyeH: 3 | 4;
  /** Columns between the face center and the inner edge of each eye. */
  eyeGap: number;
  /** Mouth row, relative to the top row of the eyes. */
  mouthDy: number;
  /** Cheek blush, columns from the face center to its outer pixel. */
  blushDx: number;
  nose: boolean;
  iris: boolean;
}

const MOUTHS: Record<MouthStyle, [number, number, Color?][]> = {
  cat: [
    [-2, 0],
    [-1, 1],
    [0, 0],
    [1, 1],
    [2, 0],
  ],
  smile: [
    [-2, 0],
    [2, 0],
    [-1, 1],
    [0, 1],
    [1, 1],
  ],
  open: [
    [0, 0],
    [-1, 1],
    [0, 1, PX.mouth],
    [1, 1],
    [0, 2],
  ],
  laugh: [
    [-2, 0],
    [-1, 0],
    [0, 0],
    [1, 0],
    [2, 0],
    [-2, 1],
    [-1, 1, PX.mouth],
    [0, 1, PX.mouth],
    [1, 1, PX.mouth],
    [2, 1],
    [-1, 2],
    [0, 2],
    [1, 2],
  ],
  frown: [
    [-1, 0],
    [0, 0],
    [1, 0],
    [-2, 1],
    [2, 1],
  ],
  flat: [
    [-1, 1],
    [0, 1],
    [1, 1],
  ],
  o: [
    [0, 0],
    [-1, 1],
    [1, 1],
    [0, 2],
  ],
  pout: [
    [-1, 1],
    [0, 0],
    [1, 1],
  ],
  wavy: [
    [-2, 1],
    [-1, 0],
    [0, 1],
    [1, 0],
    [2, 1],
  ],
  yawn: [
    [-1, 0],
    [0, 0],
    [1, 0],
    [-2, 1],
    [-1, 1, PX.mouth],
    [0, 1, PX.mouth],
    [1, 1, PX.mouth],
    [2, 1],
    [-2, 2],
    [-1, 2, PX.mouth],
    [0, 2, PX.mouth],
    [1, 2, PX.mouth],
    [2, 2],
    [-1, 3],
    [0, 3],
    [1, 3],
  ],
  tongue: [
    [-2, 0],
    [-1, 1],
    [0, 0],
    [1, 1],
    [2, 0],
    [0, 1, PX.mouth],
    [0, 2, PX.mouth],
  ],
};

/**
 * Draws a face whose center column is `m` and whose eyes start at row `er`.
 * `gaze` is in drawing coordinates (the sprite is drawn facing right).
 */
export function drawFace(
  g: Grid,
  m: number,
  er: number,
  metrics: FaceMetrics,
  face: Face,
  gaze: { x: number; y: number },
  blink: boolean,
): void {
  const { eyeW: w, eyeH: h, eyeGap } = metrics;
  const dot = (x: number, y: number, c: Color = PX.eye) => g.set(x, y, c);
  const lx = gaze.x > 0.45 ? 1 : gaze.x < -0.45 ? -1 : 0;
  const ly = gaze.y > 0.45 ? 1 : gaze.y < -0.45 ? -1 : 0;
  const eyeX = (side: -1 | 1) => (side < 0 ? m - eyeGap - w + 1 : m + eyeGap);
  // Three-wide expressions line up with the outer edge of each eye
  const arcX = (side: -1 | 1) => (side < 0 ? eyeX(-1) - (3 - w) : eyeX(1));
  const mid = er + Math.floor(h / 2);

  const openEye = (side: -1 | 1, tall: boolean, sparkle: boolean) => {
    const x0 = eyeX(side) + lx;
    const y0 = er + ly - (tall ? 1 : 0);
    const height = h + (tall ? 1 : 0);
    for (let dy = 0; dy < height; dy++) for (let dx = 0; dx < w; dx++) dot(x0 + dx, y0 + dy);
    if (metrics.iris) {
      for (let dy = height - 2; dy < height; dy++) dot(x0 + Math.floor(w / 2), y0 + dy, PX.iris);
    }
    dot(x0, y0, PX.shine);
    if (w === 3 && height >= 4) dot(x0, y0 + 1, PX.shine);
    if (sparkle) dot(x0 + w - 1, y0 + height - 1, PX.shine);
  };

  const drawEye = (style: Face["eyes"], side: -1 | 1): void => {
    const x3 = arcX(side);
    if ((style === "normal" || style === "big" || style === "sparkle") && blink) {
      for (let dx = 0; dx < w; dx++) dot(eyeX(side) + dx, er + h - 1);
      return;
    }
    switch (style) {
      case "normal":
        return openEye(side, false, false);
      case "sparkle":
        return openEye(side, false, true);
      case "big":
        return openEye(side, true, false);
      case "happy":
        dot(x3, mid + 1);
        dot(x3 + 1, mid);
        dot(x3 + 2, mid + 1);
        return;
      case "closed":
        dot(x3, mid);
        dot(x3 + 1, mid + 1);
        dot(x3 + 2, mid);
        return;
      case "sleepy":
        for (let dx = 0; dx < w; dx++) {
          dot(eyeX(side) + dx, er + h - 2);
          dot(eyeX(side) + dx, er + h - 1);
        }
        return;
      case "heart":
        for (const [dx, dy] of [
          [0, 0],
          [2, 0],
          [0, 1],
          [1, 1],
          [2, 1],
          [1, 2],
        ]) {
          dot(x3 + dx, er + h - 3 + dy, PX.heart);
        }
        return;
      case "squint": {
        const top = er + h - 3;
        const [outer, inner] = side < 0 ? [x3, x3 + 1] : [x3 + 2, x3 + 1];
        dot(outer, top);
        dot(inner, top + 1);
        dot(outer, top + 2);
        return;
      }
      case "wink":
        return drawEye(side < 0 ? "normal" : "happy", side);
    }
  };
  drawEye(face.eyes, -1);
  drawEye(face.eyes, 1);

  const left = arcX(-1);
  const right = arcX(1);
  const brow = (cells: [number, number][]) => cells.forEach(([x, y]) => dot(x, y, PX.outline));
  switch (face.brows) {
    case "sad":
      brow([
        [left, er - 1],
        [left + 1, er - 2],
        [left + 2, er - 2],
        [right + 2, er - 1],
        [right + 1, er - 2],
        [right, er - 2],
      ]);
      break;
    case "angry":
      brow([
        [left, er - 2],
        [left + 1, er - 2],
        [left + 2, er - 1],
        [right + 2, er - 2],
        [right + 1, er - 2],
        [right, er - 1],
      ]);
      break;
    case "raised":
      brow([
        [left + 1, er - 3],
        [left + 2, er - 3],
        [right, er - 3],
        [right + 1, er - 3],
      ]);
      break;
    case "none":
      break;
  }

  if (face.blush > 0) {
    const d = metrics.blushDx;
    for (let dy = 0; dy < face.blush; dy++) {
      for (const x of [m - d, m - d + 1, m + d - 1, m + d]) dot(x, er + h + dy, PX.blush);
    }
  }
  if (metrics.nose) dot(m, er + h - 1);
  const mr = er + metrics.mouthDy;
  for (const [dx, dy, c] of MOUTHS[face.mouth]) dot(m + dx, mr + dy, c ?? PX.eye);
}
