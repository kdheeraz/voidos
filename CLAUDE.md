# CLAUDE.md — voidOS

## What this is
voidOS is an **AI-native operating system**: the AI agent is the primary
interface to the machine, not an app on it. End goal is a bootable image
(QEMU/bare metal) where PID 1 launches the voidOS mind instead of a login shell.
See `README.md` and `docs/` for the full vision and the bootable path.

## Shape
Two halves meeting at one seam, the **syscall gate** (Unix socket, NDJSON):
- `kernel/` — **TypeScript**, the capability bus ("syscalls"). Runs on Node's
  native type-stripping, **no build step**: `node kernel/src/index.ts`.
- `mind/` — **Python**, the AI half: Ollama agent loop (`void_mind/agent.py`) +
  the `voidsh` shell (`mind/shell.py`). Deps in `mind/requirements.txt` (`ollama`),
  installed into `.venv/`. Backend: Ollama cloud (`OLLAMA_API_KEY`) or local
  (`OLLAMA_HOST`); model via `VOID_MODEL` (default `gpt-oss:120b`; `deepseek-v4-pro`
  needs an Ollama subscription).
- `vfs/` — the sandboxed rootfs (gitignored). `fs.*`/`shell.*` are confined here.
- `boot/` — **voidOS as PID 1**: `voidinit.py` (the init/supervisor: starts the
  kernel, hands off to the mind, reaps orphans, polls `cron.wakeups`, halts on
  signals) + `Dockerfile`. `npm run image:build` / `image:boot`. Container env:
  `VOID_ROOT=/var/void`, `VOID_SOCK`, `VOID_BOOT_TASK` (one-shot mind task),
  `VOID_BOOT_ONCE=1` (halt after).
- `ui/` — **the Console**: `server.py` (stdlib HTTP bridge to the gate: `/api/state`
  read-only aggregate, `/api/chat` runs the mind) + `static/` (Arch-riced tiling
  dashboard + chat). `npm run console` → :7777. The agent's `tap` callback
  (`agent.py`) reports each syscall so the UI/chat can show them.

## Conventions that matter
- **Erasable TS only** (Node strip-types): no `enum`, no parameter properties
  (`constructor(private x)`), no `namespace`. Use `import type` for type-only
  imports or runtime import will fail. Import paths include the `.ts` extension.
- Add a capability by exporting a `Capability[]` from `kernel/src/capabilities/`
  and registering it in `kernel/src/index.ts`. Give it a real `params` JSON
  schema — the agent reads schemas via `sys.list`, so they are not optional.
- Errors are structured envelopes (`ENOSYS`/`EINVAL`/`EPERM`/`EFAULT`/`EPARSE`),
  never thrown across the gate.
- **Security spine** (`kernel/src/policy.ts`): every capability has a `risk`
  (`read`/`write`/`exec`); the bus enforces a policy (`VOID_POLICY`:
  `permissive`/`guarded`(default)/`paranoid`) on every dispatch and audits it to
  `vfs/.void/audit.log`. Risky calls in `guarded` need an operator grant
  (`sys.grant`), gated by the boot-minted token at `vfs/.void/operator.token`.
  `fs.*` is sealed off from `.void`, so the agent can't read the token.
  New capability? Give it the right `risk`. See `docs/security.md`.
- The agent derives its toolset from `sys.list` at runtime — never hardcode tools.
  Tool names avoid dots, so capability `fs.read` ↔ tool `fs_read` (mapped in
  `agent.py`); the capability `params` schema becomes the tool's `parameters`.
  The loop runs tool calls until the model returns a turn with no `tool_calls`.

## Run / test
```bash
npm run boot                       # boot the kernel (the gate)
node kernel/src/cli.ts sys.list    # call a syscall manually
python3 mind/demo.py               # exercise the raw gate from Python
.venv/bin/python mind/shell.py     # talk to the mind (needs OLLAMA_API_KEY)
```

## Status
Milestones 1–7 complete and verified live: syscall layer; Ollama agent loop /
`voidsh`; permissions + audit; bootable container (`voidinit` as PID 1); process
supervision (`proc.*`, `procman.ts`); self-healing services (`svc.*`, `services.ts`);
and scheduling (`cron.*`, `kernel/src/scheduler.ts`, `ctx.scheduler` — `shell` jobs
run commands on a timer, `wake` jobs queue prompts). **Self-wake autonomy**:
`voidinit`'s supervisor polls `cron.wakeups` and runs each on the mind, so a booted
voidOS acts on its own schedule (verified: it scheduled and then wrote a file with
no human). All managers torn down on shutdown. 35 capabilities online.
Milestone 8 (inbound networking — `net.*`, `kernel/src/net.ts`, `ctx.net`) adds
HTTP servers serving rootfs files with request logging; `.void` stays sealed (the
file server reuses `resolveIn`). Verified serving a page from a booted container.
Milestone 9 adds **the Console** (`ui/`): a web UI — Arch-style tiling dashboard
over the live gate plus a chat that drives the mind (`npm run console` → :7777).
Milestone 10 adds voidOS's **interactive desktop**: a from-scratch software
compositor + window manager in the kernel (`kernel/src/desktop/`: `compositor.ts`
= RGBA framebuffer + drawing + 3×5 font + pure-TS PNG encoder; `theme.ts` =
palette/layout/app catalog; `wm.ts` = `WindowManager` at `ctx.desktop` — launch/
focus/z-order/titlebar-drag/close + pointer hit-testing; `scene.ts` = composites
panel + live windows + dock). Capabilities: `desktop.frame` (read, base64 PNG),
`desktop.input` (write, pointer events), `desktop.launch`, `desktop.render`
(write PNG). The `/desktop` viewer (`ui/static/desktop.{html,js}`, served by
`ui/server.py`, `npm run console`) is a thin screen+mouse client; **every click
is an audited syscall**. Scanout-agnostic core; next target is a Linux framebuffer
in QEMU (see `docs/desktop.md`). **44 capabilities** online.

Two desktop surfaces are served by `ui/server.py`: **`/desktop`** streams the
in-kernel compositor as PNG frames (choppy: full-frame re-render per input —
that's the framebuffer/boot path); **`/os`** (`ui/static/os.{html,css,js}`) is a
smooth **client-rendered workspace** — DOM windows (drag/resize/focus/min/max), a
real file manager (`fs.list`/`fs.read`/`fs.write`/`fs.remove`), a terminal
(`shell.exec`), live System/Services/Processes panels, and a Mind chat. It calls
capabilities through a generic **`POST /api/syscall {method,params}`** bridge
(operator-granted). Rendering is browser-side (that's the smoothness tradeoff vs.
the native compositor). The Console binds **127.0.0.1 only** by default
(`VOID_UI_HOST`) because `/api/syscall` is a full syscall bridge — never expose it.

**Laptop boot kit** (`boot/laptop/`, milestone 11): `install.sh` turns a minimal
**Arch** install into a voidOS machine — installs node/python/cage/chromium,
creates a `void` user + `/var/lib/voidos`, installs systemd units
(`voidos-kernel.service`, `voidos-console.service`), and sets tty1 autologin into
`voidos-session.sh` (a `cage` Wayland kiosk running Chromium fullscreen on
`/os`). Config in `/etc/voidos/env`. Linux owns the hardware; voidOS is the shell.
**Unverified on hardware** (no QEMU/laptop in dev). See `docs/laptop.md` (safety:
VM/dual-boot first; escape via Ctrl+Alt+F2). Native GUI apps (milestone 12): `boot/Dockerfile.gui` → `voidos:gui` adds Xvfb +
openbox + x11vnc + noVNC (websockify :6080) on top of the OS, via `boot/gui/gui-boot.sh`
(starts the X stack as a non-root `gui` user, then execs voidinit). `gui-run <app>`
(`/usr/local/bin`) launches an X11/Qt app onto `:99` as the gui user; it streams into
the `/os` **Screen** app (an iframe to noVNC). Verified: installed **VLC** via apt and
ran its real GUI in the desktop. Streamed/software-rendered (not for HD video). Run:
`docker run -p127.0.0.1:7777:7777 -p127.0.0.1:6080:6080 voidos:gui`. Next: framebuffer
scanout in QEMU; persisted manifests; an HTML5 media player for smooth video.
