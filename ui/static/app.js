"use strict";

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const esc = (s) => String(s);

function fmtUptime(ms) {
  const s = Math.floor((ms || 0) / 1000);
  if (s < 60) return s + "s";
  if (s < 3600) return Math.floor(s / 60) + "m " + (s % 60) + "s";
  return Math.floor(s / 3600) + "h " + Math.floor((s % 3600) / 60) + "m";
}

// ---- dashboard rendering -------------------------------------------------

function renderState(st) {
  const info = st.info || {};
  const host = info.host || {};

  $("bar-info").innerHTML =
    `policy <b>${esc(info.policy || "?")}</b> · <b>${info.capability_count ?? "?"}</b> caps · ` +
    `up <b>${fmtUptime(info.uptime_ms)}</b> · <b>${new Date().toLocaleTimeString()}</b>`;

  const rows = [
    ["version", "voidOS " + (info.void_version || "?")],
    ["host", `${host.platform || "?"} ${host.release || ""}`.trim()],
    ["pid 1?", "kernel pid " + (host.pid ?? "?")],
    ["uptime", fmtUptime(info.uptime_ms)],
    ["policy", info.policy || "?"],
    ["syscalls", String(info.capability_count ?? "?")],
    ["grants", JSON.stringify(info.active_grants || {})],
    ["memory keys", String((st.memory || []).length)],
  ];
  const f = $("finfo");
  f.innerHTML = "";
  for (const [k, v] of rows) {
    f.appendChild(el("span", "k", k));
    f.appendChild(el("span", "v", v));
  }

  // capabilities grouped by risk
  const caps = st.capabilities || [];
  $("n-caps").textContent = caps.length;
  const byRisk = { read: [], write: [], exec: [] };
  for (const c of caps) (byRisk[c.risk] || (byRisk[c.risk] = [])).push(c.name);
  const cb = $("b-caps");
  cb.innerHTML = "";
  for (const r of ["read", "write", "exec"]) {
    const line = el("div");
    line.appendChild(el("span", "rk rk-" + r, r));
    line.appendChild(el("span", "dim", " " + (byRisk[r] || []).join("  ")));
    cb.appendChild(line);
  }

  renderTable("b-proc", "n-proc", st.processes, ["id", "status", "pid", "cmd"], (p) => [
    p.id, statusSpan(p.status), p.pid, p.cmd,
  ]);
  renderTable("b-svc", "n-svc", st.services, ["name", "status", "restarts", "cmd"], (s) => [
    s.name, statusSpan(s.status), s.restarts, s.cmd,
  ]);
  renderTable("b-cron", "n-cron", st.cron, ["name", "kind", "schedule", "runs"], (j) => [
    j.name, j.kind, j.schedule, j.runs,
  ]);
  renderTable("b-net", "n-net", st.servers, ["name", "port", "status", "reqs"], (s) => [
    s.name, s.port, statusSpan(s.status === "listening" ? "running" : s.status), s.requests,
  ]);

  renderAudit(st.audit || []);
}

function statusSpan(s) {
  const span = el("span", "pill st-" + s, s);
  return span;
}

function renderTable(bodyId, badgeId, rows, cols, mapper) {
  rows = rows || [];
  if (badgeId) $(badgeId).textContent = rows.length;
  const body = $(bodyId);
  body.innerHTML = "";
  if (!rows.length) {
    body.appendChild(el("div", "empty", "none"));
    return;
  }
  const table = el("table");
  const thead = el("tr");
  for (const c of cols) thead.appendChild(el("th", null, c));
  table.appendChild(thead);
  for (const r of rows) {
    const tr = el("tr");
    for (const cell of mapper(r)) {
      const td = el("td");
      if (cell instanceof Node) td.appendChild(cell);
      else td.textContent = cell == null ? "" : String(cell);
      tr.appendChild(td);
    }
    table.appendChild(tr);
  }
  body.appendChild(table);
}

function renderAudit(entries) {
  const b = $("b-audit");
  b.innerHTML = "";
  if (!entries.length) {
    b.appendChild(el("div", "empty", "no syscalls yet"));
    return;
  }
  for (const e of entries.slice().reverse()) {
    const line = el("div", "audit-line");
    line.appendChild(el("span", "when", (e.ts || "").slice(11, 19)));
    line.appendChild(el("span", e.decision === "denied" ? "deny" : "ok", e.decision === "denied" ? "✗" : "✓"));
    line.appendChild(el("span", "rk rk-" + e.risk, e.risk));
    line.appendChild(el("span", null, e.capability));
    if (e.reason && e.reason !== "read") line.appendChild(el("span", "dim", e.reason));
    b.appendChild(line);
  }
}

// ---- polling -------------------------------------------------------------

async function poll() {
  try {
    const r = await fetch("/api/state");
    if (!r.ok) throw new Error((await r.json()).error || r.statusText);
    renderState(await r.json());
  } catch (e) {
    $("bar-info").innerHTML = `<span style="color:var(--red)">gate down — npm run boot</span>`;
  }
}

// ---- chat ----------------------------------------------------------------

const log = $("termlog");
function append(cls, text) {
  const d = el("div", cls, text);
  log.appendChild(d);
  log.scrollTop = log.scrollHeight;
  return d;
}

function appendSyscalls(calls) {
  if (!calls || !calls.length) return;
  const wrap = el("div", "sys");
  for (const c of calls) {
    const argstr = Object.entries(c.args || {})
      .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
      .join(", ");
    const line = el("div");
    line.appendChild(el("span", "rk-" + c.risk, "· "));
    line.appendChild(document.createTextNode(`${c.capability}(${argstr.length > 80 ? argstr.slice(0, 80) + "…" : argstr})`));
    wrap.appendChild(line);
  }
  log.appendChild(wrap);
  log.scrollTop = log.scrollHeight;
}

$("chatform").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const input = $("msg");
  const message = input.value.trim();
  if (!message) return;
  input.value = "";
  input.disabled = true;

  const turn = el("div", "turn");
  log.appendChild(turn);
  turn.appendChild(el("div", "you", message));
  const thinking = el("div", "thinking", "void> thinking…");
  turn.appendChild(thinking);
  log.scrollTop = log.scrollHeight;

  try {
    const r = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    });
    const data = await r.json();
    thinking.remove();
    appendSyscalls(data.syscalls);
    if (data.error) turn.appendChild(el("div", "err", "✗ " + data.error));
    else turn.appendChild(el("div", "void", data.reply || "(no reply)"));
  } catch (e) {
    thinking.remove();
    turn.appendChild(el("div", "err", "✗ " + e.message));
  } finally {
    input.disabled = false;
    input.focus();
    poll();
    log.scrollTop = log.scrollHeight;
  }
});

append("void", "voidOS console online. The dashboard is live; type below to drive the OS.");
poll();
setInterval(poll, 2000);
