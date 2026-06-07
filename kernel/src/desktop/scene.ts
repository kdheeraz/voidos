import { Framebuffer, type RGB } from "./compositor.ts";
import { C, PANEL_H, TITLE_H, dockLayout, APPS } from "./theme.ts";
import type { VWindow, WindowManager } from "./wm.ts";

export interface Snapshot {
  version: string;
  policy: string;
  capCount: number;
  uptimeMs: number;
  host: string;
  memoryKeys: number;
  services: { name: string; status: string }[];
  processes: { id: string; status: string; cmd: string }[];
  servers: { name: string; port: number; status: string; requests: number }[];
  cron: { name: string; kind: string; schedule: string }[];
  audit: { decision: string; risk: string; capability: string }[];
  files: { name: string; kind: string }[];
}

interface Line { t: string; c?: RGB }

function statusColor(s: string): RGB {
  if (s === "running" || s === "listening" || s === "allowed") return C.green;
  if (s === "restarting") return C.amber;
  if (s === "failed" || s === "denied") return C.red;
  return C.dim;
}

function clock(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

function uptime(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return s + "S";
  if (s < 3600) return Math.floor(s / 60) + "M " + (s % 60) + "S";
  return Math.floor(s / 3600) + "H " + Math.floor((s % 3600) / 60) + "M";
}

function appLines(app: string, s: Snapshot): Line[] {
  switch (app) {
    case "files":
      return s.files.length
        ? s.files.map((f) => ({ t: `${f.kind === "dir" ? "[D] " : "    "}${f.name}`, c: f.kind === "dir" ? C.cyan : C.fg }))
        : [{ t: "EMPTY", c: C.dim }];
    case "system":
      return [
        { t: `VOIDOS ${s.version}`, c: C.white },
        { t: `HOST ${s.host}`, c: C.dim },
        { t: `POLICY ${s.policy.toUpperCase()}`, c: C.fg },
        { t: `CAPABILITIES ${s.capCount}`, c: C.fg },
        { t: `UPTIME ${uptime(s.uptimeMs)}`, c: C.fg },
        { t: `MEMORY KEYS ${s.memoryKeys}`, c: C.fg },
      ];
    case "services":
      return s.services.length
        ? s.services.map((x) => ({ t: `${x.name}  ${x.status.toUpperCase()}`, c: statusColor(x.status) }))
        : [{ t: "NO SERVICES", c: C.dim }];
    case "procs":
      return s.processes.length
        ? s.processes.map((p) => ({ t: `${p.id} ${p.status.toUpperCase()}  ${p.cmd}`, c: statusColor(p.status) }))
        : [{ t: "NO PROCESSES", c: C.dim }];
    case "net":
      return s.servers.length
        ? s.servers.map((x) => ({ t: `${x.name} :${x.port} ${x.status.toUpperCase()} R${x.requests}`, c: statusColor(x.status) }))
        : [{ t: "NO SERVERS", c: C.dim }];
    case "cron":
      return s.cron.length
        ? s.cron.map((j) => ({ t: `${j.name} ${j.kind.toUpperCase()} ${j.schedule.toUpperCase()}`, c: C.fg }))
        : [{ t: "NO JOBS", c: C.dim }];
    case "audit":
      return s.audit.length
        ? s.audit.slice(-12).reverse().map((a) => ({
            t: `${a.decision === "denied" ? "NO" : "OK"} ${a.risk.toUpperCase()} ${a.capability}`,
            c: a.decision === "denied" ? C.red : C.dim,
          }))
        : [{ t: "NO SYSCALLS YET", c: C.dim }];
    default:
      return [];
  }
}

function drawWindow(fb: Framebuffer, win: VWindow, lines: Line[], focused: boolean): void {
  const { x, y, w, h } = win;
  fb.fillRect(x + 5, y + 7, w, h, [0, 0, 0], focused ? 0.4 : 0.25); // shadow
  fb.roundRect(x, y, w, h, 9, C.winBody, 1);
  fb.strokeRect(x, y, w, h, focused ? win.accent : C.line, focused ? 1 : 0.8);
  fb.fillRect(x + 1, y + 1, w - 2, TITLE_H, C.winHead, 1);
  fb.fillRect(x + 1, y + TITLE_H, w - 2, 2, win.accent, focused ? 1 : 0.5);
  fb.circle(x + 14, y + 11, 4, C.red, 1);
  fb.circle(x + 28, y + 11, 4, C.amber, 1);
  fb.circle(x + 42, y + 11, 4, C.green, 1);
  fb.text(win.title, x + 58, y + 7, 2, focused ? C.white : C.dim, 1);

  const maxChars = Math.floor((w - 24) / 8);
  let ly = y + TITLE_H + 10;
  for (const ln of lines) {
    fb.text(ln.t.length > maxChars ? ln.t.slice(0, maxChars) : ln.t, x + 12, ly, 2, ln.c ?? C.fg, 1);
    ly += 15;
    if (ly > y + h - 12) break;
  }
}

export function composeDesktop(fb: Framebuffer, wm: WindowManager, s: Snapshot): void {
  const W = fb.w, H = fb.h;
  fb.vGradient(0, 0, W, H, C.bgTop, C.bgBot);
  const wm0 = "VOIDOS";
  fb.text(wm0, (W - Framebuffer.textWidth(wm0, 16)) / 2, H / 2 - 40, 16, C.cyan, 0.05);

  // top panel
  fb.fillRect(0, 0, W, PANEL_H, C.panel, 1);
  fb.fillRect(0, PANEL_H - 1, W, 1, C.line, 1);
  fb.text("VOIDOS", 14, 8, 3, C.cyan, 1);
  const right = `POLICY ${s.policy.toUpperCase()}   CAPS ${s.capCount}   UP ${uptime(s.uptimeMs)}   ${clock()}`;
  fb.text(right, W - Framebuffer.textWidth(right, 2) - 14, 9, 2, C.dim, 1);

  // windows (back to front), focused highlighted
  const focused = wm.focusedId();
  for (const win of wm.ordered()) drawWindow(fb, win, appLines(win.app, s), win.id === focused);

  // dock — running apps (with an open window) get a lit indicator
  const dock = dockLayout(W, H);
  fb.roundRect(dock.x, dock.y, dock.w, dock.h, 14, C.panel, 0.9);
  fb.strokeRect(dock.x, dock.y, dock.w, dock.h, C.line, 1);
  const openApps = new Set(wm.windows.map((w) => w.app));
  for (const r of dock.rects) {
    fb.roundRect(r.x, r.y, r.w, r.h, 10, C.winHead, 1);
    fb.strokeRect(r.x, r.y, r.w, r.h, r.accent, openApps.has(r.app) ? 1 : 0.4);
    const lw = Framebuffer.textWidth(r.label, 2);
    fb.text(r.label, r.x + (r.w - lw) / 2, r.y + r.h / 2 - 5, 2, r.accent, 1);
    if (openApps.has(r.app)) fb.circle(r.x + r.w / 2, r.y + r.h - 4, 2, r.accent, 1); // running dot
  }
}
