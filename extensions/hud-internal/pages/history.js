/* zwire HUD History (replaces chrome://history) — a Vivaldi-style calendar +
 * browsing-activity dashboard on chrome.history. A month calendar with per-day
 * activity, a per-day Entries list, and an analytics rail: a Browsing Activity
 * area chart (visits by hour), a Link Transition donut (Typed/Link/Reload/Other),
 * and Top Domains. View toggle: Month / Week / Day / List. All zgui-core widgets
 * (ZGui.chart / ZGui.donut) + the shared HUD shell — themed by the active scheme.
 *
 * The pure aggregation helpers are exposed on window.ZBHistory so they can be
 * unit-tested headless (tests/history.mjs) without chrome/DOM. */
(function () {
  'use strict';

  // ---- pure aggregation over a visit list [{time,url,title,transition}] -----
  function hostOf(url) { try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return url || ''; } }
  function dayKey(d) { return d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate(); }
  function keyOfTs(ts) { return dayKey(new Date(ts)); }
  // chrome.history transition -> Vivaldi's four buckets.
  function transitionBucket(t) {
    if (t === 'typed' || t === 'generated' || t === 'keyword' || t === 'keyword_generated') return 'Typed';
    if (t === 'reload') return 'Reload';
    if (t === 'link' || t === 'form_submit' || t === 'auto_toplevel') return 'Link';
    return 'Other';
  }
  function bucketByDay(visits) {
    var m = {};
    (visits || []).forEach(function (v) { (m[keyOfTs(v.time)] || (m[keyOfTs(v.time)] = [])).push(v); });
    return m;
  }
  function tallyTransitions(visits) {
    var o = { Typed: 0, Link: 0, Reload: 0, Other: 0 };
    (visits || []).forEach(function (v) { o[transitionBucket(v.transition)]++; });
    return o;
  }
  function topDomains(visits, n) {
    var c = {};
    (visits || []).forEach(function (v) { var h = hostOf(v.url); c[h] = (c[h] || 0) + 1; });
    return Object.keys(c).map(function (k) { return { domain: k, count: c[k] }; })
      .sort(function (a, b) { return b.count - a.count || a.domain.localeCompare(b.domain); })
      .slice(0, n || 5);
  }
  function hourly(visits) {
    var h = new Array(24).fill(0);
    (visits || []).forEach(function (v) { h[new Date(v.time).getHours()]++; });
    return h;
  }
  // One row per distinct URL for the range: count = visits in range, keep newest time.
  function dayEntries(visits) {
    var by = {};
    (visits || []).forEach(function (v) {
      var e = by[v.url];
      if (!e) by[v.url] = { url: v.url, title: v.title || v.url, count: 1, lastTime: v.time, transition: v.transition };
      else { e.count++; if (v.time > e.lastTime) { e.lastTime = v.time; e.transition = v.transition; } }
    });
    return Object.keys(by).map(function (k) { return by[k]; })
      .sort(function (a, b) { return b.lastTime - a.lastTime; });
  }

  var ZBHistory = {
    hostOf: hostOf, dayKey: dayKey, keyOfTs: keyOfTs, transitionBucket: transitionBucket,
    bucketByDay: bucketByDay, tallyTransitions: tallyTransitions, topDomains: topDomains,
    hourly: hourly, dayEntries: dayEntries
  };
  if (typeof window !== 'undefined') window.ZBHistory = ZBHistory;

  // Headless (test) load has no HUD shell / chrome.history — stop after exposing helpers.
  if (typeof window === 'undefined' || !window.ZBHUD || typeof chrome === 'undefined' || !chrome.history) return;

  // ---- UI -------------------------------------------------------------------
  var DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var TRANS_ORDER = ['Typed', 'Link', 'Reload', 'Other'];
  function cssVar(n, fb) { try { return getComputedStyle(document.documentElement).getPropertyValue(n).trim() || fb; } catch (e) { return fb; } }
  function transColors() {
    return { Typed: cssVar('--magenta', '#ff2a6d'), Link: cssVar('--cyan', '#05d9e8'), Reload: cssVar('--accent', '#d300c5'), Other: cssVar('--text-muted', '#6b7280') };
  }
  function pad2(n) { return n < 10 ? '0' + n : '' + n; }
  function hhmm(ts) { var d = new Date(ts); return pad2(d.getHours()) + ':' + pad2(d.getMinutes()); }
  function chipColor(host) { var s = 0; for (var i = 0; i < host.length; i++) s = (s * 31 + host.charCodeAt(i)) >>> 0; return 'hsl(' + (s % 360) + ',70%,60%)'; }

  var shell = window.ZBHUD.mount({ title: 'HISTORY', current: 'history.html',
    filterPlaceholder: 'search history…', onFilter: function (q) { filterQ = q || ''; render(); } });
  var body = shell.body;

  var view = new Date(); view.setDate(1); view.setHours(0, 0, 0, 0);   // first of the visible month
  var scope = 'list';   // list (default, all-time flat) | month | week | day
  var selected = new Date(); selected.setHours(0, 0, 0, 0);
  var monthVisits = [], byDay = {}, filterQ = '';
  var allItems = [], listLoaded = false, monthLoaded = false;   // list = cheap all-time; calendar = month getVisits
  var tip = null;

  function monthRange(v) {
    var start = new Date(v.getFullYear(), v.getMonth(), 1).getTime();
    var end = new Date(v.getFullYear(), v.getMonth() + 1, 1).getTime();
    return [start, end];
  }
  // Load every visit (with transition) in the visible month: search scopes the
  // candidate URLs, getVisits gives the per-visit time + transition the calendar
  // + analytics need. Work is bounded to the month's distinct URLs.
  function loadMonth(cb) {
    var r = monthRange(view);
    chrome.history.search({ text: '', startTime: r[0], endTime: r[1], maxResults: 100000 }, function (items) {
      void chrome.runtime.lastError;
      items = items || [];
      var titleByUrl = {}; items.forEach(function (i) { titleByUrl[i.url] = i.title; });
      var visits = [], pending = items.length;
      if (!pending) { cb([]); return; }
      items.forEach(function (i) {
        chrome.history.getVisits({ url: i.url }, function (vs) {
          void chrome.runtime.lastError;
          (vs || []).forEach(function (v) {
            if (v.visitTime >= r[0] && v.visitTime < r[1]) visits.push({ time: v.visitTime, url: i.url, title: titleByUrl[i.url] || i.url, transition: v.transition });
          });
          if (--pending === 0) { visits.sort(function (a, b) { return b.time - a.time; }); cb(visits); }
        });
      });
    });
  }

  // List view loads the WHOLE store cheaply (HistoryItems only, no getVisits) —
  // the same all-time flat view the page had before the calendar was added.
  function loadAllItems(cb) {
    chrome.history.search({ text: '', maxResults: 50000, startTime: 0 }, function (res) {
      void chrome.runtime.lastError;
      cb((res || []).sort(function (a, b) { return (b.lastVisitTime || 0) - (a.lastVisitTime || 0); }));
    });
  }
  function fmtDate(ts) { try { var d = new Date(ts); return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + hhmm(ts); } catch (e) { return ''; } }

  function sameDay(a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
  function weekOf(d) { var s = new Date(d); s.setDate(d.getDate() - d.getDay()); s.setHours(0, 0, 0, 0); var e = new Date(s); e.setDate(s.getDate() + 7); return [s.getTime(), e.getTime()]; }

  // Visits feeding the entries list + analytics rail, scoped to the active view.
  function activeVisits() {
    if (scope === 'day') return (byDay[dayKey(selected)] || []);
    if (scope === 'week') { var w = weekOf(selected); return monthVisits.filter(function (v) { return v.time >= w[0] && v.time < w[1]; }); }
    return monthVisits;   // month + list
  }
  function activeLabel() {
    if (scope === 'day') return selected.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' });
    if (scope === 'week') { var w = weekOf(selected); return new Date(w[0]).toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' – ' + new Date(w[1] - 1).toLocaleDateString([], { month: 'short', day: 'numeric' }); }
    return view.toLocaleDateString([], { month: 'long', year: 'numeric' });
  }

  function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }

  /* ---- deletion (history.deleteUrl / deleteRange / deleteAll) ---------------
   * This page shadows chrome://history, so deletion has to live here — without
   * it the only way to drop a single visit was to clear the whole profile.
   * No local cache surgery: onVisitRemoved (bottom of file) invalidates and
   * re-fetches, so the view always reflects what the store actually holds. */
  function toast(msg) { try { if (window.ZGui && window.ZGui.toast) window.ZGui.toast.show(msg); } catch (e) {} }
  // The time window the active view is showing. null = list view = all time.
  function activeRange() {
    if (scope === 'day') {
      var s = new Date(selected); s.setHours(0, 0, 0, 0);
      var e = new Date(s); e.setDate(s.getDate() + 1);
      return [s.getTime(), e.getTime()];
    }
    if (scope === 'week') return weekOf(selected);
    if (scope === 'month') return monthRange(view);
    return null;
  }
  function delUrl(url) {
    try {
      chrome.history.deleteUrl({ url: url }, function () {
        void chrome.runtime.lastError;
        toast('Removed ' + hostOf(url) + ' from history');
      });
    } catch (e) {}
  }
  function delActiveRange() {
    var r = activeRange();
    try {
      if (!r) { chrome.history.deleteAll(function () { void chrome.runtime.lastError; toast('History cleared'); }); return; }
      chrome.history.deleteRange({ startTime: r[0], endTime: r[1] }, function () {
        void chrome.runtime.lastError;
        toast('Cleared history for ' + activeLabel());
      });
    } catch (e) {}
  }
  // ✕ on a row — deletes every visit to that URL (deleteUrl is URL-scoped, not
  // visit-scoped, which is what the native page does too).
  function delButton(url) {
    var b = el('button', 'zh-del', '✕');
    b.title = 'Delete ' + url + ' from history';
    b.addEventListener('click', function (ev) { ev.stopPropagation(); delUrl(url); });
    return b;
  }
  // Header "Delete" — the whole visible range, behind a popconfirm because
  // there is no undo on the history store.
  function delRangeButton() {
    var label = activeRange() ? 'Delete range' : 'Delete all';
    var b = el('button', 'zh-btn zh-del-range', label);
    var what = activeRange() ? activeLabel() : 'your entire browsing history';
    if (window.ZGui && window.ZGui.popconfirm) {
      window.ZGui.popconfirm(b, { title: 'Delete ' + what + '?', description: 'This cannot be undone.',
        okText: 'Delete', danger: true, onConfirm: delActiveRange });
    } else {
      b.addEventListener('click', delActiveRange);
    }
    return b;
  }

  function ensureTip() { if (!tip) { tip = el('div', 'zh-tip'); document.body.appendChild(tip); } return tip; }
  function showTip(ev, dateObj, vs) {
    var t = ensureTip();
    var pages = new Set(vs.map(function (v) { return v.url; })).size;
    var doms = topDomains(vs, 6);
    t.innerHTML = '';
    t.appendChild(el('div', null, dateObj.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })));
    var line = el('div'); line.innerHTML = '<b>' + vs.length + '</b> views · <b>' + pages + '</b> pages'; t.appendChild(line);
    doms.forEach(function (d) { t.appendChild(el('div', 'zh-tip-dom', d.domain + ' (' + d.count + ')')); });
    t.style.display = 'block';
    var x = Math.min(ev.clientX + 14, window.innerWidth - 240), y = Math.min(ev.clientY + 14, window.innerHeight - 160);
    t.style.left = x + 'px'; t.style.top = y + 'px';
  }
  function hideTip() { if (tip) tip.style.display = 'none'; }

  function buildBar() {
    var bar = el('div', 'zh-bar');
    // Month nav is calendar-only; the list view is all-time so it just shows a label.
    bar.appendChild(el('div', 'zh-month', scope === 'list' ? 'All History' : activeLabel()));
    if (scope !== 'list') {
      var prev = el('button', 'zh-btn zh-nav', '‹'); prev.title = 'Previous month';
      prev.addEventListener('click', function () { view.setMonth(view.getMonth() - 1); reloadMonth(); });
      var next = el('button', 'zh-btn zh-nav', '›'); next.title = 'Next month';
      next.addEventListener('click', function () { view.setMonth(view.getMonth() + 1); reloadMonth(); });
      var today = el('button', 'zh-btn', 'This Month');
      today.addEventListener('click', function () { view = new Date(); view.setDate(1); view.setHours(0, 0, 0, 0); selected = new Date(); selected.setHours(0, 0, 0, 0); reloadMonth(); });
      bar.appendChild(prev); bar.appendChild(next); bar.appendChild(today);
    }
    bar.appendChild(el('div', 'zh-spacer'));
    ['List', 'Day', 'Week', 'Month'].forEach(function (v) {
      var b = el('button', 'zh-btn' + (scope === v.toLowerCase() ? ' on' : ''), v);
      b.addEventListener('click', function () { scope = v.toLowerCase(); refresh(); });
      bar.appendChild(b);
    });
    return bar;
  }

  // Full-height, all-time flat list — the default (Cmd+Y) view.
  function buildListView() {
    var items = allItems;
    if (filterQ.trim()) { var ql = filterQ.toLowerCase(); items = items.filter(function (r) { return ((r.title || '') + ' ' + r.url).toLowerCase().indexOf(ql) >= 0; }); }
    var box = el('div', 'zh-entries zh-listfull');
    var hd = el('div', 'zh-entries-hd'); hd.appendChild(el('span', null, 'History')); hd.appendChild(el('b', null, String(items.length)));
    hd.appendChild(delRangeButton()); box.appendChild(hd);
    var list = el('div', 'zh-list');
    if (!items.length) list.appendChild(el('div', 'zh-empty', 'No history.'));
    items.forEach(function (r) {
      var row = el('div', 'zh-row');
      row.appendChild(el('span', 'zh-time', fmtDate(r.lastVisitTime)));
      var host = hostOf(r.url);
      var chip = el('span', 'zh-chip', (host[0] || '?').toUpperCase()); chip.style.background = chipColor(host); row.appendChild(chip);
      row.appendChild(el('span', 'zh-title', r.title || r.url));
      if ((r.visitCount || 1) > 1) row.appendChild(el('span', 'zh-count', String(r.visitCount)));
      row.appendChild(delButton(r.url));
      row.title = r.url;
      row.addEventListener('click', function () { chrome.tabs.create({ url: r.url }); });
      list.appendChild(row);
    });
    box.appendChild(list);
    return box;
  }

  function buildCalendar() {
    var cal = el('div', 'zh-cal');
    var dow = el('div', 'zh-dow'); DOW.forEach(function (d) { dow.appendChild(el('span', null, d)); }); cal.appendChild(dow);
    var grid = el('div', 'zh-grid');
    var first = new Date(view.getFullYear(), view.getMonth(), 1);
    var startOffset = first.getDay();
    var gridStart = new Date(first); gridStart.setDate(1 - startOffset);
    var today = new Date(); today.setHours(0, 0, 0, 0);
    var maxDay = 0; Object.keys(byDay).forEach(function (k) { maxDay = Math.max(maxDay, byDay[k].length); });
    var wk = scope === 'week' ? weekOf(selected) : null;
    for (var i = 0; i < 42; i++) {
      var d = new Date(gridStart); d.setDate(gridStart.getDate() + i);
      var out = d.getMonth() !== view.getMonth();
      var vs = byDay[dayKey(d)] || [];
      var cell = el('div', 'zh-cell' + (out ? ' zh-out' : ''));
      if (sameDay(d, today)) cell.className += ' zh-today';
      if (scope !== 'list' && sameDay(d, selected)) cell.className += ' zh-sel';
      if (scope === 'week' && d.getTime() >= wk[0] && d.getTime() < wk[1]) cell.className += ' zh-in-range';
      cell.appendChild(el('span', 'zh-num', String(d.getDate())));
      if (vs.length) {
        cell.appendChild(el('span', 'zh-daycount', vs.length + ' views'));
        var bars = el('div', 'zh-bars');
        var h = hourly(vs); var step = 4;   // 6 bars, 4-hour buckets
        for (var b = 0; b < 24; b += step) {
          var sum = 0; for (var k = b; k < b + step; k++) sum += h[k];
          var bi = el('i'); bi.style.height = Math.round(2 + (sum / (maxDay || 1)) * 24) + 'px'; bars.appendChild(bi);
        }
        cell.appendChild(bars);
      }
      (function (dd, vv) {
        cell.addEventListener('click', function () { selected = new Date(dd); selected.setHours(0, 0, 0, 0); if (scope === 'month' || scope === 'list') scope = 'day'; render(); });
        if (vv.length) { cell.addEventListener('mousemove', function (ev) { showTip(ev, dd, vv); }); cell.addEventListener('mouseleave', hideTip); }
      })(new Date(d), vs);
      grid.appendChild(cell);
    }
    cal.appendChild(grid);
    return cal;
  }

  function buildEntries() {
    var vs = activeVisits();
    if (filterQ.trim()) { var ql = filterQ.toLowerCase(); vs = vs.filter(function (v) { return ((v.title || '') + ' ' + v.url).toLowerCase().indexOf(ql) >= 0; }); }
    var rows = dayEntries(vs);
    var box = el('div', 'zh-entries');
    var hd = el('div', 'zh-entries-hd');
    hd.appendChild(el('span', null, 'Entries'));
    hd.appendChild(el('b', null, String(rows.length)));
    hd.appendChild(delRangeButton());
    box.appendChild(hd);
    var list = el('div', 'zh-list');
    if (!rows.length) { list.appendChild(el('div', 'zh-empty', 'No history for this range.')); }
    rows.forEach(function (r) {
      var row = el('div', 'zh-row');
      row.appendChild(el('span', 'zh-time', hhmm(r.lastTime)));
      var host = hostOf(r.url);
      var chip = el('span', 'zh-chip', (host[0] || '?').toUpperCase()); chip.style.background = chipColor(host); row.appendChild(chip);
      row.appendChild(el('span', 'zh-title', r.title || r.url));
      if (r.count > 1) row.appendChild(el('span', 'zh-count', String(r.count)));
      row.appendChild(delButton(r.url));
      row.title = r.url;
      row.addEventListener('click', function () { chrome.tabs.create({ url: r.url }); });
      list.appendChild(row);
    });
    box.appendChild(list);
    return box;
  }

  function buildRail() {
    var vs = activeVisits();
    var rail = el('div', 'zh-rail');

    var head = el('div', 'zh-card');
    head.appendChild(el('div', 'zh-date', activeLabel()));
    var pages = new Set(vs.map(function (v) { return v.url; })).size;
    var sub = el('div'); sub.style.cssText = 'font-size:11px;color:var(--text-muted);margin-top:2px;'; sub.textContent = vs.length + ' page views · ' + pages + ' pages'; head.appendChild(sub);
    rail.appendChild(head);

    // Browsing Activity — visits by hour of the active range's representative day.
    var actCard = el('div', 'zh-card'); actCard.appendChild(el('h4', null, 'Browsing Activity'));
    var chartHost = el('div'); chartHost.style.cssText = 'height:120px;'; actCard.appendChild(chartHost);
    rail.appendChild(actCard);

    // Link Transition Type donut.
    var trCard = el('div', 'zh-card'); trCard.appendChild(el('h4', null, 'Link Transition Type'));
    var tr = tallyTransitions(vs), cols = transColors();
    var segs = TRANS_ORDER.filter(function (k) { return tr[k] > 0; }).map(function (k) { return { value: tr[k], color: cols[k], label: k }; });
    if (window.ZGui && window.ZGui.donut && segs.length) {
      var dw = el('div', 'zh-donut-wrap');
      var donut = window.ZGui.donut({ segments: segs, size: 120, thickness: 16, centerLabel: String(vs.length), centerSub: 'visits' });
      dw.appendChild(donut.el); trCard.appendChild(dw);
      var legend = el('div', 'zh-legend');
      TRANS_ORDER.forEach(function (k) { if (!tr[k]) return; var s = el('span'); var i = el('i'); i.style.background = cols[k]; s.appendChild(i); s.appendChild(document.createTextNode(k + ' ' + tr[k])); legend.appendChild(s); });
      trCard.appendChild(legend);
    } else { trCard.appendChild(el('div', 'zh-empty', 'No transition data.')); }
    rail.appendChild(trCard);

    // Top Domains.
    var domCard = el('div', 'zh-card');
    var doms = topDomains(vs, 8);
    domCard.appendChild(el('h4', null, 'Top Domains of ' + new Set(vs.map(function (v) { return hostOf(v.url); })).size + ' Total'));
    var ul = el('ul', 'zh-doms');
    doms.forEach(function (d) {
      var li = el('li');
      var chip = el('span', 'zh-chip', (d.domain[0] || '?').toUpperCase()); chip.style.background = chipColor(d.domain); li.appendChild(chip);
      li.appendChild(el('span', 'zh-dom-name', d.domain));
      li.appendChild(el('span', 'zh-dom-n', String(d.count)));
      ul.appendChild(li);
    });
    if (!doms.length) ul.appendChild(el('div', 'zh-empty', 'No domains.'));
    domCard.appendChild(ul);
    rail.appendChild(domCard);

    // Draw the area chart after the host is in the DOM (needs clientWidth).
    setTimeout(function () {
      try {
        if (window.ZGui && window.ZGui.chart) {
          window.ZGui.chart(chartHost, { series: [{ data: hourly(vs), color: cssVar('--magenta', '#ff2a6d'), type: 'area', width: 2 }], height: 120, yMin: 0 });
        }
      } catch (e) {}
    }, 0);
    return rail;
  }

  function render() {
    hideTip();
    navIndex = -1;
    body.innerHTML = '';
    body.appendChild(buildBar());
    if (scope === 'list') { body.appendChild(buildListView()); return; }   // full-height flat list
    var wrap = el('div', 'zh-wrap');
    wrap.appendChild(buildCalendar());
    wrap.appendChild(buildEntries());
    wrap.appendChild(buildRail());
    body.appendChild(wrap);
  }

  // Arrow-key navigation over the visible rows (List view + calendar Entries).
  // ↑/↓ move the highlight, ⏎ opens it — works even while the filter box has
  // focus (arrows there are otherwise inert), like a native history page.
  var navIndex = -1;
  function navRows() { return Array.prototype.slice.call(body.querySelectorAll('.zh-row')); }
  function setNav(i) {
    var rows = navRows(); if (!rows.length) { navIndex = -1; return; }
    navIndex = Math.max(0, Math.min(rows.length - 1, i));
    rows.forEach(function (r, k) { r.classList.toggle('zh-navsel', k === navIndex); });
    var cur = rows[navIndex]; if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: 'nearest' });
  }
  document.addEventListener('keydown', function (e) {
    if (e.altKey || e.metaKey || e.ctrlKey) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setNav(navIndex + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setNav(navIndex - 1); }
    else if (e.key === 'Enter') { var rows = navRows(); if (navIndex >= 0 && rows[navIndex]) { e.preventDefault(); rows[navIndex].click(); } }
  }, true);

  // Load the data the active scope needs (list = cheap all-time; calendar =
  // month getVisits), cached so toggling views doesn't re-fetch. Then render.
  function ensureData(cb) {
    if (scope === 'list') {
      if (listLoaded) { cb(); return; }
      loadAllItems(function (items) { allItems = items; listLoaded = true; cb(); });
    } else {
      if (monthLoaded) { cb(); return; }
      loadMonth(function (visits) {
        monthVisits = visits; byDay = bucketByDay(visits); monthLoaded = true;
        // Default the selection to the newest day in the month that has activity.
        if (!byDay[dayKey(selected)]) {
          var newest = visits[0]; if (newest && selected.getMonth() !== view.getMonth()) { selected = new Date(newest.time); selected.setHours(0, 0, 0, 0); }
        }
        cb();
      });
    }
  }
  function refresh() {
    hideTip();
    body.innerHTML = ''; body.appendChild(buildBar());
    body.appendChild(el('div', 'zh-empty', 'Loading history…'));
    ensureData(render);
  }
  function reloadMonth() { monthLoaded = false; refresh(); }

  refresh();
  if (chrome.history.onVisitRemoved) chrome.history.onVisitRemoved.addListener(function () { listLoaded = false; monthLoaded = false; refresh(); });
})();
