import { writeFile, readFile, readdir } from "node:fs/promises";
import { platform, release } from "node:os";
import { join } from "node:path";
import type { Capability, CapabilityContext } from "../types.ts";
import { resolveIn } from "./vpath.ts";
import { Framebuffer } from "../desktop/compositor.ts";
import { composeDesktop, type Snapshot } from "../desktop/scene.ts";

// The desktop: a software-composited GUI shell driven by the in-kernel window
// manager (ctx.desktop). desktop.frame renders the current state; desktop.input
// drives the WM (launch/focus/drag/close); desktop.render writes a PNG file.
// See docs/desktop.md.

async function buildSnapshot(ctx: CapabilityContext): Promise<Snapshot> {
  let audit: Snapshot["audit"] = [];
  try {
    const raw = await readFile(join(ctx.root, ".void", "audit.log"), "utf8");
    audit = raw.split("\n").filter((l) => l.trim()).slice(-20).map((l) => JSON.parse(l));
  } catch {
    audit = [];
  }
  let memoryKeys = 0;
  try {
    memoryKeys = Object.keys(JSON.parse(await readFile(join(ctx.root, ".void", "memory.json"), "utf8"))).length;
  } catch {
    memoryKeys = 0;
  }
  let files: Snapshot["files"] = [];
  try {
    files = (await readdir(ctx.root, { withFileTypes: true }))
      .filter((e) => e.name !== ".void")
      .map((e) => ({ name: e.name, kind: e.isDirectory() ? "dir" : "file" }));
  } catch {
    files = [];
  }
  return {
    version: "0.0.1",
    policy: ctx.policy.mode,
    capCount: ctx.caps().length,
    uptimeMs: Math.round(process.uptime() * 1000),
    host: `${platform()} ${release()}`,
    memoryKeys,
    services: ctx.services.list().map((s) => ({ name: s.name, status: s.status })),
    processes: ctx.procs.list().map((p) => ({ id: p.id, status: p.status, cmd: p.cmd })),
    servers: ctx.net.list().map((s) => ({ name: s.name, port: s.port, status: s.status, requests: s.requests })),
    cron: ctx.scheduler.list().map((j) => ({ name: j.name, kind: j.kind, schedule: j.schedule })),
    audit: audit.map((a) => ({ decision: a.decision, risk: a.risk, capability: a.capability })),
    files,
  };
}

async function renderFrame(ctx: CapabilityContext): Promise<Buffer> {
  const fb = new Framebuffer(ctx.desktop.W, ctx.desktop.H);
  composeDesktop(fb, ctx.desktop, await buildSnapshot(ctx));
  return fb.toPNG();
}

export const desktopCaps: Capability[] = [
  {
    name: "desktop.frame",
    summary: "Render the current voidOS desktop and return it as a base64 PNG (for a live viewer).",
    risk: "read",
    params: { type: "object", properties: {} },
    handler: async (_args, ctx) => {
      const png = await renderFrame(ctx);
      return { width: ctx.desktop.W, height: ctx.desktop.H, png_b64: png.toString("base64") };
    },
  },
  {
    name: "desktop.input",
    summary: "Send a pointer event to the desktop (launch from dock, focus, drag, close windows).",
    risk: "write",
    params: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["pointerdown", "pointermove", "pointerup"] },
        x: { type: "integer" },
        y: { type: "integer" },
      },
      required: ["type", "x", "y"],
    },
    handler: async (args, ctx) => {
      ctx.desktop.pointer({ type: args.type as "pointerdown" | "pointermove" | "pointerup", x: args.x as number, y: args.y as number });
      return { ok: true, windows: ctx.desktop.windows.map((w) => ({ id: w.id, app: w.app, x: w.x, y: w.y })) };
    },
  },
  {
    name: "desktop.launch",
    summary: "Open a desktop app window by id (files, system, services, procs, net, cron, audit).",
    risk: "write",
    params: { type: "object", properties: { app: { type: "string" } }, required: ["app"] },
    handler: async (args, ctx) => ({ id: ctx.desktop.launch(String(args.app)) }),
  },
  {
    name: "desktop.render",
    summary: "Render the voidOS desktop from live state to a PNG file in the rootfs.",
    risk: "write",
    params: {
      type: "object",
      properties: { path: { type: "string", description: "Rootfs path (default /desktop.png)" } },
    },
    handler: async (args, ctx) => {
      const png = await renderFrame(ctx);
      const rel = typeof args.path === "string" ? String(args.path) : "/desktop.png";
      await writeFile(resolveIn(ctx.root, rel), png);
      return { path: rel, width: ctx.desktop.W, height: ctx.desktop.H, bytes: png.length };
    },
  },
];
