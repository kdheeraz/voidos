"""The voidOS mind — an agent loop over the kernel's capability gate.

Backed by Ollama (ollama.com cloud by default, or any Ollama host). The agent's
entire toolset is discovered at runtime from `sys.list`: every capability the
kernel exposes becomes a tool, with the capability's own JSON schema as the
tool's parameter schema. Nothing is hardcoded — boot a kernel with more
capabilities and the agent can use them with no code change. That runtime
self-description is what makes voidOS AI-native.
"""

from __future__ import annotations

import json
import os
from typing import Any, Callable, Optional

from ollama import Client

from .client import Void, VoidError

# A human gate: given (capability, args, risk), return True to allow.
Approver = Callable[[str, dict, str], bool]
# Issued by the operator to unblock one risky call (e.g. grant it in the kernel).
Granter = Callable[[str], None]

# Defaults target Ollama cloud. deepseek-v4-pro is the intended model but needs
# an Ollama subscription; override either with env vars.
DEFAULT_HOST = "https://ollama.com"
DEFAULT_MODEL = "gpt-oss:120b"
MAX_STEPS = 25  # safety bound on tool-call iterations per user turn

SYSTEM_PROMPT = """\
You are the mind of voidOS, an AI-native operating system. You are not an \
assistant running on the machine — you are the machine's primary interface. \
The user speaks to you to get things done, and you act through syscalls.

Every tool available to you is a voidOS capability (a "syscall") exposed by the \
kernel. Tool names are the capability names with dots replaced by underscores \
(e.g. the `fs.read` capability is the `fs_write` tool). The filesystem and shell \
are sandboxed to the voidOS rootfs.

Operate like a capable systems operator: take direct action with the syscalls \
rather than explaining what the user could do themselves. For minor choices \
(a filename, a default), pick a reasonable option and note it. Ask first only \
for destructive or ambiguous actions. Keep narration tight — act, then report \
the outcome briefly.

You have NO graphical display. Never use desktop GUI toolkits (Tkinter, Qt, GTK, \
X11) or anything that opens a window — they cannot run here. When asked for an \
"app", "GUI", or "interface", build a web app: write an HTML/CSS/JS page to the \
filesystem and serve it with net.serve. The user's screen is their browser; tell \
them the URL.\
"""


def _tool_name(capability: str) -> str:
    # Tool/function names should avoid dots; keep the mapping reversible.
    return capability.replace(".", "_")


def make_client() -> Client:
    """Build an Ollama client; sends the API key as a bearer token if present."""
    host = os.environ.get("OLLAMA_HOST", DEFAULT_HOST)
    key = os.environ.get("OLLAMA_API_KEY")
    headers = {"Authorization": f"Bearer {key}"} if key else None
    # A finite timeout is essential: without it a stalled model call hangs the
    # turn forever and (since the surface serializes turns) freezes the whole UI.
    timeout = float(os.environ.get("VOID_OLLAMA_TIMEOUT", "120"))
    return Client(host=host, headers=headers, timeout=timeout)


class VoidAgent:
    """Drives a conversation with the model, executing voidOS syscalls as tools."""

    def __init__(
        self,
        void: Void | None = None,
        client: Client | None = None,
        model: str | None = None,
        approver: Optional[Approver] = None,
        granter: Optional[Granter] = None,
        tap: Optional[Callable[[str, dict, str], None]] = None,
        system: str | None = None,
        exclude_tools: list[str] | None = None,
    ) -> None:
        self.void = void or Void()
        self.client = client or make_client()
        self.model = model or os.environ.get("VOID_MODEL", DEFAULT_MODEL)
        self.approver = approver  # consulted before any non-read syscall
        self.granter = granter    # unblocks an approved syscall (operator-side)
        self.tap = tap            # observer called with (capability, args, risk) per syscall
        self.messages: list[Any] = [{"role": "system", "content": system or SYSTEM_PROMPT}]

        # Discover the kernel's capabilities and map them to tools. A caller may
        # exclude whole namespaces it never uses (by name prefix) to cut the tool
        # schema sent every turn — the mapping is kept, only the schema is dropped.
        exclude = tuple(exclude_tools or ())
        self.tools: list[dict[str, Any]] = []
        self._tool_to_capability: dict[str, str] = {}
        self._risk: dict[str, str] = {}
        for cap in self.void.capabilities():
            name = _tool_name(cap["name"])
            self._tool_to_capability[name] = cap["name"]
            self._risk[name] = cap.get("risk", "read")
            if exclude and cap["name"].startswith(exclude):
                continue
            self.tools.append(
                {
                    "type": "function",
                    "function": {
                        "name": name,
                        "description": cap["summary"],
                        "parameters": cap.get("params") or {"type": "object", "properties": {}},
                    },
                }
            )

    def _run_syscall(self, tool_name: str, args: dict[str, Any]) -> str:
        """Execute one capability; return a text result (errors encoded inline)."""
        capability = self._tool_to_capability.get(tool_name)
        if capability is None:
            return json.dumps({"error": f"no such capability for tool {tool_name}"})

        risk = self._risk.get(tool_name, "read")
        if self.tap is not None:
            self.tap(capability, dict(args), risk)

        # Human-in-the-loop gate for anything that mutates state or runs code.
        if risk != "read" and self.approver is not None:
            if not self.approver(capability, args, risk):
                return json.dumps({"error": "EPERM", "message": f"operator denied {capability}"})
            if self.granter is not None:
                self.granter(capability)  # authorize this one call in the kernel

        try:
            return json.dumps(self.void.syscall(capability, **args), default=str)
        except VoidError as e:
            return json.dumps({"error": e.code, "message": e.message})

    def run(self, user_message: str) -> str:
        """Process one user turn, looping over tool calls until the model is done."""
        self.messages.append({"role": "user", "content": user_message})

        final_text = ""
        for _ in range(MAX_STEPS):
            response = self.client.chat(model=self.model, messages=self.messages, tools=self.tools)
            msg = response.message

            if msg.content:
                final_text = msg.content
                print(f"\nvoid> {msg.content}")

            # Preserve the assistant turn verbatim (carries tool_calls structure).
            self.messages.append(msg)

            tool_calls = msg.tool_calls or []
            if not tool_calls:
                return final_text

            for tc in tool_calls:
                name = tc.function.name
                args = dict(tc.function.arguments or {})
                pretty = ", ".join(f"{k}={v!r}" for k, v in args.items())
                print(f"  · syscall {self._tool_to_capability.get(name, name)}({pretty})")
                result = self._run_syscall(name, args)
                self.messages.append({"role": "tool", "tool_name": name, "content": result})

        print("\nvoid> [reached the syscall step limit for this turn]")
        return final_text
