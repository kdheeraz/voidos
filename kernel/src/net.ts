import { createServer, type Server } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, posix } from "node:path";
import { resolveIn } from "./capabilities/vpath.ts";

const LOG_CAP = 200;

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
};

interface ReqLog {
  ts: string;
  method: string;
  path: string;
  status: number;
}

export interface ServerRecord {
  name: string;
  port: number;
  host: string;
  serveRoot: string;
  status: "listening" | "stopped";
  requests: number;
  startedAt: string;
}

interface ServerEntry extends ServerRecord {
  server: Server;
  log: ReqLog[];
}

/**
 * Inbound networking for voidOS: HTTP servers the mind can stand up to serve
 * files from the rootfs. Static files only; the .void control plane is sealed
 * off (resolveIn refuses it), and request traffic is logged per server.
 */
export class NetManager {
  private servers = new Map<string, ServerEntry>();
  private root: string;
  private onLog: (msg: string) => void;

  constructor(root: string, onLog: (msg: string) => void) {
    this.root = root;
    this.onLog = onLog;
  }

  serve(name: string, port: number, serveRoot: string, host = "0.0.0.0"): Promise<ServerRecord> {
    if (this.servers.has(name)) {
      return Promise.reject(new Error(`server already exists: ${name} (stop it first)`));
    }
    const server = createServer((req, res) => this.handle(name, serveRoot, req, res));
    const entry: ServerEntry = {
      name,
      port,
      host,
      serveRoot,
      status: "listening",
      requests: 0,
      startedAt: new Date().toISOString(),
      server,
      log: [],
    };
    return new Promise((resolveP, rejectP) => {
      server.once("error", (e) => rejectP(e));
      server.listen(port, host, () => {
        this.servers.set(name, entry);
        this.onLog(`net server ${name} listening on ${host}:${port} (serving ${serveRoot})`);
        resolveP(record(entry));
      });
    });
  }

  list(): ServerRecord[] {
    return [...this.servers.values()].map(record);
  }

  get(name: string): ServerRecord {
    return record(this.entry(name));
  }

  requests(name: string, limit = 50): ReqLog[] {
    return this.entry(name).log.slice(-limit);
  }

  stop(name: string): ServerRecord {
    const e = this.entry(name);
    e.server.close();
    e.status = "stopped";
    this.servers.delete(name);
    this.onLog(`net server ${name} stopped`);
    return record(e);
  }

  shutdown(): void {
    for (const e of this.servers.values()) e.server.close();
  }

  private entry(name: string): ServerEntry {
    const e = this.servers.get(name);
    if (!e) throw new Error(`no such server: ${name}`);
    return e;
  }

  private async handle(name: string, serveRoot: string, req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse): Promise<void> {
    const entry = this.servers.get(name);
    const urlPath = decodeURIComponent(new URL(req.url ?? "/", "http://void").pathname);
    let status = 200;
    try {
      let full = resolveIn(this.root, posix.join(serveRoot, urlPath));
      let s = await stat(full);
      if (s.isDirectory()) {
        full = join(full, "index.html");
        s = await stat(full);
      }
      const body = await readFile(full);
      res.writeHead(200, { "content-type": MIME[extname(full)] ?? "application/octet-stream" });
      res.end(body);
    } catch {
      status = 404;
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("voidOS: not found\n");
    }
    if (entry) {
      entry.requests += 1;
      entry.log.push({ ts: new Date().toISOString(), method: req.method ?? "GET", path: urlPath, status });
      if (entry.log.length > LOG_CAP) entry.log.shift();
    }
  }
}

function record(e: ServerEntry): ServerRecord {
  return {
    name: e.name,
    port: e.port,
    host: e.host,
    serveRoot: e.serveRoot,
    status: e.status,
    requests: e.requests,
    startedAt: e.startedAt,
  };
}
