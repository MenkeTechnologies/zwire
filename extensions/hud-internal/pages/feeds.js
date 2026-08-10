/* zwire HUD Feeds (ports Vivaldi's built-in RSS/Atom feed reader). Add feed URLs;
 * each is fetched directly (extension page, <all_urls>) and parsed (RSS + Atom).
 * Left: your feeds + a combined view; right: the items, newest first, click to
 * open. Feed URLs persist in chrome.storage (zb_feeds).
 *
 * The pure feed parser is exposed on window.ZBFeeds for headless tests. */
(function () {
  'use strict';

  // ---- pure RSS/Atom parser (regex-based so it runs headless too) -----------
  function stripTags(s) { return String(s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim(); }
  function decode(s) {
    return String(s || '')
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  }
  function tag(block, name) {
    var m = new RegExp('<' + name + '(?:\\s[^>]*)?>([\\s\\S]*?)<\\/' + name + '>', 'i').exec(block);
    return m ? decode(m[1]).trim() : '';
  }
  function atomLink(block) {
    var m = /<link\b[^>]*\bhref=["']([^"']+)["'][^>]*>/i.exec(block);
    return m ? m[1] : '';
  }
  function parseFeed(xml) {
    xml = String(xml || '');
    var feedTitle = tag(xml.split(/<item\b|<entry\b/i)[0], 'title') || '';
    var blocks = xml.match(/<(item|entry)\b[\s\S]*?<\/\1>/gi) || [];
    var items = blocks.map(function (b) {
      var link = tag(b, 'link') || atomLink(b) || '';
      var date = tag(b, 'pubDate') || tag(b, 'published') || tag(b, 'updated') || tag(b, 'dc:date') || '';
      var summary = stripTags(tag(b, 'description') || tag(b, 'summary') || tag(b, 'content')).slice(0, 280);
      return { title: stripTags(tag(b, 'title')) || '(untitled)', link: link, date: date, summary: summary };
    });
    return { title: stripTags(feedTitle), items: items };
  }
  var ZBFeeds = { parseFeed: parseFeed, stripTags: stripTags, decode: decode };
  // Exposed on whichever global loads this file: the HUD page (window), the headless
  // test (an injected window), and the background worker (self) — the new-tab feeds
  // widget asks the worker for parsed items, and the worker importScripts THIS parser
  // instead of growing a second copy that would drift from the page's.
  if (typeof window !== 'undefined') window.ZBFeeds = ZBFeeds;
  else if (typeof self !== 'undefined') self.ZBFeeds = ZBFeeds;

  if (typeof window === 'undefined' || !window.ZBHUD || typeof chrome === 'undefined' || !chrome.storage) return;   // headless

  // ---- UI -------------------------------------------------------------------
  function el(t, c, x) { var e = document.createElement(t); if (c) e.className = c; if (x != null) e.textContent = x; return e; }
  function host(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return u; } }
  function when(d) { try { var t = new Date(d); return isNaN(t) ? '' : t.toLocaleDateString([], { month: 'short', day: 'numeric' }); } catch (e) { return ''; } }

  var shell = window.ZBHUD.mount({ title: 'FEEDS', current: 'feeds.html', filterPlaceholder: 'filter items…', onFilter: function (q) { query = q || ''; renderItems(); } });
  var body = shell.body;
  var feeds = [], cache = {}, selected = 'all', query = '';
  var listCol, itemCol;

  function save() { try { chrome.storage.local.set({ zb_feeds: feeds }); } catch (e) {} }
  function build() {
    body.innerHTML = '';
    var wrap = el('div', 'zf-wrap');
    listCol = el('div', 'zf-list'); itemCol = el('div', 'zf-items');
    wrap.appendChild(listCol); wrap.appendChild(itemCol);
    body.appendChild(wrap);
    renderList(); renderItems();
  }

  function addFeed() {
    var url = prompt('Feed URL (RSS or Atom):');
    if (!url) return;
    if (!/^https?:/.test(url)) url = 'https://' + url;
    if (feeds.indexOf(url) < 0) { feeds.push(url); save(); fetchFeed(url, function () { renderList(); renderItems(); }); }
    renderList();
  }
  function removeFeed(url) { feeds = feeds.filter(function (f) { return f !== url; }); delete cache[url]; if (selected === url) selected = 'all'; save(); renderList(); renderItems(); }

  function fetchFeed(url, cb) {
    fetch(url).then(function (r) { return r.ok ? r.text() : ''; }).then(function (xml) { cache[url] = parseFeed(xml); if (cb) cb(); })
      .catch(function () { cache[url] = { title: host(url), items: [], error: true }; if (cb) cb(); });
  }
  function refreshAll() { feeds.forEach(function (u) { fetchFeed(u, function () { renderList(); renderItems(); }); }); }

  function renderList() {
    listCol.innerHTML = '';
    var bar = el('div', 'zf-toolbar');
    var add = el('button', 'zf-btn', '＋ Feed'); add.addEventListener('click', addFeed);
    var ref = el('button', 'zf-btn', '↻ Refresh'); ref.addEventListener('click', refreshAll);
    bar.appendChild(add); bar.appendChild(ref); listCol.appendChild(bar);

    var allRow = el('div', 'zf-frow' + (selected === 'all' ? ' zf-sel' : ''));
    allRow.appendChild(el('span', 'zf-fname', 'All feeds'));
    allRow.addEventListener('click', function () { selected = 'all'; renderList(); renderItems(); });
    listCol.appendChild(allRow);

    feeds.forEach(function (u) {
      var f = cache[u] || {};
      var row = el('div', 'zf-frow' + (selected === u ? ' zf-sel' : ''));
      row.appendChild(el('span', 'zf-fname', f.title || host(u)));
      var n = el('span', 'zf-fn', f.error ? '⚠' : String((f.items || []).length)); row.appendChild(n);
      var del = el('button', 'zf-x', '✕'); del.addEventListener('click', function (e) { e.stopPropagation(); removeFeed(u); }); row.appendChild(del);
      row.addEventListener('click', function () { selected = u; renderList(); renderItems(); });
      listCol.appendChild(row);
    });
    if (!feeds.length) listCol.appendChild(el('div', 'zf-empty', 'No feeds — ＋ Feed to add one.'));
  }

  function allItems() {
    var out = [];
    var srcs = selected === 'all' ? feeds : [selected];
    srcs.forEach(function (u) { var f = cache[u]; if (f) (f.items || []).forEach(function (it) { out.push({ it: it, feed: f.title || host(u) }); }); });
    out.sort(function (a, b) { return (new Date(b.it.date) || 0) - (new Date(a.it.date) || 0); });
    return out;
  }
  function renderItems() {
    if (!itemCol) return;
    itemCol.innerHTML = '';
    var rows = allItems();
    if (query.trim()) { var ql = query.toLowerCase(); rows = rows.filter(function (r) { return ((r.it.title || '') + ' ' + (r.it.summary || '')).toLowerCase().indexOf(ql) >= 0; }); }
    if (!rows.length) { itemCol.appendChild(el('div', 'zf-empty', feeds.length ? 'No items.' : 'Add a feed to see items.')); return; }
    rows.forEach(function (r) {
      var card = el('div', 'zf-item');
      var top = el('div', 'zf-itop');
      top.appendChild(el('span', 'zf-ifeed', r.feed));
      if (r.it.date) top.appendChild(el('span', 'zf-idate', when(r.it.date)));
      card.appendChild(top);
      card.appendChild(el('div', 'zf-ititle', r.it.title));
      if (r.it.summary) card.appendChild(el('div', 'zf-isum', r.it.summary));
      if (r.it.link) card.addEventListener('click', function () { chrome.tabs.create({ url: r.it.link }); });
      itemCol.appendChild(card);
    });
  }

  try { chrome.storage.local.get('zb_feeds', function (o) { void chrome.runtime.lastError; feeds = (o && o.zb_feeds) || []; build(); refreshAll(); }); } catch (e) { feeds = []; build(); }
})();
