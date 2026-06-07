import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import type { Capability } from "../types.ts";

// Persistent key/value store: voidOS's long-term memory for the agent.
// Backed by a single JSON file under <root>/.void/memory.json.

function storePath(root: string): string {
  return join(root, ".void", "memory.json");
}

async function load(root: string): Promise<Record<string, unknown>> {
  try {
    return JSON.parse(await readFile(storePath(root), "utf8"));
  } catch {
    return {};
  }
}

async function save(root: string, data: Record<string, unknown>): Promise<void> {
  const p = storePath(root);
  await mkdir(dirname(p), { recursive: true });
  await writeFile(p, JSON.stringify(data, null, 2), "utf8");
}

export const memoryCaps: Capability[] = [
  {
    name: "memory.set",
    summary: "Persist a value under a key in long-term memory.",
    risk: "write",
    params: {
      type: "object",
      properties: { key: { type: "string" }, value: {} },
      required: ["key", "value"],
    },
    handler: async (args, ctx) => {
      const data = await load(ctx.root);
      data[String(args.key)] = args.value;
      await save(ctx.root, data);
      return { key: args.key, stored: true };
    },
  },
  {
    name: "memory.get",
    summary: "Read a value from long-term memory.",
    risk: "read",
    params: {
      type: "object",
      properties: { key: { type: "string" } },
      required: ["key"],
    },
    handler: async (args, ctx) => {
      const data = await load(ctx.root);
      const key = String(args.key);
      return { key, value: data[key] ?? null, found: key in data };
    },
  },
  {
    name: "memory.list",
    summary: "List all keys currently in long-term memory.",
    risk: "read",
    params: { type: "object", properties: {} },
    handler: async (_args, ctx) => {
      const data = await load(ctx.root);
      return { keys: Object.keys(data) };
    },
  },
  {
    name: "memory.delete",
    summary: "Delete a key from long-term memory.",
    risk: "write",
    params: {
      type: "object",
      properties: { key: { type: "string" } },
      required: ["key"],
    },
    handler: async (args, ctx) => {
      const data = await load(ctx.root);
      const key = String(args.key);
      const existed = key in data;
      delete data[key];
      await save(ctx.root, data);
      return { key, deleted: existed };
    },
  },
];
