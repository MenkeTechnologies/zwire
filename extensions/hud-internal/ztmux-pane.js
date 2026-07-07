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
  // Pane iframes only — the top-frame tiling WM is now ZGui.tmux (see ztmux-config.js).
  // This file is just the pane-side forwarder: relays the prefix + synced keystrokes
  // up to the top frame and runs copy-mode locally over the pane's web page.
  if (window.name !== 'zbtmux') return;
  if (window.__zbtmuxPaneLoaded) return; window.__zbtmuxPaneLoaded = true;
  var TOP = false, PANE = true;

  function editable(el) { if (!el) return false; var t = el.tagName; return t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT' || el.isContentEditable; }
  // Prefix: rebindable (Keyboard settings page → tmux). Stored in
  // chrome.storage.local 'zb_tmux_prefix' as a list of chords; a keypress that
  // matches ANY chord arms the overlay. Default = Ctrl-b (the real tmux prefix,
  // but the fork's native-split patch eats it until rebuilt) OR ⌥-b (nothing
  // intercepts Alt-b, so the overlay is testable pre-rebuild). Set your own —
  // e.g. C-a — and it live-reloads. Runs in BOTH the top frame and every pane.
  function defaultPrefix() { return [{ ctrl: true, key: 'b' }, { alt: true, code: 'KeyB' }]; }
  var PREFIX = null, ARM_MS = 2500;
  function chordMatch(e, c) {
    if (!!c.ctrl !== e.ctrlKey || !!c.alt !== e.altKey || !!c.meta !== e.metaKey) return false;
    if (c.shift != null && !!c.shift !== e.shiftKey) return false;
    if (c.code) return e.code === c.code;
    if (c.key) return e.key.toLowerCase() === String(c.key).toLowerCase();
    return false;
  }
  function isPrefix(e) {
    var list = (PREFIX && PREFIX.length) ? PREFIX : defaultPrefix();
    for (var i = 0; i < list.length; i++) if (chordMatch(e, list[i])) return true;
    return false;
  }
  function loadTmuxCfg() {
    try {
      chrome.storage.local.get(['zb_tmux_prefix', 'zb_tmux_opts'], function (o) {
        void chrome.runtime.lastError;
        PREFIX = (o && Array.isArray(o.zb_tmux_prefix) && o.zb_tmux_prefix.length) ? o.zb_tmux_prefix : null;
        var opts = (o && o.zb_tmux_opts) || {};
        ARM_MS = (typeof opts.timeout === 'number' && opts.timeout > 0) ? opts.timeout : 2500;
      });
    } catch (e) {}
  }
  loadTmuxCfg();
  try { chrome.storage.onChanged.addListener(function (ch, area) { if (area === 'local' && (ch.zb_tmux_prefix || ch.zb_tmux_opts)) loadTmuxCfg(); }); } catch (e) {}

  /* ===================== PANE FRAME: forwarder + sync ===================== */
  if (!TOP) {
    var pArmed = false, pTimer = null, pSync = false, lastField = null;
    // remember the last text field focused in THIS pane, so synchronize-panes can
    // apply keystrokes here even while this pane isn't the focused one.
    document.addEventListener('focusin', function (e) { if (editable(e.target)) lastField = e.target; }, true);
    function up(o) { try { parent.postMessage(Object.assign({ __zbtmux: 1 }, o), '*'); } catch (e) {} }
    // ---- copy mode: a real text cursor over the page (Selection API) + search.
    // tmux copy-mode ported onto web content: hjkl/w/b/0/$/g/G/H/M/L motion via
    // Selection.modify, Space/v/V visual selection, / ? n N search via window.find,
    // y/Enter copy → overlay paste-buffer. A synthetic caret makes it visible.
    var copyMode = false, copyInd = null, copyCur = null, selecting = false, searchOpen = false, lastSearch = '', lastBack = false;
    var sel = window.getSelection ? window.getSelection() : null;
    function rangeFromPoint(x, y) {
      if (document.caretRangeFromPoint) return document.caretRangeFromPoint(x, y);
      if (document.caretPositionFromPoint) { var p = document.caretPositionFromPoint(x, y); if (p) { var r = document.createRange(); r.setStart(p.offsetNode, p.offset); r.collapse(true); return r; } }
      return null;
    }
    function copyEnter() {
      if (copyMode || !sel) return; copyMode = true; selecting = false;
      if (!sel.rangeCount || sel.isCollapsed) {                 // drop a caret near the top of the viewport
        var r = null, ys = [16, 48, 96, 160, 240];
        for (var i = 0; i < ys.length && !r; i++) r = rangeFromPoint(14, ys[i]);
        if (!r) { r = document.createRange(); r.selectNodeContents(document.body || document.documentElement); r.collapse(true); }
        sel.removeAllRanges(); sel.addRange(r);
      }
      if (!document.getElementById('zbcur-kf')) { var st = document.createElement('style'); st.id = 'zbcur-kf'; st.textContent = '@keyframes zbcurbl{50%{opacity:.15}}'; (document.head || document.documentElement).appendChild(st); }
      copyInd = document.createElement('div');
      copyInd.textContent = '▨ COPY · hjkl move · w/b word · 0/$ line · g/G top/bot · H/M/L · Space/v select · V line · y copy · / ? n N search · Esc';
      copyInd.style.cssText = 'position:fixed;top:6px;left:50%;transform:translateX(-50%);z-index:2147483647;background:#ff2a6d;color:#fff;padding:3px 10px;font:12px "Share Tech Mono",monospace;border-radius:3px;pointer-events:none;white-space:nowrap;max-width:96vw;overflow:hidden;text-overflow:ellipsis;';
      (document.body || document.documentElement).appendChild(copyInd); showCursor();
    }
    function copyExit() { copyMode = false; selecting = false; searchOpen = false; if (copyInd) { try { copyInd.remove(); } catch (e) {} copyInd = null; } if (copyCur) { try { copyCur.remove(); } catch (e) {} copyCur = null; } if (sel) try { sel.collapseToEnd(); } catch (e) {} }
    function showCursor() {
      if (!copyMode || !sel || !sel.rangeCount) return;
      var r = sel.getRangeAt(0).cloneRange(), rects = r.getClientRects(), rect = rects.length ? rects[rects.length - 1] : r.getBoundingClientRect();
      if (!copyCur) { copyCur = document.createElement('div'); copyCur.style.cssText = 'position:fixed;width:2px;background:#05d9e8;box-shadow:0 0 6px #05d9e8;z-index:2147483646;pointer-events:none;animation:zbcurbl 1s steps(1) infinite;'; (document.body || document.documentElement).appendChild(copyCur); }
      if (rect) { copyCur.style.left = (rect.right || rect.left || 0) + 'px'; copyCur.style.top = (rect.top || 0) + 'px'; copyCur.style.height = (rect.height || 16) + 'px'; }
    }
    function ensureVisible() { try { var r = sel.getRangeAt(0), rc = r.getBoundingClientRect(); if (rc && (rc.top < 40 || rc.bottom > window.innerHeight - 20)) { var el = r.startContainer.nodeType === 1 ? r.startContainer : r.startContainer.parentNode; if (el && el.scrollIntoView) el.scrollIntoView({ block: 'center' }); } } catch (e) {} }
    function mo(dir, gran) { try { sel.modify(selecting ? 'extend' : 'move', dir, gran); } catch (e) {} ensureVisible(); showCursor(); }
    function toPoint(y) { var r = rangeFromPoint(14, y); if (!r) return; if (selecting) { try { sel.extend(r.startContainer, r.startOffset); } catch (e) {} } else { sel.removeAllRanges(); sel.addRange(r); } showCursor(); }
    function yankSel(append) { var s = (sel && String(sel)) || ''; if (s) up({ yank: s, append: !!append }); }
    function doSearch(text, back) { if (!text) return; lastSearch = text; lastBack = back; try { window.find(text, false, back, true); } catch (e) {} selecting = false; showCursor(); }
    function searchPrompt(back) {
      searchOpen = true;
      var box = document.createElement('div'); box.style.cssText = 'position:fixed;bottom:6px;left:50%;transform:translateX(-50%);z-index:2147483647;background:#0a0d16;border:1px solid #05d9e8;color:#c8d2e0;padding:4px 8px;font:13px "Share Tech Mono",monospace;border-radius:3px;';
      box.textContent = back ? '?' : '/'; var si = document.createElement('input'); si.style.cssText = 'background:transparent;border:none;outline:none;color:inherit;font:inherit;width:220px;'; box.appendChild(si); (document.body || document.documentElement).appendChild(box);
      function done() { searchOpen = false; try { box.remove(); } catch (e) {} }
      si.addEventListener('keydown', function (e) { e.stopPropagation(); if (e.key === 'Enter') { done(); doSearch(si.value, back); } else if (e.key === 'Escape') done(); });
      setTimeout(function () { try { si.focus(); } catch (e) {} }, 0);
    }
    function copyKey(e) {
      var k = e.key; e.preventDefault(); e.stopImmediatePropagation();
      if (e.ctrlKey) {
        if (k === 'd') { window.scrollBy(0, window.innerHeight / 2); mo('forward', 'line'); }
        else if (k === 'u') { window.scrollBy(0, -window.innerHeight / 2); mo('backward', 'line'); }
        else if (k === 'f') window.scrollBy(0, window.innerHeight * 0.9);
        else if (k === 'b') window.scrollBy(0, -window.innerHeight * 0.9);
        else if (k === 'e') window.scrollBy(0, 48);
        else if (k === 'y') window.scrollBy(0, -48);
        return;
      }
      switch (k) {
        case 'Escape': if (!sel.isCollapsed) { sel.collapseToStart(); selecting = false; showCursor(); } else copyExit(); return;
        case 'q': copyExit(); return;
        case 'y': case 'Enter': yankSel(false); copyExit(); return;
        case 'A': yankSel(true); copyExit(); return;
        case 'h': case 'ArrowLeft': mo('backward', 'character'); return;
        case 'l': case 'ArrowRight': mo('forward', 'character'); return;
        case 'j': case 'ArrowDown': mo('forward', 'line'); return;
        case 'k': case 'ArrowUp': mo('backward', 'line'); return;
        case 'w': case 'W': case 'e': case 'E': mo('forward', 'word'); return;
        case 'b': case 'B': mo('backward', 'word'); return;
        case '0': case '^': mo('backward', 'lineboundary'); return;
        case '$': mo('forward', 'lineboundary'); return;
        case 'g': mo('backward', 'documentboundary'); window.scrollTo(0, 0); return;
        case 'G': mo('forward', 'documentboundary'); window.scrollTo(0, (document.body || document.documentElement).scrollHeight); return;
        case '{': mo('backward', 'paragraphboundary'); return;
        case '}': mo('forward', 'paragraphboundary'); return;
        case 'H': toPoint(24); return;
        case 'M': toPoint(window.innerHeight / 2); return;
        case 'L': toPoint(window.innerHeight - 28); return;
        case ' ': case 'v': selecting = !selecting; if (!selecting) sel.collapseToStart(); showCursor(); return;
        case 'V': selecting = false; mo('backward', 'lineboundary'); selecting = true; mo('forward', 'lineboundary'); return;
        case 'PageDown': window.scrollBy(0, window.innerHeight * 0.9); return;
        case 'PageUp': window.scrollBy(0, -window.innerHeight * 0.9); return;
        case '/': searchPrompt(false); return;
        case '?': searchPrompt(true); return;
        case 'n': doSearch(lastSearch, lastBack); return;
        case 'N': doSearch(lastSearch, !lastBack); return;
      }
    }
    document.addEventListener('copy', function () { yankSel(false); }, true);
    document.addEventListener('keydown', function (e) {
      if (copyMode) { if (!searchOpen) copyKey(e); return; }   // search box handles its own keys
      if (pArmed) {
        if (e.key === 'Shift' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Meta') return;
        pArmed = false; clearTimeout(pTimer);
        e.preventDefault(); e.stopImmediatePropagation();
        up({ cmdKey: e.key, ctrl: e.ctrlKey, alt: e.altKey });
        return;
      }
      if (isPrefix(e)) {
        e.preventDefault(); e.stopImmediatePropagation();
        pArmed = true; clearTimeout(pTimer); pTimer = setTimeout(function () { pArmed = false; }, ARM_MS);
        up({ prefix: 1 });
        return;
      }
      // ⌘K / Ctrl-K from inside a pane -> open the palette on the top frame so it
      // navigates THIS pane (not a new tab).
      if ((e.metaKey || e.ctrlKey) && !e.altKey && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault(); e.stopImmediatePropagation(); up({ palette: 1 }); return;
      }
      // Broadcast editable keystrokes to the other panes. Always forward; the top
      // frame gates on whether THIS pane is in the sync group (no dependency on
      // receiving setSync first). Plain chars + Enter + Backspace forward as-is; the
      // readline combos forward as semantic tokens: C-w kill word, C-u kill to line
      // start, plus the macOS ⌥/⌘-Delete twins of each.
      if (editable(document.activeElement)) {
        var mod = e.ctrlKey || e.metaKey || e.altKey;
        if (!mod && (e.key.length === 1 || e.key === 'Enter' || e.key === 'Backspace' || e.key === 'Delete')) up({ synckey: e.key });
        else if (e.ctrlKey && !e.metaKey && !e.altKey && (e.key === 'w' || e.key === 'W')) up({ synckey: 'C-w' });
        else if (e.ctrlKey && !e.metaKey && !e.altKey && (e.key === 'u' || e.key === 'U')) up({ synckey: 'C-u' });
        else if (e.altKey && !e.ctrlKey && !e.metaKey && e.key === 'Backspace') up({ synckey: 'C-w' });
        else if (e.metaKey && !e.ctrlKey && !e.altKey && e.key === 'Backspace') up({ synckey: 'C-u' });
      }
    }, true);
    window.addEventListener('message', function (ev) {
      var d = ev.data; if (!d || !d.__zbtmux) return;
      if (d.setSync != null) pSync = !!d.setSync;
      else if (d.copyMode) copyEnter();
      else if (d.pasteText != null) insertText(d.pasteText);
      else if (d.syncapply) applyKey(d.syncapply);
    });
    // Pull our sync membership from the parent on (re)load. The parent also pushes
    // setSync on our iframe's 'load' event, but that races this content script's
    // setup — it runs at document_idle, usually AFTER load fires, so the push is
    // missed and pSync stays false: the pane keeps RECEIVING keystrokes but stops
    // BROADCASTING its own (incl. C-w/C-u) after a navigation. Asking here is
    // race-free — we request only once our own listener exists, and the top frame
    // always has its listener up.
    up({ syncReq: 1 });
    function setNative(el, v) { try { var d = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value'); if (d && d.set) { d.set.call(el, v); return; } } catch (e) {} el.value = v; }
    // focused editable → last-focused → first editable in the page. The final fallback
    // makes synchronize-panes land in a peer pane that was never focused (cross-origin
    // subframes can't autofocus their inputs).
    function targetField() {
      var el = document.activeElement;
      if (editable(el)) return el;
      if (lastField && lastField.isConnected && editable(lastField)) return lastField;
      var f = document.querySelector('input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]), textarea, [contenteditable=""], [contenteditable="true"]');
      if (f) { lastField = f; return f; }
      return null;
    }
    function insertText(text) {
      var el = targetField(); if (!el) return;
      if ('value' in el) { var s = el.selectionStart, e2 = el.selectionEnd; if (s != null) { setNative(el, el.value.slice(0, s) + text + el.value.slice(e2)); try { el.selectionStart = el.selectionEnd = s + text.length; } catch (x) {} } else setNative(el, el.value + text); el.dispatchEvent(new Event('input', { bubbles: true })); }
      else { try { document.execCommand('insertText', false, text); } catch (x) {} }
    }
    function applyKey(k) {
      var el = targetField();
      if (!el) return; var hasVal = ('value' in el), focused = (document.activeElement === el);
      if (k === 'Backspace') { if (hasVal) { setNative(el, el.value.slice(0, -1)); el.dispatchEvent(new Event('input', { bubbles: true })); } else if (focused) { try { document.execCommand('delete'); } catch (e) {} } }
      else if (k === 'Delete') { if (hasVal) { var ds = el.selectionStart, de = el.selectionEnd; if (ds == null) { setNative(el, el.value.slice(0, -1)); } else { if (ds === de && ds < el.value.length) de++; setNative(el, el.value.slice(0, ds) + el.value.slice(de)); try { el.selectionStart = el.selectionEnd = ds; } catch (x) {} } el.dispatchEvent(new Event('input', { bubbles: true })); } else if (focused) { try { document.execCommand('forwardDelete'); } catch (e) {} } }
      else if (k === 'Enter') { el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true })); if (el.form && typeof el.form.requestSubmit === 'function') { try { el.form.requestSubmit(); } catch (e) {} } }
      else if (k === 'C-w' || k === 'C-u') {
        // kill word (C-w) / kill to line start (C-u), cursor-aware. Deletes back
        // from the caret to the word/line-start boundary, keeping text after it.
        if (hasVal) {
          var val = el.value, s = el.selectionStart, e2 = el.selectionEnd;
          if (s == null) { s = e2 = val.length; }
          var cut;
          if (k === 'C-w') { cut = s; while (cut > 0 && /\s/.test(val[cut - 1])) cut--; while (cut > 0 && !/\s/.test(val[cut - 1])) cut--; }
          else { cut = val.lastIndexOf('\n', s - 1) + 1; }
          setNative(el, val.slice(0, cut) + val.slice(e2));
          try { el.selectionStart = el.selectionEnd = cut; } catch (x) {}
          el.dispatchEvent(new Event('input', { bubbles: true }));
        } else if (focused && window.getSelection) {
          try { var sel = window.getSelection(); sel.modify('extend', 'backward', k === 'C-w' ? 'word' : 'lineboundary'); document.execCommand('delete'); } catch (e) {}
        }
      }
      else if (k.length === 1) { if (hasVal) { setNative(el, el.value + k); el.dispatchEvent(new Event('input', { bubbles: true })); } else if (focused) { try { document.execCommand('insertText', false, k); } catch (e) {} } }
    }
    return;
  }
})();
