import { spawn } from "node:child_process";

const OUTPUT_CAP = 2000;

export type JobKind = "shell" | "wake";

export interface JobRecord {
  name: string;
  kind: JobKind;
  schedule: string; // human description
  enabled: boolean;
  runs: number;
  maxRuns: number | null; // null = unlimited
  createdAt: string;
  nextRunAt: string | null;
  lastRunAt?: string;
  lastResult?: unknown;
  cmd?: string;
  prompt?: string;
}

interface JobEntry extends JobRecord {
  everyMs: number | null; // recurring interval; null = one-shot
  timer?: NodeJS.Timeout;
}

/** A queued request for the mind to act, produced by a "wake" job. */
export interface Wakeup {
  id: string;
  job: string;
  prompt: string;
  firedAt: string;
}

/**
 * Time-based scheduling for voidOS. "shell" jobs run a command on a timer;
 * "wake" jobs enqueue a prompt for the mind to act on — letting voidOS schedule
 * its own future cognition. State is in-memory (resets on reboot).
 */
export class Scheduler {
  private jobs = new Map<string, JobEntry>();
  private wakeQueue: Wakeup[] = [];
  private seq = 0;
  private root: string;
  private onLog: (msg: string) => void;

  constructor(root: string, onLog: (msg: string) => void) {
    this.root = root;
    this.onLog = onLog;
  }

  schedule(opts: {
    name: string;
    cmd?: string;
    prompt?: string;
    everyMs: number | null;
    firstDelayMs: number;
    maxRuns: number | null;
  }): JobRecord {
    if (this.jobs.has(opts.name)) throw new Error(`job already exists: ${opts.name} (cancel it first)`);
    const kind: JobKind = opts.cmd != null ? "shell" : "wake";
    const schedule =
      opts.everyMs != null
        ? `every ${opts.everyMs / 1000}s${opts.maxRuns ? ` ×${opts.maxRuns}` : ""}`
        : `once in ${Math.round(opts.firstDelayMs / 1000)}s`;
    const e: JobEntry = {
      name: opts.name,
      kind,
      schedule,
      enabled: true,
      runs: 0,
      maxRuns: opts.maxRuns,
      createdAt: new Date().toISOString(),
      nextRunAt: new Date(Date.now() + opts.firstDelayMs).toISOString(),
      cmd: opts.cmd,
      prompt: opts.prompt,
      everyMs: opts.everyMs,
    };
    this.jobs.set(opts.name, e);
    e.timer = setTimeout(() => this.fire(e), opts.firstDelayMs);
    this.onLog(`cron scheduled ${opts.name} (${schedule}, ${kind})`);
    return record(e);
  }

  list(): JobRecord[] {
    return [...this.jobs.values()].map(record);
  }

  get(name: string): JobRecord {
    return record(this.entry(name));
  }

  cancel(name: string): void {
    const e = this.entry(name);
    if (e.timer) clearTimeout(e.timer);
    this.jobs.delete(name);
    this.onLog(`cron cancelled ${name}`);
  }

  /** Drain queued wakeups (returns and clears them). */
  drainWakeups(): Wakeup[] {
    const out = this.wakeQueue;
    this.wakeQueue = [];
    return out;
  }

  shutdown(): void {
    for (const e of this.jobs.values()) if (e.timer) clearTimeout(e.timer);
  }

  private entry(name: string): JobEntry {
    const e = this.jobs.get(name);
    if (!e) throw new Error(`no such job: ${name}`);
    return e;
  }

  private fire(e: JobEntry): void {
    e.timer = undefined;
    e.runs += 1;
    e.lastRunAt = new Date().toISOString();

    if (e.kind === "wake") {
      const w: Wakeup = { id: `w${++this.seq}`, job: e.name, prompt: e.prompt ?? "", firedAt: e.lastRunAt };
      this.wakeQueue.push(w);
      e.lastResult = { queued: w.id };
      this.onLog(`cron ${e.name} fired → wakeup ${w.id} queued`);
      this.afterFire(e);
      return;
    }

    let out = "";
    const child = spawn("/bin/sh", ["-c", e.cmd ?? ""], { cwd: this.root, env: process.env });
    const append = (b: Buffer): void => {
      out += b.toString("utf8");
    };
    child.stdout?.on("data", append);
    child.stderr?.on("data", append);
    child.on("error", (err) => {
      e.lastResult = { error: err.message };
      this.afterFire(e);
    });
    child.on("exit", (code) => {
      e.lastResult = { exitCode: code, output: out.slice(-OUTPUT_CAP) };
      this.onLog(`cron ${e.name} ran (exit=${code})`);
      this.afterFire(e);
    });
  }

  private afterFire(e: JobEntry): void {
    const reachedMax = e.maxRuns != null && e.runs >= e.maxRuns;
    if (e.everyMs != null && !reachedMax && e.enabled) {
      e.nextRunAt = new Date(Date.now() + e.everyMs).toISOString();
      e.timer = setTimeout(() => this.fire(e), e.everyMs);
    } else {
      e.nextRunAt = null;
      e.enabled = false;
    }
  }
}

function record(e: JobEntry): JobRecord {
  return {
    name: e.name,
    kind: e.kind,
    schedule: e.schedule,
    enabled: e.enabled,
    runs: e.runs,
    maxRuns: e.maxRuns,
    createdAt: e.createdAt,
    nextRunAt: e.nextRunAt,
    lastRunAt: e.lastRunAt,
    lastResult: e.lastResult,
    cmd: e.cmd,
    prompt: e.prompt,
  };
}
