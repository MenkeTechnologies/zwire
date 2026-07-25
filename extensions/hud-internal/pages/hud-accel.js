/* zwire HUD — browser accelerators that HUD pages have to handle themselves.
 *
 * Chrome's Clear-browsing-data shortcut (⌘⇧⌫ on macOS, Ctrl+Shift+Del
 * elsewhere) is not in Chromium's reserved shortcut table
 * (global_keyboard_shortcuts_mac.mm), so the focused renderer sees the key
 * first and the browser only runs IDC_CLEAR_BROWSING_DATA if the page leaves it
 * unhandled. Every HUD page auto-focuses its filter box (zg-boot mount), so on
 * a HUD page the keystroke lands in a text field and the browser command never
 * fires — it worked on the new-tab page and on web pages but not here.
 *
 * So the HUD binds it directly: same keys, same destination (the Clear browsing
 * data wizard in Settings). On the Settings page itself it jumps to the wizard
 * in place via the hook settings.js publishes; anywhere else it opens Settings
 * deep-linked at the wizard, which is what Chrome's own command does.
 *
 * Loaded by every HUD page before zg-boot.js. Pure DOM + chrome.tabs — no ZGui
 * dependency, so it works even if a page's widget stack fails to load. */
(function () {
  'use strict';

  var CLEAR_URL = 'pages/settings.html?section=clearBrowserData';
  var nav = typeof navigator === 'undefined' ? {} : navigator;
  var IS_MAC = /mac|darwin/i.test((nav.userAgentData && nav.userAgentData.platform) || nav.platform || nav.userAgent || '');

  // ⌘⇧⌫ on macOS, Ctrl+Shift+Del elsewhere. Accept both Backspace and Delete on
  // each platform: Apple keyboards report the top-right key as Backspace, full
  // keyboards send Delete, and users hit whichever their layout has.
  // isMac is a parameter so the platform split is testable headless.
  function isClearCombo(e, isMac) {
    if (isMac === undefined) isMac = IS_MAC;
    if (!e || (e.key !== 'Backspace' && e.key !== 'Delete')) return false;
    if (!e.shiftKey || e.altKey) return false;
    return isMac ? (!!e.metaKey && !e.ctrlKey) : (!!e.ctrlKey && !e.metaKey);
  }

  function openClearData() {
    // Same page: settings.js publishes this hook, so the shortcut scrolls to the
    // wizard instead of opening a second copy of the page we're already on.
    if (typeof window.__zbOpenClearData === 'function') {
      try { window.__zbOpenClearData(); return; } catch (e) {}
    }
    var url = chrome.runtime.getURL(CLEAR_URL);
    try { chrome.tabs.create({ url: url }, function () { void chrome.runtime.lastError; }); }
    catch (e) { try { location.href = url; } catch (e2) {} }
  }

  function onKeyDown(e) {
    if (!isClearCombo(e)) return;
    e.preventDefault();
    e.stopPropagation();
    openClearData();
  }

  // Capture phase: the filter box (or any focused field) must not eat it first.
  if (typeof window.addEventListener === 'function') window.addEventListener('keydown', onKeyDown, true);

  window.ZBAccel = { isClearCombo: isClearCombo, openClearData: openClearData, onKeyDown: onKeyDown, CLEAR_URL: CLEAR_URL, isMac: IS_MAC };
})();
