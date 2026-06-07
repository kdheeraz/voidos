import { readFile, writeFile, mkdir, readdir, stat, rm } from "node:fs/promises";
import { dirname, posix } from "node:path";
import type { Capability } from "../types.ts";
import { resolveIn } from "./vpath.ts";

export const fsCaps: Capability[] = [
  {
    name: "fs.read",
    summary: "Read a UTF-8 text file from the voidOS rootfs.",
    risk: "read",
    params: {
      type: "object",
      properties: { path: { type: "string", description: "Absolute-from-root path, e.g. /notes.txt" } },
      required: ["path"],
    },
    handler: async (args, ctx) => {
      const full = resolveIn(ctx.root, args.path as string);
      return { path: args.path, content: await readFile(full, "utf8") };
    },
  },
  {
    name: "fs.write",
    summary: "Write a UTF-8 text file, creating parent directories as needed.",
    risk: "write",
    params: {
      type: "object",
      properties: {
        path: { type: "string" },
        content: { type: "string" },
      },
      required: ["path", "content"],
    },
    handler: async (args, ctx) => {
      const full = resolveIn(ctx.root, args.path as string);
      await mkdir(dirname(full), { recursive: true });
      await writeFile(full, String(args.content), "utf8");
      return { path: args.path, bytes: Buffer.byteLength(String(args.content)) };
    },
  },
  {
    name: "fs.list",
    summary: "List entries of a directory in the rootfs.",
    risk: "read",
    params: {
      type: "object",
      properties: { path: { type: "string", default: "/" } },
    },
    handler: async (args, ctx) => {
      const vpath = (args.path as string) ?? "/";
      const full = resolveIn(ctx.root, vpath);
      const entries = await readdir(full, { withFileTypes: true });
      return {
        path: vpath,
        entries: entries.map((e) => ({
          name: e.name,
          path: posix.join(vpath.startsWith("/") ? vpath : "/" + vpath, e.name),
          kind: e.isDirectory() ? "dir" : "file",
        })),
      };
    },
  },
  {
    name: "fs.stat",
    summary: "Get metadata for a path (size, kind, mtime).",
    risk: "read",
    params: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    },
    handler: async (args, ctx) => {
      const full = resolveIn(ctx.root, args.path as string);
      const s = await stat(full);
      return {
        path: args.path,
        kind: s.isDirectory() ? "dir" : "file",
        size: s.size,
        mtime: s.mtime.toISOString(),
      };
    },
  },
  {
    name: "fs.remove",
    summary: "Remove a file or directory (recursive) from the rootfs.",
    risk: "write",
    params: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    },
    handler: async (args, ctx) => {
      const full = resolveIn(ctx.root, args.path as string);
      await rm(full, { recursive: true, force: true });
      return { path: args.path, removed: true };
    },
  },
];
