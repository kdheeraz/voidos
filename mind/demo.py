"""End-to-end smoke test of the voidOS syscall layer.

Boot the kernel first (npm run boot), then run:  python3 mind/demo.py
"""

from void_mind import Void, VoidError


def section(title: str) -> None:
    print(f"\n=== {title} ===")


def main() -> None:
    void = Void()

    section("sys.info")
    info = void.info()
    print(f"voidOS v{info['void_version']} · {info['capability_count']} capabilities · policy {info['policy']} · pid {info['host']['pid']}")

    # This script is the operator, so it grants itself everything up front
    # (not needed under permissive; required under the default guarded policy).
    if info["policy"] == "guarded":
        void.grant("all", uses=-1)
        print("operator granted: all (unlimited) for this demo")

    section("sys.list — the agent discovers its own syscalls")
    for cap in void.capabilities():
        print(f"  {cap['name']:<14} {cap['summary']}")

    section("fs.write / fs.read")
    void.write("/notes/hello.txt", "voidOS is alive.\n")
    print("read back:", repr(void.read("/notes/hello.txt")))

    section("fs.list /notes")
    for e in void.ls("/notes"):
        print(f"  {e['kind']:<4} {e['path']}")

    section("memory.set / memory.get")
    void.remember("operator", "dheeraj")
    print("recall operator ->", void.recall("operator"))

    section("shell.exec")
    out = void.syscall("shell.exec", cmd="echo hello from $(uname -s)")
    print("stdout:", out["stdout"].strip(), "| code:", out["code"])

    section("error handling — unknown capability")
    try:
        void.syscall("does.not.exist")
    except VoidError as e:
        print("caught:", e)

    print("\nAll syscalls exercised. voidOS milestone 1 is live.")


if __name__ == "__main__":
    main()
