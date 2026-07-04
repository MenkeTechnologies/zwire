/* zbrowser HUD background worker.
 *
 * Two jobs:
 *  1. Relay the picked scheme from content scripts / pages to the native host,
 *     which writes ~/.zbrowser/hud-scheme so the compiled color mixer follows.
 *  2. Mirror the current scheme into chrome.storage.local ('zb_scheme') so the
 *     chrome:// theme content scripts have a reliable, push-based source they
 *     can read + observe (an async sendResponse across the native host is
 *     unreliable — an MV3 worker can suspend mid-round-trip).
 */
var HOST = 'com.zbrowser.hud';

function mirror(scheme) {
  if (!scheme) return;
  try { chrome.storage.local.set({ zb_scheme: scheme }); } catch (e) {}
}

// Seed storage from the native source of truth (the file may already hold a
// scheme picked in a prior session or written before launch).
function seedFromNative() {
  try {
    chrome.runtime.sendNativeMessage(HOST, { cmd: 'get' }, function (r) {
      void chrome.runtime.lastError;
      if (r && r.scheme) mirror(r.scheme);
    });
  } catch (e) {}
}
seedFromNative();
try { chrome.runtime.onStartup.addListener(seedFromNative); } catch (e) {}
try { chrome.runtime.onInstalled.addListener(seedFromNative); } catch (e) {}

// Keep a live list of open tabs in storage so the command palette (a content
// script) can read it directly — reliable, unlike an async worker round-trip.
function updateTabs() {
  // Query immediately (no setTimeout debounce): the MV3 worker can suspend
  // before a deferred timer fires, which would leave zb_tabs unwritten. The
  // worker stays alive across a pending chrome.tabs.query callback.
  try {
    chrome.tabs.query({}, function (tabs) {
      void chrome.runtime.lastError;
      chrome.storage.local.set({ zb_tabs: (tabs || []).map(function (t) {
        return { id: t.id, title: t.title, url: t.url, windowId: t.windowId, active: t.active }; }) });
    });
  } catch (e) {}
}
updateTabs();
try {
  chrome.tabs.onCreated.addListener(updateTabs);
  chrome.tabs.onRemoved.addListener(updateTabs);
  chrome.tabs.onActivated.addListener(updateTabs);
  chrome.tabs.onMoved.addListener(updateTabs);
  chrome.tabs.onUpdated.addListener(function (id, info) { if (info.title || info.url || info.status === 'complete') updateTabs(); });
  chrome.runtime.onStartup.addListener(updateTabs);
} catch (e) {}

// Command bus: content scripts write zb_cmd to storage; storage.onChanged is a
// reliable MV3 wakeup (unlike sendMessage to a sleeping worker), so palette
// navigation / tab-switching always executes.
chrome.storage.onChanged.addListener(function (changes, area) {
  if (area !== 'local' || !changes.zb_cmd || !changes.zb_cmd.newValue) return;
  var c = changes.zb_cmd.newValue;
  function active(cb) {
    chrome.tabs.query({ active: true, lastFocusedWindow: true }, function (tabs) {
      if (tabs && tabs[0]) { cb(tabs[0]); return; }
      chrome.tabs.query({ active: true }, function (a) { cb(a && a[0]); });
    });
  }
  try {
    if (c.a === 'ping') { updateTabs(); return; }   // wake + refresh the tab list
    if (c.a === 'open' && c.url) {
      active(function (t) { if (t) chrome.tabs.update(t.id, { url: c.url }); else chrome.tabs.create({ url: c.url }); });
    } else if (c.a === 'openTab' && c.url) {
      chrome.tabs.create({ url: c.url });
    } else if (c.a === 'activate' && c.tabId != null) {
      chrome.tabs.update(c.tabId, { active: true }, function (t) { void chrome.runtime.lastError; if (t && t.windowId != null) chrome.windows.update(t.windowId, { focused: true }); });
    } else if (c.a === 'newTab') { chrome.tabs.create({});
    } else if (c.a === 'closeTab') { active(function (t) { if (t) chrome.tabs.remove(t.id); });
    } else if (c.a === 'nextTab' || c.a === 'prevTab') {
      chrome.tabs.query({ lastFocusedWindow: true }, function (all) {
        all = all || []; active(function (t) {
          if (!t) return; var idx = -1, i; for (i = 0; i < all.length; i++) if (all[i].id === t.id) idx = i;
          if (idx < 0 || !all.length) return; var n = all.length;
          var ni = c.a === 'nextTab' ? (idx + 1) % n : (idx - 1 + n) % n;
          chrome.tabs.update(all[ni].id, { active: true });
        });
      });
    }
  } catch (e) {}
});

chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (msg && msg.type === 'zbhud-scheme' && msg.scheme) {
    // Write to native (drives the compiled mixer) and mirror to storage
    // (drives the chrome:// theme content scripts).
    try {
      chrome.runtime.sendNativeMessage(HOST, { scheme: msg.scheme },
        function () { void chrome.runtime.lastError; });
    } catch (e) {}
    mirror(msg.scheme);
    return;
  }
  // Command-palette navigation: a content script can't open chrome://, an
  // extension page, or a new tab itself — do it here.
  if (msg && msg.type === 'zbopen' && msg.url) {
    var tid = sender && sender.tab && sender.tab.id;
    if (tid != null) chrome.tabs.update(tid, { url: msg.url }, function () { void chrome.runtime.lastError; });
    else chrome.tabs.create({ url: msg.url });
    return;
  }
  // A content script pinged us on load: wake + refresh the tab list into storage.
  if (msg && msg.type === 'zbping') { updateTabs(); return; }
  // Command palette: list every open tab (so the palette doubles as a switcher).
  if (msg && msg.type === 'zbtabs') {
    try {
      chrome.tabs.query({}, function (tabs) {
        void chrome.runtime.lastError;
        sendResponse({ tabs: (tabs || []).map(function (t) {
          return { id: t.id, title: t.title, url: t.url, windowId: t.windowId, active: t.active }; }) });
      });
      return true; // async
    } catch (e) { sendResponse({ tabs: [] }); }
  }
  // Switch to a tab (redirect to the correct tab + focus its window).
  if (msg && msg.type === 'zbactivate' && msg.tabId != null) {
    chrome.tabs.update(msg.tabId, { active: true }, function (t) {
      void chrome.runtime.lastError;
      if (t && t.windowId != null) chrome.windows.update(t.windowId, { focused: true });
    });
    return;
  }
  // Vim-mode tab/window operations (content scripts can't touch other tabs).
  if (msg && msg.type === 'zvim') {
    var cmd = msg.cmd;
    chrome.tabs.query({ currentWindow: true, active: true }, function (tabs) {
      var a = tabs && tabs[0]; if (!a) return;
      if (cmd === 'closeTab') chrome.tabs.remove(a.id);
      else if (cmd === 'newTab') chrome.tabs.create({});
      else if (cmd === 'openTab' && msg.url) chrome.tabs.create({ url: msg.url, active: false });
      else if (cmd === 'nextTab' || cmd === 'prevTab') {
        chrome.tabs.query({ currentWindow: true }, function (all) {
          var idx = -1, i; for (i = 0; i < all.length; i++) if (all[i].id === a.id) idx = i;
          if (idx < 0) return; var n = all.length;
          var ni = cmd === 'nextTab' ? (idx + 1) % n : (idx - 1 + n) % n;
          chrome.tabs.update(all[ni].id, { active: true });
        });
      }
    });
    return;
  }
  // Read relay: the message wakes this (lazy) worker; we read the native source
  // of truth, answer, and mirror to storage so onChanged fans out to any other
  // open chrome:// tabs.
  if (msg && msg.type === 'zbhud-get') {
    try {
      chrome.runtime.sendNativeMessage(HOST, { cmd: 'get' }, function (r) {
        void chrome.runtime.lastError;
        var scheme = (r && r.scheme) || 'cyberpunk';
        mirror(scheme);
        sendResponse({ scheme: scheme });
      });
      return true; // async response
    } catch (e) { sendResponse({ scheme: 'cyberpunk' }); }
  }
});
