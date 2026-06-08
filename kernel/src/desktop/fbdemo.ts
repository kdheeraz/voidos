// First native-rendering milestone: draw the voidOS surface straight to the
// Linux framebuffer (no X, no Chromium) and read it back for verification.
//   node kernel/src/desktop/fbdemo.ts "a line of text"
import { writeFileSync } from "node:fs";
import { renderSurface } from "./surface.ts";
import { scanout, captureFb } from "./scanout.ts";

const W = Number(process.env.FBW || 1280);
const H = Number(process.env.FBH || 800);
const reply = process.argv.slice(2).join(" ") || "I AM DRAWN ON THE METAL";

const fb = renderSurface(W, H, reply);
scanout(fb); // paint the real screen
writeFileSync("/tmp/fbshot.png", captureFb(W, H)); // read back what's on the scanout
console.log(`scanned out ${W}x${H} to /dev/fb0 (readback -> /tmp/fbshot.png)`);
