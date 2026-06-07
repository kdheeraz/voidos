import type { CapabilityContext, JsonSchema, RpcError } from "./types.ts";
import { Registry } from "./registry.ts";

type Dispatch =
  | { ok: true; result: unknown }
  | { ok: false; error: RpcError };

/** The syscall bus: enforces policy, validates, dispatches, and audits. */
export class Bus {
  registry: Registry;
  ctx: CapabilityContext;

  constructor(registry: Registry, ctx: CapabilityContext) {
    this.registry = registry;
    this.ctx = ctx;
  }

  async dispatch(method: string, params: Record<string, unknown>): Promise<Dispatch> {
    const ts = new Date().toISOString();
    const cap = this.registry.get(method);
    if (!cap) {
      this.ctx.audit({ ts, capability: method, risk: "unknown", decision: "denied", reason: "ENOSYS" });
      return { ok: false, error: { code: "ENOSYS", message: `unknown capability: ${method}` } };
    }

    const argsSummary = redact(params ?? {});

    // 1. Permission check.
    const decision = this.ctx.policy.decide(method, cap.risk, this.ctx.grants);
    if (!decision.allow) {
      this.ctx.audit({ ts, capability: method, risk: cap.risk, decision: "denied", reason: decision.reason, args: argsSummary });
      return { ok: false, error: { code: "EPERM", message: decision.reason } };
    }

    // 2. Param validation.
    const invalid = validate(cap.params, params ?? {});
    if (invalid) {
      this.ctx.audit({ ts, capability: method, risk: cap.risk, decision: "denied", reason: `EINVAL: ${invalid}`, args: argsSummary });
      return { ok: false, error: { code: "EINVAL", message: invalid } };
    }

    // 3. Spend the grant (if this allow was backed by one), then run.
    if (decision.grantKey) this.ctx.grants.consume(decision.grantKey);
    const started = Date.now();
    try {
      const result = await cap.handler(params ?? {}, this.ctx);
      this.ctx.audit({ ts, capability: method, risk: cap.risk, decision: "allowed", reason: decision.reason, ok: true, ms: Date.now() - started, args: argsSummary });
      return { ok: true, result };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      this.ctx.audit({ ts, capability: method, risk: cap.risk, decision: "allowed", reason: decision.reason, ok: false, error: message, ms: Date.now() - started, args: argsSummary });
      return { ok: false, error: { code: "EFAULT", message } };
    }
  }
}

/** Compact, secret-safe summary of call args for the audit log. */
function redact(args: Record<string, unknown>): string {
  const safe: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    safe[k] = k === "token" ? "***" : v;
  }
  const s = JSON.stringify(safe);
  return s.length > 300 ? s.slice(0, 300) + "…" : s;
}

/** Minimal structural validation: required fields + shallow type checks. */
function validate(schema: JsonSchema, args: Record<string, unknown>): string | null {
  for (const key of schema.required ?? []) {
    if (args[key] === undefined || args[key] === null) {
      return `missing required param: ${key}`;
    }
  }
  for (const [key, sub] of Object.entries(schema.properties ?? {})) {
    const val = args[key];
    if (val === undefined) continue;
    const t = sub.type;
    if (!t) continue;
    const actual = jsonType(val);
    const ok =
      (t === "integer" && actual === "number" && Number.isInteger(val)) || actual === t;
    if (!ok) return `param "${key}" expected ${t}, got ${actual}`;
    if (sub.enum && !sub.enum.includes(val as string)) {
      return `param "${key}" must be one of: ${sub.enum.join(", ")}`;
    }
  }
  return null;
}

function jsonType(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}
