import { execFile } from "node:child_process";
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
      return new Promise((resolveP) => {
        execFile(
          "/bin/sh",
          ["-c", cmd],
          { cwd: ctx.root, timeout, maxBuffer: 1024 * 1024, encoding: "utf8" },
          (err, stdout, stderr) => {
            resolveP({
              cmd,
              code: err && typeof (err as { code?: number }).code === "number"
                ? (err as { code?: number }).code
                : err ? 1 : 0,
              stdout,
              stderr,
            });
          },
        );
      });
    },
  },
];
