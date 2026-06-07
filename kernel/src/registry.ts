import type { Capability } from "./types.ts";

/** The capability table: voidOS's syscall registry. */
export class Registry {
  private caps = new Map<string, Capability>();

  register(cap: Capability): void {
    if (this.caps.has(cap.name)) {
      throw new Error(`capability already registered: ${cap.name}`);
    }
    this.caps.set(cap.name, cap);
  }

  registerAll(caps: Capability[]): void {
    for (const c of caps) this.register(c);
  }

  get(name: string): Capability | undefined {
    return this.caps.get(name);
  }

  list(): Capability[] {
    return [...this.caps.values()].sort((a, b) => a.name.localeCompare(b.name));
  }
}
