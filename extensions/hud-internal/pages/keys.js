/* zwire HUD — Keyboard settings. Remap ALL zwire shortcuts (vim motions,
 * palette, find, tabs, marks) from one page. Overrides live in
 * chrome.storage.local 'zb_keys' { <action>: <key> }; the content scripts
 * (zvim/zpalette/zfind) merge them over the defaults in zkeys.js. Extension
 * command shortcuts have their own page (Extensions › Shortcuts). */
(function () {
  'use strict';
  var Z = window.ZGui;
  var esc = (Z.util && Z.util.escapeHtml) || function (s) { return String(s == null ? '' : s); };
  var REG = window.ZWIRE_KEYMAP || { categories: [], global: [], native: [] };
  var overrides = {};        // zb_keys
  var filter = '';
  var capturing = null;
  var prefix = null;         // zb_tmux_prefix (chord list) — null = default C-b / ⌥B
  var opts = {};             // zb_tmux_opts { timeout }

  // Single-char keys offered as "free" suggestions (letters + digits). Symbols,
  // arrows and Space are also bindable, but this is what people reach for.
  var FREE_CANDIDATES = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('');
  (function () {
    var s = document.createElement('style');
    s.textContent =
      '.key-warn{color:var(--magenta,#ff4da6);font-size:11px;margin-left:8px;}' +
      '.key-conflict .ik::before{content:"\\26A0 ";color:var(--magenta,#ff4da6);}' +
      '.key-free{padding:8px 2px 2px;line-height:2.1;}' +
      '.key-free .sub{margin-right:6px;}' +
      '.xt-kbd-free{opacity:.6;cursor:default;font-weight:400;}';
    document.head.appendChild(s);
  })();

  var shell = window.ZBHUD.mount({
    title: 'KEYBOARD', current: 'keys.html', filterPlaceholder: '>_ filter shortcuts…',
    onFilter: function (v) { filter = (v || '').toLowerCase(); render(); }
  });
  var body = shell.body;

  function keyOf(a) { return overrides[a.name] || a.def; }
  function match(a) { return !filter || (a.label + ' ' + a.name + ' ' + keyOf(a)).toLowerCase().indexOf(filter) >= 0; }
  function save(cb) { try { chrome.storage.local.set({ zb_keys: overrides }, function () { void chrome.runtime.lastError; if (cb) cb(); }); } catch (e) { if (cb) cb(); } }

  // The action group an action lives in — that's its keyspace. tmux post-prefix
  // keys, vim-mode keys, palette keys and the global chords are independent
  // contexts, so a clash only matters WITHIN the same group.
  function groupOf(name) {
    var g = null;
    (REG.categories || []).forEach(function (c) { if (c.actions.some(function (x) { return x.name === name; })) g = c.actions; });
    if (!g && REG.global && REG.global.some(function (x) { return x.name === name; })) g = REG.global;
    return g;
  }
  // detect a conflict: another action in the SAME group bound to the same key
  function conflict(name, key) {
    var hit = null;
    (groupOf(name) || []).forEach(function (a) { if (a.name !== name && keyOf(a) === key) hit = a.label; });
    return hit;
  }

  function startCapture(chip, a) {
    if (capturing) endCapture();
    capturing = { chip: chip, a: a };
    chip.textContent = 'press a key…'; chip.classList.add('capturing');
    document.addEventListener('keydown', onCap, true);
  }
  function endCapture() { if (!capturing) return; document.removeEventListener('keydown', onCap, true); capturing = null; }
  function onCap(e) {
    if (!capturing) return;
    e.preventDefault(); e.stopImmediatePropagation();
    if (e.key === 'Escape') { endCapture(); render(); return; }
    if (['Shift', 'Control', 'Alt', 'Meta'].indexOf(e.key) >= 0) return;   // wait for the real key
    var a = capturing.a, key = e.key;
    endCapture();
    if (key === a.def) { delete overrides[a.name]; }   // back to default
    else { overrides[a.name] = key; }
    var c = conflict(a.name, key);
    save(function () { if (c && Z.toast) Z.toast.show('⚠ "' + (key === ' ' ? 'Space' : key) + '" is also bound to "' + c + '" — both fire on that key'); render(); });
  }

  function chipFor(a) {
    var cur = keyOf(a), isOver = !!overrides[a.name];
    var kbd = document.createElement('kbd');
    kbd.className = 'xt-kbd xt-kbd-edit'; kbd.tabIndex = 0; kbd.title = 'click to remap';
    kbd.textContent = cur === ' ' ? 'Space' : cur;
    kbd.addEventListener('click', function () { startCapture(kbd, a); });
    kbd.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); startCapture(kbd, a); } });
    var wrap = document.createElement('span');
    wrap.appendChild(kbd);
    if (isOver) {
      var reset = document.createElement('button'); reset.className = 'zs-btn zs-btn-mini'; reset.textContent = 'reset';
      reset.style.marginLeft = '8px';
      reset.addEventListener('click', function () { delete overrides[a.name]; save(render); });
      wrap.appendChild(reset);
    }
    return wrap;
  }

  function catCard(cat) {
    var acts = cat.actions.filter(match);
    if (!acts.length) return null;
    // key -> [labels] across the WHOLE group (its keyspace) so we can flag
    // clashes and list which keys are still free, regardless of the filter.
    var used = {};
    cat.actions.forEach(function (a) { var k = keyOf(a); (used[k] = used[k] || []).push(a.label); });
    var inner = document.createElement('div');
    inner.appendChild(el('div', 'set-h', '// ' + cat.label.toUpperCase()));
    var list = el('div', 'info-list');
    acts.forEach(function (a) {
      var row = el('div', 'info-row');
      var k = keyOf(a);
      var shared = (used[k] || []).filter(function (l) { return l !== a.label; });
      if (shared.length) row.className += ' key-conflict';   // ⚠ marker on the label
      row.appendChild(el('span', 'ik', esc(a.label)));
      var iv = el('span', 'iv'); iv.appendChild(chipFor(a));
      if (overrides[a.name]) { var d = el('span', 'sub'); d.textContent = ' default ' + a.def; iv.appendChild(d); }
      if (shared.length) iv.appendChild(el('span', 'key-warn', 'also runs ' + esc(shared.join(', '))));
      row.appendChild(iv);
      list.appendChild(row);
    });
    inner.appendChild(list);
    // Which keys in this section are still unbound — so you can pick one that
    // won't clash. (Only when not filtering, so the set is meaningful.)
    if (!filter) {
      var free = FREE_CANDIDATES.filter(function (c) { return !used[c]; });
      var fl = el('div', 'key-free');
      fl.appendChild(el('span', 'sub', 'Free keys:'));
      if (free.length) { free.forEach(function (c) { fl.appendChild(el('kbd', 'xt-kbd xt-kbd-free', esc(c))); }); }
      else { fl.appendChild(el('span', 'sub', '(every a–z / 0–9 is taken)')); }
      inner.appendChild(fl);
    }
    return Z.card({ body: inner }).el;
  }
  function el(t, c, h) { var e = document.createElement(t); if (c) e.className = c; if (h != null) e.innerHTML = h; return e; }

  /* ---- tmux prefix + options (drives ztmux.js via chrome.storage.local) ---- */
  function fmtChord(c) {
    var s = ''; if (c.ctrl) s += 'C-'; if (c.alt) s += '⌥'; if (c.meta) s += '⌘'; if (c.shift) s += '⇧';
    var k = c.key || (c.code ? c.code.replace(/^Key/, '') : '?');
    return s + (k.length === 1 ? k.toUpperCase() : k);
  }
  function prefixLabel() { return (prefix && prefix.length) ? prefix.map(fmtChord).join(' / ') : 'C-b / ⌥B'; }
  function saveTmux(cb) {
    try {
      var set = { zb_tmux_opts: opts };
      if (prefix && prefix.length) { set.zb_tmux_prefix = prefix; chrome.storage.local.set(set, function () { void chrome.runtime.lastError; if (cb) cb(); }); }
      else { chrome.storage.local.remove('zb_tmux_prefix', function () { void chrome.runtime.lastError; chrome.storage.local.set(set, function () { void chrome.runtime.lastError; if (cb) cb(); }); }); }
    } catch (e) { if (cb) cb(); }
  }
  function capturePrefix(chip) {
    chip.textContent = 'press a chord…'; chip.classList.add('capturing');
    function h(e) {
      e.preventDefault(); e.stopImmediatePropagation();
      if (e.key === 'Escape') { document.removeEventListener('keydown', h, true); render(); return; }
      if (['Shift', 'Control', 'Alt', 'Meta'].indexOf(e.key) >= 0) return;   // wait for the real key
      var c = {}; if (e.ctrlKey) c.ctrl = true; if (e.altKey) c.alt = true; if (e.metaKey) c.meta = true;
      if (!c.ctrl && !c.alt && !c.meta) { chip.textContent = 'need Ctrl/Alt/⌘ …'; return; }   // a bare key would arm constantly
      c.key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      document.removeEventListener('keydown', h, true);
      prefix = [c]; saveTmux(render);
    }
    document.addEventListener('keydown', h, true);
  }
  function tmuxPanel() {
    var inner = el('div');
    inner.appendChild(el('div', 'set-h', '// TMUX · PREFIX & OPTIONS'));
    var list = el('div', 'info-list');
    // prefix row
    var pr = el('div', 'info-row'); pr.appendChild(el('span', 'ik', 'Prefix (arms the overlay)'));
    var pv = el('span', 'iv');
    var chip = document.createElement('kbd'); chip.className = 'xt-kbd xt-kbd-edit'; chip.tabIndex = 0; chip.title = 'click to set a new prefix chord';
    chip.textContent = prefixLabel();
    chip.addEventListener('click', function () { capturePrefix(chip); });
    chip.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); capturePrefix(chip); } });
    pv.appendChild(chip);
    if (prefix && prefix.length) { var rb = Z.button({ label: 'reset', variant: 'mini', onClick: function () { prefix = null; saveTmux(render); } }); rb.style.marginLeft = '8px'; pv.appendChild(rb); }
    pr.appendChild(pv); list.appendChild(pr);
    // timeout row
    var tr = el('div', 'info-row'); tr.appendChild(el('span', 'ik', 'Prefix timeout (ms)'));
    var tv = el('span', 'iv');
    var ti = document.createElement('input'); ti.type = 'number'; ti.min = '200'; ti.step = '100'; ti.className = 'zs-input'; ti.style.width = '90px';
    ti.value = (typeof opts.timeout === 'number' ? opts.timeout : 2500);
    ti.addEventListener('change', function () { var v = parseInt(ti.value, 10); opts.timeout = (v > 0 ? v : 2500); saveTmux(); });
    tv.appendChild(ti); tr.appendChild(tv); list.appendChild(tr);
    inner.appendChild(list);
    return Z.card({ body: inner }).el;
  }

  function render() {
    body.innerHTML = '';
    // toolbar: reset-all + extension-shortcuts link
    var bar = el('div', 'ci-toolbar');
    bar.appendChild(el('div', 'ci-hint', 'Click a key to remap · Esc cancel · press the default to clear an override. The tmux prefix is rebindable below (default Ctrl-b / ⌥B).'));
    var acts = el('div', 'ci-actions');
    acts.appendChild(Z.button({ label: 'RESET ALL', variant: 'mini', onClick: function () { overrides = {}; save(render); } }));
    acts.appendChild(Z.button({ label: 'EXTENSION SHORTCUTS ↗', variant: 'mini', onClick: function () { try { chrome.tabs.create({ url: chrome.runtime.getURL('pages/extensions.html') + '#shortcuts' }); } catch (e) {} } }));
    bar.appendChild(acts);
    body.appendChild(Z.card({ body: bar }).el);
    if (!filter) body.appendChild(tmuxPanel());

    (REG.categories || []).forEach(function (c) { var card = catCard(c); if (card) body.appendChild(card); });

    // global chorded hotkeys (⌘/Ctrl + key)
    if (REG.global && REG.global.length) {
      var gcat = { label: 'Global (⌘/Ctrl +)', actions: REG.global };
      var g = catCard(gcat); if (g) body.appendChild(g);
    }
    // native, read-only
    if (REG.native && REG.native.length) {
      var inner = el('div');
      inner.appendChild(el('div', 'set-h', '// NATIVE (FIXED)'));
      var list = el('div', 'info-list');
      REG.native.forEach(function (a) {
        var row = el('div', 'info-row');
        row.appendChild(el('span', 'ik', esc(a.label)));
        row.appendChild(el('span', 'iv', '<kbd class="xt-kbd">' + esc(a.def) + '</kbd> <span class="sub">built into the fork</span>'));
        list.appendChild(row);
      });
      inner.appendChild(list);
      body.appendChild(Z.card({ body: inner }).el);
    }
  }

  try {
    chrome.storage.local.get(['zb_keys', 'zb_tmux_prefix', 'zb_tmux_opts'], function (o) {
      void chrome.runtime.lastError;
      overrides = (o && o.zb_keys) || {};
      prefix = (o && Array.isArray(o.zb_tmux_prefix) && o.zb_tmux_prefix.length) ? o.zb_tmux_prefix : null;
      opts = (o && o.zb_tmux_opts) || {};
      render();
    });
  } catch (e) { render(); }
})();
