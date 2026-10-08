// Tab-flow decision core (ztabflow-core.js) — the pure half of browser.snoozeTab /
// wakeSnoozed / archiveIdle / restoreArchived / recentTab / audioFocus.
//
// Each of these verbs closes, reopens, switches or mutes tabs on the user's behalf, so a
// wrong answer here is a lost tab, a tab that wakes twice, a dropped call, or a mute the
// user cannot get rid of. The worker (background.js) only applies what these functions
// return, so pinning them pins the behaviour.
//
// The core reuses the hibernate core's live-capture check, so both load into one root in
// the same order background.js importScripts them.
import fs from 'node:fs';
import assert from 'node:assert/strict';

const root = {};
for (const f of ['../zhibernate-core.js', '../ztabflow-core.js']) {
  new Function('self', fs.readFileSync(new URL(f, import.meta.url), 'utf8'))(root);
}
const T = root.ZWIRE_TABFLOW;
assert.ok(T, 'ZWIRE_TABFLOW missing');

const MIN = 60000, HOUR = 60 * MIN, DAY = 24 * HOUR;
const NOW = Date.UTC(2026, 9, 7, 15, 30);

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; return; }
  fail++;
  console.error(`  ✗ ${name}${detail ? ' — ' + detail : ''}`);
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---- durations: what a script or palette row can say ----
{
  const cases = [
    ['90m', 90 * MIN], ['2h', 2 * HOUR], ['1h30m', 90 * MIN], ['1.5d', 1.5 * DAY], ['1w', 7 * DAY],
    ['45s', 45000], ['30', 30 * MIN], [15, 15 * MIN], [' 2H ', 2 * HOUR], ['1h 30m', 90 * MIN]
  ];
  cases.forEach(([s, ms]) => check(`parseDuration(${JSON.stringify(s)})`, T.parseDuration(s) === ms, `got ${T.parseDuration(s)}`));
  ['', '0', '0m', '-5m', 'h', '2x', '2h junk', 'm30', '1h-30m', null, undefined, NaN, -1]
    .forEach((s) => check(`parseDuration(${JSON.stringify(s)}) rejects`, T.parseDuration(s) === null, `got ${T.parseDuration(s)}`));
}

// ---- wake time: relative, absolute, and the guards ----
{
  check('default snooze is one hour', T.wakeTime({}, NOW) === NOW + HOUR);
  check('duration is relative to now', T.wakeTime({ duration: '3h' }, NOW) === NOW + 3 * HOUR);
  check('until epoch is taken as-is', T.wakeTime({ until: NOW + 5 * MIN }, NOW) === NOW + 5 * MIN);
  check('until ISO string parses', T.wakeTime({ until: new Date(NOW + DAY).toISOString() }, NOW) === NOW + DAY);
  check('until in the past is rejected — it would wake on the next tick, i.e. close-and-reopen',
    T.wakeTime({ until: NOW - 1 }, NOW) === null);
  check('until == now is rejected', T.wakeTime({ until: NOW }, NOW) === null);
  check('garbage until is rejected, not read as "now"', T.wakeTime({ until: 'next tuesday-ish' }, NOW) === null);
  check('a typo-sized duration (1000d) is rejected', T.wakeTime({ duration: '1000d' }, NOW) === null);
  check('an invalid duration is rejected, not defaulted', T.wakeTime({ duration: '2x' }, NOW) === null);
  check('until wins over duration', T.wakeTime({ duration: '1h', until: NOW + 2 * MIN }, NOW) === NOW + 2 * MIN);

  const tm = T.wakeTime({ until: 'tomorrow' }, NOW), d = new Date(tm), n = new Date(NOW);
  check('"tomorrow" is 09:00 local', d.getHours() === 9 && d.getMinutes() === 0 && d.getSeconds() === 0);
  check('"tomorrow" is the next calendar day, even after 09:00 today',
    Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - new Date(n.getFullYear(), n.getMonth(), n.getDate())) / DAY) === 1);
  const early = new Date(NOW); early.setHours(1, 0, 0, 0);
  const te = new Date(T.tomorrowAt(early.getTime(), 9));
  check('"tomorrow" at 01:00 is still the next calendar day, not 8 hours away',
    te.getDate() !== early.getDate() && te.getTime() - early.getTime() > 23 * HOUR);
}

// ---- snooze list: one wake per url, a schedule, and an exact split ----
{
  const tab = (id, url, extra) => ({ id, url, title: 't' + id, ...extra });
  check('a blank new-tab page has nothing to snooze', T.snoozeEntry(tab(1, 'chrome://newtab/'), NOW + HOUR, NOW) === null);
  check('about:blank has nothing to snooze', T.snoozeEntry(tab(1, 'about:blank'), NOW + HOUR, NOW) === null);
  const e = T.snoozeEntry(tab(2, 'https://a.example/', { pinned: true }), NOW + HOUR, NOW);
  check('entry keeps url, pinned and the wake time', e && e.url === 'https://a.example/' && e.pinned === true && e.wakeAt === NOW + HOUR);

  const a1 = { url: 'https://a/', wakeAt: NOW + 3 * HOUR }, b = { url: 'https://b/', wakeAt: NOW + HOUR };
  const a2 = { url: 'https://a/', wakeAt: NOW + 2 * HOUR };
  const list = T.snoozeAdd([a1, b], [a2]);
  check('re-snoozing a url replaces its entry — it must not wake twice', list.filter((x) => x.url === 'https://a/').length === 1);
  check('the newer request for a url wins', list.find((x) => x.url === 'https://a/').wakeAt === NOW + 2 * HOUR);
  check('list is ordered by wake time', eq(list.map((x) => x.url), ['https://b/', 'https://a/']));

  const due = T.snoozeDue(list, NOW + HOUR, false);
  check('an entry wakes exactly at its wake time', eq(due.due.map((x) => x.url), ['https://b/']));
  check('everything not due stays scheduled', eq(due.rest.map((x) => x.url), ['https://a/']));
  check('due + rest is the whole list — nothing dropped', due.due.length + due.rest.length === list.length);
  check('`all` wakes everything', T.snoozeDue(list, NOW, true).due.length === 2);
  check('an empty / missing list splits cleanly', eq(T.snoozeDue(undefined, NOW, false), { due: [], rest: [] }));
}

// ---- auto-archive: which tabs may be CLOSED ----
{
  const TH = 12 * HOUR, old = NOW - 13 * HOUR, fresh = NOW - HOUR;
  const tabs = [
    { id: 1, active: true, lastAccessed: old },
    { id: 2, pinned: true, lastAccessed: old },
    { id: 3, audible: true, lastAccessed: old },
    { id: 4, discarded: true, lastAccessed: old },
    { id: 5, lastAccessed: old },
    { id: 6, lastAccessed: fresh },
    { id: 7 },                                   // never seen: no lastAccessed, no activation
    { id: 8 }                                    // only the worker's activation map knows it
  ];
  const ids = T.archivableTabIds(tabs, { 8: old }, NOW, TH, {});
  check('active / pinned / audible / fresh / unknown are kept; discarded idle tabs ARE archived',
    eq(ids, [4, 5, 8]), `got [${ids}]`);
  check('the active tab is never archived, so a window is never emptied',
    !T.archivableTabIds([{ id: 1, active: true, lastAccessed: old }], {}, NOW, TH, {}).length);
  check('a tab holding a live call is never closed',
    !T.archivableTabIds([{ id: 5, lastAccessed: old }], {}, NOW, TH, { 5: { 2: true } }).length);
  check('Chrome lastAccessed beats a stale worker map (worker restart must not age a just-used tab)',
    !T.archivableTabIds([{ id: 9, lastAccessed: fresh }], { 9: old }, NOW, TH, {}).length);
  check('threshold 0 archives nothing (the off switch)', !T.archivableTabIds(tabs, {}, NOW, 0, {}).length);
  check('negative / NaN threshold archives nothing', !T.archivableTabIds(tabs, {}, NOW, NaN, {}).length);
}

// ---- archive list: newest first, one per url, capped, blank pages skipped ----
{
  const prior = [{ url: 'https://old/', title: 'old', archivedAt: NOW - DAY }, { url: 'https://dup/', title: 'dup-old', archivedAt: NOW - DAY }];
  const out = T.archivePush(prior, [
    { url: 'https://dup/', title: 'dup-new' },
    { url: 'chrome://newtab/', title: 'New Tab' },
    { url: 'https://n/', title: 'n' }
  ], NOW);
  check('new entries go on top, in close order', eq(out.map((e) => e.url), ['https://dup/', 'https://n/', 'https://old/']));
  check('a re-archived url keeps only its newest record', out.find((e) => e.url === 'https://dup/').title === 'dup-new');
  check('a blank new-tab page is not recorded', !out.some((e) => /newtab/.test(e.url)));
  const big = Array.from({ length: 250 }, (_, i) => ({ url: 'https://x/' + i }));
  check('the archive is capped', T.archivePush([], big, NOW).length === T.ARCHIVE_CAP);
  check('the cap keeps the newest', T.archivePush([], big, NOW)[0].url === 'https://x/0');

  const L = [{ url: 'https://a/' }, { url: 'https://b/' }, { url: 'https://c/' }];
  const byUrl = T.takeEntry(L, { url: 'https://b/' });
  check('take by url', byUrl.entry.url === 'https://b/' && eq(byUrl.rest.map((e) => e.url), ['https://a/', 'https://c/']));
  check('take defaults to the newest', T.takeEntry(L, {}).entry.url === 'https://a/');
  check('take by index', T.takeEntry(L, { index: 2 }).entry.url === 'https://c/');
  const miss = T.takeEntry(L, { index: 9 });
  check('an out-of-range index takes nothing and leaves the list intact', miss.entry === null && miss.rest.length === 3);
  check('a fractional index takes nothing', T.takeEntry(L, { index: 0.5 }).entry === null);
  check('an unknown url takes nothing', T.takeEntry(L, { url: 'https://z/' }).entry === null);
  check('take does not mutate the stored list', L.length === 3);
}

// ---- recent tab: Ctrl+Tab in recently-used order ----
{
  let m = [];
  [1, 2, 3, 2, 4].forEach((id) => { m = T.mruTouch(m, id); });
  check('touch moves a tab to the front without duplicating it', eq(m, [4, 2, 3, 1]));
  check('previous tab is the one used just before the current', T.mruTarget(m, 4, [1, 2, 3, 4], 1) === 2);
  check('n=2 goes one further back', T.mruTarget(m, 4, [1, 2, 3, 4], 2) === 3);
  check('n past the end clamps to the oldest known tab', T.mruTarget(m, 4, [1, 2, 3, 4], 99) === 1);
  check('tabs in another window are not candidates', T.mruTarget(m, 4, [4, 3], 1) === 3);
  check('a closed tab is not a candidate', T.mruTarget(T.mruDrop(m, 2), 4, [1, 3, 4], 1) === 3);
  check('nothing to switch to → null', T.mruTarget([4], 4, [4], 1) === null);
  check('n=0 / negative → null', T.mruTarget(m, 4, [1, 2, 3, 4], 0) === null && T.mruTarget(m, 4, [1, 2, 3, 4], -1) === null);
  // Toggling: after switching 4→2 the activation puts 2 on top, so the next switch goes back to 4.
  const after = T.mruTouch(m, 2);
  check('repeated switching toggles between the two most recent tabs', T.mruTarget(after, 2, [1, 2, 3, 4], 1) === 4);
  check('merge keeps live activations above restored history', eq(T.mruMerge([7, 2], [2, 5, 7, 9]), [7, 2, 5, 9]));
  check('the list is capped', T.mruTouch(Array.from({ length: 150 }, (_, i) => i + 1), 0).length === 100);
}

// ---- audio focus: only the focused tab plays; the user's own mutes are sacred ----
{
  const tab = (id, audible, muted, reason) => ({ id, audible, mutedInfo: { muted, ...(reason ? { reason } : {}) } });
  let p = T.audioFocusPlan([tab(1, true, false), tab(2, true, false), tab(3, false, false)], 1, []);
  check('background audible tabs are muted, the focused one and silent ones are not', eq(p.mute, [2]) && !p.unmute.length);
  check('the mute is remembered as ours', eq(p.autoMuted, [2]));

  // Focus moves to 2: we muted it, so we give it back; 1 is now background and audible.
  p = T.audioFocusPlan([tab(1, true, false), tab(2, true, true, 'extension')], 2, [2]);
  check('a tab we muted is unmuted when it gets focus', eq(p.unmute, [2]));
  check('the previously focused audible tab is muted', eq(p.mute, [1]) && eq(p.autoMuted, [1]));

  p = T.audioFocusPlan([tab(5, true, true, 'user')], 5, []);
  check('a tab the USER muted stays muted when focused — we never unmute what we did not mute', !p.unmute.length);
  p = T.audioFocusPlan([tab(5, true, true, 'user')], 9, [5]);
  check('a tab the user re-muted by hand is no longer ours', !p.autoMuted.includes(5));
  p = T.audioFocusPlan([tab(6, true, false, 'user'), tab(7, false, false)], 7, []);
  check('a background tab the user explicitly UNMUTED keeps playing', !p.mute.length);
  p = T.audioFocusPlan([tab(1, true, false)], 1, [42]);
  check('a closed tab drops out of the owned set', !p.autoMuted.includes(42));

  const rel = T.audioFocusRelease([tab(2, true, true, 'extension'), tab(3, true, true, 'user'), tab(4, true, true, 'extension')], [2, 3]);
  check('turning off unmutes exactly our mutes — not the user\'s, not another extension\'s', eq(rel, [2]));
}

console.log(`tabflow: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
