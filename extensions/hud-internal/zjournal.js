/* zwire HUD — the browser-side transaction journal.
 *
 * This is the half of transactional compensation that zwire-host explicitly does NOT own. The host
 * (native/zwire-host `txn.rs`) owns the ORDER: one monotonic `seq` clock across every open
 * transaction, and the reversibility class of each verb (`zbus.rs` REV). It cannot own the PRE-STATE,
 * because a `browser.*` forward call is fire-and-forget across the native port — the reply carries a
 * delivery count, not a browser result. So the pre-state is captured HERE, at execution time, keyed by
 * the `_seq` the host stamps onto the forwarded action, and an abort arrives as ONE `browser.undo`
 * frame carrying the reversed step list for the whole transaction.
 *
 * HOW THE PRE-STATE IS CAPTURED — by OBSERVING EFFECTS, not by re-deriving them.
 *
 * The naive design mirrors each verb's selection logic in a capture function ("closeRight closes the
 * tabs after the active one, so snapshot those"). That duplicates every branch of execZbCmd and drifts
 * the moment one is edited. Instead this module snapshots the tab set, runs the action, and listens to
 * the real `chrome.tabs` / `chrome.windows` events it produces. Whatever the browser actually did is
 * what gets journaled, so the inverse is correct by construction for `closeDuplicates`, `sortTabs`, a
 * future verb, or a branch someone rewrites — none of which this file knows anything about.
 *
 * Consequently there is no verb table here. The host's REV table is the single source of truth for
 * WHICH verbs are journaled: it stamps `_txn`/`_seq` only onto `inverse` verbs, and this module
 * journals exactly the actions that carry a `_seq`.
 *
 * Effects are collected for SETTLE_MS after the action is dispatched, because execZbCmd is
 * callback-based and its writes land asynchronously. The persistent native port keeps the MV3 worker
 * alive across that window; the journal is also written through to chrome.storage so an abort still
 * unwinds after a worker teardown.
 *
 * Inverse step vocabulary (what an abort replays, in reverse):
 *
 *   { op:'reopen',      url, index, windowId, pinned, muted }   a tab that was closed
 *   { op:'close',       id, windowId }                          a tab that was created
 *   { op:'closeWindow', id }                                    a window that was created
 *   { op:'move',        id, index, windowId }                   a tab that moved (prior position)
 *   { op:'flags',       id, pinned? , muted? }                  a pinned/muted flag that flipped
 *   { op:'activate',    id }                                    the tab that was active before
 *   { op:'navigate',    id, url }                               the url the tab was showing
 *   { op:'zoom',        id, factor }                            the zoom factor it had
 *
 * Exposed as `self.ZB_JOURNAL`; background.js arms it around a `_seq`-stamped action, forwards the
 * chrome events into `on.*`, and routes the `undo` action here.
 */
(function (root, chrome) {
  'use strict';

  // How long after dispatch we keep attributing effects to the armed step. execZbCmd's writes are
  // callbacks on top of chrome.tabs.query, so a same-tick window would miss all of them.
  var SETTLE_MS = 400;
  // Ceilings so a runaway script cannot grow the journal without bound.
  var MAX_STEPS_PER_SEQ = 500;
  var MAX_SEQS = 2000;

  var steps = Object.create(null);   // seq (as string) -> [inverse step] in observation order
  var order = [];                    // seq keys in insertion order, for the MAX_SEQS eviction
  var armed = null;                  // { seq, before:{tabs,active}, seen:{} } while a step is running

  function err(e) { return String((e && e.message) || e); }

  function lastError() {
    try { return chrome.runtime && chrome.runtime.lastError; } catch (e) { return null; }
  }

  /* ---- persistence: survive an MV3 worker teardown mid-transaction ---- */

  function persist() {
    try { chrome.storage.local.set({ zb_journal: steps }); } catch (e) {}
  }

  function hydrate(done) {
    try {
      chrome.storage.local.get('zb_journal', function (o) {
        void lastError();
        var saved = o && o.zb_journal;
        if (saved) {
          Object.keys(saved).forEach(function (k) {
            if (steps[k]) return;                     // a live entry always beats a persisted one
            steps[k] = saved[k];
            order.push(k);
          });
        }
        if (done) done();
      });
    } catch (e) { if (done) done(); }
  }

  /* ---- capture ---- */

  // Every tab, plus which tab is active per window — the two things an effect event cannot tell us
  // after the fact (a removed tab's descriptor is gone; the previously-active tab is not in onActivated).
  function snapshot(done) {
    var tabs = Object.create(null), active = Object.create(null);
    try {
      chrome.tabs.query({}, function (all) {
        void lastError();
        (all || []).forEach(function (t) {
          if (t == null || t.id == null) return;
          tabs[t.id] = {
            id: t.id,
            url: t.url || t.pendingUrl || '',
            index: t.index,
            windowId: t.windowId,
            pinned: !!t.pinned,
            muted: !!(t.mutedInfo && t.mutedInfo.muted),
          };
          if (t.active) active[t.windowId] = t.id;
        });
        done({ tabs: tabs, active: active });
      });
    } catch (e) { done({ tabs: tabs, active: active }); }
  }

  // File one inverse step under the armed seq. `key` dedupes: the FIRST observation of an effect holds
  // the true pre-state, so a second event for the same tab+aspect (two updates in one action) is dropped
  // rather than overwriting the pre-state with an already-changed value.
  function record(step, key) {
    if (!armed) return;
    if (armed.seen[key]) return;
    armed.seen[key] = 1;
    var k = String(armed.seq);
    var list = steps[k];
    if (!list) {
      list = steps[k] = [];
      order.push(k);
      while (order.length > MAX_SEQS) { delete steps[order.shift()]; }
    }
    if (list.length < MAX_STEPS_PER_SEQ) list.push(step);
  }

  // Snapshot, run the action, and collect its effects for SETTLE_MS. `c` is the forwarded action
  // (`{a, _txn, _seq, …}`); `run` dispatches it through the normal executor.
  function arm(c, run) {
    var seq = c && c._seq;
    if (seq == null) { run(); return; }
    snapshot(function (before) {
      armed = { seq: seq, before: before, seen: Object.create(null) };
      try { run(); } catch (e) {}
      setTimeout(function () {
        if (armed && armed.seq === seq) armed = null;
        persist();
      }, SETTLE_MS);
    });
  }

  /* ---- effect hooks: background.js forwards the real chrome events here ---- */

  var on = {
    tabRemoved: function (tabId) {
      var was = armed && armed.before.tabs[tabId];
      if (!was) return;
      record({ op: 'reopen', url: was.url, index: was.index, windowId: was.windowId,
               pinned: was.pinned, muted: was.muted }, 'reopen:' + tabId);
    },
    tabCreated: function (tab) {
      if (!tab || tab.id == null) return;
      record({ op: 'close', id: tab.id, windowId: tab.windowId }, 'close:' + tab.id);
    },
    // onMoved/onDetached carry their own pre-state (fromIndex / oldPosition), which is authoritative
    // even when the tab moved more than once.
    tabMoved: function (tabId, info) {
      if (!info) return;
      record({ op: 'move', id: tabId, index: info.fromIndex, windowId: info.windowId }, 'move:' + tabId);
    },
    tabDetached: function (tabId, info) {
      if (!info) return;
      record({ op: 'move', id: tabId, index: info.oldPosition, windowId: info.oldWindowId }, 'move:' + tabId);
    },
    tabUpdated: function (tabId, change) {
      var was = armed && armed.before.tabs[tabId];
      if (!was || !change) return;
      if (change.pinned !== undefined) record({ op: 'flags', id: tabId, pinned: was.pinned }, 'pinned:' + tabId);
      if (change.mutedInfo !== undefined) record({ op: 'flags', id: tabId, muted: was.muted }, 'muted:' + tabId);
      if (change.url !== undefined && change.url !== was.url) {
        record({ op: 'navigate', id: tabId, url: was.url }, 'url:' + tabId);
      }
    },
    tabActivated: function (info) {
      if (!info || !armed) return;
      var prev = armed.before.active[info.windowId];
      if (prev == null || prev === info.tabId) return;
      record({ op: 'activate', id: prev }, 'activate:' + info.windowId);
    },
    tabZoom: function (info) {
      if (!info || info.tabId == null) return;
      record({ op: 'zoom', id: info.tabId, factor: info.oldZoomFactor }, 'zoom:' + info.tabId);
    },
    windowCreated: function (w) {
      if (!w || w.id == null) return;
      record({ op: 'closeWindow', id: w.id }, 'win:' + w.id);
    },
  };

  /* ---- replay ---- */

  function runOp(o, next) {
    function fin() { var e = lastError(); next(e ? err(e) : null); }
    try {
      if (o.op === 'reopen') {
        chrome.tabs.create({ url: o.url, index: o.index, windowId: o.windowId,
                             pinned: !!o.pinned, active: false }, function (t) {
          var e = lastError();
          if (e) { next(err(e)); return; }
          if (o.muted && t && t.id != null) {
            chrome.tabs.update(t.id, { muted: true }, function () { void lastError(); next(null); });
            return;
          }
          next(null);
        });
      } else if (o.op === 'close') {
        chrome.tabs.remove(o.id, fin);
      } else if (o.op === 'closeWindow') {
        chrome.windows.remove(o.id, fin);
      } else if (o.op === 'move') {
        chrome.tabs.move(o.id, { index: o.index, windowId: o.windowId }, fin);
      } else if (o.op === 'flags') {
        var props = {};
        if (o.pinned !== undefined) props.pinned = !!o.pinned;
        if (o.muted !== undefined) props.muted = !!o.muted;
        chrome.tabs.update(o.id, props, fin);
      } else if (o.op === 'activate') {
        chrome.tabs.update(o.id, { active: true }, fin);
      } else if (o.op === 'navigate') {
        chrome.tabs.update(o.id, { url: o.url }, fin);
      } else if (o.op === 'zoom') {
        chrome.tabs.setZoom(o.id, o.factor, fin);
      } else {
        next('unknown undo op: ' + o.op);
      }
    } catch (e) { next(err(e)); }
  }

  // Compensate a whole transaction from one `{a:'undo', txn, steps:[{seq,verb,args}]}` frame. The host
  // has already sorted `steps` by DESCENDING seq, so the forward chain unwinds newest-first; within one
  // forward step the observed effects unwind in reverse observation order too.
  //
  // Every op is attempted even after one fails — the same per-step isolation the host and
  // zgui-core's txnAbort give — and each failure is reported rather than stopping the unwind.
  function undo(cmd, done) {
    var frames = (cmd && cmd.steps) || [];
    var ops = [];
    frames.forEach(function (f) {
      var k = String(f && f.seq);
      var got = steps[k] || [];
      for (var i = got.length - 1; i >= 0; i--) ops.push(got[i]);
      delete steps[k];
      var at = order.indexOf(k);
      if (at >= 0) order.splice(at, 1);
    });
    persist();

    // A `newWindow` creates a window AND its first tab. Closing the window takes the tab with it, so
    // the tab's own `close` op would then fail on an id that no longer exists — drop it here rather
    // than report a failure that is really a success.
    var closedWins = Object.create(null);
    ops.forEach(function (o) { if (o.op === 'closeWindow') closedWins[o.id] = 1; });
    ops = ops.filter(function (o) { return !(o.op === 'close' && closedWins[o.windowId]); });

    var failed = [], compensated = 0, i = 0;
    function step() {
      if (i >= ops.length) {
        var report = { ok: true, txn: (cmd && cmd.txn) != null ? cmd.txn : null,
                       steps: frames.length, ops: ops.length,
                       compensated: compensated, failed: failed };
        if (done) done(report);
        return;
      }
      var o = ops[i++];
      runOp(o, function (e) {
        if (e) failed.push({ op: o.op, id: o.id != null ? o.id : null, error: e });
        else compensated++;
        step();
      });
    }
    step();
  }

  /* ---- exactly-once delivery ---- */

  // The host stamps every forwarded browser action with a unique, monotonic `_n` and sends it down
  // more than one transport (the `zbus.action` subscription and the kv the `stryke_run` reply
  // piggybacks) so a chain is never dropped when only one transport is live. That leaves duplicates
  // to handle here: `freshAction` answers true the first time a stamp is seen and false forever
  // after. It lives beside the journal because both deal in the host's `_`-prefixed action metadata,
  // and because a double-executed step would journal a second, already-changed pre-state — the undo
  // would then restore the wrong thing, not merely act twice.
  var seenNonces = Object.create(null);
  var nonceOrder = [];
  var MAX_NONCES = 4096;

  function freshAction(n) {
    var k = String(n);
    if (seenNonces[k]) return false;
    seenNonces[k] = 1;
    nonceOrder.push(k);
    while (nonceOrder.length > MAX_NONCES) { delete seenNonces[nonceOrder.shift()]; }
    return true;
  }

  root.ZB_JOURNAL = {
    arm: arm,
    undo: undo,
    freshAction: freshAction,
    on: on,
    hydrate: hydrate,
    // Test/introspection seams.
    stepsFor: function (seq) { return (steps[String(seq)] || []).slice(); },
    reset: function () {
      steps = Object.create(null); order = []; armed = null;
      seenNonces = Object.create(null); nonceOrder = [];
    },
    isArmed: function () { return armed != null; },
    get SETTLE_MS() { return SETTLE_MS; },
    set SETTLE_MS(v) { SETTLE_MS = v; },
  };
})(typeof self !== 'undefined' ? self : this, typeof chrome !== 'undefined' ? chrome : null);
