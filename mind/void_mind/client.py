"""Client for the voidOS syscall gate.

Speaks newline-delimited JSON-RPC over a Unix-domain socket. Each call opens a
short-lived connection, sends one request line, and reads one response line.
"""

from __future__ import annotations

import json
import os
import socket
from pathlib import Path
from typing import Any

# Repo root is three parents up from this file: mind/void_mind/client.py
_REPO_ROOT = Path(__file__).resolve().parents[2]
_DEFAULT_SOCK = _REPO_ROOT / "vfs" / ".void" / "void.sock"


class VoidError(RuntimeError):
    """Raised when a syscall returns an error envelope."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(f"{code}: {message}")
        self.code = code
        self.message = message


class Void:
    """A thin handle to the voidOS kernel."""

    def __init__(self, sock_path: str | os.PathLike[str] | None = None) -> None:
        self.sock_path = str(sock_path or os.environ.get("VOID_SOCK") or _DEFAULT_SOCK)

    def syscall(self, capability: str, /, **params: Any) -> Any:
        """Invoke a capability by name and return its result, or raise VoidError.

        `capability` is positional-only so it never collides with a param of the
        same-named capability argument (e.g. web.fetch's own `method` param).
        """
        request = json.dumps({"id": 1, "method": capability, "params": params}) + "\n"
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as s:
            s.connect(self.sock_path)
            s.sendall(request.encode("utf-8"))
            chunks: list[bytes] = []
            while b"\n" not in b"".join(chunks):
                data = s.recv(65536)
                if not data:
                    break
                chunks.append(data)
        line = b"".join(chunks).split(b"\n", 1)[0]
        resp = json.loads(line)
        if not resp.get("ok"):
            err = resp.get("error", {})
            raise VoidError(err.get("code", "EUNKNOWN"), err.get("message", "unknown error"))
        return resp["result"]

    # Convenience wrappers over common syscalls -------------------------------

    def capabilities(self) -> list[dict[str, Any]]:
        return self.syscall("sys.list")["capabilities"]

    def info(self) -> dict[str, Any]:
        return self.syscall("sys.info")

    def read(self, path: str) -> str:
        return self.syscall("fs.read", path=path)["content"]

    def write(self, path: str, content: str) -> dict[str, Any]:
        return self.syscall("fs.write", path=path, content=content)

    def ls(self, path: str = "/") -> list[dict[str, Any]]:
        return self.syscall("fs.list", path=path)["entries"]

    def remember(self, key: str, value: Any) -> None:
        self.syscall("memory.set", key=key, value=value)

    def recall(self, key: str) -> Any:
        return self.syscall("memory.get", key=key)["value"]

    # Policy / audit / operator control --------------------------------------

    def policy(self) -> dict[str, Any]:
        return self.syscall("sys.policy")

    def audit(self, limit: int = 20) -> list[dict[str, Any]]:
        return self.syscall("sys.audit", limit=limit)["entries"]

    def operator_token(self) -> str:
        """Read the operator token. Only the operator (filesystem access to the
        protected control plane) can do this — the agent's fs.* cannot."""
        token_path = Path(self.sock_path).parent / "operator.token"
        return token_path.read_text(encoding="utf-8").strip()

    def grant(self, target: str, uses: int = 1, token: str | None = None) -> dict[str, Any]:
        return self.syscall("sys.grant", token=token or self.operator_token(), target=target, uses=uses)

    def revoke(self, target: str | None = None, token: str | None = None) -> dict[str, Any]:
        tok = token or self.operator_token()
        return self.syscall("sys.revoke", token=tok) if target is None else self.syscall("sys.revoke", token=tok, target=target)
