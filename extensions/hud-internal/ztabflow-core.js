/* zwire HUD — tab-flow decision core: snooze, auto-archive, recent-tab (MRU) switching and
 * audio focus. background.js loads it with importScripts and drives the chrome.* side;
 * tests/tabflow.mjs loads the same file headless.
 *
 * Every function here is pure over plain data (tab snapshots, stored lists, a clock), so the
 * decisions that close, reopen, switch or mute tabs are pinned by tests rather than by
 * clicking through a browser.
 *
 *  · SNOOZE (Opera / Workona / Chrome "snooze tab" extensions). A tab is closed now and
 *    reopened at a wake time. The list lives in chrome.storage.local (`zb_snoozed`) as
 *    {url, title, pinned, snoozedAt, wakeAt}; the worker's minute alarm reopens every
 *    entry whose wakeAt has passed. Re-snoozing a url replaces its entry rather than
 *    stacking a second one, so a url wakes exactly once.
 *
 *  · AUTO-ARCHIVE (Arc). Unpinned tabs untouched for longer than a threshold are closed and
 *    recorded in an archive (`zb_archive`, newest first, capped) that the ⌘K palette and the
 *    `browser.restoreArchived` verb reopen from. Unlike hibernation (discard, which keeps the
 *    tab) this removes the tab, so the guard set is the hibernate one — active, pinned,
 *    audible, live capture — minus `discarded`: a discarded idle tab is exactly what should be
 *    archived. The active tab is never a candidate, so a window can never be archived empty.
 *
 *  · RECENT TAB (Vivaldi / Firefox "Ctrl+Tab in recently used order"). An activation-ordered
 *    list of tab ids, most recent first; the switch target is the n-th most recent tab in the
 *    current window that still exists.
 *
 *  · AUDIO FOCUS (Vivaldi "play audio in active tab only"). While on, every audible tab other
 *    than the focused one is muted, and a tab muted BY THIS FEATURE is unmuted when it gets
 *    focus back. A mute or unmute the user made by hand (`mutedInfo.reason === 'user'`) is
 *    never overridden in either direction. */
(function (root) {
  'use strict';

  var MINUTE = 60000;
  var UNIT_MS = { s: 1000, m: MINUTE, h: 60 * MINUTE, d: 24 * 60 * MINUTE, w: 7 * 24 * 60 * MINUTE };
  // The longest snooze accepted. A typo like `1000d` should fail loudly, not park a tab for years.
  var MAX_SNOOZE_MS = 366 * UNIT_MS.d;
  var ARCHIVE_CAP = 200;
  var MRU_CAP = 100;

  /* ---- durations ---------------------------------------------------------------------- */

  // "90m", "2h", "1h30m", "1.5d", "1w", or a bare number of minutes → milliseconds.
  // Anything else (empty, zero, negative, unknown unit, trailing junk) → null.
  function parseDuration(spec) {
    if (typeof spec === 'number') return spec > 0 && isFinite(spec) ? Math.round(spec * MINUTE) : null;
    var s = String(spec == null ? '' : spec).trim().toLowerCase().replace(/\s+/g, '');
    if (!s) return null;
    if (/^\d+(\.\d+)?$/.test(s)) return parseDuration(parseFloat(s));
    var re = /(\d+(?:\.\d+)?)([smhdw])/g, total = 0, used = 0, m;
    while ((m = re.exec(s)) !== null) {
      if (m.index !== used) return null;   // junk between terms
      total += parseFloat(m[1]) * UNIT_MS[m[2]];
      used = re.lastIndex;
    }
    if (used !== s.length || total <= 0) return null;
    return Math.round(total);
  }

  // The next local `hour`:00 strictly after `now` on a LATER calendar day ("tomorrow 9am").
  function tomorrowAt(now, hour) {
    var d = new Date(now);
    d.setDate(d.getDate() + 1);
    d.setHours(hour, 0, 0, 0);
    return d.getTime();
  }

  // Resolve a snooze request {duration?, until?} to an absolute wake time, or null.
  // `until` may be epoch ms, an ISO/Date.parse string, or the word "tomorrow" (09:00 local).
  // A wake time that is not in the future, or further out than MAX_SNOOZE_MS, is rejected.
  function wakeTime(req, now) {
    req = req || {};
    var at = null;
    if (req.until != null && req.until !== '') {
      if (typeof req.until === 'number') at = req.until;
      else if (String(req.until).trim().toLowerCase() === 'tomorrow') at = tomorrowAt(now, 9);
      else { var p = Date.parse(String(req.until)); at = isNaN(p) ? null : p; }
    } else {
      var ms = parseDuration(req.duration == null ? '1h' : req.duration);
      at = ms == null ? null : now + ms;
    }
    if (at == null || !isFinite(at) || at <= now || at - now > MAX_SNOOZE_MS) return null;
    return at;
  }

  /* ---- shared tab predicates ---------------------------------------------------------- */

  // A url worth recording: something a later tabs.create can bring back and that is not an
  // empty new-tab page. Closing a blank tab loses nothing, so it is never listed.
  function isRestorableUrl(url) {
    if (!url || typeof url !== 'string') return false;
    if (/^(about:blank|chrome:\/\/newtab|chrome-search:\/\/|javascript:)/i.test(url)) return false;
    return /^[a-z][a-z0-9+.-]*:/i.test(url);
  }

  // Live-capture state is the hibernate core's decision (zhibernate-core.js, loaded first) —
  // one definition of "this tab holds a call", shared by every sweep that removes tabs.
  function isCaptureLive(captureByTab, tabId) {
    var H = root.ZWIRE_HIBERNATE;
    if (!H) throw new Error('ztabflow-core: zhibernate-core.js must load first');
    return H.isCaptureLive(captureByTab, tabId);
  }

  // When a tab was last used: Chrome's own `lastAccessed` (survives a worker restart) wins
  // over the worker's in-memory activation map; neither → unknown (null).
  function lastUsed(tab, lastActive) {
    if (typeof tab.lastAccessed === 'number' && tab.lastAccessed > 0) return tab.lastAccessed;
    var la = lastActive && lastActive[tab.id];
    return typeof la === 'number' ? la : null;
  }

  /* ---- snooze ------------------------------------------------------------------------- */

  // The stored record for snoozing `tab` until `wakeAt`, or null when the tab has nothing to
  // bring back (blank / new-tab page).
  function snoozeEntry(tab, wakeAt, now) {
    if (!tab || !isRestorableUrl(tab.url)) return null;
    return { url: tab.url, title: tab.title || tab.url, pinned: !!tab.pinned, snoozedAt: now, wakeAt: wakeAt };
  }

  // Add entries to the snooze list: one entry per url (the newer request wins), ordered by
  // wake time so the list reads as a schedule.
  function snoozeAdd(list, entries) {
    var byUrl = Object.create(null);
    (list || []).concat(entries || []).forEach(function (e) { if (e && e.url) byUrl[e.url] = e; });
    return Object.keys(byUrl).map(function (u) { return byUrl[u]; })
      .sort(function (a, b) { return a.wakeAt - b.wakeAt; });
  }

  // Split the list into what wakes now and what keeps sleeping. `all` wakes everything.
  function snoozeDue(list, now, all) {
    var due = [], rest = [];
    (list || []).forEach(function (e) { if (!e || !e.url) return; (all || e.wakeAt <= now ? due : rest).push(e); });
    return { due: due, rest: rest };
  }

  /* ---- auto-archive ------------------------------------------------------------------- */

  // Ids of tabs idle longer than `thresholdMs` that may be closed into the archive.
  function archivableTabIds(tabs, lastActive, now, thresholdMs, captureByTab) {
    if (!(thresholdMs > 0)) return [];
    return (tabs || []).filter(function (t) {
      if (!t || t.id == null || t.active || t.pinned || t.audible) return false;
      if (isCaptureLive(captureByTab, t.id)) return false;
      var used = lastUsed(t, lastActive);
      return used != null && (now - used) > thresholdMs;
    }).map(function (t) { return t.id; });
  }

  // Prepend closed tabs to the archive, newest first, one entry per url, capped.
  function archivePush(list, tabs, now, cap) {
    var fresh = (tabs || []).filter(function (t) { return t && isRestorableUrl(t.url); })
      .map(function (t) { return { url: t.url, title: t.title || t.url, archivedAt: now }; });
    var seen = Object.create(null), out = [];
    fresh.concat(list || []).forEach(function (e) {
      if (!e || !e.url || seen[e.url]) return;
      seen[e.url] = true; out.push(e);
    });
    return out.slice(0, cap || ARCHIVE_CAP);
  }

  // Take one entry out of a stored list (archive or snooze): by `url` when given, else by
  // `index` (0 = first).
  // → {entry, rest}; entry is null when nothing matches.
  function takeEntry(list, sel) {
    list = list || []; sel = sel || {};
    var i = -1;
    if (sel.url) i = list.findIndex(function (e) { return e && e.url === sel.url; });
    else { var n = sel.index == null ? 0 : Number(sel.index); if (Number.isInteger(n) && n >= 0 && n < list.length) i = n; }
    if (i < 0) return { entry: null, rest: list.slice() };
    return { entry: list[i], rest: list.slice(0, i).concat(list.slice(i + 1)) };
  }

  /* ---- recent tab (MRU) --------------------------------------------------------------- */

  function mruTouch(list, tabId, cap) {
    var out = [tabId];
    (list || []).forEach(function (id) { if (id !== tabId) out.push(id); });
    return out.slice(0, cap || MRU_CAP);
  }

  function mruDrop(list, tabId) {
    return (list || []).filter(function (id) { return id !== tabId; });
  }

  // Merge a list restored from storage under the one built since the worker woke: live
  // activations stay on top, restored history fills in below.
  function mruMerge(live, restored, cap) {
    var seen = Object.create(null), out = [];
    (live || []).concat(restored || []).forEach(function (id) { if (!seen[id]) { seen[id] = true; out.push(id); } });
    return out.slice(0, cap || MRU_CAP);
  }

  // The tab to switch to: the n-th (1 = previous) most recently used tab among `windowTabIds`
  // other than `currentId`. Tabs in the window the list has never seen are not candidates.
  function mruTarget(list, currentId, windowTabIds, n) {
    var alive = Object.create(null);
    (windowTabIds || []).forEach(function (id) { alive[id] = true; });
    var cands = (list || []).filter(function (id) { return id !== currentId && alive[id]; });
    var k = n == null ? 1 : Number(n);
    if (!Number.isInteger(k) || k < 1 || !cands.length) return null;
    return cands[Math.min(k, cands.length) - 1];
  }

  /* ---- audio focus -------------------------------------------------------------------- */

  function userSet(t) { return !!(t.mutedInfo && t.mutedInfo.reason === 'user'); }
  function isMuted(t) { return !!(t.mutedInfo && t.mutedInfo.muted); }

  // What to mute and unmute so only `focusId` plays. `autoMuted` is the set of ids this
  // feature muted earlier; the plan returns its successor.
  function audioFocusPlan(tabs, focusId, autoMuted) {
    var byId = Object.create(null);
    (tabs || []).forEach(function (t) { if (t && t.id != null) byId[t.id] = t; });
    var mine = Object.create(null);
    (autoMuted || []).forEach(function (id) {
      var t = byId[id];
      if (t && isMuted(t) && !userSet(t)) mine[id] = true;   // gone, or the user took it over → forget
    });
    var mute = [], unmute = [];
    Object.keys(byId).forEach(function (k) {
      var t = byId[k];
      if (t.id === focusId) {
        if (mine[t.id]) { unmute.push(t.id); delete mine[t.id]; }
      } else if (t.audible && !isMuted(t) && !userSet(t)) {
        mute.push(t.id); mine[t.id] = true;
      }
    });
    return { mute: mute, unmute: unmute, autoMuted: Object.keys(mine).map(Number) };
  }

  // Turning the feature off: give back every mute it still owns.
  function audioFocusRelease(tabs, autoMuted) {
    var owned = Object.create(null);
    (autoMuted || []).forEach(function (id) { owned[id] = true; });
    return (tabs || []).filter(function (t) { return t && owned[t.id] && isMuted(t) && !userSet(t); })
      .map(function (t) { return t.id; });
  }

  root.ZWIRE_TABFLOW = {
    ARCHIVE_CAP: ARCHIVE_CAP,
    parseDuration: parseDuration,
    tomorrowAt: tomorrowAt,
    wakeTime: wakeTime,
    isRestorableUrl: isRestorableUrl,
    snoozeEntry: snoozeEntry,
    snoozeAdd: snoozeAdd,
    snoozeDue: snoozeDue,
    archivableTabIds: archivableTabIds,
    archivePush: archivePush,
    takeEntry: takeEntry,
    mruTouch: mruTouch,
    mruDrop: mruDrop,
    mruMerge: mruMerge,
    mruTarget: mruTarget,
    audioFocusPlan: audioFocusPlan,
    audioFocusRelease: audioFocusRelease
  };
})(typeof self !== 'undefined' ? self : this);
