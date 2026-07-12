// Inline-compute engine test (palette-cmds.js) — the calc / unit / percentage /
// currency ports of zgo-core, plus the compute provider's routing. Loaded via
// `new Function` (the file is an IIFE that hangs its API off a `window`-like
// global), so no DOM/chrome is needed and it runs headless in CI. Assertions
// mirror the zgo-core Rust test vectors (calc.rs / units.rs / numfmt.rs /
// currency.rs) so a drift in the JS port is caught here.
import fs from 'node:fs';
import assert from 'node:assert/strict';

const src = fs.readFileSync(new URL('../palette-cmds.js', import.meta.url), 'utf8');
const root = {};
new Function('window', src)(root);
const PC = root.ZWIRE_PALETTE_CMDS;
assert.ok(PC && PC.makeComputeProvider, 'ZWIRE_PALETTE_CMDS.makeComputeProvider missing');

const near = (a, b) => Math.abs(a - b) < 1e-6;

// ---- calc.rs vectors ----
assert.equal(PC.calcEval('2 + 3 * 4'), 14);
assert.equal(PC.calcEval('(2 + 3) * 4'), 20);
assert.equal(PC.calcEval('2 ^ 3 ^ 2'), 512, 'exponent must be right-associative');
assert.equal(PC.calcEval('--5'), 5);
assert.equal(PC.calcEval('17 % 5'), 2);
assert.equal(PC.calcEval('sqrt(16)'), 4);
assert.ok(near(PC.calcEval('log(1000)'), 3));
assert.equal(PC.calcEval('1e3'), 1000);
assert.equal(PC.calcEval('2.5e-1'), 0.25);
assert.equal(PC.fmtNum(4), '4');
assert.equal(PC.fmtNum(0.25), '0.25');
assert.equal(PC.fmtNum(1 / 3), '0.3333333333');
for (const bad of ['2 +', '2 2', '1 / 0', 'nope(2)', '(1 + 2']) {
  assert.throws(() => PC.calcEval(bad), new RegExp('.'), `calc should reject: ${bad}`);
}

// ---- units.rs vectors ----
assert.ok(near(PC.unitConvert(1, 'km', 'm').result, 1000));
assert.ok(near(PC.unitConvert(1, 'mile', 'km').result, 1.609344));
assert.ok(near(PC.unitConvert(100, 'c', 'f').result, 212));
assert.ok(near(PC.unitConvert(32, 'f', 'c').result, 0));
assert.ok(near(PC.unitConvert(0, 'c', 'k').result, 273.15));
assert.ok(near(PC.unitConvert(1, 'gb', 'mb').result, 1000));
assert.ok(near(PC.unitConvert(1, 'byte', 'bits').result, 8));
assert.ok(near(PC.unitParseConvert('10 km to miles').result, 6.213711922373339));
assert.ok(near(PC.unitParseConvert('72 f in c').result, 22.22222222222222));
assert.ok(near(PC.unitParseConvert('60 mph -> kmh').result, 96.56064));
assert.throws(() => PC.unitConvert(1, 'km', 'kg'), /dimension|cannot/i, 'dimension mismatch must throw');

// ---- numfmt.rs percentage vectors ----
assert.equal(PC.percent('20% of 150').result, 30);
assert.equal(PC.percent('45 of 60').result, 75);
assert.equal(PC.percent('20% off 150').result, 120);
assert.equal(PC.percent('150 + 20%').result, 180);
assert.equal(PC.percent('150 - 20%').result, 120);
assert.equal(PC.percent('10 to 12').result, 20);
assert.equal(PC.percent('hello world'), null);

// ---- currency.rs cross-rate (base USD, units-per-base) ----
assert.equal(PC.currencyParse('100 usd to eur').from, 'usd');
assert.equal(PC.currencyParse('5 EUR in JPY').to, 'JPY', 'currency codes keep original case');
assert.equal(PC.currencyParse('100 usd'), null);
PC.primeRates((cb) => cb({ rates: { USD: 1, EUR: 0.92, JPY: 150 }, ts: 1 }), () => {});
assert.ok(near(PC.currencyConvert(10, 'usd', 'eur').result, 9.2));
assert.ok(near(PC.currencyConvert(1, 'EUR', 'JPY').result, 150 / 0.92));
assert.throws(() => PC.currencyConvert(1, 'USD', 'GBP'), /no rate/i, 'unknown currency must throw');

// ---- provider routing: exactly one top-pinned copyable row per compute query ----
let copied = null, stryked = null;
const prov = PC.makeComputeProvider({ copy: (t) => { copied = t; }, toast: () => {}, runStryke: (c) => { stryked = c; } });
const one = (q) => { const r = prov(q); return r.length ? r[0] : null; };

let row = one('2+3*4');
assert.ok(row && row.label === '= 14' && row.top === true, 'calc row pins top');
row.run();
assert.equal(copied, '14', 'running the calc row copies the result');

assert.match(one('10 km to miles').label, /6\.213.*miles/, 'unit conversion routes to unit row');
assert.equal(one('20% of 150').label, '= 30', 'percentage routes to percent row');
assert.match(one('100 usd to eur').label, /92 EUR/, 'currency routes once rates are loaded');
assert.match(one('10 km to miles').label, /miles/, 'a unit like km never steals the currency path');

row = one('@ p 2+2');
assert.ok(row && row.label === 'stryke: p 2+2', 'the @-prefix routes to a stryke row');
row.run();
assert.equal(stryked, 'p 2+2', 'running the stryke row dispatches the code');

assert.equal(prov('github').length, 0, 'a bare word yields no compute row');
assert.equal(prov('5').length, 0, 'a bare number yields no compute row (not a sum)');
assert.equal(prov('@').length, 0, 'a bare @ yields no compute row');

console.log('compute engine: all assertions passed');
