/* zwire HUD — Link Peek (ports Arc's Peek / Zen's Glance). Alt+click any link to
 * open it in a floating centered overlay (an iframe — the frame_bust DNR rule
 * strips X-Frame-Options/CSP so it loads) instead of leaving the page. Esc or
 * click-outside closes it; a ↗ button opens it as a real tab.
 *
 * Pure: none beyond DOM wiring; this file is UI. */
(function () {
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined' || typeof chrome === 'undefined') return;
  if (window.__zbPeekLoaded) return;
  window.__zbPeekLoaded = true;

  var overlay = null;
  function ensureStyle() {
    if (document.getElementById('zb-peek-style')) return;
    var s = document.createElement('style'); s.id = 'zb-peek-style';
    s.textContent = [
      '.zb-peek-ov{position:fixed;inset:0;z-index:2147483646;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;}',
      '.zb-peek{width:min(1000px,90vw);height:min(80vh,860px);display:flex;flex-direction:column;',
      ' background:var(--bg-primary,#0a0d16);border:1px solid var(--cyan,#05d9e8);border-radius:8px;overflow:hidden;box-shadow:0 0 60px var(--cyan-glow,rgba(5,217,232,.4));}',
      '.zb-peek-bar{display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid var(--border,#1a1a3e);font-family:"Share Tech Mono",monospace;}',
      '.zb-peek-url{flex:1;font-size:12px;color:var(--text-dim,#7a8ba8);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '.zb-peek-btn{cursor:pointer;background:var(--bg-card,#12172a);border:1px solid var(--border,#1a1a3e);color:var(--cyan,#05d9e8);border-radius:4px;padding:4px 10px;font:12px "Share Tech Mono",monospace;}',
      '.zb-peek iframe{flex:1;border:none;width:100%;background:#fff;}'
    ].join('');
    (document.head || document.documentElement).appendChild(s);
  }
  function close() { if (overlay) { try { overlay.remove(); } catch (e) {} overlay = null; } }
  function open(url) {
    if (overlay) close();
    ensureStyle();
    overlay = document.createElement('div'); overlay.className = 'zb-peek-ov';
    var box = document.createElement('div'); box.className = 'zb-peek';
    var bar = document.createElement('div'); bar.className = 'zb-peek-bar';
    var u = document.createElement('span'); u.className = 'zb-peek-url'; u.textContent = url; bar.appendChild(u);
    var openTab = document.createElement('button'); openTab.className = 'zb-peek-btn'; openTab.textContent = '↗ Open'; openTab.addEventListener('click', function () { window.open(url, '_blank'); close(); }); bar.appendChild(openTab);
    var x = document.createElement('button'); x.className = 'zb-peek-btn'; x.textContent = '✕'; x.addEventListener('click', close); bar.appendChild(x);
    box.appendChild(bar);
    var frame = document.createElement('iframe'); frame.src = url; frame.setAttribute('referrerpolicy', 'no-referrer'); box.appendChild(frame);
    overlay.appendChild(box);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
    (document.body || document.documentElement).appendChild(overlay);
  }
  window.__zbPeek = open;

  // Alt+click a link → peek it instead of navigating.
  document.addEventListener('click', function (e) {
    if (!e.altKey || e.metaKey || e.ctrlKey || e.button !== 0) return;
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a) return;
    var href = a.href || '';
    if (!/^https?:/i.test(href)) return;
    e.preventDefault(); e.stopPropagation();
    open(href);
  }, true);
  document.addEventListener('keydown', function (e) { if (overlay && e.key === 'Escape') { e.preventDefault(); close(); } }, true);
})();
