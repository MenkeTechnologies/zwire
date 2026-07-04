/* zbrowser HUD: intercept Chrome's internal pages and swap in our own HUD pages.
 * Runs at document_start so Chrome's WebUI never renders. Extend MAP to add pages. */
(function () {
  // Only replace pages we can make FUNCTIONAL. Pages with no extension API
  // (flags, discards, dns, password-manager, …) are left native and merely
  // skinned by the content script — replacing them with a shell loses features.
  var MAP = [
    ['chrome://extensions', 'pages/extensions.html'],
    ['chrome://settings', 'pages/settings.html'],
    ['chrome://history', 'pages/history.html'],
    ['chrome://bookmarks', 'pages/bookmarks.html'],
    ['chrome://version', 'pages/version.html']
  ];
  var here = location.href;
  for (var i = 0; i < MAP.length; i++) {
    var prefix = MAP[i][0];
    if (here === prefix || here === prefix + '/' ||
        here.indexOf(prefix + '/') === 0 || here.indexOf(prefix + '?') === 0) {
      var url = MAP[i][1] === 'GENERIC'
        ? chrome.runtime.getURL('pages/generic.html') + '?u=' + encodeURIComponent(here)
        : chrome.runtime.getURL(MAP[i][1]);
      try { location.replace(url); } catch (e) { location.href = url; }
      return;
    }
  }
})();
