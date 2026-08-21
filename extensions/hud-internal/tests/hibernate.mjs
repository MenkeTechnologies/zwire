// Auto-hibernate decision test (zhibernate-core.js) — which tabs the 5-minute sweep in
// background.js is allowed to hand to chrome.tabs.discard().
//
// This is a data-loss gate, not a tidiness gate. Discarding a tab destroys its
// WebContents and ends every MediaStreamTrack it owns, so a wrong `true` here drops a
// live video call — camera, microphone and screen share released in the same instant,
// no crash, nothing in the log. Chromium's own Memory Saver refuses to discard a
// capturing tab (DiscardEligibilityPolicy::CanDiscard); the chrome.tabs.discard() path
// does not consult that policy, so these assertions and fork patch 0028 are what stand
// between a 30-minute idle timer and a dropped presentation.
//
// zhibernate-core.js is a pure IIFE over a `self`-like global, so it loads headless.
import fs from 'node:fs';
import assert from 'node:assert/strict';

const src = fs.readFileSync(new URL('../zhibernate-core.js', import.meta.url), 'utf8');
const root = {};
new Function('self', src)(root);
const H = root.ZWIRE_HIBERNATE;
assert.ok(H && H.staleTabIds && H.isCaptureLive, 'ZWIRE_HIBERNATE missing');

const NOW = 1_700_000_000_000;
const THRESHOLD = 30 * 60000;
const idleFor = (m) => NOW - m * 60000;

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; return; }
  fail++;
  console.error(`  ✗ ${name}${detail ? ' — ' + detail : ''}`);
}

// ---- the presenting-tab case: exactly the shape that dropped a 39-minute call ----
// Presenting means capturing mic + screen while looking at something else, so the tab is
// inactive and NOT audible (an audible tab is one that produces sound; this one consumes
// a microphone). Every pre-capture guard says "discard me".
{
  const meet = { id: 7, active: false, pinned: false, audible: false, discarded: false };
  const lastActive = { 7: idleFor(45) };
  const capturing = { 7: { 0: true } };

  check('a capturing tab is never stale',
    H.staleTabIds([meet], lastActive, NOW, THRESHOLD, capturing).length === 0);
  check('the same tab IS stale once capture ends',
    H.staleTabIds([meet], lastActive, NOW, THRESHOLD, { 7: { 0: false } }).join() === '7',
    'the exemption must be capture state, not a permanent opt-out');
  check('no capture map at all still discards an idle tab',
    H.staleTabIds([meet], lastActive, NOW, THRESHOLD, undefined).join() === '7');
}

// ---- capture in a subframe protects the whole tab ----
// A call embedded in an iframe (a meeting widget in an intranet page) reports on a frame
// id that is not 0. Discard is a per-TAB operation, so any live frame has to veto it.
{
  const tab = { id: 9, active: false, audible: false };
  const lastActive = { 9: idleFor(31) };
  check('a live subframe vetoes the tab',
    H.staleTabIds([tab], lastActive, NOW, THRESHOLD, { 9: { 0: false, 3: true } }).length === 0);
  check('all frames idle -> discardable',
    H.staleTabIds([tab], lastActive, NOW, THRESHOLD, { 9: { 0: false, 3: false } }).join() === '9');
  check('isCaptureLive ignores an empty record',
    H.isCaptureLive({ 9: {} }, 9) === false);
  check('isCaptureLive on an unknown tab is false',
    H.isCaptureLive({}, 404) === false);
}

// ---- the pre-existing guards must survive the rewrite ----
{
  const lastActive = { 1: idleFor(60), 2: idleFor(60), 3: idleFor(60), 4: idleFor(60), 5: idleFor(60), 6: idleFor(29) };
  const tabs = [
    { id: 1, active: true },
    { id: 2, pinned: true },
    { id: 3, audible: true },
    { id: 4, discarded: true },
    { id: 5 },
    { id: 6 }
  ];
  const ids = H.staleTabIds(tabs, lastActive, NOW, THRESHOLD, {});
  check('active/pinned/audible/discarded stay spared, plain idle tab discarded',
    ids.join() === '5', `got [${ids.join()}]`);
  check('a tab idle for less than the threshold is spared',
    !ids.includes(6));
  check('a tab with no lastActive entry is spared (seeded next sweep)',
    H.staleTabIds([{ id: 8 }], {}, NOW, THRESHOLD, {}).length === 0);
  check('threshold 0 minutes is the caller\'s off switch, not this function\'s',
    H.staleTabIds([{ id: 5 }], lastActive, NOW, 0, {}).join() === '5');
}

console.log(`hibernate: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
