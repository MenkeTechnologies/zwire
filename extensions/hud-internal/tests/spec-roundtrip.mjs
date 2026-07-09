#!/usr/bin/env node
// Round-trip test for the ZWIRE_AUDIO_EQ "spec string" logic in pages/audio.js.
//
// buildSpec() serializes preamp + EQ bands + channel-strip directives into a
// ';'-delimited string; parseSpec() parses it back. The string is the wire
// contract with the C++ audio engine (fork patch 0022 ParseZwireEqSpec), so
// round-trip fidelity and the exact directive NAMES are load-bearing.
//
// This test does NOT re-implement the logic. It reads pages/audio.js, extracts
// the real buildSpec/parseSpec/flat function SOURCE via brace matching, and
// evaluates it inside a stub scope (the eng* globals, eq, preampDb). Whatever
// audio.js actually does is what gets tested — no hand-rewritten mirror to drift.
//
// Pure Node, no browser / chrome.* APIs. Deterministic. Exits non-zero on any
// failure.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const AUDIO_JS = resolve(__dirname, '../pages/audio.js');
const PATCH = resolve(__dirname, '../../../fork/patches/0022-audio-eq-output.patch');

/* ---- extract a function's full source (string-literal aware brace match) ---- */
function extractFn(src, header) {
  const at = src.indexOf(header);
  if (at < 0) throw new Error(`could not find "${header}" in pages/audio.js`);
  const braceStart = src.indexOf('{', at);
  if (braceStart < 0) throw new Error(`no body brace after "${header}"`);
  let depth = 0, i = braceStart, quote = null;
  for (; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === '\\') { i++; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  if (depth !== 0) throw new Error(`unbalanced braces extracting "${header}"`);
  return src.slice(at, i);
}

const audioSrc = readFileSync(AUDIO_JS, 'utf8');
const flatSrc = extractFn(audioSrc, 'function flat()');
const buildSpecSrc = extractFn(audioSrc, 'function buildSpec()');
const parseSpecSrc = extractFn(audioSrc, 'function parseSpec(spec)');

/* ---- stub scope: the globals buildSpec reads, with audio.js's own defaults ---- */
const STATE = {
  engGain: 1.0, engPan: 0.0, engMono: false, engDrive: 0.0,
  engThresh: 0.0, engRatio: 1.0,
  engWidth: 1.0, engDelayMs: 0.0, engDelayFb: 0.3, engDelayMix: 0.0,
  engReverbMix: 0.0, engRoom: 0.5, engDamp: 0.5,
  engLimit: false, engCeiling: -1.0,
  engBypass: false, engMute: false,
  preampDb: 0, eq: null
};
const names = Object.keys(STATE);
const decls = names.map((n) => `var ${n} = ${JSON.stringify(STATE[n])};`).join('\n');
const setBody = names.map((n) => `if ('${n}' in s) ${n} = s.${n};`).join('\n');

const harness = `
'use strict';
${decls}
${flatSrc}
${buildSpecSrc}
${parseSpecSrc}
function __set(s){ ${setBody} }
function __reset(){ __set(${JSON.stringify(STATE)}); }
return { buildSpec: buildSpec, parseSpec: parseSpec, set: __set, reset: __reset };
`;

// eslint-disable-next-line no-new-func
const M = Function(harness)();

/* ---- accepted directive names, read straight from the C++ patch source ---- */
const patchSrc = readFileSync(PATCH, 'utf8');
const ACCEPTED = new Set();
for (const m of patchSrc.matchAll(/f\[0\]\s*==\s*"([a-z]+)"/g)) ACCEPTED.add(m[1]);
if (ACCEPTED.size === 0) throw new Error('extracted zero directive names from patch 0022');

/* ---- tiny hand-rolled assert ---- */
let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log(`PASS  ${name}`); }
  else { failures++; console.log(`FAIL  ${name}${detail ? '  — ' + detail : ''}`); }
}
const approx = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

/* -------------------------------------------------------------------------- */
/* (a) non-default engine state round-trips through buildSpec -> parseSpec     */
/* -------------------------------------------------------------------------- */
M.reset();
// custom bands via an `eq` stub with .get() (mirrors Z.parametricEq)
const customBands = [
  { type: 'lowshelf', freq: 80, gain: 6, q: 0.7 },
  { type: 'peaking', freq: 250, gain: -3, q: 1.0 },
  { type: 'peaking', freq: 1000, gain: 4, q: 2.0 },
  { type: 'peaking', freq: 4000, gain: -2, q: 1.5 },
  { type: 'highshelf', freq: 12000, gain: 3, q: 0.7 }
];
M.set({
  preampDb: 2.5,
  eq: { get: () => customBands.map((b) => ({ ...b })) },
  engGain: 1.5,
  engPan: -0.25,
  engMono: true,
  engDrive: 0.4,
  engThresh: -18.0, engRatio: 4.0,
  engWidth: 1.5,
  engDelayMs: 120.0, engDelayFb: 0.45, engDelayMix: 0.3,
  engReverbMix: 0.35, engRoom: 0.6, engDamp: 0.4,
  engLimit: true, engCeiling: -3.0
});
const spec = M.buildSpec();
const cfg = M.parseSpec(spec);

check('(a) preampDb round-trips', cfg && approx(cfg.preampDb, 2.5), `got ${cfg && cfg.preampDb}`);
check('(a) band count preserved (5)', cfg && cfg.bands.length === 5, `got ${cfg && cfg.bands.length}`);
check('(a) bands round-trip (type/freq/gain/q)',
  cfg && customBands.every((b, i) => {
    const g = cfg.bands[i];
    return g && g.type === b.type && approx(g.freq, b.freq) && approx(g.gain, b.gain) && approx(g.q, b.q);
  }),
  cfg && JSON.stringify(cfg.bands));

const s = cfg ? cfg.strip : {};
const stripExpect = {
  gain: 1.5, pan: -0.25, mono: true, drive: 0.4,
  thresh: -18, ratio: 4, width: 1.5,
  delayMs: 120, delayFb: 0.45, delayMix: 0.3,
  reverbMix: 0.35, room: 0.6, damp: 0.4,
  limit: true, ceiling: -3
};
for (const [k, want] of Object.entries(stripExpect)) {
  const got = s[k];
  const ok = typeof want === 'boolean' ? got === want : approx(got, want, 1e-6);
  check(`(a) strip.${k} round-trips (${want})`, ok, `got ${got}`);
}

/* -------------------------------------------------------------------------- */
/* (b) default values are OMITTED from the spec                                */
/* -------------------------------------------------------------------------- */
M.reset(); // unity everything, eq=null -> flat() bands, preampDb=0
const unity = M.buildSpec();
const unityParts = unity.split(';');
const OMIT = ['gain', 'pan', 'mono', 'drive', 'thresh', 'ratio',
  'width', 'delay', 'feedback', 'delaymix', 'reverb', 'room', 'damp', 'ceiling'];
const emittedNames = unityParts
  .map((p) => p.split(','))
  .filter((f) => f.length === 2)
  .map((f) => f[0]);
check('(b) unity spec emits ZERO channel-strip directives',
  emittedNames.length === 0, `emitted: [${emittedNames.join(', ')}]`);
check('(b) unity spec still carries preamp + 5 bands',
  unityParts.length === 6 && unityParts[0] === '0.00', `spec: ${unity}`);
// belt-and-suspenders: none of the omit-list names appear anywhere
check('(b) no default directive name leaks into unity spec',
  OMIT.every((n) => !emittedNames.includes(n)), `emitted: [${emittedNames.join(', ')}]`);

/* -------------------------------------------------------------------------- */
/* (c) engBypass=true yields spec "off"                                        */
/* -------------------------------------------------------------------------- */
M.reset();
M.set({ engBypass: true });
check('(c) engBypass=true -> spec "off"', M.buildSpec() === 'off', `got "${M.buildSpec()}"`);

/* -------------------------------------------------------------------------- */
/* (d) every directive NAME buildSpec emits is accepted by the C++ engine      */
/* -------------------------------------------------------------------------- */
// Use the fully-loaded spec from (a) so every directive branch fired.
const emittedDirectives = spec.split(';')
  .map((p) => p.split(','))
  .filter((f) => f.length === 2)
  .map((f) => f[0]);
check('(d) full spec exercised every strip directive branch',
  emittedDirectives.length === 14, `emitted ${emittedDirectives.length}: [${emittedDirectives.join(', ')}]`);
const unknown = emittedDirectives.filter((n) => !ACCEPTED.has(n));
check('(d) all emitted directive names are in the C++ ParseZwireEqSpec accepted set',
  unknown.length === 0,
  unknown.length ? `unknown: [${unknown.join(', ')}]  accepted: [${[...ACCEPTED].join(', ')}]` : '');

/* -------------------------------------------------------------------------- */
console.log('');
if (failures === 0) console.log(`ALL ${'✓'} — spec round-trip nominal`);
else console.log(`${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
