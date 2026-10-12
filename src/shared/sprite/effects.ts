// Effects and props drawn around the pet after it has been mirrored to face
// its direction: hearts, Z's, notes, the yarn ball, the butterfly...
import { EFFECT_DURATION, GROUND, PX, SPRITE_W, type Color, type Geometry, type Grid, type Pose, type SpriteInput } from "./core";

const GLYPHS = {
  heart: [".X.X.", "XXXXX", "XXXXX", ".XXX.", "..X.."],
  smallHeart: ["X.X", "XXX", ".X."],
  z: ["XXXX", "..X.", ".X..", "XXXX"],
  note: ["..XXX", "..X.X", "..X..", "XXX..", "XXX.."],
  sparkle: [".X.", "XXX", ".X."],
  exclamation: ["XX", "XX", "XX", "..", "XX"],
  question: ["XXX", "..X", ".X.", "...", ".X."],
  sweat: [".X", "XX", "XX"],
  dot: ["XX", "XX"],
  lens: [".XXX.", "X...X", "X...X", ".XXX.", "....X"],
  ball: [".XY.", "XYXX", "XXYX", ".XX."],
  ballRolled: [".XX.", "XXYX", "XYXX", ".YX."],
  butterflyOpen: ["WW.WW", "WWBWW", ".W.W."],
  butterflyClosed: [".WBW.", ".WBW.", "..B.."],
  puff: [".XX.", "XXXX", ".XX."],
};

export function drawEffects(g: Grid, input: SpriteInput, pose: Pose, geo: Geometry, front: number): void {
  const { clock } = input;
  const mirror = (x: number) => (front > 0 ? x : SPRITE_W - 1 - x);
  const cx = mirror(Math.round(geo.cx - 0.5));
  const head = Math.round(geo.headTop);
  // Glyphs are positioned by their horizontal center
  const put = (rows: string[], centerX: number, topY: number, c: Color | Record<string, Color>, over = false) =>
    g.glyph(rows, Math.round(centerX - (rows[0].length - 1) / 2), Math.round(topY), c, over);

  const hearts = (age: number, count: number, small: boolean) => {
    for (let i = 0; i < count; i++) {
      const a = age - i * 0.25;
      if (a < 0 || a > 1.4) continue;
      const x = cx + (i - (count - 1) / 2) * 8 + Math.sin(a * 6 + i) * 1.2;
      put(small ? GLYPHS.smallHeart : GLYPHS.heart, x, head - 3 - a * 8, PX.heart);
    }
  };
  const sparkles = (age: number) => {
    const wave = Math.floor(age / 0.4);
    for (let i = 0; i < 5; i++) {
      if (Math.floor((age + i * 0.13) / 0.2) % 2 === 1) continue;
      put(GLYPHS.sparkle, cx + Math.sin(i * 91.7 + wave * 13.1) * 17, head + 8 + Math.cos(i * 41.3 + wave) * 8, PX.spark);
    }
  };
  const notes = (age: number) => {
    for (let i = 0; i < 2; i++) {
      const a = (age + i * 0.9) % 1.8;
      put(GLYPHS.note, cx + (i === 0 ? -14 : 13) + Math.sin(a * 5) * 1.5, head + 3 - a * 7, PX.note);
    }
  };
  // On the front side: Eevee's big tail would hide it behind the head
  const sweat = (drift: number) => put(GLYPHS.sweat, cx + front * 12, head + 5 + drift, PX.sweat);

  for (const effect of input.effects) {
    const age = clock - effect.start;
    if (age < 0 || age > EFFECT_DURATION[effect.kind]) continue;
    switch (effect.kind) {
      case "hearts":
        hearts(age, 3, false);
        break;
      case "sparkles":
        sparkles(age);
        break;
      case "exclamation":
        put(GLYPHS.exclamation, cx + 0.5, head - 7 - (age < 0.2 ? 1 : 0), PX.red);
        break;
      case "question":
        put(GLYPHS.question, cx + front * 2, head - 7, PX.white);
        break;
      case "sweat":
        sweat(Math.floor(age * 2));
        break;
      case "notes":
        notes(age);
        break;
    }
  }

  for (const kind of pose.continuous) {
    switch (kind) {
      case "zzz":
        for (let i = 0; i < 2; i++) {
          const a = (clock + i * 1.1) % 2.2;
          put(GLYPHS.z, cx + front * (11 + a * 3), head - 2 - a * 4, PX.zzz);
        }
        break;
      case "notes":
        notes(clock);
        break;
      case "sparkles":
        sparkles(clock);
        break;
      case "question":
        put(GLYPHS.question, cx + front * 3, head - 7, PX.white);
        break;
      case "dots": {
        const lit = Math.floor(clock * 3) % 4;
        for (let i = 0; i < lit; i++) put(GLYPHS.dot, cx - 5 + i * 5, head - 4, PX.white);
        break;
      }
      case "lens": {
        // A magnifying glass held in front of the eye
        const eye = mirror(geo.face.m + 4);
        put(GLYPHS.lens, eye + front, geo.face.er - 1 + (Math.floor(clock * 2) % 2), PX.white, true);
        break;
      }
      case "sweat":
        sweat(Math.floor(clock * 1.5) % 3);
        break;
      case "hearts":
        hearts(clock % 2.6, 1, true);
        break;
      case "purr":
        hearts(clock % 1.4, 1, true);
        break;
    }
  }

  const prop = pose.prop;
  if (prop) {
    const baseX = prop.anchor === "mouth" ? mirror(Math.round(geo.mouth.x)) : cx;
    const x = baseX + front * prop.x;
    switch (prop.kind) {
      case "ball":
        put(prop.frame ? GLYPHS.ballRolled : GLYPHS.ball, x, GROUND - 3 + prop.y, { X: PX.yarn, Y: PX.red }, true);
        break;
      case "butterfly":
        put(prop.frame ? GLYPHS.butterflyClosed : GLYPHS.butterflyOpen, x, head + prop.y, { W: PX.wing, B: PX.outline }, true);
        break;
      case "puff":
        put(GLYPHS.puff, x, Math.round(geo.mouth.y) - 1 + prop.y, PX.white, true);
        break;
    }
  }
}
