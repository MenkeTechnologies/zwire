/* zwire HUD History (replaces chrome://history) — ZGui.dataTable. */
(function () {
  'use strict';
  function fmt(t) { try { var d = new Date(t); return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; } }
  ZBList({
    title: 'HISTORY', current: 'history.html', placeholder: 'filter history…', noun: 'visits',
    load: function (cb) { chrome.history.search({ text: '', maxResults: 1000, startTime: 0 }, function (res) { cb((res || []).sort(function (a, b) { return b.lastVisitTime - a.lastVisitTime; })); }); },
    columns: [
      { key: 'time', label: 'Visited', width: '180px', sortable: false, render: function (r) { return fmt(r.lastVisitTime); } },
      { key: 'title', label: 'Title', render: function (r) { return r.title || r.url; } },
      { key: 'url', label: 'URL', render: function (r) { var a = document.createElement('a'); a.href = r.url; a.textContent = r.url; a.style.color = 'var(--cyan)'; return a; } }
    ],
    text: function (r) { return (r.title || '') + ' ' + r.url; },
    onRowClick: function (r) { chrome.tabs.create({ url: r.url }); }
  });
})();
