/* zbrowser HUD — Vimium-style vim keybindings on every page.
 * Normal mode by default; suppressed while typing in an editable field. Scroll
 * (j/k/d/u/gg/G/h/l), history+tabs (H/L back-fwd, J/K prev-next tab, x close,
 * t new, r reload, yy copy URL), link hints (f click, F new tab), and o/⌘K
 * palette + / find (delegates to zpalette/zfind). Tab ops go through the
 * background worker. Disable per-tab with `\`. */
(function () {
  'use strict';
  if (window.__zbVimLoaded) return;
  window.__zbVimLoaded = true;

  var enabled = true, pending = '', pendingTimer = null;
  var hintMode = false, hints = [], hintKeys = 'asdfghjklqwertyuiopzxcvbnm', hintTyped = '', hintNewTab = false;

  function editable(el) {
    if (!el) return false;
    var t = el.tagName;
    return t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT' || el.isContentEditable;
  }
  // storage command bus (reliable MV3 wakeup) — same as the palette.
  function tabCmd(a, extra) { try { var o = { a: a, n: 'v' + (window.__zbTick = (window.__zbTick || 0) + 1) }; if (extra) for (var k in extra) o[k] = extra[k]; chrome.storage.local.set({ zb_cmd: o }); } catch (e) {} }
  function scrollBy(dx, dy) { window.scrollBy({ left: dx, top: dy, behavior: 'instant' in document.documentElement.style ? 'auto' : 'auto' }); }
  function halfPage() { return Math.round(window.innerHeight * 0.5); }

  /* ------------------------------------------------------------ link hints */
  function labels(n) {
    var a = hintKeys.split(''), out = [];
    if (n <= a.length) { for (var i = 0; i < n; i++) out.push(a[i]); return out; }
    for (var x = 0; x < a.length && out.length < n; x++)
      for (var y = 0; y < a.length && out.length < n; y++) out.push(a[x] + a[y]);
    return out;
  }
  function clickable() {
    var sel = 'a[href],button,input:not([type=hidden]),select,textarea,[role=button],[role=link],[onclick],[tabindex]';
    var els = Array.prototype.slice.call(document.querySelectorAll(sel));
    return els.filter(function (el) {
      var r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return false;
      if (r.bottom < 0 || r.top > window.innerHeight || r.right < 0 || r.left > window.innerWidth) return false;
      var cs = getComputedStyle(el);
      return cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0';
    });
  }
  function showHints(newTab) {
    clearHints();
    hintNewTab = !!newTab; hintTyped = '';
    var els = clickable(); if (!els.length) return;
    var lbls = labels(els.length);
    var wrap = document.createElement('div'); wrap.id = 'zvim-hints';
    els.forEach(function (el, i) {
      var r = el.getBoundingClientRect();
      var h = document.createElement('span'); h.className = 'zvim-hint';
      h.textContent = lbls[i].toUpperCase();
      h.style.cssText = 'position:fixed;z-index:2147483645;left:' + Math.max(0, r.left) + 'px;top:' + Math.max(0, r.top) + 'px;';
      wrap.appendChild(h);
      hints.push({ el: el, label: lbls[i], tag: h });
    });
    document.body.appendChild(wrap);
    hintMode = true;
  }
  function filterHints() {
    var any = false;
    hints.forEach(function (hn) {
      var match = hn.label.indexOf(hintTyped) === 0;
      hn.tag.style.display = match ? '' : 'none';
      if (match) { any = true; hn.tag.classList.toggle('zvim-hint-active', hintTyped.length > 0); }
    });
    var exact = hints.filter(function (hn) { return hn.label === hintTyped; });
    if (exact.length === 1) { activateHint(exact[0].el); clearHints(); }
    else if (!any) clearHints();
  }
  function activateHint(el) {
    if (hintNewTab && el.tagName === 'A' && el.href) { tabCmd('openTab', { url: el.href }); return; }
    if (editable(el)) { el.focus(); return; }
    el.click();
  }
  function clearHints() {
    hintMode = false; hintTyped = ''; hints = [];
    var w = document.getElementById('zvim-hints'); if (w) w.remove();
  }

  /* ------------------------------------------------------------- key logic */
  function setPending(k) { pending = k; clearTimeout(pendingTimer); pendingTimer = setTimeout(function () { pending = ''; }, 900); }

  function onKey(e) {
    if (!enabled) {
      if (e.key === '\\' && (e.metaKey || e.ctrlKey)) { enabled = true; toast('vim on'); e.preventDefault(); }
      return;
    }
    // hint mode captures alnum + esc
    if (hintMode) {
      if (e.key === 'Escape') { clearHints(); e.preventDefault(); return; }
      if (e.key === 'Backspace') { hintTyped = hintTyped.slice(0, -1); filterHints(); e.preventDefault(); return; }
      if (/^[a-z]$/i.test(e.key)) { hintTyped += e.key.toLowerCase(); filterHints(); e.preventDefault(); e.stopPropagation(); return; }
      return;
    }
    // never steal keys while typing / with modifiers (except our own combos)
    if (editable(document.activeElement)) { if (e.key === 'Escape') document.activeElement.blur(); return; }
    if (e.altKey || e.metaKey || e.ctrlKey) return;

    var k = e.key;
    // two-key sequences
    if (pending === 'g') {
      pending = '';
      if (k === 'g') { window.scrollTo({ top: 0 }); e.preventDefault(); return; }
      if (k === 't') { tabCmd('nextTab'); e.preventDefault(); return; }
      if (k === 'T') { tabCmd('prevTab'); e.preventDefault(); return; }
      if (k === 'i') { var f = document.querySelector('input:not([type=hidden]),textarea'); if (f) f.focus(); e.preventDefault(); return; }
      return;
    }
    if (pending === 'y') { pending = ''; if (k === 'y') { copy(location.href); toast('yanked url'); e.preventDefault(); } return; }

    switch (k) {
      case 'j': scrollBy(0, 66); break;
      case 'k': scrollBy(0, -66); break;
      case 'h': scrollBy(-66, 0); break;
      case 'l': scrollBy(66, 0); break;
      case 'd': scrollBy(0, halfPage()); break;
      case 'u': scrollBy(0, -halfPage()); break;
      case 'G': window.scrollTo({ top: document.body.scrollHeight }); break;
      case 'g': setPending('g'); break;
      case 'y': setPending('y'); break;
      case 'r': location.reload(); break;
      case 'H': history.back(); break;
      case 'L': history.forward(); break;
      case 'J': tabCmd('prevTab'); break;
      case 'K': tabCmd('nextTab'); break;
      case 'x': tabCmd('closeTab'); break;
      case 't': tabCmd('newTab'); break;
      case 'f': showHints(false); break;
      case 'F': showHints(true); break;
      case ':': if (window.__zbPaletteOpen) window.__zbPaletteOpen(); break;   // vim command-line
      case 'o': if (window.__zbPaletteOpen) window.__zbPaletteOpen(); break;
      case '/': if (window.__zbFindOpen) window.__zbFindOpen(); break;
      case '\\': enabled = false; toast('vim off (Ctrl/Cmd+\\ to re-enable)'); break;
      default: return;      // don't preventDefault unknown keys
    }
    e.preventDefault(); e.stopImmediatePropagation();   // win over site single-key shortcuts
  }

  function copy(s) { try { navigator.clipboard.writeText(s); } catch (e) {} }

  var toastEl;
  function toast(msg) {
    if (!toastEl) { toastEl = document.createElement('div'); toastEl.id = 'zvim-toast'; document.documentElement.appendChild(toastEl); }
    toastEl.textContent = msg; toastEl.style.opacity = '1';
    clearTimeout(toast._t); toast._t = setTimeout(function () { toastEl.style.opacity = '0'; }, 1200);
  }

  var css = document.createElement('style');
  css.textContent =
    '.zvim-hint{background:#ff0;color:#000;font:bold 11px/1.2 "Share Tech Mono",monospace;padding:1px 4px;' +
    'border:1px solid #000;border-radius:2px;box-shadow:0 1px 3px rgba(0,0,0,.5);text-transform:uppercase;}' +
    '.zvim-hint-active{background:#0ff;}' +
    '#zvim-toast{position:fixed;bottom:16px;left:16px;z-index:2147483645;background:rgba(0,0,0,.85);color:#0ff;' +
    'font:12px "Share Tech Mono",monospace;padding:6px 12px;border:1px solid #0ff;border-radius:3px;opacity:0;transition:opacity .2s;pointer-events:none;}';
  (document.head || document.documentElement).appendChild(css);

  document.addEventListener('keydown', onKey, true);
})();
