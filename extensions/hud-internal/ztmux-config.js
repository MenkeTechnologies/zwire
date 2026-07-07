/* zwire HUD — drive the shared ZGui.tmux (zgui-core) with web-page iframe panes,
 * replacing ztmux.js's bespoke top-frame WM. Top frame only. The pane-side
 * forwarder (ztmux-pane.js, injected all_frames) posts the prefix + synced
 * keystrokes + yanks up here; we relay them into ZGui.tmux via its external-feed
 * API (prefix/key/relaySync/yank). Pane content is a sandboxed iframe (name
 * 'zbtmux') so the forwarder runs inside it and the extension's header stripper
 * lets any site frame. */
(function () {
  'use strict';
  if (window.top !== window) return;
  if (window.__ztmuxCfgLoaded) return; window.__ztmuxCfgLoaded = true;

  // every fresh pane opens the zwire new-tab (same page chrome://newtab redirects to).
  var NEWTAB = 'chrome-extension://gpoepnekoiplhkegjpocnpeijiefgieb/newtab.html';
  function looksUrl(q) { return /^[a-z][a-z0-9+.\-]*:\/\//i.test(q) || (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(q) && q.indexOf(' ') < 0); }
  function normalizeUrl(v) {
    v = (v || '').trim(); if (!v || v === 'about:blank') return NEWTAB;
    if (/^[a-z][a-z0-9+.\-]*:\/\//i.test(v)) return v;
    if (looksUrl(v)) return 'https://' + v;
    return 'https://www.google.com/search?q=' + encodeURIComponent(v);
  }
  function hostLabel(url) { try { return (url && url !== NEWTAB) ? new URL(normalizeUrl(url)).hostname.replace(/^www\./, '') : 'newtab'; } catch (e) { return 'newtab'; } }

  // Build a pane: an address bar + a framed web page, into the element ZGui.tmux hands us.
  function mountPane(bodyEl, ref) {
    bodyEl.textContent = '';
    var url = (ref && ref.url) || NEWTAB;
    var wrap = document.createElement('div'); wrap.className = 'ztx-pane';
    var addr = document.createElement('input'); addr.className = 'ztx-addr'; addr.spellcheck = false;
    addr.placeholder = 'url or search …'; addr.value = (url && url !== NEWTAB) ? url : '';
    var fr = document.createElement('iframe'); fr.className = 'ztx-fr'; fr.name = 'zbtmux';
    fr.setAttribute('allow', 'clipboard-read; clipboard-write; fullscreen');
    fr.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads allow-top-navigation-by-user-activation allow-storage-access-by-user-activation allow-presentation');
    fr.src = normalizeUrl(url);
    function go(u) { u = normalizeUrl(u); ref.url = u; fr.src = u; try { fr.focus(); } catch (e) {} }
    addr.addEventListener('keydown', function (e) { e.stopPropagation(); if (e.key === 'Enter') go(addr.value); });
    wrap.appendChild(addr); wrap.appendChild(fr); bodyEl.appendChild(wrap);
    bodyEl._ztxFrame = fr; bodyEl._ztxAddr = addr;
    return ref;
  }
  function frameOf(bodyEl) { return bodyEl && bodyEl._ztxFrame; }
  function postToPane(bodyEl, msg) { var fr = frameOf(bodyEl); if (fr) try { fr.contentWindow.postMessage(Object.assign({ __zbtmux: 1 }, msg), '*'); } catch (e) {} }
  // find the pane body whose iframe sent a message (its parent is the ZGui.tmux pane body).
  function bodyOfSource(src) {
    var frs = document.querySelectorAll('#zg-tmux iframe.ztx-fr');
    for (var i = 0; i < frs.length; i++) if (frs[i].contentWindow === src) return frs[i].closest('.zt-pane-body') || frs[i].parentNode.parentNode;
    return null;
  }

  /* ---- prefs via chrome.storage (sessions live in zb_tmux_sessions) ---- */
  function prefsLoad() { return new Promise(function (res) { try { chrome.storage.local.get(['zb_tmux_prefix', 'zb_tmux_opts', 'zb_keys', 'zb_tmux_sessions'], function (o) { void chrome.runtime.lastError; res({ tmuxPrefix: o.zb_tmux_prefix, tmuxOpts: o.zb_tmux_opts, tmuxKeys: o.zb_keys, tmuxSessions: o.zb_tmux_sessions }); }); } catch (e) { res({}); } }); }
  function prefsSave(p) { try { chrome.storage.local.set({ zb_tmux_sessions: p.tmuxSessions || [] }); } catch (e) {} return Promise.resolve(); }

  function boot() {
    if (!window.ZGui || !ZGui.tmux) return;
    ZGui.tmux.init({
      prefs: { load: prefsLoad, save: prefsSave },
      openEmptyPane: function (bodyEl) { var ref = { url: NEWTAB }; mountPane(bodyEl, ref); return Promise.resolve(ref); },
      renderPane: function (bodyEl, ref) { mountPane(bodyEl, ref); },
      paneLabel: function (ref) { return hostLabel(ref && ref.url); },
      // pane ops for the cross-origin iframe model — postMessage into the pane's forwarder.
      applyKey: function (bodyEl, key) { postToPane(bodyEl, { syncapply: key }); },
      copyMode: function (bodyEl) { postToPane(bodyEl, { copyMode: true }); },
      paste: function (bodyEl, text) { postToPane(bodyEl, { pasteText: text }); }
    });
  }

  // Relay pane-forwarder messages into ZGui.tmux (the prefix is pressed INSIDE a pane).
  window.addEventListener('message', function (ev) {
    var d = ev.data; if (!d || !d.__zbtmux || !window.ZGui || !ZGui.tmux) return;
    if (d.prefix) ZGui.tmux.prefix();
    else if (d.cmdKey) ZGui.tmux.key(d.cmdKey, { ctrl: d.ctrl, alt: d.alt });
    else if (d.palette) { try { if (window.__zbPaletteOpen) window.__zbPaletteOpen(); } catch (e) {} }
    else if (d.synckey) { var b = bodyOfSource(ev.source); if (b) ZGui.tmux.relaySync(b, d.synckey); }
    else if (d.yank) ZGui.tmux.yank(d.yank);
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
