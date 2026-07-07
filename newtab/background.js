/* zwire New Tab — minimal service worker.
 * Its only job is to give the extension a real toolbar action so Chrome draws a
 * live, COLORED button (a newtab-override extension with no action shows a dead
 * grayed-out icon). Clicking it opens a fresh zwire new tab. */
'use strict';

chrome.action.onClicked.addListener(function () {
  try { chrome.tabs.create({}); } catch (e) { /* no-op */ }
});
