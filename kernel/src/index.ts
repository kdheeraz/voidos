import { mkdirSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join, resolve } from "node:path";
import type { CapabilityContext, Mode } from "./types.ts";
import { Registry } from "./registry.ts";
import { Bus } from "./bus.ts";
import { Policy, GrantStore, makeAuditor } from "./policy.ts";
import { ProcessManager } from "./procman.ts";
import { ServiceSupervisor } from "./services.ts";
import { Scheduler } from "./scheduler.ts";
import { NetManager } from "./net.ts";
import { WindowManager } from "./desktop/wm.ts";
import { serve } from "./transport/socket.ts";
import { fsCaps } from "./capabilities/fs.ts";
import { shellCaps } from "./capabilities/shell.ts";
import { webCaps } from "./capabilities/web.ts";
import { memoryCaps } from "./capabilities/memory.ts";
import { procCaps } from "./capabilities/proc.ts";
import { svcCaps } from "./capabilities/svc.ts";
import { cronCaps } from "./capabilities/cron.ts";
import { netCaps } from "./capabilities/net.ts";
import { desktopCaps } from "./capabilities/desktop.ts";
import { sysCaps, VOID_VERSION } from "./capabilities/sys.ts";

// Repo root is two levels up from kernel/src.
const repoRoot = resolve(import.meta.dirname, "..", "..");
const ROOT = process.env.VOID_ROOT ?? join(repoRoot, "vfs");
const CONTROL = join(ROOT, ".void");
const SOCK = process.env.VOID_SOCK ?? join(CONTROL, "void.sock");

const VALID_MODES: Mode[] = ["permissive", "guarded", "paranoid"];
const requested = (process.env.VOID_POLICY ?? "guarded") as Mode;
const MODE: Mode = VALID_MODES.includes(requested) ? requested : "guarded";

mkdirSync(CONTROL, { recursive: true });

function log(msg: string): void {
  const ts = new Date().toISOString().slice(11, 23);
  process.stdout.write(`[${ts}] void: ${msg}\n`);
}

// Mint a fresh operator token each boot; only the operator (with filesystem
// access to the protected control plane) can read it. The agent cannot.
const operatorToken = randomBytes(24).toString("hex");
writeFileSync(join(CONTROL, "operator.token"), operatorToken, { mode: 0o600 });

const policy = new Policy(MODE);
const grants = new GrantStore();
const audit = makeAuditor(join(CONTROL, "audit.log"), log);
const procs = new ProcessManager(ROOT, log);
const services = new ServiceSupervisor(ROOT, log);
const scheduler = new Scheduler(ROOT, log);
const net = new NetManager(ROOT, log);
const desktop = new WindowManager();

const registry = new Registry();
const ctx: CapabilityContext = {
  root: ROOT,
  log,
  caps: () => registry.list(),
  policy,
  grants,
  audit,
  operatorToken,
  procs,
  services,
  scheduler,
  net,
  desktop,
};

registry.registerAll(sysCaps);
registry.registerAll(fsCaps);
registry.registerAll(shellCaps);
registry.registerAll(webCaps);
registry.registerAll(memoryCaps);
registry.registerAll(procCaps);
registry.registerAll(svcCaps);
registry.registerAll(cronCaps);
registry.registerAll(netCaps);
registry.registerAll(desktopCaps);

const bus = new Bus(registry, ctx);

log(`voidOS kernel v${VOID_VERSION} booting`);
log(`rootfs: ${ROOT}`);
log(`policy: ${MODE}  (read=allow; write/exec ${MODE === "guarded" ? "need a grant" : MODE === "paranoid" ? "denied" : "allowed"})`);
log(`operator token: ${CONTROL}/operator.token (mode 600)`);
log(`capabilities online: ${registry.list().length}`);
for (const c of registry.list()) log(`  · [${c.risk}] ${c.name} — ${c.summary}`);

const server = serve(SOCK, bus, log);

function shutdown(): void {
  log("shutting down");
  net.shutdown();
  scheduler.shutdown();
  services.shutdown();
  procs.shutdown();
  server.close();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
