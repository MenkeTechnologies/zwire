/* zwire HUD — tmux/powerline statusbar pinned to the bottom of every page.
 * LEFT: ZW · C-b prefix · scheme · VIM · ⌘K.  RIGHT (real machine stats via the
 * native host → zb_sys): CPU · MEM · SWAP · DISK · IO · NET · LOAD · UP · TEMP ·
 * BATT · LAN · WAN · host · clock. Full powerline chevrons (► left half, ◄ right
 * half). Themed by the active scheme. Top frame only. Toggle via ⌘K palette. */
(function () {
  'use strict';
  if (window.top !== window) return;
  if (window.__zbStatusLoaded) return;
  window.__zbStatusLoaded = true;
  var HUD = window.ZWIRE_HUD || {};
  var SCHEMES = HUD.SCHEMES || {};
  var VAR_KEYS = HUD.VAR_KEYS || [];

  var CH = 'border-top:11px solid transparent;border-bottom:11px solid transparent;';   // chevron top/bottom
  var BAR_CSS = [
    '#zb-statusbar{position:fixed;left:0;right:0;bottom:0;height:22px;z-index:2147483644;display:flex;align-items:center;overflow:hidden;',
    ' gap:0;font:11px/22px "Share Tech Mono",Monaco,monospace;color:var(--text,#c8f5ff);',
    ' background:color-mix(in srgb,var(--bg-primary,#0a0a12) 90%,transparent);border-top:1px solid var(--border,#1b2b3a);',
    ' box-shadow:0 -6px 18px rgba(0,0,0,.35);backdrop-filter:blur(3px);user-select:none;}',
    '#zb-statusbar .seg{display:flex;align-items:center;gap:4px;padding:0 8px;height:100%;white-space:nowrap;}',
    '#zb-statusbar .k{color:var(--text-muted,#6b7b8a);}',
    '#zb-statusbar .flex{flex:1;min-width:0;}',
    '#zb-statusbar .scheme{color:var(--accent,#ff2a6d);text-transform:uppercase;letter-spacing:1px;}',
    '#zb-statusbar .vim{color:var(--green,#3bf58a);letter-spacing:1px;}',
    '#zb-statusbar .clock{color:var(--accent,#ff2a6d);}',
    '#zb-statusbar .kbd{cursor:pointer;} #zb-statusbar .kbd:hover{color:var(--cyan,#05d9e8);}',
    '#zb-statusbar .prefix{letter-spacing:1px;}',
    // ── powerline ──  sig (cyan) ► then alternating shade blocks
    '#zb-statusbar .sig{background:var(--cyan,#05d9e8);color:var(--bg-primary,#0a0a12);font-weight:bold;padding:0 8px;position:relative;letter-spacing:1px;}',
    '#zb-statusbar .sig::after{content:"";position:absolute;left:100%;top:0;z-index:3;' + CH + 'border-left:9px solid var(--cyan,#05d9e8);}',
    // C-b prefix block (dim → accent when armed)
    '#zb-statusbar .seg.pfx{position:relative;background:var(--bg-card,#12121c);color:var(--text-muted,#6b7b8a);padding-left:13px;transition:background .12s,color .12s;}',
    '#zb-statusbar .seg.pfx::after{content:"";position:absolute;left:100%;top:0;z-index:3;' + CH + 'border-left:9px solid var(--bg-card,#12121c);transition:border-color .12s;}',
    '#zb-statusbar .seg.pfx:has(.prefix.on){background:var(--accent,#ff2a6d);color:var(--bg-primary,#0a0a12);}',
    '#zb-statusbar .seg.pfx:has(.prefix.on)::after{border-left-color:var(--accent,#ff2a6d);}',
    // left powerline (► after each), alternating shades
    '#zb-statusbar .pll{position:relative;padding-left:14px;}',
    '#zb-statusbar .pll.s0{background:var(--bg-card,#12121c);} #zb-statusbar .pll.s1{background:var(--bg-secondary,#161622);}',
    '#zb-statusbar .pll::after{content:"";position:absolute;left:100%;top:0;z-index:3;' + CH + 'border-left:9px solid transparent;}',
    '#zb-statusbar .pll.s0::after{border-left-color:var(--bg-card,#12121c);} #zb-statusbar .pll.s1::after{border-left-color:var(--bg-secondary,#161622);}',
    // right powerline (◄ before each), alternating shades
    '#zb-statusbar .plr{position:relative;padding-right:14px;}',
    '#zb-statusbar .plr.s0{background:var(--bg-card,#12121c);} #zb-statusbar .plr.s1{background:var(--bg-secondary,#161622);}',
    '#zb-statusbar .plr::before{content:"";position:absolute;right:100%;top:0;z-index:3;' + CH + 'border-right:9px solid transparent;}',
    '#zb-statusbar .plr.s0::before{border-right-color:var(--bg-card,#12121c);} #zb-statusbar .plr.s1::before{border-right-color:var(--bg-secondary,#161622);}'
  ].join('');

  var bar, styleEl, clockTimer;

  // Light-mode neutral overrides (from cyberpunk.css [data-theme=light]). The bar
  // scopes its vars to #zb-statusbar, so — like ztmux/zpalette — we merge these in
  // HERE when light is on; otherwise the bar's own dark neutrals ignore light mode.
  var LIGHT_VARS = { '--bg-primary': '#f0f2f5', '--bg-secondary': '#e4e7ec', '--bg-card': '#ffffff', '--bg-hover': '#f7f8fa', '--text': '#1e293b', '--text-dim': '#475569', '--text-muted': '#94a3b8', '--border': '#cbd5e1', '--border-glow': '#a5b4c8' };

  function schemeVars(cb) {
    try {
      chrome.storage.local.get(['zb_scheme', 'zb_ui'], function (o) {
        var name = (o && o.zb_scheme) || 'cyberpunk';
        var s = SCHEMES[name] || SCHEMES.cyberpunk || { vars: {} };
        var vars = {}, sv = s.vars || {}, k;
        for (k in sv) vars[k] = sv[k];
        if (o && o.zb_ui && o.zb_ui.light) for (k in LIGHT_VARS) vars[k] = LIGHT_VARS[k];
        cb(vars, name);
      });
    } catch (e) { cb((SCHEMES.cyberpunk || { vars: {} }).vars || {}, 'cyberpunk'); }
  }
  function applyStyle(vars) {
    var v = '';
    for (var i = 0; i < VAR_KEYS.length; i++) if (vars[VAR_KEYS[i]]) v += VAR_KEYS[i] + ':' + vars[VAR_KEYS[i]] + ';';
    if (!styleEl) { styleEl = document.createElement('style'); styleEl.id = 'zb-statusbar-css'; (document.head || document.documentElement).appendChild(styleEl); }
    styleEl.textContent = '#zb-statusbar{' + v + '}' + BAR_CSS;
  }
  function seg(cls, html) { var s = document.createElement('span'); s.className = 'seg ' + (cls || ''); s.innerHTML = html; return s; }
  function L(t) { return '<span class="k">' + t + '</span> '; }

  function build() {
    if (bar) return;
    bar = document.createElement('div'); bar.id = 'zb-statusbar';
    var sig = document.createElement('span'); sig.className = 'sig'; sig.textContent = 'ZW'; bar.appendChild(sig);
    bar.appendChild(seg('pfx', '<span class="prefix" data-prefix title="tmux prefix (native): C-b then % split · o/←→ focus · {} swap · x close">C-b</span>'));
    bar.appendChild(seg('scheme', '<span class="scheme" data-scheme>—</span>'));
    bar.appendChild(seg('tmux', '<span class="tmux" data-tmux></span>'));
    bar.appendChild(seg('vim', '<span class="vim">VIM</span>'));
    var kb = seg('kbd', '<span class="kbd">⌘K</span>');
    kb.querySelector('.kbd').addEventListener('click', function () { try { if (window.__zbPaletteOpen) window.__zbPaletteOpen(); } catch (e) {} });
    bar.appendChild(kb);
    bar.appendChild(seg('flex', ''));
    // ── system segments (from zb_sys) ──
    bar.appendChild(seg('cpu', L('CPU') + '<span data-cpu>–</span>'));
    bar.appendChild(seg('mem', L('MEM') + '<span data-mem>–</span>'));
    bar.appendChild(seg('swap', L('SWP') + '<span data-swap>–</span>'));
    bar.appendChild(seg('disk', L('DSK') + '<span data-disk>–</span>'));
    bar.appendChild(seg('io', L('IO') + '<span data-io>–</span>'));
    bar.appendChild(seg('net', L('NET') + '<span data-net>–</span>'));
    bar.appendChild(seg('load', L('LD') + '<span data-load>–</span>'));
    bar.appendChild(seg('up', L('UP') + '<span data-up>–</span>'));
    bar.appendChild(seg('temp', L('°') + '<span data-temp>–</span>'));
    bar.appendChild(seg('batt', '<span data-batt>–</span>'));
    bar.appendChild(seg('lan', L('LAN') + '<span data-lip>–</span>'));
    bar.appendChild(seg('wan', L('WAN') + '<span data-pip>…</span>'));
    bar.appendChild(seg('host', L('@') + '<span data-host>–</span>'));
    bar.appendChild(seg('clock', '<span class="clock" data-clock>--</span>'));
    document.body.appendChild(bar);
    powerline();
    tick(); clearInterval(clockTimer); clockTimer = setInterval(tick, 1000);
    refreshData();
  }
  function destroy() { if (clockTimer) clearInterval(clockTimer); if (bar) bar.remove(); bar = null; }

  // tag every non-special segment as a powerline block: alternating shade, and
  // ► (left of the flex spacer) or ◄ (right of it).
  function powerline() {
    var kids = [].slice.call(bar.children);
    var spacer = -1;
    kids.forEach(function (k, i) { if (k.classList.contains('flex')) spacer = i; });
    var lc = 1, rc = 0;
    kids.forEach(function (k, i) {
      if (k.classList.contains('sig') || k.classList.contains('flex') || k.classList.contains('pfx')) return;
      if (spacer >= 0 && i > spacer) { k.classList.add('plr', 's' + (rc % 2)); rc++; }
      else { k.classList.add('pll', 's' + (lc % 2)); lc++; }
    });
  }

  /* ---- formatters ---- */
  function fb(n) {
    if (n == null) return '–';
    var u = ['B', 'K', 'M', 'G', 'T'], i = 0; n = +n;
    while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
    return (n >= 100 || i === 0 ? Math.round(n) : n.toFixed(1)) + u[i];
  }
  function fr(n) { return n == null ? '–' : fb(n) + '/s'; }
  function fup(s) { if (s == null) return '–'; s = +s; var d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60); return (d ? d + 'd ' : '') + (h ? h + 'h ' : '') + m + 'm'; }
  function p2(n) { return (n < 10 ? '0' : '') + n; }

  function tick() {
    var el = bar && bar.querySelector('[data-clock]'); if (!el) return;
    var d = new Date();
    el.textContent = p2(d.getMonth() + 1) + '-' + p2(d.getDate()) + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes()) + ':' + p2(d.getSeconds());
  }

  function setTxt(sel, t) { var e = bar.querySelector(sel); if (e) e.textContent = t; }
  function refreshSys(s) {
    if (!bar) return;
    if (!s) return;
    setTxt('[data-cpu]', s.cpu == null ? '–' : s.cpu + '%');
    setTxt('[data-mem]', s.mem ? fb(s.mem.u) + '/' + fb(s.mem.t) : '–');
    setTxt('[data-swap]', s.swap ? fb(s.swap.u) + '/' + fb(s.swap.t) : '–');
    setTxt('[data-disk]', s.disk ? s.disk.p + '%' : '–');
    setTxt('[data-io]', s.io ? ('R' + fr(s.io.r) + ' W' + fr(s.io.w)) : '–');
    setTxt('[data-net]', s.net ? ('↑' + fr(s.net.up) + ' ↓' + fr(s.net.down)) : '–');
    setTxt('[data-load]', s.load ? s.load.join(' ') : '–');
    setTxt('[data-up]', fup(s.uptime));
    setTxt('[data-batt]', s.batt ? ((s.batt.c ? '⚡' : '🔋') + s.batt.p + '%') : '–');
    setTxt('[data-lip]', s.lip || '–');
    setTxt('[data-pip]', s.pip || '…');
    setTxt('[data-host]', s.host || '–');
    var tseg = bar.querySelector('.seg.temp');
    if (tseg) tseg.style.display = (s.temp != null ? '' : 'none');
    if (s.temp != null) setTxt('[data-temp]', s.temp + '°C');
  }

  function refreshData() {
    if (!bar) return;
    schemeVars(function (vars, name) { applyStyle(vars); var s = bar.querySelector('[data-scheme]'); if (s) s.textContent = (SCHEMES[name] && SCHEMES[name].label) || name; });
    try {
      chrome.storage.local.get(['zb_tmux', 'zb_sys'], function (o) {
        void chrome.runtime.lastError;
        setTmux(o && o.zb_tmux);
        refreshSys(o && o.zb_sys);
      });
    } catch (e) {}
  }
  function setTmux(st) {
    var el = bar.querySelector('[data-tmux]'); if (!el) return;
    if (!st || !st.windows || !st.windows.length) { el.innerHTML = ''; return; }
    function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
    var html = '';
    if (st.sess) html += '<span class="tsess" style="color:var(--magenta,#ff2e97);font-weight:700;margin-right:8px;" title="tmux session">⬢ ' + esc(st.sess) + '</span>';
    var aw = st.windows[st.active];   // active window's name, tmux-style, after the session
    if (aw && aw.name) html += '<span class="twin-name" style="color:var(--cyan,#05d9e8);margin-right:8px;" title="active window">' + esc(aw.name) + '</span>';
    html += st.windows.map(function (w, i) { return '<span class="win' + (i === st.active ? ' act' : '') + '">' + i + '·' + w.panes + (w.zoom ? 'Z' : '') + '</span>'; }).join('');
    if (st.anySync) html += '<span class="sync" title="synchronize-panes on">⇄</span>';
    el.innerHTML = html;
  }

  function enabled(cb) { try { chrome.storage.local.get('zb_status', function (o) { cb(!(o && o.zb_status === false)); }); } catch (e) { cb(true); } }
  function syncBar() { enabled(function (on) { if (on) { build(); refreshData(); } else destroy(); }); }

  try {
    chrome.storage.onChanged.addListener(function (changes, area) {
      if (area !== 'local') return;
      if (changes.zb_status) syncBar();
      if (bar && changes.zb_sys) refreshSys(changes.zb_sys.newValue);
      // zb_ui carries the light-mode toggle — refresh so the bar re-styles light/dark.
      if (bar && (changes.zb_scheme || changes.zb_tmux || changes.zb_ui)) refreshData();
    });
  } catch (e) {}

  // Prefix indicator — the native fork lets Ctrl-B propagate so we can light it.
  var prefixTimer;
  function litPrefix() {
    var el = bar && bar.querySelector('[data-prefix]'); if (!el) return;
    el.classList.add('on');
    clearTimeout(prefixTimer); prefixTimer = setTimeout(function () { if (el) el.classList.remove('on'); }, 1600);
  }
  document.addEventListener('keydown', function (e) {
    if (e.ctrlKey && !e.metaKey && !e.altKey && (e.key === 'b' || e.key === 'B')) litPrefix();
  }, true);
  // The keydown above misses whenever ztmux (which owns Ctrl-b) calls
  // stopImmediatePropagation first, or focus is in an iframe. ztmux publishes
  // its armed state to zb_tmux, so light the indicator off that too — reliable
  // and cross-frame (storage is shared).
  try {
    chrome.storage.onChanged.addListener(function (ch, area) {
      if (area === 'local' && ch.zb_tmux && ch.zb_tmux.newValue && ch.zb_tmux.newValue.armed) litPrefix();
    });
  } catch (e) {}

  if (document.body) syncBar();
  else document.addEventListener('DOMContentLoaded', syncBar);
})();
