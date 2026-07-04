/* zbrowser HUD bookmarks (replaces chrome://bookmarks). */
(function () {
  'use strict';
  var listEl = document.getElementById('list');
  var countEl = document.getElementById('count');
  var searchEl = document.getElementById('search');
  var flat = [];

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function walk(nodes, path) {
    (nodes || []).forEach(function (n) {
      if (n.url) { flat.push({ title: n.title || n.url, url: n.url, path: path }); }
      else if (n.children) { walk(n.children, path ? path + ' / ' + (n.title || '') : (n.title || '')); }
    });
  }

  function render(filter) {
    filter = (filter || '').toLowerCase();
    var shown = flat.filter(function (b) {
      return !filter || b.title.toLowerCase().indexOf(filter) !== -1 || b.url.toLowerCase().indexOf(filter) !== -1;
    });
    countEl.textContent = shown.length;
    if (!shown.length) { listEl.innerHTML = '<div class="info-row">[ no bookmarks ]</div>'; return; }
    listEl.innerHTML = shown.slice(0, 500).map(function (b) {
      return '<div class="info-row hist"><span class="ik">' + esc(b.path || '—') + '</span>' +
        '<a class="iv" href="' + esc(b.url) + '"><b>' + esc(b.title) + '</b><br><span class="sub">' + esc(b.url) + '</span></a></div>';
    }).join('');
  }

  function load() {
    chrome.bookmarks.getTree(function (tree) {
      flat = []; walk(tree, ''); render(searchEl.value);
    });
  }
  if (searchEl) searchEl.addEventListener('input', function () { render(searchEl.value); });
  if (chrome.bookmarks && chrome.bookmarks.onCreated) {
    chrome.bookmarks.onCreated.addListener(load);
    chrome.bookmarks.onRemoved.addListener(load);
  }
  load();
})();
