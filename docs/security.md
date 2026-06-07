# voidOS permissions & audit (the security spine)

An AI-native OS hands real machine control to an autonomous mind. The security
spine makes that safe: **the kernel enforces what the mind may do, an operator
authorizes exceptions, and every syscall is recorded.**

## Three pieces

### 1. Risk classes
Every capability declares a `risk`:

| risk | meaning | examples |
|------|---------|----------|
| `read` | side-effect-free | `fs.read/list/stat`, `memory.get/list`, all `sys.*` |
| `write` | mutates state or causes egress | `fs.write/remove`, `memory.set/delete`, `web.fetch` |
| `exec` | runs arbitrary code | `shell.exec` |

### 2. Policy modes (`VOID_POLICY`, default `guarded`)

| mode | `read` | `write` | `exec` |
|------|--------|---------|--------|
| `permissive` | allow | allow | allow |
| `guarded` *(default)* | allow | **needs a grant** | **needs a grant** |
| `paranoid` | allow | deny | deny |

In `guarded`, a `write`/`exec` call is refused with `EPERM` unless an operator
grant covers it. The bus enforces this on **every** dispatch — it is not
something a client can opt out of.

### 3. Grants + the operator token
A **grant** authorizes risky calls, keyed by capability name (`shell.exec`),
risk class (`write`), or `all`, for N uses (or unlimited). Grants are issued via
`sys.grant`, which requires the **operator token** — a secret minted fresh each
boot and written to `<root>/.void/operator.token` (mode `600`).

The token is what separates the *operator* from the *mind*:

- The operator (a human at `voidsh`, or an operator script) can read the token
  because they have host filesystem access.
- The mind **cannot**: `fs.*` is sealed off from the `.void` control plane, so
  `fs.read("/.void/operator.token")` returns `EFAULT`. The token is never in
  `sys.list`, never in a tool, never in the agent's context.

So the mind can *request* a risky action, but it cannot *authorize* its own
privilege. Only the operator can.

## How `voidsh` uses it
When the mind tries a `write`/`exec` syscall, the shell prompts you:

```
  [authorize exec] shell.exec(cmd='rm -rf /tmp/old')  allow? [y/N/a=always]
```

On `y`/`a`, the shell issues a one-shot `sys.grant` with the operator token and
the call proceeds; on `n`, the mind gets an `EPERM` result and adapts. This is a
UX convenience on top of the kernel guarantee — even a misbehaving client that
skips the prompt still hits the kernel's `EPERM` without a grant.

## Audit log
Every dispatch — allowed or denied — is appended as one JSON line to
`<root>/.void/audit.log`: timestamp, capability, risk, decision, reason,
ok/error, duration, and a secret-redacted argument summary. Read the tail with
the `sys.audit` capability. Because it lives in `.void`, the agent can record to
it (via the kernel) but cannot tamper with the file through `fs.*`.

## Why this is the spine for the bootable image
When voidOS eventually boots as PID 1, the same gate decides what the machine
will do on the mind's behalf. Locking the policy + token model down now means
that later — when the capabilities graduate from a sandbox to real system
control — the authorization story is already in place.
