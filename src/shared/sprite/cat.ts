// The cat: a round body with pointy ears, a belly patch and a curly tail.
import {
  CENTER,
  GROUND,
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

export const CAT_FACE: FaceMetrics = { eyeW: 2, eyeH: 3, eyeGap: 3, mouthDy: 4, blushDx: 6, nose: false, iris: false };

export function drawCatBody(g: Grid, pose: Pose): Geometry {
  let rx = 11 * (1 + pose.squash);
  const ry = 9 * (1 - pose.squash);
  const narrow = pose.view === "narrow";
  if (narrow) rx *= 0.6;
  const bottom = pose.tucked ? SPRITE_H : GROUND;
  const cx = CENTER + 0.5 + pose.dx;
  const cy = bottom - ry;
  const top = cy - ry;
  const s = new Silhouette(g);

  // Tail behind the body (side views): a question-mark curve from the low back
  if (pose.view === "side") {
    const back = cx - rx;
    const w = pose.tailWag;
    const pts: Point[] =
      pose.tailMode === "curl"
        ? [
            [back + 1.7, bottom - 1.5],
            [back - 1.3, bottom - 1.3],
            [back - 2.8, bottom - 2.6],
            [back - 2.8 + w * 0.5, bottom - 4.6],
          ]
        : pose.tailMode === "down"
          ? [
              [back + 1.2, cy + 2],
              [back - 1, cy + 4.5],
              [back - 1.5 + w * 0.5, cy + 8],
            ]
          : [
              [back + 1.5, bottom - 2.5],
              [back - 2, bottom - 3.6],
              [back - 4.3, bottom - 6.2],
              [back - 5.2 + w * 0.6, bottom - 9.6],
              [back - 4.2 + w * 1.2, bottom - 12.2],
            ];
    s.each((x, y, px, py) => {
      const { d, u } = polylineDistance(px, py, pts);
      if (d <= 1.05) s.paint(x, y, u > 1 - 1 / (pts.length - 1) ? PX.light : PX.body);
    });
  }

  // Ears, then the body over their base so the pink only shows outside
  const spread = narrow ? 0.6 : 1;
  for (const side of [-1, 1]) {
    const wig = pose.earWiggle * side;
    const tip: Point = [cx + side * 7 * spread + wig, top - 5 + pose.earDroop];
    const outer: Point = [cx + side * 10.5 * spread, top + 3.5];
    const inner: Point = [cx + side * 2.5 * spread, top + 1];
    const tipIn: Point = [cx + side * 7 * spread + wig * 0.5, top - 2.5 + pose.earDroop];
    const outerIn: Point = [cx + side * 9 * spread, top + 2.5];
    const innerIn: Point = [cx + side * 4.5 * spread, top + 1.5];
    s.each((x, y, px, py) => {
      if (inTriangle(px, py, tip, outer, inner)) {
        s.paint(x, y, pose.view !== "back" && inTriangle(px, py, tipIn, outerIn, innerIn) ? PX.ear : PX.body);
      }
    });
  }

  s.each((x, y, px, py) => {
    const nx = (px - cx) / rx;
    const ny = (py - cy) / ry;
    const d = nx * nx + ny * ny;
    if (d > 1) return;
    let c: Color = PX.body;
    if (ny > 0.55) c = PX.shade;
    else if (nx < -0.3 && ny < -0.4 && d < 0.8) c = PX.light;
    if (pose.view === "side" && inEllipse(px, py, cx + 2.5, cy + ry * 0.42, rx * 0.42, ry * 0.42)) c = PX.belly;
    s.paint(x, y, c);
  });

  if (pose.view === "back") {
    const w = pose.tailWag;
    const pts: Point[] = [
      [cx, cy + 4],
      [cx, cy + 1],
      [cx + w * 0.8, cy - 2],
    ];
    s.each((x, y, px, py) => {
      if (polylineDistance(px, py, pts).d <= 1.1) g.set(x, y, PX.shade);
    });
  }

  if (!pose.tucked) {
    for (const side of [-1, 1]) {
      const lifted = pose.step === (side < 0 ? 1 : 3);
      const fx = Math.round(cx + side * 5 - 2 + (lifted ? 1 : 0));
      const fy = lifted ? GROUND - 2 : GROUND - 1;
      for (let x = fx; x < fx + 4; x++) for (let y = fy; y <= fy + 1; y++) s.paint(x, y, PX.shade);
    }
  }

  // Arms that stick out of the silhouette share its outline
  const arms: [number, ArmPose][] = [
    [-1, pose.armL],
    [1, pose.armR],
  ];
  for (const [side, arm] of arms) {
    if (narrow) continue;
    const spec = (
      {
        up: [rx - 0.5, -4.5, 1.3, 2],
        out: [rx + 1, 0.5, 2, 1.2],
        wave_hi: [rx + 0.5, -6, 1.2, 2],
        wave_lo: [rx + 1.8, -4, 1.3, 1.6],
        reach: [rx + 0.6, -7.5, 1.4, 2.4],
        grip: [rx + 1.2, 2.5, 1.4, 1.6],
      } as Partial<
        Record<ArmPose, number[]>
      >
    )[arm];
    if (!spec) continue;
    const ax = cx + side * spec[0];
    const ay = cy + spec[1];
    s.each((x, y, px, py) => {
      if (inEllipse(px, py, ax, ay, spec[2], spec[3])) s.paint(x, y, PX.body);
    });
  }
  s.outline();

  const m = Math.round(cx - 0.5) + (pose.view === "side" ? 1 : 2) + pose.faceDx;
  const er = Math.round(cy - 0.5) - 3 + pose.faceDy;
  return { cx, headTop: top, face: { m, er }, mouth: { x: m, y: er + CAT_FACE.mouthDy } };
}

/** Paws drawn over the face and body (grooming, scratching, kneading). */
export function drawCatPaws(g: Grid, pose: Pose, geo: Geometry): void {
  const { m, er } = geo.face;
  const bottom = SPRITE_H;
  for (const [side, arm] of [
    [-1, pose.armL],
    [1, pose.armR],
  ] as const) {
    const at: Partial<Record<ArmPose, [number, number, number, number]>> = {
      face: [m + 1.5, er + 4.8, 1.8, 1.6],
      face_hi: [m + 4.5, er + 2.5, 1.8, 1.6],
      scratch_hi: [geo.cx + side * 10, geo.headTop + 2, 1.6, 1.5],
      scratch_lo: [geo.cx + side * 10.5, geo.headTop + 3.5, 1.6, 1.5],
      press: [geo.cx + side * 3.5, bottom - 1.2, 1.8, 1.1],
      lift: [geo.cx + side * 3.5, bottom - 2.4, 1.8, 1.1],
    };
    const spec = at[arm];
    if (spec) g.limb((px, py) => inEllipse(px, py, spec[0], spec[1], spec[2], spec[3]), PX.light);
  }
}

export const CAT_ICON = parseIcon(
  [
    "................",
    "..O..........O..",
    "..OO........OO..",
    "..OEO......OEO..",
    ".OBEEOOOOOOEEBO.",
    ".OBBBBBBBBBBBBO.",
    "OBBBBBBBBBBBBBBO",
    "OBBWKBBBBBBWKBBO",
    "OBBKKBBBBBBKKBBO",
    "OBPBBBKBBKBBBPBO",
    "OBBBBBBKKBBBBBBO",
    "OSBBBBBBBBBBBBSO",
    ".OSSBBBBBBBBSSO.",
    "..OSSSSSSSSSSO..",
    "...OOOOOOOOOO...",
    "................",
  ],
  { O: PX.outline, B: PX.body, S: PX.shade, E: PX.ear, K: PX.eye, W: PX.shine, P: PX.blush },
);
