/* zwire HUD — tmux-style statusbar, pinned to the bottom of every page.
 * Segments (left→right): ZW sigil · active scheme · host · [flex] · CI dot ·
 * tab count · vim indicator · ⌘K · clock. Themed by the active scheme (same
 * source as zpalette/zvim: window.ZWIRE_HUD + chrome.storage 'zb_scheme').
 * Toggle from the ⌘K palette ("Toggle HUD statusbar", stored as zb_status).
 * Data comes from storage buses the worker already maintains: zb_tabs,
 * zb_ci_status, zb_scheme. Top frame only; never shown in iframes. */
(function () {
  'use strict';
  if (window.top !== window) return;           // top frame only
  if (window.__zbStatusLoaded) return;
  window.__zbStatusLoaded = true;
  var HUD = window.ZWIRE_HUD || {};
  var SCHEMES = HUD.SCHEMES || {};
  var VAR_KEYS = HUD.VAR_KEYS || [];

  var BAR_CSS = [
    '#zb-statusbar{position:fixed;left:0;right:0;bottom:0;height:22px;z-index:2147483644;display:flex;align-items:center;',
    ' gap:0;font:11px/22px "Share Tech Mono",Monaco,monospace;color:var(--text,#c8f5ff);',
    ' background:color-mix(in srgb,var(--bg-primary,#0a0a12) 88%,transparent);border-top:1px solid var(--border,#1b2b3a);',
    ' box-shadow:0 -6px 18px rgba(0,0,0,.35);backdrop-filter:blur(3px);user-select:none;}',
    '#zb-statusbar .seg{display:flex;align-items:center;gap:5px;padding:0 9px;height:100%;white-space:nowrap;}',
    '#zb-statusbar .seg+.seg{border-left:1px solid var(--border,#1b2b3a);}',
    '#zb-statusbar .sig{background:var(--cyan,#05d9e8);color:var(--bg-primary,#0a0a12);font-weight:bold;padding:0 6px;height:100%;display:flex;align-items:center;letter-spacing:1px;}',
    '#zb-statusbar .scheme{color:var(--accent,#ff2a6d);text-shadow:0 0 6px var(--accent-glow,transparent);text-transform:uppercase;letter-spacing:1px;}',
    '#zb-statusbar .host{color:var(--cyan,#05d9e8);overflow:hidden;text-overflow:ellipsis;max-width:38vw;}',
    '#zb-statusbar .flex{flex:1;border:none;}',
    '#zb-statusbar .k{color:var(--text-muted,#6b7b8a);}',
    '#zb-statusbar .clock{color:var(--accent,#ff2a6d);}',
    '#zb-statusbar .cidot{font-size:13px;line-height:1;}',
    '#zb-statusbar .kbd{cursor:pointer;color:var(--text-muted,#6b7b8a);}',
    '#zb-statusbar .kbd:hover{color:var(--cyan,#05d9e8);}',
    '#zb-statusbar .vim{color:var(--green,#3bf58a);letter-spacing:1px;}'
  ].join('');

  var bar, styleEl, clockTimer;

  function schemeVars(cb) {
    try { chrome.storage.local.get('zb_scheme', function (o) { var s = SCHEMES[(o && o.zb_scheme) || 'cyberpunk'] || SCHEMES.cyberpunk || { vars: {} }; cb(s.vars || {}, (o && o.zb_scheme) || 'cyberpunk'); }); }
    catch (e) { cb((SCHEMES.cyberpunk || { vars: {} }).vars || {}, 'cyberpunk'); }
  }
  function applyStyle(vars) {
    var v = '';
    for (var i = 0; i < VAR_KEYS.length; i++) if (vars[VAR_KEYS[i]]) v += VAR_KEYS[i] + ':' + vars[VAR_KEYS[i]] + ';';
    if (!styleEl) { styleEl = document.createElement('style'); styleEl.id = 'zb-statusbar-css'; (document.head || document.documentElement).appendChild(styleEl); }
    styleEl.textContent = '#zb-statusbar{' + v + '}' + BAR_CSS;
  }

  function seg(cls, html) { var s = document.createElement('span'); s.className = 'seg ' + (cls || ''); s.innerHTML = html; return s; }

  function build() {
    if (bar) return;
    bar = document.createElement('div'); bar.id = 'zb-statusbar';
    var sig = document.createElement('span'); sig.className = 'sig'; sig.textContent = 'ZW'; bar.appendChild(sig);
    bar.appendChild(seg('scheme', '<span class="scheme" data-scheme>—</span>'));
    var host = location.host || location.protocol.replace(':', '');
    bar.appendChild(seg('host', '<span class="host">' + host.replace(/[<>&]/g, '') + '</span>'));
    bar.appendChild(seg('flex', ''));                                   // spacer
    bar.appendChild(seg('ci', '<span class="cidot" data-ci title="CI">●</span><span class="k" data-ci-label></span>'));
    bar.appendChild(seg('tabs', '<span class="k">⧉</span> <span data-tabs>–</span>'));
    bar.appendChild(seg('vim', '<span class="vim">VIM</span>'));
    var kb = seg('kbd', '<span class="kbd">⌘K</span>');
    kb.querySelector('.kbd').addEventListener('click', function () { try { if (window.__zbPaletteOpen) window.__zbPaletteOpen(); } catch (e) {} });
    bar.appendChild(kb);
    bar.appendChild(seg('clock', '<span class="clock" data-clock>--:--:--</span>'));
    document.body.appendChild(bar);
    tick(); clearInterval(clockTimer); clockTimer = setInterval(tick, 1000);
    refreshData();
  }
  function destroy() { if (clockTimer) clearInterval(clockTimer); if (bar) bar.remove(); bar = null; }

  function tick() {
    if (!bar) return;
    var el = bar.querySelector('[data-clock]'); if (!el) return;
    var d = new Date(), p = function (n) { return (n < 10 ? '0' : '') + n; };
    el.textContent = p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }
  function refreshData() {
    if (!bar) return;
    schemeVars(function (vars, name) { applyStyle(vars); var s = bar.querySelector('[data-scheme]'); if (s) s.textContent = (SCHEMES[name] && SCHEMES[name].label) || name; });
    try {
      chrome.storage.local.get(['zb_tabs', 'zb_ci_status'], function (o) {
        void chrome.runtime.lastError;
        var t = bar.querySelector('[data-tabs]'); if (t) t.textContent = (o && o.zb_tabs ? o.zb_tabs.length : '–');
        setCi(o && o.zb_ci_status);
      });
    } catch (e) {}
  }
  function setCi(st) {
    var dot = bar.querySelector('[data-ci]'), lab = bar.querySelector('[data-ci-label]');
    if (!dot) return;
    if (!st || !st.total) { dot.style.color = 'var(--text-muted,#6b7b8a)'; if (lab) lab.textContent = ''; dot.title = 'CI: no data'; return; }
    if (st.fail > 0) { dot.style.color = 'var(--red,#ff2a6d)'; if (lab) lab.textContent = st.fail + '✗'; }
    else if (st.running > 0) { dot.style.color = 'var(--yellow,var(--accent,#f5d90a))'; if (lab) lab.textContent = '…'; }
    else { dot.style.color = 'var(--green,#3bf58a)'; if (lab) lab.textContent = '✓'; }
    dot.title = 'CI: ' + st.ok + ' ok · ' + st.fail + ' fail · ' + st.running + ' running / ' + st.total;
  }

  function enabled(cb) { try { chrome.storage.local.get('zb_status', function (o) { cb(!(o && o.zb_status === false)); }); } catch (e) { cb(true); } }
  function sync() { enabled(function (on) { if (on) { build(); refreshData(); } else destroy(); }); }

  // React to toggles + data/scheme updates from the worker.
  try {
    chrome.storage.onChanged.addListener(function (changes, area) {
      if (area !== 'local') return;
      if (changes.zb_status) sync();
      if (bar && (changes.zb_scheme || changes.zb_tabs || changes.zb_ci_status)) refreshData();
    });
  } catch (e) {}

  if (document.body) sync();
  else document.addEventListener('DOMContentLoaded', sync);
})();
