// Step-chain executor test (zpalette.js) — the half of self-reverting automation that lives on
// the page.
//
// A chain can only revert on partial failure if "partial" is observable, which needs two things
// this file pins:
//
//   1. steps run ONE AT A TIME — step N+1 must not start before step N has reported, and
//   2. a failing step STOPS the chain and its reason reaches the caller.
//
// The previous executor had neither: `entrySteps(e).forEach((s,i) => setTimeout(..., i*140))` fired
// every step on a parallel stagger and wrapped each in `try {} catch (x) {}`. Both assertions below
// fail against that shape, which is the point of testing it here rather than trusting the diff.
//
// zpalette.js is an IIFE over bare globals, so it loads headless via `new Function` with those
// globals passed as parameters (the same trick tests/undo.mjs uses on zjournal.js). No browser, no
// extension runtime, no network.
import fs from 'node:fs';
import assert from 'node:assert/strict';

const src = fs.readFileSync(new URL('../zpalette.js', import.meta.url), 'utf8');

// Load zpalette.js against fakes and hand back its exported executor plus a log of what it did.
// `hostReply(req, n)` decides what the fake zwire-host answers for the n-th request of that shape.
function load({ hostReply = () => ({ ok: true, reply: { ok: true, code: 0 } }) } = {}) {
  const calls = [];             // every host request / storage command, in the order issued
  const pendingHost = [];       // deferred host replies, so a test can control completion order
  let hostN = 0;

  const listeners = [];
  const chrome = {
    runtime: {
      lastError: null,
      getURL: (p) => 'chrome-extension://test/' + p,
      onMessage: { addListener: (fn) => listeners.push(fn) },
      sendMessage(msg, cb) {
        if (msg && msg.type === 'zb-host') {
          const n = hostN++;
          calls.push({ kind: 'host', req: msg.req });
          const answer = hostReply(msg.req, n);
          // `null` means "do not answer yet" — the test resolves it via flushHost().
          if (answer === null) pendingHost.push({ req: msg.req, cb });
          else setTimeout(() => cb(answer), 0);
          return;
        }
        if (cb) setTimeout(() => cb(undefined), 0);
      },
    },
    storage: {
      local: {
        set(o, cb) { if (o && o.zb_cmd) calls.push({ kind: 'cmd', cmd: o.zb_cmd }); if (cb) cb(); },
        get(_k, cb) { if (cb) cb({}); },
      },
      onChanged: { addListener() {} },
    },
  };

  const styleEl = { textContent: '', id: '', setAttribute() {}, style: {}, addEventListener() {}, appendChild() {}, remove() {} };
  const makeEl = () => ({
    textContent: '', className: '', id: '', style: { cssText: '' }, contentWindow: null,
    setAttribute() {}, addEventListener() {}, appendChild() {}, remove() {},
  });
  const document = {
    head: { appendChild() {} },
    documentElement: { appendChild() {} },
    body: { appendChild() {} },
    createElement: () => makeEl(),
    querySelector: () => null,
    getElementById: () => null,
    addEventListener() {},
  };
  const opened = [];
  const window = {
    ZWIRE_HUD: { SCHEMES: {}, ORDER: [], VAR_KEYS: [] },
    ZWIRE_PALETTE_CMDS: {},
    addEventListener() {},
    // The palette's `open()` falls through to the storage command bus, which `calls` records.
    scrollTo() {},
  };
  const navigator = { platform: 'MacIntel', userAgent: 'test', clipboard: { writeText: (t) => calls.push({ kind: 'clip', text: t }) } };
  const location = { href: 'https://example.test/page', reload: () => calls.push({ kind: 'reload' }), assign() {} };
  // zpalette returns early unless zgui-core's palette is present (it checks window.ZGui).
  const ZGui = { palette: { clear() {}, register() {}, registerProvider() {}, open() {}, isOpen: () => false, close() {} }, fzf: {} };
  window.ZGui = ZGui;

  const fn = new Function(
    'window', 'chrome', 'document', 'navigator', 'location', 'ZGui', 'console', 'setTimeout', 'clearTimeout', 'atob', 'escape', 'decodeURIComponent', 'encodeURIComponent', 'Event',
    src,
  );
  fn(window, chrome, document, navigator, location, ZGui, console, setTimeout, clearTimeout,
     (s) => Buffer.from(String(s), 'base64').toString('binary'), globalThis.escape ?? ((s) => s),
     decodeURIComponent, encodeURIComponent, class Event {});

  const X = window.ZWIRE_CMD_EXEC;
  assert.ok(X && X.runCustom, 'zpalette.js must export ZWIRE_CMD_EXEC.runCustom');
  // Loading the module wakes the MV3 worker with a `zb_cmd` ping; drop it so `calls` holds only
  // what the chain under test issued.
  calls.length = 0;
  return { X, calls, opened, flushHost: (answer) => { const p = pendingHost.shift(); if (p) p.cb(answer); return !!p; }, pendingHost };
}

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
let failures = 0;
function check(name, fn) {
  try { fn(); process.stdout.write(`ok   ${name}\n`); }
  // Failures go to stderr — scripts/test.sh captures that stream and prints it under the section
  // header when the suite is red.
  catch (e) { failures++; process.stderr.write(`FAIL ${name}\n     ${e.message}\n`); }
}

/* ---- 1. steps run one at a time, in order ------------------------------------------------- */
// Two shell steps. The second must not be issued until the first has been answered. A parallel
// stagger issues both immediately (the 140ms timer is not awaited by anything), so this fails
// against the old executor without needing to reason about timing.
await new Promise((resolve) => {
  const { X, calls, flushHost, pendingHost } = load({ hostReply: () => null });   // never auto-answer
  let finished = null;
  X.runCustom({ steps: [{ type: 'shell', value: 'first' }, { type: 'shell', value: 'second' }] }, '', (e) => { finished = e; });

  // Waited well past the old executor's 140ms stagger: with the first step still unanswered, a
  // parallel executor has issued step 2 by now and a serial one has not. Checking sooner would
  // pass against BOTH shapes and prove nothing.
  setTimeout(() => {
    check('a chain issues only its first step until that step reports', () => {
      const hosts = calls.filter((c) => c.kind === 'host');
      assert.equal(hosts.length, 1, `expected 1 in-flight host call, got ${hosts.length}`);
      assert.match(JSON.stringify(hosts[0].req.args), /first/);
      assert.equal(pendingHost.length, 1);
    });
    flushHost({ ok: true, reply: { ok: true, code: 0, stdout: b64('') } });
    setTimeout(() => {
      check('the second step is issued only after the first completes', () => {
        const hosts = calls.filter((c) => c.kind === 'host');
        assert.equal(hosts.length, 2, `expected the second step to be issued, saw ${hosts.length} host calls`);
        assert.match(JSON.stringify(hosts[1].req.args), /second/);
      });
      flushHost({ ok: true, reply: { ok: true, code: 0, stdout: b64('') } });
      setTimeout(() => {
        check('a chain whose steps all succeed reports no error', () => assert.equal(finished, null));
        resolve();
      }, 5);
    }, 5);
  }, 260);
});

/* ---- 2. a failing step stops the chain and reports why ------------------------------------ */
// Step 1 exits non-zero. Step 2 must never be issued, and the caller must receive the reason.
// The old executor toasted the failure and ran step 2 anyway.
await new Promise((resolve) => {
  const { X, calls } = load({
    hostReply: (req) => (JSON.stringify(req.args).includes('boom')
      ? { ok: true, reply: { ok: true, code: 3, stdout: b64(''), stderr: b64('exploded') } }
      : { ok: true, reply: { ok: true, code: 0, stdout: b64('') } }),
  });
  X.runCustom({ steps: [{ type: 'shell', value: 'boom' }, { type: 'shell', value: 'never' }] }, '', (err) => {
    check('a non-zero exit stops the chain', () => {
      const hosts = calls.filter((c) => c.kind === 'host');
      assert.equal(hosts.length, 1, `the step after a failure must not run; saw ${hosts.length} host calls`);
      assert.ok(!JSON.stringify(hosts).includes('never'), 'the second step was issued after a failure');
    });
    check('the failure reason reaches the caller', () => {
      assert.ok(err, 'runCustom reported success for a chain whose first step exited 3');
      assert.match(err, /exit 3/);
      assert.match(err, /exploded/);
    });
    resolve();
  });
});

/* ---- 3. {q} still reaches every step ------------------------------------------------------ */
await new Promise((resolve) => {
  const { X, calls } = load();
  X.runCustom({ steps: [{ type: 'shell', value: 'a {q}' }, { type: 'shell', value: 'b {q}' }] }, 'MATCH', () => {
    check('{q} is substituted in every step of a serialized chain', () => {
      const cmds = calls.filter((c) => c.kind === 'host').map((c) => c.req.args[c.req.args.length - 1]);
      assert.deepEqual(cmds, ['a MATCH', 'b MATCH']);
    });
    resolve();
  });
});

/* ---- 4. a legacy single-step command is unchanged ----------------------------------------- */
// Every shipped default in cmd-defaults.js is a legacy `{type,value}` url entry. Serializing must
// leave them running exactly as before — this is the regression the behaviour change could cause.
await new Promise((resolve) => {
  const { X, calls } = load();
  X.runCustom({ type: 'url', value: 'https://example.test/?q={q}' }, 'hello world', (err) => {
    check('a legacy single-step url command still opens its url', () => {
      assert.equal(err, null);
      const nav = calls.filter((c) => c.kind === 'cmd' && c.cmd.a === 'openTab');
      assert.equal(nav.length, 1, 'expected exactly one openTab');
      assert.equal(nav[0].cmd.url, 'https://example.test/?q=hello%20world');
    });
    resolve();
  });
});

/* ---- 5. inside a transaction, steps route through the host and are class-checked ---------- */
// The `action` step must become a host `call` carrying the txn — an action sent down the
// extension's own storage bus is never journaled, so an abort would compensate nothing.
await new Promise((resolve) => {
  const { X, calls } = load({
    hostReply: (req) => (req.cmd === 'call'
      ? { ok: true, reply: { ok: true, result: { ok: true } } }
      : { ok: true, reply: { ok: true, txn: 1, steps: 0 } }),
  });
  X.runTxn({ steps: [{ type: 'action', value: 'closeTab' }] }, '', (err) => {
    check('a transacted action goes to the host as a journaled bus call', () => {
      assert.equal(err, null, `runTxn failed: ${err}`);
      const hosts = calls.filter((c) => c.kind === 'host').map((c) => c.req);
      assert.equal(hosts[0].cmd, 'txn_begin', 'the chain must open a transaction first');
      const call = hosts.find((r) => r.cmd === 'call');
      assert.ok(call, 'the action step did not become a bus call — it would not be journaled');
      assert.equal(call.verb, 'browser.closeTab');
      assert.equal(call.txn, hosts[0].txn, 'the call must carry the open transaction id');
      assert.equal(hosts[hosts.length - 1].cmd, 'txn_commit', 'a clean chain must commit');
      assert.equal(calls.filter((c) => c.kind === 'cmd').length, 0, 'a transacted action must not use the unjournaled storage bus');
    });
    resolve();
  });
});

/* ---- 6. a failing transacted chain ABORTS instead of committing --------------------------- */
await new Promise((resolve) => {
  const { X, calls } = load({
    hostReply: (req) => (req.cmd === 'call'
      ? { ok: true, reply: { ok: false, err: 'verb not reversible: browser.reopenTab' } }
      : { ok: true, reply: { ok: true, txn: 1, steps: 1 } }),
  });
  X.runTxn({ steps: [{ type: 'action', value: 'pinTab' }, { type: 'action', value: 'reopenTab' }] }, '', (err) => {
    check('a chain refused mid-way aborts its transaction', () => {
      assert.ok(err, 'a refused step must be reported');
      const closing = calls.filter((c) => c.kind === 'host').map((c) => c.req.cmd).pop();
      assert.equal(closing, 'txn_abort', `expected txn_abort, got ${closing} — the applied steps would be left in place`);
    });
    resolve();
  });
});

/* ---- 7. a step with no possible inverse is refused inside a transaction -------------------- */
await new Promise((resolve) => {
  const { X, calls } = load({ hostReply: () => ({ ok: true, reply: { ok: true, txn: 1, steps: 0 } }) });
  X.runTxn({ steps: [{ type: 'shell', value: 'rm -rf /' }] }, '', (err) => {
    check('a shell step is refused inside a self-reverting chain, not run', () => {
      assert.ok(err, 'a shell step inside a transaction must fail');
      assert.match(err, /not revertible/);
      const execs = calls.filter((c) => c.kind === 'host' && c.req.cmd === 'exec');
      assert.equal(execs.length, 0, 'the shell step actually ran inside a transaction that cannot undo it');
    });
    resolve();
  });
});

if (failures) process.stderr.write(`\n${failures} check(s) failed\n`); else process.stdout.write('\nall checks passed\n');
process.exit(failures ? 1 : 0);
