// Pure-helper tests for the Vivaldi browser tools that expose a testable core:
// Reader View (container scorer), Mouse Gestures (path recognizer), Periodic
// Reload (presets). Each file exposes helpers on `window` and bails before DOM
// use when the HUD/chrome is absent, so they load headless here.
import fs from 'node:fs';
import assert from 'node:assert/strict';

function load(file) { const win = {}; new Function('window', fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8'))(win); return win; }

// ---- Reader View: container scoring ----
{
  const r = load('zreader.js');
  const score = r.__zbReaderScore, best = r.__zbReaderBest;
  assert.ok(score && best, 'reader helpers not exposed');
  // more paragraph text scores higher; links drag it down.
  assert.ok(score({ tag: 'div', pText: 1000, linkDensity: 0.1 }) > score({ tag: 'div', pText: 1000, linkDensity: 0.8 }), 'link density lowers score');
  assert.ok(score({ tag: 'article', pText: 500, linkDensity: 0 }) > score({ tag: 'div', pText: 500, linkDensity: 0 }), 'article tag is boosted');
  const list = [{ tag: 'div', pText: 100, linkDensity: 0 }, { tag: 'article', pText: 900, linkDensity: 0.1 }, { tag: 'nav', pText: 300, linkDensity: 0.9 }];
  assert.equal(best(list).tag, 'article', 'picks the article body over nav/sidebar');
  assert.equal(best([]), null);
}

// ---- Mouse Gestures: path -> direction sequence ----
{
  const g = load('zgestures.js');
  const gesture = g.__zbGesture, map = g.__zbGestureMap;
  assert.ok(gesture && map, 'gesture helpers not exposed');
  const path = (pts) => pts.map(([x, y]) => ({ x, y }));
  assert.equal(gesture(path([[100, 100], [40, 100], [0, 100]])), 'L', 'leftward drag = L (back)');
  assert.equal(gesture(path([[0, 100], [80, 100], [160, 100]])), 'R', 'rightward = R (forward)');
  assert.equal(gesture(path([[0, 200], [0, 120], [0, 40]])), 'U', 'upward = U (new tab)');
  assert.equal(gesture(path([[0, 0], [0, 80], [80, 80], [160, 80]])), 'DR', 'down-then-right = DR (close tab)');
  assert.equal(gesture(path([[0, 0], [2, 3]])), '', 'tiny movement is not a gesture');
  assert.equal(map.L, 'goBack');
  assert.equal(map.DR, 'closeTab');
  assert.equal(map.UD, 'reload');
}

// ---- Periodic Reload: presets ----
{
  const p = load('zreload.js');
  const presets = p.__zbReloadPresets;
  assert.ok(Array.isArray(presets) && presets.length >= 5, 'reload presets exposed');
  assert.equal(presets[0][1], 0, 'first preset is Off (0ms)');
  assert.ok(presets.some((x) => x[1] === 60000), 'has a 1-minute preset');
  presets.forEach((x) => assert.equal(typeof x[1], 'number', 'preset value is ms'));
}

// ---- Web Panels: URL normalizer ----
{
  const p = load('zpanels.js');
  const norm = p.__zbPanelNormalize;
  assert.ok(norm, 'panel normalizer not exposed');
  assert.equal(norm('example.com'), 'https://example.com', 'bare host gets https://');
  assert.equal(norm('http://x.io'), 'http://x.io', 'existing scheme kept');
  assert.equal(norm('https://y.io/a'), 'https://y.io/a');
  assert.equal(norm('  spaced.com  '), 'https://spaced.com', 'trimmed');
  assert.equal(norm(''), '');
}

// ---- Pop-out video: pick the best <video> ----
{
  const x = load('zextras.js');
  const pick = x.__zbPickVideo;
  assert.ok(pick, 'video picker not exposed');
  // a playing video beats a bigger paused one.
  assert.deepEqual(pick([{ w: 800, h: 600, playing: false }, { w: 320, h: 240, playing: true }]), { w: 320, h: 240, playing: true });
  // among same play-state, the largest wins.
  assert.deepEqual(pick([{ w: 100, h: 100, playing: false }, { w: 400, h: 300, playing: false }]), { w: 400, h: 300, playing: false });
  assert.equal(pick([]), null);
}

// ---- Reading List: order + partition ----
{
  const win = {}; new Function('window', fs.readFileSync(new URL('../pages/readinglist.js', import.meta.url), 'utf8'))(win);
  const R = win.ZBReadingList;
  assert.ok(R && R.order, 'reading-list helpers not exposed');
  const entries = [
    { url: 'a', hasBeenRead: true, creationTime: 300 },
    { url: 'b', hasBeenRead: false, creationTime: 100 },
    { url: 'c', hasBeenRead: false, creationTime: 200 },
  ];
  const ord = R.order(entries);
  assert.deepEqual(ord.map((e) => e.url), ['c', 'b', 'a'], 'unread first, then newest-first');
  assert.deepEqual(R.partition(entries), { unread: 2, total: 3 });
  assert.deepEqual(R.partition([]), { unread: 0, total: 0 });
}

console.log('browser tools (reader / gestures / reload / panels / pip / readinglist): all assertions passed');
