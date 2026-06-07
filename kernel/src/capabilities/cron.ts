import type { Capability } from "../types.ts";

// Scheduling: run a command (kind "shell") or wake the mind with a prompt
// (kind "wake") on a timer. State lives in ctx.scheduler.

export const cronCaps: Capability[] = [
  {
    name: "cron.schedule",
    summary: "Schedule a job: run a shell `cmd`, or queue a `prompt` to wake the mind, on a timer.",
    risk: "exec",
    params: {
      type: "object",
      properties: {
        name: { type: "string", description: "Unique job name" },
        cmd: { type: "string", description: "Shell command to run (kind=shell)" },
        prompt: { type: "string", description: "Task to wake the mind with (kind=wake)" },
        every_seconds: { type: "integer", description: "Recurring interval in seconds" },
        in_seconds: { type: "integer", description: "One-shot delay in seconds" },
        count: { type: "integer", description: "Max runs for a recurring job (default unlimited)" },
      },
      required: ["name"],
    },
    handler: async (args, ctx) => {
      const hasCmd = typeof args.cmd === "string";
      const hasPrompt = typeof args.prompt === "string";
      if (hasCmd === hasPrompt) throw new Error("provide exactly one of: cmd (shell) or prompt (wake)");

      const every = typeof args.every_seconds === "number" ? args.every_seconds : null;
      const once = typeof args.in_seconds === "number" ? args.in_seconds : null;
      if (every == null && once == null) throw new Error("provide every_seconds or in_seconds");

      let everyMs: number | null = null;
      let firstDelayMs: number;
      let maxRuns: number | null = null;
      if (every != null) {
        everyMs = every * 1000;
        firstDelayMs = everyMs;
        maxRuns = typeof args.count === "number" ? args.count : null;
      } else {
        firstDelayMs = (once as number) * 1000;
        maxRuns = 1;
      }

      return ctx.scheduler.schedule({
        name: String(args.name),
        cmd: hasCmd ? String(args.cmd) : undefined,
        prompt: hasPrompt ? String(args.prompt) : undefined,
        everyMs,
        firstDelayMs,
        maxRuns,
      });
    },
  },
  {
    name: "cron.list",
    summary: "List scheduled jobs with their state and next run time.",
    risk: "read",
    params: { type: "object", properties: {} },
    handler: async (_args, ctx) => ({ jobs: ctx.scheduler.list() }),
  },
  {
    name: "cron.status",
    summary: "Get one job's state, including its last run result.",
    risk: "read",
    params: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
    handler: async (args, ctx) => ctx.scheduler.get(String(args.name)),
  },
  {
    name: "cron.cancel",
    summary: "Cancel and delete a scheduled job.",
    risk: "write",
    params: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
    handler: async (args, ctx) => {
      ctx.scheduler.cancel(String(args.name));
      return { cancelled: args.name };
    },
  },
  {
    name: "cron.wakeups",
    summary: "Drain pending wake events (prompts the mind should act on now). Returns and clears them.",
    risk: "write",
    params: { type: "object", properties: {} },
    handler: async (_args, ctx) => ({ wakeups: ctx.scheduler.drainWakeups() }),
  },
];
