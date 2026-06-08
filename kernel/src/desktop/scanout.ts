import { openSync, writeSync, readSync, closeSync } from "node:fs";
import { Framebuffer, encodePNG } from "./compositor.ts";

// Native scanout: put the compositor's RGBA buffer onto a real Linux framebuffer
// (/dev/fb0). This is the step that makes voidOS draw the screen itself — no X,
// no browser. virtio_gpudrmfb (and most fbdev) is 32bpp XRGB8888, i.e. memory
// byte order B,G,R,X; the compositor stores R,G,B,A, so we swap R/B on the way
// out (and back on capture). Assumes stride == width*4 (true on this target).

export function scanout(fb: Framebuffer, dev = "/dev/fb0"): void {
  const { w, h, px } = fb;
  const out = Buffer.allocUnsafe(w * h * 4);
  for (let i = 0; i < px.length; i += 4) {
    out[i] = px[i + 2];     // B
    out[i + 1] = px[i + 1]; // G
    out[i + 2] = px[i];     // R
    out[i + 3] = 0xff;      // X
  }
  const fd = openSync(dev, "r+");
  try { writeSync(fd, out, 0, out.length, 0); } finally { closeSync(fd); }
}

// Read the framebuffer back into a PNG — lets us verify, headlessly, what is
// actually sitting on the screen's scanout buffer.
export function captureFb(w: number, h: number, dev = "/dev/fb0"): Buffer {
  const size = w * h * 4;
  const buf = Buffer.allocUnsafe(size);
  const fd = openSync(dev, "r");
  try { readSync(fd, buf, 0, size, 0); } finally { closeSync(fd); }
  const rgba = new Uint8Array(size);
  for (let i = 0; i < size; i += 4) {
    rgba[i] = buf[i + 2];     // R
    rgba[i + 1] = buf[i + 1]; // G
    rgba[i + 2] = buf[i];     // B
    rgba[i + 3] = 0xff;
  }
  return encodePNG(w, h, rgba);
}
