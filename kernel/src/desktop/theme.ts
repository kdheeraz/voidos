import type { RGB } from "./compositor.ts";

export const C = {
  bgTop: [9, 12, 16] as RGB,
  bgBot: [13, 24, 33] as RGB,
  panel: [17, 22, 28] as RGB,
  winBody: [13, 17, 23] as RGB,
  winHead: [20, 26, 33] as RGB,
  line: [31, 38, 48] as RGB,
  fg: [201, 209, 217] as RGB,
  dim: [107, 117, 133] as RGB,
  white: [230, 237, 243] as RGB,
  cyan: [23, 147, 209] as RGB,
  green: [33, 208, 122] as RGB,
  amber: [210, 153, 34] as RGB,
  red: [248, 81, 73] as RGB,
};

export const PANEL_H = 28;
export const TITLE_H = 22;

export interface AppDef {
  id: string;
  label: string;
  title: string;
  accent: RGB;
  w: number;
  h: number;
}

export const APPS: AppDef[] = [
  { id: "files", label: "FS", title: "FILES", accent: C.cyan, w: 460, h: 300 },
  { id: "system", label: "SYS", title: "SYSTEM", accent: C.cyan, w: 430, h: 250 },
  { id: "services", label: "SVC", title: "SERVICES", accent: C.green, w: 430, h: 250 },
  { id: "procs", label: "PROC", title: "PROCESSES", accent: C.amber, w: 540, h: 250 },
  { id: "net", label: "NET", title: "SERVERS", accent: C.green, w: 470, h: 210 },
  { id: "cron", label: "CRON", title: "CRON", accent: C.cyan, w: 470, h: 210 },
  { id: "audit", label: "LOG", title: "AUDIT", accent: C.cyan, w: 540, h: 300 },
];

export const DOCK = { tile: 50, gap: 12, pad: 14, bottom: 18 };

export interface DockRect { app: string; label: string; accent: RGB; x: number; y: number; w: number; h: number; }

export function dockLayout(W: number, H: number): { x: number; y: number; w: number; h: number; rects: DockRect[] } {
  const { tile, gap, pad, bottom } = DOCK;
  const dockW = APPS.length * tile + (APPS.length - 1) * gap + pad * 2;
  const x = Math.round((W - dockW) / 2);
  const y = H - tile - pad * 2 - bottom;
  const rects = APPS.map((a, i) => ({
    app: a.id,
    label: a.label,
    accent: a.accent,
    x: x + pad + i * (tile + gap),
    y: y + pad,
    w: tile,
    h: tile,
  }));
  return { x, y, w: dockW, h: tile + pad * 2, rects };
}
