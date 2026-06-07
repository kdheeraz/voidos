import { resolve, sep } from "node:path";

/**
 * Resolve a voidOS path (always absolute-from-rootfs, e.g. "/notes/todo.txt")
 * to a real host path under `root`, refusing any traversal outside the sandbox
 * and any access to the `.void` control plane (operator token, audit log, socket).
 */
export function resolveIn(root: string, p: string): string {
  const cleaned = String(p).replace(/^[/\\]+/, "");
  const full = resolve(root, cleaned);
  if (full !== root && !full.startsWith(root + sep)) {
    throw new Error(`path escapes rootfs: ${p}`);
  }
  const control = resolve(root, ".void");
  if (full === control || full.startsWith(control + sep)) {
    throw new Error(`path is in the protected control plane (.void): ${p}`);
  }
  return full;
}
