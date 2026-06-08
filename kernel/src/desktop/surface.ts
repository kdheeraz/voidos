import { Framebuffer } from "./compositor.ts";
import type { RGB } from "./compositor.ts";

// The warm "Her" surface, drawn natively by the compositor (no browser, no HTML).
// Same idea as ui/static/her.* — ambient warm backdrop + a luminous orb + text —
// but composited pixel-by-pixel and scanned straight to the framebuffer.

function lerp(a: RGB, b: RGB, t: number): RGB {
  return [
    (a[0] + (b[0] - a[0]) * t) | 0,
    (a[1] + (b[1] - a[1]) * t) | 0,
    (a[2] + (b[2] - a[2]) * t) | 0,
  ];
}

export function renderSurface(w: number, h: number, reply: string): Framebuffer {
  const fb = new Framebuffer(w, h);

  // deep warm-to-black backdrop
  fb.vGradient(0, 0, w, h, [26, 11, 14], [9, 4, 5]);

  const cx = w / 2;
  const cy = h * 0.4;
  const Rmax = Math.min(w, h) * 0.34;

  // ambient wash behind the orb (very soft, wide)
  for (let i = 0; i < 30; i++) {
    const r = Rmax * (2.2 - i * 0.05);
    fb.circle(cx, cy, r | 0, [255, 138, 92], 0.012);
  }

  // the orb: many translucent rings, coral outside -> white-gold core
  const outer: RGB = [226, 92, 74];
  const mid: RGB = [255, 159, 122];
  const core: RGB = [255, 247, 238];
  const N = 96;
  for (let i = 0; i <= N; i++) {
    const t = i / N; // 0 outer -> 1 inner
    const r = Rmax * (1 - t);
    const col = t < 0.6 ? lerp(outer, mid, t / 0.6) : lerp(mid, core, (t - 0.6) / 0.4);
    fb.circle(cx, cy, Math.max(1, r | 0), col, 0.06);
  }
  // bright offset highlight + hot core
  fb.circle((cx - Rmax * 0.22) | 0, (cy - Rmax * 0.28) | 0, (Rmax * 0.28) | 0, [255, 255, 255], 0.18);
  fb.circle(cx, (cy - Rmax * 0.06) | 0, (Rmax * 0.16) | 0, [255, 250, 244], 0.5);

  // brand (top-right) + clock-ish tag (top-left) in the native 3x5 font
  const brand = "VOIDOS";
  fb.text(brand, (w - Framebuffer.textWidth(brand, 3) - 36) | 0, 30, 3, [255, 188, 158], 0.92);
  fb.text("NATIVE", 36, 30, 2, [201, 158, 141], 0.55);

  // the reply line, centered low
  const line = reply.toUpperCase().slice(0, Math.floor(w / (4 * 3)));
  const tw = Framebuffer.textWidth(line, 3);
  fb.text(line, Math.max(16, ((w - tw) / 2) | 0), (h * 0.78) | 0, 3, [243, 230, 221], 0.95);

  return fb;
}
