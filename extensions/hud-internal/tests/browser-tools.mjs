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

// ---- Hide Cookie Warnings: consent-text heuristic ----
{
  const c = load('zcookies.js');
  const isConsent = c.__zbIsConsent;
  assert.ok(isConsent, 'consent heuristic not exposed');
  assert.ok(isConsent('We use cookies to improve your experience. Accept all'), 'cookie notice matches');
  assert.ok(isConsent('This site asks for your consent under GDPR'), 'gdpr matches');
  assert.ok(isConsent('Manage your preferences'), 'manage-preferences matches');
  assert.ok(!isConsent('Buy two cookies and get one free'), 'a bakery is not a consent banner');
  assert.ok(!isConsent('Sign in to continue'), 'a login is not a consent banner');
}

// ---- Spatial Navigation: nearest-in-direction picker ----
{
  const sp = load('zspatial.js');
  const pick = sp.__zbSpatialPick;
  assert.ok(pick, 'spatial picker not exposed');
  const from = { cx: 100, cy: 100 };
  const cands = [
    { cx: 100, cy: 200 },   // 0: directly below
    { cx: 400, cy: 110 },   // 1: far right
    { cx: 100, cy: 40 },    // 2: above
    { cx: 120, cy: 500 },   // 3: far below, slightly off
  ];
  assert.equal(pick(cands, from, 'down'), 0, 'down → the aligned one directly below');
  assert.equal(pick(cands, from, 'up'), 2, 'up → the one above');
  assert.equal(pick(cands, from, 'right'), 1, 'right → the rightward one');
  assert.equal(pick(cands, from, 'left'), -1, 'nothing to the left → -1');
  assert.equal(pick([], from, 'down'), -1);
}

// ---- Read Aloud: sentence chunker ----
{
  const s = load('zspeak.js');
  const chunk = s.__zbSpeakChunks;
  assert.ok(chunk, 'speak chunker not exposed');
  assert.deepEqual(chunk(''), []);
  assert.deepEqual(chunk('Hello world.'), ['Hello world.']);
  // splits on sentence boundaries once the cap is exceeded.
  const out = chunk('One sentence here. Two sentence here. Three sentence here.', 25);
  assert.ok(out.length >= 2, 'long text splits into multiple chunks');
  out.forEach((c) => assert.ok(c.length <= 40, 'each chunk stays near the cap'));
  assert.equal(out.join(' ').replace(/\s+/g, ' '), 'One sentence here. Two sentence here. Three sentence here.', 'no text lost');
}

// ---- Element Zapper: selector builder ----
{
  const z = load('zzap.js');
  const path = z.__zbZapPath;
  assert.ok(path, 'zap path builder not exposed');
  // leaf→root steps; nth-of-type chain, root→leaf output.
  assert.equal(path([{ tag: 'span', nth: 2 }, { tag: 'div', nth: 1 }, { tag: 'body', nth: 1 }]), 'body:nth-of-type(1) > div:nth-of-type(1) > span:nth-of-type(2)');
  // an id short-circuits the walk (ids are unique).
  assert.equal(path([{ tag: 'span', nth: 3 }, { tag: 'div', id: 'main' }]), '#main > span:nth-of-type(3)');
  assert.equal(path([]), '');
}

console.log('browser tools (reader / gestures / reload / panels / pip / readinglist / cookies / spatial / speak / zap): all assertions passed');
