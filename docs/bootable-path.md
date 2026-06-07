# The path to a bootable voidOS

The goal is a real, bootable image — but the *interesting* part of an AI-native
OS is the mind and the capability layer, not re-implementing a kernel and device
drivers from scratch. So the strategy is to **stand on a minimal Linux base** and
make voidOS the thing that owns the machine on boot.

## What "AI-native OS" means here

A normal Linux box boots → `init` (PID 1) → getty → login shell.

voidOS boots → `init` (PID 1) → **the voidOS kernel + mind**. There is no login
shell as the primary surface; the agent *is* the surface. The user (or other
programs) interact with the machine by talking to the mind, which acts through
the capability gate.

## Stages

1. ✅ **Host phase.** Develop the capability bus and mind on macOS/Linux
   directly. The Unix socket gate is identical to what it will be inside the
   image, so nothing here is throwaway.

2. ✅ **Container phase.** `boot/voidinit.py` is PID 1: it brings up the kernel,
   waits for the gate, hands the machine to the mind (interactive `voidsh`, a
   one-shot `VOID_BOOT_TASK`, or an idle session), reaps orphans, and halts
   cleanly on signals. `boot/Dockerfile` packages `kernel/` + `mind/` + `boot/`
   onto Node + Python with `voidinit` as the entrypoint:

   ```bash
   npm run image:build                              # docker build -> voidos:dev
   npm run image:boot                               # interactive voidsh as PID 1
   # or a one-shot autonomous boot:
   docker run --rm -e OLLAMA_API_KEY \
     -e VOID_BOOT_ONCE=1 -e VOID_BOOT_TASK="…" voidos:dev
   ```

   Verified: the booted mind read `/proc/1` and confirmed PID 1 is `voidinit` —
   no login shell, the agent is the session leader.

3. **Bootable image phase (next).** Reuse `voidinit` unchanged; only the
   substrate changes. Use a minimal base — **Alpine** or **Buildroot** — to
   produce a kernel + initramfs whose init *is* voidinit. Sketch (Alpine):

   ```
   # in the initramfs /init (or as inittab's ::sysinit/::respawn):
   #   mount -t proc proc /proc; mount -t sysfs sys /sys
   #   exec python3 /opt/voidos/boot/voidinit.py
   ```

   Bundle Node + Python + the repo into the rootfs, point the bootloader/initrd
   at it, and boot in **QEMU** (`qemu-system-x86_64 -kernel … -initrd …`), then
   bare metal. The container image is effectively a microVM-ready rootfs already
   — Firecracker/`krun` can boot it with the same `voidinit` entrypoint.

4. **System-level capabilities.** As the image matures, capabilities graduate
   from "shell out on a host" to genuine system control: process supervision,
   networking, package/state management, device access — each exposed through
   the same self-describing capability schema the agent already understands.

## Why the capability layer comes first

Whatever the substrate — host process, container, or bootable image — the mind
only ever sees the **capability gate**. Lock that ABI down early and every later
stage is a matter of *where* the gate runs and *what* capabilities it exposes,
not a rewrite. That is why milestone 1 is the syscall layer.
