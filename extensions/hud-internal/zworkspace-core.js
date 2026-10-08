/* zwire HUD — workspace + tab-group + reading-list decision core. background.js loads it with
 * importScripts and drives the chrome.* side; tests/workspace.mjs loads the same file headless.
 *
 * Every function here is pure over plain data (tab / group / reading-list snapshots, stored
 * lists, a clock), so what a save captures, what a restore rebuilds, which colour a group gets
 * and which article "read next" opens are pinned by tests rather than by clicking a browser.
 *
 *  · WORKSPACES (Vivaldi saved sessions, Edge Workspaces, Chrome saved tab groups). A named
 *    snapshot of one window or every normal window — each tab's url, title and pin, plus every
 *    tab group's title, colour and collapsed state and which tabs it held. Stored in
 *    chrome.storage.local (`zb_workspaces`, newest first, capped). Names are matched by
 *    `workspaceKey` — case and punctuation are not identity — so "Deep Work" and "deep-work"
 *    are one workspace and a re-save replaces it instead of stacking a near-duplicate.
 *
 *  · TAB-GROUP EDITING (Chrome's group context menu: name, colour, close group, move group to
 *    new window). Colours are Chrome's `tabGroups.Color` enum; anything else is rejected rather
 *    than passed through to an API call that would throw.
 *
 *  · READING LIST QUEUE (Chrome reading list "mark as read", Safari "next unread"). The next
 *    article is the OLDEST unread entry — the list is a queue, not a stack — preferring one not
 *    already open in a tab, so "read next" twice opens two different articles. */
(function (root) {
  'use strict';

  var WORKSPACE_CAP = 50;
  var NAME_MAX = 80;
  // chrome.tabGroups.Color, in Chrome's own order (the colour cycle follows it).
  var GROUP_COLORS = ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'];

  /* ---- shared ------------------------------------------------------------------------- */

  // Urls a new tab can be opened on. The new-tab page and blank tabs carry nothing worth saving,
  // and javascript: urls must never be replayed into a tab.
  function isRestorableUrl(url) {
    if (!url || typeof url !== 'string') return false;
    if (/^(about:blank|chrome:\/\/newtab|chrome:\/\/new-tab-page|chrome-search:\/\/|javascript:)/i.test(url)) return false;
    return /^[a-z][a-z0-9+.-]*:/i.test(url);
  }
  function byIndex(a, b) { return (a.index || 0) - (b.index || 0); }

  /* ---- tab groups --------------------------------------------------------------------- */

  function normColor(c) {
    var s = String(c == null ? '' : c).trim().toLowerCase();
    if (s === 'gray') s = 'grey';
    return GROUP_COLORS.indexOf(s) >= 0 ? s : null;
  }

  // The colour a `colorGroup` call should set. An explicit colour must be a real one (null when
  // it is not); no colour cycles to the one after the group's current colour.
  function groupColor(requested, current) {
    if (requested != null && requested !== '') return normColor(requested);
    var i = GROUP_COLORS.indexOf(normColor(current));
    return GROUP_COLORS[(i + 1) % GROUP_COLORS.length];
  }

  // The ids of a group's tabs in strip order — what `closeGroup` removes.
  function groupMembers(tabs, groupId) {
    if (groupId == null || groupId < 0) return [];
    return (tabs || []).filter(function (t) { return t && t.groupId === groupId; })
      .sort(byIndex).map(function (t) { return t.id; });
  }

  /* ---- workspaces --------------------------------------------------------------------- */

  // Identity of a workspace name: lower case, every run of non-alphanumerics folded to one '-'.
  // A name with no letters or digits has no identity and cannot be saved.
  function workspaceKey(name) {
    return String(name == null ? '' : name).replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
  }
  function cleanName(name) {
    var s = String(name == null ? '' : name).replace(/\s+/g, ' ').trim();
    if (s.length > NAME_MAX) s = s.slice(0, NAME_MAX).trim();
    return workspaceKey(s) ? s : null;
  }

  // One window → {tabs:[{url,title,pinned,group}], groups:[{title,color,collapsed}]}, or null when
  // it holds nothing restorable. `group` indexes into `groups` (-1 = ungrouped); groups are listed
  // in strip order of their first tab, so a restore recreates them left to right. A group whose
  // every tab was dropped (all new-tab pages) is dropped with them.
  function snapshotWindow(tabs, groups) {
    var meta = Object.create(null);
    (groups || []).forEach(function (g) { if (g && g.id != null) meta[g.id] = g; });
    var outGroups = [], slot = Object.create(null), outTabs = [];
    (tabs || []).slice().sort(byIndex).forEach(function (t) {
      if (!t || !isRestorableUrl(t.url)) return;
      var gi = -1;
      if (!t.pinned && t.groupId != null && t.groupId >= 0) {
        if (!(t.groupId in slot)) {
          var g = meta[t.groupId] || {};
          slot[t.groupId] = outGroups.length;
          outGroups.push({ title: String(g.title || ''), color: normColor(g.color) || 'grey', collapsed: !!g.collapsed });
        }
        gi = slot[t.groupId];
      }
      outTabs.push({ url: t.url, title: t.title || t.url, pinned: !!t.pinned, group: gi });
    });
    return outTabs.length ? { tabs: outTabs, groups: outGroups } : null;
  }

  // [{tabs, groups}] per window → a workspace record, or null when the name is unusable or no
  // window holds a restorable tab (saving an empty workspace would only shadow a real one).
  function makeWorkspace(name, windows, now) {
    var n = cleanName(name);
    if (!n) return null;
    var wins = (windows || []).map(function (w) { return w && snapshotWindow(w.tabs, w.groups); })
      .filter(Boolean);
    if (!wins.length) return null;
    return { name: n, savedAt: now, windows: wins };
  }

  // Newest first; a save replaces the workspace with the same key; capped.
  function workspaceSave(list, ws) {
    var k = workspaceKey(ws.name);
    var rest = (list || []).filter(function (w) { return w && workspaceKey(w.name) !== k; });
    return [ws].concat(rest).slice(0, WORKSPACE_CAP);
  }

  // Exact key match, else the single workspace whose key starts with the query's key — a script
  // can say "deep" for "Deep Work", but an ambiguous prefix finds nothing rather than a guess.
  function workspaceFind(list, name) {
    var k = workspaceKey(name);
    if (!k) return null;
    var all = (list || []).filter(Boolean);
    for (var i = 0; i < all.length; i++) if (workspaceKey(all[i].name) === k) return all[i];
    var pre = all.filter(function (w) { return workspaceKey(w.name).indexOf(k) === 0; });
    return pre.length === 1 ? pre[0] : null;
  }

  function workspaceRemove(list, name) {
    var hit = workspaceFind(list, name);
    if (!hit) return { removed: null, rest: list || [] };
    return { removed: hit, rest: (list || []).filter(function (w) { return w !== hit; }) };
  }

  // A saved window → what windows.create + tabs.update + tabs.group must do, by tab position in
  // the created window. Pinned tabs come first because Chrome keeps pinned tabs at the front of
  // the strip: creating them anywhere else would shift every group's positions on the pin.
  function restorePlan(win) {
    var tabs = ((win && win.tabs) || []).filter(function (t) { return t && isRestorableUrl(t.url); });
    var ordered = tabs.filter(function (t) { return t.pinned; }).concat(tabs.filter(function (t) { return !t.pinned; }));
    var groups = ((win && win.groups) || []).map(function (g) {
      return { title: String((g && g.title) || ''), color: normColor(g && g.color) || 'grey', collapsed: !!(g && g.collapsed), indices: [] };
    });
    var pinned = [];
    ordered.forEach(function (t, i) {
      if (t.pinned) pinned.push(i);
      else if (t.group >= 0 && groups[t.group]) groups[t.group].indices.push(i);
    });
    return {
      urls: ordered.map(function (t) { return t.url; }),
      pinned: pinned,
      groups: groups.filter(function (g) { return g.indices.length; })
    };
  }

  /* ---- reading list ------------------------------------------------------------------- */

  function sansHash(u) { return String(u || '').split('#')[0]; }

  // The entry "read next" opens: the oldest unread one not already open in a tab. When every
  // unread entry is already open, the oldest of those comes back with `open: true`, so the
  // worker focuses that tab instead of opening a duplicate. null when nothing is unread.
  function nextUnread(entries, openUrls) {
    var open = Object.create(null);
    (openUrls || []).forEach(function (u) { open[sansHash(u)] = true; });
    var unread = (entries || []).filter(function (e) { return e && e.url && !e.hasBeenRead; })
      .sort(function (a, b) { return (a.creationTime || 0) - (b.creationTime || 0); });
    if (!unread.length) return null;
    for (var i = 0; i < unread.length; i++) if (!open[sansHash(unread[i].url)]) return { entry: unread[i], open: false };
    return { entry: unread[0], open: true };
  }

  // The `updateEntry` argument for marking `url` read (`read` true/false, or toggled when it is
  // not a boolean). null when the url has no reading-list entry — updateEntry would reject it.
  function readState(entries, url, read) {
    var e = (entries || []).filter(function (x) { return x && x.url === url; })[0];
    if (!e) return null;
    return { url: e.url, hasBeenRead: typeof read === 'boolean' ? read : !e.hasBeenRead };
  }

  root.ZWIRE_WORKSPACE = {
    WORKSPACE_CAP: WORKSPACE_CAP,
    GROUP_COLORS: GROUP_COLORS,
    isRestorableUrl: isRestorableUrl,
    normColor: normColor,
    groupColor: groupColor,
    groupMembers: groupMembers,
    workspaceKey: workspaceKey,
    cleanName: cleanName,
    snapshotWindow: snapshotWindow,
    makeWorkspace: makeWorkspace,
    workspaceSave: workspaceSave,
    workspaceFind: workspaceFind,
    workspaceRemove: workspaceRemove,
    restorePlan: restorePlan,
    nextUnread: nextUnread,
    readState: readState
  };
})(typeof self !== 'undefined' ? self : this);
