import { hostname, platform, release } from "node:os";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Capability } from "../types.ts";

export const VOID_VERSION = "0.0.1";
const bootedAt = Date.now();

// Introspection + control capabilities. Introspection (sys.list/info/audit/policy)
// makes voidOS AI-native: the agent discovers its own syscalls, their risk, and
// the policy at runtime. Control (sys.grant/revoke) is gated by the operator token,
// which the agent never holds — so the mind cannot authorize its own privilege.

export const sysCaps: Capability[] = [
  {
    name: "sys.list",
    summary: "List every available capability with its risk class and parameter schema.",
    risk: "read",
    params: { type: "object", properties: {} },
    handler: async (_args, ctx) => {
      return {
        capabilities: ctx.caps().map((c) => ({
          name: c.name,
          summary: c.summary,
          risk: c.risk,
          params: c.params,
        })),
      };
    },
  },
  {
    name: "sys.info",
    summary: "Report voidOS kernel, host, and policy information.",
    risk: "read",
    params: { type: "object", properties: {} },
    handler: async (_args, ctx) => {
      return {
        void_version: VOID_VERSION,
        root: ctx.root,
        capability_count: ctx.caps().length,
        uptime_ms: Date.now() - bootedAt,
        policy: ctx.policy.mode,
        active_grants: ctx.grants.list(),
        host: { name: hostname(), platform: platform(), release: release(), pid: process.pid },
      };
    },
  },
  {
    name: "sys.policy",
    summary: "Report the current permission policy mode and active grants.",
    risk: "read",
    params: { type: "object", properties: {} },
    handler: async (_args, ctx) => {
      return { mode: ctx.policy.mode, grants: ctx.grants.list() };
    },
  },
  {
    name: "sys.audit",
    summary: "Return the most recent audit-log entries (every syscall, allowed or denied).",
    risk: "read",
    params: {
      type: "object",
      properties: { limit: { type: "integer", description: "How many recent entries (default 20)" } },
    },
    handler: async (args, ctx) => {
      const limit = typeof args.limit === "number" ? args.limit : 20;
      let lines: string[] = [];
      try {
        const raw = await readFile(join(ctx.root, ".void", "audit.log"), "utf8");
        lines = raw.split("\n").filter((l) => l.trim());
      } catch {
        lines = [];
      }
      const entries = lines.slice(-limit).map((l) => JSON.parse(l));
      return { count: entries.length, entries };
    },
  },
  {
    name: "sys.grant",
    summary: "Operator-only: authorize a capability, risk class, or 'all' for N uses. Requires the operator token.",
    risk: "read",
    params: {
      type: "object",
      properties: {
        token: { type: "string", description: "The operator token minted at boot" },
        target: { type: "string", description: "Capability name (e.g. shell.exec), risk class (write/exec), or 'all'" },
        uses: { type: "integer", description: "Number of uses to grant; omit for a single use, -1 for unlimited" },
      },
      required: ["token", "target"],
    },
    handler: async (args, ctx) => {
      if (args.token !== ctx.operatorToken) throw new Error("invalid operator token");
      const uses = typeof args.uses === "number" ? args.uses : 1;
      ctx.grants.grant(String(args.target), uses < 0 ? Infinity : uses);
      ctx.log(`grant: ${args.target} (+${uses < 0 ? "∞" : uses})`);
      return { granted: args.target, grants: ctx.grants.list() };
    },
  },
  {
    name: "sys.revoke",
    summary: "Operator-only: revoke a grant (or all grants). Requires the operator token.",
    risk: "read",
    params: {
      type: "object",
      properties: {
        token: { type: "string" },
        target: { type: "string", description: "Grant to revoke; omit to clear all grants" },
      },
      required: ["token"],
    },
    handler: async (args, ctx) => {
      if (args.token !== ctx.operatorToken) throw new Error("invalid operator token");
      ctx.grants.revoke(args.target ? String(args.target) : undefined);
      ctx.log(`revoke: ${args.target ?? "all"}`);
      return { revoked: args.target ?? "all", grants: ctx.grants.list() };
    },
  },
];
