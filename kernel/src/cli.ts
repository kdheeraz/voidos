import net from "node:net";
import { join, resolve } from "node:path";

// Tiny syscall client for manual testing:
//   node kernel/src/cli.ts sys.list
//   node kernel/src/cli.ts fs.write path=/hello.txt content="hi there"
//   node kernel/src/cli.ts fs.read path=/hello.txt
// Values are parsed as JSON when possible, otherwise kept as strings.

const repoRoot = resolve(import.meta.dirname, "..", "..");
const SOCK = process.env.VOID_SOCK ?? join(repoRoot, "vfs", ".void", "void.sock");

const [, , method, ...rest] = process.argv;
if (!method) {
  console.error("usage: node kernel/src/cli.ts <capability> [key=value ...]");
  process.exit(2);
}

const params: Record<string, unknown> = {};
for (const arg of rest) {
  const eq = arg.indexOf("=");
  if (eq < 0) continue;
  const key = arg.slice(0, eq);
  const raw = arg.slice(eq + 1);
  try {
    params[key] = JSON.parse(raw);
  } catch {
    params[key] = raw;
  }
}

const socket = net.createConnection(SOCK, () => {
  socket.write(JSON.stringify({ id: 1, method, params }) + "\n");
});

let buf = "";
socket.on("data", (chunk) => {
  buf += chunk.toString("utf8");
  const nl = buf.indexOf("\n");
  if (nl < 0) return;
  const resp = JSON.parse(buf.slice(0, nl));
  console.log(JSON.stringify(resp, null, 2));
  socket.end();
  process.exit(resp.ok ? 0 : 1);
});
socket.on("error", (e) => {
  console.error(`cannot reach syscall gate at ${SOCK}: ${e.message}`);
  console.error("is the kernel booted?  ->  npm run boot");
  process.exit(1);
});
