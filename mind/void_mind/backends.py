"""LLM backends for the voidOS mind: Ollama (local or cloud), OpenAI, Anthropic.

The agent speaks one normalized shape:
  - a system string,
  - messages: {"role": "user"|"assistant"|"tool", ...}
      user      -> {"content": str}
      assistant -> {"content": str, "tool_calls": [{"id","name","arguments": dict}]}
      tool      -> {"id": str, "name": str, "content": str}
  - tools: [{"name", "description", "parameters": <json-schema>}]
Each backend translates that to/from its provider's API and returns a Reply.

Pick a backend with VOID_BACKEND (ollama|openai|anthropic); if unset it's inferred
from whichever API key is present. Pick the model with VOID_MODEL. Provider deps
(openai, anthropic) are imported lazily, so you only need the one you use.
"""
from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from typing import Any


@dataclass
class Reply:
    content: str = ""
    tool_calls: list[dict[str, Any]] = field(default_factory=list)  # {id, name, arguments: dict}
    input_tokens: int = 0
    output_tokens: int = 0


class Backend:
    name = "base"
    model = ""

    def chat(self, system: str, messages: list[dict], tools: list[dict]) -> Reply:
        raise NotImplementedError


# --- Ollama: local host (OLLAMA_HOST) or ollama.com cloud (OLLAMA_API_KEY) ---
class OllamaBackend(Backend):
    name = "ollama"

    def __init__(self) -> None:
        from ollama import Client
        host = os.environ.get("OLLAMA_HOST", "https://ollama.com")
        key = os.environ.get("OLLAMA_API_KEY")
        headers = {"Authorization": f"Bearer {key}"} if key else None
        timeout = float(os.environ.get("VOID_OLLAMA_TIMEOUT", "120"))
        self.client = Client(host=host, headers=headers, timeout=timeout)
        self.model = os.environ.get("VOID_MODEL", "gpt-oss:120b")

    def chat(self, system, messages, tools):
        # Thinking models (qwen3 etc.) reason at length by default — far too slow for
        # an interactive OS. The /no_think soft-switch disables it model-side (and is
        # harmless to non-thinking models); set VOID_THINK=1 to keep thinking on.
        if os.environ.get("VOID_THINK", "").lower() not in ("1", "true", "on", "yes"):
            system = (system or "") + "\n/no_think"
        msgs: list[dict] = [{"role": "system", "content": system}]
        for m in messages:
            if m["role"] == "tool":
                msgs.append({"role": "tool", "tool_name": m["name"], "content": m["content"]})
            elif m["role"] == "assistant":
                a: dict = {"role": "assistant", "content": m.get("content") or ""}
                if m.get("tool_calls"):
                    a["tool_calls"] = [
                        {"function": {"name": tc["name"], "arguments": tc["arguments"]}}
                        for tc in m["tool_calls"]
                    ]
                msgs.append(a)
            else:
                msgs.append({"role": "user", "content": m["content"]})
        otools = [{"type": "function", "function": t} for t in tools]
        r = self.client.chat(model=self.model, messages=msgs, tools=otools or None)
        calls = []
        for i, tc in enumerate(r.message.tool_calls or []):
            calls.append({"id": f"call_{i}", "name": tc.function.name,
                          "arguments": dict(tc.function.arguments or {})})
        return Reply(r.message.content or "", calls,
                     r.prompt_eval_count or 0, r.eval_count or 0)


# --- OpenAI (and OpenAI-compatible endpoints via OPENAI_BASE_URL) ---
class OpenAIBackend(Backend):
    name = "openai"

    def __init__(self) -> None:
        from openai import OpenAI
        self.client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY"),
                             base_url=os.environ.get("OPENAI_BASE_URL") or None)
        self.model = os.environ.get("VOID_MODEL", "gpt-4o")

    def chat(self, system, messages, tools):
        msgs: list[dict] = [{"role": "system", "content": system}]
        for m in messages:
            if m["role"] == "tool":
                msgs.append({"role": "tool", "tool_call_id": m["id"], "content": m["content"]})
            elif m["role"] == "assistant":
                a: dict = {"role": "assistant", "content": m.get("content") or None}
                if m.get("tool_calls"):
                    a["tool_calls"] = [
                        {"id": tc["id"], "type": "function",
                         "function": {"name": tc["name"], "arguments": json.dumps(tc["arguments"])}}
                        for tc in m["tool_calls"]
                    ]
                msgs.append(a)
            else:
                msgs.append({"role": "user", "content": m["content"]})
        otools = [{"type": "function", "function": t} for t in tools]
        r = self.client.chat.completions.create(
            model=self.model, messages=msgs, tools=otools or None)
        msg = r.choices[0].message
        calls = []
        for tc in (msg.tool_calls or []):
            try:
                args = json.loads(tc.function.arguments or "{}")
            except Exception:
                args = {}
            calls.append({"id": tc.id, "name": tc.function.name, "arguments": args})
        u = r.usage
        return Reply(msg.content or "", calls,
                     getattr(u, "prompt_tokens", 0) or 0,
                     getattr(u, "completion_tokens", 0) or 0)


# --- Anthropic (Claude Messages API) ---
class AnthropicBackend(Backend):
    name = "anthropic"

    def __init__(self) -> None:
        import anthropic
        self.client = anthropic.Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"))
        self.model = os.environ.get("VOID_MODEL", "claude-opus-4-8")
        self.max_tokens = int(os.environ.get("VOID_MAX_TOKENS", "4096"))

    def chat(self, system, messages, tools):
        amsgs: list[dict] = []
        for m in messages:
            if m["role"] == "user":
                amsgs.append({"role": "user", "content": m["content"]})
            elif m["role"] == "assistant":
                blocks: list[dict] = []
                if m.get("content"):
                    blocks.append({"type": "text", "text": m["content"]})
                for tc in m.get("tool_calls") or []:
                    blocks.append({"type": "tool_use", "id": tc["id"],
                                   "name": tc["name"], "input": tc["arguments"]})
                amsgs.append({"role": "assistant", "content": blocks or (m.get("content") or "")})
            elif m["role"] == "tool":
                block = {"type": "tool_result", "tool_use_id": m["id"], "content": m["content"]}
                # Claude wants tool results grouped into one user turn.
                if amsgs and amsgs[-1]["role"] == "user" and isinstance(amsgs[-1]["content"], list):
                    amsgs[-1]["content"].append(block)
                else:
                    amsgs.append({"role": "user", "content": [block]})
        kwargs: dict = {"model": self.model, "system": system,
                        "max_tokens": self.max_tokens, "messages": amsgs}
        if tools:
            kwargs["tools"] = [{"name": t["name"], "description": t["description"],
                                "input_schema": t["parameters"]} for t in tools]
        r = self.client.messages.create(**kwargs)
        content = ""
        calls = []
        for block in r.content:
            if block.type == "text":
                content += block.text
            elif block.type == "tool_use":
                calls.append({"id": block.id, "name": block.name,
                              "arguments": dict(block.input or {})})
        return Reply(content, calls, r.usage.input_tokens, r.usage.output_tokens)


def make_backend() -> Backend:
    choice = os.environ.get("VOID_BACKEND", "").lower().strip()
    if not choice:  # infer from whichever key is present
        if os.environ.get("ANTHROPIC_API_KEY"):
            choice = "anthropic"
        elif os.environ.get("OPENAI_API_KEY"):
            choice = "openai"
        else:
            choice = "ollama"
    if choice == "openai":
        return OpenAIBackend()
    if choice == "anthropic":
        return AnthropicBackend()
    return OllamaBackend()
