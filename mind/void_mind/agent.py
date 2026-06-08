"""The voidOS mind — an agent loop over the kernel's capability gate.

Backed by a pluggable LLM backend — Ollama (local or cloud), OpenAI, or Anthropic
(see backends.py; choose with VOID_BACKEND / VOID_MODEL). The agent's
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

from .backends import Backend, make_backend
from .client import Void, VoidError

# A human gate: given (capability, args, risk), return True to allow.
Approver = Callable[[str, dict, str], bool]
# Issued by the operator to unblock one risky call (e.g. grant it in the kernel).
Granter = Callable[[str], None]

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


class VoidAgent:
    """Drives a conversation with the model, executing voidOS syscalls as tools."""

    def __init__(
        self,
        void: Void | None = None,
        backend: Backend | None = None,
        model: str | None = None,
        approver: Optional[Approver] = None,
        granter: Optional[Granter] = None,
        tap: Optional[Callable[[str, dict, str], None]] = None,
        system: str | None = None,
        exclude_tools: list[str] | None = None,
    ) -> None:
        self.void = void or Void()
        self.backend = backend or make_backend()
        self.system = system or SYSTEM_PROMPT
        self.model = model or self.backend.model
        self.approver = approver  # consulted before any non-read syscall
        self.granter = granter    # unblocks an approved syscall (operator-side)
        self.tap = tap            # observer called with (capability, args, risk) per syscall
        self.messages: list[Any] = []  # normalized history; system is kept separate

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
            self.tools.append({
                "name": name,
                "description": cap["summary"],
                "parameters": cap.get("params") or {"type": "object", "properties": {}},
            })

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
            reply = self.backend.chat(self.system, self.messages, self.tools)

            if reply.content:
                final_text = reply.content
                print(f"\nvoid> {reply.content}")

            self.messages.append({
                "role": "assistant",
                "content": reply.content,
                "tool_calls": reply.tool_calls,
            })

            if not reply.tool_calls:
                return final_text

            for tc in reply.tool_calls:
                name = tc["name"]
                args = dict(tc["arguments"] or {})
                pretty = ", ".join(f"{k}={v!r}" for k, v in args.items())
                print(f"  · syscall {self._tool_to_capability.get(name, name)}({pretty})")
                result = self._run_syscall(name, args)
                self.messages.append({
                    "role": "tool", "id": tc["id"], "name": name, "content": result,
                })

        print("\nvoid> [reached the syscall step limit for this turn]")
        return final_text
