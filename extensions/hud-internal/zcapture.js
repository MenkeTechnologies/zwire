/* zwire HUD — capture-state relay (isolated world).
 *
 * zcapture-main.js runs in the page's own world, where chrome.* does not exist, so it
 * posts its live/idle state on the window. This half is the only thing that listens for
 * it and forwards it to the worker, which keeps the per-tab capture map the auto-hibernate
 * sweep reads (background.js / zhibernate-core.js).
 *
 * Only same-window messages carrying the exact marker are relayed; a page can post the
 * same shape, and the worst it buys is a tab that refuses to hibernate. */
(function () {
  'use strict';
  if (typeof window === 'undefined') return;
  window.addEventListener('message', function (e) {
    if (e.source !== window) return;
    var d = e.data;
    if (!d || d.__zwireCapture !== 1) return;
    try {
      chrome.runtime.sendMessage({ type: 'zbCapture', live: !!d.live }, function () {
        void chrome.runtime.lastError;   // worker asleep / no receiver: nothing to do
      });
    } catch (x) {}
  }, false);
})();
