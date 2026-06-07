import { spawn, type ChildProcess } from "node:child_process";

const MAX_LOG = 64 * 1024;
const STABLE_MS = 10_000; // a run longer than this resets the restart counter
const BASE_BACKOFF = 500;
const MAX_BACKOFF = 5000;

export type RestartPolicy = "always" | "on-failure" | "no";
export type ServiceStatus = "running" | "restarting" | "stopped" | "failed";

export interface ServiceRecord {
  name: string;
  cmd: string;
  restart: RestartPolicy;
  maxRestarts: number;
  desired: "running" | "stopped";
  status: ServiceStatus;
  pid: number;
  restarts: number;
  startedAt?: string;
  lastExit?: { code: number | null; signal: string | null; at: string };
}

interface ServiceEntry extends ServiceRecord {
  child?: ChildProcess;
  log: string;
  lastStartMs: number;
  timer?: NodeJS.Timeout;
}

/**
 * Keeps named services alive per a restart policy — voidOS's init/supervisor.
 * Unlike proc.* (ad-hoc one-shots), a service is declared once and the kernel
 * restarts it when it exits, with backoff and a crash-loop guard.
 */
export class ServiceSupervisor {
  private services = new Map<string, ServiceEntry>();
  private root: string;
  private onLog: (msg: string) => void;

  constructor(root: string, onLog: (msg: string) => void) {
    this.root = root;
    this.onLog = onLog;
  }

  define(
    name: string,
    cmd: string,
    opts: { restart?: RestartPolicy; maxRestarts?: number; autostart?: boolean } = {},
  ): ServiceRecord {
    if (this.services.has(name)) throw new Error(`service already exists: ${name} (remove it first)`);
    const entry: ServiceEntry = {
      name,
      cmd,
      restart: opts.restart ?? "always",
      maxRestarts: opts.maxRestarts ?? 5,
      desired: "stopped",
      status: "stopped",
      pid: -1,
      restarts: 0,
      log: "",
      lastStartMs: 0,
    };
    this.services.set(name, entry);
    if (opts.autostart ?? true) this.start(name);
    return record(entry);
  }

  start(name: string): ServiceRecord {
    const e = this.entry(name);
    if (e.status === "running" || e.status === "restarting") return record(e);
    e.desired = "running";
    e.restarts = 0; // manual (re)start clears the crash-loop counter
    this.launch(e);
    return record(e);
  }

  stop(name: string): ServiceRecord {
    const e = this.entry(name);
    e.desired = "stopped";
    if (e.timer) {
      clearTimeout(e.timer);
      e.timer = undefined;
    }
    if (e.child && e.status === "running") e.child.kill("SIGTERM");
    else e.status = "stopped";
    return record(e);
  }

  remove(name: string): void {
    const e = this.entry(name);
    e.desired = "stopped";
    if (e.timer) clearTimeout(e.timer);
    if (e.child) e.child.kill("SIGKILL");
    this.services.delete(name);
  }

  list(): ServiceRecord[] {
    return [...this.services.values()].map(record);
  }

  get(name: string): ServiceRecord {
    return record(this.entry(name));
  }

  logs(name: string, maxBytes = MAX_LOG): { name: string; status: ServiceStatus; log: string } {
    const e = this.entry(name);
    return { name, status: e.status, log: e.log.length > maxBytes ? e.log.slice(-maxBytes) : e.log };
  }

  /** Stop everything — called on kernel shutdown. */
  shutdown(): void {
    for (const e of this.services.values()) {
      e.desired = "stopped";
      if (e.timer) clearTimeout(e.timer);
      if (e.child) e.child.kill("SIGTERM");
    }
  }

  private entry(name: string): ServiceEntry {
    const e = this.services.get(name);
    if (!e) throw new Error(`no such service: ${name}`);
    return e;
  }

  private launch(e: ServiceEntry): void {
    const child = spawn("/bin/sh", ["-c", e.cmd], {
      cwd: this.root,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    e.child = child;
    e.pid = child.pid ?? -1;
    e.status = "running";
    e.startedAt = new Date().toISOString();
    e.lastStartMs = Date.now();
    const append = (buf: Buffer): void => {
      e.log += buf.toString("utf8");
      if (e.log.length > MAX_LOG) e.log = e.log.slice(-MAX_LOG);
    };
    child.stdout?.on("data", append);
    child.stderr?.on("data", append);
    child.on("error", (err) => append(Buffer.from(`\n[spawn error: ${err.message}]\n`)));
    child.on("exit", (code, signal) => this.onExit(e, code, signal));
    this.onLog(`service ${e.name} started (pid=${e.pid})`);
  }

  private onExit(e: ServiceEntry, code: number | null, signal: string | null): void {
    e.child = undefined;
    e.pid = -1;
    e.lastExit = { code, signal, at: new Date().toISOString() };
    const ranMs = Date.now() - e.lastStartMs;

    if (e.desired === "stopped") {
      e.status = "stopped";
      this.onLog(`service ${e.name} stopped`);
      return;
    }

    const shouldRestart =
      e.restart === "always" ? true : e.restart === "on-failure" ? code !== 0 : false;
    if (!shouldRestart) {
      e.status = "stopped";
      this.onLog(`service ${e.name} exited (code=${code}); policy ${e.restart}, not restarting`);
      return;
    }

    if (ranMs > STABLE_MS) e.restarts = 0; // it was stable; forgive prior crashes
    e.restarts += 1;
    if (e.restarts > e.maxRestarts) {
      e.status = "failed";
      this.onLog(`service ${e.name} failed: exceeded ${e.maxRestarts} restarts`);
      return;
    }

    const backoff = Math.min(BASE_BACKOFF * e.restarts, MAX_BACKOFF);
    e.status = "restarting";
    this.onLog(`service ${e.name} exited (code=${code} signal=${signal}); restart #${e.restarts} in ${backoff}ms`);
    e.timer = setTimeout(() => {
      e.timer = undefined;
      if (e.desired === "running") this.launch(e);
    }, backoff);
  }
}

function record(e: ServiceEntry): ServiceRecord {
  return {
    name: e.name,
    cmd: e.cmd,
    restart: e.restart,
    maxRestarts: e.maxRestarts,
    desired: e.desired,
    status: e.status,
    pid: e.pid,
    restarts: e.restarts,
    startedAt: e.startedAt,
    lastExit: e.lastExit,
  };
}
