// The browsing-history domain that zwire contributes to the shared
// zpwr-clip-engine grid (pages/history-domain.js).
//
// Two things are worth pinning and both are pure, so they run with no DOM and no
// canvas: `bucketVisits` (raw chrome.history visit stamps → the per-origin,
// per-hour rows the grid reads) and the domain object's own contract — lane
// ordering, the 0..1 normalisation the renderer draws as band height, the axis
// shape, and the read-only capability set. The renderer itself belongs to the
// engine and is not re-tested here.
import assert from 'node:assert/strict';
import { createHistoryDomain, bucketVisits } from '../pages/history-domain.js';

const HOUR = 3600000;
// Midnight UTC so the `beat` (day-boundary) assertions are not machine-local.
const START = Date.UTC(2026, 0, 2, 0, 0, 0);
const at = (h, m = 0) => START + h * HOUR + m * 60000;

/* ── bucketVisits ────────────────────────────────────────────────────────── */

// Two visits to the same host in the same hour collapse into one row of 2, while
// a different hour and a different host each get their own row. Collapsing is the
// whole point: one row per (origin, hour) is what the grid's cell map expects.
{
  const rows = bucketVisits([
    { url: 'https://example.com/a', time: at(3, 5) },
    { url: 'https://example.com/b', time: at(3, 50) },
    { url: 'https://example.com/c', time: at(4, 1) },
    { url: 'https://other.test/x', time: at(3, 10) },
  ], START, 24);
  const key = (o, h) => rows.find((r) => r.origin === o && r.hour === h);
  assert.equal(rows.length, 3, 'one row per (origin, hour)');
  assert.equal(key('example.com', 3).visits, 2, 'same host + same hour accumulate');
  assert.equal(key('example.com', 4).visits, 1, 'a later hour is its own column');
  assert.equal(key('other.test', 3).visits, 1, 'a different host is its own lane');
}

// Anything outside the window is dropped rather than clamped into column 0 or the
// last column, which would invent traffic in an hour that had none.
{
  const rows = bucketVisits([
    { url: 'https://in.test/', time: at(0) },
    { url: 'https://early.test/', time: START - 1 },
    { url: 'https://late.test/', time: at(24) },
  ], START, 24);
  assert.deepEqual(rows.map((r) => r.origin), ['in.test'], 'out-of-window visits are dropped');
}

// Entries the URL parser rejects are skipped, not turned into a lane named after
// the raw string — chrome.history really does return non-navigable entries.
{
  const rows = bucketVisits([
    { url: 'not a url', time: at(1) },
    { url: 'https://ok.test/', time: at(1) },
    { url: 'https://nostamp.test/', time: null },
    null,
  ], START, 24);
  assert.deepEqual(rows.map((r) => r.origin), ['ok.test'], 'unparseable and stamp-less entries are skipped');
}

/* ── the domain contract ─────────────────────────────────────────────────── */

// The busiest origin is deliberately the one that sorts LAST alphabetically, so
// the lane-order assertion below can only pass if lanes() really ranks by traffic.
// With names whose alphabetical order matches their traffic order, that assertion
// holds for a plain name sort too and proves nothing.
const buckets = [
  { origin: 'zebra.test', hour: 2, visits: 8 },
  { origin: 'zebra.test', hour: 5, visits: 4 },
  { origin: 'alpha.test', hour: 2, visits: 1 },
];
const domain = createHistoryDomain({
  getBuckets: () => buckets,
  getHours: () => 24,
  getStart: () => START,
});

// Lanes are ordered by total visits, so the rows that carried the day sit at the
// top of the arrangement instead of in hash order.
{
  const lanes = domain.lanes();
  assert.deepEqual(lanes.map((l) => l.id), ['zebra.test', 'alpha.test'], 'busiest origin leads');
  assert.equal(lanes[0].total, 12, 'lane total sums every hour of that origin');
  assert.notEqual(lanes[0].color.stroke, lanes[1].color.stroke, 'adjacent lanes are visually distinct');
}

// The time axis is one cell per hour, labelled with that hour, and flags midnight
// as a `beat` so a day boundary is drawn heavier than an ordinary hour line.
//
// Hours are LOCAL, not UTC — a browsing timeline has to read on the user's own
// clock — so the expected midnight column is derived from this machine's offset
// rather than assumed to be column 0. Asserting `key === '0'` would pass only in
// UTC and fail everywhere else, which is a broken test, not a broken domain.
{
  const axis = domain.timeAxis();
  assert.equal(axis.totalUnits, 24, 'one unit per hour');
  assert.equal(axis.cells.length, 24, 'one cell per unit');
  assert.equal(axis.cells[0].lo, 0, 'the first cell starts at unit 0');
  assert.equal(axis.cells[23].hi, 24, 'the last cell ends at the window edge');
  assert.equal(axis.cells[0].label, String(new Date(START).getHours()).padStart(2, '0'),
    'column 0 is labelled with the local hour of the window start');

  const beats = axis.cells.filter((c) => c.beat);
  assert.equal(beats.length, 1, 'exactly one day boundary in a 24-hour window');
  const midnight = axis.cells.findIndex((c) => new Date(START + Number(c.key) * HOUR).getHours() === 0);
  assert.equal(beats[0].key, String(midnight), 'the flagged boundary is the local midnight column');
  assert.equal(beats[0].label, '00', 'and it is labelled hour 00');
}

// History is a record of what happened, so the surface must not be paintable —
// a painted cell would be a visit that never occurred, and `serialize` would then
// report it back as real data.
{
  const c = domain.capabilities;
  assert.equal(c.paint, false, 'history cannot be painted');
  assert.equal(c.erase, false, 'history cannot be erased');
  assert.equal(c.valueDrag, false, 'a visit count cannot be dragged to a new value');
  assert.equal(c.scroll, true, 'panning the view is still allowed');
}

// deserialize normalises against the BUSIEST cell, and serialize inverts it. The
// renderer draws `value.type: 'unit'` as a 0..1 band height, so getting this wrong
// would silently flatten or clip the whole chart.
{
  const cells = new Map();
  const model = {
    set: (lane, key, v) => cells.set(lane + ' ' + key, v),
    laneCells: (lane) => {
      const out = new Map();
      for (const [k, v] of cells) {
        const sp = k.lastIndexOf(' ');
        if (k.slice(0, sp) === lane) out.set(k.slice(sp + 1), v);
      }
      return out;
    },
  };
  domain.deserialize(buckets, model);

  assert.equal(cells.get('zebra.test 2'), 1, 'the busiest cell normalises to the full band');
  assert.equal(cells.get('zebra.test 5'), 0.5, '4 of a peak 8 is half a band');
  assert.equal(cells.get('alpha.test 2'), 0.125, 'a quiet cell keeps its true proportion');
  assert.ok([...cells.values()].every((v) => v >= 0 && v <= 1), 'every value is inside the unit band');

  const round = domain.serialize(model);
  assert.deepEqual(
    round.slice().sort((a, b) => (a.hour - b.hour) || a.origin.localeCompare(b.origin)),
    buckets.slice().sort((a, b) => (a.hour - b.hour) || a.origin.localeCompare(b.origin)),
    'serialize inverts deserialize back to the original visit counts');
  assert.deepEqual(round, round.slice().sort((a, b) => (a.hour - b.hour) || a.origin.localeCompare(b.origin)),
    'serialize output is ordered by hour then origin');
}

console.log(`history timeline domain: ${domain.lanes().length} lanes, ${domain.timeAxis().totalUnits} hourly units, ` +
  `${buckets.length} buckets round-tripped — all assertions passed`);
