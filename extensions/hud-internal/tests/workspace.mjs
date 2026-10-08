// Workspace / tab-group / reading-list decision core (zworkspace-core.js) — the pure half of
// browser.saveWorkspace / openWorkspace / deleteWorkspace, nameGroup / colorGroup / closeGroup /
// groupToWindow, and readNext / markRead.
//
// A wrong answer here is a workspace that restores its groups over the wrong tabs, a re-save
// that silently keeps two copies, a delete that removes the wrong workspace, a colour Chrome
// rejects, or "read next" opening the same article twice. The worker only applies what these
// functions return, so pinning them pins the behaviour. The last block checks the worker and the
// native host agree on the verb names, so a verb cannot be wired on one side only.
import fs from 'node:fs';
import assert from 'node:assert/strict';

const root = {};
new Function('self', fs.readFileSync(new URL('../zworkspace-core.js', import.meta.url), 'utf8'))(root);
const W = root.ZWIRE_WORKSPACE;
assert.ok(W, 'ZWIRE_WORKSPACE missing');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; return; }
  fail++;
  console.error(`  ✗ ${name}${detail ? ' — ' + detail : ''}`);
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const tab = (id, index, url, extra) => Object.assign({ id, index, url, title: 'T' + id, pinned: false, groupId: -1 }, extra || {});

// ---- group colours: Chrome's enum only ----
{
  check('explicit colour passes', W.groupColor('purple', 'grey') === 'purple');
  check('colour is case/space-insensitive', W.groupColor(' Cyan ', 'grey') === 'cyan');
  check('"gray" spelling maps to Chrome\'s "grey"', W.groupColor('gray', 'blue') === 'grey');
  check('unknown colour is rejected, not passed to tabGroups.update', W.groupColor('magenta', 'grey') === null);
  check('no colour cycles to the next', W.groupColor(undefined, 'grey') === 'blue');
  check('cycle wraps from the last colour', W.groupColor('', 'orange') === 'grey');
  check('cycle from an unknown current starts at the first colour', W.groupColor(null, 'weird') === 'grey');
  check('every cycle step is a real colour and the cycle covers them all',
    (() => { const seen = new Set(); let c = 'grey'; for (let i = 0; i < W.GROUP_COLORS.length; i++) { c = W.groupColor(null, c); seen.add(c); } return seen.size === W.GROUP_COLORS.length; })());
}

// ---- group members: only that group, in strip order ----
{
  const tabs = [tab(1, 2, 'https://a', { groupId: 7 }), tab(2, 0, 'https://b', { groupId: 7 }), tab(3, 1, 'https://c', { groupId: 8 }), tab(4, 3, 'https://d')];
  check('closeGroup closes exactly the group, in strip order', eq(W.groupMembers(tabs, 7), [2, 1]));
  check('an ungrouped tab (-1) closes nothing — never "every ungrouped tab"', eq(W.groupMembers(tabs, -1), []));
  check('null group closes nothing', eq(W.groupMembers(tabs, null), []));
}

// ---- workspace names: one identity per name ----
{
  check('case and punctuation fold', W.workspaceKey('Deep Work') === W.workspaceKey('deep-work') && W.workspaceKey('deep_work!') === 'deep-work');
  check('a name with no letters or digits cannot be saved', W.cleanName('  !!! ') === null && W.cleanName('') === null && W.cleanName(null) === null);
  check('whitespace is collapsed in the stored name', W.cleanName('  deep   work ') === 'deep work');
  check('overlong names are clipped', W.cleanName('x'.repeat(500)).length === 80);
}

// ---- snapshot: what a save captures ----
{
  const tabs = [
    tab(10, 0, 'https://mail.example', { pinned: true }),
    tab(11, 1, 'https://a.example', { groupId: 5 }),
    tab(12, 2, 'chrome://newtab/', { groupId: 5 }),
    tab(13, 3, 'https://b.example', { groupId: 5 }),
    tab(14, 4, 'https://c.example'),
    tab(15, 5, 'chrome://newtab/', { groupId: 9 }),   // a group of nothing but new-tab pages
    tab(16, 6, 'https://d.example', { groupId: 6 }),
  ];
  const groups = [{ id: 6, title: 'later', color: 'red', collapsed: true }, { id: 5, title: 'research', color: 'blue', collapsed: false }, { id: 9, title: 'empty', color: 'green' }];
  const s = W.snapshotWindow(tabs.slice().reverse(), groups);   // input order must not matter
  check('tabs saved in strip order, new-tab pages dropped', eq(s.tabs.map((t) => t.url), ['https://mail.example', 'https://a.example', 'https://b.example', 'https://c.example', 'https://d.example']));
  check('groups listed in strip order of their first tab (not the order tabGroups.query returned)', eq(s.groups.map((g) => g.title), ['research', 'later']));
  check('a group whose every tab was dropped is dropped too', !s.groups.some((g) => g.title === 'empty'));
  check('group metadata kept', eq(s.groups[1], { title: 'later', color: 'red', collapsed: true }));
  check('tab → group index points at the right group', eq(s.tabs.map((t) => t.group), [-1, 0, 0, -1, 1]));
  check('pin kept', s.tabs[0].pinned === true && s.tabs[1].pinned === false);
  check('a window of only new-tab pages snapshots to null', W.snapshotWindow([tab(1, 0, 'chrome://newtab/'), tab(2, 1, 'about:blank')], []) === null);
  check('javascript: urls are never captured for replay', W.snapshotWindow([tab(1, 0, 'javascript:alert(1)')], []) === null);
}

// ---- save / find / remove ----
{
  const win = { tabs: [tab(1, 0, 'https://a')], groups: [] };
  check('makeWorkspace refuses a nameless save', W.makeWorkspace('!!', [win], 1) === null);
  check('makeWorkspace refuses an empty save (it would shadow a real workspace)', W.makeWorkspace('x', [{ tabs: [tab(1, 0, 'chrome://newtab/')], groups: [] }], 1) === null);
  const multi = W.makeWorkspace('All', [win, { tabs: [], groups: [] }, win], 5);
  check('empty windows are skipped, not saved as blank windows', multi.windows.length === 2 && multi.savedAt === 5);

  let list = [];
  list = W.workspaceSave(list, W.makeWorkspace('Deep Work', [win], 1));
  list = W.workspaceSave(list, W.makeWorkspace('Reading', [win], 2));
  list = W.workspaceSave(list, W.makeWorkspace('deep-work', [{ tabs: [tab(1, 0, 'https://new')], groups: [] }], 3));
  check('re-saving a folded name replaces it — no near-duplicate stacks', list.length === 2);
  check('the re-save is newest first and carries the new tabs', list[0].savedAt === 3 && list[0].windows[0].tabs[0].url === 'https://new');

  check('find is case/punctuation-insensitive', W.workspaceFind(list, 'DEEP WORK') === list[0]);
  check('a unique prefix finds', W.workspaceFind(list, 'read') === list[1]);
  const amb = W.workspaceSave(list, W.makeWorkspace('Deep Dive', [win], 4));
  check('an ambiguous prefix finds nothing rather than guessing', W.workspaceFind(amb, 'deep') === null);
  check('an exact key beats a prefix collision', W.workspaceFind(W.workspaceSave(amb, W.makeWorkspace('deep', [win], 5)), 'deep').name === 'deep');
  check('an empty query finds nothing', W.workspaceFind(list, '  ') === null);

  const r = W.workspaceRemove(amb, 'deep dive');
  check('remove takes exactly the named workspace', r.removed.name === 'Deep Dive' && r.rest.length === 2 && !r.rest.some((w) => w.name === 'Deep Dive'));
  const miss = W.workspaceRemove(amb, 'deep');
  check('remove with an ambiguous name removes nothing', miss.removed === null && miss.rest.length === 3);

  let big = [];
  for (let i = 0; i < W.WORKSPACE_CAP + 5; i++) big = W.workspaceSave(big, W.makeWorkspace('w' + i, [win], i));
  check('the list is capped, dropping the oldest', big.length === W.WORKSPACE_CAP && big[0].name === 'w' + (W.WORKSPACE_CAP + 4));
}

// ---- restore plan: groups land on the right tab positions ----
{
  const saved = {
    tabs: [
      { url: 'https://a', pinned: false, group: 0 },
      { url: 'https://pin', pinned: true, group: -1 },   // stored after a grouped tab (hand-edited / older data)
      { url: 'https://b', pinned: false, group: 0 },
      { url: 'https://c', pinned: false, group: -1 },
      { url: 'https://d', pinned: false, group: 1 },
      { url: 'chrome://newtab/', pinned: false, group: 1 },
    ],
    groups: [{ title: 'g0', color: 'blue', collapsed: false }, { title: 'g1', color: 'nope', collapsed: true }, { title: 'g2', color: 'red' }],
  };
  const p = W.restorePlan(saved);
  check('pinned tabs are created first (Chrome keeps them at the front)', eq(p.urls, ['https://pin', 'https://a', 'https://b', 'https://c', 'https://d']));
  check('pin positions index the created tabs', eq(p.pinned, [0]));
  check('group indices are shifted past the pinned tab', eq(p.groups[0].indices, [1, 2]) && eq(p.groups[1].indices, [4]));
  check('an invalid stored colour restores as grey, not a throwing update', p.groups[1].color === 'grey' && p.groups[1].collapsed === true);
  check('a group with no surviving tab is not created', p.groups.length === 2);

  const tabs = [tab(1, 0, 'https://x', { pinned: true }), tab(2, 1, 'https://y', { groupId: 3 }), tab(3, 2, 'https://z', { groupId: 3 }), tab(4, 3, 'https://w')];
  const round = W.restorePlan(W.snapshotWindow(tabs, [{ id: 3, title: 'grp', color: 'pink', collapsed: true }]));
  check('snapshot → plan round-trips urls, pins and group span',
    eq(round.urls, ['https://x', 'https://y', 'https://z', 'https://w']) && eq(round.pinned, [0]) &&
    eq(round.groups, [{ title: 'grp', color: 'pink', collapsed: true, indices: [1, 2] }]));
}

// ---- reading list queue ----
{
  const E = [
    { url: 'https://new', hasBeenRead: false, creationTime: 300 },
    { url: 'https://old', hasBeenRead: false, creationTime: 100 },
    { url: 'https://done', hasBeenRead: true, creationTime: 50 },
    { url: 'https://mid', hasBeenRead: false, creationTime: 200 },
  ];
  check('read next is the OLDEST unread (a queue), read entries skipped', W.nextUnread(E, []).entry.url === 'https://old');
  const second = W.nextUnread(E, ['https://old#section']);
  check('an entry already open (ignoring #fragment) is skipped so "read next" twice opens two articles', second.entry.url === 'https://mid' && second.open === false);
  const allOpen = W.nextUnread(E, ['https://old', 'https://mid', 'https://new']);
  check('all unread already open → focus the oldest instead of duplicating', allOpen.entry.url === 'https://old' && allOpen.open === true);
  check('nothing unread → null', W.nextUnread([{ url: 'https://x', hasBeenRead: true }], []) === null && W.nextUnread(null, null) === null);

  check('markRead toggles when no state given', eq(W.readState(E, 'https://old'), { url: 'https://old', hasBeenRead: true }) && eq(W.readState(E, 'https://done'), { url: 'https://done', hasBeenRead: false }));
  check('markRead honours an explicit state (no toggle back)', eq(W.readState(E, 'https://done', true), { url: 'https://done', hasBeenRead: true }));
  check('a url with no entry is null — updateEntry would reject it', W.readState(E, 'https://nope', true) === null);
}

// ---- worker ⇄ host verb parity ----
// Every verb the worker dispatches for this core must be advertised on the host's bus surface,
// or a stryke script cannot call it (and a typo on either side would ship silently).
{
  const bg = fs.readFileSync(new URL('../background.js', import.meta.url), 'utf8');
  const zbus = fs.readFileSync(new URL('../native/zwire-host/src/zbus.rs', import.meta.url), 'utf8');
  const verbs = ['nameGroup', 'colorGroup', 'closeGroup', 'groupToWindow', 'saveWorkspace', 'openWorkspace', 'deleteWorkspace', 'readNext', 'markRead'];
  verbs.forEach((v) => {
    check(`worker dispatches ${v}`, bg.includes(`c.a === '${v}'`));
    check(`host advertises browser.${v}`, zbus.includes(`"browser.${v}"`));
  });
  check('worker loads the core', /importScripts\('zworkspace-core\.js'\)/.test(bg));

  // The new-tab palette relays its worker rows by verb name across the extension boundary, where
  // nothing type-checks them: a misspelt `a` is a row that silently does nothing.
  const ntp = fs.readFileSync(new URL('../../../newtab/palette.js', import.meta.url), 'utf8');
  const block = (ntp.match(/var WORKER_ROWS = \[([\s\S]*?)\n  \];/) || [])[1] || '';
  const relayed = [...block.matchAll(/\{ a: '([A-Za-z]+)'/g)].map((m) => m[1]);
  check('new-tab palette lists worker rows', relayed.length > 0);
  relayed.forEach((v) => check(`new-tab row ${v} reaches a worker branch`, bg.includes(`c.a === '${v}'`)));
}

if (fail) { console.error(`workspace core: ${fail} failed, ${pass} passed`); process.exit(1); }
console.log(`workspace core: ${pass} checks passed`);
