/* zwire HUD — Trash / Recently Closed (ports Vivaldi's Trash can). A dropdown of
 * recently-closed tabs & windows; click one to restore it. The worker publishes
 * the list to storage (zb_trash) since content scripts can't call chrome.sessions;
 * restore routes through the zb_cmd bus (restoreSession). Opened from the ⌘K
 * palette ("Recently closed") via window.__zbTrashOpen(). */
(function () {
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined' || typeof chrome === 'undefined' || !chrome.storage) return;
  if (window.__zbTrashLoaded) return;
  window.__zbTrashLoaded = true;

  var overlay = null, storageSub = null;
  function cmd(o) { try { o.n = (window.__zbTick = (window.__zbTick || 0) + 1); chrome.storage.local.set({ zb_cmd: o }); } catch (e) {} }
  function host(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return u || ''; } }
  function chipColor(h) { var s = 0; for (var i = 0; i < h.length; i++) s = (s * 31 + h.charCodeAt(i)) >>> 0; return 'hsl(' + (s % 360) + ',70%,60%)'; }

  function ensureStyle() {
    if (document.getElementById('zb-trash-style')) return;
    var s = document.createElement('style'); s.id = 'zb-trash-style';
    s.textContent = [
      '.zb-trash{position:fixed;top:14vh;right:24px;z-index:2147483646;width:min(340px,90vw);max-height:64vh;overflow-y:auto;',
      ' background:var(--bg-primary,#0a0d16);border:1px solid var(--cyan,#05d9e8);border-radius:6px;box-shadow:0 0 40px var(--cyan-glow,rgba(5,217,232,.4));',
      ' font-family:"Share Tech Mono",Monaco,monospace;}',
      '.zb-trash-hd{position:sticky;top:0;background:var(--bg-secondary,#12172a);padding:10px 12px;border-bottom:1px solid var(--border,#1a1a3e);',
      ' color:var(--cyan,#05d9e8);font-size:12px;letter-spacing:.06em;text-transform:uppercase;display:flex;justify-content:space-between;}',
      '.zb-trash-x{cursor:pointer;background:none;border:none;color:var(--text-dim,#7a8ba8);font-size:14px;}',
      '.zb-trash-row{display:flex;align-items:center;gap:9px;padding:8px 12px;cursor:pointer;}',
      '.zb-trash-row:hover{background:var(--bg-hover,#12172a);}',
      '.zb-trash-chip{width:18px;height:18px;border-radius:4px;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:#06080f;}',
      '.zb-trash-t{flex:1;font-size:12px;color:var(--text,#e0f0ff);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '.zb-trash-k{font-size:10px;color:var(--text-muted,#3d4f6a);}',
      '.zb-trash-empty{padding:16px;color:var(--text-muted,#3d4f6a);font-size:12px;text-align:center;}'
    ].join('');
    (document.head || document.documentElement).appendChild(s);
  }
  function close() {
    if (storageSub) { try { chrome.storage.onChanged.removeListener(storageSub); } catch (e) {} storageSub = null; }
    if (overlay) { try { overlay.remove(); } catch (e) {} overlay = null; }
  }
  function render(list) {
    if (!overlay) return;
    overlay.innerHTML = '';
    var hd = document.createElement('div'); hd.className = 'zb-trash-hd';
    var t = document.createElement('span'); t.textContent = 'Recently Closed'; hd.appendChild(t);
    var x = document.createElement('button'); x.className = 'zb-trash-x'; x.textContent = '✕'; x.addEventListener('click', close); hd.appendChild(x);
    overlay.appendChild(hd);
    if (!list || !list.length) { var e = document.createElement('div'); e.className = 'zb-trash-empty'; e.textContent = 'Nothing recently closed.'; overlay.appendChild(e); return; }
    list.forEach(function (it) {
      var row = document.createElement('div'); row.className = 'zb-trash-row';
      var h = host(it.url);
      var chip = document.createElement('span'); chip.className = 'zb-trash-chip'; chip.textContent = it.kind === 'window' ? '▦' : (h[0] || '?').toUpperCase(); chip.style.background = chipColor(h || 'x'); row.appendChild(chip);
      var lab = document.createElement('span'); lab.className = 'zb-trash-t'; lab.textContent = it.title || it.url || '(page)'; lab.title = it.url || ''; row.appendChild(lab);
      var k = document.createElement('span'); k.className = 'zb-trash-k'; k.textContent = it.kind; row.appendChild(k);
      row.addEventListener('click', function () { if (it.sessionId) cmd({ a: 'restoreSession', sessionId: it.sessionId }); close(); });
      overlay.appendChild(row);
    });
  }
  function open() {
    if (overlay) { close(); return; }
    ensureStyle();
    overlay = document.createElement('div'); overlay.className = 'zb-trash';
    (document.body || document.documentElement).appendChild(overlay);
    cmd({ a: 'trashList' });   // ask the worker to (re)publish zb_trash
    try { chrome.storage.local.get('zb_trash', function (o) { void chrome.runtime.lastError; render((o && o.zb_trash) || []); }); } catch (e) { render([]); }
    storageSub = function (ch, area) { if (area === 'local' && ch.zb_trash && overlay) render(ch.zb_trash.newValue || []); };
    try { chrome.storage.onChanged.addListener(storageSub); } catch (e) {}
  }
  window.__zbTrashOpen = open;
  document.addEventListener('keydown', function (e) { if (overlay && e.key === 'Escape') { e.preventDefault(); close(); } }, true);
})();
