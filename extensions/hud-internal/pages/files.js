/* zwire HUD — FILES page: mounts the SHARED file browser inside the HUD shell.
 *
 * The browser itself is lib/file-browser (the zpwr-file-browser submodule) and is
 * loaded unmodified — zwire contributes only this mount plus the host bridge in
 * files-host.js. Nothing about the toolbar, panes, preview, tree or context menu
 * is re-implemented here; drifting a private copy is what the submodule exists to
 * prevent.
 *
 * Load order matters twice:
 *   1. files-host.js runs first (static script tag) so `window.zfbHost` exists
 *      before the shared file's self-installing Tauri bridge would claim it.
 *   2. file-browser.js is injected DYNAMICALLY here, after `#tabFiles` exists.
 *      That inverts one assumption it makes: it registers several handlers on
 *      `DOMContentLoaded` (sort-header clicks, pane flex, drag-reorder, preview
 *      restore, the Cmd+L path input) expecting a host whose pane markup is in
 *      its own index.html. On this page the markup arrives later — the shared
 *      `initFileBrowser()` fetches file-browser.html and injects it — so those
 *      handlers would bind against an empty container, or not at all, since
 *      DOMContentLoaded has already fired by the time the script loads.
 *      So the listeners it registers are captured and replayed once the markup
 *      is really in the DOM. Only file-browser.js's own listeners are captured
 *      (the patch is installed around its load and removed immediately after),
 *      so the page's other DOMContentLoaded consumers never run twice.
 */
(function () {
  'use strict';
  var FB_DIR = '../lib/file-browser/webui/';

  var shell = window.ZBHUD.mount({
    title: 'FILES', current: 'files.html', filterPlaceholder: 'filter files…',
    // The browser owns its own fuzzy filter (#fileSearchInput, registered through
    // its registerFilter shim), so the shell's filter box drives that input rather
    // than a second, competing filter over the same rows.
    onFilter: function (v) {
      var input = document.getElementById('fileSearchInput');
      if (!input) return;
      input.value = v || '';
      try { input.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) {}
    }
  });

  // The mount point the shared browser injects its markup into.
  var mount = document.createElement('div');
  mount.id = 'tabFiles';
  shell.body.appendChild(mount);

  function fail(msg) {
    mount.textContent = msg;
    try { if (window.ZGui && ZGui.toast && ZGui.toast.show) ZGui.toast.show(msg, 6000, 'error'); } catch (e) {}
  }

  /* Capture file-browser.js's own DOMContentLoaded listeners while it loads. */
  var captured = [];
  var realAdd = document.addEventListener.bind(document);
  document.addEventListener = function (type, fn, opts) {
    if (type === 'DOMContentLoaded' && typeof fn === 'function') { captured.push(fn); return; }
    return realAdd(type, fn, opts);
  };

  var script = document.createElement('script');
  script.src = FB_DIR + 'file-browser.js';
  script.onerror = function () {
    document.addEventListener = realAdd;
    fail('file browser did not load — is the lib/file-browser submodule checked out?');
  };
  script.onload = function () {
    document.addEventListener = realAdd;
    if (typeof window.initFileBrowser !== 'function') {
      fail('file browser loaded but exposed no initFileBrowser()');
      return;
    }
    Promise.resolve(window.initFileBrowser()).then(function () {
      // Markup is in the DOM now — replay what would have run at DOMContentLoaded.
      captured.forEach(function (fn) { try { fn(); } catch (e) {} });
    }).catch(function (e) {
      fail('file browser failed to start: ' + (e && e.message ? e.message : e));
    });
  };
  document.head.appendChild(script);
})();
