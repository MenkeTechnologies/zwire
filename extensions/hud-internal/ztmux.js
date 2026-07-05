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
  // Prefix: Ctrl-b (the real one — but the fork's native-split patch eats it until
  // the fork is rebuilt) OR ⌥-b (Alt-b, which nothing intercepts — use it to test
  // the overlay now, pre-rebuild).
  function isPrefix(e) {
    if (e.metaKey) return false;
    if (e.ctrlKey && !e.altKey && (e.key === 'b' || e.key === 'B')) return true;
    if (e.altKey && !e.ctrlKey && e.code === 'KeyB') return true;
    return false;
  }

  /* ===================== PANE FRAME: forwarder + sync ===================== */
  if (!TOP) {
    var pArmed = false, pTimer = null, pSync = false;
    function up(o) { try { parent.postMessage(Object.assign({ __zbtmux: 1 }, o), '*'); } catch (e) {} }
    document.addEventListener('keydown', function (e) {
      if (pArmed) {
        if (e.key === 'Shift' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Meta') return;
        pArmed = false; clearTimeout(pTimer);
        e.preventDefault(); e.stopImmediatePropagation();
        up({ cmdKey: e.key });
        return;
      }
      if (isPrefix(e)) {
        e.preventDefault(); e.stopImmediatePropagation();
        pArmed = true; clearTimeout(pTimer); pTimer = setTimeout(function () { pArmed = false; }, 2500);
        up({ prefix: 1 });
        return;
      }
      if (pSync && !e.ctrlKey && !e.metaKey && !e.altKey && editable(document.activeElement) &&
          (e.key.length === 1 || e.key === 'Enter' || e.key === 'Backspace')) {
        up({ synckey: e.key });
      }
    }, true);
    window.addEventListener('message', function (ev) {
      var d = ev.data; if (!d || !d.__zbtmux) return;
      if (d.setSync != null) pSync = !!d.setSync;
      else if (d.syncapply) applyKey(d.syncapply);
    });
    function setNative(el, v) { try { var d = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value'); if (d && d.set) { d.set.call(el, v); return; } } catch (e) {} el.value = v; }
    function applyKey(k) {
      var el = document.activeElement; if (!editable(el)) return; var hasVal = ('value' in el);
      if (k === 'Backspace') { if (hasVal) { setNative(el, el.value.slice(0, -1)); el.dispatchEvent(new Event('input', { bubbles: true })); } else { try { document.execCommand('delete'); } catch (e) {} } }
      else if (k === 'Enter') { el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); }
      else if (k.length === 1) { if (hasVal) { setNative(el, el.value + k); el.dispatchEvent(new Event('input', { bubbles: true })); } else { try { document.execCommand('insertText', false, k); } catch (e) {} } }
    }
    return;
  }

  /* ============================ TOP FRAME: state ============================ */
  var NEWTAB = 'chrome://newtab';           // every fresh pane opens the zwire new-tab
  var uid = 0; function nid(p) { return (p || 'p') + (++uid); }
  function leaf(url) { return { t: 'leaf', id: nid('p'), url: url || NEWTAB, title: '' }; }
  function mkWindow(url) { var l = leaf(url); return { id: nid('w'), name: '', tree: l, active: l.id, zoom: null, sync: false }; }
  var S = { windows: [mkWindow(NEWTAB)], active: 0 };
  var open = false, armed = false, armTimer = null;

  function W() { return S.windows[S.active]; }
  function leaves(n, out) { out = out || []; if (n.t === 'leaf') out.push(n); else { leaves(n.a, out); leaves(n.b, out); } return out; }
  function findLeaf(id) { var ls = leaves(W().tree); for (var i = 0; i < ls.length; i++) if (ls[i].id === id) return ls[i]; return null; }
  function activeLeaf() { return findLeaf(W().active) || leaves(W().tree)[0]; }
  function splitContaining(node, target, par) {
    if (node.t !== 'split') return null;
    if (node.a === target || node.b === target) return { split: node, par: par };
    return splitContaining(node.a, target, node) || splitContaining(node.b, target, node);
  }

  /* ------------------------------- commands ------------------------------- */
  function splitPane(dir) {                   // 'row' = side by side, 'col' = stacked
    var w = W(), L = activeLeaf(); if (!L) return;
    var N = leaf(''), sp = { t: 'split', dir: dir, a: L, b: N };
    if (w.tree === L) { w.tree = sp; }
    else { var info = splitContaining(w.tree, L, null); if (info.par) { if (info.par.a === info.split) info.par.a = sp; else info.par.b = sp; } else w.tree = sp; }
    w.active = N.id; w.zoom = null;
  }
  function closePane() {
    var w = W(), L = activeLeaf(); if (!L) return;
    if (w.tree === L) { killWindow(); return; }
    var info = splitContaining(w.tree, L, null);
    var sib = info.split.a === L ? info.split.b : info.split.a;
    if (!info.par) w.tree = sib; else { if (info.par.a === info.split) info.par.a = sib; else info.par.b = sib; }
    w.active = leaves(sib)[0].id; w.zoom = null;
    dropPane(L.id);
  }
  function navCycle(delta) { var w = W(), ls = leaves(w.tree), i = 0; for (var k = 0; k < ls.length; k++) if (ls[k].id === w.active) i = k; w.active = ls[(i + delta + ls.length) % ls.length].id; }
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
    if (best) w.active = best.id;
  }
  function addWindow() { S.windows.push(mkWindow('')); S.active = S.windows.length - 1; }
  function cycleWindow(delta) { if (S.windows.length < 2) return; S.active = (S.active + delta + S.windows.length) % S.windows.length; }
  function killWindow() {
    leaves(W().tree).forEach(function (l) { dropPane(l.id); });
    S.windows.splice(S.active, 1);
    if (!S.windows.length) { open = false; S.windows.push(mkWindow('')); S.active = 0; return; }
    S.active = Math.min(S.active, S.windows.length - 1);
  }
  function toggleSync() { var w = W(); w.sync = !w.sync; broadcastSync(w); }

  function exec(k) {
    if (!open) open = true;
    var w = W();
    switch (k) {
      case '%': case '5': splitPane('row'); break;
      case '"': case "'": splitPane('col'); break;
      case 'c': addWindow(); break;
      case 'x': closePane(); break;
      case '&': killWindow(); break;
      case 'o': navCycle(1); break;
      case ';': navCycle(-1); break;
      case 'n': cycleWindow(1); break;
      case 'p': cycleWindow(-1); break;
      case 'z': w.zoom = w.zoom ? null : w.active; break;
      case 'e': toggleSync(); break;
      case 'd': open = false; break;
      case 'ArrowLeft': navDir('left'); break;
      case 'ArrowRight': navDir('right'); break;
      case 'ArrowUp': navDir('up'); break;
      case 'ArrowDown': navDir('down'); break;
      default: return;
    }
    render(); focusActive();
  }

  /* --------------------------------- DOM ---------------------------------- */
  var root, tabsEl, bodyEl, styleEl;
  var panes = {};          // leafId -> { wrap, frame, addr, titleEl, url }
  var paneRects = {};      // leafId -> {x,y,w,h} in % (active window only)

  var CSS = [
    // leave the bottom 22px for the real powerline statusbar (zstatus.js).
    '#zbtmux{position:fixed;top:0;left:0;right:0;bottom:22px;z-index:2147483640;display:none;flex-direction:column;',
    ' background:#05060a;font-family:"Share Tech Mono",Monaco,monospace;color:#c8d2e0;}',
    '#zbtmux.on{display:flex;}',
    '#zbtmux .zt-tabs{display:flex;gap:2px;align-items:stretch;height:26px;background:#0a0d16;',
    ' border-bottom:1px solid #05d9e8;padding:0 6px;overflow-x:auto;flex-shrink:0;}',
    '#zbtmux .zt-tab{display:flex;align-items:center;gap:6px;padding:0 12px;font-size:12px;',
    ' color:#5a6b82;cursor:pointer;border-top:2px solid transparent;white-space:nowrap;}',
    '#zbtmux .zt-tab.act{color:#05060a;background:#05d9e8;font-weight:700;}',
    '#zbtmux .zt-tab .zt-sync{color:#ff2a6d;font-size:10px;}',
    '#zbtmux .zt-body{position:relative;flex:1;overflow:hidden;}',
    '#zbtmux .zt-pane{position:absolute;display:flex;flex-direction:column;overflow:hidden;',
    ' border:1px solid #1a2436;box-sizing:border-box;}',
    '#zbtmux .zt-pane.act{border-color:#05d9e8;box-shadow:inset 0 0 0 1px #05d9e8,0 0 14px rgba(5,217,232,.35);}',
    '#zbtmux .zt-ttl{display:flex;align-items:center;gap:6px;height:22px;padding:0 8px;background:#0a0d16;',
    ' font-size:11px;color:#7d8aa0;flex-shrink:0;border-bottom:1px solid #1a2436;}',
    '#zbtmux .zt-pane.act .zt-ttl{color:#05d9e8;}',
    '#zbtmux .zt-addr{flex:1;min-width:0;background:transparent;border:none;outline:none;color:inherit;',
    ' font:inherit;padding:2px 0;}',
    '#zbtmux .zt-x{cursor:pointer;color:#ff2a6d;padding:0 2px;font-size:12px;}',
    '#zbtmux .zt-fr{flex:1;border:0;width:100%;background:#fff;}',
    '#zbtmux .zt-pane:not(.act) .zt-cover{position:absolute;inset:22px 0 0 0;z-index:2;cursor:pointer;background:transparent;}'
  ].join('');

  function ensureDom() {
    if (root) return;
    styleEl = document.createElement('style'); styleEl.textContent = CSS;
    (document.head || document.documentElement).appendChild(styleEl);
    root = document.createElement('div'); root.id = 'zbtmux';
    tabsEl = document.createElement('div'); tabsEl.className = 'zt-tabs';
    bodyEl = document.createElement('div'); bodyEl.className = 'zt-body';
    root.appendChild(tabsEl); root.appendChild(bodyEl);
    (document.body || document.documentElement).appendChild(root);
  }

  function normalizeUrl(v) {
    v = (v || '').trim(); if (!v) return 'about:blank';
    if (/^[a-z]+:\/\//i.test(v) || v === 'about:blank') return v;
    if (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(v) && v.indexOf(' ') < 0) return 'https://' + v;
    return 'https://www.google.com/search?q=' + encodeURIComponent(v);
  }
  function makePane(l) {
    var wrap = document.createElement('div'); wrap.className = 'zt-pane';
    var ttl = document.createElement('div'); ttl.className = 'zt-ttl';
    var addr = document.createElement('input'); addr.className = 'zt-addr'; addr.spellcheck = false;
    addr.placeholder = 'url or search …'; addr.value = (l.url && l.url !== 'about:blank' && l.url !== NEWTAB) ? l.url : '';
    var x = document.createElement('span'); x.className = 'zt-x'; x.textContent = '✕';
    ttl.appendChild(addr); ttl.appendChild(x);
    var fr = document.createElement('iframe'); fr.className = 'zt-fr'; fr.name = 'zbtmux';
    fr.setAttribute('allow', 'clipboard-read; clipboard-write; fullscreen');
    fr.src = normalizeUrl(l.url);
    var cover = document.createElement('div'); cover.className = 'zt-cover';
    wrap.appendChild(ttl); wrap.appendChild(fr); wrap.appendChild(cover);
    var rec = { wrap: wrap, frame: fr, addr: addr, url: l.url };
    addr.addEventListener('keydown', function (e) { e.stopPropagation(); if (e.key === 'Enter') { l.url = addr.value; rec.url = addr.value; fr.src = normalizeUrl(addr.value); fr.focus(); } });
    addr.addEventListener('focus', function () { setActive(l.id); });
    x.addEventListener('click', function (e) { e.stopPropagation(); setActive(l.id); closePane(); });
    cover.addEventListener('mousedown', function () { setActive(l.id); focusActive(); });
    wrap.addEventListener('mousedown', function () { setActive(l.id); });
    panes[l.id] = rec; bodyEl.appendChild(wrap);
    return rec;
  }
  function dropPane(id) { var p = panes[id]; if (p) { try { p.wrap.remove(); } catch (e) {} delete panes[id]; } }

  function computeRects(node, x, y, w, h, out) {
    if (node.t === 'leaf') { out[node.id] = { x: x, y: y, w: w, h: h }; return; }
    if (node.dir === 'row') { computeRects(node.a, x, y, w / 2, h, out); computeRects(node.b, x + w / 2, y, w / 2, h, out); }
    else { computeRects(node.a, x, y, w, h / 2, out); computeRects(node.b, x, y + h / 2, w, h / 2, out); }
  }

  function setActive(id) { W().active = id; render(); }
  function focusActive() {
    var l = activeLeaf(), p = l && panes[l.id]; if (!p) return;
    // A fresh/blank pane: land in its address bar so you can type where to go.
    if (!l.url || l.url === 'about:blank') { try { p.addr.focus(); return; } catch (e) {} }
    try { p.frame.focus(); } catch (e) {}
  }

  function render() {
    ensureDom();
    root.classList.toggle('on', open);
    if (!open) return;
    // tabs
    tabsEl.innerHTML = '';
    S.windows.forEach(function (win, i) {
      var t = document.createElement('div'); t.className = 'zt-tab' + (i === S.active ? ' act' : '');
      t.textContent = (i) + ': ' + (win.name || label(win));
      if (win.sync) { var s = document.createElement('span'); s.className = 'zt-sync'; s.textContent = '⇄'; t.appendChild(s); }
      t.addEventListener('click', function () { S.active = i; render(); focusActive(); });
      tabsEl.appendChild(t);
    });
    // panes: show only the active window's leaves, hide the rest (kept alive)
    var cur = {}; leaves(W().tree).forEach(function (l) { cur[l.id] = l; if (!panes[l.id]) makePane(l); });
    var rects = {}; paneRects = rects; computeRects(W().tree, 0, 0, 100, 100, rects);
    var zoom = W().zoom;
    Object.keys(panes).forEach(function (id) {
      var p = panes[id];
      if (!cur[id]) { p.wrap.style.display = 'none'; return; }       // belongs to another window
      if (zoom && id !== zoom) { p.wrap.style.display = 'none'; return; }
      var r = zoom ? { x: 0, y: 0, w: 100, h: 100 } : rects[id];
      p.wrap.style.display = 'flex';
      p.wrap.style.left = r.x + '%'; p.wrap.style.top = r.y + '%';
      p.wrap.style.width = r.w + '%'; p.wrap.style.height = r.h + '%';
      p.wrap.classList.toggle('act', id === W().active);
    });
    // Feed the REAL powerline statusbar (zstatus.js reads zb_tmux) instead of a
    // hand-rolled bar — it renders the window/pane/zoom/sync segment for us.
    publishTmux();
  }
  function label(win) { var l = leaves(win.tree)[0]; try { return l.url && l.url !== NEWTAB ? new URL(normalizeUrl(l.url)).hostname.replace(/^www\./, '') : 'newtab'; } catch (e) { return 'newtab'; } }
  function publishTmux() {
    try {
      var st = open ? {
        windows: S.windows.map(function (win) { return { name: win.name || label(win), panes: leaves(win.tree).length, zoom: !!win.zoom, sync: !!win.sync }; }),
        active: S.active, anySync: S.windows.some(function (win) { return win.sync; })
      } : { windows: [] };
      chrome.storage.local.set({ zb_tmux: st });
    } catch (e) {}
  }

  /* -------------------------------- sync ---------------------------------- */
  function broadcastSync(win) { leaves(win.tree).forEach(function (l) { var p = panes[l.id]; if (p) try { p.frame.contentWindow.postMessage({ __zbtmux: 1, setSync: win.sync }, '*'); } catch (e) {} }); }
  function relaySync(source, key) {
    var w = W(); if (!w.sync) return;
    leaves(w.tree).forEach(function (l) {
      var p = panes[l.id]; if (!p || p.frame.contentWindow === source) return;
      try { p.frame.contentWindow.postMessage({ __zbtmux: 1, syncapply: key }, '*'); } catch (e) {}
    });
  }

  /* ----------------------------- key handling ----------------------------- */
  function armTop() { armed = true; clearTimeout(armTimer); armTimer = setTimeout(function () { armed = false; render(); }, 2500); render(); }
  document.addEventListener('keydown', function (e) {
    if (armed) {
      if (e.key === 'Shift' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Meta') return;
      armed = false; clearTimeout(armTimer);
      e.preventDefault(); e.stopImmediatePropagation();
      if (e.key !== 'Escape') exec(e.key); else render();
      return;
    }
    if (isPrefix(e)) {
      e.preventDefault(); e.stopImmediatePropagation(); armTop();
    }
  }, true);

  // commands + sync relayed up from pane iframes
  window.addEventListener('message', function (ev) {
    var d = ev.data; if (!d || !d.__zbtmux) return;
    if (d.prefix) { armed = true; clearTimeout(armTimer); armTimer = setTimeout(function () { armed = false; render(); }, 2500); render(); }
    else if (d.cmdKey) { armed = false; exec(d.cmdKey); }
    else if (d.synckey) { relaySync(ev.source, d.synckey); }
  });

  // expose an opener for the ⌘K palette / vim ':' if they want it
  window.__zbTmuxOpen = function () { open = true; render(); focusActive(); };
})();
