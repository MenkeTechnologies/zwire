/* zwire HUD — shared filtered-list page on ZGui.appShell + ZGui.dataTable.
 * Each list page (history/downloads/bookmarks) is just a config passed to
 * ZBList(cfg). fzf filter via the shell search; rows via ZGui.dataTable. */
(function () {
  'use strict';
  window.ZBList = function (cfg) {
    var FZ = window.ZGui.fzf, rows = [], query = '';
    var shell = window.ZBHUD.mount({ title: cfg.title, current: cfg.current,
      filterPlaceholder: cfg.placeholder || 'filter…', onFilter: function (q) { query = q; render(); } });
    var body = shell.body;

    function filtered() {
      if (!query.trim()) return rows;
      return rows.map(function (r) { var m = FZ.fzfMatch(query, cfg.text(r)); return m ? { r: r, s: m.score } : null; })
        .filter(Boolean).sort(function (a, b) { return b.s - a.s; }).map(function (x) { return x.r; });
    }
    function render() {
      body.innerHTML = '';
      var shown = filtered();
      var host = document.createElement('div');
      body.appendChild(host);
      var foot = document.createElement('div'); foot.className = 'footer-docs';
      foot.textContent = '[ ' + shown.length + (cfg.noun ? ' ' + cfg.noun : '') + ' ]';
      body.appendChild(foot);
      if (!shown.length) { host.className = 'footer-docs'; host.textContent = '[ nothing here ]'; return; }
      window.ZGui.dataTable(host, { id: cfg.current, sortScope: cfg.current,
        columns: cfg.columns, rows: shown, rowKey: cfg.rowKey,
        onRowClick: cfg.onRowClick });
    }
    function reload() { cfg.load(function (r) { rows = r || []; render(); }); }
    reload();
    if (cfg.watch) cfg.watch(reload);
  };
})();
