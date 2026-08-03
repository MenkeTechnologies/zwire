/* zwire HUD — output triggers. User-defined regexes matched against page text as it
 * renders/streams (the browser analog of zterminal's terminal-output triggers). On a
 * match a trigger runs a CHAIN of typed steps — shell / stryke / js / applescript /
 * batch / action / scheme / host / url — the identical step set a ⌘K command runs, via
 * the shared executor zpalette.js exports as window.ZWIRE_CMD_EXEC. The matched line is
 * passed as the argument, so {q} in any step expands to it.
 *
 * A trigger may be SELF-REVERTING (`revert`): its chain then runs inside a zwire-host transaction,
 * and if any step fails the host replays the inverse of every step that already ran. The steps are
 * run one at a time for exactly this reason — a failure has to be observed before the next step
 * starts, or there is no "partial" for the revert to act on.
 *
 * Triggers are managed on pages/triggers.js and stored in chrome.storage.local
 * 'zb_triggers'. This content script runs on real web pages only (http/https/file — the
 * manifest group excludes the HUD's own extension pages). Matching is throttled and
 * line-capped; each trigger has its own cooldown so a burst of matching output can't
 * spawn a process storm, and a "once per page" trigger fires at most once per page load
 * (resets on the next full navigation, when this content script reloads). */
(function () {
  'use strict';
  var KEY = 'zb_triggers';
  // Cap lines scanned per flush so a huge DOM burst can't stall the page.
  var MAX_SCAN_LINES = 2000;
  // Coalesce mutation bursts — scan at most this often.
  var FLUSH_MS = 350;
  // Ignore absurdly long "lines" (minified blobs, base64) — they aren't real output.
  var MAX_LINE_LEN = 4000;
  // Text injected by zwire's own HUD UI must never be scanned: the ⌘K command-palette
  // overlay (its command names/values), and toasts (a trigger's OWN result toast) would
  // otherwise match and re-fire — a command-palette false match / a feedback loop.
  var ZWIRE_UI_SEL = '.palette-overlay,.zs-toast-container,.zs-toast,[data-zwire-ui]';
  function isZwireUi(node) {
    try {
      var e = node && (node.nodeType === 1 ? node : node.parentElement);
      return !!(e && e.closest && e.closest(ZWIRE_UI_SEL));
    } catch (x) { return false; }
  }

  var compiled = [];   // { id, name, regex, urlRe, cooldownMs, once, lastFired, steps }
  // Ids of once-per-page triggers that have already fired this page load. Module-level
  // so it survives recompile() (an unrelated storage edit must not re-arm a trigger);
  // it resets naturally because the content script reloads on a full navigation.
  var firedOnce = {};
  var observer = null;
  var pending = [];    // queued text chunks awaiting a flush
  var flushTimer = null;

  // Strip 'g'/'y' from the flag string: .test() with a sticky/global regex advances
  // lastIndex and would skip matches on the next line. Default to case-insensitive.
  function normFlags(f) {
    var out = (f || 'i').replace(/[gy]/g, '');
    return out || '';
  }
  function compileOne(t) {
    if (!t || t.enabled === false || !t.pattern) return null;
    var regex;
    try { regex = new RegExp(t.pattern, normFlags(t.flags)); } catch (e) { return null; }
    var urlRe = null;
    if (t.urls && String(t.urls).trim()) {
      try { urlRe = new RegExp(t.urls, 'i'); } catch (e) { return null; }  // invalid URL filter → drop, like a bad pattern
    }
    var cd = Number(t.cooldownMs);
    return {
      id: t.id, name: t.name || t.id, regex: regex, urlRe: urlRe,
      cooldownMs: isFinite(cd) && cd >= 0 ? cd : 1500,
      once: !!t.once, revert: !!t.revert, lastFired: 0, steps: t.steps || []
    };
  }
  function recompile(list) {
    compiled = (list || []).map(compileOne).filter(Boolean);
    // Restrict to triggers whose URL filter (if any) matches this page — a page that
    // can never match any trigger never attaches an observer.
    var href = location.href;
    var live = compiled.filter(function (c) { return !c.urlRe || c.urlRe.test(href); });
    if (live.length) start(); else stop();
    compiled = live;
  }

  // Split a text chunk into candidate lines: trimmed, non-empty, length-capped.
  function linesOf(text) {
    if (!text) return [];
    var out = [];
    String(text).split(/\r?\n/).forEach(function (raw) {
      var s = raw.trim();
      if (s && s.length <= MAX_LINE_LEN) out.push(s);
    });
    return out;
  }

  // Run the trigger's chain. A `revert` trigger runs it as ONE host transaction: every journaled
  // step is undone if any step fails, so a trigger that fires unattended cannot leave the browser
  // half-changed. A trigger fires on page text nobody is watching — it is the one automation where
  // a partially-applied chain is discovered hours later, which is why the transaction lives here
  // and not only behind a ⌘K keystroke a human is present for.
  //
  // The failure is reported, not swallowed: `runTxn`/`runCustom` hand back the first step's error,
  // and the previous fire-and-forget call discarded it along with any chance of reverting.
  function fire(c, line) {
    c.lastFired = Date.now();
    try {
      var X = window.ZWIRE_CMD_EXEC;
      if (!X) return;
      function reported(err) {
        if (err) { try { console.warn('zwire trigger "' + c.name + '": ' + err); } catch (x) {} }
      }
      if (c.revert && X.runTxn) { X.runTxn({ steps: c.steps }, line, reported); return; }
      if (X.runCustom) X.runCustom({ steps: c.steps }, line, reported);
    } catch (e) {}
  }

  // Match the queued lines against every enabled trigger. At most one hit per trigger
  // per flush; a trigger in its cooldown window is skipped (prevents a storm).
  function flush() {
    flushTimer = null;
    if (!compiled.length || !pending.length) { pending = []; return; }
    var chunks = pending; pending = [];
    var lines = [];
    for (var i = 0; i < chunks.length && lines.length < MAX_SCAN_LINES; i++) {
      var ls = linesOf(chunks[i]);
      for (var j = 0; j < ls.length && lines.length < MAX_SCAN_LINES; j++) lines.push(ls[j]);
    }
    if (!lines.length) return;
    var now = Date.now();
    for (var t = 0; t < compiled.length; t++) {
      var c = compiled[t];
      if (c.once && firedOnce[c.id]) continue;             // one fire per page load
      if (now - c.lastFired < c.cooldownMs) continue;
      for (var k = 0; k < lines.length; k++) {
        if (c.regex.test(lines[k])) { if (c.once) firedOnce[c.id] = true; fire(c, lines[k]); break; }
      }
    }
  }
  function scheduleFlush() {
    if (flushTimer) return;
    flushTimer = setTimeout(flush, FLUSH_MS);
  }
  function enqueue(text) {
    if (!text) return;
    pending.push(text);
    scheduleFlush();
  }

  function start() {
    if (observer) return;
    // Initial one-shot scan of what's already rendered.
    try { enqueue((document.body || document.documentElement).innerText || ''); } catch (e) {}
    observer = new MutationObserver(function (muts) {
      for (var i = 0; i < muts.length; i++) {
        var m = muts[i];
        if (isZwireUi(m.target)) continue;                                     // skip zwire's own HUD UI
        if (m.type === 'characterData') { enqueue(m.target && m.target.nodeValue); continue; }
        for (var a = 0; a < m.addedNodes.length; a++) {
          var n = m.addedNodes[a];
          if (isZwireUi(n)) continue;
          if (n.nodeType === 3) enqueue(n.nodeValue);                          // text node
          else if (n.nodeType === 1) enqueue(n.innerText || n.textContent);    // element subtree
        }
      }
    });
    try { observer.observe(document.documentElement || document, { subtree: true, childList: true, characterData: true }); } catch (e) {}
  }
  function stop() {
    if (observer) { try { observer.disconnect(); } catch (e) {} observer = null; }
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
    pending = [];
  }

  function load() {
    try { chrome.storage.local.get(KEY, function (o) { void chrome.runtime.lastError; recompile(o && o[KEY]); }); }
    catch (e) {}
  }
  try {
    chrome.storage.onChanged.addListener(function (ch, area) {
      if (area === 'local' && ch[KEY]) recompile(ch[KEY].newValue || []);
    });
  } catch (e) {}

  // Wait for a body before the initial scan; storage load can happen immediately.
  if (document.body) load();
  else document.addEventListener('DOMContentLoaded', load, { once: true });
})();
