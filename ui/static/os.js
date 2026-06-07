"use strict";

// ---------- gate ----------
async function sys(method, params = {}) {
  const r = await fetch("/api/syscall", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ method, params }),
  });
  const d = await r.json();
  if (d.error) throw new Error(d.error);
  return d.result;
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const elNew = (t, c, h) => { const e = document.createElement(t); if (c) e.className = c; if (h != null) e.innerHTML = h; return e; };
const joinPath = (b, n) => (b.endsWith("/") ? b + n : b + "/" + n);
const parentPath = (p) => { const q = p.replace(/\/+$/, ""); const i = q.lastIndexOf("/"); return i <= 0 ? "/" : q.slice(0, i); };

// ---------- vector icons (Lucide-style line icons, crisp at any size) ----------
const ICONS = {
  folder: `<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>`,
  file: `<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v5h5"/>`,
  terminal: `<polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>`,
  pencil: `<path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"/>`,
  cpu: `<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 2v2M15 2v2M9 20v2M15 20v2M2 9h2M2 15h2M20 9h2M20 15h2"/>`,
  shield: `<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/>`,
  activity: `<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>`,
  sparkles: `<path d="M12 3l1.9 5.8a2 2 0 0 0 1.3 1.3L21 12l-5.8 1.9a2 2 0 0 0-1.3 1.3L12 21l-1.9-5.8a2 2 0 0 0-1.3-1.3L3 12l5.8-1.9a2 2 0 0 0 1.3-1.3Z"/>`,
  power: `<path d="M12 2v10"/><path d="M18.36 6.64a9 9 0 1 1-12.73 0"/>`,
  monitor: `<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>`,
};
const icon = (name) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ""}</svg>`;
const APP_ICON = { files: "folder", terminal: "terminal", editor: "pencil", system: "cpu", services: "shield", processes: "activity", mind: "sparkles", screen: "monitor" };
const APP_ACCENT = { files: "var(--cyan)", terminal: "var(--green)", editor: "var(--amber)", system: "var(--cyan)", services: "var(--green)", processes: "var(--amber)", mind: "var(--violet)", screen: "var(--violet)" };

// ---------- window manager ----------
const desktop = document.getElementById("desktop");
const taskbar = document.getElementById("dock-windows");
let zTop = 10, cascade = 0;
const singletons = {};

function focusWin(win) {
  win.el.style.zIndex = ++zTop;
  document.querySelectorAll(".win.focused").forEach((w) => w.classList.remove("focused"));
  win.el.classList.add("focused");
  if (win.task) win.task.style.color = "var(--fg)";
}

function createWindow(opts) {
  const el = elNew("div", "win opening");
  el.style.width = opts.w + "px";
  el.style.height = opts.h + "px";
  const cx = 70 + (cascade % 7) * 34, cy = 56 + (cascade % 7) * 30; cascade++;
  el.style.left = (opts.x ?? cx) + "px";
  el.style.top = (opts.y ?? cy) + "px";
  el.innerHTML =
    `<div class="win-head"><div class="lights">
       <span class="light r" title="close"></span><span class="light y" title="minimize"></span><span class="light g" title="maximize"></span>
     </div><div class="win-title">${opts.icon ? `<span class="ico">${icon(opts.icon)}</span>` : ""}${esc(opts.title)}</div></div>
     <div class="win-body"></div><div class="win-resize"></div>`;
  desktop.appendChild(el);
  const win = { el, app: opts.app, key: opts.key, body: el.querySelector(".win-body"), titleEl: el.querySelector(".win-title"), timer: null };

  const head = el.querySelector(".win-head");
  head.addEventListener("pointerdown", (e) => {
    if (e.target.classList.contains("light")) return;
    focusWin(win);
    const sx = e.clientX, sy = e.clientY, ox = el.offsetLeft, oy = el.offsetTop;
    head.setPointerCapture(e.pointerId);
    const mv = (ev) => { el.style.left = Math.max(0, ox + ev.clientX - sx) + "px"; el.style.top = Math.max(30, oy + ev.clientY - sy) + "px"; };
    const up = () => { head.removeEventListener("pointermove", mv); head.removeEventListener("pointerup", up); };
    head.addEventListener("pointermove", mv); head.addEventListener("pointerup", up);
  });
  el.addEventListener("pointerdown", () => focusWin(win));

  const rz = el.querySelector(".win-resize");
  rz.addEventListener("pointerdown", (e) => {
    e.stopPropagation();
    const sx = e.clientX, sy = e.clientY, ow = el.offsetWidth, oh = el.offsetHeight;
    rz.setPointerCapture(e.pointerId);
    const mv = (ev) => { el.style.width = Math.max(260, ow + ev.clientX - sx) + "px"; el.style.height = Math.max(150, oh + ev.clientY - sy) + "px"; };
    const up = () => { rz.removeEventListener("pointermove", mv); rz.removeEventListener("pointerup", up); };
    rz.addEventListener("pointermove", mv); rz.addEventListener("pointerup", up);
  });

  el.querySelector(".light.r").addEventListener("click", () => closeWin(win));
  el.querySelector(".light.y").addEventListener("click", () => { el.style.display = "none"; });
  let max = null;
  el.querySelector(".light.g").addEventListener("click", () => {
    if (max) { Object.assign(el.style, max); max = null; }
    else { max = { left: el.style.left, top: el.style.top, width: el.style.width, height: el.style.height };
      Object.assign(el.style, { left: "8px", top: "38px", width: (desktop.clientWidth - 16) + "px", height: (desktop.clientHeight - 90) + "px" }); }
  });

  // taskbar entry
  const task = elNew("button", "dock-win", `${opts.icon ? icon(opts.icon) : ""}${esc(opts.title)}`);
  task.addEventListener("click", () => { el.style.display = ""; focusWin(win); });
  taskbar.appendChild(task);
  win.task = task;

  focusWin(win);
  setTimeout(() => el.classList.remove("opening"), 160);
  if (opts.key) singletons[opts.key] = win;
  if (opts.build) opts.build(win);
  return win;
}

function closeWin(win) {
  if (win.timer) clearInterval(win.timer);
  win.el.remove();
  if (win.task) win.task.remove();
  if (win.key && singletons[win.key] === win) delete singletons[win.key];
}

function openSingle(key, factory) {
  const w = singletons[key];
  if (w) { w.el.style.display = ""; focusWin(w); return w; }
  return factory();
}

// ---------- apps ----------
function openApp(app) {
  ({ files: openFiles, terminal: openTerminal, editor: () => openEditor("/"),
     system: openSystem, services: () => openListApp("services", "shield", "Services", "svc.list", "services", (x) => [x.name, x.status]),
     processes: () => openListApp("processes", "activity", "Processes", "proc.list", "processes", (x) => [x.id + " " + x.cmd, x.status]),
     mind: openMind, screen: openScreen }[app] || (() => {}))();
}

function statusClass(s) {
  if (s === "running" || s === "listening") return "run";
  if (s === "restarting") return "warn";
  if (s === "failed") return "bad";
  return "stop";
}

// File manager
function openFiles(startPath = "/") {
  const ex = singletons["files"];
  if (ex) { ex.el.style.display = ""; focusWin(ex); if (ex.navigate) ex.navigate(startPath); return ex; }
  return createWindow({
    app: "files", key: "files", title: "Files", icon: "folder", w: 560, h: 420,
    build: (win) => {
      win.body.innerHTML =
        `<div class="fm-bar">
           <button class="fm-btn" data-a="back">←</button>
           <button class="fm-btn" data-a="up">↑</button>
           <div class="fm-path"></div>
           <button class="fm-btn" data-a="newfile">+ File</button>
           <button class="fm-btn" data-a="newfolder">+ Folder</button>
           <button class="fm-btn" data-a="del">Delete</button>
           <button class="fm-btn" data-a="refresh">⟳</button>
         </div><div class="fm-grid"></div>`;
      let cwd = startPath, sel = null;
      const hist = [];
      const grid = win.body.querySelector(".fm-grid");
      const pathEl = win.body.querySelector(".fm-path");
      async function load() {
        pathEl.textContent = cwd;
        sel = null;
        grid.innerHTML = `<div class="fm-empty">loading…</div>`;
        try {
          const entries = await sys("fs.list", { path: cwd });
          const items = entries.entries.slice().sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "dir" ? -1 : 1));
          grid.innerHTML = items.length ? "" : `<div class="fm-empty">empty folder</div>`;
          for (const e of items) {
            const it = elNew("div", "fm-item", `<div class="ico">${e.kind === "dir" ? icon("folder") : icon("file")}</div><div class="nm">${esc(e.name)}</div>`);
            it.addEventListener("click", () => { grid.querySelectorAll(".fm-item.sel").forEach((x) => x.classList.remove("sel")); it.classList.add("sel"); sel = e; });
            it.querySelector(".ico").style.color = e.kind === "dir" ? "var(--cyan)" : "var(--mut)";
            it.addEventListener("dblclick", () => { if (e.kind === "dir") { hist.push(cwd); cwd = e.path; load(); } else openEditor(e.path); });
            grid.appendChild(it);
          }
        } catch (err) { grid.innerHTML = `<div class="fm-empty">${esc(err.message)}</div>`; }
      }
      win.body.querySelector(".fm-bar").addEventListener("click", async (ev) => {
        const a = ev.target.dataset.a; if (!a) return;
        if (a === "refresh") load();
        else if (a === "up") { hist.push(cwd); cwd = parentPath(cwd); load(); }
        else if (a === "back") { if (hist.length) { cwd = hist.pop(); load(); } }
        else if (a === "newfile") { const n = prompt("New file name:"); if (n) { await sys("fs.write", { path: joinPath(cwd, n), content: "" }); load(); } }
        else if (a === "newfolder") { const n = prompt("New folder name:"); if (n) { await sys("fs.write", { path: joinPath(joinPath(cwd, n), ".keep"), content: "" }); load(); } }
        else if (a === "del") { if (sel && confirm("Delete " + sel.name + "?")) { await sys("fs.remove", { path: sel.path }); load(); } }
      });
      win.navigate = (p) => { if (p !== cwd) hist.push(cwd); cwd = p; load(); };
      load();
    },
  });
}

// Text editor
function openEditor(path) {
  const key = "editor:" + path;
  openSingle(key, () => createWindow({
    app: "editor", key, title: path === "/" ? "Editor" : path.split("/").pop(), icon: "pencil", w: 520, h: 380,
    build: async (win) => {
      win.body.innerHTML = `<div class="editor"><textarea spellcheck="false"></textarea><div class="ebar"><button class="fm-btn" data-a="save">Save</button><span class="dim" data-s></span></div></div>`;
      const ta = win.body.querySelector("textarea");
      const status = win.body.querySelector("[data-s]");
      let p = path;
      if (path !== "/") { try { ta.value = (await sys("fs.read", { path })).content; } catch (e) { ta.value = ""; status.textContent = e.message; } }
      else { p = prompt("Open file (rootfs path):", "/notes.txt") || "/untitled.txt"; win.titleEl.innerHTML = `<span class="ico">${icon("pencil")}</span>${esc(p.split("/").pop())}`;
        try { ta.value = (await sys("fs.read", { path: p })).content; } catch { ta.value = ""; } }
      win.body.querySelector("[data-a=save]").addEventListener("click", async () => {
        try { const r = await sys("fs.write", { path: p, content: ta.value }); status.textContent = "saved · " + r.bytes + " bytes"; }
        catch (e) { status.textContent = "✗ " + e.message; }
      });
    },
  }));
}

// Terminal
function openTerminal() {
  openSingle("terminal", () => createWindow({
    app: "terminal", key: "terminal", title: "Terminal", icon: "terminal", w: 600, h: 360,
    build: (win) => {
      win.body.innerHTML = `<div class="term"><div class="term-out"><span class="muted">voidOS shell — commands run in the rootfs sandbox.\n</span></div><div class="term-in"><span class="ps">void:/$</span><input autofocus spellcheck="false"/></div></div>`;
      const out = win.body.querySelector(".term-out");
      const inp = win.body.querySelector("input");
      win.body.querySelector(".term-in").addEventListener("click", () => inp.focus());
      inp.addEventListener("keydown", async (e) => {
        if (e.key !== "Enter") return;
        const cmd = inp.value.trim(); if (!cmd) return; inp.value = "";
        out.appendChild(elNew("div", "cmd", "void:/$ " + esc(cmd)));
        if (cmd === "clear") { out.innerHTML = ""; return; }
        try {
          const r = await sys("shell.exec", { cmd });
          if (r.stdout) out.appendChild(elNew("div", null, esc(r.stdout)));
          if (r.stderr) out.appendChild(elNew("div", "err", esc(r.stderr)));
          if (r.code) out.appendChild(elNew("div", "muted", "[exit " + r.code + "]"));
        } catch (err) { out.appendChild(elNew("div", "err", esc(err.message))); }
        out.scrollTop = out.scrollHeight;
      });
    },
  }));
}

// System info
function openSystem() {
  openSingle("system", () => createWindow({
    app: "system", key: "system", title: "System", icon: "cpu", w: 420, h: 280,
    build: (win) => {
      const refresh = async () => {
        try {
          const i = await sys("sys.info");
          win.body.innerHTML = `<div class="pad"><div class="kv">
            <span class="k">voidOS</span><span class="v">${esc(i.void_version)}</span>
            <span class="k">host</span><span class="v">${esc(i.host.platform)} ${esc(i.host.release)}</span>
            <span class="k">policy</span><span class="v">${esc(i.policy)}</span>
            <span class="k">capabilities</span><span class="v">${i.capability_count}</span>
            <span class="k">uptime</span><span class="v">${Math.round(i.uptime_ms / 1000)}s</span>
            <span class="k">pid (kernel)</span><span class="v">${i.host.pid}</span>
            <span class="k">grants</span><span class="v">${esc(JSON.stringify(i.active_grants))}</span>
          </div></div>`;
        } catch (e) { win.body.innerHTML = `<div class="pad dim">${esc(e.message)}</div>`; }
      };
      refresh(); win.timer = setInterval(refresh, 3000);
    },
  }));
}

// Generic list app (services / processes)
function openListApp(key, icon, title, method, field, row) {
  openSingle(key, () => createWindow({
    app: key, key, title, icon, w: 480, h: 320,
    build: (win) => {
      const refresh = async () => {
        try {
          const data = (await sys(method))[field];
          win.body.innerHTML = `<div class="pad list">` + (data.length ? data.map((x) => {
            const [label, status] = row(x);
            return `<div class="row"><span>${esc(label)}</span><span class="badge ${statusClass(status)}">${esc(status)}</span></div>`;
          }).join("") : `<span class="dim">none</span>`) + `</div>`;
        } catch (e) { win.body.innerHTML = `<div class="pad dim">${esc(e.message)}</div>`; }
      };
      refresh(); win.timer = setInterval(refresh, 2000);
    },
  }));
}

// Mind chat
function openMind() {
  openSingle("mind", () => createWindow({
    app: "mind", key: "mind", title: "Mind", icon: "sparkles", w: 460, h: 440,
    build: (win) => {
      win.body.innerHTML = `<div class="chat"><div class="chat-log"></div><div class="chat-in"><input placeholder="tell the OS what to do…" autofocus/></div></div>`;
      const log = win.body.querySelector(".chat-log");
      const inp = win.body.querySelector("input");
      log.appendChild(elNew("div", "void", "voidOS mind ready. I can act on the machine for you."));
      inp.addEventListener("keydown", async (e) => {
        if (e.key !== "Enter") return;
        const msg = inp.value.trim(); if (!msg) return; inp.value = ""; inp.disabled = true;
        log.appendChild(elNew("div", "you", "you> " + esc(msg)));
        const think = elNew("div", "sys", "thinking…"); log.appendChild(think); log.scrollTop = log.scrollHeight;
        try {
          const r = await (await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: msg }) })).json();
          think.remove();
          if (r.syscalls && r.syscalls.length) log.appendChild(elNew("div", "sys", r.syscalls.map((c) => "· " + c.capability).join("  ")));
          log.appendChild(elNew("div", "void", r.error ? "✗ " + r.error : r.reply || "(no reply)"));
        } catch (err) { think.remove(); log.appendChild(elNew("div", "void", "✗ " + err.message)); }
        inp.disabled = false; inp.focus(); log.scrollTop = log.scrollHeight;
      });
    },
  }));
}

// Native apps (X11) stream in via noVNC. This window has a launcher so you can
// run apps from /os directly (requires the voidos:gui image). They appear in the
// streamed display below — they can't be separate /os windows (X11 limitation).
function openScreen() {
  openSingle("screen", () => createWindow({
    app: "screen", key: "screen", title: "Screen — native apps", icon: "monitor", w: 960, h: 660,
    build: (win) => {
      const url = `http://${location.hostname}:6080/vnc.html?autoconnect=true&resize=scale&reconnect=true`;
      win.body.innerHTML =
        `<div style="display:flex;flex-direction:column;height:100%">
           <div class="screen-bar">
             <span class="dim">run:</span>
             <input placeholder="an app to launch — e.g. vlc, xterm, gimp, xclock" spellcheck="false"/>
             <button class="fm-btn" data-run>Launch</button>
             <button class="fm-btn" data-q="vlc">VLC</button>
             <button class="fm-btn" data-q="xterm">Terminal</button>
             <button class="fm-btn" data-q="xclock">Clock</button>
             <span class="dim" data-status></span>
           </div>
           <iframe class="screen-frame" src="${url}" allow="fullscreen"></iframe>
         </div>`;
      const input = win.body.querySelector("input");
      const status = win.body.querySelector("[data-status]");
      const run = async (app) => {
        app = (app || "").trim();
        if (!app) return;
        status.textContent = "launching " + app + "…";
        try {
          await sys("shell.exec", { cmd: `gui-run ${app} >/tmp/voidgui/launch.log 2>&1 &` });
          status.textContent = app + " launched →";
        } catch (e) { status.textContent = "✗ " + e.message; }
      };
      win.body.querySelector("[data-run]").addEventListener("click", () => run(input.value));
      input.addEventListener("keydown", (e) => { if (e.key === "Enter") run(input.value); });
      win.body.querySelectorAll("[data-q]").forEach((b) => b.addEventListener("click", () => run(b.dataset.q)));
    },
  }));
}

// ---------- context menu ----------
function showMenu(x, y, items) {
  document.querySelectorAll(".ctxmenu").forEach((m) => m.remove());
  const m = elNew("div", "ctxmenu");
  for (const it of items) {
    if (it.sep) { m.appendChild(elNew("div", "sep")); continue; }
    const mi = elNew("div", "mi", esc(it.label));
    mi.addEventListener("click", () => { m.remove(); it.fn(); });
    m.appendChild(mi);
  }
  m.style.left = Math.min(x, innerWidth - 180) + "px";
  m.style.top = y + "px";
  document.body.appendChild(m);
  setTimeout(() => document.addEventListener("pointerdown", function h(e) {
    if (!m.contains(e.target)) { m.remove(); document.removeEventListener("pointerdown", h); }
  }), 0);
}

// ---------- desktop icons (backed by the /Desktop folder) ----------
async function initDesktopIcons() {
  const DIR = "/Desktop";
  const layer = elNew("div"); layer.id = "desk-icons";
  desktop.insertBefore(layer, desktop.firstChild);
  let layout = {};

  const saveLayout = async () => { try { await sys("memory.set", { key: "desktop.layout", value: layout }); } catch (_) {} };

  async function render() {
    let entries = [];
    try { entries = (await sys("fs.list", { path: DIR })).entries; } catch (_) {}
    entries = entries.filter((e) => e.name !== ".keep" && !e.name.startsWith("."));
    if (!entries.length && !layout.__seeded) {
      await sys("fs.write", { path: DIR + "/Welcome.txt", content: "Welcome to voidOS.\n\nThis is your desktop. Right-click empty space to create files and folders.\nDouble-click an icon to open it. Drag icons to arrange them." });
      await sys("fs.write", { path: DIR + "/Projects/.keep", content: "" });
      layout.__seeded = true;
      entries = (await sys("fs.list", { path: DIR })).entries.filter((e) => e.name !== ".keep" && !e.name.startsWith("."));
    }
    layer.innerHTML = "";
    let gx = 20, gy = 18;
    for (const e of entries) {
      const di = elNew("div", "dicon",
        `<div class="ico" style="color:${e.kind === "dir" ? "var(--cyan)" : "var(--fg)"}">${e.kind === "dir" ? icon("folder") : icon("file")}</div><div class="nm">${esc(e.name)}</div>`);
      if (!layout[e.name]) { layout[e.name] = { x: gx, y: gy }; gy += 104; if (gy > desktop.clientHeight - 200) { gy = 18; gx += 104; } }
      di.style.left = layout[e.name].x + "px";
      di.style.top = layout[e.name].y + "px";

      const open = () => (e.kind === "dir" ? openFiles(e.path) : openEditor(e.path));
      di.addEventListener("dblclick", open);
      di.addEventListener("pointerdown", (ev) => {
        ev.stopPropagation();
        layer.querySelectorAll(".dicon.sel").forEach((x) => x.classList.remove("sel"));
        di.classList.add("sel");
        const sx = ev.clientX, sy = ev.clientY, ox = di.offsetLeft, oy = di.offsetTop; let moved = false;
        di.setPointerCapture(ev.pointerId);
        const mv = (m) => { if (Math.abs(m.clientX - sx) + Math.abs(m.clientY - sy) > 4) moved = true;
          if (moved) { di.style.left = Math.max(0, ox + m.clientX - sx) + "px"; di.style.top = Math.max(0, oy + m.clientY - sy) + "px"; } };
        const up = () => { di.removeEventListener("pointermove", mv); di.removeEventListener("pointerup", up);
          if (moved) { layout[e.name] = { x: di.offsetLeft, y: di.offsetTop }; saveLayout(); } };
        di.addEventListener("pointermove", mv); di.addEventListener("pointerup", up);
      });
      di.addEventListener("contextmenu", (ev) => {
        ev.preventDefault(); ev.stopPropagation();
        showMenu(ev.clientX, ev.clientY, [
          { label: "Open", fn: open },
          { label: "Rename", fn: async () => { const n = prompt("Rename to:", e.name); if (n && n !== e.name) { await sys("shell.exec", { cmd: `mv "Desktop/${e.name}" "Desktop/${n}"` }); delete layout[e.name]; await saveLayout(); render(); } } },
          { sep: true },
          { label: "Delete", fn: async () => { if (confirm("Delete " + e.name + "?")) { await sys("fs.remove", { path: e.path }); delete layout[e.name]; await saveLayout(); render(); } } },
        ]);
      });
      layer.appendChild(di);
    }
    saveLayout();
  }

  layer.addEventListener("contextmenu", (ev) => {
    ev.preventDefault();
    showMenu(ev.clientX, ev.clientY, [
      { label: "New Folder", fn: async () => { const n = prompt("Folder name:", "New Folder"); if (n) { await sys("fs.write", { path: `${DIR}/${n}/.keep`, content: "" }); render(); } } },
      { label: "New File", fn: async () => { const n = prompt("File name:", "untitled.txt"); if (n) { await sys("fs.write", { path: `${DIR}/${n}`, content: "" }); render(); } } },
      { sep: true },
      { label: "Open Files here", fn: () => openFiles(DIR) },
      { label: "Refresh", fn: render },
    ]);
  });
  layer.addEventListener("pointerdown", () => layer.querySelectorAll(".dicon.sel").forEach((x) => x.classList.remove("sel")));

  try { layout = (await sys("memory.get", { key: "desktop.layout" })).value || {}; } catch (_) { layout = {}; }
  await render();
}

// ---------- shell chrome ----------
document.querySelectorAll(".dock-app").forEach((b) => {
  const a = b.dataset.app;
  const ico = b.querySelector(".ico");
  ico.innerHTML = icon(APP_ICON[a]);
  ico.style.color = APP_ACCENT[a];
});
document.getElementById("dock").addEventListener("click", (e) => {
  const b = e.target.closest(".dock-app"); if (b) openApp(b.dataset.app);
});

function tickClock() {
  const d = new Date();
  document.getElementById("tb-clock").textContent = d.toLocaleTimeString();
}
async function tickSys() {
  try { const i = await sys("sys.info"); document.getElementById("tb-sys").textContent = `${i.policy} · ${i.capability_count} caps · up ${Math.round(i.uptime_ms / 1000)}s`; }
  catch { document.getElementById("tb-sys").textContent = "gate down"; }
}
tickClock(); setInterval(tickClock, 1000);
tickSys(); setInterval(tickSys, 3000);

// power menu (it's the whole shell now)
const powerBtn = document.getElementById("power");
if (powerBtn) {
  powerBtn.innerHTML = icon("power");
  powerBtn.addEventListener("click", (e) => {
    showMenu(e.clientX - 150, 30, [
      { label: "Open Terminal", fn: openTerminal },
      { label: "Reload desktop", fn: () => location.reload() },
      { sep: true },
      { label: "Restart", fn: async () => { if (confirm("Restart the machine?")) try { await sys("shell.exec", { cmd: "systemctl reboot" }); } catch (_) {} } },
      { label: "Shut Down", fn: async () => { if (confirm("Shut down the machine?")) try { await sys("shell.exec", { cmd: "systemctl poweroff" }); } catch (_) {} } },
    ]);
  });
}

// a clean desktop with icons; open apps from the dock or by double-clicking
initDesktopIcons();
