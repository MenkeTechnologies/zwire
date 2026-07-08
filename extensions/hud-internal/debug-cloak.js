/* zwire HUD Internal — cloak the debug-page transform. Runs at document_start on
 * the same STATIC hosts as debug-adapter.js. True pre-load transform is impossible
 * for chrome:// (extensions can't intercept/render Chrome's internal WebUI), so
 * instead of letting the native <table>/<pre> paint and then visibly flip to a
 * ZGui widget, we hide those elements until the adapter has replaced them.
 *
 * Safety: a hard timeout ALWAYS un-cloaks, so content can never get stuck hidden
 * if the adapter is slow or a table isn't convertible. The zgui widgets the
 * adapter builds carry .zg-datatable / [data-zb-json] and are never cloaked. */
(function () {
  'use strict';
  try {
    var de = document.documentElement;
    de.classList.add('zb-adapting');
    var st = document.createElement('style');
    st.setAttribute('data-zbcloak', '1');
    st.textContent =
      'html.zb-adapting table:not(.zg-datatable):not([data-zb-adapted]),' +
      'html.zb-adapting pre:not([data-zb-json]){opacity:0!important;transition:none!important;}';
    (document.head || de).appendChild(st);
    var reveal = function () { try { de.classList.remove('zb-adapting'); } catch (e) {} };
    // reveal once the DOM is basically ready + the adapter's retry window has passed,
    // and an absolute backstop regardless of what happened.
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(reveal, 1300); }, { once: true });
    else setTimeout(reveal, 1300);
    setTimeout(reveal, 2500);   // hard backstop — never stay cloaked
  } catch (e) {}
})();
