import type { Capability } from "../types.ts";

// Process supervision: spawn long-running programs and manage them, unlike
// shell.exec which is one-shot and blocking. State lives in ctx.procs.

export const procCaps: Capability[] = [
  {
    name: "proc.spawn",
    summary: "Start a long-running background process; returns its id and pid. Output is captured.",
    risk: "exec",
    params: {
      type: "object",
      properties: { cmd: { type: "string", description: "Command line run via /bin/sh -c" } },
      required: ["cmd"],
    },
    handler: async (args, ctx) => ctx.procs.spawn(String(args.cmd)),
  },
  {
    name: "proc.list",
    summary: "List managed processes with status, pid, and exit info.",
    risk: "read",
    params: { type: "object", properties: {} },
    handler: async (_args, ctx) => ({ processes: ctx.procs.list() }),
  },
  {
    name: "proc.status",
    summary: "Get the status of one managed process.",
    risk: "read",
    params: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
    handler: async (args, ctx) => ctx.procs.get(String(args.id)),
  },
  {
    name: "proc.logs",
    summary: "Return captured stdout/stderr for a process (most recent bytes).",
    risk: "read",
    params: {
      type: "object",
      properties: { id: { type: "string" }, max_bytes: { type: "integer" } },
      required: ["id"],
    },
    handler: async (args, ctx) =>
      ctx.procs.logs(String(args.id), typeof args.max_bytes === "number" ? args.max_bytes : undefined),
  },
  {
    name: "proc.stop",
    summary: "Signal a running process to stop (default SIGTERM).",
    risk: "write",
    params: {
      type: "object",
      properties: {
        id: { type: "string" },
        signal: { type: "string", description: "e.g. SIGTERM, SIGKILL, SIGINT" },
      },
      required: ["id"],
    },
    handler: async (args, ctx) =>
      ctx.procs.stop(String(args.id), args.signal ? String(args.signal) : undefined),
  },
  {
    name: "proc.remove",
    summary: "Forget an exited process, freeing its record. Refuses if still running.",
    risk: "write",
    params: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
    handler: async (args, ctx) => {
      ctx.procs.remove(String(args.id));
      return { removed: args.id };
    },
  },
];
