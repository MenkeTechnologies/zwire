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

/* ---- 8. a `suite` step calls another app on the bus, and its refusal stops the chain ------- */
// The cross-app step goes to zwire-host as `suite_call` (suite.rs dials the peer's socket). Two
// things matter beyond "it sent something": the {q} argument must arrive JSON-ESCAPED — a match off
// a live page routinely contains a quote — and a peer that refuses must fail the STEP, because a
// chain that continues past a delivery which never happened is the failure nobody notices.
await new Promise((resolve) => {
  const { X, calls } = load({ hostReply: () => ({ ok: true, reply: { ok: true, result: { added: 1 } } }) });
  X.runCustom(
    { steps: [{ type: 'suite', value: '{"app":"zcite","verb":"item.add","args":{"title":"{q}"}}' }] },
    'a "quoted" title\\with a backslash',
    (err) => {
      check('a suite step reaches the host as suite_call with app/verb/args', () => {
        assert.equal(err, null, `suite step failed: ${err}`);
        const req = calls.filter((c) => c.kind === 'host').map((c) => c.req).find((r) => r.cmd === 'suite_call');
        assert.ok(req, 'no suite_call was issued');
        assert.equal(req.app, 'zcite');
        assert.equal(req.verb, 'item.add');
        // Raw splicing would have produced invalid JSON and thrown before any request was sent;
        // arriving here with the exact text proves the escape happened.
        assert.equal(req.args.title, 'a "quoted" title\\with a backslash');
      });
      resolve();
    },
  );
});

await new Promise((resolve) => {
  const { X, calls } = load({
    hostReply: (req) => (req.cmd === 'suite_call'
      ? { ok: true, reply: { ok: false, err: 'zcite: not running on the bus' } }
      : { ok: true, reply: { ok: true } }),
  });
  X.runCustom({
    steps: [
      { type: 'suite', value: '{"app":"zcite","verb":"item.add","args":{}}' },
      { type: 'shell', value: 'never' },
    ],
  }, '', (err) => {
    check('a peer that is not running fails the step and stops the chain', () => {
      assert.ok(err, 'an unreachable app must be reported as a step failure');
      assert.match(err, /not running on the bus/);
      const execs = calls.filter((c) => c.kind === 'host' && c.req.cmd === 'exec');
      assert.equal(execs.length, 0, 'the chain continued past a delivery that never happened');
    });
    resolve();
  });
});

/* ---- 9. a suite step inside a self-reverting chain is class-checked by the host ------------ */
// zwire's journal holds zwire's writes; it cannot compensate one that landed in another process.
// The step must therefore travel as a bus `call` (so the host's REV table refuses it) rather than
// take the direct path and run unjournaled inside a chain that claims it can revert.
await new Promise((resolve) => {
  const { X, calls } = load({
    hostReply: (req) => (req.cmd === 'call'
      ? { ok: true, reply: { ok: false, err: 'verb not reversible: suite_call' } }
      : { ok: true, reply: { ok: true, txn: 1, steps: 0 } }),
  });
  X.runTxn({ steps: [{ type: 'suite', value: '{"app":"zcite","verb":"item.add","args":{}}' }] }, '', (err) => {
    check('a transacted suite step is routed through the host gate and refused', () => {
      assert.ok(err, 'an irreversible cross-app step must fail inside a transaction');
      const reqs = calls.filter((c) => c.kind === 'host').map((c) => c.req);
      const direct = reqs.filter((r) => r.cmd === 'suite_call');
      assert.equal(direct.length, 0, 'the suite step bypassed the transaction gate');
      const gated = reqs.find((r) => r.cmd === 'call' && r.verb === 'suite_call');
      assert.ok(gated, 'the suite step did not become a class-checked bus call');
      assert.equal(reqs[reqs.length - 1].cmd, 'txn_abort', 'a refused chain must abort');
    });
    resolve();
  });
});

/* ---- 10. a postcondition over the rendered page gates the chain ---------------------------- */
// The `assert` step asks zwire-host to project the LIVE dom and test a predicate against it
// (page.rs). Outside a transaction it is a plain `page_get` naming `page.assert`; what matters is
// that it is a real step with a real verdict, not a toast.
await new Promise((resolve) => {
  const { X, calls } = load({ hostReply: () => ({ ok: true, reply: { ok: true, assert: true, pass: true } }) });
  X.runCustom({
    steps: [
      { type: 'assert', value: '{"state":"page.text","op":"contains","value":"{q}"}' },
      { type: 'shell', value: 'after' },
    ],
  }, 'Order "confirmed"', (err) => {
    check('a satisfied postcondition lets the chain continue', () => {
      assert.equal(err, null, `assert step failed: ${err}`);
      const req = calls.filter((c) => c.kind === 'host').map((c) => c.req).find((r) => r.cmd === 'page_get');
      assert.ok(req, 'no page_get was issued');
      assert.equal(req.state, 'page.assert');
      assert.equal(req.args.state, 'page.text');
      assert.equal(req.args.op, 'contains');
      // {q} is spliced JSON-ESCAPED, like the suite step: a match off a live page carries quotes.
      assert.equal(req.args.value, 'Order "confirmed"');
      assert.equal(calls.filter((c) => c.kind === 'host' && c.req.cmd === 'exec').length, 1, 'the following step did not run');
    });
    resolve();
  });
});

await new Promise((resolve) => {
  const { X, calls } = load({
    hostReply: (req) => (req.cmd === 'page_get'
      ? { ok: true, reply: { ok: false, assert: true, pass: false, err: 'assertion failed: page.text contains "Order confirmed"' } }
      : { ok: true, reply: { ok: true } }),
  });
  X.runCustom({
    steps: [
      { type: 'assert', value: '{"state":"page.text","op":"contains","value":"Order confirmed"}' },
      { type: 'shell', value: 'never' },
    ],
  }, '', (err) => {
    check('a page that fails the postcondition stops the chain', () => {
      assert.ok(err, 'a false postcondition must be reported as a step failure');
      assert.match(err, /assertion failed/);
      assert.equal(calls.filter((c) => c.kind === 'host' && c.req.cmd === 'exec').length, 0,
        'the chain continued past a page that did not satisfy its postcondition');
    });
    resolve();
  });
});

/* ---- 11. THE POINT: a false postcondition ABORTS the transaction it is inside -------------- */
// Two things have to be true at once, and each is easy to lose on its own: `page.assert` must be
// allowed INSIDE the transaction (it is `pure` — reading a page changes nothing), and its `ok:false`
// must reach the executor as a failed step so the chain aborts. Between them they are what makes
// the commit decision a fact about what the browser rendered rather than about what returned.
await new Promise((resolve) => {
  const { X, calls } = load({
    hostReply: (req) => {
      if (req.cmd !== 'call') return { ok: true, reply: { ok: true, txn: 1, steps: 1 } };
      // The host's `call` ENVELOPE is ok:true whenever the frame was accepted and journaled; the
      // verb's own verdict is inside `result`. This shape is exactly what a failed postcondition
      // looks like on the wire, and reading only the envelope would commit the chain.
      return req.verb === 'page.assert'
        ? { ok: true, reply: { ok: true, result: { ok: false, assert: true, pass: false, err: 'assertion failed: page.text contains "Order confirmed"' } } }
        : { ok: true, reply: { ok: true, result: { ok: true } } };
    },
  });
  X.runTxn({
    steps: [
      { type: 'action', value: 'newTab' },
      { type: 'assert', value: '{"state":"page.text","op":"contains","value":"Order confirmed"}' },
      { type: 'action', value: 'pinTab' },
    ],
  }, '', (err) => {
    check('a transacted chain whose page fails its postcondition aborts and unwinds', () => {
      assert.ok(err, 'a false postcondition inside a transaction must fail the chain');
      assert.match(err, /assertion failed/);
      const reqs = calls.filter((c) => c.kind === 'host').map((c) => c.req);
      const gated = reqs.find((r) => r.cmd === 'call' && r.verb === 'page.assert');
      assert.ok(gated, 'the assert step did not travel as a class-checked bus call');
      assert.equal(gated.txn, reqs[0].txn, 'the postcondition must run inside the open transaction');
      assert.ok(!reqs.some((r) => r.cmd === 'call' && r.verb === 'browser.pinTab'),
        'the step after a failed postcondition ran anyway');
      assert.equal(reqs[reqs.length - 1].cmd, 'txn_abort',
        'the transaction committed over a page that did not satisfy its postcondition');
    });
    resolve();
  });
});

/* ---- 12. a PREMISE travels inside the transaction it gates -------------------------------- */
// The mirror of the assert step. `page.witness` declares a fact about the page the chain is
// reasoning about; zwire-host ledgers it and re-reads it at commit (witness.rs). Two things have to
// hold: the step must travel as a class-checked bus `call` inside the OPEN transaction (a premise
// filed outside it gates nothing), and a premise with no `op` must stay the CONTENT form rather
// than being silently turned into a predicate.
await new Promise((resolve) => {
  const { X, calls } = load({
    hostReply: (req) => (req.cmd === 'call'
      ? { ok: true, reply: { ok: true, result: { ok: true, witness: 3 } } }
      : { ok: true, reply: { ok: true, txn: 1, steps: 1 } }),
  });
  X.runTxn({
    steps: [
      { type: 'witness', value: '{"state":"page.tables"}' },
      { type: 'action', value: 'pinTab' },
    ],
  }, '', (err) => {
    check('a premise runs inside the transaction and lets the chain continue', () => {
      assert.equal(err, null, `premise step failed: ${err}`);
      const reqs = calls.filter((c) => c.kind === 'host').map((c) => c.req);
      const gated = reqs.find((r) => r.cmd === 'call' && r.verb === 'page.witness');
      assert.ok(gated, 'the premise did not travel as a class-checked bus call');
      assert.equal(gated.txn, reqs[0].txn, 'the premise was filed outside the transaction it gates');
      assert.equal(gated.args.state, 'page.tables');
      assert.ok(!('op' in gated.args), 'a premise with no op must stay the content form');
      assert.equal(reqs[reqs.length - 1].cmd, 'txn_commit');
    });
    resolve();
  });
});

/* ---- 13. THE POINT: a commit refused over a stale premise is reported as the revert it is -- */
// The host answers a conflicted commit with `ok:false` + `conflict` + the violations, having ALREADY
// unwound the chain. The executor must surface that as a chain failure naming the premise — reading
// it as an ordinary close error would tell the user "txn_commit: …" for a browser that was silently
// rolled back, and reading only the envelope would report success.
await new Promise((resolve) => {
  const { X, calls } = load({
    hostReply: (req) => (req.cmd === 'txn_commit'
      ? {
        ok: true,
        reply: {
          ok: false, conflict: true, aborted: true, steps: 2, premises: 1,
          err: 'commit refused: 1 of 1 premise(s) no longer hold',
          violations: [{ witness: 1, state: 'page.tables', reason: 'changed', err: 'page.tables changed: aaa → bbb' }],
        },
      }
      : { ok: true, reply: { ok: true, result: { ok: true } } }),
  });
  X.runTxn({
    steps: [
      { type: 'witness', value: '{"state":"page.tables"}' },
      { type: 'action', value: 'pinTab' },
    ],
  }, '', (err) => {
    check('a commit refused over a stale premise fails the chain and names the premise', () => {
      assert.ok(err, 'a refused commit must not read as success');
      assert.match(err, /premise/);
      assert.match(err, /page\.tables/, `the violated premise was not named: ${err}`);
      const reqs = calls.filter((c) => c.kind === 'host').map((c) => c.req);
      // The host already unwound; the executor must NOT send a second abort on top of it.
      assert.equal(reqs.filter((r) => r.cmd === 'txn_abort').length, 0,
        'the executor double-unwound a transaction the host had already closed');
    });
    resolve();
  });
});

if (failures) process.stderr.write(`\n${failures} check(s) failed\n`); else process.stdout.write('\nall checks passed\n');
process.exit(failures ? 1 : 0);
