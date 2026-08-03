// Self-reverting triggers — the two halves that are not the executor itself.
//
//   1. ztriggers.js `fire()` must route a `revert` trigger through the TRANSACTIONAL runner and
//      must not discard the result. It previously called `runCustom` and threw the return value
//      away, so a trigger that half-applied its chain reported nothing anywhere.
//   2. pages/step-wizard.js `revProblems()` must reject, at authoring time, any step the host
//      could not undo — reading the reversibility class from the HOST's table (`{cmd:'verbs'}`),
//      never from a JS copy of it.
//
// Both files are IIFEs over bare globals, so they load headless via `new Function`. No browser.
import fs from 'node:fs';
import assert from 'node:assert/strict';

let failures = 0;
function check(name, fn) {
  try { fn(); process.stdout.write(`ok   ${name}\n`); }
  // Failures go to stderr — scripts/test.sh captures that stream and prints it under the section
  // header when the suite is red.
  catch (e) { failures++; process.stderr.write(`FAIL ${name}\n     ${e.message}\n`); }
}

/* ---- ztriggers.js: which runner a trigger's chain goes through ----------------------------- */

const trigSrc = fs.readFileSync(new URL('../ztriggers.js', import.meta.url), 'utf8');

// Load ztriggers.js with a fake chrome whose storage hands back `triggers`, and a fake executor
// that records which runner was used. Returns the recorded runs.
function loadTriggers(triggers, pageText) {
  const runs = [];
  let changeListener = null;
  const chrome = {
    runtime: { lastError: null },
    storage: {
      local: { get: (_k, cb) => cb({ zb_triggers: triggers }) },
      onChanged: { addListener: (fn) => { changeListener = fn; } },
    },
  };
  const window = {
    ZWIRE_CMD_EXEC: {
      runCustom: (entry, arg, done) => { runs.push({ via: 'runCustom', steps: entry.steps, arg, done }); },
      runTxn: (entry, arg, done) => { runs.push({ via: 'runTxn', steps: entry.steps, arg, done }); },
    },
  };
  const warnings = [];
  const console_ = { warn: (m) => warnings.push(String(m)), error() {} };
  // A body/documentElement whose innerText is the page text the engine scans on start.
  const node = { innerText: pageText || '', textContent: pageText || '', closest: () => null, nodeType: 1 };
  const document = {
    body: node, documentElement: node,
    addEventListener() {},
    createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }),
  };
  class MutationObserver { constructor(fn) { this.fn = fn; } observe() {} disconnect() {} }
  const location = { href: 'https://ci.example.test/build/42' };

  const timers = [];
  const fakeSetTimeout = (fn) => { timers.push(fn); return timers.length; };
  const fn = new Function('window', 'chrome', 'document', 'location', 'MutationObserver', 'console', 'setTimeout', 'clearTimeout', 'Date', trigSrc);
  fn(window, chrome, document, location, MutationObserver, console_, fakeSetTimeout, () => {}, Date);
  return { runs, warnings, flush: () => { const t = timers.slice(); timers.length = 0; t.forEach((f) => f()); } };
}

// A trigger flagged `revert` must use the transactional runner.
{
  const t = loadTriggers([{ id: 'a', name: 'build failed', pattern: 'FAILED', revert: true, steps: [{ type: 'action', value: 'closeTab' }] }], 'BUILD FAILED on step 3');
  // The engine enqueues the initial page text on start, then flushes on a timer.
  t.flush();
  check('a revert trigger runs its chain through the transactional runner', () => {
    assert.equal(t.runs.length, 1, `expected the trigger to fire once, saw ${t.runs.length}`);
    assert.equal(t.runs[0].via, 'runTxn', 'a self-reverting trigger used the non-transactional runner — a failed chain would stay half-applied');
  });
  check('the matched line is passed as the chain argument', () => {
    assert.match(t.runs[0].arg, /FAILED/);
  });
  check('a trigger no longer discards the chain result', () => {
    assert.equal(typeof t.runs[0].done, 'function', 'fire() passed no completion callback — a failure would be silently dropped');
  });
}

// An ordinary trigger keeps the plain runner: the transaction is opt-in, not a behaviour change
// forced onto every existing trigger.
{
  const t = loadTriggers([{ id: 'b', name: 'plain', pattern: 'FAILED', steps: [{ type: 'shell', value: 'notify' }] }], 'it FAILED');
  t.flush();
  check('a trigger without revert still uses the plain runner', () => {
    assert.equal(t.runs.length, 1);
    assert.equal(t.runs[0].via, 'runCustom');
  });
}

// A reported failure surfaces rather than vanishing.
{
  const t = loadTriggers([{ id: 'c', name: 'noisy', pattern: 'FAILED', revert: true, steps: [{ type: 'action', value: 'closeTab' }] }], 'FAILED');
  t.flush();
  t.runs[0].done('browser.reopenTab: verb not reversible');
  check('a chain failure is reported, not swallowed', () => {
    assert.equal(t.warnings.length, 1, 'the failure produced no diagnostic at all');
    assert.match(t.warnings[0], /not reversible/);
    assert.match(t.warnings[0], /noisy/, 'the diagnostic must name the trigger');
  });
}

/* ---- step-wizard.js: authoring-time classification ---------------------------------------- */

const wizSrc = fs.readFileSync(new URL('../pages/step-wizard.js', import.meta.url), 'utf8');

function loadWizard() {
  const window = {};
  const document = { getElementById: () => null, createElement: () => ({ style: {}, className: '', id: '', setAttribute() {}, appendChild() {} }), head: { appendChild() {} }, documentElement: { appendChild() {} } };
  const navigator = { platform: 'MacIntel', userAgent: 'test' };
  const chrome = { runtime: { lastError: null, sendMessage: (_m, cb) => cb && cb(null) } };
  const fn = new Function('window', 'document', 'navigator', 'chrome', 'localStorage', wizSrc);
  fn(window, document, navigator, chrome, { getItem: () => null, setItem() {} });
  assert.ok(window.ZwireStepWizard && window.ZwireStepWizard.revProblems, 'step-wizard must export revProblems');
  return window.ZwireStepWizard;
}

const W = loadWizard();
// The table as the host serves it, reduced to { verb: class } — the shape loadRevMap produces.
const REV = {
  'browser.closeTab': 'inverse',
  'browser.pinTab': 'inverse',
  'browser.openTab': 'inverse',
  'browser.reload': 'pure',
  'browser.reopenTab': 'irreversible',
  ping: 'pure',
  kv_set: 'irreversible',
};

check('a chain of revertible steps is accepted', () => {
  const bad = W.revProblems([{ type: 'action', value: 'closeTab' }, { type: 'url', value: 'https://x.test' }, { type: 'host', value: '{"cmd":"ping"}' }], REV);
  assert.deepEqual(bad, [], `unexpected rejections: ${JSON.stringify(bad)}`);
});

check('an irreversible browser verb is rejected with its index', () => {
  const bad = W.revProblems([{ type: 'action', value: 'pinTab' }, { type: 'action', value: 'reopenTab' }], REV);
  assert.equal(bad.length, 1);
  assert.equal(bad[0].index, 1);
  assert.equal(bad[0].verb, 'browser.reopenTab');
  assert.equal(bad[0].rev, 'irreversible');
});

check('a host step is classified by the verb inside its JSON', () => {
  const bad = W.revProblems([{ type: 'host', value: '{"cmd":"kv_set","key":"k"}' }], REV);
  assert.equal(bad.length, 1);
  assert.equal(bad[0].verb, 'kv_set', 'the host step was not classified by its cmd');
});

check('a step type with no bus verb is rejected', () => {
  const types = ['shell', 'stryke', 'js', 'applescript', 'batch', 'scheme'];
  types.forEach((t) => {
    const bad = W.revProblems([{ type: t, value: 'x' }], REV);
    assert.equal(bad.length, 1, `${t} was accepted into a self-reverting chain`);
    assert.equal(bad[0].verb, null);
  });
});

check('an unreadable rev table rejects everything rather than assuming revertible', () => {
  // loadRevMap yields null when the host is unreachable. Classing verbs as revertible on the
  // strength of a table we could not read is the one wrong direction here.
  const bad = W.revProblems([{ type: 'action', value: 'closeTab' }], null);
  assert.equal(bad.length, 1, 'a null rev table let a step through');
  assert.equal(bad[0].rev, 'irreversible');
});

check('a verb absent from the table is treated as irreversible', () => {
  const bad = W.revProblems([{ type: 'action', value: 'muteTab' }], REV);   // not in this REV fixture
  assert.equal(bad.length, 1);
  assert.equal(bad[0].verb, 'browser.muteTab');
});

if (failures) process.stderr.write(`\n${failures} check(s) failed\n`); else process.stdout.write('\nall checks passed\n');
process.exit(failures ? 1 : 0);
