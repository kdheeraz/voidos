# Running voidOS on a laptop (instead of Windows)

> **Read this whole page before installing.** It explains what voidOS on a laptop
> really is, the honest limitations, and — importantly — how not to lose your data.

## ⚠️ Safety first

- **Do not wipe your only computer.** Try voidOS in a **VM** (Boxes/virt-manager/
  VirtualBox/UTM) or a **spare laptop** or a **second disk / dual-boot** first.
- The installer sets **tty1 to auto-login into the voidOS desktop**. The escape
  hatch is **Ctrl+Alt+F2** → a normal Linux shell. Know that before you reboot.
- voidOS is a **prototype**. It is not a hardened, complete OS. Treat it as an
  experiment you control, not a bank terminal.

## What this actually is (be clear-eyed)

voidOS is **not** a from-scratch operating system. Replacing Windows on real
hardware means drivers for wifi, GPU, disk, USB, power, suspend — which is what
**Linux** is for. So voidOS runs as the **graphical shell on top of a minimal
Arch Linux base**:

```
  your laptop hardware
        │
  Linux kernel + drivers (Arch)        ← does the hardware
        │
  systemd: voidos-kernel + voidos-console   ← voidOS services
        │
  cage (Wayland kiosk) → the /os desktop, fullscreen   ← what you see & use
```

Linux handles the machine; **voidOS is the entire experience** — boot straight
into the voidOS desktop (no login screen, no browser chrome): files, terminal,
editor, app windows, and the AI mind. That's a real "I use voidOS instead of
Windows" in the way appliance/kiosk OSes ship a web-tech shell as the UI.

## Honest limitations

- **The desktop is web-rendered** (Chromium in kiosk via `cage`). It's smooth and
  crisp, but it is web tech under the hood. The fully-native compositor is a
  separate, much larger effort (see `docs/desktop.md`).
- **The mind needs a model backend.** With `OLLAMA_API_KEY` it uses ollama.com;
  set `OLLAMA_HOST` to a **local** ollama to run fully offline. Without either,
  the desktop/files/terminal still work — the mind just won't think.
- **Native GUI apps** (Tkinter/GTK/Qt) don't appear inside the kiosk by default
  (it shows one fullscreen window). They run (Linux can run them); to see them
  you'd stream via VNC/noVNC into an `/os` window, or use a multi-window
  compositor instead of the kiosk. Experimental — see `docs/desktop.md`.
- **No app ecosystem like Windows.** You get a terminal (real Arch underneath via
  `pacman`), a file manager, an editor, and the mind. That's the trade.

## Install

1. **Install Arch Linux** normally (the official guide), with networking. A
   minimal install is fine — no desktop environment needed.
2. Get voidOS onto the machine (clone the repo or copy it).
3. Run the installer as root:
   ```bash
   sudo bash boot/laptop/install.sh
   ```
   It installs `nodejs python cage chromium`, creates a `void` user and
   `/var/lib/voidos`, sets up the systemd services, and configures tty1 autologin
   into the voidOS desktop.
4. Set your model key:
   ```bash
   sudoedit /etc/voidos/env     # set OLLAMA_API_KEY=...  (or OLLAMA_HOST for local)
   ```
5. **Reboot.** The laptop boots into the voidOS desktop.

## Using it

- The **dock** launches Files, Terminal, Editor, System, Services, Processes, Mind.
- **Desktop icons** live in `/Desktop` (right-click to create; drag to arrange).
- The **Terminal** is a real shell in the rootfs sandbox; for full-system Arch
  access (e.g. `pacman`), use a TTY (Ctrl+Alt+F2) — the sandbox is intentionally
  scoped.
- The **power button** (top-right) restarts / shuts down.
- The **Mind** acts on the machine through the gated, audited capability layer.

## Escape / recover / uninstall

- **Normal shell:** Ctrl+Alt+F2 (tty2), log in as your user.
- **Stop the desktop:** `systemctl disable --now voidos-console voidos-kernel`
- **Remove autologin:** delete `/etc/systemd/system/getty@tty1.service.d/autologin.conf`
- **Full uninstall:** the above + remove the unit files and `/opt/voidos`.

## Security note

The Console exposes a `/api/syscall` bridge that can run **any** capability
(including `shell.exec`). It binds to **127.0.0.1** only (`VOID_UI_HOST`) — keep
it that way. Do not expose port 7777 to a network.

## Status

This boot kit is **not testable in the dev environment** (no QEMU/hardware here),
so it is **unverified end-to-end** — the individual pieces (kernel, console,
desktop, services) are verified, the Arch/systemd/cage wiring follows standard
patterns. **Test in a VM first.**
