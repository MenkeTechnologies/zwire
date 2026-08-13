/* zwire HUD — TIMELINE page: browsing history on the shared arrangement grid.
 *
 * The grid is zpwr-clip-engine (lib/clip-engine), imported and used as-is. zwire
 * supplies exactly two things: the domain in history-domain.js, and the data
 * collection below. No part of the renderer, model or interaction layer is
 * copied into this repo.
 *
 * Data: chrome.history.search gives matching pages but only their LAST visit, so
 * a per-hour picture built from it would collapse every page to one column.
 * chrome.history.getVisits returns the full visit list for one URL, which is what
 * an hourly timeline actually needs — so the pages are fetched first, then their
 * visits, capped at URL_CAP so a large profile can't fan out unboundedly.
 */
import { createGrid } from '../lib/clip-engine/webui/grid/index.js';
import { createHistoryDomain, bucketVisits } from './history-domain.js';

const HOURS = 24;                 // one day of columns
const URL_CAP = 400;              // pages to pull visit lists for
const WINDOW_MS = HOURS * 3600000;

var buckets = [], start = Date.now() - WINDOW_MS;

var shell = window.ZBHUD.mount({
  title: 'TIMELINE', current: 'timeline.html', filterPlaceholder: 'filter sites…',
  onFilter: function (v) { filter = (v || '').trim().toLowerCase(); if (grid) grid.render(); }
});
var filter = '';

var wrap = document.createElement('div');
wrap.className = 'zt-wrap';
var canvas = document.createElement('canvas');
canvas.id = 'zt-grid';
canvas.className = 'zt-grid';
var status = document.createElement('div');
status.className = 'zt-status';
status.textContent = 'reading history…';
wrap.appendChild(status);
wrap.appendChild(canvas);
shell.body.appendChild(wrap);

var style = document.createElement('style');
style.textContent = [
  '.zt-wrap{display:block;}',
  '.zt-status{color:var(--text-muted,#5a6b82);font-size:12px;margin:0 0 8px;font-family:"Share Tech Mono",monospace;}',
  '.zt-grid{display:block;width:100%;height:70vh;border:1px solid var(--border,#1a2233);border-radius:4px;background:var(--bg-primary,#05060a);}',
].join('');
document.head.appendChild(style);

/* The domain reads through these, so a filter change re-lanes without a rebuild. */
var domain = createHistoryDomain({
  getBuckets: function () {
    return filter ? buckets.filter(function (b) { return b.origin.toLowerCase().indexOf(filter) >= 0; }) : buckets;
  },
  getHours: function () { return HOURS; },
  getStart: function () { return start; },
});

var grid = null;

/** Every visit timestamp in the window, for up to URL_CAP pages. */
function collectVisits() {
  return new Promise(function (resolve) {
    chrome.history.search({ text: '', startTime: start, maxResults: URL_CAP }, function (items) {
      void chrome.runtime.lastError;
      var pages = items || [];
      if (!pages.length) { resolve([]); return; }
      var out = [], left = pages.length;
      pages.forEach(function (page) {
        chrome.history.getVisits({ url: page.url }, function (visits) {
          void chrome.runtime.lastError;
          (visits || []).forEach(function (v) {
            if (v.visitTime >= start) out.push({ url: page.url, time: v.visitTime });
          });
          if (--left === 0) resolve(out);
        });
      });
    });
  });
}

collectVisits().then(function (visits) {
  buckets = bucketVisits(visits, start, HOURS);
  if (!buckets.length) {
    status.textContent = 'no browsing history in the last ' + HOURS + ' hours';
    return;
  }
  var sites = new Set(buckets.map(function (b) { return b.origin; }));
  status.textContent = visits.length + ' visits · ' + sites.size + ' sites · last ' + HOURS + ' hours';
  grid = createGrid({ canvas: canvas, domain: domain });
  // Seed the surface from the collected data through the domain's own
  // deserialize, so the page never reaches into the model directly.
  grid.load(buckets);
}).catch(function (e) {
  status.textContent = 'history unavailable: ' + (e && e.message ? e.message : e);
});
