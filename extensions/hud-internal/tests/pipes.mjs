// Pane pipelines engine test (zpipes-core.js) — the pure dataflow-edge engine that
// drives the reactive runtime (ztmux-pane.js source extraction + sink apply,
// ztmux-config.js relay + cycle guard, pages/pipes.js validation). The file is an
// IIFE that hangs its API off a `window`-like global, so it loads headless via
// `new Function` with no DOM / chrome.* — whatever zpipes-core.js actually computes
// is what gets tested, no hand-rewritten mirror to drift.
//
// Assertions pin the load-bearing decisions: source extraction per kind, the stryke
// `|>` op-chain filter, JS filter, sink-message folding, the cooldown/once/dedupe
// gate, and — the one thing that can make the feature unshippable — cycle detection
// at edge creation plus the whole-graph cycle scan and the per-emission hop budget.
//
// Pure Node, deterministic. Exits non-zero on any failure.
import fs from 'node:fs';
import assert from 'node:assert/strict';

const src = fs.readFileSync(new URL('../zpipes-core.js', import.meta.url), 'utf8');
const root = {};
new Function('window', 'module', src)(root, { exports: {} });
const P = root.ZWIRE_PIPES;
assert.ok(P, 'ZWIRE_PIPES missing');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; }
  else { fail++; console.log(`FAIL  ${name}${detail ? '  — ' + detail : ''}`); }
}
const eq = (name, got, want) => check(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);

/* -------------------------------------------------------- normalize/validate */
const base = {
  id: 'e1', name: 'docs→playground',
  source: { kind: 'selector', selector: 'pre code', urls: 'docs\\.' },
  filter: { kind: 'none', value: '' },
  sink: { kind: 'fill', selector: '#editor', urls: 'play\\.' }
};
check('normalize defaults enabled/cooldown/dedupe', (() => {
  const n = P.normalizeEdge({ name: 'x' });
  return n.enabled === true && n.cooldownMs === 1500 && n.dedupe === true && n.once === false && n.source.kind === 'selector' && n.sink.kind === 'navigate';
})());
check('validate ok on a complete edge', P.validateEdge(base).ok === true, JSON.stringify(P.validateEdge(base)));
check('validate rejects missing name', P.validateEdge({ ...base, name: '' }).ok === false);
check('validate rejects selector source w/o selector', P.validateEdge({ ...base, source: { kind: 'selector', selector: '' } }).ok === false);
check('validate rejects fill sink w/o selector', P.validateEdge({ ...base, sink: { kind: 'fill', selector: '' } }).ok === false);
check('validate rejects bad source regex', P.validateEdge({ ...base, source: { kind: 'regex', pattern: '(' } }).ok === false);
check('validate rejects bad sink url filter', P.validateEdge({ ...base, sink: { kind: 'navigate', urls: '(' } }).ok === false);
check('validate rejects unknown op in ops filter', P.validateEdge({ ...base, filter: { kind: 'ops', value: 'trim |> bogus' } }).ok === false);

/* -------------------------------------------------------------- matchUrl */
check('matchUrl empty = any', P.matchUrl('', 'https://x') === true);
check('matchUrl regex hit', P.matchUrl('github\\.com', 'https://github.com/a') === true);
check('matchUrl regex miss', P.matchUrl('github\\.com', 'https://gitlab.com') === false);
check('matchUrl invalid = fail closed', P.matchUrl('(', 'https://x') === false);

/* ------------------------------------------------------------ extractSource */
eq('extract url', P.extractSource({ kind: 'url' }, { url: 'https://a.com' }), ['https://a.com']);
eq('extract selection lines', P.extractSource({ kind: 'selection' }, { selection: 'one\n\ntwo ' }), ['one', 'two']);
eq('extract selector lines', P.extractSource({ kind: 'selector', selector: 'x' }, { text: ' a \nb\n' }), ['a', 'b']);
eq('extract regex whole match', P.extractSource({ kind: 'regex', pattern: 'err\\w+', flags: 'i' }, { text: 'ok\nErrorX here\nfine' }), ['ErrorX']);
eq('extract regex capture group 1', P.extractSource({ kind: 'regex', pattern: 'id=(\\d+)' }, { text: 'row id=42 x\nid=7' }), ['42', '7']);
eq('extract regex no match = empty', P.extractSource({ kind: 'regex', pattern: 'zzz' }, { text: 'abc' }), []);

/* ---------------------------------------------------------------- ops filter */
eq('ops trim+uniq', P.applyFilter({ kind: 'ops', value: 'trim |> uniq' }, [' a', 'a ', 'b']), ['a', 'b']);
eq('ops nth', P.applyFilter({ kind: 'ops', value: 'nth 1' }, ['a', 'b', 'c']), ['b']);
eq('ops grep', P.applyFilter({ kind: 'ops', value: 'grep ^h' }, ['ha', 'xb', 'hc']), ['ha', 'hc']);
eq('ops reject', P.applyFilter({ kind: 'ops', value: 'reject ^h' }, ['ha', 'xb', 'hc']), ['xb']);
eq('ops replace', P.applyFilter({ kind: 'ops', value: 'replace /a/Z/g' }, ['banana']), ['bZnZnZ']);
eq('ops join', P.applyFilter({ kind: 'ops', value: 'join ,' }, ['a', 'b', 'c']), ['a,b,c']);
eq('ops upper+first', P.applyFilter({ kind: 'ops', value: 'upper |> first' }, ['ab', 'cd']), ['AB']);
eq('ops count', P.applyFilter({ kind: 'ops', value: 'count' }, ['a', 'b', 'c']), ['3']);
eq('ops chain map/take/prepend', P.applyFilter({ kind: 'ops', value: 'take 2 |> prepend https://' }, ['a.com', 'b.com', 'c.com']), ['https://a.com', 'https://b.com']);
eq('none filter passes through', P.applyFilter({ kind: 'none' }, ['a', 'b']), ['a', 'b']);

/* ----------------------------------------------------------------- js filter */
eq('js filter returns array', P.applyFilter({ kind: 'js', value: 'lines.map(x => x.toUpperCase())' }, ['a', 'b']), ['A', 'B']);
eq('js filter returns scalar', P.applyFilter({ kind: 'js', value: 'lines.length' }, ['a', 'b', 'c']), ['3']);
eq('js filter uses text', P.applyFilter({ kind: 'js', value: 'text.replace(/\\n/g,"+")' }, ['a', 'b']), ['a+b']);
eq('js filter throw = passthrough', P.applyFilter({ kind: 'js', value: 'nope.bad()' }, ['a']), ['a']);

/* ------------------------------------------------------------ buildSinkMessage */
eq('sink navigate takes first', P.buildSinkMessage({ kind: 'navigate' }, ['https://a', 'https://b']), { act: 'navigate', url: 'https://a' });
eq('sink batch takes all', P.buildSinkMessage({ kind: 'batch' }, ['https://a', 'https://b']), { act: 'batch', urls: ['https://a', 'https://b'] });
eq('sink fill joins', P.buildSinkMessage({ kind: 'fill', selector: '#q', sep: ' ' }, ['a', 'b']), { act: 'fill', selector: '#q', text: 'a b' });
check('sink empty input = null', P.buildSinkMessage({ kind: 'fill', selector: '#q' }, ['', '  ']) === null);

/* ------------------------------------------------------------------- gate */
const edge = { enabled: true, cooldownMs: 1000, once: false, dedupe: true };
check('gate fires from empty state', P.gate(edge, {}, 5000, 'v1').fire === true);
check('gate blocks within cooldown', P.gate(edge, { lastFired: 5000 }, 5500, 'v2').fire === false);
check('gate allows after cooldown', P.gate(edge, { lastFired: 5000 }, 6001, 'v2').fire === true);
check('gate dedupes identical value', P.gate(edge, { lastFired: 0, lastValue: 'same' }, 9e9, 'same').fire === false);
check('gate once blocks second', P.gate({ ...edge, once: true }, { firedOnce: true }, 9e9, 'v').fire === false);
check('gate disabled never fires', P.gate({ ...edge, enabled: false }, {}, 9e9, 'v').fire === false);
check('gate returns state on fire', (() => { const g = P.gate(edge, {}, 5000, 'v'); return g.state.lastFired === 5000 && g.state.lastValue === 'v' && g.state.firedOnce === true; })());

/* ------------------------------------------------------------------ cycles */
// A→B exists; adding B→A closes a loop; adding A→C does not.
const edges = [
  { enabled: true, name: 'ab', source: { urls: 'A' }, sink: { urls: 'B' } }
];
check('wouldCycle self-loop A→A', P.wouldCycle([], 'A', 'A') === true);
check('wouldCycle B→A closes A→B', P.wouldCycle(edges, 'B', 'A') === true);
check('wouldCycle A→C is safe', P.wouldCycle(edges, 'A', 'C') === false);
check('wouldCycle ignores disabled edges', P.wouldCycle([{ enabled: false, source: { urls: 'A' }, sink: { urls: 'B' } }], 'B', 'A') === false);
// transitive: A→B, B→C present; C→A would close a 3-cycle
const chain = [
  { enabled: true, source: { urls: 'A' }, sink: { urls: 'B' } },
  { enabled: true, source: { urls: 'B' }, sink: { urls: 'C' } }
];
check('wouldCycle transitive C→A', P.wouldCycle(chain, 'C', 'A') === true);
check('wouldCycle transitive C→D safe', P.wouldCycle(chain, 'C', 'D') === false);
check('graphCycle clean chain = null', P.graphCycle(chain) === null);
check('graphCycle detects present loop', P.graphCycle(chain.concat([{ enabled: true, source: { urls: 'C' }, sink: { urls: 'A' } }])) !== null);
// empty-pattern edges both collapse to the '*' node → self-loop
check('wouldCycle any→any self-loop', P.wouldCycle([], '', '') === true);

/* ----------------------------------------------------------------- runEdge */
const full = {
  enabled: true, cooldownMs: 1000, dedupe: true, once: false,
  source: { kind: 'regex', pattern: '(https?://\\S+)' },
  filter: { kind: 'ops', value: 'first' },
  sink: { kind: 'navigate' }
};
const r1 = P.runEdge(full, { text: 'see https://a.com and https://b.com' }, {}, 1000, 0);
check('runEdge fires + builds navigate msg', r1.fire === true && r1.message.act === 'navigate' && r1.message.url === 'https://a.com', JSON.stringify(r1));
check('runEdge threads hops', r1.hops === 1);
const r2 = P.runEdge(full, { text: 'see https://a.com' }, r1.state, 1200, 0);
check('runEdge dedupe blocks same value in cooldown', r2.fire === false);
check('runEdge no-match yields no fire', P.runEdge(full, { text: 'nothing here' }, {}, 9e9, 0).fire === false);
check('runEdge drops at hop budget', P.runEdge(full, { text: 'https://a.com' }, {}, 9e9, P.HOP_BUDGET).fire === false);

/* ------------------------------------------------------------ app sink ---- */
// The one sink that leaves the browser: deliver into another running app by calling a typed verb
// on its bus socket. Three things are load-bearing and none are obvious.
//
// 1. {q} must be spliced JSON-ESCAPED. Page text carries quotes, backslashes and newlines; a raw
//    splice turns a valid template into a parse error on some pages and not others.
// 2. An unparseable template must deliver NOTHING rather than a guess — a half-built args object
//    reaching another app is worse than no delivery.
// 3. An app sink cannot close a graph cycle, because nothing it writes lands in a pane a source
//    could read back. Sharing the pane graph's "any pane" node would refuse it as a self-loop.
const appSink = { kind: 'app', app: 'zcite', verb: 'item.add', args: '{"title":"{q}"}' };
const appMsg = P.buildSinkMessage(appSink, ['hello']);
eq('app sink builds a typed call', appMsg, { act: 'app', app: 'zcite', verb: 'item.add', args: { title: 'hello' }, text: 'hello' });

const messy = 'a "quoted" line\\with a backslash';
const escMsg = P.buildSinkMessage(appSink, [messy]);
check('app sink JSON-escapes {q} instead of splicing it raw', escMsg && escMsg.args.title === messy, JSON.stringify(escMsg));

const plainMsg = P.buildSinkMessage({ kind: 'app', app: 'zreq', verb: 'request.send' }, ['one', 'two']);
eq('app sink with no template sends the joined text as q', plainMsg && plainMsg.args, { q: 'one\ntwo' });

check('app sink with an unparseable template delivers nothing',
  P.buildSinkMessage({ kind: 'app', app: 'z', verb: 'v', args: '{"a":' }, ['x']) === null);

check('app sink needs a bus name', P.validateEdge({ name: 'n', source: { kind: 'url' }, sink: { kind: 'app', verb: 'v' } }).ok === false);
check('app sink needs a verb', P.validateEdge({ name: 'n', source: { kind: 'url' }, sink: { kind: 'app', app: 'zcite' } }).ok === false);
check('app sink rejects a bus name that escapes the socket dir',
  P.validateEdge({ name: 'n', source: { kind: 'url' }, sink: { kind: 'app', app: '../zcite', verb: 'v' } }).ok === false);
check('app sink rejects args that are not JSON once {q} is removed',
  P.validateEdge({ name: 'n', source: { kind: 'url' }, sink: { kind: 'app', app: 'zcite', verb: 'v', args: '{oops' } }).ok === false);
check('a valid app sink passes validation',
  P.validateEdge({ name: 'n', source: { kind: 'url' }, sink: appSink }).ok === true);

// The cycle guard: a pane sink with no URL filter collapses onto the "any pane" node and a
// source with no filter is that same node, so pane→pane is (correctly) a self-loop. The app
// sink must NOT share that node.
check('an unfiltered pane→pane edge is still a self-loop', P.wouldCycle([], '', P.sinkNode({ kind: 'navigate', urls: '' })) === true);
check('an unfiltered app sink is not a self-loop', P.wouldCycle([], '', P.sinkNode(appSink)) === false);
check('sinkNode addresses an app sink by bus name and verb', P.sinkNode(appSink) === 'app:zcite.item.add');
check('an app-sink edge introduces no cycle in the whole graph',
  P.graphCycle([{ enabled: true, source: { urls: '' }, sink: appSink }]) === null);

// runEdge end to end, so the reactive path (extract → filter → gate → message) really produces the
// cross-app call and dedupes on its text like every other sink.
const appEdge = {
  enabled: true, cooldownMs: 1000, dedupe: true, once: false,
  source: { kind: 'regex', pattern: '(10\\.\\d{4}/\\S+)' },
  filter: { kind: 'ops', value: 'first' },
  sink: { kind: 'app', app: 'zcite', verb: 'item.add', args: '{"doi":"{q}"}' }
};
const ar = P.runEdge(appEdge, { text: 'see doi 10.1000/xyz123 in the paper' }, {}, 1000, 0);
check('runEdge fires an app sink with the extracted argument',
  ar.fire === true && ar.message.act === 'app' && ar.message.args.doi === '10.1000/xyz123', JSON.stringify(ar));
check('an app sink dedupes on its delivered text', P.runEdge(appEdge, { text: '10.1000/xyz123' }, ar.state, 1200, 0).fire === false);

/* -------------------------------------------------------------------------- */
if (fail === 0) console.log(`ALL ✓ — pipes engine nominal (${pass} checks)`);
else console.log(`${fail} CHECK(S) FAILED (${pass} passed)`);
process.exit(fail === 0 ? 0 : 1);
