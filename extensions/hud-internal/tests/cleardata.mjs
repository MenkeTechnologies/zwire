// Clear-browsing-data wizard model (pages/cleardata.js). The page module exposes
// its pure helpers on `window.ZBClear` and only touches chrome/DOM inside mount(),
// so it loads headless here.
//
// These assert the two things a wrong answer silently destroys data over: the
// RemovalOptions/DataTypeSet pair handed to chrome.browsingData, and the filter
// rules the API enforces (kIncompatibleFilterError / kNonFilterableError in
// chrome/browser/extensions/api/browsing_data/browsing_data_api.cc).
import fs from 'node:fs';
import assert from 'node:assert/strict';

const src = fs.readFileSync(new URL('../pages/cleardata.js', import.meta.url), 'utf8');
const win = {};
new Function('window', src)(win);
const C = win.ZBClear;
assert.ok(C && C.buildRemoval, 'window.ZBClear not exposed');

const NOW = Date.UTC(2026, 6, 25, 12, 0, 0);
const HOUR = 3600e3, DAY = 24 * HOUR;

// --- time range -> RemovalOptions.since -------------------------------------
assert.equal(C.sinceFor('hour', NOW), NOW - HOUR);
assert.equal(C.sinceFor('day', NOW), NOW - DAY);
assert.equal(C.sinceFor('week', NOW), NOW - 7 * DAY);
assert.equal(C.sinceFor('month', NOW), NOW - 28 * DAY);
// "All time" must be 0, not `now` — the API reads 0 as "everything".
assert.equal(C.sinceFor('all', NOW), 0);
// An unknown range must not silently become "now" (which would delete nothing).
assert.equal(C.sinceFor('nope', NOW), 0);

// --- data types offered ------------------------------------------------------
// Types that map to removal mask 0 in this Chromium must never be offered: the
// call would report success and delete nothing.
const offered = C.TYPES.map((t) => t.id);
for (const dead of ['passwords', 'pluginData', 'appcache', 'serverBoundCertificates', 'webSQL']) {
  assert.ok(!offered.includes(dead), `${dead} is a no-op in this Chromium and must not be offered`);
  assert.ok(C.IGNORED_TYPES.includes(dead), `${dead} missing from IGNORED_TYPES`);
}
// Every offered type is one MaskForKey() recognizes.
const LIVE = ['cache', 'cacheStorage', 'cookies', 'downloads', 'fileSystems', 'formData',
  'history', 'indexedDB', 'localStorage', 'serviceWorkers'];
assert.deepEqual(offered.slice().sort(), LIVE.slice().sort());
// Only site data + cache accept an origin filter (kFilterableDataTypes).
const filterable = C.TYPES.filter((t) => t.filterable).map((t) => t.id).sort();
assert.deepEqual(filterable, ['cache', 'cacheStorage', 'cookies', 'fileSystems', 'indexedDB', 'localStorage', 'serviceWorkers']);

// --- buildRemoval ------------------------------------------------------------
const sel = { history: true, cache: true };
const basic = C.buildRemoval(sel, 'day', {}, NOW);
assert.deepEqual(basic.errors, []);
assert.deepEqual(basic.dataToRemove, { history: true, cache: true });
assert.equal(basic.options.since, NOW - DAY);
// Unselected types are absent, not `false` — a false value is legal but noisy.
assert.ok(!('cookies' in basic.dataToRemove));
// Default origin scope: unprotected web only, never hosted-app or extension data.
assert.deepEqual(basic.options.originTypes, { unprotectedWeb: true, protectedWeb: false, extension: false });
assert.ok(!('origins' in basic.options) && !('excludeOrigins' in basic.options));

const scoped = C.buildRemoval({ cookies: true }, 'all', { origins: ['https://a.test'] }, NOW);
assert.deepEqual(scoped.errors, []);
assert.deepEqual(scoped.options.origins, ['https://a.test']);
assert.equal(scoped.options.since, 0);

const excluded = C.buildRemoval({ cache: true }, 'hour', { excludeOrigins: ['https://keep.test'] }, NOW);
assert.deepEqual(excluded.errors, []);
assert.deepEqual(excluded.options.excludeOrigins, ['https://keep.test']);

// Nothing selected is an error, not an empty deletion.
assert.equal(C.buildRemoval({}, 'hour', {}, NOW).errors.length, 1);

// origins + excludeOrigins together => kIncompatibleFilterError.
const both = C.buildRemoval({ cookies: true }, 'hour', { origins: ['https://a.test'], excludeOrigins: ['https://b.test'] }, NOW);
assert.ok(both.errors.some((m) => /either an origin list or an exclude list/i.test(m)));

// A filter with a non-filterable type => kNonFilterableError. History is the
// case a user hits first (Chrome's own UI can't do it either).
const bad = C.buildRemoval({ history: true, cookies: true }, 'hour', { origins: ['https://a.test'] }, NOW);
assert.ok(bad.errors.some((m) => /origin filtering does not apply/i.test(m)), 'expected non-filterable error');
assert.ok(/browsing history/i.test(bad.errors.find((m) => /origin filtering/i.test(m))));
// The same selection without a filter is fine.
assert.deepEqual(C.buildRemoval({ history: true, cookies: true }, 'hour', {}, NOW).errors, []);

// Opting into hosted-app / extension data has to be explicit and must survive.
const wide = C.buildRemoval({ cookies: true }, 'all', { protectedWeb: true, extension: true }, NOW);
assert.deepEqual(wide.options.originTypes, { unprotectedWeb: true, protectedWeb: true, extension: true });

// --- origins parsing ---------------------------------------------------------
assert.deepEqual(C.parseOrigins('https://a.test, https://b.test\nhttps://c.test'),
  ['https://a.test', 'https://b.test', 'https://c.test']);
assert.deepEqual(C.parseOrigins('   '), []);
assert.deepEqual(C.parseOrigins(null), []);

// --- summary text ------------------------------------------------------------
assert.equal(C.summarize({}, 'hour'), 'Nothing selected');
assert.equal(C.summarize({ cache: true }, 'week'), 'Cached images and files — last 7 days');

// --- run(): one remove() per type, and a refusal doesn't sink the batch -------
const calls = [];
global.chrome = {
  runtime: { lastError: null },
  browsingData: {
    remove(options, types, cb) {
      calls.push({ options, types });
      const id = Object.keys(types)[0];
      global.chrome.runtime.lastError = id === 'history' ? { message: 'Deleting history is not allowed.' } : null;
      cb();
      global.chrome.runtime.lastError = null;
    }
  }
};
const built = C.buildRemoval({ history: true, cache: true }, 'day', {}, NOW);
let results = null;
C.run(built, (r) => { results = r; });
assert.equal(calls.length, 2, 'one remove() call per selected type');
assert.deepEqual(calls.map((c) => Object.keys(c.types)[0]), ['history', 'cache']);
assert.deepEqual(results.map((r) => [r.id, r.ok]), [['history', false], ['cache', true]]);
assert.match(results[0].error, /not allowed/);

console.log('cleardata: ok');
