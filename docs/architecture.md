# voidOS architecture

## The boundary: one gate, two worlds

Everything in voidOS is organized around a single seam — the **syscall gate**.
The mind never touches the filesystem, the network, or processes directly; it
asks the kernel to, through a capability. This keeps the AI side portable and
auditable, and means the substrate underneath the gate can change (host →
container → bootable image) without the mind noticing.

## The capability model

A capability is a "syscall":

```ts
interface Capability {
  name: string;        // "fs.read" — the syscall identity
  summary: string;     // human/agent-readable one-liner
  params: JsonSchema;  // self-describing argument schema
  handler: (args, ctx) => Promise<unknown>;
}
```

Three properties make it AI-native:

1. **Self-describing.** `sys.list` returns every capability with its schema, so
   the agent learns its own ABI at runtime. No tool list is hardcoded into a
   prompt; the OS *tells* the mind what it can do.
2. **Validated.** The bus checks required fields and shallow types before a
   handler runs, returning `EINVAL` on bad calls — the mind gets structured
   feedback it can react to.
3. **Sandboxed.** `ctx.root` is the rootfs boundary; `fs.*` and `shell.*` cannot
   escape it. Traversal attempts return `EFAULT`.

## Components

| path | role |
|------|------|
| `kernel/src/types.ts` | the ABI: `Capability`, `JsonSchema`, RPC envelope |
| `kernel/src/registry.ts` | the syscall table |
| `kernel/src/bus.ts` | validation + dispatch |
| `kernel/src/transport/socket.ts` | the gate (NDJSON over Unix socket) |
| `kernel/src/capabilities/*` | the syscalls themselves |
| `kernel/src/cli.ts` | manual syscall client |
| `mind/void_mind/client.py` | the Python side's handle to the gate |

## Wire protocol

Newline-delimited JSON over a Unix-domain socket. One request line in, one
response line out.

```
→ {"id":1,"method":"fs.read","params":{"path":"/notes.txt"}}
← {"id":1,"ok":true,"result":{"path":"/notes.txt","content":"..."}}
← {"id":1,"ok":false,"error":{"code":"EFAULT","message":"..."}}
```

The envelope is intentionally simpler than full JSON-RPC 2.0 — it is an OS ABI,
not a public API, and `ok` + `code` map cleanly onto errno-style handling.

## Design choices worth knowing

- **No build step.** The kernel runs on Node's native TypeScript type-stripping
  (Node ≥ 23.6), so code stays in `erasableSyntaxOnly` TS — no enums, no
  parameter properties, no namespaces.
- **Hybrid by seam, not by sprawl.** TS owns the system surface; Python owns the
  intelligence. They only ever meet at the gate, so neither language leaks into
  the other.
- **Errors are first-class.** Every failure is a structured envelope the mind can
  branch on, never an exception that crosses the gate.
