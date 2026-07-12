/* zwire HUD — Page Actions (ports Vivaldi's Page Actions): live CSS-filter
 * transforms applied to the current page (grayscale, sepia, invert, blur, high
 * contrast, …). Toggles are remembered PER SITE (chrome.storage zb_page_actions,
 * keyed by origin) and re-applied on every load. Opened from the ⌘K palette
 * ("Page actions") via window.__zbPageActionsOpen().
 *
 * The pure filter-string builder is exposed as window.__zbPageFilter for tests. */
(function () {
  'use strict';

  // [key, label, css-filter]. Active filters are concatenated into one string.
  var ACTIONS = [
    ['grayscale', 'Grayscale', 'grayscale(1)'],
    ['sepia', 'Sepia', 'sepia(1)'],
    ['invert', 'Invert', 'invert(1) hue-rotate(180deg)'],
    ['bw', 'Black & white', 'grayscale(1) contrast(1.6)'],
    ['contrast', 'High contrast', 'contrast(1.5)'],
    ['dim', 'Dim', 'brightness(0.6)'],
    ['bright', 'Brighten', 'brightness(1.3)'],
    ['saturate', 'Saturate', 'saturate(2)'],
    ['hue', 'Hue rotate', 'hue-rotate(90deg)'],
    ['blur', 'Blur', 'blur(2px)']
  ];
  function filterString(active) {
    active = active || {};
    return ACTIONS.filter(function (a) { return active[a[0]]; }).map(function (a) { return a[2]; }).join(' ');
  }
  if (typeof window !== 'undefined') { window.__zbPageFilter = filterString; window.__zbPageActions = ACTIONS; }

  if (typeof window === 'undefined' || typeof chrome === 'undefined' || !chrome.storage || !chrome.runtime) return;   // headless: helpers only
  if (window.__zbPageActionsLoaded) return;
  window.__zbPageActionsLoaded = true;

  var origin = '';
  try { origin = location.origin; } catch (e) {}
  var active = {}, overlay = null;

  function apply() {
    try { document.documentElement.style.filter = filterString(active); } catch (e) {}
  }
  function persist() {
    try {
      chrome.storage.local.get('zb_page_actions', function (o) {
        void chrome.runtime.lastError;
        var all = (o && o.zb_page_actions) || {};
        var any = ACTIONS.some(function (a) { return active[a[0]]; });
        if (any) all[origin] = active; else delete all[origin];
        chrome.storage.local.set({ zb_page_actions: all });
      });
    } catch (e) {}
  }
  // Restore this origin's saved actions on load.
  try {
    chrome.storage.local.get('zb_page_actions', function (o) {
      void chrome.runtime.lastError;
      var saved = (o && o.zb_page_actions && o.zb_page_actions[origin]) || {};
      active = saved; apply();
    });
  } catch (e) {}

  function ensureStyle() {
    if (document.getElementById('zb-pa-style')) return;
    try {
      var s = document.createElement('style'); s.id = 'zb-pa-style';
      s.textContent = [
        '.zb-pa-overlay{position:fixed;top:14vh;right:24px;z-index:2147483646;width:min(260px,86vw);',
        ' background:var(--bg-primary,#0a0d16);border:1px solid var(--cyan,#05d9e8);border-radius:6px;',
        ' box-shadow:0 0 40px var(--cyan-glow,rgba(5,217,232,.4));font-family:"Share Tech Mono",Monaco,monospace;overflow:hidden;}',
        '.zb-pa-hd{display:flex;justify-content:space-between;align-items:center;padding:10px 12px;border-bottom:1px solid var(--border,#1a1a3e);}',
        '.zb-pa-hd b{color:var(--cyan,#05d9e8);font-size:12px;letter-spacing:.06em;text-transform:uppercase;}',
        '.zb-pa-x{cursor:pointer;color:var(--text-dim,#7a8ba8);font-size:14px;background:none;border:none;}',
        '.zb-pa-list{max-height:60vh;overflow-y:auto;padding:4px 0;}',
        '.zb-pa-row{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 12px;cursor:pointer;color:var(--text,#e0f0ff);font-size:12px;}',
        '.zb-pa-row:hover{background:var(--bg-hover,#12172a);}',
        '.zb-pa-sw{width:30px;height:16px;border-radius:8px;background:var(--border,#1a1a3e);position:relative;flex-shrink:0;transition:background .12s;}',
        '.zb-pa-sw::after{content:"";position:absolute;top:2px;left:2px;width:12px;height:12px;border-radius:50%;background:var(--text-dim,#7a8ba8);transition:left .12s,background .12s;}',
        '.zb-pa-row.on .zb-pa-sw{background:var(--cyan,#05d9e8);}',
        '.zb-pa-row.on .zb-pa-sw::after{left:16px;background:var(--bg-primary,#0a0d16);}',
        '.zb-pa-reset{width:100%;text-align:center;padding:9px;border:none;border-top:1px solid var(--border,#1a1a3e);',
        ' background:var(--bg-card,#12172a);color:var(--accent,#ff2a6d);cursor:pointer;font:12px "Share Tech Mono",monospace;}'
      ].join('');
      (document.head || document.documentElement).appendChild(s);
    } catch (e) {}
  }
  function close() { if (overlay) { try { overlay.remove(); } catch (e) {} overlay = null; } }
  function open() {
    if (overlay) { close(); return; }
    ensureStyle();
    overlay = document.createElement('div'); overlay.className = 'zb-pa-overlay';
    var hd = document.createElement('div'); hd.className = 'zb-pa-hd';
    var t = document.createElement('b'); t.textContent = 'Page Actions'; hd.appendChild(t);
    var x = document.createElement('button'); x.className = 'zb-pa-x'; x.textContent = '✕'; x.addEventListener('click', close); hd.appendChild(x);
    overlay.appendChild(hd);
    var list = document.createElement('div'); list.className = 'zb-pa-list';
    ACTIONS.forEach(function (a) {
      var row = document.createElement('div'); row.className = 'zb-pa-row' + (active[a[0]] ? ' on' : '');
      var label = document.createElement('span'); label.textContent = a[1];
      var sw = document.createElement('span'); sw.className = 'zb-pa-sw';
      row.appendChild(label); row.appendChild(sw);
      row.addEventListener('click', function () {
        active[a[0]] = !active[a[0]];
        row.className = 'zb-pa-row' + (active[a[0]] ? ' on' : '');
        apply(); persist();
      });
      list.appendChild(row);
    });
    overlay.appendChild(list);
    var reset = document.createElement('button'); reset.className = 'zb-pa-reset'; reset.textContent = 'Reset all';
    reset.addEventListener('click', function () { active = {}; apply(); persist(); close(); });
    overlay.appendChild(reset);
    (document.body || document.documentElement).appendChild(overlay);
  }
  window.__zbPageActionsOpen = open;
  document.addEventListener('keydown', function (e) { if (overlay && e.key === 'Escape') { e.preventDefault(); close(); } }, true);
})();
