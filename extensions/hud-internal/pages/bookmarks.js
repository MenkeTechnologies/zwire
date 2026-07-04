/* zbrowser HUD Bookmarks (replaces chrome://bookmarks) — ZGui.dataTable. */
(function () {
  'use strict';
  function walk(nodes, path, out) {
    (nodes || []).forEach(function (n) {
      if (n.url) out.push({ title: n.title || n.url, url: n.url, path: path, id: n.id });
      else if (n.children) walk(n.children, path ? path + ' / ' + (n.title || '') : (n.title || ''), out);
    });
  }
  ZBList({
    title: 'BOOKMARKS', current: 'bookmarks.html', placeholder: 'filter bookmarks…', noun: 'bookmarks',
    load: function (cb) { chrome.bookmarks.getTree(function (tree) { var out = []; walk(tree, '', out); cb(out); }); },
    watch: function (reload) { if (chrome.bookmarks.onCreated) { chrome.bookmarks.onCreated.addListener(reload); chrome.bookmarks.onRemoved.addListener(reload); chrome.bookmarks.onChanged.addListener(reload); } },
    rowKey: function (b) { return b.id; },
    columns: [
      { key: 'path', label: 'Folder', width: '240px', render: function (b) { return b.path || '—'; } },
      { key: 'title', label: 'Title', render: function (b) { return b.title; } },
      { key: 'url', label: 'URL', render: function (b) { var a = document.createElement('a'); a.href = b.url; a.textContent = b.url; a.style.color = 'var(--cyan)'; return a; } }
    ],
    text: function (b) { return b.title + ' ' + b.url; },
    onRowClick: function (b) { chrome.tabs.create({ url: b.url }); }
  });
})();
