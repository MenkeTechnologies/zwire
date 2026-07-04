/* zbrowser HUD settings (replaces chrome://settings) — appearance/scheme control. */
(function () {
  'use strict';
  var HUD = window.ZBROWSER_HUD || {};
  var SCHEMES = HUD.SCHEMES || {};
  var ORDER = HUD.ORDER || ['cyberpunk'];

  function renderSchemes() {
    var cur = (window.__zbApplied && window.__zbApplied()) || 'cyberpunk';
    var box = document.getElementById('schemes');
    box.innerHTML = '';
    ORDER.forEach(function (n) {
      var s = SCHEMES[n]; if (!s) return;
      var b = document.createElement('button');
      b.className = 'scheme-card' + (n === cur ? ' active' : '');
      var dot = document.createElement('span'); dot.className = 'scheme-card-dot';
      dot.style.background = 'linear-gradient(135deg,' + s.vars['--accent'] + ' 0 50%,' + s.vars['--cyan'] + ' 50% 100%)';
      var t = document.createElement('div'); t.className = 'scheme-card-t';
      t.innerHTML = '<b>' + (s.label || n) + '</b><span>' + (s.desc || '') + '</span>';
      b.appendChild(dot); b.appendChild(t);
      b.onclick = function () { if (window.__zbSetScheme) window.__zbSetScheme(n); renderSchemes(); };
      box.appendChild(b);
    });
  }
  // re-render when the scheme changes elsewhere
  renderSchemes();
  setInterval(renderSchemes, 1600);
})();
