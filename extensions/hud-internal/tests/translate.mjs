// Translate test (pages/translate.js). The page exposes its pure response parser
// + language list on window.ZBTranslate and bails before touching the DOM/fetch
// when the HUD shell is absent, so it loads headless here.
import fs from 'node:fs';
import assert from 'node:assert/strict';

const src = fs.readFileSync(new URL('../pages/translate.js', import.meta.url), 'utf8');
const win = {};
new Function('window', src)(win);
const T = win.ZBTranslate;
assert.ok(T && T.parseTranslation, 'window.ZBTranslate not exposed');

// A real translate_a/single shape: multi-segment result + detected source lang.
const resp = [
  [['Hello world', 'Hola mundo', null, null, 10], ['. ', '. ', null, null, 0]],
  null,
  'es',
];
const out = T.parseTranslation(resp);
assert.equal(out.text, 'Hello world. ', 'segments concatenated in order');
assert.equal(out.detected, 'es', 'detected source language surfaced');

// Degenerate / error payloads never throw — empty result.
assert.deepEqual(T.parseTranslation(null), { text: '', detected: '' });
assert.deepEqual(T.parseTranslation([]), { text: '', detected: '' });
assert.deepEqual(T.parseTranslation('nope'), { text: '', detected: '' });

// language list + lookup.
assert.ok(T.LANGS.length >= 20, 'a real language list');
assert.equal(T.langName('ja'), 'Japanese');
assert.equal(T.langName('zz'), 'zz', 'unknown code passes through');

// URL builder: keyless gtx endpoint, encoded query, sl/tl wired.
const u = T.translateUrl('a b & c', 'auto', 'fr');
assert.match(u, /translate\.googleapis\.com\/translate_a\/single/);
assert.match(u, /client=gtx/);
assert.match(u, /sl=auto&tl=fr/);
assert.match(u, /q=a%20b%20%26%20c/, 'query is URL-encoded');

console.log('translate: all assertions passed');
