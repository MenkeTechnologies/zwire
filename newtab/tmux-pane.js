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
  function setNative(el, v) { try { var d = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value'); if (d && d.set) { d.set.call(el, v); return; } } catch (e) {} el.value = v; }

  document.addEventListener('focusin', function (e) { if (editable(e.target)) lastField = e.target; }, true);
  // copy mode + capture copies into the overlay's paste buffers.
  var copyMode = false, copyInd = null;
  function copyEnter() { if (copyMode) return; copyMode = true; copyInd = document.createElement('div'); copyInd.textContent = '▨ COPY — j/k/d/u/g/G scroll · select · y/Enter yank · Esc'; copyInd.style.cssText = 'position:fixed;top:6px;left:50%;transform:translateX(-50%);z-index:2147483647;background:#ff2a6d;color:#fff;padding:3px 10px;font:12px monospace;border-radius:3px;pointer-events:none;'; (document.body || document.documentElement).appendChild(copyInd); }
  function copyExit() { copyMode = false; if (copyInd) { try { copyInd.remove(); } catch (e) {} copyInd = null; } }
  function yankSel() { var s = (window.getSelection && String(window.getSelection())) || ''; if (s) up({ yank: s }); }
  function insertText(text) { var el = document.activeElement; if (!editable(el)) el = (lastField && lastField.isConnected && editable(lastField)) ? lastField : null; if (!el) return; if ('value' in el) { var s = el.selectionStart, e2 = el.selectionEnd; if (s != null) { setNative(el, el.value.slice(0, s) + text + el.value.slice(e2)); try { el.selectionStart = el.selectionEnd = s + text.length; } catch (x) {} } else setNative(el, el.value + text); el.dispatchEvent(new Event('input', { bubbles: true })); } else { try { document.execCommand('insertText', false, text); } catch (x) {} } }
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
    if (sync && !e.ctrlKey && !e.metaKey && !e.altKey && editable(document.activeElement) &&
        (e.key.length === 1 || e.key === 'Enter' || e.key === 'Backspace')) {
      up({ synckey: e.key });
    }
  }, true);

  window.addEventListener('message', function (ev) {
    var d = ev.data; if (!d || !d.__zbtmux) return;
    if (d.setSync != null) { sync = !!d.setSync; return; }
    if (d.copyMode) { copyEnter(); return; }
    if (d.pasteText != null) { insertText(d.pasteText); return; }
    if (d.syncapply) {
      var el = document.activeElement;
      if (!editable(el)) el = (lastField && lastField.isConnected && editable(lastField)) ? lastField : null;
      if (!el) return; var k = d.syncapply, hasVal = ('value' in el);
      if (k === 'Backspace') { if (hasVal) { setNative(el, el.value.slice(0, -1)); el.dispatchEvent(new Event('input', { bubbles: true })); } }
      else if (k === 'Enter') { el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); if (el.form && typeof el.form.requestSubmit === 'function') { try { el.form.requestSubmit(); } catch (e) {} } }
      else if (k.length === 1) { if (hasVal) { setNative(el, el.value + k); el.dispatchEvent(new Event('input', { bubbles: true })); } }
    }
  });
})();
