/* zwire HUD Downloads (replaces chrome://downloads) — ZGui.dataTable. */
(function () {
  'use strict';
  function base(p) { return String(p || '').split(/[\\/]/).pop(); }
  function size(n) { if (!n || n < 0) return '—'; var u = ['B', 'KB', 'MB', 'GB'], i = 0; while (n >= 1024 && i < 3) { n /= 1024; i++; } return n.toFixed(i ? 1 : 0) + ' ' + u[i]; }
  ZBList({
    title: 'DOWNLOADS', current: 'downloads.html', placeholder: 'filter downloads…', noun: 'files',
    load: function (cb) { chrome.downloads.search({ limit: 500, orderBy: ['-startTime'] }, function (res) { cb(res || []); }); },
    watch: function (reload) { if (chrome.downloads.onChanged) chrome.downloads.onChanged.addListener(reload); },
    columns: [
      { key: 'state', label: 'State', width: '110px', render: function (d) { return d.state === 'complete' ? 'DONE' : d.state === 'interrupted' ? 'FAILED' : 'ACTIVE'; } },
      { key: 'size', label: 'Size', width: '90px', render: function (d) { return size(d.bytesReceived || d.fileSize); } },
      { key: 'file', label: 'File', render: function (d) { return base(d.filename); } },
      { key: 'url', label: 'From', render: function (d) { return d.url || ''; } }
    ],
    text: function (d) { return base(d.filename) + ' ' + (d.url || ''); },
    onRowClick: function (d) { if (d.exists !== false && d.state === 'complete') try { chrome.downloads.open(d.id); } catch (e) {} }
  });
})();
