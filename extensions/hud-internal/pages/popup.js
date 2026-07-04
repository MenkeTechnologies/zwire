/* zbrowser scheme picker popup — the single control that drives the whole
 * product's palette. Writes the picked scheme to the native host
 * (~/.zbrowser/hud-scheme -> compiled color mixer repaints chrome) AND mirrors
 * it to chrome.storage ('zb_scheme' -> the theme.js content script recolors
 * every internal page). */
(function () {
  'use strict';
  var HUD = window.ZBROWSER_HUD || {};
  var SCHEMES = HUD.SCHEMES || {};
  var ORDER = HUD.ORDER || Object.keys(SCHEMES);
  var VAR_KEYS = HUD.VAR_KEYS || [];
  var HOST = 'com.zbrowser.hud';
  var grid = document.getElementById('grid');
  var current = null;

  function applyPreview(name) {
    var s = SCHEMES[name]; if (!s) return;
    var vars = s.vars || {}, root = document.documentElement;
    for (var i = 0; i < VAR_KEYS.length; i++) if (vars[VAR_KEYS[i]]) root.style.setProperty(VAR_KEYS[i], vars[VAR_KEYS[i]]);
    current = name; renderActive();
  }

  function setScheme(name) {
    applyPreview(name);
    try { chrome.runtime.sendNativeMessage(HOST, { scheme: name }, function () { void chrome.runtime.lastError; }); } catch (e) {}
    try { if (chrome.storage && chrome.storage.local) chrome.storage.local.set({ zb_scheme: name }); } catch (e) {}
  }

  function renderActive() {
    Array.prototype.forEach.call(grid.children, function (el) {
      el.classList.toggle('active', el.getAttribute('data-name') === current);
    });
  }

  function build() {
    ORDER.forEach(function (name) {
      var s = SCHEMES[name]; if (!s) return;
      var b = document.createElement('button');
      b.className = 'card'; b.setAttribute('data-name', name);
      var dot = document.createElement('span'); dot.className = 'dot';
      dot.style.background = 'linear-gradient(135deg,' + s.vars['--accent'] + ' 0 50%,' + s.vars['--cyan'] + ' 50% 100%)';
      var lbl = document.createElement('span'); lbl.className = 'lbl';
      lbl.innerHTML = '<b>' + (s.label || name) + '</b><span>' + (s.blurb || name) + '</span>';
      b.appendChild(dot); b.appendChild(lbl);
      b.onclick = function () { setScheme(name); };
      grid.appendChild(b);
    });
  }

  function init() {
    build();
    try {
      chrome.runtime.sendNativeMessage(HOST, { cmd: 'get' }, function (r) {
        void chrome.runtime.lastError;
        applyPreview((r && r.scheme) || 'cyberpunk');
      });
    } catch (e) { applyPreview('cyberpunk'); }
  }
  init();
})();
