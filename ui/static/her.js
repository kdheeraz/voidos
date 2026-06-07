"use strict";

// voidOS — the AI-first surface. The whole screen is the OS's mind. You tell it
// what you need; it answers and acts (apps open as real windows). Voice later.

const canvas = document.getElementById("orb");
const ctx = canvas.getContext("2d");
const you = document.getElementById("you");
const reply = document.getElementById("reply");
const input = document.getElementById("input");
const clock = document.getElementById("clock");

let W = 0, H = 0, dpr = 1;
function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  W = canvas.width = innerWidth * dpr;
  H = canvas.height = innerHeight * dpr;
}
addEventListener("resize", resize);
resize();

let state = "idle";
const setState = (s) => { state = s; document.body.dataset.state = s; };

// ---- the living orb ----
// Layered, additive glow for a luminous, dimensional presence (not a flat disk):
// volumetric bloom + hot multi-hue core + specular highlight + rim light.
let amp = 0.35, t = 0;
function arc(x, y, r) { ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill(); }
function draw() {
  t += 0.016;
  const base =
    state === "thinking" ? 0.50 + 0.05 * Math.sin(t * 4.2)
    : state === "responding" ? 0.56 + 0.07 * Math.sin(t * 2.0)
    : 0.42 + 0.045 * Math.sin(t * 0.8);
  amp += (base - amp) * 0.05; // slow ease = smooth breathing

  ctx.clearRect(0, 0, W, H);
  const cx = W / 2, cy = H * 0.40, R = Math.min(W, H) * 0.155 * (0.92 + amp);
  const hue = 18 + 6 * Math.sin(t * 0.3); // gentle warm drift (amber↔coral)

  // volumetric bloom (additive so it reads as emitted light)
  ctx.globalCompositeOperation = "lighter";
  const bloom = ctx.createRadialGradient(cx, cy, R * 0.35, cx, cy, R * 5);
  bloom.addColorStop(0, `hsla(${hue},95%,62%,0.20)`);
  bloom.addColorStop(0.4, `hsla(${hue - 6},90%,55%,0.06)`);
  bloom.addColorStop(1, `hsla(${hue},90%,50%,0)`);
  ctx.fillStyle = bloom; arc(cx, cy, R * 5);

  // hot core: white-gold center → coral → crimson, feathered to transparent
  ctx.globalCompositeOperation = "source-over";
  const core = ctx.createRadialGradient(cx, cy - R * 0.16, R * 0.02, cx, cy, R * 1.22);
  core.addColorStop(0, "#fff7ee");
  core.addColorStop(0.16, "#ffe3bd");
  core.addColorStop(0.42, `hsl(${hue + 5}, 100%, 70%)`);
  core.addColorStop(0.70, `hsl(${hue}, 90%, 58%)`);
  core.addColorStop(0.90, `hsl(${hue - 5}, 82%, 47%)`);
  core.addColorStop(1, `hsla(${hue - 7}, 78%, 40%, 0)`);
  ctx.fillStyle = core; arc(cx, cy, R * 1.22);

  // specular highlight (offset) + rim light — additive for a glassy, 3D feel
  ctx.globalCompositeOperation = "lighter";
  const spec = ctx.createRadialGradient(cx - R * 0.30, cy - R * 0.38, 0, cx - R * 0.30, cy - R * 0.38, R * 0.72);
  spec.addColorStop(0, "rgba(255,255,255,0.45)");
  spec.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = spec; arc(cx - R * 0.30, cy - R * 0.38, R * 0.72);

  const rim = ctx.createRadialGradient(cx, cy, R * 0.84, cx, cy, R * 1.08);
  rim.addColorStop(0, "rgba(255,190,150,0)");
  rim.addColorStop(0.72, `hsla(${hue + 12}, 100%, 78%, 0.13)`);
  rim.addColorStop(1, "rgba(255,190,150,0)");
  ctx.fillStyle = rim; arc(cx, cy, R * 1.08);
  ctx.globalCompositeOperation = "source-over";

  requestAnimationFrame(draw);
}
draw();

// ---- clock ----
function tick() {
  clock.textContent = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
tick();
setInterval(tick, 1000);

// ---- talk to the OS ----
let respTimer;
async function ask(text) {
  text = (text || "").trim();
  if (!text) return;
  you.textContent = text;
  reply.style.opacity = "0";
  setState("thinking");
  try {
    const r = await fetch("/api/her", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text }),
    });
    const d = await r.json();
    reply.textContent = d.reply || d.error || "…";
    reply.style.opacity = "1";
    setState("responding");
    clearTimeout(respTimer);
    respTimer = setTimeout(() => setState("idle"), 1800);
  } catch (e) {
    reply.textContent = "I lost you for a second.";
    reply.style.opacity = "1";
    setState("idle");
  }
}

document.getElementById("ask").addEventListener("submit", (e) => {
  e.preventDefault();
  const v = input.value;
  input.value = "";
  ask(v);
});
input.focus();
// keep the command line focused — a click anywhere returns you to it
document.addEventListener("click", (e) => { if (e.target.tagName !== "INPUT") input.focus(); });
