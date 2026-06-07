# voidOS

An **AI-native operating system** — one where the AI agent is not an app *on* the
machine but the primary interface *to* the machine. The long-term goal is a
**bootable image** (QEMU / bare metal) that, instead of a login shell, hands the
machine to the voidOS mind.

## Architecture

voidOS is split across two halves that meet at a single, narrow boundary — the
**syscall gate**:

```
   ┌─────────────────────┐        Unix-domain socket        ┌──────────────────────┐
   │   mind  (Python)    │   newline-delimited JSON-RPC     │   kernel  (TypeScript)│
   │  planning · agent   │ ───────────────────────────────▶ │   capability bus      │
   │  loop · memory      │ ◀─────────────────────────────── │   (the "syscalls")    │
   └─────────────────────┘                                  └──────────────────────┘
```

- **kernel/** (TypeScript, runs on Node's native type-stripping — no build step)
  hosts the **capability bus**: a registry of self-describing, schema-validated
  operations the mind may invoke. Capabilities *are* voidOS's syscalls.
- **mind/** (Python) is the AI half: an Ollama-backed **agent loop** that
  discovers the kernel's capabilities at runtime (via `sys.list`), turns each
  into a tool, and acts on the machine through the gate. `voidsh` is the shell.
- **vfs/** is the sandboxed rootfs. All `fs.*` and `shell.*` operations are
  confined to it; path traversal outside is refused. Its `.void/` control plane
  (socket, audit log, operator token) is sealed off from `fs.*`.
- Every capability is **risk-classed** (`read`/`write`/`exec`) and gated by a
  **permission policy** the kernel enforces; an operator authorizes risky calls
  via a boot-minted token, and every syscall is audited. See
  [docs/security.md](docs/security.md).

### Why this shape
The capability layer is the foundation everything else plugs into. Because every
capability is **self-describing** (`sys.list` returns names + JSON schemas), the
agent discovers what it is allowed to do at runtime, with nothing hardcoded —
that is what makes voidOS *AI-native* rather than "an OS with a chatbot."

## Capabilities

| capability | risk | what it does |
|------------|------|--------------|
| `sys.list` / `sys.info` / `sys.policy` / `sys.audit` | read | introspection: syscalls, kernel info, policy, audit log |
| `sys.grant` / `sys.revoke` | read* | operator-only: authorize/revoke risky calls (*token-gated) |
| `fs.read/list/stat` · `fs.write/remove` | read · write | sandboxed filesystem in `vfs/` |
| `shell.exec` | exec | run a one-shot command in the rootfs |
| `proc.list/status/logs` · `proc.stop/remove` · `proc.spawn` | read · write · exec | supervise long-running background processes |
| `svc.list/status/logs` · `svc.stop/remove` · `svc.define/start` | read · write · exec | declare self-healing services the kernel keeps alive |
| `cron.list/status` · `cron.cancel/wakeups` · `cron.schedule` | read · write · exec | run a command — or wake the mind with a prompt — on a timer |
| `web.fetch` | write | outbound HTTP(S) request |
| `net.list/status/requests` · `net.serve/stop` | read · write | host HTTP servers serving rootfs files (inbound) |
| `desktop.frame/render` · `desktop.input/launch` | read · write | composite & drive voidOS's own GUI desktop (window manager: open/focus/drag/close) |
| `memory.get/list` · `memory.set/delete` | read · write | persistent key/value long-term memory |

Errors use OS-flavored codes: `ENOSYS` (no such capability), `EINVAL` (bad
params), `EPERM` (denied by policy), `EFAULT` (handler threw / sandbox
violation), `EPARSE` (bad request).

## Quick start

The default policy is **`guarded`** — `read` flows freely, but `write`/`exec`
need an operator grant. For poking at the raw gate by hand, the simplest path is
permissive:

```bash
# 1. boot the kernel (the syscall gate); permissive for easy manual play
VOID_POLICY=permissive npm run boot

# 2. in another shell, call a syscall directly
node kernel/src/cli.ts sys.list
node kernel/src/cli.ts fs.write path=/hello.txt content="hi"
node kernel/src/cli.ts fs.read  path=/hello.txt

# 3. or drive the raw gate from the Python mind (self-grants under guarded)
python3 mind/demo.py
```

Under the default `guarded` policy, a `write` is refused until granted:

```bash
npm run boot                                          # guarded (default)
node kernel/src/cli.ts fs.write path=/x.txt content=hi   # -> EPERM
TOKEN=$(cat vfs/.void/operator.token)                 # operator-only secret
node kernel/src/cli.ts sys.grant "token=$TOKEN" target=fs.write uses=1
node kernel/src/cli.ts fs.write path=/x.txt content=hi   # -> ok
node kernel/src/cli.ts sys.audit limit=5              # the whole trail
```

Override rootfs / socket / policy with `VOID_ROOT` / `VOID_SOCK` / `VOID_POLICY`.

### Talk to the mind (`voidsh`)

The AI-native shell: say what you want, the mind acts through the syscalls.

```bash
python3 -m venv .venv && .venv/bin/pip install -r mind/requirements.txt
export OLLAMA_API_KEY=...                    # the mind thinks via ollama.com

npm run boot                                # terminal 1: the gate
.venv/bin/python mind/shell.py              # terminal 2: the shell
```

**Model** — defaults to `gpt-oss:120b` on Ollama cloud. Override with
`VOID_MODEL` (e.g. `export VOID_MODEL=deepseek-v4-pro`, which needs an Ollama
subscription). Point `OLLAMA_HOST` at a local Ollama to run keyless/offline.

```
you> make a notes folder with a todo list for shipping milestone 3
  · syscall fs.write(path='/notes/todo.md', content='...')
void> Done — created /notes/todo.md with the milestone-3 checklist.
```

The mind's toolset is whatever the kernel exposes — add a capability and the
agent can use it with no change to the mind.

### The Console (web UI)

A riced, Arch-style tiling dashboard for the OS: live panels for system info,
capabilities, processes, services, cron, servers, and a streaming audit tail —
plus a terminal-style chat that drives the mind and shows the syscalls it runs.

```bash
export OLLAMA_API_KEY=...        # for the chat panel (dashboard works without)
npm run console                  # boots the kernel + Console, then open:
open http://localhost:7777
```

The dashboard is read-only syscalls over HTTP; the chat runs the mind (the
console is the operator, so actions are authorized and shown in the audit panel).
See `ui/`.

**Run the whole OS + desktop in Docker** (the OS runs in the container; your
browser is the screen):

```bash
OLLAMA_API_KEY=... docker compose up --build      # then open:
open http://localhost:7777/os
# or:  docker run -d -p 127.0.0.1:7777:7777 -e VOID_DESKTOP=1 -e VOID_UI_HOST=0.0.0.0 \
#        -e OLLAMA_API_KEY=... voidos:dev
```

`voidinit` (PID 1) boots the kernel + mind + Console; `VOID_DESKTOP=1` serves the
`/os` desktop. The port publishes to host localhost only (the Console is a
syscall bridge — don't expose it).

Two desktop surfaces are served alongside the console:
- **`/os`** — a smooth, client-rendered **workspace**: draggable/resizable
  windows, a real **file manager** (navigate folders, open files in an editor),
  a **terminal** (`shell.exec`), live System/Services/Processes panels, and a
  Mind chat window — all backed by capabilities via `/api/syscall`. Renders in
  the browser (so it's smooth and crisp); voidOS owns the state/apps.
- **`/desktop`** — the **in-kernel software compositor** streamed as frames
  (the scanout-agnostic core for a real framebuffer boot; see `docs/desktop.md`).

### Boot it (voidOS as PID 1)

voidOS can boot as the init of a machine: `boot/voidinit.py` is PID 1 — it brings
up the kernel, then hands the session to the mind. No login, no shell prompt.

```bash
npm run image:build                          # build the container image
npm run image:boot                           # interactive voidsh as PID 1

# or a one-shot autonomous boot (the mind runs a task, then halts):
docker run --rm -e OLLAMA_API_KEY \
  -e VOID_BOOT_ONCE=1 \
  -e VOID_BOOT_TASK="introduce yourself and report your capabilities" \
  voidos:dev
```

The same `voidinit` is the entrypoint for a real bootable image (Alpine/Buildroot
initramfs → QEMU → bare metal) — only the substrate beneath the gate changes.
See [docs/bootable-path.md](docs/bootable-path.md).

## Roadmap

1. ✅ **Capability (syscall) layer** — registry, gate, fs/shell/web/memory, introspection.
2. ✅ **The mind** — Ollama agent loop: NL → plan → syscalls → observe → repeat (`voidsh`).
3. ✅ **Capability permissions & audit** — risk classes, policy modes, operator
   grants, sealed control plane, syscall audit log ([docs/security.md](docs/security.md)).
4. ✅ **Bootable (container phase)** — `voidinit` is PID 1; the machine boots into
   the mind ([docs/bootable-path.md](docs/bootable-path.md)).
5. ✅ **Process supervision** — `proc.*`: the mind spawns, watches, and stops
   long-running programs, not just one-shot `shell.exec`.
6. ✅ **Services** — `svc.*`: declarative, self-healing services the kernel keeps
   alive (restart policy, backoff, crash-loop guard). voidOS's init/supervisor.
7. ✅ **Scheduling + self-wake** — `cron.*`: run commands on a timer, or queue a
   prompt to wake the mind. A booted voidOS polls and acts on its own wakeups —
   it can schedule its future cognition. (Verified: the machine woke itself and
   wrote a file with no human in the loop.)
8. ✅ **Inbound networking** — `net.*`: the mind hosts HTTP servers serving rootfs
   files, with request logging (the `.void` control plane stays sealed). Verified
   serving a page reachable from outside a booted container.
9. ✅ **The Console** — a web UI (`ui/`): Arch-style tiling dashboard over the live
   gate + a chat that drives the mind and surfaces every syscall. `npm run console`.
10. ✅ **Desktop (interactive)** — a from-scratch software compositor + window
    manager in the kernel (`kernel/src/desktop/`): open/focus/drag/close windows
    from a dock; live app windows (files/system/services/procs/net/cron/audit);
    all driven by **pointer syscalls** (every click is audited). Viewer at
    `/desktop` — the browser is just voidOS's screen + mouse. The compositing core
    is scanout-agnostic; next target is a Linux framebuffer in QEMU. See
    [docs/desktop.md](docs/desktop.md). `npm run console` → http://localhost:7777/desktop
11. ◧ **Run on a laptop** — `boot/laptop/`: an installer that turns a minimal
    **Arch Linux** install into a voidOS machine — systemd services for the kernel
    + Console, and tty1 autologin into the `/os` desktop fullscreen via a Wayland
    kiosk (`cage` + Chromium). Linux does the hardware; voidOS is the whole shell.
    See [docs/laptop.md](docs/laptop.md). (Unverified on hardware here — VM first.)
12. ✅ **Native GUI apps in the desktop** — `boot/Dockerfile.gui` builds `voidos:gui`
    (Xvfb + openbox + x11vnc + noVNC on top of the OS). Any X11/Qt app (verified
    with **VLC**, installed via `apt`) runs and streams into the `/os` **Screen**
    window. Launch from the Terminal: `gui-run <app>`. (Streamed/software-rendered,
    so fine for UIs and light use, not HD video.)
13. ◻️ Next: framebuffer scanout in QEMU; persisted service/cron manifests; HTML5
    media player for smooth in-browser video.
4. **More capabilities** — process/app management, networking, scheduling.
5. **Bootable image** — minimal Linux base; PID 1 launches the mind as the
   primary interface. See [docs/bootable-path.md](docs/bootable-path.md).

See [docs/architecture.md](docs/architecture.md) for the deeper design.
