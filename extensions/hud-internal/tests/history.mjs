// History dashboard aggregation test (pages/history.js). The page is an IIFE
// that exposes its pure helpers on `window.ZBHistory` and bails before any
// chrome/DOM use when the HUD shell is absent, so it loads headless here. These
// cover the calendar/analytics math that the Vivaldi-style view is built on.
import fs from 'node:fs';
import assert from 'node:assert/strict';

const src = fs.readFileSync(new URL('../pages/history.js', import.meta.url), 'utf8');
const win = {};
new Function('window', src)(win);        // guard returns before touching chrome/document
const H = win.ZBHistory;
assert.ok(H && H.bucketByDay, 'window.ZBHistory not exposed');

// A fixed clock so day/hour bucketing is deterministic regardless of the test host TZ.
const at = (y, mo, d, h) => new Date(y, mo, d, h, 0, 0, 0).getTime();
const visits = [
  { time: at(2026, 6, 11, 9), url: 'https://github.com/a', title: 'A', transition: 'typed' },
  { time: at(2026, 6, 11, 9), url: 'https://github.com/a', title: 'A', transition: 'reload' },
  { time: at(2026, 6, 11, 22), url: 'https://github.com/b', title: 'B', transition: 'link' },
  { time: at(2026, 6, 11, 22), url: 'https://www.wikipedia.org/x', title: 'X', transition: 'link' },
  { time: at(2026, 6, 12, 8), url: 'https://github.com/a', title: 'A', transition: 'auto_bookmark' },
];

// hostOf strips www.
assert.equal(H.hostOf('https://www.wikipedia.org/x'), 'wikipedia.org');
assert.equal(H.hostOf('https://github.com/a'), 'github.com');

// transitionBucket -> Vivaldi's four buckets.
assert.equal(H.transitionBucket('typed'), 'Typed');
assert.equal(H.transitionBucket('reload'), 'Reload');
assert.equal(H.transitionBucket('link'), 'Link');
assert.equal(H.transitionBucket('auto_bookmark'), 'Other');

// bucketByDay groups by local calendar day.
const by = H.bucketByDay(visits);
assert.equal(Object.keys(by).length, 2, 'two distinct days');
const d11 = by[H.keyOfTs(at(2026, 6, 11, 0))];
assert.equal(d11.length, 4, 'four visits on the 11th');

// tallyTransitions on the 11th: 1 typed, 1 reload, 2 link.
const tr = H.tallyTransitions(d11);
assert.deepEqual(tr, { Typed: 1, Link: 2, Reload: 1, Other: 0 });

// topDomains groups by host: github.com = /a + /a + /b = 3, then wikipedia.org = 1.
const doms = H.topDomains(d11, 5);
assert.equal(doms[0].domain, 'github.com');
assert.equal(doms[0].count, 3);
assert.equal(doms[1].domain, 'wikipedia.org');

// hourly: two visits at 09:00, two at 22:00 on the 11th.
const hrs = H.hourly(d11);
assert.equal(hrs.length, 24);
assert.equal(hrs[9], 2);
assert.equal(hrs[22], 2);
assert.equal(hrs.reduce((a, b) => a + b, 0), 4);

// dayEntries: one row per distinct URL, count = visits, newest time kept, desc order.
const entries = H.dayEntries(d11);
assert.equal(entries.length, 3, 'three distinct URLs on the 11th');
const ghA = entries.find((e) => e.url === 'https://github.com/a');
assert.equal(ghA.count, 2, 'github.com/a visited twice');
assert.ok(entries[0].lastTime >= entries[1].lastTime, 'entries sorted newest first');

console.log('history aggregation: all assertions passed');
