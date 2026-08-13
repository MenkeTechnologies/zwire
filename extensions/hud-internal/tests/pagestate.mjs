// Page-projection engine test (zpage-core.js) — the browser half of "the rendered page as typed
// state on the suite bus".
//
// What another app receives when it asks this browser what it is showing is decided entirely here,
// so this file pins the three things that would be invisible failures:
//
//   1. FORM VALUES NEVER LEAVE. `page.forms` publishes a form's shape to every process on the
//      machine's bus. A projection that also carried `value` would hand over autofilled
//      credentials and a half-typed card number, and it would look exactly like a working feature.
//   2. THE CATALOGUE MATCHES THE HOST. The ids live in two languages — zpage-core.js and
//      native/zwire-host/src/page.rs — and a host that advertises `page.forms` while the browser
//      cannot project it answers `unknown projection` to a script that read the manifest correctly.
//   3. A URL FILTER THAT MATCHES NOTHING ANSWERS NOTHING. Falling back to the active tab would
//      answer a question about a DIFFERENT page than the one asked about, with no way to tell.
//
// zpage-core.js is an IIFE over a `window`-like global and is pure by construction, so it loads
// headless with no DOM and no chrome.*. The DOM it projects is a hand-rolled element shim (the same
// approach as tests/history-render.mjs — no jsdom), with a real, if small, selector matcher.
import fs from 'node:fs';
import assert from 'node:assert/strict';

const src = fs.readFileSync(new URL('../zpage-core.js', import.meta.url), 'utf8');
const root = {};
new Function('self', 'module', src)(root, { exports: {} });
const P = root.ZWIRE_PAGE;
assert.ok(P, 'ZWIRE_PAGE missing');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; }
  else { fail++; console.log(`FAIL  ${name}${detail ? '  — ' + detail : ''}`); }
}
const eq = (name, got, want) => check(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);

/* ---------------------------------------------------------------- DOM shim */
// Simple selectors only — `tag`, `tag[attr]`, `tag[attr="value"]`, comma lists — which is exactly
// what the engine uses. Matching walks descendants once and tests each node against the whole
// selector list, so results come back in document order like the real querySelectorAll.
function parseSel(sel) {
  return String(sel).split(',').map((s) => {
    const m = /^\s*([a-z0-9]+)(?:\[([a-zA-Z-]+)(?:="([^"]*)")?\])?\s*$/.exec(s);
    if (!m) throw new Error('unsupported selector in shim: ' + s);
    return { tag: m[1].toUpperCase(), attr: m[2] || null, value: m[3] === undefined ? null : m[3] };
  });
}
function el(tag, attrs = {}, kids = [], txt = '') {
  const node = {
    tagName: tag.toUpperCase(),
    attrs,
    children: kids,
    _txt: txt,
    getAttribute(n) { return Object.prototype.hasOwnProperty.call(this.attrs, n) ? String(this.attrs[n]) : null; },
    hasAttribute(n) { return Object.prototype.hasOwnProperty.call(this.attrs, n); },
    get textContent() { return this._txt + this.children.map((c) => c.textContent).join(''); },
    querySelectorAll(sel) {
      const want = parseSel(sel), out = [];
      (function walk(n) {
        n.children.forEach((c) => {
          const hit = want.some((w) => c.tagName === w.tag
            && (!w.attr || c.hasAttribute(w.attr))
            && (w.value === null || c.getAttribute(w.attr) === w.value));
          if (hit) out.push(c);
          walk(c);
        });
      })(node);
      return out;
    },
  };
  // The DOM exposes RESOLVED urls on these properties; the attribute keeps the raw markup.
  if (node.tagName === 'A' || node.tagName === 'LINK') node.href = attrs.href && /^https?:/.test(attrs.href) ? attrs.href : 'https://shop.example/' + String(attrs.href || '').replace(/^\//, '');
  if (node.tagName === 'FORM') node.action = 'https://shop.example/' + String(attrs.action || '').replace(/^\//, '');
  return node;
}
function doc(bodyKids, headKids = [], title = 'Receipt') {
  const body = el('body', {}, bodyKids);
  const head = el('head', {}, headKids);
  const d = el('html', {}, [head, body]);
  d.title = title;
  d.body = body;
  d.location = { href: 'https://shop.example/orders/9?ref=mail' };
  return d;
}

/* ------------------------------------------------------------- the page */
const page = doc(
  [
    el('h1', {}, [], 'Order confirmed'),
    el('h2', {}, [], 'Items'),
    el('p', {}, [], '  Thank\n you  '),
    el('a', { href: '/receipt' }, [], 'View receipt'),
    el('a', { href: 'https://ship.example/t/42' }, [], 'Track'),
    el('a', {}, [], 'no href'),
    el('table', {}, [
      el('caption', {}, [], 'Line items'),
      el('tr', {}, [el('th', {}, [], 'Item'), el('th', {}, [], 'Qty')]),
      el('tr', {}, [el('td', {}, [], 'Cable'), el('td', {}, [], '2')]),
    ]),
    el('form', { action: '/pay', method: 'POST' }, [
      el('input', { name: 'card', type: 'text', value: '4111111111111111', placeholder: 'card number', required: '' }),
      el('input', { name: 'cvv', type: 'password', value: '123' }),
      el('select', { name: 'plan' }),
      el('textarea', { id: 'note' }),
    ]),
  ],
  [
    el('meta', { name: 'description', content: 'Your order' }),
    el('meta', { property: 'og:title', content: 'Order 9' }),
    el('link', { rel: 'canonical', href: '/orders/9' }),
    el('script', { type: 'application/ld+json' }, [], '{"@type":"Order","orderNumber":"9"}'),
    el('script', { type: 'application/ld+json' }, [], '{ broken'),
  ]
);

/* --------------------------------------------------------- projections */
eq('page.url', P.project(page, 'page.url', {}), 'https://shop.example/orders/9?ref=mail');
eq('page.title', P.project(page, 'page.title', {}), 'Receipt');
// Rendered text is whitespace-collapsed, so a postcondition matches what the user sees rather than
// how the markup was indented.
check('page.text collapses whitespace', P.project(page, 'page.text', {}).includes('Thank you'), P.project(page, 'page.text', {}));
eq('page.headings', P.project(page, 'page.headings', {}), [
  { level: 1, text: 'Order confirmed' },
  { level: 2, text: 'Items' },
]);
eq('page.links resolves hrefs and skips anchors without one', P.project(page, 'page.links', {}), [
  { text: 'View receipt', href: 'https://shop.example/receipt' },
  { text: 'Track', href: 'https://ship.example/t/42' },
]);
eq('page.tables', P.project(page, 'page.tables', {}), [
  { caption: 'Line items', rows: [['Item', 'Qty'], ['Cable', '2']] },
]);
eq('page.selection is supplied by the caller', P.project(page, 'page.selection', { selection: '  picked   text ' }), 'picked text');

const meta = P.project(page, 'page.meta', {});
eq('page.meta description', meta.description, 'Your order');
eq('page.meta og', meta.og, { title: 'Order 9' });
eq('page.meta canonical', meta.canonical, 'https://shop.example/orders/9');
// One malformed JSON-LD block must not cost the valid ones.
eq('page.meta jsonld skips the broken block', meta.jsonld, [{ '@type': 'Order', orderNumber: '9' }]);

/* ------------------------------------------------- THE SAFETY ASSERTION */
const forms = P.project(page, 'page.forms', {});
eq('page.forms shape', forms, [{
  action: 'https://shop.example/pay',
  method: 'post',
  fields: [
    { name: 'card', type: 'text', required: true },
    { name: 'cvv', type: 'password', required: false },
    { name: 'plan', type: 'select', required: false },
    { name: 'note', type: 'textarea', required: false },
  ],
}]);
// Belt and braces on the same claim, stated as the thing that must never appear ANYWHERE in the
// projection — not just as a field this shape happens to omit today.
const formsJson = JSON.stringify(forms);
check('page.forms never carries a field value', !formsJson.includes('4111111111111111') && !formsJson.includes('123') && !/"value"/.test(formsJson), formsJson);
check('page.forms never carries a placeholder', !formsJson.includes('card number'), formsJson);

/* ------------------------------------------------------------- extract */
eq('page.extract by selector', P.project(page, 'page.extract', { selector: 'h1' }), [{ text: 'Order confirmed' }]);
eq('page.extract with an attribute', P.project(page, 'page.extract', { selector: 'a[href]', attr: 'href' }),
  [{ text: 'View receipt', attr: '/receipt' }, { text: 'Track', attr: 'https://ship.example/t/42' }]);
check('page.extract without a selector is an error, not an empty list', !!P.project(page, 'page.extract', {}).__err);
check('an unknown projection is an error', !!P.project(page, 'page.nope', {}).__err);
check('a missing document is an error', !!P.project(null, 'page.text', {}).__err);

/* ---------------------------------------------------------------- caps */
const many = doc(Array.from({ length: P.MAX_ITEMS + 40 }, (_, i) => el('a', { href: '/x' + i }, [], 'l' + i)));
check('list projections are capped', P.project(many, 'page.links', {}).length === P.MAX_ITEMS, String(P.project(many, 'page.links', {}).length));

/* -------------------------------------------------------- origin gate */
check('https is readable', P.originAllowed('https://shop.example/x', []).ok);
check('file is readable', P.originAllowed('file:///tmp/a.html', []).ok);
check('chrome:// is not', P.originAllowed('chrome://settings', []).ok === false);
check('extension pages are not', P.originAllowed('chrome-extension://abc/page.html', []).ok === false);
check('an empty url is not', P.originAllowed('', []).ok === false);
check('a deny pattern blocks the origin', P.originAllowed('https://bank.example/accounts', ['bank\\.example']).ok === false);
check('a deny pattern that does not match lets it through', P.originAllowed('https://shop.example/x', ['bank\\.example']).ok);
// A rule that stopped applying because of a typo would silently expose the origin it was written
// to protect, so an unparsable rule denies rather than being skipped.
check('an unparsable deny rule denies', P.originAllowed('https://shop.example/x', ['bank(']).ok === false);

/* ------------------------------------------------------- tab planning */
const tabs = [
  { id: 1, url: 'https://a.example/', active: false },
  { id: 2, url: 'https://b.example/x', active: true },
  { id: 3, url: 'https://c.example/', active: false },
];
eq('default is the active tab', P.planTargets(tabs, {}).id, 2);
eq('an explicit tabId wins', P.planTargets(tabs, { tabId: 3 }).id, 3);
eq('a url filter picks the first match in any window', P.planTargets(tabs, { urls: 'c\\.example' }).id, 3);
check('an unknown tabId answers nothing', P.planTargets(tabs, { tabId: 99 }) === null);
check('a url filter matching nothing answers nothing, never the active tab', P.planTargets(tabs, { urls: 'zzz' }) === null);
check('an unparsable url filter answers nothing', P.planTargets(tabs, { urls: '(' }) === null);
check('no tabs at all answers nothing', P.planTargets([], {}) === null);

/* ------------------------------------------- catalogue parity with the host */
// The host's catalogue is the source of truth for what the bus advertises; this file is the source
// of truth for what can actually be projected. They are in different languages and different repos,
// which is exactly how a manifest starts lying.
const rs = fs.readFileSync(new URL('../native/zwire-host/src/page.rs', import.meta.url), 'utf8');
const block = /pub const STATES: &\[\(&str, &str\)\] = &\[([\s\S]*?)\n\];/.exec(rs);
check('the host catalogue is where this test expects it', !!block, 'STATES not found in native/zwire-host/src/page.rs');
if (block) {
  const hostStates = [...block[1].matchAll(/\(\s*"([^"]+)"\s*,\s*"((?:[^"\\]|\\.)*)"\s*,?\s*\)/g)]
    .map((m) => ({ id: m[1], label: m[2] }));
  eq('every host state id is projectable, in the same order', P.PROJECTIONS.map((p) => p.id), hostStates.map((s) => s.id));
  // Labels too: they are what a picker shows, so a host that renames one and a browser that does
  // not leaves the user reading a description of a different projection.
  eq('labels match the host', P.PROJECTIONS.map((p) => p.label), hostStates.map((s) => s.label));
  hostStates.forEach((s) => check('host state ' + s.id + ' is a known projection', P.isProjection(s.id)));
}
const extractVerb = /pub const EXTRACT_VERB: &str = "([^"]+)"/.exec(rs);
eq('the extract verb matches the host', P.EXTRACT, extractVerb && extractVerb[1]);

// The postcondition ops the step wizard offers must be exactly the ones the host will accept: an op
// in the picker that the host refuses is a chain that reverts because of its own editor.
const opsBlock = /pub const ASSERT_OPS: &\[\(&str, &str\)\] = &\[([\s\S]*?)\n\];/.exec(rs);
check('the host op catalogue is where this test expects it', !!opsBlock);
if (opsBlock) {
  const hostOps = [...opsBlock[1].matchAll(/\(\s*\n?\s*"([a-z_]+)"/g)].map((m) => m[1]);
  const wiz = fs.readFileSync(new URL('../pages/step-wizard.js', import.meta.url), 'utf8');
  const wizOps = /var ASSERT_OPS = \[([^\]]*)\]/.exec(wiz);
  check('the wizard publishes an op list', !!wizOps);
  if (wizOps) {
    const offered = [...wizOps[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    eq('the wizard offers exactly the host ops', offered, hostOps);
  }
}

console.log(`pagestate: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
