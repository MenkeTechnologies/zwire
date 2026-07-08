/* zwire HUD Internal — generic zgui-component adapter for STATIC chrome:// debug
 * pages. Swaps each native <table> for a real ZGui.dataTable (sortable, HUD-styled,
 * cells preserved) so token-less debug dumps read as first-class HUD surfaces built
 * from actual zgui components — INCLUDING tables inside open shadow roots (chrome://gpu
 * renders its tables inside an <info-view> shadow root), which a light-DOM query can't
 * reach. Per shadow root we inject the .zg-datatable CSS so the component is styled
 * across the shadow boundary (CSS custom properties from theme.js DO inherit in).
 *
 * Scope: only the STATIC hosts in the manifest match — LIVE/streaming pages
 * (net-internals, omnibox, tracing, discards, …) are NOT matched; replacing their
 * self-updating DOM would go stale/break, so they keep theme.js's CSS-skin.
 * util.js (window.escapeHtml) + data-table.js are loaded ahead of this by the
 * manifest; the palette vars come from theme.js on the page :root (they inherit
 * into shadow DOM). Everything is wrapped in try/catch: a table that can't be
 * converted is left native (CSS-skin still applies). */
(function () {
  'use strict';
  if (!window.ZGui || !window.ZGui.dataTable) return;   // deps missing — no-op
  var Z = window.ZGui;
  var seq = 0;

  // Minimal .zg-datatable rules (mirrors zgui-core data-table.css) so a table
  // built inside a shadow root — where the content-script <style>/manifest css
  // don't reach — is still styled. Uses the vars theme.js sets on :root.
  var DT_CSS =
    '.zg-datatable{width:100%;border-collapse:collapse;font-size:12px;background:var(--bg-card);}' +
    '.zg-datatable thead th{text-align:left;padding:7px 10px;background:var(--bg-secondary);border-bottom:1px solid var(--border);color:var(--text-dim);font-family:"Orbitron",sans-serif;font-size:10px;letter-spacing:1px;text-transform:uppercase;white-space:nowrap;}' +
    '.zg-datatable th.zg-dt-sortable{cursor:pointer;}' +
    '.zg-datatable th.zg-dt-sortable:hover .zg-dt-th{color:var(--cyan);}' +
    '.zg-dt-th.asc::after{content:" \\25B2";font-size:8px;color:var(--cyan);}' +
    '.zg-dt-th.desc::after{content:" \\25BC";font-size:8px;color:var(--cyan);}' +
    '.zg-datatable tbody td{padding:6px 10px;border-bottom:1px solid var(--border);color:var(--text);}' +
    '.zg-datatable tbody tr:hover{background:var(--bg-hover);}' +
    '.zg-datatable tbody tr:nth-child(even) td{background:rgba(255,255,255,0.02);}';

  function txt(c) { return c ? (c.textContent || '').trim() : ''; }

  // root is a Document or a ShadowRoot — make sure the dataTable CSS lives there.
  function ensureCss(root) {
    try {
      var target = root.nodeType === 9 ? (root.head || root.documentElement) : root;   // 9 = Document
      if (!target || (target.querySelector && target.querySelector('style[data-zbdt]'))) return;
      var st = document.createElement('style');
      st.setAttribute('data-zbdt', '1');
      st.textContent = DT_CSS;
      target.appendChild(st);
    } catch (e) {}
  }

  function convert(table, root) {
    try {
      if (table.getAttribute('data-zb-adapted')) return;
      if (table.parentElement && table.parentElement.closest('table')) return;   // nested — outer carries it

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
        columns.push({
          key: 'c' + i,
          label: hdr && hdr.cells[i] ? txt(hdr.cells[i]) : ('col ' + (i + 1)),
          render: function (r) { return r['h' + i] || ''; }
        });
      })(i);

      var bodyRows = thead
        ? Array.prototype.slice.call(table.tBodies).reduce(function (a, tb) { return a.concat(Array.prototype.slice.call(tb.rows)); }, [])
        : allRows.slice(bodyStart);

      var rows = [];
      bodyRows.forEach(function (r) {
        if (!r.cells.length) return;
        var row = {};
        for (var i = 0; i < ncols; i++) {
          var c = r.cells[i];
          row['c' + i] = txt(c);
          row['h' + i] = c ? c.innerHTML : '';
        }
        rows.push(row);
      });
      if (!rows.length) return;

      ensureCss(root);
      var wrap = document.createElement('div');
      wrap.className = 'zb-adapted';
      table.parentNode.insertBefore(wrap, table.nextSibling);
      Z.dataTable(wrap, { columns: columns, rows: rows, resizable: false, sortScope: 'zbadapt:' + location.host + ':' + (seq++) });
      table.setAttribute('data-zb-adapted', '1');
      table.style.display = 'none';        // keep original in DOM as fallback
    } catch (e) { /* leave native */ }
  }

  // Walk a root's own tables, then recurse into any OPEN shadow roots beneath it.
  function walk(root) {
    try {
      var tables = root.querySelectorAll ? root.querySelectorAll('table:not([data-zb-adapted])') : [];
      for (var i = 0; i < tables.length; i++) convert(tables[i], root);
      var els = root.querySelectorAll ? root.querySelectorAll('*') : [];
      for (var j = 0; j < els.length; j++) if (els[j].shadowRoot) walk(els[j].shadowRoot);
    } catch (e) {}
  }

  function run() { walk(document); }

  run();
  // some pages (and shadow-DOM components) populate their tables a beat after load.
  setTimeout(run, 300);
  setTimeout(run, 1200);
})();
