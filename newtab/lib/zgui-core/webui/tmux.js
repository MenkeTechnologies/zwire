// zgui-core/tmux.js — tmux/zellij mode as a shared component. A real in-app
// tiling overlay: SESSION → WINDOWS (tabs) → PANES, split BOTH ways, nested to any
// depth, unlimited windows. No OS windows. window.ZGui.tmux.
//
// The WM (tree/windows/layouts/nav/resize/zoom/tabs/sessions/command-prompt/
// prefix), synchronize-panes, copy-mode and paste-buffers all live here. The
// PANE CONTENT is host-supplied via ZGui.tmux.init(cfg): the host renders whatever
// it wants (a document, a webpage iframe, a terminal) into the pane element we
// hand it. Ported from zwire's ztmux.js and generalized so zoffice/zpdf/zphoto
// (same-document DOM panes) AND zwire (cross-origin iframe panes) can consume it.
//
//   ZGui.tmux.init({
//     prefs:        { load: () => Promise<obj>, save: (obj) => Promise },  // sessions/keymap store
//     openEmptyPane:(bodyEl) => Promise<ref|null>,  // host shows its picker, renders INTO bodyEl,
//                                                   // returns a JSON-serializable ref (or null)
//     renderPane:   (bodyEl, ref) => Promise,       // re-render a saved ref (session restore/reload)
//     paneLabel:    (ref) => string,                // tab + title-bar label
//     pickPaneRef:  (curRef) => Promise<ref|null>,  // OPTIONAL — host picker for the saved-layouts
//                                                   // editor's per-pane "set…" button (omit → panes
//                                                   // are structural, filled live after Load)
//     // OPTIONAL pane-op overrides for non-same-document models (e.g. zwire iframes).
//     // Omit them and the built-in same-document DOM impls are used (zoffice/zpdf/zphoto):
//     applyKey:     (bodyEl, key) => {},            // synchronize-panes broadcast into a peer pane
//     setSync:      (bodyEl, on) => {},             // notify a pane of its sync membership so it
//                                                   // knows to BROADCAST its own typing (iframe model)
//     copyMode:     (bodyEl) => {},                 // enter copy-mode for a pane
//     paste:        (bodyEl, text) => {},           // paste a buffer into a pane
//   })
//   Self-contained: this component self-injects its stylesheet (+ its ZGui.modal/
//   toast/buttonBar deps each self-inject theirs), so a consumer works by
//   loading the JS alone — no manifest CSS / all.css step required.
//   ZGui.tmux.open() / .toggle() / .isOpen() / .status()
//
// zgui-core only: the tiling is an ABSOLUTE-POSITION model — every pane is a
// permanent direct child of the body, tiled by setting its left/top/width/height in
// % from the layout tree, with its own draggable dividers. A split just adds a pane
// and recomputes rects; no pane is ever RE-PARENTED, so an <iframe>/webview pane
// never reloads on split, retile, zoom, or window switch. Dialogs use ZGui.modal, toasts
// ZGui.toast, tabs a ZGui button bar. Publishes its window/pane segment to
// ZGui.powerline (the shared status bar) when present.
(function () {
  "use strict";
  var CFG = {};
  function cfgPrefsLoad() { try { return (CFG.prefs && CFG.prefs.load) ? Promise.resolve(CFG.prefs.load()) : Promise.resolve({}); } catch (e) { return Promise.resolve({}); } }
  function cfgPrefsSave(o) { try { return (CFG.prefs && CFG.prefs.save) ? Promise.resolve(CFG.prefs.save(o)) : Promise.resolve(); } catch (e) { return Promise.resolve(); } }
  function paneLabelOf(l) { if (!l || !l.doc) return "empty"; try { return (CFG.paneLabel && CFG.paneLabel(l.doc)) || "pane"; } catch (e) { return "pane"; } }

  // ------------------------------------------------------------------ helpers
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function editable(t) { if (!t) return false; var n = t.tagName; return n === "INPUT" || n === "TEXTAREA" || n === "SELECT" || t.isContentEditable; }
  function ZG() { return window.ZGui || {}; }
  function toast(msg, type) { var z = ZG(); if (z.toast && z.toast.show) z.toast.show(msg, 2200, type || ""); }

  // ------------------------------------------------------------------ config
  // Prefix: a list of chords; a keypress matching ANY chord arms the overlay.
  // Default Ctrl-b (real tmux) OR ⌥-b (nothing intercepts Alt-b). Rebindable via
  // prefs 'tmuxPrefix'. Post-prefix keys are remappable via prefs 'tmuxKeys'.
  function defaultPrefix() { return [{ ctrl: true, key: "b" }, { alt: true, code: "KeyB" }]; }
  var PREFIX = defaultPrefix(), ARM_MS = 2500, keyOverrides = {};

  // The post-prefix key vocabulary (ported from zwire zkeys.js `tmux` category).
  // Entries marked na:true have no office-document meaning; they report why.
  var ACTIONS = [
    { name: "tmux-split-h", def: "%", label: "Split pane right" },
    { name: "tmux-split-v", def: '"', label: "Split pane down" },
    { name: "tmux-pane-next", def: "o", label: "Next pane" },
    { name: "tmux-pane-last", def: ";", label: "Last (previous) pane" },
    { name: "tmux-pane-left", def: "h", label: "Select pane ←" },
    { name: "tmux-pane-down", def: "j", label: "Select pane ↓" },
    { name: "tmux-pane-up", def: "k", label: "Select pane ↑" },
    { name: "tmux-pane-right", def: "l", label: "Select pane →" },
    { name: "tmux-resize-left", def: "H", label: "Resize pane ←" },
    { name: "tmux-resize-down", def: "J", label: "Resize pane ↓" },
    { name: "tmux-resize-up", def: "K", label: "Resize pane ↑" },
    { name: "tmux-resize-right", def: "L", label: "Resize pane →" },
    { name: "tmux-zoom", def: "z", label: "Zoom pane" },
    { name: "tmux-close", def: "x", label: "Close pane" },
    { name: "tmux-swap-prev", def: "{", label: "Swap pane ←" },
    { name: "tmux-swap-next", def: "}", label: "Swap pane →" },
    { name: "tmux-rotate", def: "O", label: "Rotate panes" },
    { name: "tmux-break", def: "!", label: "Break pane to new window" },
    { name: "tmux-pane-nums", def: "q", label: "Show pane numbers" },
    { name: "tmux-layout", def: " ", label: "Cycle layout" },
    { name: "tmux-grid-4", def: "F", label: "Layout: 4 even panes (grid)" },
    { name: "tmux-grid-8", def: "G", label: "Layout: 8 even panes (grid)" },
    { name: "tmux-grid-16", def: "I", label: "Layout: 16 even panes (grid)" },
    { name: "tmux-open", def: "Enter", label: "Open a document in this pane" },
    { name: "tmux-win-new", def: "c", label: "New window" },
    { name: "tmux-win-next", def: "n", label: "Next window" },
    { name: "tmux-win-prev", def: "p", label: "Previous window" },
    { name: "tmux-win-last", def: "Tab", label: "Last window" },
    { name: "tmux-win-rename", def: ",", label: "Rename window" },
    { name: "tmux-win-move", def: ".", label: "Move / renumber window" },
    { name: "tmux-win-goto", def: "'", label: "Go to window (prompt)" },
    { name: "tmux-win-list", def: "w", label: "Window list" },
    { name: "tmux-win-kill", def: "&", label: "Kill window" },
    { name: "tmux-find", def: "f", label: "Find window (search text)" },
    { name: "tmux-info", def: "i", label: "Window info" },
    { name: "tmux-reload", def: "r", label: "Reload pane document" },
    { name: "tmux-clock", def: "t", label: "Clock" },
    { name: "tmux-mark", def: "m", label: "Mark pane / swap with marked" },
    { name: "tmux-sync", def: "e", label: "Synchronize panes (broadcast typing, all on / off)" },
    { name: "tmux-sync-pane", def: "E", label: "Toggle this pane in the sync group" },
    { name: "tmux-copy-mode", def: "[", label: "Copy mode (scroll + yank selection)" },
    { name: "tmux-paste", def: "]", label: "Paste buffer (most recent)" },
    { name: "tmux-buffers", def: "=", label: "Choose paste buffer" },
    { name: "tmux-command", def: ":", label: "Command prompt (tmux CLI)" },
    { name: "tmux-detach", def: "d", label: "Detach (hide overlay)" },
    { name: "tmux-sessions", def: "s", label: "Sessions (load a saved layout)" },
    { name: "tmux-session-save", def: "S", label: "Save current layout as a session" },
    { name: "tmux-sessions-edit", def: "M", label: "Manage saved layouts (editor)" },
    { name: "tmux-help", def: "?", label: "Help" }
  ];
  var keyToAction = {};
  function buildKeys() { keyToAction = {}; ACTIONS.forEach(function (a) { keyToAction[keyOverrides[a.name] || a.def] = a.name; }); }
  buildKeys();

  function chordMatch(e, c) {
    if (!!c.ctrl !== e.ctrlKey || !!c.alt !== e.altKey || !!c.meta !== e.metaKey) return false;
    if (c.shift != null && !!c.shift !== e.shiftKey) return false;
    if (c.code) return e.code === c.code;
    if (c.key) return e.key.toLowerCase() === String(c.key).toLowerCase();
    return false;
  }
  function isPrefix(e) { var l = (PREFIX && PREFIX.length) ? PREFIX : defaultPrefix(); for (var i = 0; i < l.length; i++) if (chordMatch(e, l[i])) return true; return false; }

  // ------------------------------------------------------------------ prefs
  // Config + saved sessions live in the host's prefs blob (CFG.prefs — a host
  // file via Tauri, chrome.storage, localStorage…). We read the whole blob, mutate
  // our keys, write it back.
  var SESSIONS = [], sessHotkeys = {};
  async function loadCfg() {
    try {
      var p = (await cfgPrefsLoad()) || {};
      if (Array.isArray(p.tmuxPrefix) && p.tmuxPrefix.length) PREFIX = p.tmuxPrefix;
      if (p.tmuxOpts && typeof p.tmuxOpts.timeout === "number" && p.tmuxOpts.timeout > 0) ARM_MS = p.tmuxOpts.timeout;
      keyOverrides = p.tmuxKeys || {}; buildKeys();
      SESSIONS = Array.isArray(p.tmuxSessions) ? p.tmuxSessions : [];
      loadSessHotkeys();
    } catch (e) { /* keep defaults */ }
  }
  async function savePrefs(mut) {
    try { var p = (await cfgPrefsLoad()) || {}; mut(p); await cfgPrefsSave(p); } catch (e) {}
  }
  function loadSessHotkeys() { sessHotkeys = {}; (SESSIONS || []).forEach(function (s) { if (s && s.hotkey) sessHotkeys[String(s.hotkey)] = s.id; }); }

  // ------------------------------------------------------------------ state
  var uid = 0; function nid(p) { return (p || "p") + (++uid); }
  // leaf.doc = { path, app } or null (empty pane → document chooser).
  function leaf(doc) { return { t: "leaf", id: nid("p"), doc: doc || null }; }
  function mkWindow(doc) { var l = leaf(doc); return { id: nid("w"), name: "", tree: l, active: l.id, zoom: null, layout: "", marked: null, last: null }; }
  var S = { windows: [mkWindow(null)], active: 0, last: null, sessId: null, sessName: "" };
  var open = false, armed = false, armTimer = null;

  function W() { return S.windows[S.active]; }
  function leaves(n, out) { out = out || []; if (n.t === "leaf") out.push(n); else { leaves(n.a, out); leaves(n.b, out); } return out; }
  function findLeaf(id) { var ls = leaves(W().tree); for (var i = 0; i < ls.length; i++) if (ls[i].id === id) return ls[i]; return null; }
  function activeLeaf() { return findLeaf(W().active) || leaves(W().tree)[0]; }
  function nodeSlot(root, target) {
    if (root === target) return { parent: null };
    if (root.t === "split") { if (root.a === target) return { parent: root, key: "a" }; if (root.b === target) return { parent: root, key: "b" }; return nodeSlot(root.a, target) || nodeSlot(root.b, target); }
    return null;
  }
  function splitContaining(node, target, par) {
    if (node.t !== "split") return null;
    if (node.a === target || node.b === target) return { split: node, par: par };
    return splitContaining(node.a, target, node) || splitContaining(node.b, target, node);
  }
  function setActivePane(id) { var w = W(); if (id && id !== w.active) w.last = w.active; w.active = id; }

  // ------------------------------------------------------------------ commands
  function splitPane(dir) {
    var w = W(), L = activeLeaf(); if (!L) return;
    var N = leaf(null), sp = { t: "split", dir: dir, ratio: 0.5, a: L, b: N };
    var s = nodeSlot(w.tree, L);
    if (!s || s.parent == null) w.tree = sp; else s.parent[s.key] = sp;
    setActivePane(N.id); w.zoom = null;
  }
  function closePane() {
    var w = W(), L = activeLeaf(); if (!L) return;
    if (w.tree === L) { killWindow(); return; }
    var info = splitContaining(w.tree, L, null);
    var sib = info.split.a === L ? info.split.b : info.split.a;
    if (!info.par) w.tree = sib; else { if (info.par.a === info.split) info.par.a = sib; else info.par.b = sib; }
    setActivePane(leaves(sib)[0].id); w.zoom = null;
    dropPane(L.id);
  }
  function navCycle(delta) { var w = W(), ls = leaves(w.tree), i = 0; for (var k = 0; k < ls.length; k++) if (ls[k].id === w.active) i = k; setActivePane(ls[(i + delta + ls.length) % ls.length].id); }
  function lastPane() { var w = W(); if (w.last && findLeaf(w.last)) setActivePane(w.last); }
  function navDir(dir) {
    var w = W(), a = paneRects[w.active]; if (!a) { navCycle(1); return; }
    var ax = a.x + a.w / 2, ay = a.y + a.h / 2, best = null, bd = 1e9;
    leaves(w.tree).forEach(function (l) {
      if (l.id === w.active) return; var r = paneRects[l.id]; if (!r) return;
      var cx = r.x + r.w / 2, cy = r.y + r.h / 2, ok = false;
      if (dir === "left") ok = cx < ax - 1; else if (dir === "right") ok = cx > ax + 1;
      else if (dir === "up") ok = cy < ay - 1; else ok = cy > ay + 1;
      if (!ok) return; var d = (cx - ax) * (cx - ax) + (cy - ay) * (cy - ay); if (d < bd) { bd = d; best = l; }
    });
    if (best) setActivePane(best.id);
  }
  function swapPane(delta) {
    var w = W(), ls = leaves(w.tree); if (ls.length < 2) return;
    var i = 0; for (var k = 0; k < ls.length; k++) if (ls[k].id === w.active) i = k;
    var A = ls[i], B = ls[(i + delta + ls.length) % ls.length]; if (A === B) return;
    var sa = nodeSlot(w.tree, A), sb = nodeSlot(w.tree, B);
    if (sa.parent) sa.parent[sa.key] = B; else w.tree = B;
    if (sb.parent) sb.parent[sb.key] = A; else w.tree = A;
    setActivePane(A.id);
  }
  function rotatePanes(delta) {
    var w = W(), ls = leaves(w.tree); if (ls.length < 2) return;
    var slots = ls.map(function (l) { return nodeSlot(w.tree, l); });
    slots.forEach(function (s, idx) { var src = ls[(idx - delta + ls.length) % ls.length]; if (s.parent) s.parent[s.key] = src; else w.tree = src; });
  }
  function breakPane() {
    var w = W(), L = activeLeaf(); if (!L || leaves(w.tree).length < 2) return;
    var info = splitContaining(w.tree, L, null);
    var sib = info.split.a === L ? info.split.b : info.split.a;
    if (!info.par) w.tree = sib; else { if (info.par.a === info.split) info.par.a = sib; else info.par.b = sib; }
    w.active = leaves(sib)[0].id;
    S.windows.push({ id: nid("w"), name: "", tree: L, active: L.id, zoom: null, layout: "", marked: null, last: null });
    S.last = S.active; S.active = S.windows.length - 1;
  }
  function resizePane(dir, amt) {
    var w = W(), L = activeLeaf(); if (!L) return;
    var axis = (dir === "left" || dir === "right") ? "row" : "col", path = [];
    (function find(node) { if (node === L) return true; if (node.t === "split") { if (find(node.a)) { path.push({ node: node, side: "a" }); return true; } if (find(node.b)) { path.push({ node: node, side: "b" }); return true; } } return false; })(w.tree);
    for (var i = 0; i < path.length; i++) {
      var p = path[i];
      if (p.node.dir === axis) { var sign = (dir === "left" || dir === "up") ? -1 : 1; var d = (p.side === "a" ? sign : -sign) * amt; p.node.ratio = Math.max(0.08, Math.min(0.92, (p.node.ratio || 0.5) + d)); return; }
    }
  }
  function buildEven(ls, dir) {
    if (ls.length === 1) return ls[0];
    var mid = Math.ceil(ls.length / 2);
    return { t: "split", dir: dir, ratio: mid / ls.length, a: buildEven(ls.slice(0, mid), dir), b: buildEven(ls.slice(mid), dir) };
  }
  function buildTiled(ls) {
    if (ls.length <= 1) return ls[0];
    var cols = Math.ceil(Math.sqrt(ls.length)), per = Math.ceil(ls.length / cols), colTrees = [], i = 0;
    while (i < ls.length) { colTrees.push(buildEven(ls.slice(i, i + per), "col")); i += per; }
    return buildEven(colTrees, "row");
  }
  function applyGrid(n) {
    var w = W(), ls = leaves(w.tree);
    while (ls.length < n) ls.push(leaf(null));
    w.tree = buildTiled(ls); w.layout = "tiled"; w.zoom = null;
    setActivePane(ls[0].id);
  }
  var LAYOUT_ORDER = ["even-h", "even-v", "main-v", "main-h", "tiled"];
  function setLayout(name) {
    var w = W(), ls = leaves(w.tree); if (ls.length < 2) return;
    w.layout = name;
    if (name === "even-h") w.tree = buildEven(ls, "row");
    else if (name === "even-v") w.tree = buildEven(ls, "col");
    else if (name === "main-v") w.tree = { t: "split", dir: "row", ratio: 0.6, a: ls[0], b: buildEven(ls.slice(1), "col") };
    else if (name === "main-h") w.tree = { t: "split", dir: "col", ratio: 0.6, a: ls[0], b: buildEven(ls.slice(1), "row") };
    else { w.layout = "tiled"; var cols = Math.ceil(Math.sqrt(ls.length)), rows = []; for (var i = 0; i < ls.length; i += cols) rows.push(buildEven(ls.slice(i, i + cols), "row")); w.tree = rows.length === 1 ? rows[0] : buildEven(rows, "col"); }
    w.zoom = null;
  }
  function cycleLayout() { var w = W(); if (leaves(w.tree).length < 2) return; setLayout(LAYOUT_ORDER[(LAYOUT_ORDER.indexOf(w.layout) + 1) % LAYOUT_ORDER.length]); }
  function markPane() {
    var w = W(); if (w.marked && !findLeaf(w.marked)) w.marked = null;
    if (w.marked === w.active) { w.marked = null; return; }
    if (w.marked && findLeaf(w.marked)) {
      var a = findLeaf(w.active), b = findLeaf(w.marked);
      var sa = nodeSlot(w.tree, a), sb = nodeSlot(w.tree, b);
      if (sa.parent) sa.parent[sa.key] = b; else w.tree = b;
      if (sb.parent) sb.parent[sb.key] = a; else w.tree = a;
      w.marked = null; return;
    }
    w.marked = w.active;
  }
  function reloadPane() { var l = activeLeaf(); if (l && l.doc) renderRef(l.id); }

  /* --------------------- synchronize-panes (broadcast typing) ------------------
   * win.syncPanes = the set of leaf ids that share typing. Unlike zwire (panes are
   * cross-origin iframes needing a postMessage relay), zoffice panes are same-
   * document DOM, so we mirror keystrokes from the focused synced pane straight
   * into the other synced panes' last-focused editable surfaces. */
  function syncMembers(w) { return w.syncPanes || (w.syncPanes = []); }
  function paneSynced(w, id) { return syncMembers(w).indexOf(id) >= 0; }
  function syncActive(w) { return syncMembers(w).length > 0; }
  function pruneSync(w) { var ids = leaves(w.tree).map(function (l) { return l.id; }); w.syncPanes = syncMembers(w).filter(function (id) { return ids.indexOf(id) >= 0; }); }
  function toggleSync() { var w = W(), ls = leaves(w.tree); w.syncPanes = (ls.length && syncMembers(w).length >= ls.length) ? [] : ls.map(function (l) { return l.id; }); toast(syncActive(w) ? "synchronize-panes ON" : "synchronize-panes off"); }
  function toggleSyncPane() { var w = W(), m = syncMembers(w), i = m.indexOf(w.active); if (i >= 0) m.splice(i, 1); else m.push(w.active); toast(paneSynced(w, w.active) ? "pane joined sync group" : "pane left sync group"); }

  // Per-pane caret tracking: only one element is focused in a single document, so
  // to insert into an UNFOCUSED synced pane we remember each pane's last editable +
  // caret (selection offsets for inputs, a Range for contenteditable).
  function paneOfNode(node) { for (var id in panes) { if (panes[id].body && panes[id].body.contains(node)) return { id: id, rec: panes[id] }; } return null; }
  function noteCaret(rec) {
    var elx = rec.lastField; if (!elx || !elx.isConnected) return;
    if ("value" in elx) { try { rec.selStart = elx.selectionStart; rec.selEnd = elx.selectionEnd; } catch (e) {} }
    else { var s = window.getSelection && window.getSelection(); if (s && s.rangeCount && elx.contains(s.anchorNode)) rec.lastRange = s.getRangeAt(0).cloneRange(); }
  }
  document.addEventListener("focusin", function (e) { if (!open || !editable(e.target)) return; var pn = paneOfNode(e.target); if (pn) { pn.rec.lastField = e.target; noteCaret(pn.rec); } }, true);
  document.addEventListener("selectionchange", function () { if (!open || copyMode) return; var a = document.activeElement; if (!editable(a)) return; var pn = paneOfNode(a); if (pn && pn.rec.lastField === a) noteCaret(pn.rec); });
  // Broadcast: observe typing in a focused synced pane (bubble phase, after the field
  // handles the key) and replay it to the peers. Printable + Enter + Backspace + Delete
  // pass as-is; the readline line-editors forward as semantic tokens so sync covers them
  // too: C-w kill word, C-u kill to line start, plus the macOS ⌥/⌘-Delete twins.
  document.addEventListener("keydown", function (e) {
    if (!open || copyMode) return; var w = W(); if (!syncActive(w)) return;
    var a = document.activeElement; if (!editable(a)) return; var pn = paneOfNode(a); if (!pn || !paneSynced(w, pn.id)) return;
    var mod = e.ctrlKey || e.metaKey || e.altKey;
    if (!mod && (e.key.length === 1 || e.key === "Enter" || e.key === "Backspace" || e.key === "Delete")) broadcastKey(pn.id, e.key);
    else if (e.ctrlKey && !e.metaKey && !e.altKey && (e.key === "w" || e.key === "W")) broadcastKey(pn.id, "C-w");
    else if (e.ctrlKey && !e.metaKey && !e.altKey && (e.key === "u" || e.key === "U")) broadcastKey(pn.id, "C-u");
    else if (e.altKey && !e.ctrlKey && !e.metaKey && e.key === "Backspace") broadcastKey(pn.id, "C-w");
    else if (e.metaKey && !e.ctrlKey && !e.altKey && e.key === "Backspace") broadcastKey(pn.id, "C-u");
  }, false);
  function broadcastKey(srcId, key) { var w = W(); leaves(w.tree).forEach(function (l) { if (l.id === srcId || !paneSynced(w, l.id)) return; var rec = panes[l.id]; if (!rec) return; if (CFG.applyKey) { try { CFG.applyKey(rec.body, key); } catch (e) {} } else applyKey(rec, key); }); }

  function setNative(elx, v) { try { var d = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(elx), "value"); if (d && d.set) { d.set.call(elx, v); return; } } catch (e) {} elx.value = v; }
  function liveRange(rec, elx) { var r = rec.lastRange; if (r && r.startContainer && r.startContainer.isConnected && elx.contains(r.startContainer)) return r.cloneRange(); r = document.createRange(); r.selectNodeContents(elx); r.collapse(false); return r; }
  // The editable to type into for a pane: its last-focused field if still valid,
  // else the first editable in its body (so broadcast typing reaches panes that
  // were never focused — the common case when you sync then start typing). The
  // contenteditable document surface itself counts.
  function targetEl(rec) {
    var el2 = rec.lastField;
    if (el2 && el2.isConnected && editable(el2)) return el2;
    if (rec.body) {
      var f = rec.body.querySelector('[contenteditable=""], [contenteditable="true"], input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]), textarea');
      if (f) return (rec.lastField = f);
      var ce = rec.body.querySelector('[contenteditable]'); if (ce && ce.isContentEditable) return (rec.lastField = ce);
    }
    return null;
  }
  // Insert a whole string into a pane's editable at its tracked caret (paste + sync).
  function insertInto(rec, text) {
    var elx = targetEl(rec); if (!elx) return;
    if ("value" in elx) {
      var s = rec.selStart == null ? elx.value.length : rec.selStart, e2 = rec.selEnd == null ? s : rec.selEnd;
      setNative(elx, elx.value.slice(0, s) + text + elx.value.slice(e2)); rec.selStart = rec.selEnd = s + text.length;
      elx.dispatchEvent(new Event("input", { bubbles: true }));
    } else {
      var r = liveRange(rec, elx); r.deleteContents(); var tn = document.createTextNode(text); r.insertNode(tn); r.setStartAfter(tn); r.collapse(true); rec.lastRange = r.cloneRange();
      elx.dispatchEvent(new InputEvent("input", { bubbles: true }));
    }
  }
  // Apply one broadcast keystroke to a synced pane's editable.
  function applyKey(rec, key) {
    var elx = targetEl(rec); if (!elx) return;
    if (key === "Enter") { if (elx.tagName === "TEXTAREA" || elx.isContentEditable) insertInto(rec, "\n"); return; }
    if (key === "Backspace") {
      if ("value" in elx) {
        var s = rec.selStart == null ? elx.value.length : rec.selStart, e2 = rec.selEnd == null ? s : rec.selEnd;
        if (s === e2 && s > 0) s -= 1;
        setNative(elx, elx.value.slice(0, s) + elx.value.slice(e2)); rec.selStart = rec.selEnd = s; elx.dispatchEvent(new Event("input", { bubbles: true }));
      } else {
        var r = liveRange(rec, elx);
        if (r.collapsed) {
          var c = r.startContainer, off = r.startOffset;
          if (c.nodeType === 3 && off > 0) { r.setStart(c, off - 1); }
          else if (c.nodeType === 1 && off > 0) {                     // caret anchored in the element (our inserts land here)
            var prev = c.childNodes[off - 1];
            if (prev && prev.nodeType === 3 && prev.length > 0) { r.setStart(prev, prev.length - 1); r.setEnd(prev, prev.length); }
            else if (prev) { r.setStartBefore(prev); r.setEndAfter(prev); }
            else return;
          } else return;
        }
        r.deleteContents(); r.collapse(true); rec.lastRange = r.cloneRange(); elx.dispatchEvent(new InputEvent("input", { bubbles: true }));
      }
      return;
    }
    if (key === "Delete") {                                    // forward-delete one char (value inputs)
      if ("value" in elx) {
        var ds = rec.selStart == null ? elx.value.length : rec.selStart, de = rec.selEnd == null ? ds : rec.selEnd;
        if (ds === de && ds < elx.value.length) de += 1;
        setNative(elx, elx.value.slice(0, ds) + elx.value.slice(de)); rec.selStart = rec.selEnd = ds; elx.dispatchEvent(new Event("input", { bubbles: true }));
      }
      return;
    }
    if (key === "C-w" || key === "C-u") {                      // kill word back / kill to line start (cursor-aware)
      if ("value" in elx) {
        var val = elx.value, ks = rec.selStart == null ? val.length : rec.selStart, ke = rec.selEnd == null ? ks : rec.selEnd, cut;
        if (key === "C-w") { cut = ks; while (cut > 0 && /\s/.test(val[cut - 1])) cut--; while (cut > 0 && !/\s/.test(val[cut - 1])) cut--; }
        else { cut = val.lastIndexOf("\n", ks - 1) + 1; }
        setNative(elx, val.slice(0, cut) + val.slice(ke)); rec.selStart = rec.selEnd = cut; elx.dispatchEvent(new Event("input", { bubbles: true }));
      }
      return;
    }
    if (key.length === 1) insertInto(rec, key);
  }

  /* ------------------------------- copy mode --------------------------------
   * tmux copy-mode over a pane's document: hjkl/w/b/0/$/g/G motion via
   * Selection.modify, Space/v/V visual select, / ? n N search via window.find,
   * y/Enter copy → paste buffer. A synthetic caret makes the position visible.
   * Panes are scrollable, selectable DOM, so this is NOT web-specific. */
  var copyMode = false, copyPane = null, copyInd = null, copyCur = null, selecting = false, searchOpen = false, lastSearch = "", lastBack = false;
  function csel() { return window.getSelection ? window.getSelection() : null; }
  function rangeFromPoint(x, y) { if (document.caretRangeFromPoint) return document.caretRangeFromPoint(x, y); if (document.caretPositionFromPoint) { var p = document.caretPositionFromPoint(x, y); if (p) { var r = document.createRange(); r.setStart(p.offsetNode, p.offset); r.collapse(true); return r; } } return null; }
  function enterCopyMode() {
    var l = activeLeaf(), rec = l && panes[l.id]; if (!rec) return;
    if (CFG.copyMode) { try { CFG.copyMode(rec.body); } catch (e) {} return; }   // host owns copy-mode (e.g. iframe panes)
    var sel = csel(); if (!sel || copyMode) return;
    copyMode = true; copyPane = rec; selecting = false;
    var body = rec.body, br = body.getBoundingClientRect(), r = rangeFromPoint(br.left + 14, br.top + 16);
    if (!r || !body.contains(r.startContainer)) { r = document.createRange(); r.selectNodeContents(body); r.collapse(true); }
    sel.removeAllRanges(); sel.addRange(r);
    if (!document.getElementById("zt-cur-kf")) { var st = el("style"); st.id = "zt-cur-kf"; st.textContent = "@keyframes ztcurbl{50%{opacity:.15}}"; document.head.appendChild(st); }
    copyInd = el("div", "zt-copy-ind", "▨ COPY · hjkl move · w/b word · 0/$ line · g/G top/bot · H/M/L · C-d/u/f/b scroll · Space/v select · V line · y copy · A append · / ? n N search · Esc");
    document.body.appendChild(copyInd); showCursor();
    document.addEventListener("keydown", copyKey, true);
  }
  function copyExit() { copyMode = false; selecting = false; searchOpen = false; document.removeEventListener("keydown", copyKey, true); if (copyInd) { try { copyInd.remove(); } catch (e) {} copyInd = null; } if (copyCur) { try { copyCur.remove(); } catch (e) {} copyCur = null; } var s = csel(); if (s) try { s.collapseToEnd(); } catch (e) {} copyPane = null; focusActive(); }
  function showCursor() {
    var sel = csel(); if (!copyMode || !sel || !sel.rangeCount) return;
    var r = sel.getRangeAt(0).cloneRange(), rects = r.getClientRects(), rect = rects.length ? rects[rects.length - 1] : r.getBoundingClientRect();
    if (!copyCur) { copyCur = el("div", "zt-copy-cur"); document.body.appendChild(copyCur); }
    if (rect) { copyCur.style.left = (rect.right || rect.left || 0) + "px"; copyCur.style.top = (rect.top || 0) + "px"; copyCur.style.height = (rect.height || 16) + "px"; }
  }
  function ensureVisible() { try { var sel = csel(), node = sel.getRangeAt(0).startContainer; node = node.nodeType === 1 ? node : node.parentNode; if (node && node.scrollIntoView) node.scrollIntoView({ block: "nearest" }); } catch (e) {} }
  function mo(dir, gran) { var sel = csel(); try { sel.modify(selecting ? "extend" : "move", dir, gran); } catch (e) {} ensureVisible(); showCursor(); }
  function yankSel(append) { var sel = csel(), s = (sel && String(sel)) || ""; if (s) { pushBuffer(s, append); toast((append ? "appended " : "yanked ") + s.length + " chars"); } }
  // scroll the pane's own document surface (panes are scrollable DOM, not the window).
  function copyScroll(dy) { var b = copyPane && copyPane.body; if (b) { var h = b.clientHeight || 300; b.scrollBy(0, dy < 0 ? -Math.abs(Math.round(h * -dy)) : Math.round(h * dy)); showCursor(); } }
  function copyScrollPx(dy) { var b = copyPane && copyPane.body; if (b) { b.scrollBy(0, dy); showCursor(); } }
  // drop/extend the caret at viewport-relative y within the pane body (H/M/L).
  function toPoint(y) {
    var b = copyPane && copyPane.body, sel = csel(); if (!b || !sel) return;
    var br = b.getBoundingClientRect(), r = rangeFromPoint(br.left + 14, y); if (!r || !b.contains(r.startContainer)) return;
    if (selecting) { try { sel.extend(r.startContainer, r.startOffset); } catch (e) {} } else { sel.removeAllRanges(); sel.addRange(r); }
    showCursor();
  }
  function doSearch(text, back) { if (!text) return; lastSearch = text; lastBack = back; try { window.find(text, false, back, true); } catch (e) {} selecting = false; showCursor(); }
  function searchPrompt(back) { searchOpen = true; promptModal(back ? "search ↑" : "search ↓", "", function (v) { searchOpen = false; doSearch(v, back); }); }
  function copyKey(e) {
    if (searchOpen) return;
    var k = e.key; e.preventDefault(); e.stopImmediatePropagation(); var sel = csel();
    var b = copyPane && copyPane.body, bh = (b && b.getBoundingClientRect()) || { top: 0, height: 400 };
    if (e.ctrlKey) {                                       // scroll (tmux copy-mode C-d/u/f/b/e/y)
      if (k === "d") { copyScroll(0.5); mo("forward", "line"); }
      else if (k === "u") { copyScroll(-0.5); mo("backward", "line"); }
      else if (k === "f") copyScroll(0.9);
      else if (k === "b") copyScroll(-0.9);
      else if (k === "e") copyScrollPx(48);
      else if (k === "y") copyScrollPx(-48);
      return;
    }
    switch (k) {
      case "Escape": if (sel && !sel.isCollapsed) { sel.collapseToStart(); selecting = false; showCursor(); } else copyExit(); return;
      case "q": copyExit(); return;
      case "y": case "Enter": yankSel(false); copyExit(); return;
      case "A": yankSel(true); copyExit(); return;
      case "h": case "ArrowLeft": mo("backward", "character"); return;
      case "l": case "ArrowRight": mo("forward", "character"); return;
      case "j": case "ArrowDown": mo("forward", "line"); return;
      case "k": case "ArrowUp": mo("backward", "line"); return;
      case "w": case "W": case "e": case "E": mo("forward", "word"); return;
      case "b": case "B": mo("backward", "word"); return;
      case "0": case "^": mo("backward", "lineboundary"); return;
      case "$": mo("forward", "lineboundary"); return;
      case "{": mo("backward", "paragraphboundary"); return;
      case "}": mo("forward", "paragraphboundary"); return;
      case "g": mo("backward", "documentboundary"); if (b) b.scrollTo(0, 0); return;
      case "G": mo("forward", "documentboundary"); if (b) b.scrollTo(0, b.scrollHeight); return;
      case "H": toPoint(bh.top + 24); return;
      case "M": toPoint(bh.top + bh.height / 2); return;
      case "L": toPoint(bh.top + bh.height - 28); return;
      case "PageDown": copyScroll(0.9); return;
      case "PageUp": copyScroll(-0.9); return;
      case " ": case "v": selecting = !selecting; if (!selecting && sel) sel.collapseToStart(); showCursor(); return;
      case "V": selecting = false; mo("backward", "lineboundary"); selecting = true; mo("forward", "lineboundary"); return;
      case "/": searchPrompt(false); return;
      case "?": searchPrompt(true); return;
      case "n": doSearch(lastSearch, lastBack); return;
      case "N": doSearch(lastSearch, !lastBack); return;
    }
  }

  /* ---------------------------- paste buffers ------------------------------ */
  var buffers = [];
  function pushBuffer(t, append) { if (!t) return; if (append && buffers.length) { buffers[0] = buffers[0] + t; persist(); return; } buffers = buffers.filter(function (b) { return b !== t; }); buffers.unshift(t); if (buffers.length > 30) buffers.pop(); persist(); }
  function pasteBuffer(text) {
    if (text == null) text = buffers[0];
    if (text == null) { toast("no paste buffers yet — copy-mode (prefix [) to yank text first"); return; }
    var l = activeLeaf(), rec = l && panes[l.id]; if (!rec) return;
    if (CFG.paste) { try { CFG.paste(rec.body, text); } catch (e) {} return; }   // host owns paste (e.g. iframe panes)
    if (!rec.lastField || !rec.lastField.isConnected) { toast("focus a text field in this pane first"); return; }
    insertInto(rec, text);
  }
  function showBuffers() {
    if (!buffers.length) { toast("no paste buffers yet — copy-mode (prefix [) to yank text"); return; }
    listModal("paste buffers — Enter to paste into the active pane", buffers.map(function (b, i) { return { label: i + ": " + b.replace(/\s+/g, " ").slice(0, 80) }; }), function (i) { if (buffers[i] != null) pasteBuffer(buffers[i]); });
  }

  // windows
  function addWindow() { S.last = S.active; S.windows.push(mkWindow(null)); S.active = S.windows.length - 1; }
  function cycleWindow(delta) { if (S.windows.length < 2) return; S.last = S.active; S.active = (S.active + delta + S.windows.length) % S.windows.length; }
  function lastWindow() { if (S.last != null && S.last < S.windows.length && S.last !== S.active) { var c = S.active; S.active = S.last; S.last = c; } }
  function selectWindowNum(n) { if (n >= 0 && n < S.windows.length) { S.last = S.active; S.active = n; } }
  function killWindow() {
    leaves(W().tree).forEach(function (l) { dropPane(l.id); });
    S.windows.splice(S.active, 1);
    if (!S.windows.length) { open = false; S.windows.push(mkWindow(null)); S.active = 0; return; }
    S.active = Math.min(S.active, S.windows.length - 1);
  }

  // ------------------------------------------------------------------ dispatch
  function exec(k, mods) {
    var wasClosed = !open;
    mods = mods || {};
    // Detached — no session attached — behaves like tmux with no current session:
    // only session-level actions apply. Session hotkeys attach a saved layout
    // directly; the command prompt / chooser / editor / help open their own detached
    // surfaces (and attach on demand). Every pane/window op no-ops with a hint rather
    // than force-attaching a blank session (the old behaviour). Attached: unchanged.
    if (wasClosed && !sessHotkeys[k]) {
      var act0 = keyToAction[k];
      if (act0 !== "tmux-command" && act0 !== "tmux-sessions" && act0 !== "tmux-sessions-edit" && act0 !== "tmux-help") {
        toast("no session — C-b : then attach-session / new-session, or C-b s to pick one");
        return;
      }
    }
    var bw = S.active, bp = W().active, w = W();
    if (/^[0-9]$/.test(k)) { selectWindowNum(parseInt(k, 10)); render(); focusActive(); return; }
    if (k === "ArrowLeft" || k === "ArrowRight" || k === "ArrowUp" || k === "ArrowDown") {
      var dir = k.slice(5).toLowerCase();
      if (mods.ctrl || mods.alt) resizePane(dir, mods.alt ? 0.08 : 0.03); else navDir(dir);
      render(); focusActive(); return;
    }
    if (sessHotkeys[k]) { loadSessionById(sessHotkeys[k]); return; }
    switch (keyToAction[k]) {
      case "tmux-split-h": splitPane("row"); break;
      case "tmux-split-v": splitPane("col"); break;
      case "tmux-pane-next": navCycle(1); break;
      case "tmux-pane-last": lastPane(); break;
      case "tmux-pane-left": navDir("left"); break;
      case "tmux-pane-down": navDir("down"); break;
      case "tmux-pane-up": navDir("up"); break;
      case "tmux-pane-right": navDir("right"); break;
      case "tmux-resize-left": resizePane("left", 0.05); break;
      case "tmux-resize-down": resizePane("down", 0.05); break;
      case "tmux-resize-up": resizePane("up", 0.05); break;
      case "tmux-resize-right": resizePane("right", 0.05); break;
      case "tmux-grid-4": applyGrid(4); break;
      case "tmux-grid-8": applyGrid(8); break;
      case "tmux-grid-16": applyGrid(16); break;
      case "tmux-zoom": w.zoom = w.zoom ? null : w.active; break;
      case "tmux-close": closePane(); break;
      case "tmux-swap-prev": swapPane(-1); break;
      case "tmux-swap-next": swapPane(1); break;
      case "tmux-rotate": rotatePanes(1); break;
      case "tmux-break": breakPane(); break;
      case "tmux-pane-nums": showPaneNumbers(); return;
      case "tmux-layout": cycleLayout(); break;
      case "tmux-open": openInto(w.active); return;
      case "tmux-win-new": if (!wasClosed) addWindow(); break;
      case "tmux-win-next": cycleWindow(1); break;
      case "tmux-win-prev": cycleWindow(-1); break;
      case "tmux-win-last": lastWindow(); break;
      case "tmux-win-rename": renameWindow(); return;
      case "tmux-win-move": moveWindow(); return;
      case "tmux-win-goto": winGoto(); return;
      case "tmux-win-list": showChooser(); return;
      case "tmux-win-kill": killWindow(); break;
      case "tmux-find": findWindowPrompt(); return;
      case "tmux-info": toast("window " + S.active + ": " + (W().name || label(W())) + " · " + leaves(W().tree).length + " pane(s)"); return;
      case "tmux-mark": markPane(); break;
      case "tmux-sync": toggleSync(); break;
      case "tmux-sync-pane": toggleSyncPane(); break;
      case "tmux-copy-mode": enterCopyMode(); return;
      case "tmux-paste": pasteBuffer(); return;
      case "tmux-buffers": showBuffers(); return;
      case "tmux-reload": reloadPane(); return;
      case "tmux-clock": showClock(); return;
      case "tmux-command": commandPrompt(); return;
      case "tmux-detach": open = wasClosed; break;
      case "tmux-sessions": chooseSession(); return;
      case "tmux-session-save": saveCurrentSession(); return;
      case "tmux-sessions-edit": openSessionEditor(); return;
      case "tmux-help": showHelp(); return;
      default: return;
    }
    render();
    if (wasClosed || S.active !== bw || W().active !== bp) focusActive();
  }

  // ------------------------------------------------------------------ DOM
  var root, tabsEl, bodyEl;
  var panes = {};        // leafId -> { wrap, titleEl, body, nameEl } — mounted ONCE, never re-parented
  var paneRects = {};    // leafId -> {x,y,w,h} in % (active window) for directional nav

  function ensureDom() {
    if (root) return;
    root = el("div"); root.id = "zg-tmux";
    // Top: clickable window-tab strip. The BOTTOM status line is the app-wide
    // powerline bar (frontend/powerline.js, ported from zwire's zstatus.js) — the
    // overlay reserves 22px for it and publishes its window/pane state to it.
    tabsEl = el("div", "zt-tabs");
    bodyEl = el("div", "zt-body");
    root.appendChild(tabsEl); root.appendChild(bodyEl);
    document.body.appendChild(root);
  }
  // The tmux segment the powerline renders: session, window list (name/panes/zoom),
  // active index. Also exposed as ZGui.tmux.status() for the powerline's own polls.
  function tmuxStatus() {
    if (!open) return { windows: [] };
    return {
      sess: S.sessName || "",
      active: S.active,
      anySync: S.windows.some(function (win) { return syncActive(win); }),
      windows: S.windows.map(function (win) { return { name: win.name || label(win), panes: leaves(win.tree).length, zoom: !!win.zoom }; })
    };
  }
  function publishStatus() { try { var z = ZG(); if (z.powerline && z.powerline.tmux) z.powerline.tmux(tmuxStatus()); } catch (e) {} }

  function makePane(l) {
    var wrap = el("div", "zt-pane");
    var ttl = el("div", "zt-ttl");
    var nameEl = el("span", "zt-name", "empty");
    var x = el("span", "zt-x", "✕");
    ttl.appendChild(nameEl); ttl.appendChild(x);
    var body = el("div", "zt-pane-body");
    wrap.appendChild(ttl); wrap.appendChild(body);
    var rec = { wrap: wrap, titleEl: ttl, body: body, nameEl: nameEl };
    x.addEventListener("click", function (e) { e.stopPropagation(); setActivePane(l.id); render(); closePane(); render(); focusActive(); });
    wrap.addEventListener("mousedown", function () { if (W().active !== l.id) { setActivePane(l.id); render(); focusActive(); } });
    panes[l.id] = rec; bodyEl.appendChild(wrap);   // permanent child; layout() only repositions it
    if (l.doc) renderRef(l.id); else openInto(l.id);
    return rec;
  }
  function dropPane(id) { var p = panes[id]; if (p) { try { p.wrap.remove(); } catch (e) {} delete panes[id]; } }

  // % rectangles for each leaf (tiling + directional nav) plus the divider list —
  // mirrors the tree geometry. `divs` collects one entry per split node.
  function computeRects(node, x, y, w, h, out, divs) {
    if (node.t === "leaf") { out[node.id] = { x: x, y: y, w: w, h: h }; return; }
    var r = node.ratio == null ? 0.5 : node.ratio;
    if (node.dir === "row") {
      computeRects(node.a, x, y, w * r, h, out, divs);
      computeRects(node.b, x + w * r, y, w * (1 - r), h, out, divs);
      if (divs) divs.push({ node: node, dir: "row", x: x + w * r, y: y, len: h, rx: x, rw: w });
    } else {
      computeRects(node.a, x, y, w, h * r, out, divs);
      computeRects(node.b, x, y + h * r, w, h * (1 - r), out, divs);
      if (divs) divs.push({ node: node, dir: "col", x: x, y: y + h * r, len: w, ry: y, rh: h });
    }
  }

  // ---- draggable split dividers (own drag; a full-body shield keeps mousemove out
  // of the iframes while dragging). Divider els are pooled + repositioned, never per
  // pane, so nothing about resizing touches a pane's DOM.
  var dividerEls = [], dragShield = null;
  function drawDividers(divs) {
    while (dividerEls.length > divs.length) { var e = dividerEls.pop(); try { e.remove(); } catch (x) {} }
    divs.forEach(function (d, i) {
      var dv = dividerEls[i];
      if (!dv) { dv = el("div"); bodyEl.appendChild(dv); dividerEls[i] = dv; attachDrag(dv); }
      dv._d = d;
      dv.className = "zt-div " + (d.dir === "row" ? "zt-div-v" : "zt-div-h");
      dv.style.left = d.x + "%"; dv.style.top = d.y + "%";
      if (d.dir === "row") { dv.style.height = d.len + "%"; dv.style.width = ""; }
      else { dv.style.width = d.len + "%"; dv.style.height = ""; }
      dv.style.display = "block";
    });
  }
  function attachDrag(dv) {
    dv.addEventListener("mousedown", function (ev) {
      ev.preventDefault(); ev.stopPropagation();
      if (!dv._d) return;
      var rect = bodyEl.getBoundingClientRect();
      if (!dragShield) { dragShield = el("div", "zt-shield"); }
      dragShield.style.cursor = dv._d.dir === "row" ? "col-resize" : "row-resize";
      bodyEl.appendChild(dragShield);
      function mv(e) {
        var dd = dv._d;
        if (dd.dir === "row") { var px = (e.clientX - rect.left) / rect.width * 100; dd.node.ratio = Math.max(0.06, Math.min(0.94, (px - dd.rx) / dd.rw)); }
        else { var py = (e.clientY - rect.top) / rect.height * 100; dd.node.ratio = Math.max(0.06, Math.min(0.94, (py - dd.ry) / dd.rh)); }
        layout();
      }
      function upf() { document.removeEventListener("mousemove", mv, true); document.removeEventListener("mouseup", upf, true); if (dragShield && dragShield.parentNode) dragShield.remove(); persist(); }
      document.addEventListener("mousemove", mv, true); document.addEventListener("mouseup", upf, true);
    });
  }
  // Position every mounted pane from the active window's tree by mutating style only.
  // Panes not in the active window (or hidden behind a zoom) are display:none but stay
  // mounted — so switching windows / unzooming never reloads them either.
  function layout() {
    var w = W(), rects = {}, divs = [];
    computeRects(w.tree, 0, 0, 100, 100, rects, divs);
    paneRects = rects;
    var cur = {}; leaves(w.tree).forEach(function (l) { cur[l.id] = 1; });
    var zoom = (w.zoom && findLeaf(w.zoom)) ? w.zoom : null;
    Object.keys(panes).forEach(function (id) {
      var p = panes[id], r = zoom ? { x: 0, y: 0, w: 100, h: 100 } : rects[id];
      if (!cur[id] || (zoom && id !== zoom) || !r) { p.wrap.style.display = "none"; return; }
      p.wrap.style.display = "flex";
      p.wrap.style.left = r.x + "%"; p.wrap.style.top = r.y + "%";
      p.wrap.style.width = r.w + "%"; p.wrap.style.height = r.h + "%";
    });
    drawDividers(zoom ? [] : divs);
  }

  function render() {
    ensureDom();
    root.classList.toggle("on", open);
    if (open) root.classList.remove("zt-cmdonly");   // attaching supersedes the detached cmd-only surface
    if (!open) { publishStatus(); return; }   // detached: clear the powerline's tmux segment
    // top: clickable window-tab strip (a zgui button bar).
    tabsEl.textContent = "";
    var z = ZG(), bar = z.buttonBar ? z.buttonBar(tabsEl) : null;
    S.windows.forEach(function (win, i) {
      var lbl = i + ": " + (win.name || label(win));
      if (bar) { var t = bar.add(lbl, lbl, function () { S.active = i; render(); focusActive(); }); t.classList.add("zt-tab"); t.classList.toggle("act", i === S.active); }
    });
    // Right-aligned overlay action: open the saved-layouts editor from inside the tiling view
    // (same as prefix M / the ⌘K "Manage saved layouts" command).
    var edBtn = el("button", "zt-tab-btn", "▦ Layouts");
    edBtn.type = "button"; edBtn.title = "Manage saved layouts (prefix M)";
    edBtn.addEventListener("mousedown", function (e) { e.stopPropagation(); });
    edBtn.addEventListener("click", function (e) { e.preventDefault(); openSessionEditor(); });
    tabsEl.appendChild(edBtn);
    // Ensure a mounted pane exists for every leaf in the ACTIVE window (created once,
    // on first visit), then tile by repositioning — never re-parenting — so panes keep
    // their live content across splits, retiles, zoom, and window switches.
    var w = W();
    leaves(w.tree).forEach(function (l) { if (!panes[l.id]) makePane(l); });
    // drop only panes whose leaf is gone from EVERY window (a truly closed pane).
    var alive = {}; S.windows.forEach(function (win) { leaves(win.tree).forEach(function (l) { alive[l.id] = 1; }); });
    Object.keys(panes).forEach(function (id) { if (!alive[id]) dropPane(id); });
    S.windows.forEach(pruneSync);   // drop sync members left over from closed panes
    layout();
    refreshChrome();
    publishStatus();
    persist();
  }
  // Active-pane highlight, mark ring, and per-pane title — no scaffold rebuild.
  function refreshChrome() {
    var w = W();
    leaves(w.tree).forEach(function (l) {
      var p = panes[l.id]; if (!p) return;
      var synced = paneSynced(w, l.id);
      p.wrap.classList.toggle("act", l.id === w.active);
      p.wrap.classList.toggle("zt-mark", l.id === w.marked);
      p.wrap.classList.toggle("zt-synced", synced);
      // Non-same-document consumers (e.g. zwire's cross-origin iframe panes) can't
      // observe our sync state, and a synced pane must know it is synced to BROADCAST
      // its own keystrokes up. Push membership down on every chrome refresh (which runs
      // right after any sync toggle). Same-document consumers omit setSync.
      if (CFG.setSync) { try { CFG.setSync(p.body, synced); } catch (e) {} }
      p.nameEl.textContent = paneLabelOf(l);
    });
  }
  function label(win) { return paneLabelOf(leaves(win.tree)[0]); }
  function focusActive() { var l = activeLeaf(), p = l && panes[l.id]; if (p) { try { p.wrap.focus(); } catch (e) {} try { if (p.body) p.body.dispatchEvent(new CustomEvent("zt:activate", { bubbles: true })); } catch (e) {} } }

  // ------------------------------------------------------------------ pane content
  // Pane content is host-supplied. We just hand the host a pane body element:
  //   renderRef → re-render a saved ref (session restore / reload)
  //   openInto  → host shows its picker, renders into the body, returns a ref
  // The host owns the render pipeline entirely (document engine, iframe, terminal…).
  function renderRef(id) {
    var l = findLeaf(id), rec = panes[id]; if (!l || !rec || !l.doc || !CFG.renderPane) return;
    try { Promise.resolve(CFG.renderPane(rec.body, l.doc)).then(function () { refreshChrome(); persist(); }).catch(function (e) { toast("render failed: " + e, "error"); }); }
    catch (e) { toast("render failed: " + e, "error"); }
  }
  function openInto(id) {
    var l = findLeaf(id), rec = panes[id]; if (!l || !rec || !CFG.openEmptyPane) return;
    try {
      Promise.resolve(CFG.openEmptyPane(rec.body)).then(function (ref) {
        if (ref) { var ll = findLeaf(id); if (ll) ll.doc = ref; refreshChrome(); persist(); }
      }).catch(function (e) { toast("open failed: " + e, "error"); });
    } catch (e) { toast("open failed: " + e, "error"); }
  }

  // ------------------------------------------------------------------ key input
  function armTop() { armed = true; clearTimeout(armTimer); armTimer = setTimeout(function () { armed = false; }, ARM_MS); try { var z = ZG(); if (z.powerline && z.powerline.arm) z.powerline.arm(); } catch (e) {} }
  // Should the app instance owning `node` handle its own keyboard shortcuts right now?
  // NO while the prefix is armed (the next key belongs to tmux — the instance must not
  // eat it), and NO for any pane that isn't the active one. In-process consumers mount
  // one view per pane, and each binds a GLOBAL window/document key listener; without
  // this gate every pane's listener fires for a single keystroke and the first-mounted
  // wins (tools arm on the wrong pane; the active pane can't draw). Always YES when the
  // overlay isn't open (a single, whole-window instance).
  function suppressKeys(node) {
    if (armed) return true;
    if (!open) return false;
    var rec = panes[W().active];
    var b = rec && rec.body;
    return !(b && node && b.contains(node));
  }
  document.addEventListener("keydown", function (e) {
    // Inert until a host calls ZGui.tmux.init() (or the overlay is already open):
    // the component is auto-loaded everywhere (sync-based apps inject every webui
    // script), so without a configured pane provider it must NOT hijack the prefix.
    if (!inited && !open) return;
    if (armed) {
      if (e.key === "Shift" || e.key === "Control" || e.key === "Alt" || e.key === "Meta" || e.key === "Dead" || e.key === "Process") return;
      if (isPrefix(e)) { e.preventDefault(); e.stopImmediatePropagation(); return; }
      armed = false; clearTimeout(armTimer);
      e.preventDefault(); e.stopImmediatePropagation();
      if (e.key !== "Escape") exec(e.key, { ctrl: e.ctrlKey, alt: e.altKey }); else render();
      return;
    }
    // Prefix arming, considerate of the host office app: Ctrl-B is Bold in a
    // document. While DETACHED and typing in an editable, let Ctrl-B pass through
    // to the document (Bold survives) — ⌥b (altKey) still arms as a universal
    // opener. Once ATTACHED, the prefix owns the surface like real tmux (C-b is
    // always the prefix inside tmux, even in editable panes).
    //   CFG.prefixInEditable: hosts whose whole surface is an editable terminal (e.g. zmax-gui,
    //   where the editor lives in an xterm textarea) opt in so C-b is the tmux prefix GLOBALLY —
    //   otherwise the detached-editable pass-through above would send every C-b to the editor.
    if (isPrefix(e)) {
      if (!open && !e.altKey && editable(document.activeElement) && !CFG.prefixInEditable) return;
      e.preventDefault(); e.stopImmediatePropagation(); armTop();
    }
  }, true);

  // ------------------------------------------------------------------ overlays
  // Generic list-chooser modal (windows / sessions) — zgui modal chrome.
  function listModal(title, rows, onPick) {
    var z = ZG(); if (!z.modal || !z.modal.open) return;
    var body = el("div", "zt-list");
    var cur = 0, rowEls = [];
    function paint() { rowEls.forEach(function (r, i) { r.classList.toggle("sel", i === cur); }); var s = rowEls[cur]; if (s && s.scrollIntoView) s.scrollIntoView({ block: "nearest" }); }
    rows.forEach(function (r, i) {
      var row = el("div", "zt-lrow", r.label);
      row.addEventListener("click", function () { handle.close(); onPick(i); });
      rowEls.push(row); body.appendChild(row);
    });
    // onClose tears the nav listener down for BOTH backdrop-click and the modal's
    // own capture-phase ESC (which stopImmediatePropagation's, so `key` never sees it).
    var handle = z.modal.open({ title: title, body: body, dismissable: true, onClose: function () { document.removeEventListener("keydown", key, true); } });
    function key(e) {
      if (e.key === "ArrowDown" || e.key === "j") { cur = Math.min(rowEls.length - 1, cur + 1); paint(); e.preventDefault(); }
      else if (e.key === "ArrowUp" || e.key === "k") { cur = Math.max(0, cur - 1); paint(); e.preventDefault(); }
      else if (e.key === "g") { cur = 0; paint(); e.preventDefault(); }
      else if (e.key === "G") { cur = rowEls.length - 1; paint(); e.preventDefault(); }
      else if (/^[0-9]$/.test(e.key)) { var n = parseInt(e.key, 10); if (rowEls[n]) { handle.close(); onPick(n); } }
      else if (e.key === "Enter") { handle.close(); onPick(cur); e.preventDefault(); }
      else if (e.key === "q") { e.preventDefault(); handle.close(); }
    }
    document.addEventListener("keydown", key, true); paint();
  }

  function showHelp() {
    var z = ZG(); if (!z.modal || !z.modal.open) return;
    var body = el("div", "zt-help");
    var grid = el("div", "zt-help-grid");
    var rev = {}; Object.keys(keyToAction).forEach(function (kk) { rev[keyToAction[kk]] = kk; });
    ACTIONS.forEach(function (a) {
      var kk = rev[a.name] || a.def; var row = el("div", "zt-help-row");
      row.appendChild(el("kbd", null, kk === " " ? "Space" : kk));
      row.appendChild(el("span", null, " " + a.label));
      grid.appendChild(row);
    });
    body.appendChild(grid);
    body.appendChild(el("div", "zt-help-note", "Arrows focus panes · Ctrl/⌥+arrows or drag borders resize · 0–9 select window · m mark then m elsewhere to swap · e sync typing across panes · [ copy-mode (hjkl move, y yank), ] paste."));
    z.modal.open({ title: "tmux — prefix Ctrl-b (or ⌥b), then…", body: body, dismissable: true });
  }
  function showClock() {
    var z = ZG(); if (!z.modal || !z.modal.open) return;
    var c = el("div", "zt-clock");
    function fmt() { var d = new Date(); return ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2) + ":" + ("0" + d.getSeconds()).slice(-2); }
    c.textContent = fmt();
    var iv = setInterval(function () { if (!c.isConnected) { clearInterval(iv); return; } c.textContent = fmt(); }, 1000);
    z.modal.open({ title: "", body: c, dismissable: true });
  }
  function showChooser() {
    var rows = S.windows.map(function (win, i) { return { label: i + ": " + (win.name || label(win)) + "  (" + leaves(win.tree).length + " panes)" }; });
    listModal("windows — ↑/↓ or j/k, Enter to select", rows, function (i) { selectWindowNum(i); render(); focusActive(); });
  }
  function showPaneNumbers() {
    var ls = leaves(W().tree), badges = [];
    ls.forEach(function (l, i) { var p = panes[l.id]; if (!p) return; var b = el("div", "zt-pnum", String(i)); p.wrap.appendChild(b); badges.push(b); });
    function cleanup() { badges.forEach(function (b) { try { b.remove(); } catch (e) {} }); document.removeEventListener("keydown", key, true); }
    function key(e) {
      e.preventDefault(); e.stopImmediatePropagation();
      if (/^[0-9]$/.test(e.key)) { var n = parseInt(e.key, 10); if (ls[n]) setActivePane(ls[n].id); }
      cleanup(); render(); focusActive();
    }
    document.addEventListener("keydown", key, true);
    setTimeout(function () { try { cleanup(); } catch (e) {} }, 3000);
  }
  async function promptModal(title, initial, onOk) {
    var z = ZG(); if (!z.modal || !z.modal.prompt) { var v = window.prompt(title, initial || ""); if (v != null) onOk(v); return; }
    var v = await z.modal.prompt({ title: title, value: initial == null ? "" : String(initial) });
    if (v != null) onOk(v);
  }
  function renameWindow() { promptModal("Rename window " + S.active, W().name || "", function (v) { W().name = (v || "").trim(); render(); focusActive(); }); }
  function moveWindow() {
    promptModal("Move window " + S.active + " to index", S.active, function (v) {
      var n = parseInt(v, 10); if (isNaN(n)) return; n = Math.max(0, Math.min(S.windows.length - 1, n));
      var win = S.windows.splice(S.active, 1)[0]; S.windows.splice(n, 0, win); S.active = n; render(); focusActive();
    });
  }
  function winGoto() { promptModal("Go to window index", "", function (v) { var n = parseInt(v, 10); if (!isNaN(n)) { selectWindowNum(n); render(); focusActive(); } }); }
  function findWindowPrompt() {
    promptModal("find-window (text)", "", function (v) {
      var q = (v || "").trim().toLowerCase(); if (!q) return;
      for (var i = 0; i < S.windows.length; i++) { var ww = S.windows[i]; if ((ww.name || "").toLowerCase().indexOf(q) >= 0 || leaves(ww.tree).some(function (l) { return paneLabelOf(l).toLowerCase().indexOf(q) >= 0; })) { selectWindowNum(i); render(); focusActive(); return; } }
      toast("no window matches: " + v);
    });
  }

  // ------------------------------------------------------------------ tmux CLI
  // A subset of the tmux command language that maps to office panes. Web-only
  // commands (copy/sync/buffers/shell) report N/A. Prompt chrome is a zgui modal.
  var TMUX_ALIAS = {
    killw: "kill-window", killp: "kill-pane", neww: "new-window", newp: "new-pane", "new": "new-session",
    renamew: "rename-window", rename: "rename-session", renames: "rename-session",
    splitw: "split-window", split: "split-window", selectw: "select-window", selw: "select-window",
    next: "next-window", prev: "previous-window", last: "last-window", swapw: "swap-window", movew: "move-window",
    selectp: "select-pane", lastp: "last-pane", swapp: "swap-pane", rotatew: "rotate-window", breakp: "break-pane",
    resizep: "resize-pane", respawnp: "respawn-pane", respawnw: "respawn-window", displayp: "display-panes",
    lsp: "list-panes", selectl: "select-layout", layout: "select-layout", nextl: "next-layout", prevl: "previous-layout",
    clock: "clock-mode", refresh: "refresh-client", display: "display-message", detach: "detach-client",
    sync: "synchronize-panes", setw: "set-window-option", pasteb: "paste-buffer", lsb: "list-buffers",
    attach: "attach-session", switchc: "switch-client", ls: "list-sessions", has: "has-session",
    findw: "find-window", save: "save-session", lsw: "list-windows",
    capturep: "capture-pane", pipep: "pipe-pane", loadb: "load-buffer", saveb: "save-buffer", setb: "set-buffer",
    showb: "show-buffer", bind: "bind-key", unbind: "unbind-key", send: "send-keys", lscm: "list-commands",
    lsc: "list-clients", "set": "set-option", show: "show-options", lockc: "lock-client", locks: "lock-session",
    source: "source-file", start: "start-server", suspendc: "suspend-client", showmsgs: "show-messages",
    linkw: "link-window", unlinkw: "unlink-window", joinp: "join-pane", movep: "move-pane", resizew: "resize-window"
  };
  // Recognised tmux commands with no web/document meaning — reported, not "unknown".
  var TMUX_NA = {
    "capture-pane": "panes are documents — no terminal scrollback to capture",
    "pipe-pane": "no shell to pipe (panes are documents)",
    "clear-history": "no terminal scrollback in a document pane",
    "load-buffer": "file I/O is unavailable in the browser sandbox",
    "save-buffer": "file I/O is unavailable in the browser sandbox",
    "delete-buffer": "buffers are managed automatically",
    "set-buffer": "use copy-mode (C-b [) to fill the paste buffer",
    "show-buffer": "use C-b = to view/choose buffers",
    "bind-key": "remap keys on the Keyboard settings page",
    "unbind-key": "remap keys on the Keyboard settings page",
    "list-keys": "see C-b ? for the key list",
    "send-keys": "just type into the focused document",
    "send-prefix": "just type into the focused document",
    "list-commands": "press Tab here to list available commands",
    "list-clients": "the overlay is per-tab — there are no separate clients",
    "show-options": "options aren't set via CLI",
    "show-environment": "no shell environment in a document pane",
    "customize-mode": "use the Keyboard settings page",
    "lock-client": "not applicable in the browser",
    "lock-session": "not applicable in the browser",
    "source-file": "no config file — settings live in the app",
    "start-server": "the overlay is always running, per-tab",
    "suspend-client": "not applicable in the browser",
    "show-messages": "errors show inline on this prompt",
    "if-shell": "no shell to branch on",
    "run-shell": "no shell to run (panes are documents)",
    "wait-for": "not applicable",
    "link-window": "windows can't be shared across tabs",
    "unlink-window": "windows can't be shared across tabs",
    "join-pane": "cross-window pane joining isn't supported",
    "move-pane": "cross-window pane moving isn't supported",
    "resize-window": "the window always fills the viewport"
  };
  var TMUX_CMDS = ["attach-session", "break-pane", "choose-buffer", "choose-tree", "clock-mode", "copy-mode",
    "detach-client", "display-message", "display-panes", "find-window", "has-session", "kill-pane", "kill-server",
    "kill-session", "kill-window", "last-pane", "last-window", "list-buffers", "list-panes", "list-sessions",
    "list-windows", "move-window", "new-pane", "new-session", "new-window", "next-layout", "next-window",
    "paste-buffer", "previous-layout", "previous-window", "refresh-client", "rename-session", "rename-window",
    "resize-pane", "respawn-pane", "respawn-window", "rotate-window", "save-session", "select-layout",
    "select-pane", "select-window", "sessions", "split-window", "swap-pane", "swap-window", "switch-client",
    "synchronize-panes"];
  var TMUX_DESC = {
    "attach-session": "load saved session NAME", "break-pane": "pane → its own window",
    "choose-buffer": "pick a paste buffer", "choose-tree": "window list", "clock-mode": "big clock",
    "copy-mode": "scroll + select + yank text", "detach-client": "hide the overlay",
    "display-message": "flash TEXT", "display-panes": "show pane numbers", "find-window": "jump to window matching TEXT",
    "has-session": "exists? NAME", "kill-pane": "close this pane", "kill-server": "reset to one blank window",
    "kill-session": "reset to one blank window", "kill-window": "close this window", "last-pane": "previous pane",
    "last-window": "previous window", "list-buffers": "choose a paste buffer", "list-panes": "show pane numbers",
    "list-sessions": "pick a saved session", "list-windows": "window list", "move-window": "renumber to -t N",
    "new-pane": "split the pane", "new-session": "fresh blank session", "new-window": "new window [NAME]",
    "next-layout": "cycle layout", "next-window": "next window", "paste-buffer": "paste most recent",
    "previous-layout": "cycle layout", "previous-window": "previous window", "refresh-client": "redraw",
    "rename-session": "rename session [NAME]", "rename-window": "rename window [NAME]",
    "resize-pane": "-L / -R / -U / -D", "respawn-pane": "reload pane document", "respawn-window": "reload pane document",
    "rotate-window": "rotate pane positions", "save-session": "save this layout", "select-layout": "even-h/v · main-h/v · tiled",
    "select-pane": "focus -L/-R/-U/-D", "select-window": "go to window -t N", "sessions": "pick a saved session",
    "split-window": "-h side · -v down", "swap-pane": "swap with next (-U prev)", "swap-window": "swap with window -t N",
    "switch-client": "load saved session NAME", "synchronize-panes": "broadcast typing (on/off)"
  };
  var OPT_DESC = {
    "-h": "split side by side", "-v": "split stacked", "-L": "left", "-R": "right", "-U": "up / previous",
    "-D": "down", "-t": "target index / name", "on": "enable", "off": "disable",
    "synchronize-panes": "broadcast typing", "status": "show/hide the status bar"
  };
  // Bespoke prompt (NOT a zgui modal): a top-anchored .zt-cmdwrap inside the overlay
  // body, ported from ztmux.js. Anchored by its input row so the box grows DOWNWARD
  // as the list filters — the input never moves while you type. Visibility of the
  // list/msg is CSS `:empty` (no inline styles — WKWebView release strips those).
  // Commands that make sense with NO session attached (the detached command prompt
  // filters to these, and runTmuxCmd rejects anything else while detached).
  var DETACHED_CMDS = { "attach-session": 1, "switch-client": 1, "new-session": 1, "list-sessions": 1, "sessions": 1, "has-session": 1 };
  var OPTS = { "split-window": ["-h", "-v"], "new-pane": ["-h", "-v"], "select-pane": ["-L", "-R", "-U", "-D"], "resize-pane": ["-L", "-R", "-U", "-D"], "swap-pane": ["-U", "-D"], "select-window": ["-t"], "swap-window": ["-t"], "move-window": ["-t"], "attach-session": ["-t"], "switch-client": ["-t"], "has-session": ["-t"], "synchronize-panes": ["on", "off"], "set-window-option": ["synchronize-panes", "on", "off"], "set-option": ["status", "on", "off"], "select-layout": ["even-horizontal", "even-vertical", "main-horizontal", "main-vertical", "tiled"] };
  // After `-t`, tmux completes the target itself. These commands take a SESSION name
  // (from the saved layouts) vs a live WINDOW index — so `attach-session -t <Tab>` offers
  // the saved session names, `select-window -t <Tab>` offers the current window indices.
  var SESS_TARGET = { "attach-session": 1, "switch-client": 1, "has-session": 1 };
  var WIN_TARGET = { "select-window": 1, "swap-window": 1, "move-window": 1 };
  function commandPrompt() {
    // Attached: mount into the live tiling surface. Detached: show the prompt over the
    // current page WITHOUT attaching (a transparent 'cmd-only' surface) so attach-session
    // / new-session / list-sessions stay reachable with no session — like tmux.
    var detached = !open;
    // cmd-only surface: transparent, tabs/panes/dividers hidden via CSS. Do NOT clear
    // bodyEl — a detached-after-attach state keeps panes mounted-but-hidden, and wiping
    // them would destroy live pane content; CSS hides them for the duration of the prompt.
    if (detached) { ensureDom(); root.classList.add("on", "zt-cmdonly"); }
    else if (!root) { render(); }
    var back = el("div", "zt-cmdback");
    var wrap = el("div", "zt-cmdwrap");
    var row = el("div", "zt-cmdrow");
    var lbl = el("span", "zt-cmdlbl", ":");
    var inp = el("input", "zt-cmdin"); inp.autocomplete = "off"; inp.spellcheck = false;
    inp.placeholder = "tmux command — ↓ / Tab into the list, Enter to run";
    row.appendChild(lbl); row.appendChild(inp);
    var listEl = el("div", "zt-cmdlist");
    var msg = el("div", "zt-cmdmsg");
    wrap.appendChild(row); wrap.appendChild(listEl); wrap.appendChild(msg);
    back.appendChild(wrap); bodyEl.appendChild(back);
    var base = "", head = "", sug = [], sel = -1, mode = "cmd";
    function showMsg(t) { msg.textContent = t || ""; }   // .zt-cmdmsg:empty { display:none }
    function refilter() {
      base = inp.value; sel = -1; var lastSp = base.lastIndexOf(" ");
      if (lastSp < 0) { mode = "cmd"; head = ""; var q = base.toLowerCase(); sug = TMUX_CMDS.filter(function (c) { return c.indexOf(q) === 0 && (!detached || DETACHED_CMDS[c]); }); }
      else {
        mode = "opt"; head = base.slice(0, lastSp + 1);
        var toks = base.slice(0, lastSp).split(/\s+/);
        var canon = TMUX_ALIAS[toks[0].toLowerCase()] || toks[0].toLowerCase();
        var tail = base.slice(lastSp + 1).toLowerCase();
        var prev = toks[toks.length - 1];
        if (prev === "-t" && SESS_TARGET[canon]) {
          // `attach-session -t <Tab>` → the saved session names (works detached too — loadCfg ran).
          sug = SESSIONS.map(function (s) { return (s && s.name) || ""; }).filter(function (n) { return n && n.toLowerCase().indexOf(tail) === 0; });
        } else if (prev === "-t" && WIN_TARGET[canon]) {
          // `select-window -t <Tab>` → the live window indices (0..n-1).
          sug = S.windows.map(function (w, i) { return String(i); }).filter(function (n) { return n.indexOf(tail) === 0; });
        } else {
          var opts = OPTS[canon] || []; sug = opts.filter(function (o) { return o.toLowerCase().indexOf(tail) === 0; });
        }
      }
      draw();
    }
    function fill(v) { return mode === "cmd" ? v : head + v; }
    function draw() {
      listEl.textContent = "";
      sug.forEach(function (c, i) {
        var it = el("div", "zt-cmditem" + (i === sel ? " sel" : ""));
        it.appendChild(el("span", null, c));
        it.appendChild(el("span", "zt-cmddesc", (mode === "cmd" ? TMUX_DESC[c] : OPT_DESC[c]) || ""));
        it.addEventListener("mousedown", function (e) { e.preventDefault(); inp.value = fill(c); refilter(); try { inp.focus(); } catch (x) {} });
        listEl.appendChild(it);
      });   // .zt-cmdlist:empty { display:none } handles the no-suggestions case
    }
    function move(delta) { if (!sug.length) return; sel += delta; if (sel < -1) sel = sug.length - 1; else if (sel >= sug.length) sel = -1; inp.value = sel >= 0 ? fill(sug[sel]) : base; draw(); var s = listEl.querySelector(".sel"); if (s && s.scrollIntoView) s.scrollIntoView({ block: "nearest" }); }
    function onDocKey(e) { if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); close(); } }
    document.addEventListener("keydown", onDocKey, true);
    function close() { try { back.remove(); } catch (e) {} document.removeEventListener("keydown", onDocKey, true); if (detached && !open) root.classList.remove("on", "zt-cmdonly"); focusActive(); }
    inp.addEventListener("input", function () { showMsg(""); refilter(); });
    inp.addEventListener("keydown", function (e) {
      e.stopPropagation();
      if (e.key === "Escape") { e.preventDefault(); close(); }
      else if (e.key === "ArrowDown" || (e.key === "Tab" && !e.shiftKey)) { e.preventDefault(); move(1); }
      else if (e.key === "ArrowUp" || (e.key === "Tab" && e.shiftKey)) { e.preventDefault(); move(-1); }
      else if (e.key === "Enter") { e.preventDefault(); var err = runTmuxCmd(inp.value); if (err) { showMsg(err); inp.select(); } else close(); }
    });
    back.addEventListener("mousedown", function (e) { if (e.target === back) close(); });
    refilter(); setTimeout(function () { try { inp.focus(); } catch (e) {} }, 0);
  }
  function runTmuxCmd(line) {
    line = (line || "").trim(); if (!line) return null;
    var parts = line.split(/\s+/), raw = parts[0].toLowerCase(), args = parts.slice(1), rest = args.join(" ");
    function has(f) { return args.indexOf(f) >= 0; }
    function opt(f) { var i = args.indexOf(f); return i >= 0 && i + 1 < args.length ? args[i + 1] : null; }
    function tgt() { var t = opt("-t"); if (t != null) return t; return (args.length && args[0].charAt(0) !== "-") ? args[0] : null; }
    var cmd = TMUX_ALIAS[raw] || raw;
    // Detached: only session-level commands apply (attach / new / list / has).
    if (!open && !DETACHED_CMDS[cmd]) return "not attached — attach-session / new-session / list-sessions only";
    switch (cmd) {
      case "kill-window": killWindow(); break;
      case "kill-pane": closePane(); break;
      case "kill-session": case "kill-server":
        S.windows.forEach(function (win) { leaves(win.tree).forEach(function (l) { dropPane(l.id); }); });
        S.windows = [mkWindow(null)]; S.active = 0; S.last = null; S.sessId = null; S.sessName = ""; open = false; break;
      case "new-window": addWindow(); if (rest && rest.charAt(0) !== "-") W().name = rest; break;
      case "new-session":
        S.windows.forEach(function (win) { leaves(win.tree).forEach(function (l) { dropPane(l.id); }); });
        S.windows = [mkWindow(null)]; S.active = 0; S.last = null; S.sessId = null;
        S.sessName = (rest && rest.charAt(0) !== "-") ? rest : ""; open = true; break;
      case "rename-window": if (rest) W().name = rest; else { renameWindow(); return null; } break;
      case "rename-session":
        if (rest) return renameSession(rest);
        promptModal("Rename session", S.sessName || "", function (v) { renameSession(v); render(); focusActive(); }); return null;
      case "select-window": { var n = parseInt(tgt(), 10); if (isNaN(n)) return "select-window: need an index"; selectWindowNum(n); break; }
      case "next-window": cycleWindow(1); break;
      case "previous-window": cycleWindow(-1); break;
      case "last-window": lastWindow(); break;
      case "swap-window": { var n = parseInt(tgt(), 10); if (isNaN(n) || n < 0 || n >= S.windows.length) return "swap-window: need a valid index"; var a = S.active, tmp = S.windows[a]; S.windows[a] = S.windows[n]; S.windows[n] = tmp; S.active = n; break; }
      case "move-window": { var n = parseInt(tgt(), 10); if (isNaN(n)) { moveWindow(); return null; } n = Math.max(0, Math.min(S.windows.length - 1, n)); var win = S.windows.splice(S.active, 1)[0]; S.windows.splice(n, 0, win); S.active = n; break; }
      case "split-window": case "new-pane": splitPane(has("-v") ? "col" : "row"); break;
      case "select-pane": { var d = has("-L") ? "left" : has("-R") ? "right" : has("-U") ? "up" : has("-D") ? "down" : null; if (d) navDir(d); else navCycle(1); break; }
      case "last-pane": lastPane(); break;
      case "swap-pane": swapPane(has("-U") ? -1 : 1); break;
      case "rotate-window": rotatePanes(1); break;
      case "break-pane": breakPane(); break;
      case "resize-pane": { var d = has("-L") ? "left" : has("-R") ? "right" : has("-U") ? "up" : has("-D") ? "down" : null; if (!d) return "resize-pane: use -L / -R / -U / -D"; resizePane(d, 0.05); break; }
      case "respawn-pane": case "respawn-window": reloadPane(); return null;
      case "display-panes": case "list-panes": showPaneNumbers(); return null;
      case "select-layout": { var LN = { "even-horizontal": "even-h", "even-h": "even-h", "even-vertical": "even-v", "even-v": "even-v", "main-horizontal": "main-h", "main-h": "main-h", "main-vertical": "main-v", "main-v": "main-v", tiled: "tiled" }; var ln = LN[(rest || "").toLowerCase().trim()]; if (ln) setLayout(ln); else cycleLayout(); break; }
      case "next-layout": case "previous-layout": cycleLayout(); break;
      case "clock-mode": showClock(); return null;
      case "list-windows": case "choose-tree": showChooser(); return null;
      case "refresh-client": render(); return null;
      case "display-message": toast(rest || ""); return null;
      case "detach-client": open = false; render(); return null;
      case "copy-mode": enterCopyMode(); return null;
      case "paste-buffer": pasteBuffer(); return null;
      case "list-buffers": case "choose-buffer": showBuffers(); return null;
      case "set-option": case "set-window-option": case "synchronize-panes": {
        // `set status on|off|toggle` hides/shows the status bar (and reclaims its strip).
        if (cmd !== "synchronize-panes" && /\bstatus\b/.test(rest)) {
          setStatusVisible(/\boff\b/.test(rest) ? false : /\bon\b/.test(rest) ? true : null); return null;
        }
        if (cmd === "set-option") return "set-option: `status on|off` (other options are N/A — panes are web pages)";
        if (cmd === "set-window-option" && !/synchronize-panes/.test(rest)) return "set-window-option: only synchronize-panes / status applies";
        var on = /\bon\b/.test(rest), off = /\boff\b/.test(rest), ww2 = W(), ls2 = leaves(ww2.tree);
        if (on) ww2.syncPanes = ls2.map(function (l) { return l.id; });
        else if (off) ww2.syncPanes = [];
        else { toggleSync(); break; }
        toast(syncActive(ww2) ? "synchronize-panes ON" : "synchronize-panes off"); break; }
      case "find-window": { var q = (rest || "").toLowerCase(); if (!q) return "find-window: need text"; var idx = -1; for (var i = 0; i < S.windows.length; i++) { var ww = S.windows[i]; if ((ww.name || "").toLowerCase().indexOf(q) >= 0 || leaves(ww.tree).some(function (l) { return paneLabelOf(l).toLowerCase().indexOf(q) >= 0; })) { idx = i; break; } } if (idx < 0) return "no window matches: " + rest; selectWindowNum(idx); break; }
      case "attach-session": case "switch-client": { var nm = tgt(); if (!nm) return cmd + ": need a session name"; loadSessionByName(nm); return null; }
      case "list-sessions": case "sessions": chooseSession(); return null;
      case "has-session": { var nm = tgt(); if (!nm) return "has-session: need a name"; toast(sessionExists(nm) ? 'session "' + nm + '" exists' : 'no session "' + nm + '"'); return null; }
      case "save-session": if (rest) { saveSessionNamed(rest); toast('saved session "' + rest + '"'); } else saveCurrentSession(); return null;
      default:
        if (TMUX_NA[cmd]) return cmd + ": N/A — " + TMUX_NA[cmd];
        return "unknown command: " + cmd;
    }
    render(); focusActive(); return null;
  }

  // ------------------------------------------------------------------ sessions
  // A saved session = windows[] -> panes[] -> ref (the host's opaque, JSON-
  // serializable pane reference). Persisted in prefs 'tmuxSessions'; loading
  // rebuilds the tiling tree (auto-tiled via buildEven).
  function sessionSnapshot() {
    return S.windows.map(function (win) { return { name: win.name || "", panes: leaves(win.tree).map(function (l) { return l.doc || null; }) }; });
  }
  function windowFromPanes(name, ps) {
    var list = (ps && ps.length ? ps : [null]).map(function (p) { return leaf(p || null); });
    return { id: nid("w"), name: name || "", tree: buildEven(list, "row"), active: list[0].id, zoom: null, layout: "", marked: null, last: null };
  }
  function applySession(sess) {
    if (!sess || !sess.windows || !sess.windows.length) return;
    S.windows.forEach(function (win) { leaves(win.tree).forEach(function (l) { dropPane(l.id); }); });
    S.windows = sess.windows.map(function (w) { return windowFromPanes(w.name, w.panes); });
    S.active = 0; S.last = null; open = true; S.sessId = sess.id || null; S.sessName = sess.name || "";
    render(); focusActive();
    setStatusVisible(true);   // attaching a session forces the powerline on so the reserved 22px strip is filled (no empty gap)
  }
  function loadSessionById(id) { for (var i = 0; i < SESSIONS.length; i++) if (SESSIONS[i].id === id) { applySession(SESSIONS[i]); return; } }
  function sessionExists(name) { var lc = String(name).toLowerCase(); return SESSIONS.some(function (s) { return String(s.name).toLowerCase() === lc; }); }
  // :rename-session — rename the live saved session (or create one from the current layout).
  function renameSession(name) {
    name = (name || "").trim(); if (!name) return null;
    S.sessName = name; var found = false;
    if (S.sessId) for (var i = 0; i < SESSIONS.length; i++) if (SESSIONS[i].id === S.sessId) { SESSIONS[i].name = name; found = true; break; }
    if (!found) { var id = newSessionId(); SESSIONS.unshift({ id: id, name: name, windows: sessionSnapshot() }); S.sessId = id; }
    loadSessHotkeys(); savePrefs(function (p) { p.tmuxSessions = SESSIONS; }); return null;
  }
  // :set status on|off|toggle — hide/show the shared powerline and reclaim/relinquish
  // the strip the overlay reserves for it. Consumers may persist via CFG.setStatus.
  function setStatusVisible(want) {
    var z = ZG(), vis = null;
    try { if (z.powerline && z.powerline.visible) vis = z.powerline.visible(); } catch (e) {}
    if (want == null) want = (vis == null) ? false : !vis;
    try { if (z.powerline && z.powerline.toggle && vis != null && vis !== want) z.powerline.toggle(); } catch (e) {}
    if (root) root.style.bottom = want ? "" : "0";
    try { if (CFG.setStatus) CFG.setStatus(want); } catch (e) {}
  }
  function loadSessionByName(name) {
    var lc = String(name).toLowerCase(), hit = null;
    for (var i = 0; i < SESSIONS.length; i++) if (String(SESSIONS[i].name).toLowerCase() === lc) { hit = SESSIONS[i]; break; }
    if (!hit) for (var j = 0; j < SESSIONS.length; j++) if (String(SESSIONS[j].name).toLowerCase().indexOf(lc) >= 0) { hit = SESSIONS[j]; break; }
    if (hit) applySession(hit); else toast('no session named "' + name + '"');
  }
  function newSessionId() { return "s" + uid.toString(36) + "-" + (S.windows.length) + "-" + (SESSIONS.length + 1); }
  function saveSessionNamed(name) {
    name = (name || "").trim(); if (!name) return;
    var id = newSessionId();
    SESSIONS.unshift({ id: id, name: name, windows: sessionSnapshot() });
    S.sessId = id; S.sessName = name; loadSessHotkeys();
    savePrefs(function (p) { p.tmuxSessions = SESSIONS; });
  }
  function saveCurrentSession() { promptModal("Save current layout as session", S.sessName || "", function (name) { saveSessionNamed(name); }); }
  function chooseSession() {
    if (!SESSIONS.length) { toast("no saved sessions — Ctrl-b S to save one, Ctrl-b M to manage"); return; }
    var rows = SESSIONS.map(function (s, i) { var np = (s.windows || []).reduce(function (a, w) { return a + ((w.panes || []).length || 0); }, 0); return { label: i + ": " + (s.name || "(unnamed)") + "  (" + (s.windows || []).length + " win · " + np + " panes)" }; });
    listModal("sessions — ↑/↓ or j/k, Enter to load", rows, function (i) { if (SESSIONS[i]) applySession(SESSIONS[i]); });
  }

  // ---------------------------------------------------------- layout editor
  // A full manager UI for the saved sessions above — ported from zwire's HUD
  // "sessions" page into the shared component so every tmux consumer gets it (no
  // per-app page). Snapshot / new / rename / duplicate / delete / import / export
  // layouts, edit their window+pane structure, bind a C-b <key> hotkey, and Load
  // one live. Pane CONTENT is host-opaque: CFG.paneLabel renders each pane's ref,
  // and a host that also provides CFG.pickPaneRef() -> Promise<ref|null> gets a
  // per-pane "set…" button for in-editor content editing (progressive enhancement;
  // without it, panes are structural — add/remove/reorder/empty, filled live after
  // Load via the normal empty-pane chooser).
  var edEditingId = null, edHandle = null, edBody = null;
  function edUid() { return "s" + Date.now().toString(36) + "-" + Math.floor(Math.random() * 1e6).toString(36); }
  function edStamp() { return Date.now(); }
  // Auto-suffix a name so saved layouts never collide: "tommy" → "tommy 2" → "tommy 3" …
  // (case-insensitive). `skip` is an optional session to ignore (its own name, e.g. on rename).
  function edUniqueName(base, skip) {
    base = String(base == null ? "" : base).trim() || "layout";
    var taken = {};
    SESSIONS.forEach(function (s) { if (s !== skip) taken[String(s.name || "").toLowerCase()] = true; });
    if (!taken[base.toLowerCase()]) return base;
    for (var n = 2; ; n++) { var cand = base + " " + n; if (!taken[cand.toLowerCase()]) return cand; }
  }
  function edTouch(s) { s.updated = edStamp(); }
  function edPaneCount(s) { return (s.windows || []).reduce(function (n, w) { return n + ((w.panes || []).length || 0); }, 0); }
  function edWhen(t) { if (!t) return ""; try { return new Date(t).toLocaleString(); } catch (e) { return ""; } }
  function edRefLabel(ref) { if (ref == null) return "empty"; try { return (CFG.paneLabel && CFG.paneLabel(ref)) || "pane"; } catch (e) { return "pane"; } }
  function edBuiltinKey(k) { for (var i = 0; i < ACTIONS.length; i++) if (ACTIONS[i].def === k) return ACTIONS[i].label; return null; }
  function edPersist() { loadSessHotkeys(); savePrefs(function (p) { p.tmuxSessions = SESSIONS; }); }
  function edAskText(title, value) {
    var z = ZG(); if (z.modal && z.modal.prompt) return z.modal.prompt({ title: title, value: value == null ? "" : String(value) });
    return Promise.resolve(window.prompt(title, value || ""));
  }
  function edAskConfirm(title, message) {
    var z = ZG(); if (z.modal && z.modal.confirm) return z.modal.confirm({ title: title, message: message });
    return Promise.resolve(window.confirm(message || title));
  }

  // Preview geometry — mirrors windowFromPanes()'s buildEven(list,"row") EXACTLY so
  // the SVG shows precisely what Load will render. Keep in lockstep with buildEven.
  function edTileRects(n, x, y, w, h) {
    if (n <= 1) return [{ x: x, y: y, w: w, h: h }];
    var mid = Math.ceil(n / 2), wa = w * (mid / n);
    return edTileRects(mid, x, y, wa, h).concat(edTileRects(n - mid, x + wa, y, w - wa, h));
  }
  function edSvg(panes, W, H) {
    var n = Math.max(1, (panes || []).length), pad = 3;
    var out = ['<svg class="zt-le-svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" xmlns="http://www.w3.org/2000/svg">'];
    edTileRects(n, 0, 0, W, H).forEach(function (r, i) {
      var x = r.x + pad / 2, y = r.y + pad / 2, w = Math.max(1, r.w - pad), hh = Math.max(1, r.h - pad);
      out.push('<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + w.toFixed(1) + '" height="' + hh.toFixed(1) + '" rx="2" class="zt-le-svgpane"/>');
      out.push('<text x="' + (x + w / 2).toFixed(1) + '" y="' + (y + hh / 2).toFixed(1) + '" text-anchor="middle" dominant-baseline="central" class="zt-le-svgnum">' + i + '</text>');
    });
    out.push("</svg>");
    var d = el("div", "zt-le-svgwrap"); d.innerHTML = out.join(""); return d;
  }
  function edButton(label, cls, onClick, disabled) {
    var b = el("button", "zt-le-btn" + (cls ? " " + cls : ""), label);
    b.type = "button"; if (disabled) b.disabled = true;
    b.addEventListener("click", function (e) { e.preventDefault(); onClick(); });
    return b;
  }
  function edField(cls, value, ph, onCommit, maxLen) {
    var i = el("input", "zt-le-in" + (cls ? " " + cls : "")); i.value = value || ""; if (ph) i.placeholder = ph; if (maxLen) i.maxLength = maxLen;
    i.addEventListener("change", function () { onCommit(i.value); });
    i.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); i.blur(); } });
    return i;
  }
  function edMove(arr, i, dir) { var j = i + dir; if (j < 0 || j >= arr.length) return false; var t = arr[i]; arr[i] = arr[j]; arr[j] = t; return true; }

  // --- session-level ops (operate on the shared SESSIONS array + persist) ---
  function edNewBlank() {
    edAskText("New layout — name", "layout").then(function (name) {
      if (name == null) return;
      var s = { id: edUid(), name: edUniqueName(name.trim() || "layout"), created: edStamp(), updated: edStamp(), windows: [{ name: "", panes: [null] }] };
      SESSIONS.unshift(s); edEditingId = s.id; edPersist(); edPaint();
    });
  }
  function edSnapshotCurrent() {
    edAskText("Snapshot current layout — name", S.sessName || "layout").then(function (name) {
      if (name == null) return;
      var s = { id: edUid(), name: edUniqueName(name.trim() || "layout"), created: edStamp(), updated: edStamp(), windows: sessionSnapshot() };
      SESSIONS.unshift(s); S.sessId = s.id; S.sessName = s.name; edPersist(); edPaint();
    });
  }
  function edRename(s) {
    edAskText("Rename layout", s.name).then(function (name) {
      if (name == null) return; s.name = edUniqueName(name.trim() || s.name, s); edTouch(s); edPersist(); edPaint();
    });
  }
  function edDuplicate(s) {
    var copy = JSON.parse(JSON.stringify(s));
    copy.id = edUid(); copy.name = edUniqueName(s.name + " copy"); copy.hotkey = ""; copy.created = copy.updated = edStamp();
    var i = SESSIONS.indexOf(s); SESSIONS.splice(i + 1, 0, copy); edPersist(); edPaint();
  }
  function edDelete(s) {
    edAskConfirm("Delete layout", 'Delete "' + s.name + '"? This cannot be undone.').then(function (ok) {
      if (!ok) return; var i = SESSIONS.indexOf(s); if (i >= 0) SESSIONS.splice(i, 1);
      if (edEditingId === s.id) edEditingId = null; edPersist(); edPaint();
    });
  }
  function edLoad(s) { if (edHandle) edHandle.close(); applySession(s); }

  // --- window / pane structure ops ---
  function edAddWindow(s) { s.windows.push({ name: "", panes: [null] }); edTouch(s); edPersist(); edPaint(); }
  function edDelWindow(s, wi) { s.windows.splice(wi, 1); if (!s.windows.length) s.windows.push({ name: "", panes: [null] }); edTouch(s); edPersist(); edPaint(); }
  function edMoveWindow(s, wi, dir) { if (edMove(s.windows, wi, dir)) { edTouch(s); edPersist(); edPaint(); } }
  function edAddPane(s, w) { w.panes.push(null); edTouch(s); edPersist(); edPaint(); }
  function edDelPane(s, w, pi) { w.panes.splice(pi, 1); if (!w.panes.length) w.panes.push(null); edTouch(s); edPersist(); edPaint(); }
  function edMovePane(s, w, pi, dir) { if (edMove(w.panes, pi, dir)) { edTouch(s); edPersist(); edPaint(); } }
  function edSetPane(s, w, pi) {
    if (!CFG.pickPaneRef) return;
    try {
      Promise.resolve(CFG.pickPaneRef(w.panes[pi])).then(function (ref) {
        if (ref === undefined) return; w.panes[pi] = ref || null; edTouch(s); edPersist(); edPaint();
      });
    } catch (e) {}
  }

  // --- import / export ---
  function edExportAll() {
    try {
      var blob = new Blob([JSON.stringify(SESSIONS, null, 2)], { type: "application/json" });
      var a = el("a"); a.href = URL.createObjectURL(blob); a.download = "tmux-layouts.json";
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(function () { try { URL.revokeObjectURL(a.href); } catch (e) {} }, 4000);
    } catch (e) { toast("export failed: " + e, "error"); }
  }
  function edImport() {
    var inp = el("input"); inp.type = "file"; inp.accept = ".json,application/json";
    inp.addEventListener("change", function () {
      var f = inp.files && inp.files[0]; if (!f) return;
      var r = new FileReader();
      r.onload = function () {
        try {
          var arr = JSON.parse(r.result); if (!Array.isArray(arr)) throw new Error("not an array");
          var added = 0;
          arr.forEach(function (s) {
            if (!s || !Array.isArray(s.windows)) return;
            SESSIONS.push({ id: edUid(), name: edUniqueName(String(s.name || "imported")), hotkey: (s.hotkey ? String(s.hotkey).slice(0, 1) : ""), created: edStamp(), updated: edStamp(),
              windows: s.windows.map(function (w) { return { name: String((w && w.name) || ""), panes: ((w && w.panes) || []).map(function (p) { return p == null ? null : p; }) }; }) });
            added++;
          });
          edPersist(); edPaint(); toast("imported " + added + " layout" + (added === 1 ? "" : "s"));
        } catch (e) { toast("import failed: " + e.message, "error"); }
      };
      r.readAsText(f);
    });
    inp.click();
  }

  // --- render ---
  function edRenderEditor(s) {
    var box = el("div", "zt-le-editor");
    s.windows.forEach(function (w, wi) {
      var win = el("div", "zt-le-window");
      var whead = el("div", "zt-le-whead");
      whead.appendChild(el("span", "zt-le-wtag", "WIN " + wi));
      whead.appendChild(edField("zt-le-wname", w.name || "", "window " + wi + " name", function (v) { w.name = v.trim(); edTouch(s); edPersist(); }));
      whead.appendChild(edButton("+ pane", "mini", function () { edAddPane(s, w); }));
      whead.appendChild(edButton("▲", "mini", function () { edMoveWindow(s, wi, -1); }, wi === 0));
      whead.appendChild(edButton("▼", "mini", function () { edMoveWindow(s, wi, 1); }, wi === s.windows.length - 1));
      whead.appendChild(edButton("remove window", "mini", function () { edDelWindow(s, wi); }));
      win.appendChild(whead);
      win.appendChild(edSvg(w.panes, 168, 92));
      w.panes.forEach(function (p, pi) {
        var row = el("div", "zt-le-pane");
        row.appendChild(el("span", "zt-le-ptag", String(pi)));
        row.appendChild(el("span", "zt-le-plabel", edRefLabel(p)));
        if (CFG.pickPaneRef) row.appendChild(edButton("set…", "mini", function () { edSetPane(s, w, pi); }));
        row.appendChild(edButton("▲", "mini", function () { edMovePane(s, w, pi, -1); }, pi === 0));
        row.appendChild(edButton("▼", "mini", function () { edMovePane(s, w, pi, 1); }, pi === w.panes.length - 1));
        row.appendChild(edButton("✕", "mini danger", function () { edDelPane(s, w, pi); }));
        win.appendChild(row);
      });
      box.appendChild(win);
    });
    var foot = el("div", "zt-le-efoot"); foot.appendChild(edButton("+ window", "mini", function () { edAddWindow(s); }));
    box.appendChild(foot);
    return box;
  }
  function edPaint() {
    if (!edBody) return;
    edBody.innerHTML = "";
    var bar = el("div", "zt-le-toolbar");
    bar.appendChild(edButton("Snapshot current layout", "primary", edSnapshotCurrent));
    bar.appendChild(edButton("New blank", "mini", edNewBlank));
    bar.appendChild(edButton("Import", "mini", edImport));
    bar.appendChild(edButton("Export all", "mini", edExportAll, !SESSIONS.length));
    edBody.appendChild(bar);
    if (!SESSIONS.length) {
      var empty = el("div", "zt-le-empty");
      empty.appendChild(el("p", null, "No saved layouts yet."));
      empty.appendChild(el("p", "zt-le-hint", "Snapshot the current layout above, or press the tmux prefix then S in the overlay."));
      edBody.appendChild(empty); return;
    }
    SESSIONS.forEach(function (s) {
      var card = el("div", "zt-le-card");
      var head = el("div", "zt-le-head");
      var title = el("div", "zt-le-title");
      title.appendChild(el("span", "zt-le-name", s.name || "(unnamed)"));
      var hkWrap = el("label", "zt-le-hotkey"); hkWrap.appendChild(el("span", "zt-le-hklbl", "C-b"));
      var hk = edField("zt-le-hkin", s.hotkey || "", "·", function () {}, 1);
      hk.title = "Shortcut: press the tmux prefix then this key to load this layout (overrides the built-in on that key). Case-sensitive.";
      var hkWarn = el("span", "zt-le-hkwarn");
      function updWarn() { var b = s.hotkey && edBuiltinKey(s.hotkey); hkWarn.textContent = b ? ("↳ overrides " + b) : ""; }
      hk.addEventListener("change", function () { s.hotkey = (hk.value || "").trim().slice(0, 1); edTouch(s); edPersist(); updWarn(); });
      updWarn();
      hkWrap.appendChild(hk); hkWrap.appendChild(hkWarn); title.appendChild(hkWrap);
      title.appendChild(el("span", "zt-le-meta", (s.windows || []).length + " win · " + edPaneCount(s) + " pane" + (edPaneCount(s) === 1 ? "" : "s") + (s.updated ? " · " + edWhen(s.updated) : "")));
      head.appendChild(title);
      var acts = el("div", "zt-le-acts");
      acts.appendChild(edButton("Load", "primary", function () { edLoad(s); }));
      acts.appendChild(edButton(edEditingId === s.id ? "Done" : "Edit", "mini", function () { edEditingId = edEditingId === s.id ? null : s.id; edPaint(); }));
      acts.appendChild(edButton("Rename", "mini", function () { edRename(s); }));
      acts.appendChild(edButton("Duplicate", "mini", function () { edDuplicate(s); }));
      acts.appendChild(edButton("Delete", "mini danger", function () { edDelete(s); }));
      head.appendChild(acts);
      card.appendChild(head);
      var prev = el("div", "zt-le-preview");
      (s.windows || []).forEach(function (w, wi) {
        var cell = el("div", "zt-le-prevcell");
        cell.appendChild(edSvg(w.panes, 96, 58));
        cell.appendChild(el("span", "zt-le-prevlabel", (w.name && w.name.trim()) ? w.name : ("win " + wi)));
        prev.appendChild(cell);
      });
      card.appendChild(prev);
      if (edEditingId === s.id) card.appendChild(edRenderEditor(s));
      edBody.appendChild(card);
    });
  }
  function openSessionEditor() {
    var z = ZG(); if (!z.modal || !z.modal.open) { chooseSession(); return; }
    edBody = el("div", "zt-le");
    edHandle = z.modal.open({ title: "Saved layouts — editor", body: edBody, dismissable: true, className: "zg-le-modal", id: "zg-tmux-layouts", onClose: function () { edHandle = null; edBody = null; } });
    edPaint();
  }

  // ------------------------------------------------------------------ persist
  // Snapshot the live layout to sessionStorage so a host-page reload restores it.
  var SS_KEY = "zg-tmux-session-v1";
  function persist() {
    try {
      var snap = { uid: uid, open: open, active: S.active, sessId: S.sessId, sessName: S.sessName, buffers: buffers, windows: S.windows.map(function (win) { return { id: win.id, name: win.name, layout: win.layout, active: win.active, syncPanes: win.syncPanes || [], tree: win.tree }; }) };
      sessionStorage.setItem(SS_KEY, JSON.stringify(snap));
    } catch (e) {}
  }
  function restore() {
    try {
      var raw = sessionStorage.getItem(SS_KEY); if (!raw) return;
      var d = JSON.parse(raw); if (!d || !d.windows || !d.windows.length) return;
      S.windows = d.windows.map(function (w) { return { id: w.id, name: w.name || "", tree: w.tree, active: w.active, zoom: null, layout: w.layout || "", marked: null, last: null }; });
      S.active = Math.min(d.active || 0, S.windows.length - 1); uid = d.uid || uid; S.sessId = d.sessId || null; S.sessName = d.sessName || "";
      if (d.open) { open = true; render(); focusActive(); }
    } catch (e) {}
  }

  // ------------------------------------------------------------------ boot / API
  function toggle() { if (open) { open = false; render(); } else openOverlay(); }
  function openOverlay() { open = true; render(); focusActive(); }

  var inited = false;
  async function boot() {
    await loadCfg();
    restore();
    publishStatus();   // seed the powerline (handles restore-with-open + late powerline load)
  }
  // Host wires pane content + prefs here; first call boots (loads prefs, restores a
  // persisted session). Calling open()/toggle() before init() still works — panes
  // stay empty until a provider is set.
  function init(cfg) {
    CFG = cfg || {};
    if (!inited) {
      inited = true; boot();
      // Announce that this app uses tmux, so the appShell can (re)surface its
      // tmux-gated ⌘K commands (e.g. "Toggle status bar") even if it built its
      // palette before this init() ran.
      try { document.dispatchEvent(new CustomEvent("zgui:tmux-inited")); } catch (e) {}
    } else { loadCfg(); }
    return api;
  }
  // External-feed API for non-same-document consumers (e.g. zwire, whose panes are
  // cross-origin iframes so the prefix is pressed INSIDE a pane, not on the top
  // document our keydown listener watches). The pane forwarder posts the prefix +
  // the post-prefix key up; the host relays them here:
  //   prefix()      → arm the overlay (lights the indicator)
  //   key(k, mods)  → run the post-prefix command k (same as an armed keypress)
  //   relaySync(srcBody, key) → broadcast a synced pane's keystroke to its peers
  //   yank(text)    → push text to the paste-buffer ring
  function feedKey(k, mods) { exec(k, mods || {}); }
  function relaySyncFrom(srcBody, key) {
    var w = W(), srcId = null; leaves(w.tree).forEach(function (l) { var p = panes[l.id]; if (p && p.body === srcBody) srcId = l.id; });
    // Panes forward typing unconditionally; the sync group is authoritative HERE, so
    // only rebroadcast when the source pane is actually a member.
    if (srcId && paneSynced(w, srcId)) broadcastKey(srcId, key);
  }
  //   syncOf(srcBody) → is the pane owning srcBody in the sync group? A (re)loaded pane's
  //   forwarder asks this (its 'load' can race our push), so the host relays setSync back.
  function syncOfBody(srcBody) {
    var w = W(), res = false; leaves(w.tree).forEach(function (l) { var p = panes[l.id]; if (p && p.body === srcBody) res = paneSynced(w, l.id); }); return res;
  }
  var api = {
    init: init, open: openOverlay, toggle: toggle, isOpen: function () { return open; }, status: tmuxStatus,
    prefix: armTop, key: feedKey, relaySync: relaySyncFrom, syncOf: syncOfBody, yank: pushBuffer,
    suppressKeys: suppressKeys,
    // Show/hide the status bar (powerline + the consumer's own bar via CFG.setStatus).
    // No argument toggles. Lets a ⌘K palette command drive the same path as `:set status`.
    setStatus: function (want) { setStatusVisible(want); },
    // Open the saved-layouts manager (create / snapshot / rename / duplicate / delete /
    // import / export / hotkey / structural edit / load). Lets a ⌘K palette command open
    // the same editor as the `M` post-prefix key.
    editSessions: function () { openSessionEditor(); },
    // Attach a saved session by id (rebuild the tiling tree + open). Lets an external
    // driver — the HUD Sessions page relaying via the background → tabs.sendMessage —
    // open a fresh tab and load a whole layout into it without a keypress.
    loadSession: function (id) { loadSessionById(id); },
    // True once a host has called init() — i.e. this app actually USES tmux. The
    // appShell gates its "Toggle status bar" ⌘K command on this so non-tmux zgui
    // apps don't get a command that toggles a bar they don't have.
    isInited: function () { return inited; }
  };
  // Self-inject this component's stylesheet once, so it works from the JS alone (no
  // manifest/all.css step needed). Idempotent + prepended so a consumer's own CSS wins.
  (function(){var _c="/* tmux mode — overlay geometry + absolute-position tiling. Dialogs/toasts/tabs come\n * from zgui-core (ZGui.modal / .toast / .buttonBar); this file positions the\n * full-screen tiling surface, its absolutely-tiled panes + draggable dividers, and\n * the per-pane chrome. Themed with the shared scheme vars (--bg-primary/--cyan/…) so\n * it tracks the active colour scheme + light/dark like the rest of the app. */\n\n#zg-tmux {\n  position: fixed;\n  top: 0; left: 0; right: 0;\n  bottom: 22px;                  /* leave the bottom 22px for the powerline status bar (like zwire's ztmux reserve) */\n  z-index: 8500;                 /* above app chrome + the vim status bar (8000); below the appShell ⌘K palette (9998), zgui modals (25000) and toasts (30000) so those render over it. Documents open via the native picker / in-overlay recents, not the file-browser overlay. */\n  display: none;\n  flex-direction: column;\n  background: var(--bg-primary, #05060a);\n  color: var(--text, #c8d2e0);\n  font-family: \"Share Tech Mono\", Monaco, monospace;\n}\n#zg-tmux.on { display: flex; }\n\n/* detached command-only surface: the : prompt floats over the page, no tiling chrome */\n#zg-tmux.zt-cmdonly { background: transparent; }\n#zg-tmux.zt-cmdonly .zt-tabs,\n#zg-tmux.zt-cmdonly .zt-pane,\n#zg-tmux.zt-cmdonly .zt-div { display: none; }\n\n/* top window-tab strip (a zgui button bar; we only tune the active-tab look) */\n#zg-tmux .zt-tabs {\n  display: flex;\n  align-items: stretch;\n  gap: 2px;\n  height: 30px;\n  flex-shrink: 0;\n  padding: 0 6px;\n  background: var(--bg-card, #0a0d16);\n  border-bottom: 1px solid var(--cyan, #05d9e8);\n  overflow-x: auto;\n}\n#zg-tmux .zt-tab { white-space: nowrap; }\n#zg-tmux .zt-tab.act {\n  color: var(--bg-primary, #05060a);\n  background: var(--cyan, #05d9e8);\n  box-shadow: 0 0 12px var(--cyan-glow, rgba(5, 217, 232, .4));\n}\n\n/* the tiling surface — panes + dividers are absolutely positioned within it */\n#zg-tmux .zt-body { position: relative; flex: 1; min-height: 0; overflow: hidden; }\n\n/* draggable split dividers (own drag; a shield keeps mousemove out of the iframes) */\n#zg-tmux .zt-div { position: absolute; z-index: 6; background: transparent; transition: background .1s; }\n#zg-tmux .zt-div:hover { background: var(--cyan, #05d9e8); box-shadow: 0 0 8px var(--cyan-glow, rgba(5, 217, 232, .5)); }\n#zg-tmux .zt-div-v { width: 8px; transform: translateX(-4px); cursor: col-resize; }\n#zg-tmux .zt-div-h { height: 8px; transform: translateY(-4px); cursor: row-resize; }\n#zg-tmux .zt-shield { position: absolute; inset: 0; z-index: 50; }\n\n/* a pane (document tile) — absolutely positioned; left/top/width/height set inline in % by layout() */\n#zg-tmux .zt-pane {\n  position: absolute;\n  display: flex;\n  flex-direction: column;\n  min-width: 0;\n  min-height: 0;\n  overflow: hidden;\n  box-sizing: border-box;\n  border: 1px solid var(--border, #1a2436);\n  background: var(--bg-primary, #05060a);\n  outline: none;\n}\n#zg-tmux .zt-pane.act {\n  border-color: var(--cyan, #05d9e8);\n  box-shadow: inset 0 0 0 1px var(--cyan, #05d9e8), 0 0 16px var(--cyan-glow, rgba(5, 217, 232, .35));\n}\n#zg-tmux .zt-pane.zt-mark { border-color: var(--accent, #ff2a6d); }\n/* panes in the synchronize-panes group */\n#zg-tmux .zt-pane.zt-synced { border-color: var(--cyan, #05d9e8); }\n#zg-tmux .zt-pane.zt-synced .zt-ttl::after { content: \"⇄\"; color: var(--cyan, #05d9e8); margin-left: auto; }\n\n/* copy-mode: indicator banner + synthetic caret (position:fixed, viewport-anchored) */\n.zt-copy-ind {\n  position: fixed; top: 6px; left: 50%; transform: translateX(-50%); z-index: 26000;\n  background: var(--accent, #ff2a6d); color: var(--bg-primary, #05060a);\n  padding: 3px 10px; border-radius: 3px; font: 12px \"Share Tech Mono\", monospace;\n  white-space: nowrap; max-width: 96vw; overflow: hidden; text-overflow: ellipsis; pointer-events: none;\n}\n.zt-copy-cur {\n  position: fixed; width: 2px; z-index: 25999; pointer-events: none;\n  background: var(--cyan, #05d9e8); box-shadow: 0 0 6px var(--cyan, #05d9e8);\n  animation: ztcurbl 1s steps(1) infinite;\n}\n\n#zg-tmux .zt-ttl {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  height: 24px;\n  flex-shrink: 0;\n  padding: 0 8px;\n  font-size: 11px;\n  color: var(--text-muted, #7d8aa0);\n  background: var(--bg-card, #0a0d16);\n  border-bottom: 1px solid var(--border, #1a2436);\n}\n#zg-tmux .zt-pane.act .zt-ttl { color: var(--cyan, #05d9e8); }\n#zg-tmux .zt-pane.zt-mark .zt-ttl::before { content: \"◆ \"; color: var(--accent, #ff2a6d); }\n#zg-tmux .zt-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\n#zg-tmux .zt-x { cursor: pointer; color: var(--accent, #ff2a6d); padding: 0 2px; }\n\n/* the pane's document render surface — hosts whatever app.js setMain produced */\n#zg-tmux .zt-pane-body { flex: 1; min-height: 0; overflow: auto; position: relative; }\n\n/* empty-pane chooser */\n#zg-tmux .zt-chooser { padding: 16px; display: flex; flex-direction: column; gap: 12px; }\n#zg-tmux .zt-chooser-head { color: var(--text-muted, #5a6b82); letter-spacing: 1px; font-size: 12px; }\n#zg-tmux .zt-chooser-tiles { min-height: 0; }\n\n/* pane-number badges (C-b q) */\n#zg-tmux .zt-pnum {\n  position: absolute;\n  inset: 24px 0 0 0;\n  z-index: 40;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  font-size: 56px;\n  font-weight: 700;\n  color: var(--cyan, #05d9e8);\n  background: rgba(0, 0, 0, .35);\n  text-shadow: 0 0 16px var(--cyan-glow, rgba(5, 217, 232, .6));\n  pointer-events: none;\n}\n\n/* ---- content inside zgui modals (help / list chooser / clock / command CLI) ---- */\n.zt-help-grid { columns: 2; column-gap: 28px; font-size: 13px; line-height: 1.8; }\n.zt-help-row { break-inside: avoid; }\n.zt-help-row kbd {\n  display: inline-block; min-width: 1.4em; text-align: center;\n  padding: 1px 5px; border: 1px solid var(--border, #1a2436); border-radius: 3px;\n  background: var(--bg-card, #0a0d16); color: var(--cyan, #05d9e8); font-size: 11px;\n}\n.zt-help-note { margin-top: 12px; opacity: .7; font-size: 12px; line-height: 1.6; }\n.zt-clock { font-size: 64px; letter-spacing: 4px; text-align: center; color: var(--cyan, #05d9e8); text-shadow: 0 0 18px var(--cyan-glow, rgba(5, 217, 232, .6)); }\n\n.zt-list { min-width: 380px; }\n.zt-lrow { padding: 6px 10px; cursor: pointer; border-radius: 3px; }\n.zt-lrow:hover, .zt-lrow.sel { background: var(--cyan, #05d9e8); color: var(--bg-primary, #05060a); }\n\n/* command prompt (C-b :) — ported verbatim from zwire's ztmux.js. Anchored by its\n   TOP (the input row) so the box grows/shrinks DOWNWARD as the list changes — the\n   input never moves while you type. top:72% ≈ a quarter up from the bottom. */\n#zg-tmux .zt-cmdback { position: absolute; inset: 0; z-index: 70; }\n#zg-tmux .zt-cmdwrap {\n  position: absolute; left: 50%; top: 72%; transform: translateX(-50%); width: min(560px, 82%);\n  display: flex; flex-direction: column; background: var(--bg-card, #0a0d16); border: 1px solid var(--cyan, #05d9e8);\n  border-radius: 6px; box-shadow: 0 0 44px var(--cyan-glow, rgba(5, 217, 232, .4)); overflow: hidden;\n}\n#zg-tmux .zt-cmdrow { display: flex; align-items: center; gap: 8px; padding: 10px 14px; }\n#zg-tmux .zt-cmdlbl { color: var(--cyan, #05d9e8); font-weight: 700; font-size: 16px; }\n#zg-tmux .zt-cmdin { flex: 1; min-width: 0; background: transparent; border: none; outline: none; color: var(--text, #c8d2e0); font: inherit; font-size: 15px; }\n#zg-tmux .zt-cmdin::placeholder { color: var(--text-muted, #5a6b82); }\n#zg-tmux .zt-cmdlist { max-height: min(240px, 22vh); overflow-y: auto; border-top: 1px solid var(--border, #1a2233); }\n#zg-tmux .zt-cmdlist:empty { display: none; border-top: none; }\n#zg-tmux .zt-cmditem { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 6px 14px; cursor: pointer; font-size: 13px; color: var(--text, #c8d2e0); }\n#zg-tmux .zt-cmditem .zt-cmddesc { color: var(--text-muted, #5a6b82); font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }\n#zg-tmux .zt-cmditem:hover { background: rgba(5, 217, 232, .08); }\n#zg-tmux .zt-cmditem.sel { background: var(--cyan, #05d9e8); color: var(--bg-primary, #05060a); }\n#zg-tmux .zt-cmditem.sel .zt-cmddesc { color: var(--bg-primary, #05060a); opacity: .75; }\n#zg-tmux .zt-cmdmsg { padding: 7px 14px; color: var(--magenta, #ff2e97); font-size: 12px; border-top: 1px solid var(--border, #1a2233); }\n#zg-tmux .zt-cmdmsg:empty { display: none; }\n\n/* ---- 'Layouts' button in the overlay tab strip ---- */\n#zg-tmux .zt-tab-btn { margin-left: auto; align-self: center; flex: none; height: 22px; padding: 0 12px; cursor: pointer; font: 700 11px/1 \"Share Tech Mono\", ui-monospace, monospace; letter-spacing: .5px; color: var(--bg-primary, #05060a); background: var(--cyan, #05d9e8); border: 1px solid var(--cyan, #05d9e8); border-radius: 5px; white-space: nowrap; }\n#zg-tmux .zt-tab-btn:hover { box-shadow: 0 0 10px var(--cyan-glow, rgba(5, 217, 232, .5)); }\n\n/* ---- saved-layouts editor (ZGui.tmux.editSessions / prefix M / tab-strip button), inside a zgui modal ---- */\n.modal-content.zg-le-modal { max-width: 920px; width: 92%; }\n.zt-le { overflow: visible; }\n.zt-le-toolbar { display: flex; gap: 8px; align-items: center; padding: 2px 0 14px; flex-wrap: wrap; }\n.zt-le-btn { min-height: 26px; padding: 3px 10px; cursor: pointer; font: 600 12px/1.4 \"Share Tech Mono\", ui-monospace, monospace; color: var(--cyan, #05d9e8); background: var(--bg-card, #0a0d16); border: 1px solid var(--border, #1a2436); border-radius: 6px; }\n.zt-le-btn:hover { background: var(--bg-hover, #12203a); color: var(--text, #c8d2e0); }\n.zt-le-btn:disabled { opacity: .4; cursor: default; }\n.zt-le-btn.primary { color: var(--bg-primary, #05060a); background: var(--cyan, #05d9e8); border-color: var(--cyan, #05d9e8); }\n.zt-le-btn.mini { padding: 2px 7px; font-size: 11px; }\n.zt-le-btn.danger { color: var(--magenta, #ff2e97); border-color: var(--magenta, #ff2e97); background: var(--bg-card, #0a0d16); }\n.zt-le-btn.danger:hover { background: var(--magenta, #ff2e97); color: var(--bg-primary, #05060a); }\n.zt-le-in { background: var(--bg-primary, #05060a); border: 1px solid var(--border, #1a2436); border-radius: 4px; color: var(--text, #c8d2e0); font: inherit; font-size: 13px; padding: 3px 6px; }\n.zt-le-in:focus { outline: none; border-color: var(--cyan, #05d9e8); }\n.zt-le-card { border: 1px solid var(--border, #1a2436); background: var(--bg-card, #0a0d16); border-radius: 6px; margin: 0 0 12px; padding: 10px 12px; }\n.zt-le-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; }\n.zt-le-title { display: flex; flex-direction: column; gap: 3px; min-width: 0; }\n.zt-le-name { color: var(--text, #c8d2e0); font-weight: 600; font-size: 15px; }\n.zt-le-hotkey { display: inline-flex; align-items: center; gap: 5px; margin: 1px 0; }\n.zt-le-hklbl { color: var(--text-muted, #7d8aa0); font-size: 11px; }\n.zt-le-hkin { width: 2.4em; text-align: center; }\n.zt-le-hkwarn { color: var(--magenta, #ff2e97); font-size: 11px; margin-left: 6px; }\n.zt-le-meta { color: var(--text-muted, #7d8aa0); font-size: 12px; }\n.zt-le-acts { display: flex; gap: 6px; flex-wrap: wrap; }\n.zt-le-editor { margin-top: 12px; border-top: 1px solid var(--border, #1a2436); padding-top: 10px; }\n.zt-le-window { border: 1px solid var(--border, #1a2436); border-radius: 5px; padding: 8px; margin: 0 0 8px; }\n.zt-le-whead { display: flex; gap: 8px; align-items: center; margin-bottom: 6px; flex-wrap: wrap; }\n.zt-le-wtag, .zt-le-ptag { color: var(--accent, #ff2a6d); font: 11px \"Share Tech Mono\", monospace; flex: none; }\n.zt-le-wname { flex: 1; min-width: 120px; }\n.zt-le-pane { display: flex; gap: 6px; align-items: center; margin: 4px 0; }\n.zt-le-plabel { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-muted, #7d8aa0); font-size: 12px; }\n.zt-le-efoot { margin-top: 4px; }\n.zt-le-empty { color: var(--text-muted, #7d8aa0); text-align: center; padding: 32px 0; }\n.zt-le-hint { font-size: 12px; opacity: .8; }\n.zt-le-preview { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 10px; }\n.zt-le-prevcell { display: flex; flex-direction: column; align-items: center; gap: 3px; }\n.zt-le-prevlabel { color: var(--text-muted, #7d8aa0); font: 11px \"Share Tech Mono\", monospace; max-width: 96px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\n.zt-le-svgwrap { line-height: 0; }\n.zt-le-window .zt-le-svgwrap { margin: 0 0 8px; }\n.zt-le-svg { display: block; background: var(--bg-primary, #05060a); border: 1px solid var(--border, #1a2436); border-radius: 3px; }\n.zt-le-svgpane { fill: var(--bg-hover, #12203a); stroke: var(--cyan, #05d9e8); stroke-width: 1; }\n.zt-le-svgnum { fill: var(--text-muted, #7d8aa0); font: 10px \"Share Tech Mono\", monospace; }\n";try{if(typeof document!=="undefined"&&!document.getElementById("zg-tmux-css")){var _s=document.createElement("style");_s.id="zg-tmux-css";_s.textContent=_c;var _h=document.head||document.documentElement;_h.insertBefore(_s,_h.firstChild);}}catch(_e){}})();
  window.ZGui = window.ZGui || {};
  window.ZGui.tmux = api;
})();
