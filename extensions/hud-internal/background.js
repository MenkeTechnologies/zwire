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
// zpwrchrome extension — kept in colorscheme sync with the global HUD/native
// scheme over runtime messaging (separate extensions can't share storage).
var ZPWR_ID = 'inklnobllidodhdpkocpafooegnklheo';
var lastPushed = null;

function pushToZpwr(scheme) {
  if (!scheme || scheme === lastPushed) return;
  lastPushed = scheme;
  try { chrome.runtime.sendMessage(ZPWR_ID, { type: 'zb-scheme', scheme: scheme }, function () { void chrome.runtime.lastError; }); } catch (e) {}
}

function mirror(scheme) {
  if (!scheme) return;
  try { chrome.storage.local.set({ zb_scheme: scheme }); } catch (e) {}
  pushToZpwr(scheme);
}

// zpwrchrome side of the bridge: it can pull the current scheme on startup and
// push a scheme the user picked in its own theme injector back to the browser
// chrome (native file) + HUD.
try {
  chrome.runtime.onMessageExternal.addListener(function (msg, sender, sendResponse) {
    if (!sender || sender.id !== ZPWR_ID || !msg) return;
    if (msg.type === 'zb-scheme-get') {
      try { chrome.storage.local.get('zb_scheme', function (o) { void chrome.runtime.lastError; sendResponse({ scheme: (o && o.zb_scheme) || 'cyberpunk' }); }); } catch (e) { sendResponse({ scheme: 'cyberpunk' }); }
      return true; // async
    }
    if (msg.type === 'zb-scheme-set' && msg.scheme) {
      lastPushed = msg.scheme;   // came FROM zpwr — don't echo it straight back
      try { chrome.runtime.sendNativeMessage(HOST, { scheme: msg.scheme }, function () { void chrome.runtime.lastError; }); } catch (e) {}
      try { chrome.storage.local.set({ zb_scheme: msg.scheme }); } catch (e) {}
    }
  });
} catch (e) {}

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
// Keep a list of installed extensions + their options pages in storage, so the
// command palette can jump straight to any extension's settings (e.g. tweak
// zpwrchrome). Also expose the extension's own page URL.
function updateExts() {
  try {
    chrome.management.getAll(function (list) {
      void chrome.runtime.lastError;
      var exts = (list || []).filter(function (e) { return e.type === 'extension' && e.enabled; })
        .map(function (e) { return { id: e.id, name: e.name, optionsUrl: e.optionsUrl || '', homepageUrl: e.homepageUrl || '' }; });
      chrome.storage.local.set({ zb_exts: exts });
    });
  } catch (e) {}
}
updateExts();
try {
  if (chrome.management) {
    chrome.management.onInstalled.addListener(updateExts);
    chrome.management.onUninstalled.addListener(updateExts);
    chrome.management.onEnabled.addListener(updateExts);
    chrome.management.onDisabled.addListener(updateExts);
  }
} catch (e) {}

// Frecency (frequent + recent) list from history — same idea as zpwrchrome's
// fzf history / MRU, published to storage so the palette can offer top sites.
function updateFrecent() {
  try {
    var now = Date.now();
    chrome.history.search({ text: '', maxResults: 500, startTime: now - 1000 * 60 * 60 * 24 * 90 }, function (items) {
      void chrome.runtime.lastError;
      var scored = (items || []).map(function (h) {
        var ageDays = (now - (h.lastVisitTime || 0)) / (1000 * 60 * 60 * 24);
        var recency = 1 / (1 + ageDays * 0.3);
        return { title: h.title || h.url, url: h.url, score: ((h.visitCount || 1) + 2 * (h.typedCount || 0)) * recency };
      }).filter(function (x) { return x.url && x.url.indexOf('chrome') !== 0 && x.url.indexOf('about:') !== 0; });
      scored.sort(function (a, b) { return b.score - a.score; });
      chrome.storage.local.set({ zb_frecent: scored.slice(0, 30).map(function (x) { return { title: x.title, url: x.url }; }) });
    });
  } catch (e) {}
}
updateFrecent();
try { if (chrome.history) chrome.history.onVisited.addListener(updateFrecent); } catch (e) {}

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
    if (c.a === 'ping') { updateTabs(); updateExts(); updateFrecent(); return; }   // wake + refresh lists
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
