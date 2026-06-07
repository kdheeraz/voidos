// voidOS — kernel ABI types.
// A Capability is a "syscall": a named, self-describing, schema-validated
// operation the AI mind can invoke through the bus.

export interface JsonSchema {
  type?: "string" | "number" | "integer" | "boolean" | "object" | "array";
  description?: string;
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  required?: string[];
  enum?: string[];
  default?: unknown;
}

/** Risk class of a capability — drives the permission policy. */
export type Risk = "read" | "write" | "exec";

/** Permission policy mode, chosen at boot via VOID_POLICY. */
export type Mode = "permissive" | "guarded" | "paranoid";

export interface Capability {
  /** Dotted name, e.g. "fs.read". The "syscall number" of voidOS. */
  name: string;
  /** One-line description, surfaced to the agent via sys.list. */
  summary: string;
  /** read = side-effect-free; write = mutates state or egress; exec = arbitrary code. */
  risk: Risk;
  /** Object schema describing the accepted params. */
  params: JsonSchema;
  /** Implementation. Throwing rejects the syscall with EFAULT. */
  handler: (args: Record<string, unknown>, ctx: CapabilityContext) => Promise<unknown>;
}

export interface AuditEntry {
  ts: string;
  capability: string;
  risk: Risk | "unknown";
  decision: "allowed" | "denied";
  reason: string;
  ok?: boolean;
  error?: string;
  ms?: number;
  args?: string;
}

// Type-only imports — erased at runtime, so no import cycle.
import type { Policy, GrantStore } from "./policy.ts";
import type { ProcessManager } from "./procman.ts";
import type { ServiceSupervisor } from "./services.ts";
import type { Scheduler } from "./scheduler.ts";
import type { NetManager } from "./net.ts";
import type { WindowManager } from "./desktop/wm.ts";

/** Ambient services handed to every capability handler. */
export interface CapabilityContext {
  /** Absolute path to the voidOS rootfs (the sandbox boundary for fs/shell). */
  root: string;
  /** Structured kernel log. */
  log: (msg: string) => void;
  /** Snapshot of all registered capabilities (used by sys.* introspection). */
  caps: () => Capability[];
  /** The active permission policy. */
  policy: Policy;
  /** Live grant table (operator-authorized exceptions). */
  grants: GrantStore;
  /** Append one entry to the audit log. */
  audit: (entry: AuditEntry) => void;
  /** Secret minted at boot; required to call sys.grant / sys.revoke. */
  operatorToken: string;
  /** Supervisor for long-running processes (proc.* capabilities). */
  procs: ProcessManager;
  /** Supervisor for declared, self-healing services (svc.* capabilities). */
  services: ServiceSupervisor;
  /** Time-based scheduler (cron.* capabilities). */
  scheduler: Scheduler;
  /** Inbound HTTP servers (net.* capabilities). */
  net: NetManager;
  /** The desktop window manager (desktop.* capabilities). */
  desktop: WindowManager;
}

export interface RpcRequest {
  id?: string | number | null;
  /** Capability name to invoke. */
  method: string;
  params?: Record<string, unknown>;
}

export interface RpcError {
  code: string;
  message: string;
}

export type RpcResponse =
  | { id: string | number | null; ok: true; result: unknown }
  | { id: string | number | null; ok: false; error: RpcError };
