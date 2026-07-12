/* zwire HUD Reading List (ports Vivaldi's/Chrome's reading list). Lists
 * chrome.readingList entries — add the current tab, mark read/unread, remove,
 * open. Two filters (Unread / All). Runs on the reading-list HUD page (an
 * extension page, so chrome.readingList is available directly).
 *
 * The pure sort/partition helper is exposed on window.ZBReadingList for tests. */
(function () {
  'use strict';

  // Newest first; unread before read when both shown.
  function order(entries) {
    return (entries || []).slice().sort(function (a, b) {
      if (!!a.hasBeenRead !== !!b.hasBeenRead) return a.hasBeenRead ? 1 : -1;
      return (b.creationTime || 0) - (a.creationTime || 0);
    });
  }
  function partition(entries) {
    var unread = 0; (entries || []).forEach(function (e) { if (!e.hasBeenRead) unread++; });
    return { unread: unread, total: (entries || []).length };
  }
  var ZBReadingList = { order: order, partition: partition };
  if (typeof window !== 'undefined') window.ZBReadingList = ZBReadingList;

  if (typeof window === 'undefined' || !window.ZBHUD || typeof chrome === 'undefined' || !chrome.readingList) return;

  function el(t, c, x) { var e = document.createElement(t); if (c) e.className = c; if (x != null) e.textContent = x; return e; }
  function host(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return u; } }
  function chipColor(h) { var s = 0; for (var i = 0; i < h.length; i++) s = (s * 31 + h.charCodeAt(i)) >>> 0; return 'hsl(' + (s % 360) + ',70%,60%)'; }

  var shell = window.ZBHUD.mount({ title: 'READING LIST', current: 'readinglist.html', filterPlaceholder: 'filter…', onFilter: function (q) { query = q || ''; render(); } });
  var body = shell.body;
  var entries = [], filter = 'unread', query = '';

  function load() { try { chrome.readingList.query({}, function (e) { void chrome.runtime.lastError; entries = e || []; render(); }); } catch (e) { entries = []; render(); } }
  function addCurrent() {
    try { chrome.tabs.query({ active: true, lastFocusedWindow: true }, function (tabs) {
      var t = (tabs || [])[0]; if (!t || !t.url || !/^https?:/.test(t.url)) return;
      chrome.readingList.addEntry({ url: t.url, title: t.title || t.url, hasBeenRead: false }, function () { void chrome.runtime.lastError; load(); });
    }); } catch (e) {}
  }
  function setRead(url, read) { try { chrome.readingList.updateEntry({ url: url, hasBeenRead: read }, function () { void chrome.runtime.lastError; load(); }); } catch (e) {} }
  function remove(url) { try { chrome.readingList.removeEntry({ url: url }, function () { void chrome.runtime.lastError; load(); }); } catch (e) {} }

  function render() {
    body.innerHTML = '';
    var bar = el('div', 'zr-bar');
    var add = el('button', 'zr-btn', '＋ Add current tab'); add.addEventListener('click', addCurrent); bar.appendChild(add);
    bar.appendChild(el('span', 'zr-spacer'));
    ['unread', 'all'].forEach(function (f) { var b = el('button', 'zr-btn' + (filter === f ? ' on' : ''), f === 'unread' ? 'Unread' : 'All'); b.addEventListener('click', function () { filter = f; render(); }); bar.appendChild(b); });
    body.appendChild(bar);

    var rows = order(entries);
    if (filter === 'unread') rows = rows.filter(function (e) { return !e.hasBeenRead; });
    if (query.trim()) { var ql = query.toLowerCase(); rows = rows.filter(function (e) { return ((e.title || '') + ' ' + e.url).toLowerCase().indexOf(ql) >= 0; }); }
    var list = el('div', 'zr-list');
    if (!rows.length) { list.appendChild(el('div', 'zr-empty', 'Nothing here — ＋ Add current tab.')); }
    rows.forEach(function (e) {
      var row = el('div', 'zr-row' + (e.hasBeenRead ? ' zr-read' : ''));
      var h = host(e.url);
      var chip = el('span', 'zr-chip', (h[0] || '?').toUpperCase()); chip.style.background = chipColor(h); row.appendChild(chip);
      var main = el('div', 'zr-main');
      main.appendChild(el('div', 'zr-title', e.title || e.url));
      main.appendChild(el('div', 'zr-host', h));
      main.addEventListener('click', function () { chrome.tabs.create({ url: e.url }); if (!e.hasBeenRead) setRead(e.url, true); });
      row.appendChild(main);
      var mark = el('button', 'zr-mini', e.hasBeenRead ? '● unread' : '○ read'); mark.title = 'Toggle read'; mark.addEventListener('click', function (ev) { ev.stopPropagation(); setRead(e.url, !e.hasBeenRead); }); row.appendChild(mark);
      var del = el('button', 'zr-mini zr-danger', '✕'); del.addEventListener('click', function (ev) { ev.stopPropagation(); remove(e.url); }); row.appendChild(del);
      list.appendChild(row);
    });
    body.appendChild(list);
    var foot = el('div', 'footer-docs'); var p = partition(entries); foot.textContent = '[ ' + p.unread + ' unread · ' + p.total + ' total ]'; body.appendChild(foot);
  }
  load();
  if (chrome.readingList.onEntryAdded) try { chrome.readingList.onEntryAdded.addListener(load); chrome.readingList.onEntryRemoved.addListener(load); chrome.readingList.onEntryUpdated.addListener(load); } catch (e) {}
})();
