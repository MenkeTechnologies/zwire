/* zwire New Tab — minimal service worker.
 * Its only job is to give the extension a real toolbar action so Chrome draws a
 * live, COLORED button (a newtab-override extension with no action shows a dead
 * grayed-out icon). Clicking it opens a fresh zwire new tab. */
'use strict';

chrome.action.onClicked.addListener(function () {
  try { chrome.tabs.create({}); } catch (e) { /* no-op */ }
});

// hud-internal ("Load" on an all-new-tab layout) relays the session here: Chrome won't
// inject its overlay onto a chrome-extension:// page, and a cross-extension tab-open of our
// page is not guaranteed, so WE open our own carrier (tmux.html) — a same-extension
// chrome.tabs.create that always works. tmux.html hosts the overlay and self-attaches the
// session from its URL hash. Only hud-internal (our declared externally_connectable peer).
var HUD_ID = 'omcgnnjfmbmpdlofklbpddkhnfibfhgg';   // zwire HUD Internal

// The new-tab LAYOUTS live in this extension's storage (the page that renders them
// must read them synchronously fast, and they are useless without it). The HUD's
// layout manager is in the other extension, so it reads and writes them through
// here. Every write is normalized by the same engine the page renders with, so the
// manager cannot store a layout this page would refuse to draw.
try { importScripts('zntp-core.js'); } catch (e) { /* the manager falls back to read-only */ }

chrome.runtime.onMessageExternal.addListener(function (msg, sender, sendResponse) {
  if (!sender || sender.id !== HUD_ID || !msg) return;
  if (msg.type === 'zbOpenTmuxCarrier' && msg.session) {
    try {
      var url = chrome.runtime.getURL('tmux.html') + '#zbtmux=' + encodeURIComponent(JSON.stringify(msg.session));
      chrome.tabs.create({ url: url }, function () { void chrome.runtime.lastError; });
    } catch (e) { /* no-op */ }
    try { sendResponse({ ok: true }); } catch (e) { /* no-op */ }
    return true;
  }
  if (msg.type === 'zbNtpGet') {
    try {
      chrome.storage.local.get('zb_ntp', function (o) {
        void chrome.runtime.lastError;
        var N = self.ZWIRE_NTP;
        var stored = o && o.zb_ntp;
        sendResponse({ ok: true, config: N ? N.normalize(stored || {}) : stored });
      });
    } catch (e) { sendResponse({ ok: false, err: 'storage unavailable' }); }
    return true;
  }
  if (msg.type === 'zbNtpSet' && msg.config) {
    var N2 = self.ZWIRE_NTP;
    if (!N2) { sendResponse({ ok: false, err: 'layout engine unavailable' }); return true; }
    try {
      chrome.storage.local.set({ zb_ntp: N2.normalize(msg.config) }, function () {
        void chrome.runtime.lastError;
        sendResponse({ ok: true });
      });
    } catch (e) { sendResponse({ ok: false, err: 'storage unavailable' }); }
    return true;
  }
});
