# Why voidOS — the problem it solves

> **Today, AI is a guest on the machine. voidOS makes it the host.**

Every current "AI assistant" — Copilot, ChatGPT, even agentic coding tools — runs
as an *app on top of* an operating system built for humans. The human is still the
operator: you log into a shell, you open windows, you click, and the AI reaches the
machine only through whatever narrow hole that app exposes. The OS underneath
assumes a person is driving.

voidOS inverts that. PID 1 hands the machine to the **mind**, not a login shell. The
AI *is* the primary interface to the computer. That reframes a handful of concrete
problems:

## 1. AI can't actually touch the system
Assistants are sandboxed into chat boxes. voidOS gives the agent the machine itself
through a real capability bus (`fs.*`, `proc.*`, `svc.*`, `net.*`, `cron.*`, a whole
desktop). The agent *runs* services, supervises processes, schedules itself, and
serves pages — it operates the box, not just talks about it.

## 2. How do you safely let an AI run a computer (the serious part)
If the AI is the operator, you can't hand it raw root. voidOS's answer is the
**syscall gate**: a narrow, schema-described boundary where every action is a
risk-classed capability, policy-enforced (`guarded` / `paranoid`),
operator-token-gated for anything `write`/`exec`, and **audited on every call**.
This is the part of voidOS with the most real engineering behind it — capability-based
security for an autonomous agent. See [security.md](security.md).

## 3. AI-native vs. bolted-on
Because capabilities are self-describing (`sys.list` returns names + JSON schemas),
the agent discovers what it's allowed to do *at runtime*, with nothing hardcoded.
Add a capability and the mind can use it without a code change. That's the line
between "AI-native" and "an OS with a chatbot stapled on."

## 4. A machine that runs itself
`voidinit` polls `cron.wakeups` and wakes the mind on a schedule — so a booted
voidOS acts without a human present (verified: it scheduled and then wrote a file
with no operator). The aim is a computer that maintains and operates itself.

## Where it's real vs. aspirational
The syscall layer, security spine, process supervision, scheduling, and self-wake
autonomy are built and verified live (44 capabilities online). The
"boots on bare metal as PID 1" end state is still mostly the Docker / laptop-kit
path — Linux owns the hardware and voidOS is the shell on top, not yet a true kernel
replacement. See [bootable-path.md](bootable-path.md).

## One sentence
voidOS is a bet that the OS interface should be an AI agent operating the machine on
your behalf — and the hard problem it's genuinely tackling is **how to give an
autonomous agent real control of a computer without giving it unrestricted,
unaudited power.**

## Demos
Short screen recordings of voidOS running (in [`media/`](media/)):

| Video | What it shows |
|-------|---------------|
| [`voidos-demo.mp4`](media/voidos-demo.mp4) | The voidOS workspace / mind end to end |
| [`voidos-app-demo.mp4`](media/voidos-app-demo.mp4) | The `/os` client-rendered desktop and apps |
| [`voidos-orb-demo.mp4`](media/voidos-orb-demo.mp4) | The orb surface driving the mind |
| [`voidos-orb-wikipedia.mp4`](media/voidos-orb-wikipedia.mp4) | The orb fetching/answering from Wikipedia |
| [`voidos-wiki-routine.mp4`](media/voidos-wiki-routine.mp4) | A scheduled wake routine running autonomously |
