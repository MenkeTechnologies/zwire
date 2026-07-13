// URL-surgery mini-language test (palette-cmds.js) — the `url:`/`u:` rewrite engine
// that transforms the CURRENT tab's URL (sed substitution + query/path/host/fragment
// ops) and the provider both palettes drive. The file is an IIFE hung off a `window`-
// like global, so it loads headless via `new Function` with no DOM/chrome. Assertions
// pin urlSurgery() op-by-op, op composition, malformed-op no-ops, and the provider's
// sigil gating + row shape + nav/open/copy adapters. Uses global URL (Node >= 20).
import fs from 'node:fs';
import assert from 'node:assert/strict';

const src = fs.readFileSync(new URL('../palette-cmds.js', import.meta.url), 'utf8');
const root = {};
new Function('window', src)(root);
const PC = root.ZWIRE_PALETTE_CMDS;
assert.ok(PC && PC.urlSurgery, 'ZWIRE_PALETTE_CMDS.urlSurgery missing');
assert.ok(PC && PC.makeUrlSurgeryProvider, 'ZWIRE_PALETTE_CMDS.makeUrlSurgeryProvider missing');

const S = (href, expr) => PC.urlSurgery(href, expr);

// ---- sed-style substitution (the whole href is the subject) ----
assert.equal(S('https://github.com/o/r/blob/main/a.js', 's/blob/edit/'),
  'https://github.com/o/r/edit/main/a.js', 's/// swaps a path word');
assert.equal(S('http://example.com/x', 's/http:/https:/'),
  'https://example.com/x', 'scheme upgrade via substitution');
// alternate delimiter so slashes need no escaping
assert.equal(S('https://a.com/one/two', 's|/one/|/ONE/|'),
  'https://a.com/ONE/two', 'pipe delimiter avoids escaping slashes');
// global + backreference
assert.equal(S('https://a.com/a/a/a', 's/a/b/g'),
  'https://b.com/b/b/b', 'g flag replaces every occurrence');
assert.equal(S('https://a.com/2024/report', 's/(\\d+)/[$1]/'),
  'https://a.com/[2024]/report', '$1 backreference is honored');
// case-insensitive flag
assert.equal(S('https://a.com/PATH', 's/path/x/i'), 'https://a.com/x', 'i flag matches case-insensitively');
// regex escapes survive the delimiter split (\. is a literal dot, not "any char")
assert.equal(S('https://a.com/a.b', 's/a\\.b/Z/'), 'https://a.com/Z', '\\. reaches the RegExp as an escaped dot');
// a malformed regex no-ops instead of throwing
assert.equal(S('https://a.com/x', 's/(/y/'), 'https://a.com/x', 'unbalanced regex group is a no-op');

// ---- query param ops ----
assert.equal(S('https://a.com/p?x=1', '+y=2'), 'https://a.com/p?x=1&y=2', '+k=v appends a param');
assert.equal(S('https://a.com/p?x=1', '+x=9'), 'https://a.com/p?x=9', '+k=v overrides an existing param');
assert.equal(S('https://a.com/p', '+q=a%20b'), 'https://a.com/p?q=a%2520b', '+k=v url-encodes the raw value');
assert.equal(S('https://a.com/p', '+flag'), 'https://a.com/p?flag=', 'bare +k sets an empty value');
assert.equal(S('https://a.com/p?a=1&b=2', '-a'), 'https://a.com/p?b=2', '-k removes one param');
assert.equal(S('https://a.com/p?utm_source=x&fbclid=y', '-?'), 'https://a.com/p', '-? strips ALL query params');
assert.equal(S('https://a.com/p?a=1', '-*'), 'https://a.com/p', '-* is an alias for strip-all');

// ---- fragment ops ----
assert.equal(S('https://a.com/p', '#section-2'), 'https://a.com/p#section-2', '#frag sets the fragment');
assert.equal(S('https://a.com/p#old', '-#'), 'https://a.com/p', '-# clears the fragment');

// ---- path climb ----
assert.equal(S('https://a.com/a/b/c', '^'), 'https://a.com/a/b', '^ climbs one segment');
assert.equal(S('https://a.com/a/b/c/d', '^^^'), 'https://a.com/a', 'repeated carets climb N segments');
assert.equal(S('https://a.com/a/b/c/d', '^3'), 'https://a.com/a', '^N climbs N segments');
assert.equal(S('https://a.com/a', '^^^^'), 'https://a.com/', 'climbing past root lands at /');

// ---- host swap ----
assert.equal(S('https://github.com/o/r?x=1', '@github.dev'), 'https://github.dev/o/r?x=1', '@host swaps hostname, keeps path+query');
assert.equal(S('https://a.com/p', '@b.com:8080'), 'https://b.com:8080/p', '@host accepts host:port');

// ---- composition (left -> right) + no-op / unknown handling ----
assert.equal(S('https://old.com/a/b/c?utm=x&id=5', '@new.com ^ -utm'),
  'https://new.com/a/b?id=5', 'host swap, then climb, then param delete compose in order');
assert.equal(S('https://a.com/p', 'zzz'), 'https://a.com/p', 'an unknown op is ignored (no change)');
assert.equal(S('https://a.com/p', ''), 'https://a.com/p', 'an empty expression is a no-op');

// ---- provider: sigil gating + row shape + adapters ----
let navd = [], opened = [], copied = [];
const prov = PC.makeUrlSurgeryProvider({
  getUrl: () => 'https://ex.com/a/b?t=1',
  nav: (u) => navd.push(u),
  open: (u) => opened.push(u),
  copy: (t) => copied.push(t)
});

assert.equal(prov('hello world').length, 0, 'no sigil => no rows (never hijacks prose)');
assert.equal(prov('up: notes').length, 0, '`up:` is not the sigil');

// bare `url:` shows the current URL as an inert hint row.
let hint = prov('url:');
assert.equal(hint.length, 1, 'bare url: => single hint row');
assert.equal(hint[0].label, 'https://ex.com/a/b?t=1', 'hint row shows the current URL');

// a real rewrite: top row navigates in place, then new-tab, then copy.
let rows = prov('url: -t ^');
assert.equal(rows[0].label, 'https://ex.com/a', 'top row is the rewritten URL');
assert.equal(rows[0].top, true, 'top row pins to the top');
assert.equal(rows.length, 3, 'rewrite -> nav + new-tab + copy rows');
rows[0].run(); rows[1].run(); rows[2].run();
assert.deepEqual(navd, ['https://ex.com/a'], 'top row re-navigates the current tab via nav()');
assert.deepEqual(opened, ['https://ex.com/a'], 'second row opens the result in a new tab via open()');
assert.deepEqual(copied, ['https://ex.com/a'], 'copy row yanks the result via copy()');

// a no-change expression reports it and does nothing when run.
navd = [];
let nochg = prov('url: -missing');
assert.equal(nochg[0].label, 'No change', 'deleting an absent param is a no-op -> "No change"');
nochg[0].run();
assert.equal(navd.length, 0, 'the "No change" row does not navigate');

// `u:` short sigil works identically.
assert.equal(prov('u: @z.com')[0].label, 'https://z.com/a/b?t=1', '`u:` short sigil rewrites too');

// when there is no page URL (New Tab surface), the provider stays inert.
const inert = PC.makeUrlSurgeryProvider({ getUrl: () => '', open: () => {} });
assert.equal(inert('url: -t').length, 0, 'empty getUrl() => no rows (inert on the New Tab surface)');

console.log('url surgery mini-language: all assertions passed');
