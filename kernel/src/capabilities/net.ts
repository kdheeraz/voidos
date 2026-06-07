import type { Capability } from "../types.ts";

// Inbound networking: stand up HTTP servers that serve files from the rootfs.
// State lives in ctx.net. (Outbound HTTP is web.fetch.)

export const netCaps: Capability[] = [
  {
    name: "net.serve",
    summary: "Start an HTTP server on a port, serving static files from a rootfs directory.",
    risk: "write",
    params: {
      type: "object",
      properties: {
        name: { type: "string", description: "Unique server name" },
        port: { type: "integer", description: "TCP port to listen on" },
        dir: { type: "string", description: "Rootfs directory to serve (default /)" },
      },
      required: ["name", "port"],
    },
    handler: async (args, ctx) =>
      ctx.net.serve(String(args.name), args.port as number, args.dir ? String(args.dir) : "/"),
  },
  {
    name: "net.list",
    summary: "List running HTTP servers with their port and request count.",
    risk: "read",
    params: { type: "object", properties: {} },
    handler: async (_args, ctx) => ({ servers: ctx.net.list() }),
  },
  {
    name: "net.status",
    summary: "Get one server's state.",
    risk: "read",
    params: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
    handler: async (args, ctx) => ctx.net.get(String(args.name)),
  },
  {
    name: "net.requests",
    summary: "Return the recent request log for a server (method, path, status).",
    risk: "read",
    params: {
      type: "object",
      properties: { name: { type: "string" }, limit: { type: "integer" } },
      required: ["name"],
    },
    handler: async (args, ctx) => ({
      requests: ctx.net.requests(String(args.name), typeof args.limit === "number" ? args.limit : undefined),
    }),
  },
  {
    name: "net.stop",
    summary: "Stop a running HTTP server.",
    risk: "write",
    params: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
    handler: async (args, ctx) => ctx.net.stop(String(args.name)),
  },
];
