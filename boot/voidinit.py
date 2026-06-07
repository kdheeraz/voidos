#!/usr/bin/env python3
"""voidinit — PID 1 of voidOS.

This is what "boots into the mind." As the init process it:
  1. brings up the kernel (the syscall gate),
  2. waits for the gate to be ready,
  3. hands the machine to the mind — an interactive `voidsh` on a TTY, a
     one-shot boot task in `VOID_BOOT_TASK`, or a headless autonomous session,
  4. supervises: reaps orphaned processes (a PID-1 duty), watches the kernel,
     polls the scheduler for due wakeups and runs them on the mind, and shuts
     everything down cleanly on SIGTERM/SIGINT.

It runs unchanged whether PID 1 is in a container or a bare-metal/QEMU image.
"""

from __future__ import annotations

import os
import signal
import subprocess
import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "mind"))

WAKE_POLL_SECONDS = 2.0

_shutting_down = False
_kernel: subprocess.Popen | None = None
_console: subprocess.Popen | None = None


def log(msg: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] voidinit: {msg}", flush=True)


def start_kernel() -> subprocess.Popen:
    log("starting kernel (the syscall gate)…")
    return subprocess.Popen(["node", str(REPO / "kernel" / "src" / "index.ts")], cwd=str(REPO))


def start_console() -> subprocess.Popen:
    port = os.environ.get("VOID_UI_PORT", "7777")
    log(f"starting Console (web desktop) — open http://localhost:{port}/os")
    return subprocess.Popen(["python3", str(REPO / "ui" / "server.py")], cwd=str(REPO))


def wait_ready(timeout: float = 20.0) -> dict | None:
    from void_mind import Void

    void = Void()
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if _kernel and _kernel.poll() is not None:
            return None
        try:
            return void.info()
        except (FileNotFoundError, ConnectionRefusedError, OSError):
            time.sleep(0.25)
    return None


def build_autonomous_mind(mode: str):
    """Build the mind for headless operation, or None if no model backend.

    With no human present, voidinit is the operator: under guarded policy it
    grants the system everything so the mind can act on its own scheduled work.
    """
    if not os.environ.get("OLLAMA_API_KEY") and "OLLAMA_HOST" not in os.environ:
        return None
    from void_mind import Void
    from void_mind.agent import VoidAgent

    void = Void()
    if mode == "guarded":
        void.grant("all", uses=-1)
        log("operator granted: all (autonomous mind)")
    return (void, VoidAgent(void=void))


def poll_wakeups(bundle) -> None:
    """Drain scheduler wakeups and let the mind act on each."""
    void, agent = bundle
    try:
        wakeups = void.syscall("cron.wakeups")["wakeups"]
    except Exception as e:  # noqa: BLE001
        log(f"wakeup poll failed: {e}")
        return
    for w in wakeups:
        log(f"⏰ wakeup {w['id']} from job '{w['job']}' — handing to the mind")
        try:
            agent.run(w["prompt"])
        except Exception as e:  # noqa: BLE001
            log(f"wake task error: {e}")


def supervise(bundle) -> None:
    """Reap orphans, watch the kernel, and dispatch scheduled wakeups."""
    kernel_pid = _kernel.pid if _kernel else -1
    last_poll = 0.0
    while not _shutting_down:
        while True:  # drain any exited children
            try:
                pid, _status = os.waitpid(-1, os.WNOHANG)
            except ChildProcessError:
                log("no children left — halting")
                return
            if pid == 0:
                break
            if pid == kernel_pid:
                log("kernel exited — halting")
                return
        if bundle and time.monotonic() - last_poll >= WAKE_POLL_SECONDS:
            last_poll = time.monotonic()
            poll_wakeups(bundle)
        time.sleep(0.5)


def shutdown(signum: int, _frame: object) -> None:
    global _shutting_down
    _shutting_down = True
    log(f"signal {signal.Signals(signum).name} — shutting down")
    if _console and _console.poll() is None:
        _console.terminate()
    if _kernel and _kernel.poll() is None:
        _kernel.terminate()
        try:
            _kernel.wait(timeout=5)
        except subprocess.TimeoutExpired:
            _kernel.kill()
    log("voidOS halted.")
    sys.exit(0)


def main() -> None:
    global _kernel
    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)

    log("voidOS booting — the machine wakes into the mind")
    _kernel = start_kernel()

    info = wait_ready()
    if info is None:
        log("kernel never became ready — aborting boot")
        if _kernel and _kernel.poll() is None:
            _kernel.terminate()
        sys.exit(1)

    mode = info.get("policy", "guarded")
    log(f"gate ready · v{info['void_version']} · {info['capability_count']} syscalls · policy {mode}")

    global _console
    if os.environ.get("VOID_DESKTOP") == "1":
        _console = start_console()

    interactive = sys.stdin.isatty()
    bundle = None if interactive else build_autonomous_mind(mode)

    boot_task = os.environ.get("VOID_BOOT_TASK")
    if boot_task:
        if bundle:
            _void, agent = bundle
            log(f"handing boot task to the mind: {boot_task!r}")
            agent.run(boot_task)
            log("boot task complete")
        else:
            log("no model backend — skipping boot task (mind dormant)")
        if os.environ.get("VOID_BOOT_ONCE") == "1":
            log("VOID_BOOT_ONCE set — halting after boot task")
            shutdown(signal.SIGTERM, None)
            return
    elif interactive:
        log("interactive console — launching voidsh")
        from shell import main as shell_main

        shell_main()
        shutdown(signal.SIGTERM, None)
        return

    if bundle:
        log(f"autonomous session — polling the scheduler for wakeups every {WAKE_POLL_SECONDS:.0f}s")
    else:
        log("mind dormant (no model backend); gate is up, awaiting input")
    supervise(bundle)


if __name__ == "__main__":
    main()
