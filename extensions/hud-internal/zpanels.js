/* zwire HUD — Web Panels (ports Vivaldi's Web Panels): a docked side panel that
 * shows pinned websites in an iframe. The frame_bust DNR rule strips X-Frame-
 * Options / CSP frame-ancestors on sub_frames, so arbitrary sites load in the
 * panel. Pinned panels persist (zb_panels). Toggled from the ⌘K palette
 * ("Web panels") via window.__zbPanelsOpen().
 *
 * The pure URL normalizer is exposed as window.__zbPanelNormalize for tests. */
(function () {
  'use strict';

  function normalizeUrl(u) { u = String(u || '').trim(); if (!u) return ''; if (!/^https?:\/\//i.test(u)) u = 'https://' + u; return u; }
  if (typeof window !== 'undefined') window.__zbPanelNormalize = normalizeUrl;

  if (typeof window === 'undefined' || typeof document === 'undefined' || typeof chrome === 'undefined' || !chrome.storage) return;
  if (window.__zbPanelsLoaded) return;
  window.__zbPanelsLoaded = true;

  var panels = [], active = 0, overlay = null;
  function host(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return u; } }
  function chipColor(h) { var s = 0; for (var i = 0; i < h.length; i++) s = (s * 31 + h.charCodeAt(i)) >>> 0; return 'hsl(' + (s % 360) + ',70%,60%)'; }
  function save() { try { chrome.storage.local.set({ zb_panels: panels, zb_panel_active: active }); } catch (e) {} }

  function ensureStyle() {
    if (document.getElementById('zb-panels-style')) return;
    var s = document.createElement('style'); s.id = 'zb-panels-style';
    s.textContent = [
      '.zb-panels{position:fixed;top:0;right:0;height:100%;width:min(400px,94vw);z-index:2147483646;',
      ' background:var(--bg-primary,#0a0d16);border-left:1px solid var(--cyan,#05d9e8);display:flex;flex-direction:column;',
      ' box-shadow:-12px 0 44px rgba(0,0,0,.5);font-family:"Share Tech Mono",Monaco,monospace;}',
      '.zb-panels-bar{display:flex;align-items:center;gap:6px;padding:8px;border-bottom:1px solid var(--border,#1a1a3e);}',
      '.zb-panels-rail{display:flex;gap:6px;overflow-x:auto;flex:1;}',
      '.zb-panels-chip{width:30px;height:30px;border-radius:6px;flex-shrink:0;display:flex;align-items:center;justify-content:center;',
      ' font-size:13px;font-weight:700;color:#06080f;cursor:pointer;position:relative;}',
      '.zb-panels-chip.on{outline:2px solid var(--cyan,#05d9e8);outline-offset:1px;}',
      '.zb-panels-chip .rm{position:absolute;top:-6px;right:-6px;background:var(--accent,#ff2a6d);color:#fff;border-radius:50%;',
      ' width:14px;height:14px;font-size:9px;line-height:14px;text-align:center;display:none;}',
      '.zb-panels-chip:hover .rm{display:block;}',
      '.zb-panels-btn{flex-shrink:0;background:var(--bg-card,#12172a);border:1px solid var(--border,#1a1a3e);color:var(--cyan,#05d9e8);',
      ' border-radius:5px;width:30px;height:30px;cursor:pointer;font-size:15px;}',
      '.zb-panels-frame{flex:1;border:none;width:100%;background:#fff;}',
      '.zb-panels-empty{flex:1;display:flex;align-items:center;justify-content:center;color:var(--text-muted,#3d4f6a);font-size:13px;text-align:center;padding:20px;}'
    ].join('');
    (document.head || document.documentElement).appendChild(s);
  }
  function close() { if (overlay) { try { overlay.remove(); } catch (e) {} overlay = null; } }
  function addPanel() {
    var u = normalizeUrl(prompt('Website URL for the panel:'));
    if (!u) return;
    panels.push({ url: u, title: host(u) }); active = panels.length - 1; save(); render();
  }
  function removePanel(i) { panels.splice(i, 1); if (active >= panels.length) active = Math.max(0, panels.length - 1); save(); render(); }

  function render() {
    ensureStyle();
    if (!overlay) { overlay = document.createElement('div'); overlay.className = 'zb-panels'; (document.body || document.documentElement).appendChild(overlay); }
    overlay.innerHTML = '';
    var bar = document.createElement('div'); bar.className = 'zb-panels-bar';
    var rail = document.createElement('div'); rail.className = 'zb-panels-rail';
    panels.forEach(function (p, i) {
      var chip = document.createElement('div'); chip.className = 'zb-panels-chip' + (i === active ? ' on' : '');
      chip.textContent = (host(p.url)[0] || '?').toUpperCase(); chip.style.background = chipColor(host(p.url)); chip.title = p.url;
      var rm = document.createElement('span'); rm.className = 'rm'; rm.textContent = '✕';
      rm.addEventListener('click', function (e) { e.stopPropagation(); removePanel(i); });
      chip.appendChild(rm);
      chip.addEventListener('click', function () { active = i; save(); render(); });
      rail.appendChild(chip);
    });
    bar.appendChild(rail);
    var add = document.createElement('button'); add.className = 'zb-panels-btn'; add.textContent = '＋'; add.title = 'Add panel'; add.addEventListener('click', addPanel); bar.appendChild(add);
    var x = document.createElement('button'); x.className = 'zb-panels-btn'; x.textContent = '✕'; x.title = 'Close'; x.addEventListener('click', close); bar.appendChild(x);
    overlay.appendChild(bar);
    if (panels.length && panels[active]) {
      var frame = document.createElement('iframe'); frame.className = 'zb-panels-frame'; frame.src = panels[active].url;
      frame.setAttribute('referrerpolicy', 'no-referrer');
      overlay.appendChild(frame);
    } else {
      overlay.appendChild(el_empty());
    }
  }
  function el_empty() { var d = document.createElement('div'); d.className = 'zb-panels-empty'; d.textContent = 'No panels yet — ＋ to pin a website.'; return d; }

  function open() {
    if (overlay) { close(); return; }
    try { chrome.storage.local.get(['zb_panels', 'zb_panel_active'], function (o) { void chrome.runtime.lastError; panels = (o && o.zb_panels) || []; active = (o && o.zb_panel_active) || 0; render(); }); } catch (e) { render(); }
  }
  window.__zbPanelsOpen = open;
  document.addEventListener('keydown', function (e) { if (overlay && e.key === 'Escape') { e.preventDefault(); close(); } }, true);
})();
