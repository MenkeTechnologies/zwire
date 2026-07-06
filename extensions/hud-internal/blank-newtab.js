/* zwire: never leave a bare about:blank top-level tab — send an empty one to the
 * zwire new-tab page.
 *
 * The NTP override only covers chrome://newtab; a page that calls window.open()
 * / window.open('') (or a target=_blank link to about:blank) still lands on a
 * real top-level about:blank tab the override can't touch. This runs there (via
 * match_about_blank, which injects into an about:blank frame whose opener origin
 * matches) and navigates the tab to the new-tab page itself.
 *
 * We navigate directly to newtab's web-accessible page (the same page
 * chrome://newtab shows) rather than message the background worker: a content
 * script in an about:blank tab has an unreliable sender.tab, and chrome://newtab
 * isn't reachable from a web-origin document. Self-navigation needs neither.
 *
 * A short settle + emptiness check keeps opener-driven flows intact:
 *   w.location = '…'      -> tab navigates away, href is no longer blank -> skip
 *   w.document.write('…') -> body fills with content                     -> skip
 * Only a tab that stays blank AND empty (a bare window.open()) is redirected.
 */
(function () {
  if (window.top !== window) return;            // top-level tab only, never iframes
  if (location.href !== 'about:blank') return;

  // newtab extension's stable id (from its pinned manifest key); newtab.html is
  // web_accessible to <all_urls>, so an about:blank web-origin tab may navigate
  // to it. Same page the chrome://newtab override renders.
  var NEWTAB = 'chrome-extension://gpoepnekoiplhkegjpocnpeijiefgieb/newtab.html';

  function stillEmptyBlank() {
    if (location.href !== 'about:blank') return false;               // opener navigated it
    var b = document.body;
    if (b && (b.childElementCount || (b.textContent || '').trim())) return false; // written into
    if ((document.title || '').trim()) return false;
    return true;
  }

  // Content-script timers run in the page, not the service worker, so this is
  // reliable. Let a synchronous opener location-set / document.write settle,
  // then redirect only if the tab is still a blank, empty page.
  setTimeout(function () {
    if (stillEmptyBlank()) { try { location.replace(NEWTAB); } catch (e) {} }
  }, 200);
})();
