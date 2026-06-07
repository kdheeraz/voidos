import { deflateSync } from "node:zlib";

// A from-scratch software compositor: an RGBA framebuffer with drawing
// primitives and a PNG "scanout". The same scene-graph + compositing core
// targets a real Linux framebuffer (/dev/fb0) or a Wayland surface later —
// only the final scanout changes. See docs/desktop.md.

export type RGB = [number, number, number];

export class Framebuffer {
  w: number;
  h: number;
  px: Uint8Array; // RGBA, row-major

  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.px = new Uint8Array(w * h * 4);
  }

  private blend(x: number, y: number, c: RGB, a: number): void {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h || a <= 0) return;
    const i = (y * this.w + x) * 4;
    if (a >= 1) {
      this.px[i] = c[0];
      this.px[i + 1] = c[1];
      this.px[i + 2] = c[2];
      this.px[i + 3] = 255;
      return;
    }
    const ia = 1 - a;
    this.px[i] = (c[0] * a + this.px[i] * ia) | 0;
    this.px[i + 1] = (c[1] * a + this.px[i + 1] * ia) | 0;
    this.px[i + 2] = (c[2] * a + this.px[i + 2] * ia) | 0;
    this.px[i + 3] = 255;
  }

  fill(c: RGB): void {
    this.fillRect(0, 0, this.w, this.h, c, 1);
  }

  fillRect(x: number, y: number, w: number, h: number, c: RGB, a = 1): void {
    const x0 = Math.max(0, x | 0), y0 = Math.max(0, y | 0);
    const x1 = Math.min(this.w, (x + w) | 0), y1 = Math.min(this.h, (y + h) | 0);
    for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) this.blend(xx, yy, c, a);
  }

  vGradient(x: number, y: number, w: number, h: number, top: RGB, bottom: RGB): void {
    for (let yy = 0; yy < h; yy++) {
      const t = h <= 1 ? 0 : yy / (h - 1);
      const c: RGB = [
        (top[0] + (bottom[0] - top[0]) * t) | 0,
        (top[1] + (bottom[1] - top[1]) * t) | 0,
        (top[2] + (bottom[2] - top[2]) * t) | 0,
      ];
      this.fillRect(x, y + yy, w, 1, c, 1);
    }
  }

  roundRect(x: number, y: number, w: number, h: number, r: number, c: RGB, a = 1): void {
    for (let yy = 0; yy < h; yy++) {
      for (let xx = 0; xx < w; xx++) {
        // skip outside the rounded corners
        let dx = -1, dy = -1;
        if (xx < r && yy < r) { dx = r - 1 - xx; dy = r - 1 - yy; }
        else if (xx >= w - r && yy < r) { dx = xx - (w - r); dy = r - 1 - yy; }
        else if (xx < r && yy >= h - r) { dx = r - 1 - xx; dy = yy - (h - r); }
        else if (xx >= w - r && yy >= h - r) { dx = xx - (w - r); dy = yy - (h - r); }
        if (dx >= 0 && dx * dx + dy * dy > r * r) continue;
        this.blend(x + xx, y + yy, c, a);
      }
    }
  }

  strokeRect(x: number, y: number, w: number, h: number, c: RGB, a = 1): void {
    this.fillRect(x, y, w, 1, c, a);
    this.fillRect(x, y + h - 1, w, 1, c, a);
    this.fillRect(x, y, 1, h, c, a);
    this.fillRect(x + w - 1, y, 1, h, c, a);
  }

  circle(cx: number, cy: number, r: number, c: RGB, a = 1): void {
    for (let yy = -r; yy <= r; yy++) for (let xx = -r; xx <= r; xx++)
      if (xx * xx + yy * yy <= r * r) this.blend((cx + xx) | 0, (cy + yy) | 0, c, a);
  }

  // --- text (3x5 bitmap font, scaled) ---

  text(str: string, x: number, y: number, scale: number, c: RGB, a = 1): void {
    let cx = x;
    for (const ch of str.toUpperCase()) {
      const g = FONT[ch];
      if (g) {
        for (let r = 0; r < 5; r++) {
          const row = g[r];
          for (let col = 0; col < 3; col++) {
            if (row[col] === "#") this.fillRect(cx + col * scale, y + r * scale, scale, scale, c, a);
          }
        }
      }
      cx += 4 * scale; // 3px glyph + 1px gap
    }
  }

  static textWidth(str: string, scale: number): number {
    return str.length * 4 * scale;
  }

  toPNG(): Buffer {
    return encodePNG(this.w, this.h, this.px);
  }
}

// --- PNG encoder (truecolor + alpha, zlib via node:zlib) ---

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), Buffer.from(data)]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

export function encodePNG(w: number, h: number, rgba: Uint8Array): Buffer {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // color type RGBA
  const stride = w * 4;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    const o = y * (stride + 1);
    raw[o] = 0; // filter: none
    raw.set(rgba.subarray(y * stride, (y + 1) * stride), o + 1);
  }
  const idat = deflateSync(raw);
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", new Uint8Array(0))]);
}

// --- 3x5 uppercase bitmap font (crude on purpose: it's raw framebuffer text) ---

const FONT: Record<string, string[]> = {
  " ": ["...", "...", "...", "...", "..."],
  A: [".#.", "#.#", "###", "#.#", "#.#"],
  B: ["##.", "#.#", "##.", "#.#", "##."],
  C: [".##", "#..", "#..", "#..", ".##"],
  D: ["##.", "#.#", "#.#", "#.#", "##."],
  E: ["###", "#..", "##.", "#..", "###"],
  F: ["###", "#..", "##.", "#..", "#.."],
  G: [".##", "#..", "#.#", "#.#", ".##"],
  H: ["#.#", "#.#", "###", "#.#", "#.#"],
  I: ["###", ".#.", ".#.", ".#.", "###"],
  J: ["..#", "..#", "..#", "#.#", ".#."],
  K: ["#.#", "#.#", "##.", "#.#", "#.#"],
  L: ["#..", "#..", "#..", "#..", "###"],
  M: ["#.#", "###", "###", "#.#", "#.#"],
  N: ["#.#", "##.", "#.#", ".##", "#.#"],
  O: ["###", "#.#", "#.#", "#.#", "###"],
  P: ["##.", "#.#", "##.", "#..", "#.."],
  Q: ["###", "#.#", "#.#", "###", "..#"],
  R: ["##.", "#.#", "##.", "#.#", "#.#"],
  S: [".##", "#..", ".#.", "..#", "##."],
  T: ["###", ".#.", ".#.", ".#.", ".#."],
  U: ["#.#", "#.#", "#.#", "#.#", "###"],
  V: ["#.#", "#.#", "#.#", "#.#", ".#."],
  W: ["#.#", "#.#", "###", "###", "#.#"],
  X: ["#.#", "#.#", ".#.", "#.#", "#.#"],
  Y: ["#.#", "#.#", ".#.", ".#.", ".#."],
  Z: ["###", "..#", ".#.", "#..", "###"],
  "0": ["###", "#.#", "#.#", "#.#", "###"],
  "1": [".#.", "##.", ".#.", ".#.", "###"],
  "2": ["##.", "..#", ".#.", "#..", "###"],
  "3": ["###", "..#", ".##", "..#", "###"],
  "4": ["#.#", "#.#", "###", "..#", "..#"],
  "5": ["###", "#..", "###", "..#", "##."],
  "6": [".##", "#..", "###", "#.#", "###"],
  "7": ["###", "..#", ".#.", ".#.", ".#."],
  "8": ["###", "#.#", "###", "#.#", "###"],
  "9": ["###", "#.#", "###", "..#", "##."],
  ".": ["...", "...", "...", "...", ".#."],
  ",": ["...", "...", "...", ".#.", "#.."],
  ":": ["...", ".#.", "...", ".#.", "..."],
  "-": ["...", "...", "###", "...", "..."],
  "_": ["...", "...", "...", "...", "###"],
  "/": ["..#", "..#", ".#.", "#..", "#.."],
  ">": ["#..", ".#.", "..#", ".#.", "#.."],
  "<": ["..#", ".#.", "#..", ".#.", "..#"],
  "%": ["#.#", "..#", ".#.", "#..", "#.#"],
  "#": ["#.#", "###", "#.#", "###", "#.#"],
  "+": ["...", ".#.", "###", ".#.", "..."],
  "(": [".#.", "#..", "#..", "#..", ".#."],
  ")": [".#.", "..#", "..#", "..#", ".#."],
  "*": ["...", "#.#", ".#.", "#.#", "..."],
  "!": [".#.", ".#.", ".#.", "...", ".#."],
  "?": ["##.", "..#", ".#.", "...", ".#."],
};
