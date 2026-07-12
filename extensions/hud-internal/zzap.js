/* zwire HUD — Element Zapper (ports Arc Boosts' "zap"). Enter zap mode, hover to
 * highlight, click to permanently hide any page element (ads, banners, clutter).
 * Hidden selectors persist PER SITE (zb_zap keyed by origin) and re-apply on load.
 * Toggle zap mode from the ⌘K palette ("Zap page elements"); Esc exits. A second
 * palette entry clears this site's zaps.
 *
 * The pure selector builder is exposed as window.__zbZapPath for tests. */
(function () {
  'use strict';

  // Build a CSS selector from a leaf→root list of {tag,id,nth}. An id short-
  // circuits (ids are unique); otherwise tag + :nth-of-type() steps, root→leaf.
  function pathString(steps) {
    var parts = [];
    for (var i = 0; i < (steps || []).length; i++) {
      var s = steps[i];
      if (s.id) { parts.unshift('#' + (window.CSS && CSS.escape ? CSS.escape(s.id) : s.id)); return parts.join(' > '); }
      parts.unshift(s.tag + (s.nth ? ':nth-of-type(' + s.nth + ')' : ''));
    }
    return parts.join(' > ');
  }
  if (typeof window !== 'undefined') window.__zbZapPath = pathString;

  if (typeof window === 'undefined' || typeof document === 'undefined' || typeof chrome === 'undefined' || !chrome.storage) return;
  if (window.__zbZapLoaded) return;
  window.__zbZapLoaded = true;

  var origin = ''; try { origin = location.origin; } catch (e) {}
  var zaps = [], mode = false, hovered = null;

  function selectorFor(el) {
    var steps = [];
    for (var node = el; node && node.nodeType === 1 && node !== document.documentElement; node = node.parentNode) {
      var step = { tag: node.tagName.toLowerCase() };
      if (node.id) { step.id = node.id; steps.push(step); break; }
      var nth = 1, sib = node;
      while ((sib = sib.previousElementSibling)) { if (sib.tagName === node.tagName) nth++; }
      step.nth = nth; steps.push(step);
    }
    return pathString(steps);
  }
  function applyAll() { zaps.forEach(function (sel) { try { document.querySelectorAll(sel).forEach(function (el) { el.style.setProperty('display', 'none', 'important'); }); } catch (e) {} }); }
  function persist() {
    try { chrome.storage.local.get('zb_zap', function (o) { void chrome.runtime.lastError; var all = (o && o.zb_zap) || {}; if (zaps.length) all[origin] = zaps; else delete all[origin]; chrome.storage.local.set({ zb_zap: all }); }); } catch (e) {}
  }
  // Restore saved zaps on load.
  try { chrome.storage.local.get('zb_zap', function (o) { void chrome.runtime.lastError; zaps = (o && o.zb_zap && o.zb_zap[origin]) || []; applyAll(); }); } catch (e) {}

  function ensureStyle() {
    if (document.getElementById('zb-zap-style')) return;
    var s = document.createElement('style'); s.id = 'zb-zap-style';
    s.textContent = '.zb-zap-hi{outline:2px solid var(--accent,#ff2a6d) !important;outline-offset:-2px !important;background:rgba(255,42,109,.15) !important;cursor:crosshair !important;}'
      + '.zb-zap-badge{position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:2147483647;background:var(--accent,#ff2a6d);color:#fff;padding:6px 14px;border-radius:5px;font:12px "Share Tech Mono",monospace;letter-spacing:.06em;}';
    (document.head || document.documentElement).appendChild(s);
  }
  var badge = null;
  function onMove(e) { if (hovered) hovered.classList.remove('zb-zap-hi'); hovered = e.target; if (hovered && hovered.classList) hovered.classList.add('zb-zap-hi'); }
  function onClick(e) {
    e.preventDefault(); e.stopPropagation();
    var el = e.target; if (!el || el === document.body || el === badge) return;
    var sel = selectorFor(el); if (!sel) return;
    if (zaps.indexOf(sel) < 0) zaps.push(sel);
    try { el.style.setProperty('display', 'none', 'important'); } catch (x) {}
    persist();
  }
  function exit() {
    mode = false;
    if (hovered) { try { hovered.classList.remove('zb-zap-hi'); } catch (e) {} hovered = null; }
    document.removeEventListener('mousemove', onMove, true);
    document.removeEventListener('click', onClick, true);
    if (badge) { try { badge.remove(); } catch (e) {} badge = null; }
  }
  function enter() {
    if (mode) { exit(); return; }
    mode = true; ensureStyle();
    badge = document.createElement('div'); badge.className = 'zb-zap-badge'; badge.textContent = 'ZAP MODE — click to hide · Esc to exit';
    (document.body || document.documentElement).appendChild(badge);
    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('click', onClick, true);
  }
  window.__zbZapStart = enter;
  window.__zbZapClear = function () { zaps = []; persist(); try { location.reload(); } catch (e) {} };
  document.addEventListener('keydown', function (e) { if (mode && e.key === 'Escape') { e.preventDefault(); exit(); } }, true);
})();
