import { spawn } from "node:child_process";
import type { Capability } from "../types.ts";

// --- hard safety backstop -------------------------------------------------
// Catastrophic, effectively-never-legitimate-via-the-agent commands are refused
// in the kernel BEFORE execution. This is not a soft prompt the model can reason
// past — it runs on every shell.exec. A human can still run such a command
// directly, or set VOID_ALLOW_DESTRUCTIVE=1 in the env (which the agent, running
// as an unprivileged user, cannot write). It's a safety net against mistakes and
// prompt-injection, not a substitute for real OS isolation.
function destructiveReason(cmd: string): string | null {
  const c = cmd.toLowerCase();
  if (/\b(shutdown|poweroff|halt)\b/.test(c) || /\breboot\b/.test(c) ||
      /\binit\s+[06]\b/.test(c) ||
      /\bsystemctl\b[^|;&]*\b(poweroff|reboot|halt|emergency|kexec)\b/.test(c))
    return "power-off / reboot";
  if (/\bmkfs(\.[a-z0-9]+)?\b/.test(c) || /\bwipefs\b/.test(c) ||
      /\bdd\b[^|;&]*\bof=\s*\/dev\/(sd|nvme|vd|mmcblk|hd|disk)/.test(c) ||
      />\s*\/dev\/(sd|nvme|vd|mmcblk|hd|disk)/.test(c))
    return "disk / filesystem destruction";
  if (/:\s*\(\s*\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/.test(cmd))
    return "fork bomb";
  // recursive force-delete aimed at a root / home / system path (a project
  // subdir like ./build is left to the soft confirm gate, not hard-blocked)
  const recursiveForce =
    /\brm\b[^|;&]*(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r|--recursive[^|;&]*--force|--force[^|;&]*--recursive|-[rf]\s+-[rf])/i;
  if (recursiveForce.test(cmd) &&
      /(\s|=)(\/|\/\*|~\/?|\$home\b|\/etc|\/usr|\/var|\/boot|\/bin|\/sbin|\/lib|\/opt|\/home|\/root)(\s|\/|\*|$)/i.test(` ${c} `))
    return "recursive force-delete of a system/home path";
  return null;
}

export const shellCaps: Capability[] = [
  {
    name: "shell.exec",
    summary: "Run a shell command inside the rootfs and capture its output.",
    risk: "exec",
    params: {
      type: "object",
      properties: {
        cmd: { type: "string", description: "Command line to execute via /bin/sh -c" },
        timeout_ms: { type: "integer", description: "Kill after N ms (default 15000)" },
      },
      required: ["cmd"],
    },
    handler: (args, ctx) => {
      const cmd = String(args.cmd);
      const timeout = typeof args.timeout_ms === "number" ? args.timeout_ms : 15000;
      const MAX = 1024 * 1024;

      // hard backstop: refuse catastrophic commands outright (unless an operator
      // has explicitly opted out via the env, which the agent cannot do).
      if (process.env.VOID_ALLOW_DESTRUCTIVE !== "1") {
        const reason = destructiveReason(cmd);
        if (reason) {
          return Promise.resolve({
            cmd,
            code: 126,
            stdout: "",
            stderr: `refused by voidOS safety policy: ${reason}. A human must run this directly.`,
            blocked: true,
          });
        }
      }

      return new Promise((resolveP) => {
        // New process group with stdin closed: a command that waits for input
        // fails fast instead of wedging the mind, and on timeout we SIGKILL the
        // whole group so orphaned children can't hold the pipes open.
        const child = spawn("/bin/sh", ["-c", cmd], {
          cwd: ctx.root,
          detached: true,
          stdio: ["ignore", "pipe", "pipe"],
        });
        let out = "";
        let errOut = "";
        let killed = false;
        let done = false;
        child.stdout.on("data", (d) => { if (out.length < MAX) out += String(d); });
        child.stderr.on("data", (d) => { if (errOut.length < MAX) errOut += String(d); });

        const timer = setTimeout(() => {
          killed = true;
          try {
            if (child.pid) process.kill(-child.pid, "SIGKILL");
            else child.kill("SIGKILL");
          } catch { /* already gone */ }
        }, timeout);

        const finish = (code: number) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          resolveP({
            cmd,
            code,
            stdout: out,
            stderr: killed ? `${errOut}\n[void] killed: no result after ${timeout}ms` : errOut,
            timedOut: killed,
          });
        };
        child.on("close", (code) => finish(killed ? 124 : (code ?? 0)));
        child.on("error", () => finish(127));
      });
    },
  },
];
