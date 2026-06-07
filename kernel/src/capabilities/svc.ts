import type { Capability } from "../types.ts";

// Services: named, self-healing long-running programs the kernel keeps alive
// per a restart policy. State lives in ctx.services.

export const svcCaps: Capability[] = [
  {
    name: "svc.define",
    summary: "Declare a supervised service that the kernel keeps running (auto-restarts on exit).",
    risk: "exec",
    params: {
      type: "object",
      properties: {
        name: { type: "string", description: "Unique service name" },
        cmd: { type: "string", description: "Command line run via /bin/sh -c" },
        restart: { type: "string", enum: ["always", "on-failure", "no"], description: "Restart policy (default always)" },
        max_restarts: { type: "integer", description: "Crash-loop ceiling before 'failed' (default 5)" },
        autostart: { type: "boolean", description: "Start immediately (default true)" },
      },
      required: ["name", "cmd"],
    },
    handler: async (args, ctx) =>
      ctx.services.define(String(args.name), String(args.cmd), {
        restart: args.restart as "always" | "on-failure" | "no" | undefined,
        maxRestarts: typeof args.max_restarts === "number" ? args.max_restarts : undefined,
        autostart: typeof args.autostart === "boolean" ? args.autostart : undefined,
      }),
  },
  {
    name: "svc.list",
    summary: "List declared services with state, pid, restart count, and last exit.",
    risk: "read",
    params: { type: "object", properties: {} },
    handler: async (_args, ctx) => ({ services: ctx.services.list() }),
  },
  {
    name: "svc.status",
    summary: "Get the full state of one service.",
    risk: "read",
    params: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
    handler: async (args, ctx) => ctx.services.get(String(args.name)),
  },
  {
    name: "svc.logs",
    summary: "Return captured stdout/stderr for a service.",
    risk: "read",
    params: {
      type: "object",
      properties: { name: { type: "string" }, max_bytes: { type: "integer" } },
      required: ["name"],
    },
    handler: async (args, ctx) =>
      ctx.services.logs(String(args.name), typeof args.max_bytes === "number" ? args.max_bytes : undefined),
  },
  {
    name: "svc.start",
    summary: "Start (or restart) a stopped/failed service; clears its crash-loop counter.",
    risk: "exec",
    params: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
    handler: async (args, ctx) => ctx.services.start(String(args.name)),
  },
  {
    name: "svc.stop",
    summary: "Stop a service and keep it stopped (the supervisor won't restart it).",
    risk: "write",
    params: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
    handler: async (args, ctx) => ctx.services.stop(String(args.name)),
  },
  {
    name: "svc.remove",
    summary: "Stop and delete a service definition.",
    risk: "write",
    params: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
    handler: async (args, ctx) => {
      ctx.services.remove(String(args.name));
      return { removed: args.name };
    },
  },
];
