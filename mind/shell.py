"""voidsh — the voidOS shell.

The primary interface to voidOS: you talk to the mind in natural language and it
acts on the machine through the kernel's capability gate. Boot the kernel first
(`npm run boot`), set ANTHROPIC_API_KEY, then run `python mind/shell.py`.
"""

import os
import sys

from void_mind import Void, VoidError


BANNER = r"""
                _     _  ___  ____
__   _____ (_) __| |/ _ \/ ___|
\ \ / / _ \| |/ _` | | | \___ \
 \ V / (_) | | (_| | |_| |___) |
  \_/ \___/|_|\__,_|\___/|____/   the AI-native OS

type what you want done. ctrl-d or 'exit' to leave.
"""


def main() -> None:
    void = Void()

    # Fail fast with a clear message if the kernel gate isn't up.
    try:
        info = void.info()
    except (FileNotFoundError, ConnectionRefusedError, OSError):
        print(f"cannot reach the voidOS kernel at {void.sock_path}", file=sys.stderr)
        print("boot it first:  npm run boot", file=sys.stderr)
        sys.exit(1)

    if not os.environ.get("OLLAMA_API_KEY") and "OLLAMA_HOST" not in os.environ:
        print("OLLAMA_API_KEY is not set — the mind needs it to reach ollama.com.", file=sys.stderr)
        print("set it and re-run:  export OLLAMA_API_KEY=...", file=sys.stderr)
        print("(or point OLLAMA_HOST at a local Ollama to run keyless)", file=sys.stderr)
        sys.exit(1)

    from void_mind.agent import VoidAgent, SYSTEM_PROMPT

    # Set up the operator gate based on the kernel's policy. In guarded/paranoid
    # mode, the mind's write/exec syscalls are denied until the operator (you)
    # approves them — at which point the shell issues a one-shot kernel grant
    # using the operator token. The mind never sees the token.
    mode = void.policy().get("mode", "guarded")
    approver = None
    granter = None
    if mode != "permissive":
        token = void.operator_token()
        always: set[str] = set()

        def approver(capability: str, args: dict, risk: str) -> bool:  # noqa: F811
            if capability in always:
                return True
            pretty = ", ".join(f"{k}={v!r}" for k, v in args.items())
            ans = input(f"  [authorize {risk}] {capability}({pretty})  allow? [y/N/a=always] ").strip().lower()
            if ans == "a":
                always.add(capability)
                return True
            return ans in ("y", "yes")

        def granter(capability: str) -> None:  # noqa: F811
            void.grant(capability, uses=1, token=token)

    # On a desktop, VOID_SYSTEM tells the mind how to open apps/web/media.
    extra = os.environ.get("VOID_SYSTEM", "")
    system = SYSTEM_PROMPT + ("\n\n" + extra if extra else "")
    agent = VoidAgent(void=void, approver=approver, granter=granter, system=system)
    print(BANNER)
    print(f"kernel v{info['void_version']} · {len(agent.tools)} syscalls · model {agent.model} · policy {mode}")
    if mode != "permissive":
        print("write/exec syscalls will ask for your approval.\n")
    else:
        print("policy is permissive — the mind acts without prompting.\n")

    while True:
        try:
            line = input("you> ").strip()
        except EOFError:
            print()
            break
        if not line:
            continue
        if line in ("exit", "quit"):
            break
        try:
            agent.run(line)
        except VoidError as e:
            print(f"syscall error: {e}", file=sys.stderr)
        except KeyboardInterrupt:
            print("\n[interrupted]")
        except Exception as e:
            msg = str(e)
            if "subscription" in msg:
                print(f"model '{agent.model}' needs an Ollama subscription.", file=sys.stderr)
                print("upgrade at https://ollama.com/upgrade, or pick another:", file=sys.stderr)
                print("  export VOID_MODEL=gpt-oss:120b   # then re-run", file=sys.stderr)
            else:
                print(f"mind error: {msg}", file=sys.stderr)

    print("voidOS halted.")


if __name__ == "__main__":
    main()
