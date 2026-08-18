// REAL tmux palette surface (palette-cmds.js: flattenTmuxTree / tmuxActivePane /
// makeTmuxItems / makeTmuxProvider) — the rows that drive the multiplexer in the
// user's terminal through zwire-host's `tmux_*` commands.
//
// What can actually go wrong here, and therefore what this pins:
//   · a row types into the WRONG PANE. The palette caches the pane list when it
//     opens; between opening ⌘K and pressing ⏎ the user can switch panes, and a
//     command sent to the pane they just left is the one failure this surface
//     must not have. Every action re-reads the tree, and that is asserted by
//     changing the tree between the prime and the run.
//   · a URL arrives EXECUTED. Sending a page URL types it; pressing Enter is the
//     user's move (they wrap it in curl, add flags). `enter` is pinned per row.
//   · pane rows flood the palette. They are query-only; an empty query must
//     produce nothing.
//   · a pane row's id moves when a session, window or command is renamed —
//     which would break every saved chain that named it. Ids come from the pane
//     id, and a full rename is replayed to prove they hold still.
//   · a missing tmux server throws instead of reporting.
//
// Boots the shipped file over a `window`-like global; no DOM, no chrome.*, no
// hand-rewritten mirror of the logic. Pure Node, deterministic, exits non-zero on
// any failure.
import fs from 'node:fs';
import assert from 'node:assert/strict';

const src = fs.readFileSync(new URL('../palette-cmds.js', import.meta.url), 'utf8');
const root = {};
new Function('window', 'module', src)(root, { exports: {} });
const PC = root.ZWIRE_PALETTE_CMDS;
assert.ok(PC && PC.makeTmuxItems && PC.makeTmuxProvider, 'ZWIRE_PALETTE_CMDS tmux surface missing');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; return; }
  fail++;
  console.error(`  ✗ ${name}${detail ? ' — ' + detail : ''}`);
}

/* ---- fixtures ------------------------------------------------------------- */

// Two sessions; the attached one's active window has %1 active. `other` also has
// an "active" pane, which is what makes the attached-session preference testable.
function tree(activeId = '%1') {
  return {
    running: true,
    sessions: [
      { name: 'other', attached: false, windows: [
        { index: '0', name: 'logs', active: true, panes: [
          { index: '0', id: '%9', active: true, cmd: 'less' }
        ] }
      ] },
      { name: 'main', attached: true, windows: [
        { index: '2', name: 'edit', active: false, panes: [
          { index: '0', id: '%5', active: true, cmd: 'htop' }
        ] },
        { index: '0', name: 'zsh', active: true, panes: [
          { index: '0', id: '%0', active: activeId === '%0', cmd: 'vim' },
          { index: '1', id: '%1', active: activeId === '%1', cmd: 'zsh' }
        ] }
      ] }
    ]
  };
}

// A host stub: records every request, answers tmux_tree from whatever `state.tree`
// holds at call time (so a test can move the active pane mid-flight).
function makeHost(state) {
  const sent = [];
  const host = (req, cb) => {
    sent.push(req);
    if (req.cmd === 'tmux_tree') return cb(null, { ok: true, result: state.tree });
    if (req.cmd === 'tmux_status') return cb(null, { ok: true, running: !!state.tree.running, socket: '/tmp/tmux-1/default', attached: true });
    if (req.cmd === 'tmux_snap_list') return cb(null, { ok: true, result: { snapshots: state.snaps || [] } });
    if (req.cmd === 'tmux_broadcast_list') return cb(null, { ok: true, result: { windows: state.windows || [] } });
    if (req.cmd === 'tmux_buffers') return cb(null, { ok: true, result: { buffers: state.buffers || [] } });
    if (req.cmd === 'tmux_buffer') return cb(null, { ok: true, result: { content: 'buffer-text' } });
    if (req.cmd === 'tmux_capture') return cb(null, { ok: true, result: 'line1\nline2' });
    return cb(null, { ok: true });
  };
  return { host, sent };
}

function makeCtx(state, over = {}) {
  const { host, sent } = makeHost(state);
  const toasts = [], copied = [];
  const ctx = {
    host,
    toast: (t) => toasts.push(String(t)),
    copy: (t) => copied.push(String(t)),
    prompt: (_o, cb) => cb(over.promptValue === undefined ? 'ls -la' : over.promptValue),
    pageUrl: () => 'https://example.com/page',
    selection: () => over.selection || ''
  };
  return { ctx, sent, toasts, copied };
}

const rowsById = (list) => Object.fromEntries(list.map((r) => [r.id, r]));
const lastOf = (sent, cmd) => sent.filter((r) => r.cmd === cmd).pop();

/* ---- the tree, flattened -------------------------------------------------- */

const flat = PC.flattenTmuxTree(tree());
check('flatten yields one row per pane', flat.length === 4, `got ${flat.length}`);
check('flatten builds the session:window.pane address',
  flat.some((p) => p.id === '%1' && p.target === 'main:0.1'),
  JSON.stringify(flat.map((p) => p.target)));
check('flatten carries the attached + active flags a target decision needs',
  flat.every((p) => typeof p.attached === 'boolean' && typeof p.windowActive === 'boolean' && typeof p.active === 'boolean'));
check('a server-less payload flattens to nothing rather than throwing',
  PC.flattenTmuxTree({ running: false, sessions: [] }).length === 0 && PC.flattenTmuxTree(null).length === 0);

/* ---- which pane is "the" pane --------------------------------------------- */

const act = PC.tmuxActivePane(flat);
check('the active pane is the active pane of the active window of the ATTACHED session',
  act && act.id === '%1', act && act.id);
// With nothing attached — a server driven purely from the browser — several
// sessions each have an "active" pane and none of them is the one the user is
// looking at, because the user is looking at none of them. The contract is
// therefore the weaker true one: still an active pane of an active window, never
// null, never a pane sitting in a background window.
check('a detached server still resolves an active pane instead of giving up',
  (() => {
    const t = tree();
    t.sessions.forEach((s) => { s.attached = false; });
    const p = PC.tmuxActivePane(PC.flattenTmuxTree(t));
    return p && p.active === true && p.windowActive === true;
  })());

/* ---- actions target the pane that is active NOW --------------------------- */

{
  const state = { tree: tree('%1') };
  const { ctx, sent } = makeCtx(state);
  const items = rowsById(PC.makeTmuxItems(ctx));
  // Prime the provider cache the way an open palette does, then move the user.
  PC.primeTmux(ctx.host, () => {});
  state.tree = tree('%0');
  items['zw.tmux.sendCmd'].run();
  const send = lastOf(sent, 'tmux_send');
  check('a command goes to the pane active at RUN time, not at palette-open time',
    send && send.panes[0] === '%0', JSON.stringify(send));
  check('a command is sent with Enter', send && send.enter === true);
}

{
  const { ctx, sent } = makeCtx({ tree: tree() });
  const items = rowsById(PC.makeTmuxItems(ctx));
  items['zw.tmux.sendUrl'].run();
  const send = lastOf(sent, 'tmux_send');
  check('the page URL is TYPED into the pane', send && send.text === 'https://example.com/page');
  check('the page URL is NOT executed — Enter stays the user\'s', send && send.enter === false);
}

/* ---- the browser↔terminal clipboard seam ---------------------------------- */

{
  const { ctx, sent, copied } = makeCtx({ tree: tree() }, { selection: '  picked text  ' });
  const items = rowsById(PC.makeTmuxItems(ctx));
  items['zw.tmux.pushSelection'].run();
  const buf = lastOf(sent, 'tmux_set_buffer');
  check('the page selection lands in a tmux paste buffer, trimmed',
    buf && buf.content === 'picked text', JSON.stringify(buf));
}
{
  const { ctx, sent } = makeCtx({ tree: tree() });   // no selection
  const items = rowsById(PC.makeTmuxItems(ctx));
  items['zw.tmux.pushSelection'].run();
  const buf = lastOf(sent, 'tmux_set_buffer');
  check('with nothing selected the page URL is what crosses over',
    buf && buf.content === 'https://example.com/page');
}
{
  const { ctx, copied } = makeCtx({ tree: tree(), buffers: [{ name: 'buffer0', size: 11 }] });
  const items = rowsById(PC.makeTmuxItems(ctx));
  items['zw.tmux.pullBuffer'].run();
  check('the newest tmux buffer reaches the browser clipboard', copied[0] === 'buffer-text', JSON.stringify(copied));
}
{
  const { ctx, copied } = makeCtx({ tree: tree() });
  const items = rowsById(PC.makeTmuxItems(ctx));
  items['zw.tmux.capture'].run();
  check('capture copies the pane text', copied[0] === 'line1\nline2');
}

/* ---- synchronize-panes toggles off the CURRENT state ---------------------- */

{
  const state = { tree: tree(), windows: [{ session: 'main', windowIndex: '0', sync: true }] };
  const { ctx, sent } = makeCtx(state);
  const items = rowsById(PC.makeTmuxItems(ctx));
  items['zw.tmux.sync'].run();
  const sync = lastOf(sent, 'tmux_sync');
  check('sync toggles OFF a window that is already synchronized',
    sync && sync.on === false && sync.window === 'main:0', JSON.stringify(sync));
}
{
  const { ctx, sent } = makeCtx({ tree: tree(), windows: [] });
  const items = rowsById(PC.makeTmuxItems(ctx));
  items['zw.tmux.sync'].run();
  const sync = lastOf(sent, 'tmux_sync');
  check('sync turns ON a window that reports no sync state', sync && sync.on === true);
}

/* ---- the typed surface ---------------------------------------------------- */

{
  const state = { tree: tree(), snaps: [{ name: 'work', sessions: 1, windows: 2, panes: 4 }] };
  const { ctx, sent } = makeCtx(state);
  PC.primeTmux(ctx.host, () => {});
  const provider = PC.makeTmuxProvider(ctx);

  check('an empty query publishes no pane rows', provider('').length === 0);
  check('an unrelated query publishes no pane rows', provider('github').length === 0);

  const listed = provider('tmux');
  check('`tmux` lists every live pane', listed.filter((r) => r.id.startsWith('zw.tmux.focus.')).length === 4,
    JSON.stringify(listed.map((r) => r.id)));
  check('the pane the user is looking at leads the list', listed[0] && listed[0].id === 'zw.tmux.focus.1',
    listed[0] && listed[0].id);
  check('saved sessions are offered alongside the panes',
    listed.some((r) => r.id === 'zw.tmux.snap.work'));

  listed[0].run();
  const focus = lastOf(sent, 'tmux_focus');
  check('focusing a pane names its session, window and pane id',
    focus && focus.session === 'main' && focus.window === '0' && focus.pane === '%1', JSON.stringify(focus));

  const sends = provider('tmux git status');
  check('`tmux <text>` turns every pane into a send target for that text',
    sends.length === 4 && sends.every((r) => r.detail === 'git status'), JSON.stringify(sends.map((r) => r.detail)));
  sends[0].run();
  const sent1 = lastOf(sent, 'tmux_send');
  check('sending from a typed row runs the text in the chosen pane',
    sent1 && sent1.panes[0] === '%1' && sent1.text === 'git status' && sent1.enter === true, JSON.stringify(sent1));
}

/* ---- ids survive a rename ------------------------------------------------- */

{
  const state = { tree: tree() };
  const { ctx } = makeCtx(state);
  PC.primeTmux(ctx.host, () => {});
  const before = PC.makeTmuxProvider(ctx)('tmux').filter((r) => r.id.startsWith('zw.tmux.focus.')).map((r) => r.id).sort();
  // Rename everything a row displays: session, window, and the running command.
  const renamed = tree();
  renamed.sessions.forEach((s) => {
    s.name = s.name.toUpperCase() + '-renamed';
    s.windows.forEach((w) => { w.name = 'ZZZ'; w.panes.forEach((p) => { p.cmd = 'nvim'; }); });
  });
  state.tree = renamed;
  PC.primeTmux(ctx.host, () => {});
  const after = PC.makeTmuxProvider(ctx)('tmux').filter((r) => r.id.startsWith('zw.tmux.focus.')).map((r) => r.id).sort();
  check('a pane row keeps its id when its session, window and command are renamed',
    JSON.stringify(before) === JSON.stringify(after), `${JSON.stringify(before)} vs ${JSON.stringify(after)}`);
}

/* ---- no server is reported, never thrown ---------------------------------- */

{
  const state = { tree: { running: false, sessions: [] } };
  const { ctx, sent, toasts } = makeCtx(state);
  const items = PC.makeTmuxItems(ctx);
  check('the action rows exist with no server running — a chain can still name them', items.length > 0);
  rowsById(items)['zw.tmux.sendCmd'].run();
  check('a send with no server reports instead of sending',
    !sent.some((r) => r.cmd === 'tmux_send') && toasts.some((t) => /no server/.test(t)), JSON.stringify(toasts));

  PC.primeTmux(ctx.host, () => {});
  const rows = PC.makeTmuxProvider(ctx)('tmux');
  check('the typed surface says so rather than answering with an empty list',
    rows.length === 1 && rows[0].id === 'zw.tmux.none', JSON.stringify(rows.map((r) => r.id)));
}

/* ---- a host that fails outright ------------------------------------------- */

{
  const toasts = [];
  const ctx = {
    host: (_r, cb) => cb('native host port unavailable'),
    toast: (t) => toasts.push(String(t)),
    copy: () => {}, prompt: (_o, cb) => cb('ls'),
    pageUrl: () => 'https://example.com/page', selection: () => ''
  };
  rowsById(PC.makeTmuxItems(ctx))['zw.tmux.capture'].run();
  check('a dead host surfaces its error on the row that asked',
    toasts.some((t) => /native host port unavailable/.test(t)), JSON.stringify(toasts));
}

console.log(`tmux palette surface: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
