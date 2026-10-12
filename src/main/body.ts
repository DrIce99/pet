// The pet's physical presence: window placement, walking along the bottom
// edge of a screen or the top of another window, climbing, being dragged,
// falling, and moving between monitors.
//
// The window is wider than the sprite (it hosts the speech bubble). While the
// pet walks, the window follows it but stays inside the screen; near an edge
// the sprite moves inside the window instead, so the bubble is never cut off.
import { screen, type BrowserWindow, type Display, type Rectangle } from "electron";
import { SPRITE_H, SPRITE_W } from "../shared/sprite";
import type { Facing, Locomotion } from "../shared/types";
import { climbSide, climbSides, ledgeUnder, landingLedge, usableLedges, type Ledge } from "./ledges";

const TICK_MS = 33;
const WALK_SPEED = 70;
const RUN_SPEED = 180;
const CLIMB_SPEED = 110;
const GRAVITY = 2600;
/** How often the window under the pet (or being climbed) is checked. */
const WATCH_MS = 50;
/** Space above the sprite for the bubble and the input box. */
const BUBBLE_SPACE = 300;

export interface BodyHost {
  setLocomotion(locomotion: Locomotion): void;
  setFacing(facing: Facing): void;
  layoutChanged(spriteX: number, width: number, height: number): void;
  /** The pet touched the ground after a fall (`fromDrag` when the user dropped it). */
  landed(display: Display, fromDrag: boolean): void;
  /** The window the pet stood on (or was climbing) went away under its feet. */
  slipped(): void;
}

export interface Surroundings {
  /** Visible top edges of the other windows, in DIP. */
  ledges(): Ledge[];
  /** Whether the user lets the pet climb on windows. */
  climbing(): boolean;
}

export type Place = "floor" | "window" | "climbing";

/** Displays ordered left to right, which is how screens are numbered for Claude. */
export function sortedDisplays(): Display[] {
  return screen.getAllDisplays().sort((a, b) => a.bounds.x - b.bounds.x || a.bounds.y - b.bounds.y);
}

export class Body {
  facing: Facing = "right";
  private display: Display;
  private x: number;
  private feetY: number;
  private mode: "rest" | "walk" | "drag" | "fall" | "climb" = "rest";
  private targetX = 0;
  private speed = WALK_SPEED;
  /** Resolves the current walk, climb or deliberate fall. */
  private arrive: ((arrived: boolean) => void) | null = null;
  private velocityY = 0;
  private velocityX = 0;
  private fallFromDrag = false;
  /** Whether a fall can end on a window instead of the floor. */
  private fallOntoLedges = false;
  private grab = { dx: 0, dy: 0 };
  /** The window whose top edge the pet stands on. */
  private perch: { id: string; ledge: Ledge } | null = null;
  /** The window being climbed, on which side, and where its top is. */
  private climb: { id: string; side: "left" | "right"; top: number; edgeX: number } | null = null;
  private timer: NodeJS.Timeout | null = null;
  private watchTimer: NodeJS.Timeout | null = null;
  private lastTick = 0;
  private width = 0;
  private height = 0;
  private lastBounds: Rectangle | null = null;
  private lastSpriteX = Number.NaN;

  constructor(
    private readonly win: BrowserWindow,
    private readonly host: BodyHost,
    private readonly surroundings: Surroundings,
    private scale: number,
    start?: { displayId: number; fraction: number },
  ) {
    this.display = sortedDisplays().find((d) => d.id === start?.displayId) ?? screen.getPrimaryDisplay();
    const wa = this.display.workArea;
    this.x = wa.x + wa.width * (start?.fraction ?? 0.8);
    this.feetY = this.floor();
    this.computeSize();
    this.x = this.clampX(this.x);
  }

  /** Places the window for the first time. */
  place(): void {
    this.apply(true);
  }

  setScale(scale: number): void {
    this.scale = scale;
    this.computeSize();
    this.x = this.clampX(this.x);
    this.apply(true);
  }

  currentDisplay(): Display {
    return this.display;
  }

  position(): { x: number; feetY: number } {
    return { x: this.x, feetY: this.feetY };
  }

  headPoint(): { x: number; y: number } {
    return { x: this.x, y: this.feetY - SPRITE_H * this.scale * 0.55 };
  }

  where(): Place {
    return this.mode === "climb" ? "climbing" : this.perch ? "window" : "floor";
  }

  /** Horizontal position as a fraction of the current screen, for restoring it later. */
  fraction(): number {
    const wa = this.display.workArea;
    return Math.min(1, Math.max(0, (this.x - wa.x) / wa.width));
  }

  isBusy(): boolean {
    return this.mode !== "rest";
  }

  /** Dragged, falling or climbing: the pet can't be sent anywhere else right now. */
  isHeld(): boolean {
    return this.mode === "drag" || this.mode === "fall" || this.mode === "climb";
  }

  /**
   * Walks to an x on the current screen; resolves false if interrupted. On a
   * window the walk stays on its edge, unless `leaveWindow` lets the pet hop
   * down to reach an x beyond it.
   */
  async walkTo(x: number, run = false, leaveWindow = false): Promise<boolean> {
    if (this.isHeld()) return false;
    this.stop();
    if (this.perch && leaveWindow) {
      const half = this.half();
      const { left, right } = this.perch.ledge;
      if (x < left + half || x > right - half) {
        if (!(await this.getDown(x < this.x ? "left" : "right"))) return false;
      }
    }
    const target = this.clampX(x);
    if (Math.abs(target - this.x) < 2) return true;
    return this.startWalk(target, run);
  }

  /** Where the front paws are (roughly in front of the face), for catching things. */
  pawPoint(): { x: number; y: number } {
    const dir = this.facing === "right" ? 1 : -1;
    return { x: this.x + dir * this.spriteWidth() * 0.3, y: this.feetY - this.spriteHeight() * 0.55 };
  }

  /** The sprite's box on screen. */
  box(): { left: number; top: number; right: number; bottom: number } {
    const half = this.half();
    return { left: this.x - half, top: this.feetY - this.spriteHeight(), right: this.x + half, bottom: this.feetY };
  }

  /** Turns toward an x without moving. */
  face(x: number): void {
    if (Math.abs(x - this.x) > 4) this.setFacing(x > this.x ? "right" : "left");
  }

  /**
   * Leaps so that the front paws pass through `target` at the top of the jump,
   * then lands on the floor or on a window. Resolves false if it couldn't jump.
   */
  leap(target: { x: number; y: number }): Promise<boolean> {
    if (this.isHeld()) return Promise.resolve(false);
    this.stop();
    this.face(target.x);
    const paw = this.pawPoint();
    const height = Math.min(360, Math.max(24, paw.y - target.y + 10));
    const vy = Math.sqrt(2 * GRAVITY * height);
    const vx = Math.max(-900, Math.min(900, (target.x - paw.x) / (vy / GRAVITY)));
    this.startFall(false, true, "leap");
    this.velocityY = -vy;
    this.velocityX = vx;
    return new Promise((resolve) => {
      this.arrive = resolve;
    });
  }

  /** Whether there's a window top on this screen the pet could climb right now. */
  canClimb(): boolean {
    return this.climbTargets().length > 0;
  }

  /** Walks to a window on this screen, climbs up its side and settles on top. */
  async climbWindow(): Promise<boolean> {
    if (this.isHeld()) return false;
    this.stop();
    const targets = this.climbTargets();
    if (!targets.length) return false;
    const target = targets[Math.floor(Math.random() * targets.length)];
    if (this.perch && !(await this.getDown())) return false;
    // The pet may have landed somewhere else: look at the side again from here
    const side = climbSide(target.ledge, this.display.workArea, this.spriteWidth(), this.x);
    if (!side || !(await this.walkTo(side.x))) return false;
    this.climb = { id: target.ledge.id, side: side.side, top: target.ledge.y, edgeX: side.x };
    this.mode = "climb";
    this.setFacing(side.side === "left" ? "right" : "left");
    this.host.setLocomotion("climb");
    this.ensureTicking();
    this.ensureWatching();
    return new Promise((resolve) => {
      this.arrive = resolve;
    });
  }

  /** Hops down from the window the pet is on (toward `direction` if given) and lands on the floor. */
  async getDown(direction?: "left" | "right"): Promise<boolean> {
    if (!this.perch) return true;
    if (this.isHeld()) return false;
    this.stop();
    const { left, right } = this.perch.ledge;
    const toLeft = direction ? direction === "left" : this.x - left < right - this.x;
    const half = this.half();
    if (!(await this.startWalk(this.clampX(toLeft ? left : right), false))) return false;
    // One step past the edge, then down
    this.x = toLeft ? left - half * 0.5 : right + half * 0.5;
    this.perch = null;
    this.x = this.clampX(this.x);
    this.startFall(false, false);
    return new Promise((resolve) => {
      this.arrive = resolve;
    });
  }

  /** Leaves the current screen and enters `target`, walking across the edge when the screens are side by side. */
  async goToDisplay(target: Display): Promise<boolean> {
    if (this.isHeld()) return false;
    this.stop();
    if (target.id === this.display.id) return true;
    if (this.perch && !(await this.getDown())) return false;
    const from = this.display.bounds;
    const to = target.bounds;
    const half = this.half() + 6;
    const toRight = to.x >= from.x + from.width - 1;
    const toLeft = to.x + to.width <= from.x + 1;

    if (toRight || toLeft) {
      const wa = this.display.workArea;
      const exited = await this.startWalk(toRight ? wa.x + wa.width + half : wa.x - half, true);
      if (!exited) return false;
      this.display = target;
      const twa = target.workArea;
      this.x = toRight ? twa.x - half : twa.x + twa.width + half;
      this.feetY = this.floor();
      this.apply(true);
      this.settleBounds();
      return this.startWalk(this.clampX(toRight ? twa.x + twa.width * 0.15 : twa.x + twa.width * 0.85), true);
    }

    // Screens stacked vertically: drop in from the top of the target
    this.display = target;
    const twa = target.workArea;
    this.x = this.clampX(twa.x + twa.width / 2);
    this.feetY = twa.y + SPRITE_H * this.scale;
    this.startFall(false, false);
    this.settleBounds();
    return true;
  }

  /** Stops walking; pending walks resolve false. */
  stop(): void {
    if (this.mode === "walk") {
      this.mode = "rest";
      this.host.setLocomotion("none");
    }
    if (this.mode === "rest") this.settle(false);
  }

  startDrag(): void {
    this.stop();
    this.settle(false);
    this.perch = null;
    this.climb = null;
    const cursor = screen.getCursorScreenPoint();
    this.grab = { dx: cursor.x - this.x, dy: cursor.y - this.feetY };
    this.mode = "drag";
    this.host.setLocomotion("drag");
    this.ensureTicking();
  }

  endDrag(): void {
    if (this.mode !== "drag") return;
    this.display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    this.startFall(true, true);
  }

  /** Re-reads display geometry after monitors are added, removed or rescaled. */
  refreshDisplays(): void {
    const current = sortedDisplays().find((d) => d.id === this.display.id);
    this.display = current ?? screen.getPrimaryDisplay();
    if (!this.isHeld() && !this.perch) {
      this.feetY = this.floor();
      this.x = this.clampX(this.x);
    }
    this.apply(true);
  }

  /** Gets off the windows for good (climbing was turned off). */
  leaveWindows(): void {
    if (this.perch && !this.isHeld()) void this.getDown();
    else if (this.mode === "climb") this.slip();
  }

  // ---- internals ----

  private startWalk(target: number, run: boolean): Promise<boolean> {
    this.mode = "walk";
    this.targetX = target;
    this.speed = run ? RUN_SPEED : WALK_SPEED;
    this.setFacing(target > this.x ? "right" : "left");
    this.host.setLocomotion(run ? "run" : "walk");
    this.ensureTicking();
    return new Promise((resolve) => {
      this.arrive = resolve;
    });
  }

  private startFall(fromDrag: boolean, ontoLedges: boolean, locomotion: Locomotion = "fall"): void {
    this.mode = "fall";
    this.perch = null;
    this.climb = null;
    this.fallFromDrag = fromDrag;
    this.fallOntoLedges = ontoLedges;
    this.velocityY = 0;
    this.velocityX = 0;
    this.host.setLocomotion(locomotion);
    this.apply(true);
    this.ensureTicking();
  }

  /** The window went away: fall from wherever the pet is, maybe onto another window. */
  private slip(): void {
    const arrive = this.arrive;
    this.arrive = null;
    this.startFall(false, true);
    arrive?.(false);
    this.host.slipped();
  }

  /** Resolves the pending movement. */
  private settle(arrived: boolean): void {
    const arrive = this.arrive;
    this.arrive = null;
    arrive?.(arrived);
  }

  private tick(): void {
    const now = Date.now();
    const dt = Math.min(0.1, (now - this.lastTick) / 1000);
    this.lastTick = now;
    switch (this.mode) {
      case "walk": {
        const step = this.speed * dt;
        if (Math.abs(this.targetX - this.x) <= step) {
          this.x = this.targetX;
          this.mode = "rest";
          this.host.setLocomotion("none");
          this.settle(true);
        } else {
          this.x += Math.sign(this.targetX - this.x) * step;
        }
        break;
      }
      case "drag": {
        const cursor = screen.getCursorScreenPoint();
        this.x = cursor.x - this.grab.dx;
        this.feetY = cursor.y - this.grab.dy;
        break;
      }
      case "fall": {
        const ground = this.floor();
        const from = this.feetY;
        if (this.velocityX) {
          // A leap: move sideways too, stopping at the screen's edges
          const wa = this.display.workArea;
          const half = this.half();
          const x = this.x + this.velocityX * dt;
          this.x = Math.min(Math.max(x, wa.x + half), wa.x + wa.width - half);
          if (this.x !== x) this.velocityX = 0;
        }
        this.velocityY += GRAVITY * dt;
        let to = Math.min(ground, from + this.velocityY * dt);
        const ledge = this.fallOntoLedges && this.surroundings.climbing() ? landingLedge(this.usable(), this.x, from, to, this.half() * 0.5) : null;
        if (ledge) to = ledge.y;
        this.feetY = to;
        if (ledge || to >= ground) {
          this.mode = "rest";
          this.velocityX = 0;
          if (ledge) {
            this.perch = { id: ledge.id, ledge };
            this.ensureWatching();
          }
          this.x = this.clampX(this.x);
          this.host.setLocomotion("none");
          this.host.landed(this.display, this.fallFromDrag);
          this.settle(true);
          this.settleBounds();
        }
        break;
      }
      case "climb": {
        const climb = this.climb!;
        this.x = climb.edgeX;
        this.feetY = Math.max(climb.top, this.feetY - CLIMB_SPEED * dt);
        if (this.feetY <= climb.top) this.reachTop(climb);
        break;
      }
      case "rest":
        this.stopTicking();
        return;
    }
    this.apply();
  }

  /** At the top of the side: steps onto the window's edge. */
  private reachTop(climb: NonNullable<Body["climb"]>): void {
    this.climb = null;
    const area = this.display.workArea;
    const ledge = this.usable().find((l) => l.id === climb.id && climbSides(l, area, this.spriteWidth()).some((s) => s.side === climb.side));
    if (!ledge) {
      this.slip();
      return;
    }
    this.mode = "rest";
    this.perch = { id: ledge.id, ledge };
    this.feetY = ledge.y;
    const half = this.half();
    this.x = this.clampX(climb.side === "left" ? ledge.left + half + 4 : ledge.right - half - 4);
    this.setFacing(climb.side === "left" ? "right" : "left");
    this.host.setLocomotion("none");
    this.settle(true);
  }

  /** Follows the window under the pet (or being climbed) and falls when it's gone. */
  private watch(): void {
    if (this.climb && this.mode === "climb") {
      const climb = this.climb;
      const area = this.display.workArea;
      // The window moved: follow its side; it closed or its corner got covered: fall
      const side = this.usable()
        .filter((l) => l.id === climb.id)
        .flatMap((l) => climbSides(l, area, this.spriteWidth()).map((s) => ({ ...s, top: l.y })))
        .find((s) => s.side === climb.side);
      if (!side) {
        this.slip();
        return;
      }
      climb.top = side.top;
      climb.edgeX = side.x;
      return;
    }
    if (!this.perch) {
      this.stopWatching();
      return;
    }
    const ledges = this.surroundings.ledges();
    const previous = this.perch.ledge.window;
    const now = ledges.find((l) => l.id === this.perch!.id)?.window;
    if (!now) {
      this.slip();
      return;
    }
    // The window moved: ride along
    const dx = now.left - previous.left;
    this.x += dx;
    if (this.mode === "walk") this.targetX += dx;
    this.feetY = now.top;
    const display = screen.getDisplayNearestPoint({ x: Math.round(this.x), y: Math.round(this.feetY - 1) });
    if (display.id !== this.display.id) this.display = display;
    const ledge = ledgeUnder(usableLedges(ledges, this.display.workArea, this.spriteWidth(), this.spriteHeight()), this.perch.id, this.x);
    if (!ledge) {
      // Covered by another window, shrunk, maximized or off screen
      this.slip();
      return;
    }
    this.perch.ledge = ledge;
    if (this.mode === "rest") this.x = this.clampX(this.x);
    this.apply();
  }

  private climbTargets(): { ledge: Ledge }[] {
    if (!this.surroundings.climbing() || this.isHeld()) return [];
    const area = this.display.workArea;
    return this.usable()
      .filter((l) => l.id !== this.perch?.id && climbSide(l, area, this.spriteWidth(), this.x))
      .map((ledge) => ({ ledge }));
  }

  private usable(): Ledge[] {
    return usableLedges(this.surroundings.ledges(), this.display.workArea, this.spriteWidth(), this.spriteHeight());
  }

  private apply(force = false): void {
    const wa = this.display.workArea;
    const free = this.mode === "drag" || this.mode === "fall";
    const wx = free ? this.x - this.width / 2 : Math.min(Math.max(this.x - this.width / 2, wa.x), wa.x + wa.width - this.width);
    const bounds = { x: Math.round(wx), y: Math.round(this.feetY - this.height), width: this.width, height: this.height };
    const last = this.lastBounds;
    if (force || !last || last.x !== bounds.x || last.y !== bounds.y || last.width !== bounds.width || last.height !== bounds.height) {
      this.win.setBounds(bounds);
      this.lastBounds = bounds;
    }
    const spriteX = Math.round(this.x - bounds.x);
    if (force || spriteX !== this.lastSpriteX) {
      this.lastSpriteX = spriteX;
      this.host.layoutChanged(spriteX, this.width, this.height);
    }
  }

  /** Windows can resize a window that moves to a monitor with another scale factor; re-assert the size. */
  private settleBounds(): void {
    setTimeout(() => this.apply(true), 80);
  }

  private setFacing(facing: Facing): void {
    if (facing === this.facing) return;
    this.facing = facing;
    this.host.setFacing(facing);
  }

  /** Keeps the sprite on the screen, or on the window it stands on. */
  private clampX(x: number): number {
    const wa = this.display.workArea;
    const half = this.half();
    const left = this.perch ? Math.max(wa.x, this.perch.ledge.left) : wa.x;
    const right = this.perch ? Math.min(wa.x + wa.width, this.perch.ledge.right) : wa.x + wa.width;
    return Math.min(Math.max(x, left + half), right - half);
  }

  private floor(): number {
    return this.display.workArea.y + this.display.workArea.height;
  }

  private spriteWidth(): number {
    return SPRITE_W * this.scale;
  }

  private spriteHeight(): number {
    return SPRITE_H * this.scale;
  }

  private half(): number {
    return this.spriteWidth() / 2;
  }

  private computeSize(): void {
    this.width = Math.max(340, Math.round(SPRITE_W * this.scale + 60));
    this.height = Math.round(SPRITE_H * this.scale + BUBBLE_SPACE);
  }

  private ensureTicking(): void {
    if (this.timer) return;
    this.lastTick = Date.now();
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  private stopTicking(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private ensureWatching(): void {
    if (this.watchTimer) return;
    this.watchTimer = setInterval(() => this.watch(), WATCH_MS);
  }

  private stopWatching(): void {
    if (this.watchTimer) clearInterval(this.watchTimer);
    this.watchTimer = null;
  }
}
