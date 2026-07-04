/* zbrowser HUD history (replaces chrome://history). */
(function () {
  'use strict';
  var listEl = document.getElementById('list');
  var countEl = document.getElementById('count');
  var searchEl = document.getElementById('search');
  var items = [];

  function fmt(t) {
    try { var d = new Date(t); return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
    catch (e) { return ''; }
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function render(filter) {
    filter = (filter || '').toLowerCase();
    var shown = items.filter(function (h) {
      return !filter || (h.title || '').toLowerCase().indexOf(filter) !== -1 || h.url.toLowerCase().indexOf(filter) !== -1;
    });
    countEl.textContent = shown.length;
    if (!shown.length) { listEl.innerHTML = '<div class="info-row">[ no history ]</div>'; return; }
    listEl.innerHTML = shown.slice(0, 300).map(function (h) {
      return '<div class="info-row hist"><span class="ik">' + esc(fmt(h.lastVisitTime)) + '</span>' +
        '<a class="iv" href="' + esc(h.url) + '"><b>' + esc(h.title || h.url) + '</b><br><span class="sub">' + esc(h.url) + '</span></a></div>';
    }).join('');
  }

  function load() {
    chrome.history.search({ text: '', maxResults: 500, startTime: 0 }, function (res) {
      items = (res || []).sort(function (a, b) { return b.lastVisitTime - a.lastVisitTime; });
      render(searchEl.value);
    });
  }
  if (searchEl) searchEl.addEventListener('input', function () { render(searchEl.value); });
  load();
})();
