import { appendFile } from "node:fs/promises";
import type { AuditEntry, Mode, Risk } from "./types.ts";

/** A grant permits risky calls: keyed by capability name, risk class, or "all". */
export class GrantStore {
  private grants = new Map<string, number>(); // target -> remaining uses (Infinity = unlimited)

  grant(target: string, uses: number): void {
    const prev = this.grants.get(target) ?? 0;
    const next = prev === Infinity || uses === Infinity ? Infinity : prev + uses;
    this.grants.set(target, next);
  }

  /** Most specific grant that permits (name, risk): exact name, then class, then "all". */
  permitKey(name: string, risk: Risk): string | null {
    for (const key of [name, risk, "all"]) {
      const n = this.grants.get(key);
      if (n !== undefined && n > 0) return key;
    }
    return null;
  }

  consume(key: string): void {
    const n = this.grants.get(key);
    if (n === undefined || n === Infinity) return;
    if (n <= 1) this.grants.delete(key);
    else this.grants.set(key, n - 1);
  }

  revoke(target?: string): void {
    if (target) this.grants.delete(target);
    else this.grants.clear();
  }

  list(): Record<string, number> {
    return Object.fromEntries(
      [...this.grants.entries()].map(([k, v]) => [k, v === Infinity ? -1 : v]),
    );
  }
}

export interface Decision {
  allow: boolean;
  reason: string;
  /** When set, the named grant is consumed on a successful allow. */
  grantKey?: string;
}

export class Policy {
  mode: Mode;
  constructor(mode: Mode) {
    this.mode = mode;
  }

  decide(name: string, risk: Risk, grants: GrantStore): Decision {
    if (risk === "read") return { allow: true, reason: "read" };
    if (this.mode === "permissive") return { allow: true, reason: "permissive" };
    if (this.mode === "paranoid") return { allow: false, reason: `paranoid: ${risk} denied` };
    // guarded: write/exec require an operator-issued grant.
    const key = grants.permitKey(name, risk);
    if (key) return { allow: true, reason: `grant:${key}`, grantKey: key };
    return { allow: false, reason: `guarded: ${risk} requires an operator grant` };
  }
}

/** Returns an auditor that appends one JSON line per call (fire-and-forget). */
export function makeAuditor(path: string, log: (m: string) => void): (e: AuditEntry) => void {
  return (entry: AuditEntry): void => {
    appendFile(path, JSON.stringify(entry) + "\n").catch((e) =>
      log(`audit write failed: ${e instanceof Error ? e.message : String(e)}`),
    );
  };
}
