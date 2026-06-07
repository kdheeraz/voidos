import type { Capability } from "../types.ts";

const MAX_BODY = 256 * 1024;

export const webCaps: Capability[] = [
  {
    name: "web.fetch",
    summary: "Fetch a URL over HTTP(S) and return status, headers, and body.",
    risk: "write",
    params: {
      type: "object",
      properties: {
        url: { type: "string" },
        method: { type: "string", enum: ["GET", "POST", "PUT", "DELETE", "HEAD"], default: "GET" },
        headers: { type: "object" },
        body: { type: "string" },
      },
      required: ["url"],
    },
    handler: async (args) => {
      const method = (args.method as string) ?? "GET";
      const res = await fetch(String(args.url), {
        method,
        headers: (args.headers as Record<string, string>) ?? undefined,
        body: args.body as string | undefined,
      });
      const text = await res.text();
      const truncated = text.length > MAX_BODY;
      return {
        status: res.status,
        ok: res.ok,
        headers: Object.fromEntries(res.headers.entries()),
        body: truncated ? text.slice(0, MAX_BODY) : text,
        truncated,
      };
    },
  },
];
