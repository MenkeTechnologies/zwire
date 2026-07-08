/* zwire HUD Internal — generic zgui-component adapter for STATIC chrome:// debug
 * pages. Rebuilds token-less native pages out of REAL zgui-core widgets only
 * (per the zgui-core-only rule — no hand-rolled CSS/widgets):
 *   • JSON blob (<pre>{…}</pre>) → ZGui.jsonView  (chrome://local-state, tab-strip-internals)
 *   • <table>                    → ZGui.dataTable
 *   • heading + its content      → ZGui.card       (leaf sections; nodes MOVED)
 * The component CSS is the ACTUAL zgui-core files (data-table.css / layout.css /
 * inspect.css), consumed via <link> to the extension's web-accessible copy — not
 * a local copy — including inside OPEN shadow roots (chrome://gpu's <info-view>),
 * so the widgets are styled across the shadow boundary (theme.js's --vars inherit).
 *
 * Scope: only the STATIC hosts in the manifest match. LIVE/streaming pages
 * (net-internals, omnibox, tracing, discards, …) are NOT matched. util.js +
 * data-table.js + card.js + json-view.js load ahead of this. Defensive throughout:
 * anything that can't convert is left native (theme.js's recolor still applies). */
(function () {
  'use strict';
  if (!window.ZGui || !window.ZGui.dataTable) return;   // deps missing — no-op
  var Z = window.ZGui;
  var seq = 0;
  var CSS_FILES = ['data-table.css', 'layout.css', 'inspect.css', 'widgets.css'];

  // Consume the REAL zgui-core stylesheets (not a copy) by linking the extension's
  // web-accessible file into each root — the main doc gets them via manifest "css";
  // shadow roots need their own <link> since author styles don't cross the boundary.
  function ensureCss(root) {
    try {
      var host = root.nodeType === 9 ? (root.head || root.documentElement) : root;   // 9 = Document
      if (!host || (host.querySelector && host.querySelector('link[data-zbcss]'))) return;
      CSS_FILES.forEach(function (f) {
        var link = document.createElement('link');
        link.rel = 'stylesheet';
        link.setAttribute('data-zbcss', '1');
        link.href = chrome.runtime.getURL('lib/zgui-core/webui/' + f);
        host.appendChild(link);
      });
    } catch (e) {}
  }

  function txt(c) { return c ? (c.textContent || '').trim() : ''; }

  // chrome://local-state, tab-strip-internals, … dump a JSON blob (usually in a
  // <pre>). Render it with the real collapsible ZGui.jsonView tree.
  function convertJson(root) {
    if (!Z.jsonView) return;
    try {
      var pres = root.querySelectorAll ? root.querySelectorAll('pre:not([data-zb-json])') : [];
      for (var i = 0; i < pres.length; i++) {
        var s = (pres[i].textContent || '').trim();
        if (s.length < 2 || (s[0] !== '{' && s[0] !== '[')) continue;
        var data;
        try { data = JSON.parse(s); } catch (e) { continue; }
        if (data === null || typeof data !== 'object') continue;
        ensureCss(root);
        var wrap = document.createElement('div');
        wrap.className = 'zg-json-host';
        pres[i].parentNode.insertBefore(wrap, pres[i].nextSibling);
        Z.jsonView(wrap, data, { collapseDepth: 2 });
        pres[i].setAttribute('data-zb-json', '1');
        pres[i].style.display = 'none';
      }
    } catch (e) {}
  }

  function convertTable(table, root) {
    try {
      if (table.getAttribute('data-zb-adapted')) return;
      if (table.parentElement && table.parentElement.closest('table')) return;

      var thead = table.tHead;
      var allRows = Array.prototype.slice.call(table.rows);
      if (!allRows.length) return;

      var hdr = null, bodyStart = 0;
      if (thead && thead.rows.length) hdr = thead.rows[thead.rows.length - 1];
      else if (allRows[0].querySelector('th')) { hdr = allRows[0]; bodyStart = 1; }

      var ncols = hdr ? hdr.cells.length : 0;
      allRows.forEach(function (r) { if (r.cells.length > ncols) ncols = r.cells.length; });
      if (ncols < 1) return;

      var columns = [];
      for (var i = 0; i < ncols; i++) (function (i) {
        columns.push({ key: 'c' + i, label: hdr && hdr.cells[i] ? txt(hdr.cells[i]) : ('col ' + (i + 1)), render: function (r) { return r['h' + i] || ''; } });
      })(i);

      var bodyRows = thead
        ? Array.prototype.slice.call(table.tBodies).reduce(function (a, tb) { return a.concat(Array.prototype.slice.call(tb.rows)); }, [])
        : allRows.slice(bodyStart);

      var rows = [];
      bodyRows.forEach(function (r) {
        if (!r.cells.length) return;
        var row = {};
        for (var i = 0; i < ncols; i++) { var c = r.cells[i]; row['c' + i] = txt(c); row['h' + i] = c ? c.innerHTML : ''; }
        rows.push(row);
      });
      if (!rows.length) return;

      ensureCss(root);
      var wrap = document.createElement('div');
      wrap.className = 'zb-adapted';
      table.parentNode.insertBefore(wrap, table.nextSibling);
      Z.dataTable(wrap, { columns: columns, rows: rows, resizable: false, sortScope: 'zbadapt:' + location.host + ':' + (seq++) });
      table.setAttribute('data-zb-adapted', '1');
      table.style.display = 'none';
    } catch (e) {}
  }

  function hasHeading(nodes) {
    return nodes.some(function (n) { return n.nodeType === 1 && (/^H[1-4]$/.test(n.tagName) || (n.querySelector && n.querySelector('h1,h2,h3,h4'))); });
  }

  function sectionize(root) {
    if (!Z.card) return;
    try {
      var headings = root.querySelectorAll ? Array.prototype.slice.call(root.querySelectorAll('h1,h2,h3,h4')) : [];
      headings.forEach(function (h) {
        try {
          if (h.getAttribute('data-zb-carded')) return;
          if (h.closest && (h.closest('.zg-card') || h.closest('table') || h.closest('.zg-datatable'))) return;
          var collected = [], sib = h.nextSibling;
          while (sib) { if (sib.nodeType === 1 && /^H[1-4]$/.test(sib.tagName)) break; var nx = sib.nextSibling; collected.push(sib); sib = nx; }
          if (!collected.some(function (n) { return n.nodeType === 1; })) return;
          if (hasHeading(collected)) return;
          ensureCss(root);
          var body = document.createElement('div');
          collected.forEach(function (n) { body.appendChild(n); });
          var card = Z.card({ title: txt(h), body: body });
          h.parentNode.insertBefore(card.el, h);
          h.parentNode.removeChild(h);
          card.el.setAttribute('data-zb-carded', '1');
        } catch (e) {}
      });
    } catch (e) {}
  }

  // Native <button>/<input>/<textarea>/<select> keep their handlers — we just add
  // the REAL zgui-core widget classes (.zs-btn / .zs-input from widgets.css) so
  // free-form pages (serviceworker-internals etc.) get real zgui controls.
  function styleControls(root) {
    try {
      if (!root.querySelectorAll) return;
      var btns = root.querySelectorAll('button:not(.zs-btn),input[type=button]:not(.zs-btn),input[type=submit]:not(.zs-btn),input[type=reset]:not(.zs-btn)');
      var ins = root.querySelectorAll('input[type=text]:not(.zs-input),input[type=search]:not(.zs-input),input[type=number]:not(.zs-input),input[type=url]:not(.zs-input),input:not([type]):not(.zs-input),textarea:not(.zs-input),select:not(.zs-input)');
      if (btns.length || ins.length) ensureCss(root);
      for (var i = 0; i < btns.length; i++) btns[i].classList.add('zs-btn');
      for (var j = 0; j < ins.length; j++) ins[j].classList.add('zs-input');
    } catch (e) {}
  }

  function walk(root) {
    try {
      convertJson(root);
      var tables = root.querySelectorAll ? root.querySelectorAll('table:not([data-zb-adapted])') : [];
      for (var i = 0; i < tables.length; i++) convertTable(tables[i], root);
      sectionize(root);
      styleControls(root);
      var els = root.querySelectorAll ? root.querySelectorAll('*') : [];
      for (var j = 0; j < els.length; j++) if (els[j].shadowRoot) walk(els[j].shadowRoot);
    } catch (e) {}
  }

  function run() { walk(document); }
  run();
  setTimeout(run, 300);
  setTimeout(run, 1200);
})();
