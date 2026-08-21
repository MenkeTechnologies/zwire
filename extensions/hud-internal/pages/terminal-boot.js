// Boot for the dedicated Terminal tab. Extracted from an inline <script> in
// terminal.html because the extension CSP (`script-src 'self'`) blocks inline
// execution — same-origin external scripts are allowed.
//
// terminal.js auto-injects #terminalPane + wires Ctrl+`. In this dedicated tab
// show it immediately (fills the viewport via terminal.html's CSS) and spawn the
// PTY. Retry until terminal.js has injected the pane + exposed showTerminal.
//
// `?cd=<path>` opens the shell already in that directory — this is how the file
// browser's "Open Terminal" works (pages/files-host.js `fsOpenTerminal`), so that
// button opens ZWIRE's terminal rather than launching the platform's terminal
// application. `zwireTermRun` shows the pane, waits for the PTY to come alive,
// and writes the line, so it replaces the plain `showTerminal()` call.
// Framed by the Ctrl+` overlay (lib/term/term-overlay.js) rather than opened as a tab:
// hand that keystroke back to the host page. terminal.js binds Ctrl+` on the BUBBLE phase,
// so a capture-phase listener here sees it first and stops it — otherwise the key would
// hide the pane INSIDE the frame and leave the host showing an empty panel it still thinks
// is open. Only the host page decides whether the overlay is open.
if (window.top !== window) {
  document.addEventListener('keydown', function (e) {
    if (!e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key !== '`' && e.code !== 'Backquote') return;
    e.preventDefault();
    e.stopImmediatePropagation();
    try { window.parent.postMessage({ __zwireTerm: 'toggle' }, '*'); } catch (x) {}
  }, true);
}

(function boot() {
  if (!(document.getElementById('terminalPane') && typeof window.showTerminal === 'function')) {
    setTimeout(boot, 80);
    return;
  }
  var cd = '';
  try { cd = new URLSearchParams(location.search).get('cd') || ''; } catch (e) {}
  // Single-quote the path and escape any embedded single quote the POSIX way
  // ('\'' closes, escapes, reopens), so a directory named `it's` still cds.
  if (cd && typeof window.zwireTermRun === 'function') {
    window.zwireTermRun("cd '" + cd.replace(/'/g, "'\\''") + "'");
  } else {
    window.showTerminal();
  }
})();
