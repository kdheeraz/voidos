import { spawn } from "node:child_process";
import type { Capability } from "../types.ts";

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
      return new Promise((resolveP) => {
        // Run in a NEW process group with stdin closed. Two reasons:
        //  - stdin from /dev/null → a command that waits for input (a password or
        //    polkit prompt) fails fast instead of wedging the mind forever.
        //  - detached group → on timeout we SIGKILL the WHOLE group (`-pid`), so an
        //    orphaned grandchild can't keep the stdout pipe open and stall the
        //    completion callback (which is exactly how `timedatectl` froze the mind).
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
