import type { RGB } from "./compositor.ts";
import { APPS, PANEL_H, TITLE_H, dockLayout } from "./theme.ts";

export interface VWindow {
  id: number;
  app: string;
  title: string;
  accent: RGB;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
}

export interface PointerEvent {
  type: "pointerdown" | "pointermove" | "pointerup";
  x: number;
  y: number;
}

/**
 * The voidOS window manager: window geometry, focus, z-order, and pointer
 * interaction (launch from dock, focus/raise, titlebar drag, close). State is
 * in-kernel (ctx.desktop); the compositor renders ordered() each frame.
 */
export class WindowManager {
  W = 1100;
  H = 720;
  windows: VWindow[] = [];
  private seq = 0;
  private topZ = 0;
  private drag: { id: number; ox: number; oy: number } | null = null;

  constructor() {
    // a fresh desktop opens with a few windows
    this.launch("system");
    this.launch("services");
    this.launch("audit");
  }

  launch(app: string): number {
    const def = APPS.find((a) => a.id === app);
    if (!def) return -1;
    const existing = this.windows.find((w) => w.app === app);
    if (existing) {
      this.raise(existing.id);
      return existing.id;
    }
    const n = this.windows.length;
    const win: VWindow = {
      id: ++this.seq,
      app,
      title: def.title,
      accent: def.accent,
      x: 40 + (n % 6) * 36,
      y: PANEL_H + 18 + (n % 6) * 30,
      w: def.w,
      h: def.h,
      z: ++this.topZ,
    };
    this.windows.push(win);
    return win.id;
  }

  raise(id: number): void {
    const w = this.byId(id);
    if (w) w.z = ++this.topZ;
  }

  close(id: number): void {
    this.windows = this.windows.filter((w) => w.id !== id);
  }

  byId(id: number): VWindow | undefined {
    return this.windows.find((w) => w.id === id);
  }

  /** Back-to-front, for compositing. */
  ordered(): VWindow[] {
    return [...this.windows].sort((a, b) => a.z - b.z);
  }

  focusedId(): number {
    let top: VWindow | null = null;
    for (const w of this.windows) if (!top || w.z > top.z) top = w;
    return top ? top.id : -1;
  }

  private topAt(x: number, y: number): VWindow | undefined {
    const desc = [...this.windows].sort((a, b) => b.z - a.z);
    return desc.find((w) => x >= w.x && x <= w.x + w.w && y >= w.y && y <= w.y + w.h);
  }

  pointer(ev: PointerEvent): void {
    if (ev.type === "pointerdown") {
      const w = this.topAt(ev.x, ev.y);
      if (w) {
        this.raise(w.id);
        // close button = first traffic light, near (x+14, y+11)
        if (Math.hypot(ev.x - (w.x + 14), ev.y - (w.y + 11)) <= 7) {
          this.close(w.id);
          return;
        }
        if (ev.y <= w.y + TITLE_H) this.drag = { id: w.id, ox: ev.x - w.x, oy: ev.y - w.y };
        return;
      }
      const hit = dockLayout(this.W, this.H).rects.find(
        (r) => ev.x >= r.x && ev.x <= r.x + r.w && ev.y >= r.y && ev.y <= r.y + r.h,
      );
      if (hit) this.launch(hit.app);
    } else if (ev.type === "pointermove") {
      if (this.drag) {
        const w = this.byId(this.drag.id);
        if (w) {
          w.x = Math.max(-w.w + 80, Math.min(this.W - 80, ev.x - this.drag.ox));
          w.y = Math.max(PANEL_H, Math.min(this.H - 40, ev.y - this.drag.oy));
        }
      }
    } else if (ev.type === "pointerup") {
      this.drag = null;
    }
  }
}
