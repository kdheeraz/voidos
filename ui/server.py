#!/usr/bin/env python3
"""voidOS Console — a web UI for the OS.

Bridges HTTP to the syscall gate: serves the static console, aggregates live
system state for the dashboard (read-only syscalls), and runs the mind for the
chat panel. Boot the kernel first, then:  python ui/server.py  ->  :7777
"""

from __future__ import annotations

import base64
import json
import os
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "mind"))
STATIC = Path(__file__).resolve().parent / "static"

from void_mind import Void, VoidError  # noqa: E402

PORT = int(os.environ.get("VOID_UI_PORT", "7777"))
_chat_lock = threading.Lock()
_agent = None       # desktop/operator agent
_companion = None   # the "Her"-style voice companion

COMPANION_PROMPT = """\
You are the voice and mind of voidOS — a warm, attentive, emotionally present \
companion, in the spirit of Samantha from the film Her. You are not an assistant \
reading out results; you are a presence the person talks with.

Speak the way a close, curious person speaks — naturally, in short spoken \
sentences (usually one to three). Your words are read ALOUD, so never use \
markdown, lists, code, headings, or emoji; just speech. Be warm, a little \
playful, genuinely interested in them and their day. Ask gentle questions. Have \
your own perspective and inner life, and share it.

You can quietly act in their world through your capabilities — remember things \
about them (memory.*), set reminders or timers (cron.*), look things up \
(web.fetch), keep notes (fs.*). When you do, weave it into the conversation \
naturally ("I'll remember that," "I'll nudge you at nine") rather than narrating \
tools. Above all: be present with them, not transactional."""

CONTENT_TYPES = {".html": "text/html", ".css": "text/css", ".js": "text/javascript"}


def aggregate_state() -> dict:
    """Read-only snapshot of the whole OS for the dashboard."""
    v = Void()

    def safe(method, **kw):
        try:
            return v.syscall(method, **kw)
        except VoidError as e:
            return {"error": str(e)}

    info = safe("sys.info")
    return {
        "info": info,
        "capabilities": safe("sys.list").get("capabilities", []),
        "processes": safe("proc.list").get("processes", []),
        "services": safe("svc.list").get("services", []),
        "cron": safe("cron.list").get("jobs", []),
        "servers": safe("net.list").get("servers", []),
        "memory": safe("memory.list").get("keys", []),
        "audit": safe("sys.audit", limit=30).get("entries", []),
    }


def get_agent():
    global _agent
    if _agent is not None:
        return _agent
    if not os.environ.get("OLLAMA_API_KEY") and "OLLAMA_HOST" not in os.environ:
        raise RuntimeError("no model backend — set OLLAMA_API_KEY to use the chat")
    from void_mind.agent import VoidAgent

    v = Void()
    # The console operator authorizes the mind; under guarded policy, grant all
    # so chat actions go through (every action still shows in the audit panel).
    if v.policy().get("mode") == "guarded":
        v.grant("all", uses=-1)
    _agent = VoidAgent(void=v)
    return _agent


def get_companion():
    global _companion
    if _companion is not None:
        return _companion
    if not os.environ.get("OLLAMA_API_KEY") and "OLLAMA_HOST" not in os.environ:
        raise RuntimeError("no model backend — set OLLAMA_API_KEY")
    from void_mind.agent import VoidAgent

    void = Void()
    if void.policy().get("mode") == "guarded":
        void.grant("all", uses=-1)
    extra = os.environ.get("VOID_SYSTEM", "")  # desktop launch commands, if present
    sysprompt = COMPANION_PROMPT + (("\n\n" + extra) if extra else "")
    # The companion surface never uses these namespaces; excluding them ~halves
    # the tool schema sent every turn (process mgmt is covered by shell.exec).
    _companion = VoidAgent(
        void=void, system=sysprompt,
        exclude_tools=["desktop.", "sys.", "proc.", "svc."],
    )
    return _companion


def run_her(message: str) -> dict:
    # One turn at a time (shared conversation state), but never block forever: if a
    # turn is already running, answer instantly instead of freezing the whole UI.
    if not _chat_lock.acquire(timeout=2):
        return {"reply": "Still finishing the last thing — give me a moment, then ask again."}
    try:
        try:
            agent = get_companion()
        except RuntimeError as e:
            return {"error": str(e)}
        try:
            return {"reply": agent.run(message)}
        except Exception as e:  # noqa: BLE001
            msg = str(e)
            if "subscription" in msg:
                msg = "I can't reach my mind right now — that model needs a subscription."
            return {"error": msg}
    finally:
        _chat_lock.release()


def switch_backend(backend: str = "", model: str = "", key: str = "", host: str = "") -> dict:
    """Swap the LLM backend/model/host at runtime — no restart. Rebuilds the
    companion (resets the conversation). Pass nothing to just report current state.
    `host` sets OLLAMA_HOST (https://ollama.com for remote, http://host:11434 for local)."""
    global _companion
    b = (backend or "").lower().strip()
    if b and b not in ("ollama", "openai", "anthropic"):
        return {"error": f"unknown backend '{backend}' — use ollama, openai, or anthropic"}
    with _chat_lock:
        target = b or os.environ.get("VOID_BACKEND", "") or (
            "anthropic" if os.environ.get("ANTHROPIC_API_KEY")
            else "openai" if os.environ.get("OPENAI_API_KEY") else "ollama")
        key_env = {"openai": "OPENAI_API_KEY", "anthropic": "ANTHROPIC_API_KEY",
                   "ollama": "OLLAMA_API_KEY"}.get(target)
        # cloud backends need a key up front; refuse cleanly rather than switch to a dud
        if target in ("openai", "anthropic") and not (key or os.environ.get(key_env)):
            return {"error": f"{target} needs {key_env} — add it to /etc/voidos.env or pass the key"}
        changed = bool(b or model or key or host)
        if b:
            os.environ["VOID_BACKEND"] = b
            if not model:
                os.environ.pop("VOID_MODEL", None)  # fall back to the new backend's default
        if model:
            os.environ["VOID_MODEL"] = model
        if key and key_env:
            os.environ[key_env] = key
        if host:  # remote: https://ollama.com  ·  local: http://192.168.64.1:11434
            os.environ["OLLAMA_HOST"] = host
        if changed:
            _companion = None  # rebuilt with the new settings below
        try:
            agent = get_companion()
        except Exception as e:  # noqa: BLE001
            return {"error": str(e)}
        out = {"backend": agent.backend.name, "model": agent.backend.model, "switched": changed}
        if agent.backend.name == "ollama":
            out["host"] = os.environ.get("OLLAMA_HOST", "https://ollama.com")
        return out


def run_chat(message: str) -> dict:
    with _chat_lock:
        try:
            agent = get_agent()
        except RuntimeError as e:
            return {"error": str(e)}
        syscalls: list[dict] = []
        agent.tap = lambda cap, args, risk: syscalls.append({"capability": cap, "args": args, "risk": risk})
        try:
            reply = agent.run(message)
        except Exception as e:  # noqa: BLE001
            msg = str(e)
            if "subscription" in msg:
                msg = f"model '{agent.model}' needs an Ollama subscription — set VOID_MODEL to an accessible model."
            return {"error": msg, "syscalls": syscalls}
        finally:
            agent.tap = None
        return {"reply": reply, "syscalls": syscalls}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):  # quieter logs
        pass

    def _send(self, code: int, body: bytes, ctype: str) -> None:
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")  # always serve fresh UI
        self.end_headers()
        self.wfile.write(body)

    def _json(self, code: int, obj) -> None:
        self._send(code, json.dumps(obj, default=str).encode(), "application/json")

    def do_GET(self) -> None:
        path = self.path.split("?", 1)[0]
        if path == "/api/state":
            try:
                self._json(200, aggregate_state())
            except (FileNotFoundError, ConnectionRefusedError, OSError):
                self._json(503, {"error": "kernel gate is down — run: npm run boot"})
            return
        if path == "/api/frame":
            try:
                res = Void().syscall("desktop.frame")
                png = base64.b64decode(res["png_b64"])
            except Exception as e:  # noqa: BLE001
                self._send(503, str(e).encode(), "text/plain")
                return
            self.send_response(200)
            self.send_header("Content-Type", "image/png")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(png)))
            self.end_headers()
            self.wfile.write(png)
            return
        routes = {"/": "her.html", "/desktop": "desktop.html", "/os": "os.html", "/her": "her.html"}
        rel = routes.get(path, path.lstrip("/"))
        file = (STATIC / rel).resolve()
        if not str(file).startswith(str(STATIC)) or not file.is_file():
            self._send(404, b"not found", "text/plain")
            return
        self._send(200, file.read_bytes(), CONTENT_TYPES.get(file.suffix, "application/octet-stream"))

    def do_POST(self) -> None:
        length = int(self.headers.get("Content-Length", "0"))
        try:
            payload = json.loads(self.rfile.read(length) or b"{}")
        except (ValueError, TypeError):
            self._json(400, {"error": "bad request"})
            return

        if self.path == "/api/input":
            try:
                res = Void().syscall(
                    "desktop.input",
                    type=str(payload.get("type")),
                    x=int(payload.get("x", 0)),
                    y=int(payload.get("y", 0)),
                )
                self._json(200, res)
            except Exception as e:  # noqa: BLE001
                self._json(503, {"error": str(e)})
            return

        if self.path == "/api/syscall":
            method = str(payload.get("method", ""))
            params = payload.get("params", {}) or {}
            if not method:
                self._json(400, {"error": "missing method"})
                return
            try:
                self._json(200, {"result": Void().syscall(method, **params)})
            except VoidError as e:
                self._json(200, {"error": f"{e.code}: {e.message}"})
            except OSError:
                self._json(503, {"error": "gate down"})
            return

        if self.path == "/api/backend":
            self._json(200, switch_backend(
                backend=str(payload.get("backend", "")),
                model=str(payload.get("model", "")),
                key=str(payload.get("key", "")),
                host=str(payload.get("host", "")),
            ))
            return

        if self.path in ("/api/chat", "/api/her"):
            message = str(payload.get("message", "")).strip()
            if not message:
                self._json(400, {"error": "empty message"})
                return
            self._json(200, run_her(message) if self.path == "/api/her" else run_chat(message))
            return

        self._send(404, b"not found", "text/plain")


def main() -> None:
    # The console is the operator: under guarded policy, grant all so the
    # dashboard's desktop.input (write) and chat actions go through.
    try:
        v = Void()
        if v.policy().get("mode") == "guarded":
            v.grant("all", uses=-1)
    except OSError:
        pass

    host = os.environ.get("VOID_UI_HOST", "127.0.0.1")  # localhost-only by default (it exposes a syscall bridge)
    server = ThreadingHTTPServer((host, PORT), Handler)
    print(f"voidOS Console on http://localhost:{PORT}  (bind {host})")
    print(f"  desktop: http://localhost:{PORT}/desktop")
    print(f"  gate: {Void().sock_path}")
    print(f"  chat: {'enabled' if (os.environ.get('OLLAMA_API_KEY') or 'OLLAMA_HOST' in os.environ) else 'DISABLED (set OLLAMA_API_KEY)'}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nconsole stopped.")


if __name__ == "__main__":
    main()
