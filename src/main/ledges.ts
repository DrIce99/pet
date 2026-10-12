// Geometry of the window tops the pet can stand on. Pure functions, in DIP
// coordinates, so they can be tested without Electron.

export interface WindowBox {
  id: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** A visible stretch of a window's top edge. */
export interface Ledge {
  id: string;
  y: number;
  left: number;
  right: number;
  window: WindowBox;
}

export interface Area {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Visible parts of each window's top edge; `windows` are in Z-order, topmost first. */
export function findLedges(windows: WindowBox[]): Ledge[] {
  const ledges: Ledge[] = [];
  windows.forEach((w, i) => {
    let segments: [number, number][] = [[w.left, w.right]];
    for (const above of windows.slice(0, i)) {
      // A window higher in Z-order hides the edge where it covers it
      if (above.top > w.top || above.bottom <= w.top) continue;
      segments = segments.flatMap(([a, b]): [number, number][] => {
        if (above.right <= a || above.left >= b) return [[a, b]];
        const parts: [number, number][] = [];
        if (above.left > a) parts.push([a, above.left]);
        if (above.right < b) parts.push([above.right, b]);
        return parts;
      });
    }
    for (const [left, right] of segments) ledges.push({ id: w.id, y: w.top, left, right, window: w });
  });
  return ledges;
}

/**
 * Ledges on a screen with room for the pet: wide enough, with space above
 * for its body (so maximized windows don't count) and clearly above the floor.
 */
export function usableLedges(ledges: Ledge[], area: Area, spriteW: number, spriteH: number): Ledge[] {
  const floor = area.y + area.height;
  return ledges.filter((l) => {
    const middle = (Math.max(l.left, area.x) + Math.min(l.right, area.x + area.width)) / 2;
    return (
      Math.min(l.right, area.x + area.width) - Math.max(l.left, area.x) >= spriteW + 8 &&
      middle >= area.x &&
      middle <= area.x + area.width &&
      l.y >= area.y + spriteH + 40 &&
      l.y <= floor - 40
    );
  });
}

export interface ClimbSide {
  side: "left" | "right";
  /** Where the pet's center goes while climbing. */
  x: number;
}

/** The window's sides a ledge can be climbed from: the corner must be visible and the side on screen. */
export function climbSides(ledge: Ledge, area: Area, spriteW: number): ClimbSide[] {
  const half = spriteW / 2;
  const sides: ClimbSide[] = [];
  // The pet hugs the side of the window, part of its body over the edge
  const leftX = ledge.window.left - half * 0.4;
  const rightX = ledge.window.right + half * 0.4;
  if (ledge.left <= ledge.window.left + 2 && leftX - half >= area.x) sides.push({ side: "left", x: leftX });
  if (ledge.right >= ledge.window.right - 2 && rightX + half <= area.x + area.width) sides.push({ side: "right", x: rightX });
  return sides;
}

/** The side of a ledge closest to `fromX`, if it can be climbed at all. */
export function climbSide(ledge: Ledge, area: Area, spriteW: number, fromX: number): ClimbSide | null {
  const sides = climbSides(ledge, area, spriteW).sort((a, b) => Math.abs(a.x - fromX) - Math.abs(b.x - fromX));
  return sides[0] ?? null;
}

/** The stretch of window `id`'s edge under x, if it's still there. */
export function ledgeUnder(ledges: Ledge[], id: string, x: number, tolerance = 0): Ledge | null {
  return ledges.find((l) => l.id === id && x >= l.left - tolerance && x <= l.right + tolerance) ?? null;
}

/** The first ledge met by something falling at x from `fromY` down to `toY`. */
export function landingLedge(ledges: Ledge[], x: number, fromY: number, toY: number, footHalf: number): Ledge | null {
  let best: Ledge | null = null;
  for (const l of ledges) {
    if (l.y < fromY || l.y > toY || x - footHalf < l.left || x + footHalf > l.right) continue;
    if (!best || l.y < best.y) best = l;
  }
  return best;
}
