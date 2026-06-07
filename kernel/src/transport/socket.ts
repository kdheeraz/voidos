import net from "node:net";
import { unlinkSync } from "node:fs";
import type { Bus } from "../bus.ts";

/**
 * The syscall gate: a newline-delimited JSON-RPC server over a Unix domain
 * socket. One line in = one request; one line out = one response.
 */
export function serve(sockPath: string, bus: Bus, log: (m: string) => void): net.Server {
  try {
    unlinkSync(sockPath);
  } catch {
    // no stale socket to remove
  }

  const server = net.createServer((socket) => {
    let buf = "";
    socket.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (line.trim()) void handle(line, socket, bus);
      }
    });
    socket.on("error", (e) => log(`client error: ${e.message}`));
  });

  server.listen(sockPath, () => log(`syscall gate listening at ${sockPath}`));
  return server;
}

async function handle(line: string, socket: net.Socket, bus: Bus): Promise<void> {
  let id: string | number | null = null;
  try {
    const req = JSON.parse(line) as { id?: string | number | null; method?: string; params?: Record<string, unknown> };
    id = req.id ?? null;
    if (!req.method) {
      reply(socket, { id, ok: false, error: { code: "EINVAL", message: "missing method" } });
      return;
    }
    const res = await bus.dispatch(req.method, req.params ?? {});
    reply(socket, { id, ...res });
  } catch (e) {
    reply(socket, {
      id,
      ok: false,
      error: { code: "EPARSE", message: e instanceof Error ? e.message : String(e) },
    });
  }
}

function reply(socket: net.Socket, obj: unknown): void {
  socket.write(JSON.stringify(obj) + "\n");
}
