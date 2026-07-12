// Page Actions test (zpageactions.js). The content script exposes its pure
// filter-string builder + action catalogue on window.__zbPageFilter /
// window.__zbPageActions and bails before touching the DOM/chrome when those are
// absent, so it loads headless here.
import fs from 'node:fs';
import assert from 'node:assert/strict';

const src = fs.readFileSync(new URL('../zpageactions.js', import.meta.url), 'utf8');
const win = {};
new Function('window', src)(win);
const filter = win.__zbPageFilter;
const actions = win.__zbPageActions;
assert.ok(filter && actions, 'page-action helpers not exposed');

// A real Vivaldi-style catalogue, each mapping to a CSS filter.
assert.ok(actions.length >= 8, 'a real set of page actions');
const keys = actions.map((a) => a[0]);
['grayscale', 'sepia', 'invert', 'blur', 'contrast'].forEach((k) => assert.ok(keys.includes(k), `has ${k}`));

// No active actions -> empty filter (no-op, page unchanged).
assert.equal(filter({}), '');
assert.equal(filter(null), '');

// Single action maps to its CSS filter.
assert.equal(filter({ grayscale: true }), 'grayscale(1)');
assert.equal(filter({ blur: true }), 'blur(2px)');

// Multiple active actions concatenate in catalogue order (stacking filters).
const s = filter({ blur: true, grayscale: true });
assert.match(s, /grayscale\(1\)/);
assert.match(s, /blur\(2px\)/);
assert.ok(s.indexOf('grayscale') < s.indexOf('blur'), 'filters concatenate in catalogue order');

// A falsey/absent action never contributes.
assert.equal(filter({ grayscale: false, sepia: true }), 'sepia(1)');

// Every catalogue entry produces a valid-looking css filter token.
actions.forEach((a) => assert.match(a[2], /\w+\([^)]*\)/, `${a[0]} has a css filter`));

console.log('page actions: all assertions passed');
