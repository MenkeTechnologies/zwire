/* zwire HUD — tmux/zellij IN the browser. A real in-page tiling overlay:
 *   SESSION → WINDOWS (tabs) → PANES (iframe tiles), split BOTH ways, nested to
 *   any depth, unlimited windows, sync-panes. No OS windows. Panes are real
 *   webpages (the extension strips X-Frame-Options so any site frames).
 *
 * Prefix Ctrl-b, then:
 *   %  split →  (side by side)     "  split ↓  (stacked)
 *   o / ;  next / prev pane        ←→↑↓  focus pane by direction
 *   z  zoom pane                   x  close pane
 *   c  new window                  n / p  next / prev window
 *   e  sync panes (broadcast typing)   d  detach (hide)   &  kill window
 *
 * Runs in ALL frames: the top frame hosts the overlay; a pane iframe (marked
 * window.name='zbtmux') forwards the prefix + relays sync keystrokes. */
(function () {
  'use strict';
  var TOP = window.self === window.top;
  var PANE = (window.name === 'zbtmux');
  if (!TOP && !PANE) return;                 // unrelated sub-frame — do nothing
  if (window.__zbtmuxLoaded) return; window.__zbtmuxLoaded = true;

  function editable(el) { if (!el) return false; var t = el.tagName; return t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT' || el.isContentEditable; }
  // Prefix: rebindable (Keyboard settings page → tmux). Stored in
  // chrome.storage.local 'zb_tmux_prefix' as a list of chords; a keypress that
  // matches ANY chord arms the overlay. Default = Ctrl-b (the real tmux prefix,
  // but the fork's native-split patch eats it until rebuilt) OR ⌥-b (nothing
  // intercepts Alt-b, so the overlay is testable pre-rebuild). Set your own —
  // e.g. C-a — and it live-reloads. Runs in BOTH the top frame and every pane.
  function defaultPrefix() { return [{ ctrl: true, key: 'b' }, { alt: true, code: 'KeyB' }]; }
  var PREFIX = null, ARM_MS = 2500;
  function chordMatch(e, c) {
    if (!!c.ctrl !== e.ctrlKey || !!c.alt !== e.altKey || !!c.meta !== e.metaKey) return false;
    if (c.shift != null && !!c.shift !== e.shiftKey) return false;
    if (c.code) return e.code === c.code;
    if (c.key) return e.key.toLowerCase() === String(c.key).toLowerCase();
    return false;
  }
  function isPrefix(e) {
    var list = (PREFIX && PREFIX.length) ? PREFIX : defaultPrefix();
    for (var i = 0; i < list.length; i++) if (chordMatch(e, list[i])) return true;
    return false;
  }
  function loadTmuxCfg() {
    try {
      chrome.storage.local.get(['zb_tmux_prefix', 'zb_tmux_opts'], function (o) {
        void chrome.runtime.lastError;
        PREFIX = (o && Array.isArray(o.zb_tmux_prefix) && o.zb_tmux_prefix.length) ? o.zb_tmux_prefix : null;
        var opts = (o && o.zb_tmux_opts) || {};
        ARM_MS = (typeof opts.timeout === 'number' && opts.timeout > 0) ? opts.timeout : 2500;
      });
    } catch (e) {}
  }
  loadTmuxCfg();
  try { chrome.storage.onChanged.addListener(function (ch, area) { if (area === 'local' && (ch.zb_tmux_prefix || ch.zb_tmux_opts)) loadTmuxCfg(); }); } catch (e) {}

  /* ===================== PANE FRAME: forwarder + sync ===================== */
  if (!TOP) {
    var pArmed = false, pTimer = null, pSync = false, lastField = null;
    // remember the last text field focused in THIS pane, so synchronize-panes can
    // apply keystrokes here even while this pane isn't the focused one.
    document.addEventListener('focusin', function (e) { if (editable(e.target)) lastField = e.target; }, true);
    function up(o) { try { parent.postMessage(Object.assign({ __zbtmux: 1 }, o), '*'); } catch (e) {} }
    // copy mode + capture any copy into the overlay's paste-buffer stack.
    var copyMode = false, copyInd = null;
    function copyEnter() { if (copyMode) return; copyMode = true; copyInd = document.createElement('div'); copyInd.textContent = '▨ COPY — j/k/d/u/g/G scroll · select · y/Enter yank · Esc'; copyInd.style.cssText = 'position:fixed;top:6px;left:50%;transform:translateX(-50%);z-index:2147483647;background:#ff2a6d;color:#fff;padding:3px 10px;font:12px "Share Tech Mono",monospace;border-radius:3px;pointer-events:none;'; (document.body || document.documentElement).appendChild(copyInd); }
    function copyExit() { copyMode = false; if (copyInd) { try { copyInd.remove(); } catch (e) {} copyInd = null; } }
    function yankSel() { var s = (window.getSelection && String(window.getSelection())) || ''; if (s) up({ yank: s }); }
    document.addEventListener('copy', function () { yankSel(); }, true);
    document.addEventListener('keydown', function (e) {
      if (copyMode) {
        e.preventDefault(); e.stopImmediatePropagation(); var ck = e.key;
        if (ck === 'Escape') copyExit();
        else if (ck === 'y' || ck === 'Enter') { yankSel(); copyExit(); }
        else if (ck === 'j' || ck === 'ArrowDown') window.scrollBy(0, 64);
        else if (ck === 'k' || ck === 'ArrowUp') window.scrollBy(0, -64);
        else if (ck === 'd') window.scrollBy(0, window.innerHeight / 2);
        else if (ck === 'u') window.scrollBy(0, -window.innerHeight / 2);
        else if (ck === 'g') window.scrollTo(0, 0);
        else if (ck === 'G') window.scrollTo(0, document.body.scrollHeight);
        else if (ck === ' ' || ck === 'PageDown') window.scrollBy(0, window.innerHeight * 0.9);
        else if (ck === 'b' || ck === 'PageUp') window.scrollBy(0, -window.innerHeight * 0.9);
        return;
      }
      if (pArmed) {
        if (e.key === 'Shift' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Meta') return;
        pArmed = false; clearTimeout(pTimer);
        e.preventDefault(); e.stopImmediatePropagation();
        up({ cmdKey: e.key, ctrl: e.ctrlKey, alt: e.altKey });
        return;
      }
      if (isPrefix(e)) {
        e.preventDefault(); e.stopImmediatePropagation();
        pArmed = true; clearTimeout(pTimer); pTimer = setTimeout(function () { pArmed = false; }, ARM_MS);
        up({ prefix: 1 });
        return;
      }
      // ⌘K / Ctrl-K from inside a pane -> open the palette on the top frame so it
      // navigates THIS pane (not a new tab).
      if ((e.metaKey || e.ctrlKey) && !e.altKey && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault(); e.stopImmediatePropagation(); up({ palette: 1 }); return;
      }
      // Broadcast editable keystrokes to the other panes. Plain chars + Enter +
      // Backspace forward as-is; the readline line-editing combos forward as
      // semantic tokens so synchronize-panes covers them too: C-w kill word,
      // C-u kill to line start, plus the macOS ⌥/⌘-Delete twins of each.
      if (pSync && editable(document.activeElement)) {
        var mod = e.ctrlKey || e.metaKey || e.altKey;
        if (!mod && (e.key.length === 1 || e.key === 'Enter' || e.key === 'Backspace')) up({ synckey: e.key });
        else if (e.ctrlKey && !e.metaKey && !e.altKey && (e.key === 'w' || e.key === 'W')) up({ synckey: 'C-w' });
        else if (e.ctrlKey && !e.metaKey && !e.altKey && (e.key === 'u' || e.key === 'U')) up({ synckey: 'C-u' });
        else if (e.altKey && !e.ctrlKey && !e.metaKey && e.key === 'Backspace') up({ synckey: 'C-w' });
        else if (e.metaKey && !e.ctrlKey && !e.altKey && e.key === 'Backspace') up({ synckey: 'C-u' });
      }
    }, true);
    window.addEventListener('message', function (ev) {
      var d = ev.data; if (!d || !d.__zbtmux) return;
      if (d.setSync != null) pSync = !!d.setSync;
      else if (d.copyMode) copyEnter();
      else if (d.pasteText != null) insertText(d.pasteText);
      else if (d.syncapply) applyKey(d.syncapply);
    });
    function setNative(el, v) { try { var d = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value'); if (d && d.set) { d.set.call(el, v); return; } } catch (e) {} el.value = v; }
    function insertText(text) {
      var el = document.activeElement; if (!editable(el)) el = (lastField && lastField.isConnected && editable(lastField)) ? lastField : null; if (!el) return;
      if ('value' in el) { var s = el.selectionStart, e2 = el.selectionEnd; if (s != null) { setNative(el, el.value.slice(0, s) + text + el.value.slice(e2)); try { el.selectionStart = el.selectionEnd = s + text.length; } catch (x) {} } else setNative(el, el.value + text); el.dispatchEvent(new Event('input', { bubbles: true })); }
      else { try { document.execCommand('insertText', false, text); } catch (x) {} }
    }
    function applyKey(k) {
      // target this pane's focused field, else the last one focused here.
      var el = document.activeElement;
      if (!editable(el)) el = (lastField && lastField.isConnected && editable(lastField)) ? lastField : null;
      if (!el) return; var hasVal = ('value' in el), focused = (document.activeElement === el);
      if (k === 'Backspace') { if (hasVal) { setNative(el, el.value.slice(0, -1)); el.dispatchEvent(new Event('input', { bubbles: true })); } else if (focused) { try { document.execCommand('delete'); } catch (e) {} } }
      else if (k === 'Enter') { el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true })); if (el.form && typeof el.form.requestSubmit === 'function') { try { el.form.requestSubmit(); } catch (e) {} } }
      else if (k === 'C-w' || k === 'C-u') {
        // kill word (C-w) / kill to line start (C-u), cursor-aware. Deletes back
        // from the caret to the word/line-start boundary, keeping text after it.
        if (hasVal) {
          var val = el.value, s = el.selectionStart, e2 = el.selectionEnd;
          if (s == null) { s = e2 = val.length; }
          var cut;
          if (k === 'C-w') { cut = s; while (cut > 0 && /\s/.test(val[cut - 1])) cut--; while (cut > 0 && !/\s/.test(val[cut - 1])) cut--; }
          else { cut = val.lastIndexOf('\n', s - 1) + 1; }
          setNative(el, val.slice(0, cut) + val.slice(e2));
          try { el.selectionStart = el.selectionEnd = cut; } catch (x) {}
          el.dispatchEvent(new Event('input', { bubbles: true }));
        } else if (focused && window.getSelection) {
          try { var sel = window.getSelection(); sel.modify('extend', 'backward', k === 'C-w' ? 'word' : 'lineboundary'); document.execCommand('delete'); } catch (e) {}
        }
      }
      else if (k.length === 1) { if (hasVal) { setNative(el, el.value + k); el.dispatchEvent(new Event('input', { bubbles: true })); } else if (focused) { try { document.execCommand('insertText', false, k); } catch (e) {} } }
    }
    return;
  }

  /* ============================ TOP FRAME: state ============================ */
  // every fresh pane opens the zwire new-tab. chrome://newtab can't be iframed
  // (chrome:// pages are un-embeddable), so we frame the new-tab EXTENSION's
  // web-accessible page directly — same page chrome://newtab redirects to.
  var NEWTAB = 'chrome-extension://gpoepnekoiplhkegjpocnpeijiefgieb/newtab.html';
  var uid = 0; function nid(p) { return (p || 'p') + (++uid); }
  function leaf(url) { return { t: 'leaf', id: nid('p'), url: url || NEWTAB, title: '' }; }
  function mkWindow(url) { var l = leaf(url); return { id: nid('w'), name: '', tree: l, active: l.id, zoom: null, sync: false, marked: null }; }
  var S = { windows: [mkWindow(NEWTAB)], active: 0 };
  var open = false, armed = false, armTimer = null;

  // key -> action map, built from the shared registry (zkeys.js) + user remaps
  // (zb_keys) — the SAME source the Keyboard settings page edits. So every
  // post-prefix key is customizable there.
  var keyToAction = {};
  function buildKeys(ov) {
    keyToAction = {};
    var reg = window.ZWIRE_KEYMAP, cat = reg && (reg.categories || []).filter(function (c) { return c.id === 'tmux'; })[0];
    if (cat) cat.actions.forEach(function (a) { keyToAction[(ov && ov[a.name]) || a.def] = a.name; });
  }
  buildKeys();
  try { chrome.storage.local.get('zb_keys', function (o) { void chrome.runtime.lastError; buildKeys((o && o.zb_keys) || {}); }); } catch (e) {}

  // Session persistence — the whole tree lives in memory, so a host-page reload
  // would wipe it. Snapshot windows/panes/layout to per-tab sessionStorage and
  // restore on re-inject, so the tmux session survives a reload.
  var SS_KEY = 'zbtmux-session-v1';
  function persist() { try { sessionStorage.setItem(SS_KEY, JSON.stringify({ uid: uid, open: open, active: S.active, windows: S.windows, buffers: buffers })); } catch (e) {} }
  function restore() {
    try {
      var raw = sessionStorage.getItem(SS_KEY); if (!raw) return;
      var d = JSON.parse(raw); if (!d || !d.windows || !d.windows.length) return;
      S = { windows: d.windows, active: Math.min(d.active || 0, d.windows.length - 1) };
      // back-compat: older state used a per-window sync bool; map it to a member set.
      S.windows.forEach(function (w) { if (!Array.isArray(w.syncPanes)) w.syncPanes = w.sync ? leaves(w.tree).map(function (l) { return l.id; }) : []; });
      uid = d.uid || uid; if (Array.isArray(d.buffers)) buffers = d.buffers;
      if (d.open) { open = true; render(); focusActive(); }
    } catch (e) {}
  }

  function W() { return S.windows[S.active]; }
  function leaves(n, out) { out = out || []; if (n.t === 'leaf') out.push(n); else { leaves(n.a, out); leaves(n.b, out); } return out; }
  function findLeaf(id) { var ls = leaves(W().tree); for (var i = 0; i < ls.length; i++) if (ls[i].id === id) return ls[i]; return null; }
  function activeLeaf() { return findLeaf(W().active) || leaves(W().tree)[0]; }
  function windowOfLeaf(id) { for (var i = 0; i < S.windows.length; i++) { var ls = leaves(S.windows[i].tree); for (var j = 0; j < ls.length; j++) if (ls[j].id === id) return S.windows[i]; } return null; }
  function splitContaining(node, target, par) {
    if (node.t !== 'split') return null;
    if (node.a === target || node.b === target) return { split: node, par: par };
    return splitContaining(node.a, target, node) || splitContaining(node.b, target, node);
  }

  /* ------------------------------- commands ------------------------------- */
  // slot of a node within the tree: {parent, key} such that parent[key]===node,
  // or {parent:null} if node is the root. THIS is what splitPane/close/swap edit.
  function nodeSlot(root, target) {
    if (root === target) return { parent: null };
    if (root.t === 'split') { if (root.a === target) return { parent: root, key: 'a' }; if (root.b === target) return { parent: root, key: 'b' }; return nodeSlot(root.a, target) || nodeSlot(root.b, target); }
    return null;
  }
  function setActivePane(id) { var w = W(); if (id && id !== w.active) w.last = w.active; w.active = id; }
  function countLeaves(n) { return n.t === 'leaf' ? 1 : countLeaves(n.a) + countLeaves(n.b); }

  function splitPane(dir) {                   // 'row' = side by side, 'col' = stacked
    var w = W(), L = activeLeaf(); if (!L) return;
    var N = leaf(''), sp = { t: 'split', dir: dir, ratio: 0.5, a: L, b: N };
    var s = nodeSlot(w.tree, L);              // replace L IN PLACE with the new split
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
    var w = W(), a = paneRects[w.active]; if (!a) return;
    var ax = a.x + a.w / 2, ay = a.y + a.h / 2, best = null, bd = 1e9;
    leaves(w.tree).forEach(function (l) {
      if (l.id === w.active) return; var r = paneRects[l.id]; if (!r) return;
      var cx = r.x + r.w / 2, cy = r.y + r.h / 2, ok = false;
      if (dir === 'left') ok = cx < ax - 1; else if (dir === 'right') ok = cx > ax + 1;
      else if (dir === 'up') ok = cy < ay - 1; else ok = cy > ay + 1;
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
    S.windows.push({ id: nid('w'), name: '', tree: L, active: L.id, zoom: null, sync: false, last: null });
    S.last = S.active; S.active = S.windows.length - 1;
  }
  function resizePane(dir, amt) {
    var w = W(), L = activeLeaf(); if (!L) return;
    var axis = (dir === 'left' || dir === 'right') ? 'row' : 'col', path = [];
    (function find(node) { if (node === L) return true; if (node.t === 'split') { if (find(node.a)) { path.push({ node: node, side: 'a' }); return true; } if (find(node.b)) { path.push({ node: node, side: 'b' }); return true; } } return false; })(w.tree);
    for (var i = 0; i < path.length; i++) {
      var p = path[i];
      if (p.node.dir === axis) { var sign = (dir === 'left' || dir === 'up') ? -1 : 1; var d = (p.side === 'a' ? sign : -sign) * amt; p.node.ratio = Math.max(0.08, Math.min(0.92, (p.node.ratio || 0.5) + d)); return; }
    }
  }
  function buildEven(ls, dir) {
    if (ls.length === 1) return ls[0];
    var mid = Math.ceil(ls.length / 2);
    return { t: 'split', dir: dir, ratio: mid / ls.length, a: buildEven(ls.slice(0, mid), dir), b: buildEven(ls.slice(mid), dir) };
  }
  // Even 2D grid (tmux "tiled"): columns of stacked panes, ~square. Nodes may be
  // leaves or subtrees — buildEven wraps either.
  function buildTiled(ls) {
    if (ls.length <= 1) return ls[0];
    var cols = Math.ceil(Math.sqrt(ls.length)), per = Math.ceil(ls.length / cols), colTrees = [], i = 0;
    while (i < ls.length) { colTrees.push(buildEven(ls.slice(i, i + per), 'col')); i += per; }
    return buildEven(colTrees, 'row');
  }
  // Preset grid: grow the active window to at least n panes (new panes open the
  // new-tab), then tile evenly — the four/eight/sixteen-panes presets, for webviews.
  function applyGrid(n) {
    var w = W(), ls = leaves(w.tree);
    while (ls.length < n) ls.push(leaf(''));
    w.tree = buildTiled(ls); w.layout = 'tiled'; w.zoom = null;
    setActivePane(ls[0].id);
  }
  function cycleLayout() {
    var w = W(), ls = leaves(w.tree); if (ls.length < 2) return;
    var order = ['even-h', 'even-v', 'main-v', 'main-h', 'tiled'];
    w.layout = order[(order.indexOf(w.layout) + 1) % order.length];
    if (w.layout === 'even-h') w.tree = buildEven(ls, 'row');
    else if (w.layout === 'even-v') w.tree = buildEven(ls, 'col');
    else if (w.layout === 'main-v') w.tree = { t: 'split', dir: 'row', ratio: 0.6, a: ls[0], b: buildEven(ls.slice(1), 'col') };
    else if (w.layout === 'main-h') w.tree = { t: 'split', dir: 'col', ratio: 0.6, a: ls[0], b: buildEven(ls.slice(1), 'row') };
    else { var cols = Math.ceil(Math.sqrt(ls.length)), rows = []; for (var i = 0; i < ls.length; i += cols) rows.push(buildEven(ls.slice(i, i + cols), 'row')); w.tree = rows.length === 1 ? rows[0] : buildEven(rows, 'col'); }
    w.zoom = null;
  }
  function reloadPane() { var p = panes[W().active]; if (p) try { p.frame.src = p.frame.src; } catch (e) {} }
  function markPane() {
    var w = W(); if (w.marked && !findLeaf(w.marked)) w.marked = null;
    if (w.marked === w.active) { w.marked = null; return; }        // toggle off
    if (w.marked && findLeaf(w.marked)) {                          // swap active <-> marked
      var a = findLeaf(w.active), b = findLeaf(w.marked);
      var sa = nodeSlot(w.tree, a), sb = nodeSlot(w.tree, b);
      if (sa.parent) sa.parent[sa.key] = b; else w.tree = b;
      if (sb.parent) sb.parent[sb.key] = a; else w.tree = a;
      w.marked = null; return;
    }
    w.marked = w.active;                                           // mark this pane
  }

  /* ---- copy mode + paste buffers (panes are scrollable, selectable docs) ---- */
  var buffers = [];
  function pushBuffer(t) { if (!t) return; buffers = buffers.filter(function (b) { return b !== t; }); buffers.unshift(t); if (buffers.length > 30) buffers.pop(); persist(); }
  function toPane(msg) { var l = activeLeaf(), p = l && panes[l.id]; if (p) try { p.frame.contentWindow.postMessage(Object.assign({ __zbtmux: 1 }, msg), '*'); } catch (e) {} }
  function enterCopyMode() { toPane({ copyMode: true }); }
  function pasteBuffer(text) { if (text == null) text = buffers[0]; if (text == null) return; toPane({ pasteText: text }); }
  function showBuffers() {
    if (!buffers.length) return;
    modal(function (card) {
      card.innerHTML = '<h4>paste buffers</h4>';
      buffers.forEach(function (b, i) { var row = document.createElement('div'); row.className = 'zt-wrow'; row.textContent = i + ': ' + b.replace(/\s+/g, ' ').slice(0, 90); row.addEventListener('click', function () { pasteBuffer(b); var m = card.parentNode; if (m) m.remove(); focusActive(); }); card.appendChild(row); });
    }, function (k, close) { if (/^[0-9]$/.test(k)) { var n = parseInt(k, 10); if (buffers[n]) pasteBuffer(buffers[n]); close(); return false; } });
  }

  function addWindow() { S.last = S.active; S.windows.push(mkWindow('')); S.active = S.windows.length - 1; }
  function cycleWindow(delta) { if (S.windows.length < 2) return; S.last = S.active; S.active = (S.active + delta + S.windows.length) % S.windows.length; }
  function lastWindow() { if (S.last != null && S.last < S.windows.length && S.last !== S.active) { var c = S.active; S.active = S.last; S.last = c; } }
  function selectWindowNum(n) { if (n >= 0 && n < S.windows.length) { S.last = S.active; S.active = n; } }
  function killWindow() {
    leaves(W().tree).forEach(function (l) { dropPane(l.id); });
    S.windows.splice(S.active, 1);
    if (!S.windows.length) { open = false; S.windows.push(mkWindow('')); S.active = 0; return; }
    S.active = Math.min(S.active, S.windows.length - 1);
  }
  // Partial synchronize-panes: w.syncPanes is the set of pane (leaf) ids that
  // share typing. Empty = off. tmux-sync toggles ALL on/off; tmux-sync-pane
  // toggles just the active pane, so you can sync an arbitrary subset.
  function syncMembers(w) { return w.syncPanes || (w.syncPanes = []); }
  function paneSynced(w, id) { return syncMembers(w).indexOf(id) >= 0; }
  function syncActive(w) { return syncMembers(w).length > 0; }
  function pruneSync(w) { var ids = leaves(w.tree).map(function (l) { return l.id; }); w.syncPanes = syncMembers(w).filter(function (id) { return ids.indexOf(id) >= 0; }); }
  function toggleSync() { var w = W(), ls = leaves(w.tree); w.syncPanes = (ls.length && syncMembers(w).length >= ls.length) ? [] : ls.map(function (l) { return l.id; }); broadcastSync(w); }
  function toggleSyncPane() { var w = W(), m = syncMembers(w), i = m.indexOf(w.active); if (i >= 0) m.splice(i, 1); else m.push(w.active); broadcastSync(w); }

  function exec(k, mods) {
    var wasClosed = !open;                       // is this command the one opening the overlay?
    if (!open) open = true;
    mods = mods || {};
    var w = W(), bw = S.active, bp = w.active;   // to detect if the active pane moved
    // fixed/directional keys (not remappable — they're inherently positional)
    if (/^[0-9]$/.test(k)) { selectWindowNum(parseInt(k, 10)); render(); focusActive(); return; }
    if (k === 'ArrowLeft' || k === 'ArrowRight' || k === 'ArrowUp' || k === 'ArrowDown') {
      var dir = k.slice(5).toLowerCase();
      if (mods.ctrl || mods.alt) resizePane(dir, mods.alt ? 0.08 : 0.03); else navDir(dir);
      render(); focusActive(); return;
    }
    switch (keyToAction[k]) {                    // customizable on the Keyboard page
      case 'tmux-split-h': splitPane('row'); break;
      case 'tmux-split-v': splitPane('col'); break;
      case 'tmux-pane-next': navCycle(1); break;
      case 'tmux-pane-last': lastPane(); break;
      case 'tmux-pane-left': navDir('left'); break;
      case 'tmux-pane-down': navDir('down'); break;
      case 'tmux-pane-up': navDir('up'); break;
      case 'tmux-pane-right': navDir('right'); break;
      case 'tmux-resize-left': resizePane('left', 0.05); break;
      case 'tmux-resize-down': resizePane('down', 0.05); break;
      case 'tmux-resize-up': resizePane('up', 0.05); break;
      case 'tmux-resize-right': resizePane('right', 0.05); break;
      case 'tmux-grid-4': applyGrid(4); break;
      case 'tmux-grid-8': applyGrid(8); break;
      case 'tmux-grid-16': applyGrid(16); break;
      case 'tmux-zoom': w.zoom = w.zoom ? null : w.active; break;
      case 'tmux-close': closePane(); break;
      case 'tmux-swap-prev': swapPane(-1); break;
      case 'tmux-swap-next': swapPane(1); break;
      case 'tmux-rotate': rotatePanes(1); break;
      case 'tmux-break': breakPane(); break;
      case 'tmux-pane-nums': showPaneNumbers(); return;
      case 'tmux-layout': cycleLayout(); break;
      case 'tmux-win-new': if (!wasClosed) addWindow(); break;   // first open shows window 0, not a phantom 1
      case 'tmux-win-next': cycleWindow(1); break;
      case 'tmux-win-prev': cycleWindow(-1); break;
      case 'tmux-win-last': lastWindow(); break;
      case 'tmux-win-rename': renameWindow(); return;
      case 'tmux-win-move': moveWindow(); return;
      case 'tmux-win-goto': winGoto(); return;
      case 'tmux-mark': markPane(); break;
      case 'tmux-win-list': showChooser(); return;
      case 'tmux-win-kill': killWindow(); break;
      case 'tmux-sync': toggleSync(); break;
      case 'tmux-sync-pane': toggleSyncPane(); break;
      case 'tmux-copy-mode': enterCopyMode(); return;
      case 'tmux-paste': pasteBuffer(); return;
      case 'tmux-buffers': showBuffers(); return;
      case 'tmux-reload': reloadPane(); break;
      case 'tmux-clock': showClock(); return;
      case 'tmux-palette': try { if (window.__zbPaletteOpen) window.__zbPaletteOpen(); } catch (e) {} return;
      case 'tmux-detach': open = wasClosed; break;   // toggle: C-b d detaches when attached, re-attaches when detached
      case 'tmux-sessions': openSessionsPage(); return;
      case 'tmux-session-save': saveCurrentSession(); return;
      case 'tmux-help': showHelp(); return;
      default: return;
    }
    render();
    // focus on open, or when the ACTIVE pane moved — but NOT for in-place commands
    // like sync (e)/zoom (z)/reload, which would keep yanking the cursor to the URL box.
    if (wasClosed || S.active !== bw || W().active !== bp) focusActive();
  }

  /* --------------------------------- DOM ---------------------------------- */
  var root, tabsEl, bodyEl, styleEl;
  var panes = {};          // leafId -> { wrap, frame, addr, titleEl, url }
  var paneRects = {};      // leafId -> {x,y,w,h} in % (active window only)

  // Themed with the active scheme's CSS vars (same ones zstatus.js / every HUD
  // page use) so panes/tabs match cyberpunk/ember/matrix/… live. Hardcoded hexes
  // are fallbacks only.
  var HUD = window.ZWIRE_HUD || {}, SCHEMES = HUD.SCHEMES || {}, VAR_KEYS = HUD.VAR_KEYS || [];
  var CSS = [
    // leave the bottom 22px for the real powerline statusbar (zstatus.js).
    '#zbtmux{position:fixed;top:0;left:0;right:0;bottom:22px;z-index:2147483640;display:none;flex-direction:column;',
    ' background:var(--bg-primary,#05060a);font-family:"Share Tech Mono",Monaco,monospace;color:var(--text,#c8d2e0);}',
    '#zbtmux.on{display:flex;}',
    '#zbtmux .zt-tabs{display:flex;gap:2px;align-items:stretch;height:26px;background:var(--bg-card,#0a0d16);',
    ' border-bottom:1px solid var(--cyan,#05d9e8);padding:0 6px;overflow-x:auto;flex-shrink:0;}',
    '#zbtmux .zt-tab{display:flex;align-items:center;gap:6px;padding:0 12px;font-size:12px;',
    ' color:var(--text-muted,#5a6b82);cursor:pointer;border-top:2px solid transparent;white-space:nowrap;}',
    '#zbtmux .zt-tab.act{color:var(--bg-primary,#05060a);background:var(--cyan,#05d9e8);font-weight:700;',
    ' box-shadow:0 0 12px var(--cyan-glow,rgba(5,217,232,.4));}',
    '#zbtmux .zt-tab .zt-sync{color:var(--accent,#ff2a6d);font-size:10px;}',
    '#zbtmux .zt-body{position:relative;flex:1;overflow:hidden;}',
    '#zbtmux .zt-pane{position:absolute;display:flex;flex-direction:column;overflow:hidden;',
    ' border:1px solid var(--border,#1a2436);box-sizing:border-box;background:var(--bg-primary,#05060a);}',
    '#zbtmux .zt-pane.act{border-color:var(--cyan,#05d9e8);',
    ' box-shadow:inset 0 0 0 1px var(--cyan,#05d9e8),0 0 16px var(--cyan-glow,rgba(5,217,232,.35));}',
    '#zbtmux .zt-ttl{display:flex;align-items:center;gap:6px;height:22px;padding:0 8px;background:var(--bg-card,#0a0d16);',
    ' font-size:11px;color:var(--text-muted,#7d8aa0);flex-shrink:0;border-bottom:1px solid var(--border,#1a2436);}',
    '#zbtmux .zt-pane.act .zt-ttl{color:var(--cyan,#05d9e8);}',
    '#zbtmux .zt-pane.zt-mark{border-color:var(--accent,#ff2a6d);}',
    '#zbtmux .zt-pane.zt-mark .zt-ttl::before{content:"◆ ";color:var(--accent,#ff2a6d);}',
    '#zbtmux .zt-pane.zt-synced{border-color:var(--cyan,#05d9e8);}',
    '#zbtmux .zt-psync{color:var(--cyan,#05d9e8);font-size:11px;flex-shrink:0;}',
    '#zbtmux .zt-addr{flex:1;min-width:0;background:transparent;border:none;outline:none;color:inherit;',
    ' font:inherit;padding:2px 0;}',
    '#zbtmux .zt-addr::placeholder{color:var(--text-muted,#5a6b82);}',
    '#zbtmux .zt-x{cursor:pointer;color:var(--accent,#ff2a6d);padding:0 2px;font-size:12px;}',
    '#zbtmux .zt-fr{flex:1;border:0;width:100%;background:#fff;}',
    '#zbtmux .zt-pane:not(.act) .zt-cover{position:absolute;inset:22px 0 0 0;z-index:2;cursor:pointer;background:transparent;}',
    // draggable split dividers + a drag-shield (keeps mousemove out of iframes)
    '#zbtmux .zt-div{position:absolute;z-index:6;background:transparent;transition:background .1s;}',
    '#zbtmux .zt-div-v{width:8px;transform:translateX(-4px);cursor:col-resize;}',
    '#zbtmux .zt-div-h{height:8px;transform:translateY(-4px);cursor:row-resize;}',
    '#zbtmux .zt-div:hover{background:var(--cyan,#05d9e8);opacity:.55;}',
    '#zbtmux .zt-shield{position:absolute;inset:0;z-index:50;}',
    // transient overlays (help / clock / chooser / pane numbers)
    '#zbtmux .zt-modal{position:absolute;inset:0;z-index:60;display:flex;align-items:center;justify-content:center;',
    ' background:rgba(0,0,0,.55);color:var(--text,#c8d2e0);}',
    '#zbtmux .zt-modal .zt-card{background:var(--bg-card,#0a0d16);border:1px solid var(--cyan,#05d9e8);border-radius:4px;',
    ' padding:16px 20px;max-height:80%;overflow:auto;box-shadow:0 0 30px var(--cyan-glow,rgba(5,217,232,.4));font-size:13px;line-height:1.7;}',
    '#zbtmux .zt-modal h4{color:var(--cyan,#05d9e8);margin:0 0 10px;letter-spacing:1px;}',
    '#zbtmux .zt-modal .zt-clock{font-size:64px;letter-spacing:4px;color:var(--cyan,#05d9e8);text-shadow:0 0 18px var(--cyan-glow,rgba(5,217,232,.6));}',
    '#zbtmux .zt-modal .zt-wrow{padding:5px 10px;cursor:pointer;border-radius:2px;}',
    '#zbtmux .zt-modal .zt-wrow:hover,#zbtmux .zt-modal .zt-wrow.sel{background:var(--cyan,#05d9e8);color:var(--bg-primary,#05060a);}',
    '#zbtmux .zt-pnum{position:absolute;inset:0;z-index:40;display:flex;align-items:center;justify-content:center;',
    ' font-size:56px;font-weight:700;color:var(--cyan,#05d9e8);background:rgba(0,0,0,.35);text-shadow:0 0 16px var(--cyan-glow,rgba(5,217,232,.6));pointer-events:none;}',
    // omnibox-style URL completion dropdown (history + open tabs + search)
    '#zbtmux .zt-ac{position:absolute;z-index:45;max-height:300px;overflow:auto;background:var(--bg-card,#0a0d16);',
    ' border:1px solid var(--cyan,#05d9e8);border-top:none;box-shadow:0 10px 28px rgba(0,0,0,.55);}',
    '#zbtmux .zt-ac-row{display:flex;align-items:center;gap:10px;padding:6px 10px;cursor:pointer;}',
    '#zbtmux .zt-ac-row:hover,#zbtmux .zt-ac-row.sel{background:var(--cyan,#05d9e8);}',
    '#zbtmux .zt-ac-row:hover .zt-ac-l,#zbtmux .zt-ac-row.sel .zt-ac-l,#zbtmux .zt-ac-row:hover .zt-ac-d,#zbtmux .zt-ac-row.sel .zt-ac-d{color:var(--bg-primary,#05060a);}',
    '#zbtmux .zt-ac-l{flex:1;font-size:12px;color:var(--text,#c8d2e0);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
    '#zbtmux .zt-ac-d{font-size:11px;color:var(--text-muted,#5a6b82);max-width:45%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}'
  ].join('');

  function applyTheme() {
    if (!styleEl) return;
    var cb = function (vars) {
      var v = ''; for (var i = 0; i < VAR_KEYS.length; i++) if (vars[VAR_KEYS[i]]) v += VAR_KEYS[i] + ':' + vars[VAR_KEYS[i]] + ';';
      styleEl.textContent = '#zbtmux{' + v + '}' + CSS;
    };
    try { chrome.storage.local.get('zb_scheme', function (o) { void chrome.runtime.lastError; var s = SCHEMES[(o && o.zb_scheme) || 'cyberpunk'] || SCHEMES.cyberpunk || { vars: {} }; cb(s.vars || {}); }); }
    catch (e) { cb((SCHEMES.cyberpunk || { vars: {} }).vars || {}); }
  }

  function ensureDom() {
    if (root) return;
    styleEl = document.createElement('style'); styleEl.textContent = CSS;
    (document.head || document.documentElement).appendChild(styleEl);
    applyTheme();
    root = document.createElement('div'); root.id = 'zbtmux';
    tabsEl = document.createElement('div'); tabsEl.className = 'zt-tabs';
    bodyEl = document.createElement('div'); bodyEl.className = 'zt-body';
    root.appendChild(tabsEl); root.appendChild(bodyEl);
    (document.body || document.documentElement).appendChild(root);
  }

  function normalizeUrl(v) {
    v = (v || '').trim(); if (!v || v === 'about:blank') return NEWTAB;   // fresh/blank pane => zwire new-tab, never about:blank
    if (/^[a-z][a-z0-9+.\-]*:\/\//i.test(v)) return v;   // any scheme incl. chrome-extension://
    if (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(v) && v.indexOf(' ') < 0) return 'https://' + v;
    return 'https://www.google.com/search?q=' + encodeURIComponent(v);
  }
  function looksUrl(q) { return /^[a-z][a-z0-9+.\-]*:\/\//i.test(q) || (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(q) && q.indexOf(' ') < 0); }

  // omnibox-style completion, from the same history/tabs data the palette uses.
  var frecent = [], tabsList = [];
  function loadNav() { try { chrome.storage.local.get(['zb_frecent', 'zb_tabs'], function (o) { void chrome.runtime.lastError; frecent = (o && o.zb_frecent) || []; tabsList = (o && o.zb_tabs) || []; }); } catch (e) {} }
  loadNav();
  function suggest(q) {
    q = (q || '').trim(); var out = [], fz = window.ZGui && window.ZGui.fzf;
    function sc(text) { if (!q) return 0; if (fz) { var m = fz.fzfMatch(q, text); return m ? m.score : -1; } return (text || '').toLowerCase().indexOf(q.toLowerCase()) >= 0 ? 1 : -1; }
    if (q && looksUrl(q)) out.push({ label: q, detail: 'open', url: q });
    var pool = [];
    frecent.forEach(function (f) { var s = sc((f.title || '') + ' ' + f.url); if (s >= 0) pool.push({ label: f.title || f.url, detail: f.url, url: f.url, s: s }); });
    tabsList.forEach(function (t) { if (!t.url || t.url.indexOf('chrome') === 0) return; var s = sc((t.title || '') + ' ' + t.url); if (s >= 0) pool.push({ label: '↳ ' + (t.title || t.url), detail: t.url, url: t.url, s: s }); });
    pool.sort(function (a, b) { return (b.s || 0) - (a.s || 0); });
    out = out.concat(pool.slice(0, 8));
    if (q && !looksUrl(q)) out.push({ label: 'Search “' + q + '”', detail: 'google', url: 'https://www.google.com/search?q=' + encodeURIComponent(q) });
    return out.slice(0, 9);
  }
  function makePane(l) {
    var wrap = document.createElement('div'); wrap.className = 'zt-pane';
    var ttl = document.createElement('div'); ttl.className = 'zt-ttl';
    var addr = document.createElement('input'); addr.className = 'zt-addr'; addr.spellcheck = false;
    addr.placeholder = 'url or search …'; addr.value = (l.url && l.url !== 'about:blank' && l.url !== NEWTAB) ? l.url : '';
    var x = document.createElement('span'); x.className = 'zt-x'; x.textContent = '✕';
    var sy = document.createElement('span'); sy.className = 'zt-psync'; sy.textContent = '⇄'; sy.title = 'synced pane'; sy.style.display = 'none';
    ttl.appendChild(sy); ttl.appendChild(addr); ttl.appendChild(x);
    var fr = document.createElement('iframe'); fr.className = 'zt-fr'; fr.name = 'zbtmux';
    fr.setAttribute('allow', 'clipboard-read; clipboard-write; fullscreen');
    // Contain the pane: full functionality (scripts/forms/popups/modals/
    // downloads/same-origin) but no AUTOMATIC top-navigation, which neutralizes
    // the JS frame-busting (`if (top !== self) top.location = self.location`)
    // that occasionally yanked a framed site out of the tiling — the one gap
    // the header stripper (DNR) + native allow-framing can't cover. User-
    // activated top-nav is still allowed so real navigations aren't broken.
    fr.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads allow-top-navigation-by-user-activation allow-storage-access-by-user-activation allow-presentation');
    fr.src = normalizeUrl(l.url);
    // every (re)load of a pane re-arms its sync state — a freshly navigated page
    // starts with sync off, so without this it could receive but not broadcast.
    fr.addEventListener('load', function () { var win = windowOfLeaf(l.id); if (win) { try { fr.contentWindow.postMessage({ __zbtmux: 1, setSync: paneSynced(win, l.id) }, '*'); } catch (e) {} } });
    var cover = document.createElement('div'); cover.className = 'zt-cover';
    var ac = document.createElement('div'); ac.className = 'zt-ac'; ac.style.display = 'none';
    wrap.appendChild(ttl); wrap.appendChild(fr); wrap.appendChild(cover); bodyEl.appendChild(ac);
    var rec = { wrap: wrap, frame: fr, addr: addr, url: l.url, ac: ac, sy: sy };
    var sug = [], sel = -1;
    function go(url) { if (!url) return; l.url = url; rec.url = url; fr.src = normalizeUrl(url); hideAc(); try { fr.focus(); } catch (e) {} }
    function hideAc() { ac.style.display = 'none'; sug = []; sel = -1; }
    function drawAc() {
      if (!sug.length) { hideAc(); return; }
      var ar = addr.getBoundingClientRect(), br = bodyEl.getBoundingClientRect();
      ac.style.left = (ar.left - br.left) + 'px'; ac.style.top = (ar.bottom - br.top) + 'px'; ac.style.width = Math.max(240, ar.width) + 'px';
      ac.innerHTML = ''; sug.forEach(function (s, i) {
        var r = document.createElement('div'); r.className = 'zt-ac-row' + (i === sel ? ' sel' : '');
        r.innerHTML = '<span class="zt-ac-l"></span><span class="zt-ac-d"></span>';
        r.firstChild.textContent = s.label; r.lastChild.textContent = s.detail || '';
        r.addEventListener('mousedown', function (e) { e.preventDefault(); go(s.url); });
        ac.appendChild(r);
      });
      ac.style.display = 'block';
    }
    addr.addEventListener('input', function () { sug = suggest(addr.value); sel = -1; drawAc(); });
    addr.addEventListener('keydown', function (e) {
      e.stopPropagation();
      if (e.key === 'ArrowDown') { e.preventDefault(); if (sug.length) { sel = (sel + 1) % sug.length; drawAc(); } }
      else if (e.key === 'ArrowUp') { e.preventDefault(); if (sug.length) { sel = (sel - 1 + sug.length) % sug.length; drawAc(); } }
      else if (e.key === 'Enter') { e.preventDefault(); go(sel >= 0 && sug[sel] ? sug[sel].url : addr.value); }
      else if (e.key === 'Escape') { if (ac.style.display !== 'none') { e.preventDefault(); hideAc(); } }
    });
    addr.addEventListener('focus', function () { setActive(l.id); sug = suggest(addr.value); sel = -1; drawAc(); });
    addr.addEventListener('blur', function () { setTimeout(hideAc, 150); });
    x.addEventListener('click', function (e) { e.stopPropagation(); setActive(l.id); closePane(); });
    cover.addEventListener('mousedown', function () { setActive(l.id); focusActive(); });
    wrap.addEventListener('mousedown', function () { setActive(l.id); });
    panes[l.id] = rec; bodyEl.appendChild(wrap);
    return rec;
  }
  function dropPane(id) { var p = panes[id]; if (p) { try { p.wrap.remove(); } catch (e) {} if (p.ac) try { p.ac.remove(); } catch (e) {} delete panes[id]; } }

  function computeRects(node, x, y, w, h, out, divs) {
    if (node.t === 'leaf') { out[node.id] = { x: x, y: y, w: w, h: h }; return; }
    var r = node.ratio == null ? 0.5 : node.ratio;
    if (node.dir === 'row') {
      computeRects(node.a, x, y, w * r, h, out, divs);
      computeRects(node.b, x + w * r, y, w * (1 - r), h, out, divs);
      if (divs) divs.push({ node: node, dir: 'row', x: x + w * r, y: y, len: h, rx: x, rw: w });
    } else {
      computeRects(node.a, x, y, w, h * r, out, divs);
      computeRects(node.b, x, y + h * r, w, h * (1 - r), out, divs);
      if (divs) divs.push({ node: node, dir: 'col', x: x, y: y + h * r, len: w, ry: y, rh: h });
    }
  }

  // ---- draggable split dividers ----
  var dividerEls = [], dragShield = null;
  function drawDividers(divs) {
    while (dividerEls.length > divs.length) { var e = dividerEls.pop(); try { e.remove(); } catch (x) {} }
    divs.forEach(function (d, i) {
      var el = dividerEls[i];
      if (!el) { el = document.createElement('div'); bodyEl.appendChild(el); dividerEls[i] = el; attachDrag(el); }
      el._d = d;
      el.className = 'zt-div ' + (d.dir === 'row' ? 'zt-div-v' : 'zt-div-h');
      el.style.left = d.x + '%'; el.style.top = d.y + '%';
      if (d.dir === 'row') { el.style.height = d.len + '%'; el.style.width = ''; }
      else { el.style.width = d.len + '%'; el.style.height = ''; }
      el.style.display = 'block';
    });
  }
  function attachDrag(el) {
    el.addEventListener('mousedown', function (ev) {
      ev.preventDefault(); ev.stopPropagation();
      var d = el._d; if (!d) return;
      var rect = bodyEl.getBoundingClientRect();
      // a full-body shield keeps mousemove in the parent (iframes would eat it).
      if (!dragShield) { dragShield = document.createElement('div'); dragShield.className = 'zt-shield'; }
      dragShield.style.cursor = d.dir === 'row' ? 'col-resize' : 'row-resize';
      bodyEl.appendChild(dragShield);
      function mv(e) {
        var dd = el._d;
        if (dd.dir === 'row') { var px = (e.clientX - rect.left) / rect.width * 100; dd.node.ratio = Math.max(0.06, Math.min(0.94, (px - dd.rx) / dd.rw)); }
        else { var py = (e.clientY - rect.top) / rect.height * 100; dd.node.ratio = Math.max(0.06, Math.min(0.94, (py - dd.ry) / dd.rh)); }
        layout();
      }
      function up() { document.removeEventListener('mousemove', mv, true); document.removeEventListener('mouseup', up, true); if (dragShield && dragShield.parentNode) dragShield.remove(); persist(); }
      document.addEventListener('mousemove', mv, true); document.addEventListener('mouseup', up, true);
    });
  }
  function layout() {
    var rects = {}, divs = []; paneRects = rects;
    computeRects(W().tree, 0, 0, 100, 100, rects, divs);
    var cur = {}; leaves(W().tree).forEach(function (l) { cur[l.id] = l; });
    var zoom = W().zoom;
    Object.keys(panes).forEach(function (id) {
      var p = panes[id];
      if (!cur[id] || (zoom && id !== zoom)) { p.wrap.style.display = 'none'; return; }
      var r = zoom ? { x: 0, y: 0, w: 100, h: 100 } : rects[id];
      p.wrap.style.display = 'flex';
      p.wrap.style.left = r.x + '%'; p.wrap.style.top = r.y + '%';
      p.wrap.style.width = r.w + '%'; p.wrap.style.height = r.h + '%';
      p.wrap.classList.toggle('act', id === W().active);
      p.wrap.classList.toggle('zt-mark', id === W().marked);
    });
    drawDividers(zoom ? [] : divs);
  }

  function setActive(id) { setActivePane(id); render(); }
  function focusActive() {
    var l = activeLeaf(), p = l && panes[l.id]; if (!p) return;
    // Land in the pane's ADDRESS BAR (a top-frame element the prefix handler can
    // see) for blank/newtab panes — the newtab iframe is the newtab extension's
    // origin, where our prefix forwarder can't run, so focusing it would swallow
    // the next C-b/⌥b (the "needs two presses" bug). Real (http) panes get frame
    // focus — the forwarder runs there.
    if (!l.url || l.url === 'about:blank' || l.url === NEWTAB) { try { p.addr.focus(); return; } catch (e) {} }
    try { p.frame.focus(); } catch (e) {}
  }

  function render() {
    ensureDom();
    root.classList.toggle('on', open);
    if (!open) return;
    // drop stale sync members left over from closed/broken panes.
    S.windows.forEach(pruneSync);
    // tabs
    tabsEl.innerHTML = '';
    S.windows.forEach(function (win, i) {
      var t = document.createElement('div'); t.className = 'zt-tab' + (i === S.active ? ' act' : '');
      t.textContent = (i) + ': ' + (win.name || label(win));
      if (syncActive(win)) { var s = document.createElement('span'); s.className = 'zt-sync'; var full = syncMembers(win).length >= leaves(win.tree).length; s.textContent = full ? '⇄' : ('⇄' + syncMembers(win).length); t.appendChild(s); }
      t.addEventListener('click', function () { S.active = i; render(); focusActive(); });
      tabsEl.appendChild(t);
    });
    // ensure a pane element exists for every leaf in the active window, then tile.
    var aw = W();
    leaves(aw.tree).forEach(function (l) { if (!panes[l.id]) makePane(l); });
    // reflect each pane's sync membership (border + ⇄ badge in its title bar).
    leaves(aw.tree).forEach(function (l) { var p = panes[l.id]; if (p) { var on = paneSynced(aw, l.id); if (p.wrap) p.wrap.classList.toggle('zt-synced', on); if (p.sy) p.sy.style.display = on ? '' : 'none'; } });
    layout();
    // Feed the REAL powerline statusbar (zstatus.js reads zb_tmux) instead of a
    // hand-rolled bar — it renders the window/pane/zoom/sync segment for us.
    publishTmux();
    persist();
  }
  function label(win) { var l = leaves(win.tree)[0]; try { return l.url && l.url !== NEWTAB ? new URL(normalizeUrl(l.url)).hostname.replace(/^www\./, '') : 'newtab'; } catch (e) { return 'newtab'; } }
  function publishTmux() {
    try {
      var st = open ? {
        armed: armed,
        windows: S.windows.map(function (win) { return { name: win.name || label(win), panes: leaves(win.tree).length, zoom: !!win.zoom, sync: syncActive(win), syncPanes: syncMembers(win).length }; }),
        active: S.active, anySync: S.windows.some(syncActive)
      } : { armed: armed, windows: [] };
      chrome.storage.local.set({ zb_tmux: st });
    } catch (e) {}
  }

  /* --------------------------- named sessions ----------------------------- */
  // Durable, named sessions live in chrome.storage.local 'zb_tmux_sessions'
  // (full CRUD on pages/sessions.html). A session is windows[] -> panes[] ->
  // a webview {url,title}; loading rebuilds the tiling tree from the flat pane
  // list (auto-tiled via buildEven), saving snapshots the current tree's leaves.
  var SESSIONS_KEY = 'zb_tmux_sessions';
  function sessionSnapshot() {
    return S.windows.map(function (win) {
      return { name: win.name || '', panes: leaves(win.tree).map(function (l) { return { url: l.url || '', title: l.title || '' }; }) };
    });
  }
  function windowFromPanes(name, panes) {
    var list = (panes && panes.length ? panes : [{ url: '' }]).map(function (p) { var l = leaf((p && p.url) || ''); l.title = (p && p.title) || ''; return l; });
    return { id: nid('w'), name: name || '', tree: buildEven(list, 'row'), active: list[0].id, zoom: null, sync: false, last: null };
  }
  function applySession(sess) {
    if (!sess || !sess.windows || !sess.windows.length) return;
    S.windows.forEach(function (win) { leaves(win.tree).forEach(function (l) { dropPane(l.id); }); });   // release old iframes
    S.windows = sess.windows.map(function (w) { return windowFromPanes(w.name, w.panes); });
    S.active = 0; S.last = null; open = true; render(); focusActive(); publishTmux();
  }
  function loadSessionById(id) {
    if (!id) return;
    try { chrome.storage.local.get(SESSIONS_KEY, function (o) { void chrome.runtime.lastError; var arr = (o && o[SESSIONS_KEY]) || []; for (var i = 0; i < arr.length; i++) if (arr[i].id === id) { applySession(arr[i]); return; } }); } catch (e) {}
  }
  function saveCurrentSession() {
    promptModal('Save current layout as session', '', function (name) {
      name = (name || '').trim(); if (!name) return;
      try {
        chrome.storage.local.get(SESSIONS_KEY, function (o) {
          void chrome.runtime.lastError;
          var arr = (o && o[SESSIONS_KEY]) || [], now = Date.now();
          arr.unshift({ id: 's' + now.toString(36) + '-' + Math.floor(Math.random() * 1e6).toString(36), name: name, created: now, updated: now, windows: sessionSnapshot() });
          chrome.storage.local.set({ zb_tmux_sessions: arr }, function () { void chrome.runtime.lastError; });
        });
      } catch (e) {}
    });
  }
  function openSessionsPage() {
    var url = chrome.runtime.getURL('pages/sessions.html');
    try { window.open(url, '_blank'); } catch (e) { try { top.location.href = url; } catch (x) {} }
  }

  /* -------------------------------- sync ---------------------------------- */
  function broadcastSync(win) { leaves(win.tree).forEach(function (l) { var p = panes[l.id]; if (p) try { p.frame.contentWindow.postMessage({ __zbtmux: 1, setSync: paneSynced(win, l.id) }, '*'); } catch (e) {} }); render(); }
  function sourceLeafId(source) { var ls = leaves(W().tree); for (var i = 0; i < ls.length; i++) { var p = panes[ls[i].id]; if (p && p.frame.contentWindow === source) return ls[i].id; } return null; }
  function relaySync(source, key) {
    var w = W(), sid = sourceLeafId(source);
    if (!sid || !paneSynced(w, sid)) return;            // only a member pane broadcasts
    leaves(w.tree).forEach(function (l) {
      if (!paneSynced(w, l.id)) return;                 // and only member panes receive
      var p = panes[l.id]; if (!p || p.frame.contentWindow === source) return;
      try { p.frame.contentWindow.postMessage({ __zbtmux: 1, syncapply: key }, '*'); } catch (e) {}
    });
  }

  /* ----------------------------- key handling ----------------------------- */
  function armTop() { armed = true; clearTimeout(armTimer); armTimer = setTimeout(function () { armed = false; render(); publishTmux(); }, ARM_MS); render(); publishTmux(); }
  document.addEventListener('keydown', function (e) {
    if (armed) {
      if (e.key === 'Shift' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Meta' || e.key === 'Dead' || e.key === 'Process') return;
      if (isPrefix(e)) { e.preventDefault(); e.stopImmediatePropagation(); return; }   // repeated prefix / echo — stay armed
      armed = false; clearTimeout(armTimer);
      e.preventDefault(); e.stopImmediatePropagation();
      if (e.key !== 'Escape') exec(e.key, { ctrl: e.ctrlKey, alt: e.altKey }); else render();
      return;
    }
    if (isPrefix(e)) {
      e.preventDefault(); e.stopImmediatePropagation(); armTop();
    }
  }, true);

  // commands + sync relayed up from pane iframes
  window.addEventListener('message', function (ev) {
    var d = ev.data; if (!d || !d.__zbtmux) return;
    if (d.prefix) { armed = true; clearTimeout(armTimer); armTimer = setTimeout(function () { armed = false; render(); }, ARM_MS); render(); }
    else if (d.cmdKey) { armed = false; exec(d.cmdKey, { ctrl: d.ctrl, alt: d.alt }); }
    else if (d.palette) { try { if (window.__zbPaletteOpen) window.__zbPaletteOpen(); } catch (e) {} }
    else if (d.synckey) { relaySync(ev.source, d.synckey); }
    else if (d.yank) { pushBuffer(d.yank); }
  });

  /* ------------------------- transient overlays --------------------------- */
  function modal(build, onKey) {
    var m = document.createElement('div'); m.className = 'zt-modal';
    var card = document.createElement('div'); card.className = 'zt-card'; m.appendChild(card);
    build(card);
    function close() { try { m.remove(); } catch (e) {} document.removeEventListener('keydown', key, true); focusActive(); }
    function key(e) {
      e.preventDefault(); e.stopImmediatePropagation();
      if (e.key === 'Escape') { close(); return; }
      if (onKey && onKey(e.key, close) === true) return;
      close();
    }
    m.addEventListener('mousedown', function (e) { if (e.target === m) close(); });
    document.addEventListener('keydown', key, true);
    bodyEl.appendChild(m); return { el: m, close: close };
  }
  function escq(s) { var d = document.createElement('div'); d.textContent = s == null ? '' : s; return d.innerHTML; }
  function showHelp() {
    modal(function (card) {
      var reg = window.ZWIRE_KEYMAP, cat = reg && (reg.categories || []).filter(function (c) { return c.id === 'tmux'; })[0];
      var rev = {}; Object.keys(keyToAction).forEach(function (kk) { rev[keyToAction[kk]] = kk; });
      var h = '<h4>zwire tmux — prefix C-b (or ⌥b), then…</h4><div style="columns:2;column-gap:28px;">';
      (cat ? cat.actions : []).forEach(function (a) { var kk = rev[a.name] || a.def; h += '<div><kbd>' + escq(kk === ' ' ? 'Space' : kk) + '</kbd> ' + escq(a.label) + '</div>'; });
      h += '</div><div style="margin-top:10px;opacity:.7;">Arrows focus panes · C-arrow / drag borders resize · 0-9 select window · m mark then m elsewhere to swap · Remap any of these on the <b>Keyboard</b> page.<br>Not applicable (panes are live web pages, not shells): copy-mode <kbd>[</kbd>, paste-buffers <kbd>]</kbd>/<kbd>=</kbd>, client switching <kbd>(</kbd>/<kbd>)</kbd>/<kbd>D</kbd>.</div>';
      card.innerHTML = h;
    });
  }
  function showClock() {
    var m = modal(function (card) { var c = document.createElement('div'); c.className = 'zt-clock'; card.appendChild(c); tickClock(c); });
    function tickClock(c) { function t() { if (!c.isConnected) return; var d = new Date(); c.textContent = ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2) + ':' + ('0' + d.getSeconds()).slice(-2); setTimeout(t, 1000); } t(); }
    return m;
  }
  function showChooser() {
    modal(function (card) {
      card.innerHTML = '<h4>windows</h4>';
      S.windows.forEach(function (win, i) {
        var row = document.createElement('div'); row.className = 'zt-wrow' + (i === S.active ? ' sel' : '');
        row.textContent = i + ': ' + (win.name || label(win)) + '  (' + leaves(win.tree).length + ' panes)';
        row.addEventListener('click', function () { S.active = i; render(); focusActive(); var m = card.parentNode; if (m) m.remove(); });
        card.appendChild(row);
      });
    }, function (k, close) { if (/^[0-9]$/.test(k)) { selectWindowNum(parseInt(k, 10)); render(); close(); return false; } });
  }
  function showPaneNumbers() {
    var badges = [];
    var ls = leaves(W().tree);
    ls.forEach(function (l, i) { var p = panes[l.id]; if (!p) return; var b = document.createElement('div'); b.className = 'zt-pnum'; b.textContent = i; p.wrap.appendChild(b); badges.push(b); });
    function cleanup() { badges.forEach(function (b) { try { b.remove(); } catch (e) {} }); document.removeEventListener('keydown', key, true); }
    function key(e) {
      e.preventDefault(); e.stopImmediatePropagation();
      if (/^[0-9]$/.test(e.key)) { var n = parseInt(e.key, 10); if (ls[n]) setActivePane(ls[n].id); }
      cleanup(); render(); focusActive();
    }
    document.addEventListener('keydown', key, true);
    setTimeout(function () { try { cleanup(); } catch (e) {} }, 3000);
  }
  function promptModal(title, initial, onOk) {
    var m = document.createElement('div'); m.className = 'zt-modal';
    var card = document.createElement('div'); card.className = 'zt-card'; card.innerHTML = '<h4>' + escq(title) + '</h4>';
    var inp = document.createElement('input'); inp.className = 'zt-addr'; inp.value = initial == null ? '' : String(initial);
    inp.style.cssText = 'background:var(--bg-primary,#05060a);color:var(--text,#c8d2e0);border:1px solid var(--cyan,#05d9e8);font:inherit;padding:6px 10px;width:220px;outline:none;';
    card.appendChild(inp); m.appendChild(card); bodyEl.appendChild(m);
    function close() { try { m.remove(); } catch (e) {} focusActive(); }
    inp.addEventListener('keydown', function (e) { e.stopPropagation(); if (e.key === 'Enter') { close(); onOk(inp.value); } else if (e.key === 'Escape') close(); });
    m.addEventListener('mousedown', function (e) { if (e.target === m) close(); });
    setTimeout(function () { try { inp.focus(); inp.select(); } catch (e) {} }, 0);
  }
  function moveWindow() {
    promptModal('Move window ' + S.active + ' to index', S.active, function (v) {
      var n = parseInt(v, 10); if (isNaN(n)) return;
      n = Math.max(0, Math.min(S.windows.length - 1, n));
      var win = S.windows.splice(S.active, 1)[0]; S.windows.splice(n, 0, win); S.active = n; render(); focusActive();
    });
  }
  function winGoto() { promptModal('Go to window index', '', function (v) { var n = parseInt(v, 10); if (!isNaN(n)) { selectWindowNum(n); render(); focusActive(); } }); }
  function renameWindow() {
    promptModal('Rename window ' + S.active, W().name || '', function (v) { W().name = v.trim(); render(); focusActive(); });
  }

  // re-theme the overlay when the scheme changes (matches the rest of the HUD).
  try { chrome.storage.onChanged.addListener(function (ch, area) { if (area !== 'local') return; if (ch.zb_scheme) applyTheme(); if (ch.zb_frecent || ch.zb_tabs) loadNav(); if (ch.zb_keys) buildKeys(ch.zb_keys.newValue || {}); if (ch.zb_tmux_load && ch.zb_tmux_load.newValue) loadSessionById(ch.zb_tmux_load.newValue.id); }); } catch (e) {}

  // restore any tmux session persisted before a reload (per-tab sessionStorage).
  restore();

  // expose an opener for the ⌘K palette / vim ':' if they want it
  window.__zbTmuxOpen = function () { open = true; render(); focusActive(); };
  // let the command palette drive the ACTIVE PANE instead of opening a new tab
  // (zpalette shares this top-frame world and checks these when the overlay is up).
  window.__zbTmuxIsOpen = function () { return open; };
  window.__zbTmuxGo = function (url) {
    if (!open) return false;
    var l = activeLeaf(), p = l && panes[l.id]; if (!l || !p) return false;
    l.url = url; p.url = url;
    if (p.addr) p.addr.value = (url && url !== 'about:blank' && url !== NEWTAB) ? url : '';
    try { p.frame.src = normalizeUrl(url); } catch (e) {}
    render(); try { p.frame.focus(); } catch (e) {}
    return true;
  };
})();
