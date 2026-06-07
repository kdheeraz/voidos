# voidOS desktop environment — architecture & roadmap

The goal: voidOS boots into its **own graphical shell** — a compositor, window
manager, panel, and dock — not a browser, not a desktop app on someone else's
OS. This is a large, staged effort. This doc scopes the full stack and records
what exists today (a working software-compositor foundation).

## What a desktop environment actually is

```
  apps / windows         ← surfaces (pixel buffers) the mind opens & arranges
        │
  shell (panel · dock · launcher)
        │
  window manager         ← geometry, focus, z-order, input routing
        │
  compositor             ← composites window surfaces into one framebuffer  ◀── voidOS core
        │
  scanout target         ← where the final framebuffer goes
        │
  ┌─────────────┬──────────────┬───────────────────┐
  PNG file      /dev/fb0 (KMS)  Wayland/DRM surface
  (today)       (QEMU/bare)     (accelerated, later)
        ▲
  input            ← /dev/input/event* (mouse, kbd) routed to focused window
```

The **compositor + scene graph + drawing + window model** is the heart, and it's
*independent of the scanout target*. Build it once; later you swap "write PNG"
for "write `/dev/fb0`" or "submit a Wayland buffer." That's the bet behind
doing the compositor first.

## What exists now (the foundation — `kernel/src/desktop/`)

- **`compositor.ts`** — a software framebuffer (RGBA), drawing primitives
  (rects, gradients, rounded rects, circles, strokes, alpha blending), a 3×5
  bitmap font, and a from-scratch **PNG encoder** (zlib + CRC32) as the scanout.
- **`scene.ts`** — composes the voidOS desktop: wallpaper, a top panel
  (policy · caps · uptime · clock), windows with macOS-style traffic-light
  controls and accent strips, and a dock. Windows are populated from **live OS
  state** (services, processes, audit, system info).
- **`desktop.render`** capability — gathers state from the kernel, composites a
  frame, and writes a PNG to the rootfs. Rendering the desktop is itself an
  audited syscall.

This already renders a recognizable desktop from the real system. Everything
above the scanout line is reusable as-is.

## Staged path to a real, interactive desktop

1. ✅ **Software compositor → image.** Scene graph, drawing, window model, PNG
   scanout, live-state windows. (Done.)
2. ✅ **Interactive frames over the gate.** `desktop.frame` returns the
   framebuffer (base64 PNG), `desktop.input` injects pointer events, and the
   window manager (`wm.ts`) handles launch-from-dock, focus, z-order, titlebar
   drag, and close. The `/desktop` viewer streams frames and sends input — the
   browser is just voidOS's screen + mouse. Every input is an audited syscall.
3. **Real framebuffer in QEMU.** Boot a minimal Linux image (Alpine/Buildroot,
   the `voidinit` path from `docs/bootable-path.md`) with KMS/`fbdev`. Swap the
   scanout: write the composited buffer straight to `/dev/fb0`. No X, no
   Wayland — just the framebuffer. This is the first time it's a *screen*.
4. **Input.** Read `/dev/input/event*` (evdev) for mouse/keyboard; route to the
   focused window via the WM. Now it's usable.
5. **Apps as capability surfaces.** Each voidOS "app" is a window backed by
   capabilities — a Files window over `fs.*`, a Services window over `svc.*`, a
   terminal over `shell.*`/`proc.*`, a chat window to the mind. The **mind is
   the window manager**: it opens, arranges, and closes windows (`desktop.window.*`),
   making the desktop itself agent-driven — the AI-native payoff.
6. **Acceleration (optional, later).** Move from a software compositor to
   DRM/GBM + a GPU, or run a Wayland compositor, for smooth animation.

## What each later stage needs (honest)

| stage | needs | not available in this dev session |
|-------|-------|-----------------------------------|
| 2 | just code (frame/input syscalls + viewer) | — |
| 3 | QEMU + a Linux image with fbdev/KMS | **QEMU not installed here** |
| 4 | evdev access inside the image | requires the image |
| 6 | GPU passthrough / Wayland stack | hardware/driver work |

## AI-native framing

In a normal OS the user drives the window manager. In voidOS the **mind** is a
first-class WM client: it composes the scene, opens windows for tasks, arranges
them, and can "take a screenshot" (`desktop.render`) to see what the user sees.
The desktop is not just *shown to* the agent — it's *operated by* it. The
capability surface (`desktop.*`) is how that stays auditable and gated like
every other syscall.
