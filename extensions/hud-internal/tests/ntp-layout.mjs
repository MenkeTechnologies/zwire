// New-tab layout engine test (zntp-core.js) — the pure store behind custom new-tab
// layouts (the Vivaldi Start Page port). The file is an IIFE that hangs its API off
// a `window`-like global, so it loads headless via `new Function` with no DOM /
// chrome.* — whatever zntp-core.js actually computes is what gets tested, no
// hand-rewritten mirror to drift.
//
// Assertions pin the load-bearing decisions: normalize() is the ONLY gate between
// stored/imported JSON and the renderer, so its clamps, enum checks, id re-issue and
// URL scheme filtering are tested hardest — a `javascript:` dial or a data:text/html
// background that survives normalize is a script-injection into the new tab's own
// extension origin. Also pinned: the invariants the UI relies on (a library is never
// empty, a layout always has a group, add-once widgets stay once), that every edit
// returns a NEW config without mutating the caller's, and the Vivaldi geometry
// (max-columns, the 5 thumbnail sizes, titles when-needed).
//
// Pure Node, deterministic. Exits non-zero on any failure.
import fs from 'node:fs';
import assert from 'node:assert/strict';

const src = fs.readFileSync(new URL('../zntp-core.js', import.meta.url), 'utf8');
const root = {};
new Function('window', 'module', src)(root, { exports: {} });
const N = root.ZWIRE_NTP;
assert.ok(N, 'ZWIRE_NTP missing');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; }
  else { fail++; console.log(`FAIL  ${name}${detail ? '  — ' + detail : ''}`); }
}
const eq = (name, got, want) => check(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';

/* ------------------------------------------------------------------ defaults */
const def = N.defaultConfig();
check('default has one layout', def.layouts.length === 1);
check('default active id resolves', N.activeLayout(def).id === def.activeId);
check('default layout has one group', N.activeLayout(def).pages.length === 1);
check('default group has dials', N.activePage(N.activeLayout(def)).dials.length > 0);
check('default schema stamped', def.v === N.SCHEMA);

/* --------------------------------------------------------------- normalization */
const wild = N.normalize({
  activeId: 'nope',
  layouts: [{
    id: 'L', name: '', nav: { pos: 'diagonal', show: 'sometimes' },
    bg: { kind: 'video', value: 'x' },
    dial: { columns: 99, thumb: 9, titles: 'maybe', showAdd: 'yes', dragReorder: 0 },
    pages: [{ id: 'P', name: '', dials: [], widgets: [{ type: 'clock', span: 99 }] }]
  }]
});
const wl = wild.layouts[0];
check('unknown activeId falls back to first layout', wild.activeId === 'L');
eq('nav enums clamped', wl.nav, { pos: 'top', show: 'start' });
eq('unknown bg kind falls back', wl.bg, { kind: 'none', value: 'x' });
check('columns clamped to MAX_COLUMNS', wl.dial.columns === N.MAX_COLUMNS, String(wl.dial.columns));
check('thumb clamped to MAX_THUMB', wl.dial.thumb === N.MAX_THUMB, String(wl.dial.thumb));
check('titles enum falls back to always', wl.dial.titles === 'always');
check('non-boolean showAdd coerces to default true', wl.dial.showAdd === true);
check('non-boolean dragReorder coerces to default true', wl.dial.dragReorder === true);
check('span clamped to MAX_SPAN', wl.pages[0].widgets[0].span === N.MAX_SPAN, String(wl.pages[0].widgets[0].span));
check('blank names get a fallback', !!wl.name && !!wl.pages[0].name);
check('empty config yields a usable one', N.normalize({}).layouts.length === 1);
check('empty layout gets a group', N.normalize({ layouts: [{ id: 'a' }] }).layouts[0].pages.length === 1);

const counted = N.normalize({ layouts: [{ pages: [{ widgets: [{ type: 'history', cfg: { count: 9999 } }, { type: 'topsites', cfg: { count: -4 } }] }] }] });
check('list count clamped high', counted.layouts[0].pages[0].widgets[0].cfg.count === 50);
check('list count clamped low', counted.layouts[0].pages[0].widgets[1].cfg.count === 1);

const dropped = N.normalize({ layouts: [{ pages: [{ widgets: [{ type: 'crypto-miner' }, { type: 'clock' }] }] }] });
eq('unknown widget type dropped', dropped.layouts[0].pages[0].widgets.map((w) => w.type), ['clock']);

const singles = N.normalize({ layouts: [{ pages: [{ widgets: [{ type: 'clock' }, { type: 'clock' }, { type: 'history' }, { type: 'history' }] }] }] });
eq('add-once widget kept once, repeatable kept twice',
  singles.layouts[0].pages[0].widgets.map((w) => w.type), ['clock', 'history', 'history']);

const dupes = N.normalize({ layouts: [{ id: 'same' }, { id: 'same' }] });
check('duplicate layout ids re-issued', dupes.layouts[0].id !== dupes.layouts[1].id);
const dupDials = N.normalize({ layouts: [{ pages: [{ dials: [{ id: 'x', url: 'a.com' }, { id: 'x', url: 'b.com' }] }] }] });
check('duplicate dial ids re-issued', dupDials.layouts[0].pages[0].dials[0].id !== dupDials.layouts[0].pages[0].dials[1].id);

/* ------------------------------------------------------------------- URL gate */
check('javascript: dial rejected', N.safeUrl('javascript:alert(1)') === '');
check('data: dial rejected', N.safeUrl('data:text/html,<script>x</script>') === '');
check('blob: dial rejected', N.safeUrl('blob:https://evil.example/abc') === '');
check('bare host gets https', N.safeUrl('example.com') === 'https://example.com');
check('protocol-relative gets https', N.safeUrl('//example.com') === 'https://example.com');
check('https passes through', N.safeUrl('https://example.com/a?b=1') === 'https://example.com/a?b=1');
check('chrome: passes through', N.safeUrl('chrome://settings') === 'chrome://settings');
const hostile = N.normalize({ layouts: [{ pages: [{
  dials: [{ url: 'javascript:alert(1)' }, { url: 'https://ok.example' }],
  widgets: [{ type: 'webpage', cfg: { url: 'javascript:alert(1)' } }]
}] }] });
eq('hostile dial dropped, good one kept', hostile.layouts[0].pages[0].dials.map((d) => d.url), ['https://ok.example']);
check('hostile webpage widget url blanked', hostile.layouts[0].pages[0].widgets[0].cfg.url === '');

check('html data url rejected as image', N.safeImage('data:text/html;base64,PHNjcmlwdD4=') === '');
check('remote image url rejected', N.safeImage('https://example.com/a.png') === '');
check('png data url accepted', N.safeImage(PNG) === PNG);
const badBg = N.normalize({ layouts: [{ bg: { kind: 'image', value: 'https://example.com/a.png' } }] });
eq('image bg with a rejected payload falls back to none', badBg.layouts[0].bg, { kind: 'none', value: '' });
const goodBg = N.normalize({ layouts: [{ bg: { kind: 'image', value: PNG } }] });
check('image bg with a data url survives', goodBg.layouts[0].bg.value === PNG);

/* -------------------------------------------------------------------- labels */
check('label derived from host', N.labelFor('https://www.github.com/x', '') === 'github.com');
check('explicit label wins', N.labelFor('https://www.github.com/x', 'Code') === 'Code');

/* ------------------------------------------------------------------ migration */
const migrated = N.migrate([{ label: 'A', url: 'a.com' }, { label: 'B', url: 'javascript:x' }, { url: 'c.com' }]);
eq('migration keeps safe tiles in order', migrated.layouts[0].pages[0].dials.map((d) => d.label), ['A', 'c.com']);
check('migration of nothing still yields defaults', N.migrate([]).layouts[0].pages[0].dials.length > 0);
check('migration of garbage still yields a config', N.migrate('not an array').layouts.length === 1);

/* ----------------------------------------------------------- library invariants */
let cfg = N.defaultConfig();
const firstId = cfg.activeId;
cfg = N.createLayout(cfg, 'Work');
check('create appends and activates', cfg.layouts.length === 2 && N.activeLayout(cfg).name === 'Work');
check('remove of the last layout is refused', N.removeLayout(N.defaultConfig(), firstId).layouts.length === 1);
const pruned = N.removeLayout(cfg, cfg.activeId);
check('removing the active layout re-points activeId', N.activeLayout(pruned) !== null && N.layoutById(pruned, cfg.activeId) === null);

const dup = N.duplicateLayout(cfg, cfg.activeId);
const src0 = N.layoutById(dup, cfg.activeId), copy = dup.layouts[dup.layouts.length - 1];
check('duplicate lands in the library', dup.layouts.length === 3);
check('duplicate takes a new layout id', copy.id !== src0.id);
check('duplicate re-issues page ids', copy.pages[0].id !== src0.pages[0].id);
check('duplicate re-issues widget ids', copy.pages[0].widgets[0].id !== src0.pages[0].widgets[0].id);
check('duplicate keeps the widget set', copy.pages[0].widgets.length === src0.pages[0].widgets.length);
check('duplicate names itself', /copy/.test(copy.name));

const oneGroup = N.defaultConfig();
check('removing the only group is refused', N.removePage(oneGroup, oneGroup.activeId, N.activeLayout(oneGroup).pages[0].id).layouts[0].pages.length === 1);

/* ------------------------------------------------------------------ page edits */
let ed = N.defaultConfig();
const L = ed.activeId;
ed = N.addPage(ed, L, 'Work');
const [home, work] = N.layoutById(ed, L).pages;
check('added group becomes active', N.activeLayout(ed).activePageId === work.id);
ed = N.addDial(ed, L, work.id, { label: 'Repo', url: 'github.com/z' });
eq('dial added to the named group', N.pageById(N.layoutById(ed, L), work.id).dials.map((d) => d.label), ['Repo']);
ed = N.addDial(ed, L, work.id, { url: 'javascript:alert(1)' });
check('hostile dial refused on add', N.pageById(N.layoutById(ed, L), work.id).dials.length === 1);

const dialId = N.pageById(N.layoutById(ed, L), work.id).dials[0].id;
ed = N.updateDial(ed, L, work.id, dialId, { label: 'Renamed', thumb: PNG });
const upd = N.pageById(N.layoutById(ed, L), work.id).dials[0];
check('dial update keeps its id', upd.id === dialId);
check('dial rename applied', upd.label === 'Renamed');
check('dial custom thumbnail applied', upd.thumb === PNG);
ed = N.updateDial(ed, L, work.id, dialId, { url: 'javascript:alert(1)' });
check('hostile dial update refused, prior value kept',
  N.pageById(N.layoutById(ed, L), work.id).dials[0].url === 'https://github.com/z');

ed = N.moveDialToPage(ed, L, work.id, dialId, home.id);
check('dial moved out of the source group', N.pageById(N.layoutById(ed, L), work.id).dials.length === 0);
check('dial moved into the target group', N.pageById(N.layoutById(ed, L), home.id).dials.some((d) => d.id === dialId));

ed = N.removeDial(ed, L, home.id, dialId);
check('dial removed', !N.pageById(N.layoutById(ed, L), home.id).dials.some((d) => d.id === dialId));

/* ---------------------------------------------------------------- widget edits */
let wcfg = N.defaultConfig();
const WL = wcfg.activeId, WP = N.activePage(N.activeLayout(wcfg)).id;
const before = N.activePage(N.activeLayout(wcfg)).widgets.length;
wcfg = N.addWidget(wcfg, WL, WP, 'clock');
check('add-once widget refused when present', N.activePage(N.activeLayout(wcfg)).widgets.length === before);
wcfg = N.addWidget(wcfg, WL, WP, 'bookmarks', { folderName: 'Bar', count: 5 });
wcfg = N.addWidget(wcfg, WL, WP, 'bookmarks', { folderName: 'Dev', count: 5 });
check('repeatable widget added twice', N.activePage(N.activeLayout(wcfg)).widgets.filter((w) => w.type === 'bookmarks').length === 2);
wcfg = N.addWidget(wcfg, WL, WP, 'nonsense');
check('unknown widget type refused on add', N.activePage(N.activeLayout(wcfg)).widgets.every((w) => w.type !== 'nonsense'));

const bm = N.activePage(N.activeLayout(wcfg)).widgets.filter((w) => w.type === 'bookmarks')[0];
wcfg = N.updateWidget(wcfg, WL, WP, bm.id, { size: 'tall', span: 2 });
const bm2 = N.activePage(N.activeLayout(wcfg)).widgets.filter((w) => w.id === bm.id)[0];
check('widget size applied to a resizable widget', bm2.size === 'tall');
check('widget span applied', bm2.span === 2);
check('widget config survives an unrelated update', bm2.cfg.folderName === 'Bar');
const clock = N.activePage(N.activeLayout(wcfg)).widgets.filter((w) => w.type === 'clock')[0];
const tallClock = N.updateWidget(wcfg, WL, WP, clock.id, { size: 'tall' });
check('non-resizable widget stays regular', N.activePage(N.activeLayout(tallClock)).widgets.filter((w) => w.id === clock.id)[0].size === 'regular');
wcfg = N.removeWidget(wcfg, WL, WP, bm.id);
check('widget removed', !N.activePage(N.activeLayout(wcfg)).widgets.some((w) => w.id === bm.id));

/* -------------------------------------------------------------------- reorder */
eq('reorder moves forward', N.reorder(['a', 'b', 'c', 'd'], 0, 2), ['b', 'c', 'a', 'd']);
eq('reorder moves backward', N.reorder(['a', 'b', 'c', 'd'], 3, 1), ['a', 'd', 'b', 'c']);
eq('reorder out of range is a no-op', N.reorder(['a', 'b'], 5, 0), ['a', 'b']);
eq('reorder onto itself is a no-op', N.reorder(['a', 'b'], 1, 1), ['a', 'b']);
eq('reorder of a non-list yields empty', N.reorder(null, 0, 1), []);

eq('orderBy replays a reported order', N.orderBy([{ id: 'a' }, { id: 'b' }, { id: 'c' }], ['c', 'a', 'b']).map((x) => x.id), ['c', 'a', 'b']);
eq('orderBy ignores ids it does not know', N.orderBy([{ id: 'a' }, { id: 'b' }], ['b', 'ghost', 'a']).map((x) => x.id), ['b', 'a']);
eq('orderBy keeps unmentioned items instead of dropping them', N.orderBy([{ id: 'a' }, { id: 'b' }, { id: 'c' }], ['c']).map((x) => x.id), ['c', 'a', 'b']);
eq('orderBy of an empty report is a no-op', N.orderBy([{ id: 'a' }, { id: 'b' }], []).map((x) => x.id), ['a', 'b']);

let rcfg = N.defaultConfig();
const RL = rcfg.activeId, RP = N.activePage(N.activeLayout(rcfg)).id;
const dialOrder = N.activePage(N.activeLayout(rcfg)).dials.map((d) => d.label);
rcfg = N.moveDial(rcfg, RL, RP, 0, 2);
eq('dial drag-reorder applied', N.activePage(N.activeLayout(rcfg)).dials.map((d) => d.label),
  [dialOrder[1], dialOrder[2], dialOrder[0]].concat(dialOrder.slice(3)));

const dropOrder = N.activePage(N.activeLayout(rcfg)).dials.map((d) => d.id).reverse();
rcfg = N.orderDials(rcfg, RL, RP, dropOrder);
eq('dial drop order persisted', N.activePage(N.activeLayout(rcfg)).dials.map((d) => d.id), dropOrder);
const wOrder = N.activePage(N.activeLayout(rcfg)).widgets.map((w) => w.id).reverse();
rcfg = N.orderWidgets(rcfg, RL, RP, wOrder);
eq('widget drop order persisted', N.activePage(N.activeLayout(rcfg)).widgets.map((w) => w.id), wOrder);
rcfg = N.orderDials(rcfg, RL, RP, ['stale-id-from-a-previous-paint']);
check('a stale drop report never drops dials', N.activePage(N.activeLayout(rcfg)).dials.length === dropOrder.length);

/* ------------------------------------------------------------------- geometry */
const geo = N.normalize({ layouts: [{ dial: { columns: 6, thumb: 1 } }] }).layouts[0];
check('an exact multiple of the cap uses the cap', N.dialColumns(geo, 12) === 6);
check('fewer dials than the cap use their own count', N.dialColumns(geo, 3) === 3);
check('the cap is never exceeded', [7, 13, 20, 100].every((n) => N.dialColumns(geo, n) <= 6));
/* Balancing: the row count must not grow, and no row may be left a stub. */
check('seven under a six cap balances 4+3', N.dialColumns(geo, 7) === 4);
check('thirteen under a six cap balances to five', N.dialColumns(geo, 13) === 5);
check('balancing never adds a row', [2, 5, 7, 11, 13, 19, 25, 37].every((n) =>
  Math.ceil(n / N.dialColumns(geo, n)) === Math.ceil(n / 6)));
/* The case that motivated balancing: counts that PACK into a stranded single tile
 * (n % cap === 1) must not end on a row of one. */
check('a packed layout would strand one tile', [7, 13, 19, 25].every((n) => n % 6 === 1));
check('balancing never ends on a row of one', [7, 13, 19, 25].every((n) => {
  const cols = N.dialColumns(geo, n);
  return n - (Math.ceil(n / cols) - 1) * cols >= 2;
}));
/* dialFit: the same balancing, but against measured space. 160px tiles + 14px gaps. */
const fit = (px, n, cap) => N.dialFit(px, 160, 14, n, cap);
check('a wide window fits every dial on one row', fit(2000, 7, 0) === 7);
check('a window one tile short balances instead of stranding one', fit(1180, 7, 0) === 4);
check('the cap still wins when it is tighter than the window', fit(2000, 7, 3) === 3);
check('the window still wins when it is tighter than the cap', fit(600, 7, 12) === 3);   // 4 tiles need 696px
check('one more tile fits as soon as there is room for it', fit(700, 7, 12) === 4);
check('a window narrower than one tile still shows one per row', fit(40, 5, 0) === 1);
check('no measurement yet degrades to one per row, never zero', fit(0, 5, 0) === 1);
check('dialFit never exceeds its cap', [300, 700, 1180, 4000].every((px) => fit(px, 9, 4) <= 4));
check('dialFit never returns more than the dial count', [300, 1180, 4000].every((px) => fit(px, 3, 12) <= 3));

const unlimited = N.normalize({ layouts: [{ dial: { columns: 0 } }] }).layouts[0];
check('no-limit columns follow the dial count', N.dialColumns(unlimited, 20) === 20);
check('zero dials still yields one column', N.dialColumns(unlimited, 0) === 1);
check('thumbnail size 1 is the smallest px', N.dialSizePx(geo) === N.THUMB_PX[0]);
check('thumbnail size 5 is the largest px', N.dialSizePx(N.normalize({ layouts: [{ dial: { thumb: 5 } }] }).layouts[0]) === N.THUMB_PX[4]);
const always = N.normalize({ layouts: [{ dial: { titles: 'always' } }] }).layouts[0];
const never = N.normalize({ layouts: [{ dial: { titles: 'never' } }] }).layouts[0];
const auto = N.normalize({ layouts: [{ dial: { titles: 'auto' } }] }).layouts[0];
check('titles always shows with a thumbnail', N.showTitle(always, { thumb: PNG }) === true);
check('titles never hides without a thumbnail', N.showTitle(never, { thumb: '' }) === false);
check('titles when-needed hides behind a custom thumbnail', N.showTitle(auto, { thumb: PNG }) === false);
check('titles when-needed shows without one', N.showTitle(auto, { thumb: '' }) === true);

/* ------------------------------------------------------------- grid placement */
/* The HUD preview and the page must agree on where a widget lands, so placement is
 * computed here rather than eyeballed per surface. */
const place = (ws, cols) => N.gridPlace(ws, cols).map((c) => [c.x, c.y, c.w, c.h]);
eq('four single widgets fill one row', place([{ span: 1 }, { span: 1 }, { span: 1 }, { span: 1 }], 4),
  [[0, 0, 1, 1], [1, 0, 1, 1], [2, 0, 1, 1], [3, 0, 1, 1]]);
eq('a widget wider than the remainder wraps', place([{ span: 3 }, { span: 2 }], 4),
  [[0, 0, 3, 1], [0, 1, 2, 1]]);
eq('a tall widget occupies two rows and later widgets flow around it',
  place([{ span: 1, size: 'tall' }, { span: 1 }, { span: 1 }, { span: 1 }, { span: 1 }], 4),
  [[0, 0, 1, 2], [1, 0, 1, 1], [2, 0, 1, 1], [3, 0, 1, 1], [1, 1, 1, 1]]);
check('span is capped by the track count', N.gridPlace([{ span: 4 }], 2)[0].w === 2);
check('grid rows count the tallest cell', N.gridRows(N.gridPlace([{ span: 4, size: 'tall' }], 4)) === 2);
check('an empty grid has no rows', N.gridRows(N.gridPlace([], 4)) === 0);
check('placement never overlaps', (() => {
  const ws = [{ span: 2, size: 'tall' }, { span: 1 }, { span: 3 }, { span: 1, size: 'tall' }, { span: 2 }, { span: 4 }];
  const seenCells = new Set();
  return N.gridPlace(ws, 4).every((c) => {
    for (let y = c.y; y < c.y + c.h; y++) {
      for (let x = c.x; x < c.x + c.w; x++) {
        const k = y + ':' + x;
        if (seenCells.has(k)) return false;
        seenCells.add(k);
      }
    }
    return c.x + c.w <= 4;
  });
})());

/* -------------------------------------------------------------- import/export */
const round = N.importJSON(N.exportJSON(def));
eq('export/import round-trips', round, def);
for (const bad of ['', 'not json', '42', '"str"', 'null', '{}', '{"layouts":[]}', '[]']) {
  let threw = false;
  try { N.importJSON(bad); } catch (e) { threw = true; }
  check(`import rejects ${JSON.stringify(bad)}`, threw);
}
check('import accepts a bare layout array', N.importJSON('[{"name":"X"}]').layouts[0].name === 'X');
const hostileImport = N.importJSON(JSON.stringify({ layouts: [{ name: 'Evil', pages: [{ dials: [{ url: 'javascript:alert(1)' }] }] }] }));
check('import strips hostile dials', hostileImport.layouts[0].pages[0].dials.length === 0);

let lib = N.defaultConfig();
const libActive = lib.activeId;
lib = N.mergeImport(lib, JSON.stringify({ layouts: [{ id: libActive, name: 'Imported' }] }));
check('merge appends instead of replacing', lib.layouts.length === 2);
check('merge keeps the current layout active', lib.activeId === libActive);
check('merge re-issues a colliding id', lib.layouts[1].id !== libActive);

/* --------------------------------------------------------------- immutability */
const orig = N.defaultConfig();
const snapshot = JSON.stringify(orig);
const OL = orig.activeId, OP = N.activePage(N.activeLayout(orig)).id;
N.createLayout(orig, 'x');
N.renameLayout(orig, OL, 'x');
N.addPage(orig, OL, 'x');
N.addDial(orig, OL, OP, { url: 'x.com' });
N.addWidget(orig, OL, OP, 'notes');
N.moveDial(orig, OL, OP, 0, 1);
N.removeLayout(orig, OL);
N.setLayoutPrefs(orig, OL, { dial: { columns: 1 } });
check('edits never mutate the caller config', JSON.stringify(orig) === snapshot);

/* ------------------------------------------------------------------- prefs */
let pref = N.defaultConfig();
pref = N.setLayoutPrefs(pref, pref.activeId, { nav: { pos: 'left' }, dial: { columns: 4, titles: 'never' }, bg: { kind: 'color', value: '#123456' } });
const pl = N.activeLayout(pref);
check('nav position patched', pl.nav.pos === 'left');
check('nav show untouched by a partial patch', pl.nav.show === 'start');
check('dial columns patched', pl.dial.columns === 4);
check('dial titles patched', pl.dial.titles === 'never');
check('dial thumb untouched by a partial patch', pl.dial.thumb === 3);
eq('background patched', pl.bg, { kind: 'color', value: '#123456' });
const junk = N.setLayoutPrefs(pref, pref.activeId, { dial: { columns: 999, titles: 'sideways' } });
check('patched columns still clamped', N.activeLayout(junk).dial.columns === N.MAX_COLUMNS);
check('patched titles still enum-checked', N.activeLayout(junk).dial.titles === 'always');

/* ------------------------------------------------------- renderer coverage */
/* The catalog lives here, the renderers live in the new tab. Adding a widget type
 * without a renderer produces a silently empty box on the page — nothing else would
 * catch it, so the contract is asserted: every catalog type has a renderer, and no
 * renderer exists for a type the catalog dropped. widgets.js only touches the DOM
 * inside its functions, so it loads headless with a stubbed window. */
const widgetsPath = new URL('../../../newtab/widgets.js', import.meta.url);
check('newtab/widgets.js is present', fs.existsSync(widgetsPath), String(widgetsPath));
if (fs.existsSync(widgetsPath)) {
  const wwin = { ZWIRE_NTP: N };
  new Function('window', fs.readFileSync(widgetsPath, 'utf8'))(wwin);
  const rendered = Object.keys((wwin.ZBWidgets && wwin.ZBWidgets.RENDER) || {});
  const catalog = N.WIDGETS.map((w) => w.type);
  eq('every catalog widget has a renderer', catalog.filter((t) => rendered.indexOf(t) < 0), []);
  eq('no renderer outlives its catalog entry', rendered.filter((t) => catalog.indexOf(t) < 0), []);
}

console.log(`ntp-layout: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
