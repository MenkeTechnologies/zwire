/* zwire newtab — tmux pane forwarder. When this new-tab page is framed as a
 * tmux pane (window.name === 'zbtmux'), the tmux overlay lives in the PARENT
 * frame and our content script can't run here (different extension origin), so
 * C-b would fall into a dead frame ("half the time C-b doesn't register").
 * This mirrors the pane forwarder in hud-internal/ztmux.js: it captures the
 * C-b/⌥b prefix + the command key and posts them up, opens the palette on ⌘K,
 * and relays synchronize-panes keystrokes. Inert on the real (top-level) NTP. */
(function () {
  'use strict';
  if (window.name !== 'zbtmux' || window.top === window.self) return;

  var armed = false, timer = null, sync = false, lastField = null;
  function up(o) { try { parent.postMessage(Object.assign({ __zbtmux: 1 }, o), '*'); } catch (e) {} }
  function isPrefix(e) {
    if (e.metaKey) return false;
    if (e.ctrlKey && !e.altKey && (e.key === 'b' || e.key === 'B')) return true;
    if (e.altKey && !e.ctrlKey && e.code === 'KeyB') return true;
    return false;
  }
  function editable(el) { if (!el) return false; var t = el.tagName; return t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT' || el.isContentEditable; }
  // The field to write into: focused editable → last-focused → first editable in the
  // page. The final fallback is what makes synchronize-panes work: a cross-origin pane
  // iframe can't autofocus its input ("Blocked autofocusing … in a cross-origin
  // subframe"), so a peer pane RECEIVING a synced keystroke has nothing focused yet.
  function targetField() {
    var el = document.activeElement;
    if (editable(el)) return el;
    if (lastField && lastField.isConnected && editable(lastField)) return lastField;
    var f = document.querySelector('input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]), textarea, [contenteditable=""], [contenteditable="true"]');
    if (f) { lastField = f; return f; }
    return null;
  }
  function setNative(el, v) { try { var d = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value'); if (d && d.set) { d.set.call(el, v); return; } } catch (e) {} el.value = v; }

  document.addEventListener('focusin', function (e) { if (editable(e.target)) lastField = e.target; }, true);
  // copy mode + capture copies into the overlay's paste buffers.
  var copyMode = false, copyInd = null;
  function copyEnter() { if (copyMode) return; copyMode = true; copyInd = document.createElement('div'); copyInd.textContent = '▨ COPY — j/k/d/u/g/G scroll · select · y/Enter yank · Esc'; copyInd.style.cssText = 'position:fixed;top:6px;left:50%;transform:translateX(-50%);z-index:2147483647;background:#ff2a6d;color:#fff;padding:3px 10px;font:12px monospace;border-radius:3px;pointer-events:none;'; (document.body || document.documentElement).appendChild(copyInd); }
  function copyExit() { copyMode = false; if (copyInd) { try { copyInd.remove(); } catch (e) {} copyInd = null; } }
  function yankSel() { var s = (window.getSelection && String(window.getSelection())) || ''; if (s) up({ yank: s }); }
  function insertText(text) { var el = targetField(); if (!el) return; if ('value' in el) { var s = el.selectionStart, e2 = el.selectionEnd; if (s != null) { setNative(el, el.value.slice(0, s) + text + el.value.slice(e2)); try { el.selectionStart = el.selectionEnd = s + text.length; } catch (x) {} } else setNative(el, el.value + text); el.dispatchEvent(new Event('input', { bubbles: true })); } else { try { document.execCommand('insertText', false, text); } catch (x) {} } }
  document.addEventListener('copy', function () { yankSel(); }, true);
  document.addEventListener('keydown', function (e) {
    if (copyMode) {
      e.preventDefault(); e.stopImmediatePropagation(); var ck = e.key;
      if (ck === 'Escape') copyExit();
      else if (ck === 'y' || ck === 'Enter') { yankSel(); copyExit(); }
      else if (ck === 'j' || ck === 'ArrowDown') window.scrollBy(0, 64);
      else if (ck === 'k' || ck === 'ArrowUp') window.scrollBy(0, -64);
      else if (ck === 'd') window.scrollBy(0, window.innerHeight / 2);
      else if (ck === 'u') window.scrollBy(0, -window.innerHeight / 2);
      else if (ck === 'g') window.scrollTo(0, 0);
      else if (ck === 'G') window.scrollTo(0, document.body.scrollHeight);
      else if (ck === ' ' || ck === 'PageDown') window.scrollBy(0, window.innerHeight * 0.9);
      else if (ck === 'b' || ck === 'PageUp') window.scrollBy(0, -window.innerHeight * 0.9);
      return;
    }
    if (armed) {
      if (e.key === 'Shift' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Meta') return;
      armed = false; clearTimeout(timer);
      e.preventDefault(); e.stopImmediatePropagation();
      up({ cmdKey: e.key, ctrl: e.ctrlKey, alt: e.altKey });
      return;
    }
    if (isPrefix(e)) {
      e.preventDefault(); e.stopImmediatePropagation();
      armed = true; clearTimeout(timer); timer = setTimeout(function () { armed = false; }, 2500);
      up({ prefix: 1 });
      return;
    }
    if ((e.metaKey || e.ctrlKey) && !e.altKey && (e.key === 'k' || e.key === 'K')) {
      e.preventDefault(); e.stopImmediatePropagation(); up({ palette: 1 }); return;
    }
    // synchronize-panes: always forward editable typing to the top frame; the top
    // decides whether to broadcast (only if THIS pane is in the sync group). No
    // dependency on setSync. Printable + Enter + Backspace + Delete as-is; C-w / C-u
    // (and the macOS ⌥/⌘-Delete twins) as semantic tokens.
    if (editable(document.activeElement)) {
      if (!e.ctrlKey && !e.metaKey && !e.altKey && (e.key.length === 1 || e.key === 'Enter' || e.key === 'Backspace' || e.key === 'Delete')) up({ synckey: e.key });
      else if (e.ctrlKey && !e.metaKey && !e.altKey && (e.key === 'w' || e.key === 'W')) up({ synckey: 'C-w' });
      else if (e.ctrlKey && !e.metaKey && !e.altKey && (e.key === 'u' || e.key === 'U')) up({ synckey: 'C-u' });
      else if (e.altKey && !e.ctrlKey && !e.metaKey && e.key === 'Backspace') up({ synckey: 'C-w' });
      else if (e.metaKey && !e.ctrlKey && !e.altKey && e.key === 'Backspace') up({ synckey: 'C-u' });
    }
  }, true);

  window.addEventListener('message', function (ev) {
    var d = ev.data; if (!d || !d.__zbtmux) return;
    if (d.setSync != null) { sync = !!d.setSync; return; }
    if (d.copyMode) { copyEnter(); return; }
    if (d.pasteText != null) { insertText(d.pasteText); return; }
    if (d.syncapply) {
      var el = targetField();
      if (!el) return; var k = d.syncapply, hasVal = ('value' in el);
      var s = hasVal ? (el.selectionStart == null ? el.value.length : el.selectionStart) : 0;
      var e2 = hasVal ? (el.selectionEnd == null ? s : el.selectionEnd) : 0;
      function fire() { el.dispatchEvent(new Event('input', { bubbles: true })); }
      function put(v, caret) { setNative(el, v); try { el.selectionStart = el.selectionEnd = caret; } catch (x) {} fire(); }
      if (k === 'Backspace') { if (hasVal) { var bs = s; if (s === e2 && s > 0) bs--; put(el.value.slice(0, bs) + el.value.slice(e2), bs); } }
      else if (k === 'Delete') { if (hasVal) { var de = e2; if (s === e2 && s < el.value.length) de++; put(el.value.slice(0, s) + el.value.slice(de), s); } }
      else if (k === 'Enter') { el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); if (el.form && typeof el.form.requestSubmit === 'function') { try { el.form.requestSubmit(); } catch (e) {} } }
      else if (k === 'C-w' || k === 'C-u') { if (hasVal) { var val = el.value, cut; if (k === 'C-w') { cut = s; while (cut > 0 && /\s/.test(val[cut - 1])) cut--; while (cut > 0 && !/\s/.test(val[cut - 1])) cut--; } else { cut = val.lastIndexOf('\n', s - 1) + 1; } put(val.slice(0, cut) + val.slice(e2), cut); } }
      else if (k.length === 1) { if (hasVal) put(el.value.slice(0, s) + k + el.value.slice(e2), s + 1); }
    }
  });
})();
