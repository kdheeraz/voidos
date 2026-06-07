"use strict";

const screen = document.getElementById("screen");
const W = 1100, H = 720;
let dragging = false;
let lastMove = 0;
let pending = false;

function refresh() {
  if (pending) return;
  pending = true;
  const img = new Image();
  img.onload = () => { screen.src = img.src; pending = false; };
  img.onerror = () => { pending = false; };
  img.src = "/api/frame?t=" + Date.now();
}

function coords(e) {
  const r = screen.getBoundingClientRect();
  return {
    x: Math.round((e.clientX - r.left) * (W / r.width)),
    y: Math.round((e.clientY - r.top) * (H / r.height)),
  };
}

async function send(type, e) {
  const { x, y } = coords(e);
  try {
    await fetch("/api/input", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, x, y }),
    });
  } catch (_) {}
  refresh();
}

screen.addEventListener("mousedown", (e) => { e.preventDefault(); dragging = true; send("pointerdown", e); });
window.addEventListener("mouseup", (e) => { if (dragging) { dragging = false; send("pointerup", e); } });
window.addEventListener("mousemove", (e) => {
  if (!dragging) return;
  const now = Date.now();
  if (now - lastMove < 33) return; // ~30fps while dragging
  lastMove = now;
  send("pointermove", e);
});

refresh();
setInterval(() => { if (!dragging) refresh(); }, 1500); // live data + clock
