// Eevee: a big head with very long ears, a fluffy cream mane, slim legs and a
// bushy tail with a cream tip. Proportions follow the reference model, adapted
// to the chibi, front-facing style the cat uses.
import {
  CENTER,
  inEllipse,
  inTriangle,
  parseIcon,
  polylineDistance,
  PX,
  SPRITE_H,
  Silhouette,
  type ArmPose,
  type Color,
  type Geometry,
  type Grid,
  type Point,
  type Pose,
} from "./core";
import type { FaceMetrics } from "./face";

export const EEVEE_FACE: FaceMetrics = { eyeW: 3, eyeH: 4, eyeGap: 3, mouthDy: 5, blushDx: 7, nose: true, iris: true };

const lerp = (a: Point, b: Point, t: number): Point => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

/** Thickness along a tail, interpolated between control radii. */
function radiusAt(profile: number[], u: number): number {
  const f = u * (profile.length - 1);
  const i = Math.min(profile.length - 2, Math.floor(f));
  return profile[i] + (profile[i + 1] - profile[i]) * (f - i);
}

interface Layout {
  cx: number;
  headCy: number;
  headRx: number;
  headRy: number;
  maneCy: number;
  maneRx: number;
  maneRy: number;
  legTop: number;
}

export function drawEeveeBody(g: Grid, pose: Pose): Geometry {
  const s = new Silhouette(g);
  const ground = SPRITE_H;
  const narrow = pose.view === "narrow";
  const back = pose.view === "back";
  const spread = narrow ? 0.62 : 1;
  const cx = CENTER + 0.5 + pose.dx;
  const sitting = pose.tucked && !pose.lying;
  const crouch = Math.round(pose.squash * 8) + (sitting ? 2 : 0);
  const L: Layout = pose.lying
    ? { cx, headCy: ground - 8.2, headRx: 8.8, headRy: 6.6, maneCy: ground - 4.2, maneRx: 10.5, maneRy: 3.4, legTop: ground }
    : {
        cx,
        headCy: 25.4 + crouch,
        headRx: 9.1 * spread * (1 + pose.squash * 0.3),
        headRy: 7.5 * (1 - pose.squash * 0.4),
        maneCy: 35.6 + crouch,
        maneRx: 8.4 * spread,
        maneRy: 4.6 * (1 - pose.squash * 0.5),
        legTop: ground - 6 + (sitting ? 2 : 0),
      };
  const headTop = L.headCy - L.headRy;
  const frontLeg = (side: -1 | 1) => cx + side * 3.3 * spread + (side > 0 ? 0.2 : 0);
  const legRaised = (arm: ArmPose) => arm !== "none" && arm !== "scratch_hi" && arm !== "scratch_lo" && arm !== "press" && arm !== "lift";

  // ---- behind the body: tail, hind legs ----
  const w = pose.tailWag;
  // Sitting keeps the tail raised behind; only lying down curls it around
  const tailUp = pose.view === "side" && (pose.tailMode === "up" || (pose.tailMode === "curl" && !pose.lying));
  if (tailUp || (pose.tailMode === "down" && pose.view === "side")) {
    const pts: Point[] = tailUp
      ? [
          [cx - 5, ground - 7],
          [cx - 10.5, ground - 9.5],
          [cx - 14.2, ground - 14.5],
          [cx - 15 + w * 0.8, ground - 20],
          [cx - 13.5 + w * 1.5, ground - 24.5],
        ]
      : [
          [cx - 5, ground - 8],
          [cx - 8, ground - 5],
          [cx - 9.5 + w * 0.5, ground - 1.5],
        ];
    drawTail(s, pts, tailUp ? [1.5, 3.1, 3.9, 3.3, 0.8] : [1.6, 3, 1.2]);
  }
  if (!pose.lying && !narrow) {
    if (sitting) {
      // Folded hind legs on both sides
      for (const side of [-1, 1]) {
        s.each((x, y, px, py) => {
          if (inEllipse(px, py, cx + side * 7.4, ground - 2.6, 3, 2.6)) s.paint(x, y, py > ground - 1.4 ? PX.shade : PX.body);
        });
      }
    } else if (!back) {
      // The far hind leg peeks out behind, on the tail side
      const lifted = pose.step === 3;
      s.each((x, y, px, py) => {
        const top = ground - 5 - (lifted ? 1 : 0);
        if (py > top && py < ground - (lifted ? 1 : 0) && Math.abs(px - (cx - 7.6)) < 1.5) s.paint(x, y, PX.shade);
      });
    }
  }

  // ---- body, legs and mane ----
  if (pose.lying) {
    s.each((x, y, px, py) => {
      if (inEllipse(px, py, cx - 7, ground - 4, 11, 4)) s.paint(x, y, py > ground - 2.5 ? PX.shade : PX.body);
    });
  } else {
    s.each((x, y, px, py) => {
      if (inEllipse(px, py, cx - 0.5, ground - 5.5 + crouch * 0.5, 6.5 * spread, 3)) s.paint(x, y, PX.shade);
    });
    for (const side of [-1, 1] as const) {
      if (legRaised(side < 0 ? pose.armL : pose.armR)) continue;
      const lifted = pose.step === (side < 0 ? 1 : 3) || (side < 0 ? pose.armL : pose.armR) === "lift";
      const x0 = frontLeg(side) + (lifted ? 0.8 : 0);
      const bottom = ground - (lifted ? 1.2 : 0);
      s.each((x, y, px, py) => {
        const leg = py > L.legTop - 3 && py < bottom - 0.6 && Math.abs(px - x0) < 1.5;
        const paw = inEllipse(px, py, x0 + 0.2, bottom - 1.1, 1.95, 1.15);
        if (leg || paw) s.paint(x, y, paw && py > bottom - 1.2 ? PX.shade : PX.body);
      });
    }
  }

  // Mane: a cream collar, wide under the chin and narrowing downwards, with
  // tufts on its sides and along the bottom
  const mx = cx + 0.3;
  const maneTop = L.headCy + L.headRy * 0.4;
  const maneBottom = pose.lying ? ground - 0.5 : L.legTop + 1.5 + crouch * 0.3;
  const tall = Math.max(1, maneBottom - maneTop);
  const tri = (v: number) => 1 - Math.abs(((((v % 1) + 1) % 1) * 2) - 1);
  s.each((x, y, px, py) => {
    const f = (py - maneTop) / tall;
    if (f < 0 || f > 1.25) return;
    const half = (L.maneRx + 0.8 - (L.maneRx - 3.6) * Math.pow(Math.min(1, f), 1.5)) + 1.1 * tri(py / 2.4);
    const dx = px - mx;
    if (Math.abs(dx) > half) return;
    if (f > 1 && py > maneBottom + 1.7 * tri(dx / 2.4)) return;
    const edge = Math.abs(dx) > half - 1.3;
    const strand = f > 0.35 && (x * 3 + y * 2) % 7 === 0;
    s.paint(x, y, f > 0.72 || edge || strand ? PX.belly2 : PX.belly);
  });

  // ---- ears, then the head over their base, then the tuft ----
  for (const side of [-1, 1] as const) {
    const droop = pose.earDroop;
    const wig = pose.earWiggle * side;
    const baseIn: Point = [cx + side * 3.2 * spread, headTop + 1.6];
    const baseOut: Point = [cx + side * 8.3 * spread, L.headCy - 2];
    const tip: Point = narrow
      ? [cx + side * 6.5, headTop - 10]
      : [cx + side * (15.2 + droop * 1.2) + wig, headTop - 9.2 + droop * 3.4];
    const mid = lerp(baseIn, baseOut, 0.5);
    const innerTip = lerp(tip, mid, 0.14);
    const innerA = lerp(lerp(baseIn, tip, 0.1), baseOut, 0.16);
    const innerB = lerp(lerp(baseOut, tip, 0.16), baseIn, 0.16);
    s.each((x, y, px, py) => {
      if (!inTriangle(px, py, tip, baseIn, baseOut)) return;
      s.paint(x, y, !back && inTriangle(px, py, innerTip, innerA, innerB) ? PX.ear : PX.body);
    });
  }

  s.each((x, y, px, py) => {
    const nx = (px - cx) / L.headRx;
    const ny = (py - L.headCy) / L.headRy;
    const d = nx * nx + ny * ny;
    if (d > 1) return;
    let c: Color = PX.body;
    if (ny > 0.62) c = PX.shade;
    else if (nx < -0.25 && ny < -0.35 && d < 0.75) c = PX.light;
    s.paint(x, y, c);
  });

  const tufts: [number, number, number][] = [
    [-2.6, -2.1, 1.3],
    [-0.2, -3.1, 1.4],
    [2.3, -1.9, 1.2],
  ];
  for (const [dx, h, half] of tufts) {
    const base = cx + dx * spread;
    s.each((x, y, px, py) => {
      if (inTriangle(px, py, [base - half, headTop + 1.4], [base + half, headTop + 1.4], [base + 0.4, headTop + h])) s.paint(x, y, PX.body);
    });
  }

  if (pose.lying) {
    // Front paws tucked under the chin
    for (const side of [-1, 1]) {
      s.each((x, y, px, py) => {
        if (inEllipse(px, py, cx + side * 3.6, ground - 1.1, 1.9, 1.1)) s.paint(x, y, PX.body);
      });
    }
  }

  if (back) {
    // Seen from behind the tail covers the middle of the body
    drawTail(
      s,
      [
        [cx, ground - 5],
        [cx + 0.3, ground - 10],
        [cx + w * 0.8, ground - 15.5],
        [cx + w * 1.4, ground - 19.5],
      ],
      [3, 4.4, 3.6, 1.2],
      0.66,
    );
  } else if (pose.tailMode === "curl" && pose.lying && pose.view === "side") {
    drawTail(
      s,
      [
        [cx - 6.5, ground - 4],
        [cx - 11, ground - 2.6],
        [cx - 9, ground - 0.9],
        [cx - 2, ground - 0.8],
        [cx + 4.5, ground - 1.6],
      ],
      [2, 2.6, 2.2, 1.8, 0.9],
    );
  }
  s.outline();

  const m = Math.round(cx - 0.5) + (pose.view === "side" ? 1 : 2) + pose.faceDx;
  const er = Math.round(L.headCy - 0.5) - 1 + pose.faceDy;
  return { cx, headTop, face: { m, er }, mouth: { x: m, y: er + EEVEE_FACE.mouthDy } };
}

function drawTail(s: Silhouette, pts: Point[], profile: number[], creamFrom = 0.7): void {
  s.each((x, y, px, py) => {
    const { d, u } = polylineDistance(px, py, pts);
    if (d > radiusAt(profile, u)) return;
    // Jagged boundary between the brown tail and its cream tip
    const jag = (((x * 7 + y * 3) % 5) - 2) * 0.025;
    s.paint(x, y, u > creamFrom + jag ? PX.belly : d > radiusAt(profile, u) - 1.1 && u < creamFrom ? PX.shade : PX.body);
  });
}

/** Raised front legs and paws, drawn over the body with their own outline. */
export function drawEeveeLimbs(g: Grid, pose: Pose, geo: Geometry): void {
  const ground = SPRITE_H;
  const { m, er } = geo.face;
  if (pose.lying) return;
  for (const [side, arm] of [
    [-1, pose.armL],
    [1, pose.armR],
  ] as const) {
    // Raised legs start at the side of the mane so they don't cross it
    const shoulder: Point = [geo.cx + side * 5.2, ground - 8.5];
    let path: [Point, Point] | null = null;
    let paw: [number, number, number, number] | null = null;
    switch (arm) {
      case "up":
        path = [shoulder, [geo.cx + side * 10.4, ground - 12.8]];
        break;
      case "out":
        path = [shoulder, [geo.cx + side * 9, ground - 4]];
        break;
      case "wave_hi":
        path = [shoulder, [geo.cx + side * 8.6, er + 2]];
        break;
      case "wave_lo":
        path = [shoulder, [geo.cx + side * 9.6, er + 5.5]];
        break;
      case "face":
        path = [[geo.cx + side * 3.4, ground - 7.5], [geo.mouth.x + 1.2, geo.mouth.y + 1]];
        break;
      case "face_hi":
        path = [[geo.cx + side * 3.4, ground - 7.5], [m + 4.5, er + 3]];
        break;
      case "reach":
        path = [shoulder, [geo.cx + side * 8.5, geo.headTop + 3]];
        break;
      case "grip":
        path = [shoulder, [geo.cx + side * 9.5, ground - 4.5]];
        break;
      case "scratch_hi":
        paw = [geo.cx + side * 10.4, geo.headTop + 3, 1.7, 1.5];
        break;
      case "scratch_lo":
        paw = [geo.cx + side * 10.8, geo.headTop + 4.6, 1.7, 1.5];
        break;
      default:
        break;
    }
    if (path) {
      const [a, b] = path;
      g.limb((px, py) => polylineDistance(px, py, [a, b]).d <= 1.35 || inEllipse(px, py, b[0], b[1], 1.8, 1.6), PX.body);
    }
    if (paw) g.limb((px, py) => inEllipse(px, py, paw[0], paw[1], paw[2], paw[3]), PX.body);
  }
}

export const EEVEE_ICON = parseIcon(
  [
    "O..............O",
    "OO............OO",
    "OEO..........OEO",
    "OEEO........OEEO",
    ".OEEO.OOOO.OEEO.",
    ".OBEEOBBBBOEEBO.",
    "..OBBBBBBBBBBO..",
    ".OBBBBBBBBBBBBO.",
    ".OBBWKBBBBWKBBO.",
    ".OBBKKBBBBKKBBO.",
    ".OBBKKBBBBKKBBO.",
    ".OBBBBBKKBBBBBO.",
    "..OCCCBBBBCCCO..",
    ".OCCCCCCCCCCCCO.",
    "..OCCCCCCCCCCO..",
    "...OOOOOOOOOO...",
  ],
  { O: PX.outline, B: PX.body, E: PX.ear, K: PX.eye, W: PX.shine, C: PX.belly },
);
