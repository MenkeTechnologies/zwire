/* zbrowser HUD downloads (replaces chrome://downloads). */
(function () {
  'use strict';
  var listEl = document.getElementById('list');
  var countEl = document.getElementById('count');
  var searchEl = document.getElementById('search');
  var items = [];

  function base(p) { return String(p || '').split(/[\\/]/).pop(); }
  function size(n) { if (!n || n < 0) return '—'; var u = ['B', 'KB', 'MB', 'GB']; var i = 0; while (n >= 1024 && i < 3) { n /= 1024; i++; } return n.toFixed(i ? 1 : 0) + ' ' + u[i]; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function render(filter) {
    filter = (filter || '').toLowerCase();
    var shown = items.filter(function (d) {
      return !filter || base(d.filename).toLowerCase().indexOf(filter) !== -1 || (d.url || '').toLowerCase().indexOf(filter) !== -1;
    });
    countEl.textContent = shown.length;
    if (!shown.length) { listEl.innerHTML = '<div class="info-row">[ no downloads ]</div>'; return; }
    listEl.innerHTML = shown.map(function (d) {
      var st = d.state === 'complete' ? 'DONE' : d.state === 'interrupted' ? 'FAILED' : 'ACTIVE';
      return '<div class="info-row hist"><span class="ik">' + esc(st) + ' · ' + esc(size(d.bytesReceived || d.fileSize)) + '</span>' +
        '<span class="iv"><b>' + esc(base(d.filename)) + '</b><br><span class="sub">' + esc(d.url || '') + '</span></span></div>';
    }).join('');
  }

  function load() {
    chrome.downloads.search({ limit: 300, orderBy: ['-startTime'] }, function (res) {
      items = res || [];
      render(searchEl.value);
    });
  }
  if (searchEl) searchEl.addEventListener('input', function () { render(searchEl.value); });
  if (chrome.downloads && chrome.downloads.onChanged) chrome.downloads.onChanged.addListener(load);
  load();
})();
