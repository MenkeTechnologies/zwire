// Ctrl+` terminal overlay test (lib/term/term-overlay.js) — the terminal on EXTENSION pages.
//
// Content scripts match http/https/file/chrome://*, so the overlay every web page gets never
// reaches a HUD page or the new-tab page. term-overlay.js is what puts the keystroke there, by
// framing the HUD's own Terminal page. Three things make that work, and each fails silently:
//
//   1. THE KEY. Same combo as the content-script overlay (zpalette.js), or the terminal is
//      "missing" on exactly the pages this file exists to serve.
//   2. THE URL. From a HUD page the frame resolves against this extension; from the new-tab
//      page it must address the HUD explicitly, because that page belongs to another
//      extension and a relative URL would point at a file that isn't there.
//   3. THE GRANT. Chromium allows a chrome-extension:// initiator to load a web-accessible
//      resource only via `extension_ids` — `"matches": ["<all_urls>"]` does NOT cover it
//      (web_accessible_resources_info.cc, IsResourceWebAccessibleImpl). So the HUD manifest
//      has to name the new-tab extension's id, and that id is derived from its manifest key:
//      rotate the key without updating the grant and the new-tab terminal frame goes blank.
//
// The new-tab extension cannot load a script from the HUD's origin (CSP `script-src 'self'`), so
// it carries a byte-identical copy at the same relative path; scripts/test.sh's SHARED-FILE
// PARITY gate is what keeps the two from drifting.
import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';

const SRC = new URL('../lib/term/term-overlay.js', import.meta.url);
const HUD_ID = 'omcgnnjfmbmpdlofklbpddkhnfibfhgg';

const src = fs.readFileSync(SRC, 'utf8');

// Minimal window/document shim: the file only needs a keydown/message listener sink and a
// body to hang the frame on. Nothing here renders — the assertions are on the pure halves.
function load() {
  const listeners = {};
  const win = {
    addEventListener: (t, fn) => { (listeners[t] = listeners[t] || []).push(fn); }
  };
  const doc = {
    addEventListener: (t, fn) => { (listeners['doc:' + t] = listeners['doc:' + t] || []).push(fn); },
    getElementById: () => null,
    body: null
  };
  new Function('window', 'document', 'location', 'chrome', src)(
    win, doc, { protocol: 'chrome-extension:', host: HUD_ID }, undefined);
  assert.ok(win.zwireTermOverlay, 'window.zwireTermOverlay missing');
  return { api: win.zwireTermOverlay, listeners, win };
}

let pass = 0, fail = 0;
const check = (name, cond, detail) => {
  if (cond) { pass++; return; }
  fail++;
  console.error(`  ✗ ${name}${detail ? ' — ' + detail : ''}`);
};

const { api, listeners, win } = load();

// ---- 1. the key ----
{
  const combo = (o) => api.isTermCombo(Object.assign({ ctrlKey: false, metaKey: false, altKey: false, key: '', code: '' }, o));
  check('Ctrl+` toggles', combo({ ctrlKey: true, key: '`' }));
  check('Ctrl+Backquote by code toggles (layout-independent)', combo({ ctrlKey: true, code: 'Backquote' }));
  check('Cmd+` does not', !combo({ metaKey: true, key: '`' }));
  check('Ctrl+Alt+` does not', !combo({ ctrlKey: true, altKey: true, key: '`' }));
  check('Ctrl+Cmd+` does not', !combo({ ctrlKey: true, metaKey: true, key: '`' }));
  check('a bare backtick does not', !combo({ key: '`' }));
  check('Ctrl+k does not', !combo({ ctrlKey: true, key: 'k' }));
  check('a missing event does not throw', api.isTermCombo(undefined) === false);
  check('the key is bound on the capture phase of document',
    (listeners['doc:keydown'] || []).length === 1);
  check('the frame relay is listening', (listeners.message || []).length === 1);
  check('toggleTerminalPopup is exposed for palette entries',
    typeof win.toggleTerminalPopup === 'function');
}

// ---- 2. the URL ----
{
  const fromNewTab = api.terminalUrl({ protocol: 'chrome-extension:', host: 'gpoepnekoiplhkegjpocnpeijiefgieb' });
  check('a foreign extension page addresses the HUD absolutely',
    fromNewTab === `chrome-extension://${HUD_ID}/pages/terminal.html`, fromNewTab);
  const fromHud = api.terminalUrl({ protocol: 'chrome-extension:', host: HUD_ID });
  check('a HUD page resolves to the same Terminal page',
    fromHud === `chrome-extension://${HUD_ID}/pages/terminal.html`, fromHud);
  check('a web page (a HUD page hosted nowhere else) still gets an absolute HUD URL',
    api.terminalUrl({ protocol: 'https:', host: 'example.com' }) === fromNewTab);
}

// ---- 3. the grant ----
{
  const hud = JSON.parse(fs.readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
  const ntManifest = JSON.parse(fs.readFileSync(new URL('../../../newtab/manifest.json', import.meta.url), 'utf8'));
  // Extension id = first 32 bytes of SHA-256 over the DER public key, hex mapped 0-9a-f -> a-p.
  const ntId = crypto.createHash('sha256').update(Buffer.from(ntManifest.key, 'base64')).digest('hex')
    .slice(0, 32).replace(/[0-9a-f]/g, (c) => 'abcdefghijklmnop'[parseInt(c, 16)]);
  const entry = (hud.web_accessible_resources || []).find((w) => (w.resources || []).includes('pages/*'));
  check('the HUD exposes pages/* as a web-accessible resource', !!entry);
  check('and grants it to the new-tab extension by id',
    !!entry && (entry.extension_ids || []).includes(ntId),
    `newtab id ${ntId} not in [${(entry && entry.extension_ids || []).join(', ')}]`);
  check('the HUD id this file frames matches the HUD manifest key',
    crypto.createHash('sha256').update(Buffer.from(hud.key, 'base64')).digest('hex')
      .slice(0, 32).replace(/[0-9a-f]/g, (c) => 'abcdefghijklmnop'[parseInt(c, 16)]) === HUD_ID);
}

// ---- the new-tab page actually loads it ----
// (That the vendored copy matches this one is the repo-level SHARED-FILE PARITY gate in
// scripts/test.sh, which already compares every same-path duplicate between the two trees.)
{
  check('the new-tab page loads the overlay',
    fs.readFileSync(new URL('../../../newtab/newtab.html', import.meta.url), 'utf8')
      .includes('lib/term/term-overlay.js'));
}

// ---- every HUD page keeps the binding ----
// A page added later that copies an existing page's <script> block should not quietly be the
// one page where Ctrl+` does nothing. terminal.html is exempt: it IS the terminal.
{
  const dir = new URL('../pages/', import.meta.url);
  const pages = fs.readdirSync(dir).filter((f) => f.endsWith('.html') && f !== 'terminal.html');
  const missing = pages.filter((f) => !fs.readFileSync(new URL(f, dir), 'utf8').includes('term-overlay.js'));
  check(`all ${pages.length} HUD pages include the overlay`, missing.length === 0, missing.join(', '));
}

console.log(`terminal-overlay: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
