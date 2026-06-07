import { spawn, type ChildProcess } from "node:child_process";

const MAX_LOG = 64 * 1024; // per-process captured output ring (bytes)

export interface ProcRecord {
  id: string;
  cmd: string;
  pid: number;
  status: "running" | "exited";
  startedAt: string;
  endedAt?: string;
  exitCode: number | null;
  signal: string | null;
}

interface ProcEntry extends ProcRecord {
  child: ChildProcess;
  log: string;
}

/**
 * Supervises long-running background processes spawned by the mind. Each is a
 * child of the kernel (so it's reaped here), tracked by a short id, with its
 * combined stdout/stderr captured into a capped ring buffer.
 */
export class ProcessManager {
  private procs = new Map<string, ProcEntry>();
  private seq = 0;
  private root: string;
  private onLog: (msg: string) => void;

  constructor(root: string, onLog: (msg: string) => void) {
    this.root = root;
    this.onLog = onLog;
  }

  spawn(cmd: string): ProcRecord {
    const id = `p${++this.seq}`;
    const child = spawn("/bin/sh", ["-c", cmd], {
      cwd: this.root,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const entry: ProcEntry = {
      id,
      cmd,
      pid: child.pid ?? -1,
      status: "running",
      startedAt: new Date().toISOString(),
      exitCode: null,
      signal: null,
      child,
      log: "",
    };
    const append = (buf: Buffer): void => {
      entry.log += buf.toString("utf8");
      if (entry.log.length > MAX_LOG) entry.log = entry.log.slice(-MAX_LOG);
    };
    child.stdout?.on("data", append);
    child.stderr?.on("data", append);
    child.on("error", (e) => append(Buffer.from(`\n[spawn error: ${e.message}]\n`)));
    child.on("exit", (code, signal) => {
      entry.status = "exited";
      entry.exitCode = code;
      entry.signal = signal;
      entry.endedAt = new Date().toISOString();
      this.onLog(`proc ${id} exited (code=${code} signal=${signal})`);
    });
    this.procs.set(id, entry);
    this.onLog(`proc ${id} spawned (pid=${entry.pid}): ${cmd}`);
    return record(entry);
  }

  list(): ProcRecord[] {
    return [...this.procs.values()].map(record);
  }

  get(id: string): ProcRecord {
    const e = this.procs.get(id);
    if (!e) throw new Error(`no such process: ${id}`);
    return record(e);
  }

  logs(id: string, maxBytes = MAX_LOG): { id: string; status: string; log: string } {
    const e = this.procs.get(id);
    if (!e) throw new Error(`no such process: ${id}`);
    return { id, status: e.status, log: e.log.length > maxBytes ? e.log.slice(-maxBytes) : e.log };
  }

  stop(id: string, signal: string = "SIGTERM"): ProcRecord {
    const e = this.procs.get(id);
    if (!e) throw new Error(`no such process: ${id}`);
    if (e.status === "running") e.child.kill(signal as NodeJS.Signals);
    return record(e);
  }

  remove(id: string): void {
    const e = this.procs.get(id);
    if (!e) throw new Error(`no such process: ${id}`);
    if (e.status === "running") throw new Error(`process ${id} is still running; stop it first`);
    this.procs.delete(id);
  }

  /** Terminate every running process — called on kernel shutdown. */
  shutdown(): void {
    for (const e of this.procs.values()) {
      if (e.status === "running") e.child.kill("SIGTERM");
    }
  }
}

function record(e: ProcEntry): ProcRecord {
  return {
    id: e.id,
    cmd: e.cmd,
    pid: e.pid,
    status: e.status,
    startedAt: e.startedAt,
    endedAt: e.endedAt,
    exitCode: e.exitCode,
    signal: e.signal,
  };
}
