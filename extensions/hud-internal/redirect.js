/* zwire HUD: intercept Chrome's internal pages and swap in our own HUD pages.
 * Runs at document_start so Chrome's WebUI never renders. Extend MAP to add pages. */
(function () {
  // Only replace pages we can make FUNCTIONAL. Pages with no extension API
  // (flags, discards, dns, password-manager, …) are left native and merely
  // skinned by the content script — replacing them with a shell loses features.
  // Every shadowed page has a FULL reimplementation on a real chrome.* API:
  // extensions (developerPrivate), settings (settingsPrivate — all prefs),
  // history (history: search + delete + clear), bookmarks (bookmarks: full CRUD),
  // version (info). If a page can't be made functional, don't add it here.
  var MAP = [
    ['chrome://extensions', 'pages/extensions.html'],
    ['chrome://settings', 'pages/settings.html'],
    ['chrome://history', 'pages/history.html'],
    ['chrome://bookmarks', 'pages/bookmarks.html'],
    ['chrome://version', 'pages/version.html']
  ];
  var here = location.href;
  // Escape hatch: `?native` (or `#native`) leaves Chrome's REAL WebUI page in place instead of the
  // HUD shadow. Needed for things a content-script reimplementation can't do — chiefly the native
  // "Inspect views: service worker" DevTools link on chrome://extensions, which is a privileged
  // browser action. Visit chrome://extensions/?native to inspect the HUD's own service worker.
  if (/[?#&]native\b/.test(here)) return;
  // About / help isn't a pref surface — route it to the HUD System page (our About).
  if (/chrome:\/\/settings\/(help|about)\b/.test(here)) {
    var v = chrome.runtime.getURL('pages/version.html');
    try { location.replace(v); } catch (e) { location.href = v; }
    return;
  }
  for (var i = 0; i < MAP.length; i++) {
    var prefix = MAP[i][0];
    if (here === prefix || here === prefix + '/' ||
        here.indexOf(prefix + '/') === 0 || here.indexOf(prefix + '?') === 0) {
      var url = MAP[i][1] === 'GENERIC'
        ? chrome.runtime.getURL('pages/generic.html') + '?u=' + encodeURIComponent(here)
        : chrome.runtime.getURL(MAP[i][1]);
      // Preserve the requested sub-page so the HUD page opens the right SECTION
      // instead of dumping at the top: chrome://settings/performance was matching
      // the 'chrome://settings' prefix and redirecting to settings.html with the
      // '/performance' dropped. Pass the first path segment as ?section= so
      // settings.js can scroll to it. Only the settings shadow is sectioned.
      if (prefix === 'chrome://settings') {
        var slug = here.slice(prefix.length).replace(/^\//, '').split(/[/?#]/)[0];
        if (slug) url += (url.indexOf('?') >= 0 ? '&' : '?') + 'section=' + encodeURIComponent(slug);
      }
      try { location.replace(url); } catch (e) { location.href = url; }
      return;
    }
  }
})();
