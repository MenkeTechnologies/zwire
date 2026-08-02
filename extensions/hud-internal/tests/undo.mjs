// Transaction journal test (zjournal.js) — the browser half of transactional compensation.
//
// The host owns the ORDER (one seq clock, `browser.undo` carries the reversed step list); this module
// owns the PRE-STATE, captured by observing the chrome events an action actually produced. So the
// assertions here are about exactly two things:
//
//   1. an armed action journals the RIGHT inverse for each observed effect, and
//   2. an undo frame replays those inverses against `chrome.*` in the right ORDER.
//
// The file is an IIFE taking (self, chrome), so it loads headless via `new Function` against a fake
// chrome that records every call. No browser, no network, no extension runtime.
import fs from 'node:fs';
import assert from 'node:assert/strict';

const src = fs.readFileSync(new URL('../zjournal.js', import.meta.url), 'utf8');

// A fake chrome that logs every write and answers queries from a tab table.
function fakeChrome(tabs) {
  const calls = [];
  const log = (name, args) => calls.push({ name, args });
  const err = { value: null };
  return {
    calls,
    err,
    runtime: { get lastError() { return err.value; } },
    storage: { local: { set: () => {}, get: (_k, cb) => cb && cb({}) } },
    tabs: {
      query: (_q, cb) => cb(tabs),
      create: (props, cb) => { log('tabs.create', props); if (cb) cb({ id: 900 + calls.length }); },
      remove: (id, cb) => { log('tabs.remove', id); if (cb) cb(); },
      move: (id, props, cb) => { log('tabs.move', { id, ...props }); if (cb) cb(); },
      update: (id, props, cb) => { log('tabs.update', { id, ...props }); if (cb) cb(); },
      setZoom: (id, f, cb) => { log('tabs.setZoom', { id, factor: f }); if (cb) cb(); },
    },
    windows: { remove: (id, cb) => { log('windows.remove', id); if (cb) cb(); } },
  };
}

function load(chrome) {
  const root = {};
  new Function('self', 'chrome', 'setTimeout', src)(root, chrome, (fn) => fn());
  const J = root.ZB_JOURNAL;
  J.SETTLE_MS = 0;
  return J;
}

const TABS = [
  { id: 1, url: 'https://a.example/', index: 0, windowId: 10, pinned: false, active: true },
  { id: 2, url: 'https://b.example/', index: 1, windowId: 10, pinned: true, mutedInfo: { muted: true } },
  { id: 3, url: 'https://c.example/', index: 2, windowId: 10, pinned: false, active: false },
];

// ---- 1. a closed tab journals its full descriptor, and undo re-creates it there ----
{
  const chrome = fakeChrome(TABS);
  const J = load(chrome);
  J.arm({ a: 'closeTab', _txn: 7, _seq: 1 }, () => J.on.tabRemoved(2));

  assert.deepEqual(J.stepsFor(1), [
    { op: 'reopen', url: 'https://b.example/', index: 1, windowId: 10, pinned: true, muted: true },
  ], 'a close journals {url,index,windowId,pinned,muted} — the REV table\'s stated pre-state');

  J.undo({ txn: 7, steps: [{ seq: 1, verb: 'browser.closeTab' }] }, (r) => {
    assert.equal(r.compensated, 1);
    assert.deepEqual(r.failed, []);
  });
  assert.deepEqual(chrome.calls[0], {
    name: 'tabs.create',
    args: { url: 'https://b.example/', index: 1, windowId: 10, pinned: true, active: false },
  }, 'the tab comes back at its prior index, in its prior window, still pinned');
  assert.deepEqual(chrome.calls[1], { name: 'tabs.update', args: { id: 901, muted: true } },
    'and still muted — a second call, because create() takes no muted property');
  assert.deepEqual(J.stepsFor(1), [], 'the journal entry is consumed, so a second abort unwinds nothing');
}

// ---- 2. a multi-tab close journals one reopen per tab, unwound in reverse ----
{
  const chrome = fakeChrome(TABS);
  const J = load(chrome);
  J.arm({ a: 'closeOthers', _txn: 1, _seq: 4 }, () => { J.on.tabRemoved(2); J.on.tabRemoved(3); });
  assert.equal(J.stepsFor(4).length, 2, 'both closed tabs journaled');

  J.undo({ txn: 1, steps: [{ seq: 4 }] }, (r) => assert.equal(r.compensated, 2));
  const created = chrome.calls.filter((c) => c.name === 'tabs.create').map((c) => c.args.url);
  assert.deepEqual(created, ['https://c.example/', 'https://b.example/'],
    'within one step the effects unwind in reverse observation order');
}

// ---- 3. the four effect families the REV table names ----
{
  const chrome = fakeChrome(TABS);
  const J = load(chrome);
  // prior index (a move), prior flag (a pin), prior active tab (a selection), prior url + zoom (a page)
  J.arm({ a: 'chain', _txn: 2, _seq: 9 }, () => {
    J.on.tabMoved(3, { fromIndex: 2, toIndex: 0, windowId: 10 });
    J.on.tabUpdated(1, { pinned: true });
    J.on.tabActivated({ tabId: 3, windowId: 10 });
    J.on.tabUpdated(1, { url: 'https://moved.example/' });
    J.on.tabZoom({ tabId: 1, oldZoomFactor: 1.5 });
  });
  assert.deepEqual(J.stepsFor(9), [
    { op: 'move', id: 3, index: 2, windowId: 10 },
    { op: 'flags', id: 1, pinned: false },
    { op: 'activate', id: 1 },
    { op: 'navigate', id: 1, url: 'https://a.example/' },
    { op: 'zoom', id: 1, factor: 1.5 },
  ], 'prior index / prior flag / prior active tab / prior url / prior zoom');

  J.undo({ steps: [{ seq: 9 }] }, (r) => assert.equal(r.compensated, 5));
  assert.deepEqual(chrome.calls.map((c) => c.name), [
    'tabs.setZoom', 'tabs.update', 'tabs.update', 'tabs.update', 'tabs.move',
  ], 'replayed newest-effect-first');
  assert.deepEqual(chrome.calls[4].args, { id: 3, index: 2, windowId: 10 });
}

// ---- 4. the FIRST observation of an effect wins (it holds the true pre-state) ----
{
  const chrome = fakeChrome(TABS);
  const J = load(chrome);
  J.arm({ a: 'twice', _seq: 3 }, () => {
    J.on.tabUpdated(1, { url: 'https://one.example/' });
    J.on.tabUpdated(1, { url: 'https://two.example/' });
  });
  assert.deepEqual(J.stepsFor(3), [{ op: 'navigate', id: 1, url: 'https://a.example/' }],
    'a second update must not overwrite the pre-state with an already-changed value');
}

// ---- 5. a created window swallows its own first tab ----
{
  const chrome = fakeChrome(TABS);
  const J = load(chrome);
  J.arm({ a: 'newWindow', _seq: 5 }, () => {
    J.on.windowCreated({ id: 77 });
    J.on.tabCreated({ id: 50, windowId: 77 });
  });
  J.undo({ steps: [{ seq: 5 }] }, (r) => {
    assert.equal(r.compensated, 1, 'one op ran');
    assert.deepEqual(r.failed, [], 'and nothing is reported as a failure');
  });
  assert.deepEqual(chrome.calls, [{ name: 'windows.remove', args: 77 }],
    'closing the window takes its tab, so the tab close would fail on a dead id — it is dropped');
}

// ---- 6. a failing compensation is reported, and never stops the rest ----
{
  const chrome = fakeChrome(TABS);
  const J = load(chrome);
  J.arm({ a: 'closeOthers', _seq: 6 }, () => { J.on.tabRemoved(2); J.on.tabRemoved(3); });
  // The first replayed create (tab 3) fails; the second (tab 2) must still run.
  let n = 0;
  chrome.tabs.create = (props, cb) => {
    chrome.calls.push({ name: 'tabs.create', args: props });
    chrome.err.value = n++ === 0 ? { message: 'cannot create tab' } : null;
    cb(null);
    chrome.err.value = null;
  };
  let report = null;
  J.undo({ steps: [{ seq: 6 }] }, (r) => { report = r; });
  assert.equal(report.compensated, 1);
  assert.deepEqual(report.failed, [{ op: 'reopen', id: null, error: 'cannot create tab' }]);
  assert.equal(chrome.calls.filter((c) => c.name === 'tabs.create').length, 2,
    'the unwind continues past a failure');
}

// ---- 7. actions with no _seq are not journaled; unknown seqs unwind nothing ----
{
  const chrome = fakeChrome(TABS);
  const J = load(chrome);
  let ran = false;
  J.arm({ a: 'closeTab' }, () => { ran = true; J.on.tabRemoved(2); });
  assert.equal(ran, true, 'an un-transacted action still executes');
  assert.equal(J.isArmed(), false, 'and never arms the journal');
  // The host never issues seq 0 (txn::record hands out 1..N), so nothing may be filed under it —
  // this is what catches a capture that defaults a missing `_seq` instead of skipping the action.
  assert.equal(J.stepsFor(0).length, 0, 'and journals nothing under a defaulted seq');
  J.undo({ steps: [{ seq: 999 }] }, (r) => {
    assert.equal(r.compensated, 0);
    assert.equal(r.ops, 0);
  });
  assert.deepEqual(chrome.calls, [], 'an abort of a transaction we never saw touches nothing');
}

// ---- 8. exactly-once delivery: the same host stamp is accepted once ----
{
  const J = load(fakeChrome(TABS));
  assert.equal(J.freshAction(1001), true, 'first delivery of a stamp runs');
  assert.equal(J.freshAction(1001), false, 'a second transport delivering it does not');
  assert.equal(J.freshAction(1002), true, 'a different stamp is a different action');
}

console.log('undo: ok');
