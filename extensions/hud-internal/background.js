/* zwire HUD background worker.
 *
 * Two jobs:
 *  1. Relay the picked scheme from content scripts / pages to the native host,
 *     which writes <app-data>/zwire/hud-scheme so the compiled color mixer follows.
 *  2. Mirror the current scheme into chrome.storage.local ('zb_scheme') so the
 *     chrome:// theme content scripts have a reliable, push-based source they
 *     can read + observe (an async sendResponse across the native host is
 *     unreliable — an MV3 worker can suspend mid-round-trip).
 */
var HOST = 'com.zwire.hud';
// Fire a lifecycle event to the native host so user stryke hooks run (see the
// lifecycle-hooks IIFE below + hooks.rs). Top-level so every listener/handler in
// this worker can call it. Best-effort: the host no-ops when no enabled hook is
// bound to the event, and errors are swallowed (the port may suspend mid-round).
function fireHook(event, payload) {
  try {
    chrome.runtime.sendNativeMessage(HOST, { cmd: 'hook_fire', event: event, payload: payload || {} },
      function () { void chrome.runtime.lastError; });
  } catch (e) {}
}
// zpwrchrome extension — kept in colorscheme sync with the global HUD/native
// scheme over runtime messaging (separate extensions can't share storage).
var ZPWR_ID = 'hpppdchpnphmiijdeanibpcadgknmaja';
// Theme = colour scheme + light/fx. It is coordinated by zwire-host (the single
// source of truth, ~/.zwire/global.toml). This worker holds ONE subscription
// (folded into the sysinfo port) and bridges host <-> chrome.storage: content
// scripts + HUD pages keep reading zb_scheme / zb_ui (reliable within one
// extension), and this bridge keeps them equal to the host. `_lastHostScheme` /
// `_lastHostUi` remember the value the HOST last pushed so our own echo (a
// storage.set we made from a host push -> onChanged -> host write) never loops.
// zpwrchrome + newtab no longer talk to us for theme — they subscribe the host
// directly, so the old cross-extension push/pull/mirror mesh is gone.
var _lastHostScheme = null, _lastHostUi = null;

function mirror(scheme) {
  if (!scheme) return;
  try { chrome.storage.local.set({ zb_scheme: scheme }); } catch (e) {}
}

// Pull a browser.* action a stryke script queued in the host KV (__zbus_action) and hand it to the
// zb_cmd executor below (storage write → onChanged → chrome.tabs). One-shot sendNativeMessage so it
// works from any SW entry point (the zb-host relay, hooks) without the streaming sysinfo port.
function drainZbAction() {
  try {
    chrome.runtime.sendNativeMessage(HOST, { cmd: 'kv_get', app: 'zwire', key: '__zbus_action' }, function (r) {
      if (chrome.runtime.lastError) { void chrome.runtime.lastError; return; }
      var v = r && r.value; if (!v || !v.a) return;
      var n = +v._n || 0; if (n <= (self._zbLastN || 0)) return;   // dedup vs the sysinfo poll
      self._zbLastN = n;
      var q = {}; for (var k in v) { if (k !== '_n') q[k] = v[k]; } q._zbn = n;
      try { chrome.storage.local.set({ zb_cmd: q }); } catch (e) {}
      try { chrome.runtime.sendNativeMessage(HOST, { cmd: 'kv_del', app: 'zwire', key: '__zbus_action' }, function () { void chrome.runtime.lastError; }); } catch (e) {}
    });
  } catch (e) {}
}

// Apply a theme frame pushed by the host into chrome.storage (drives every
// hud-internal surface via storage.onChanged). Tracked so the storage->host
// writer below recognises the echo and skips it.
function applyThemeFromHost(topic, data) {
  if (topic === 'scheme' && data && data.scheme) {
    _lastHostScheme = data.scheme;
    try { chrome.storage.local.set({ zb_scheme: data.scheme }); } catch (e) {}
  } else if (topic === 'ui' && data && typeof data === 'object') {
    _lastHostUi = JSON.stringify(data);
    try { chrome.storage.local.set({ zb_ui: data }); } catch (e) {}
  }
}

// The New Tab page is a separate extension with isolated storage, but custom
// commands (the Commands page) are written HERE. Serve the authoritative
// zb_custom_cmds list on request so user-added commands appear in its palette
// too — otherwise newtab only sees its own locally-seeded shipped defaults.
try {
  chrome.runtime.onMessageExternal.addListener(function (msg, sender, sendResponse) {
    if (!sender || sender.id !== ZB_NEWTAB_ID || !msg) return;
    if (msg.type === 'zwireGetCmds') {
      try { chrome.storage.local.get('zb_custom_cmds', function (o) { void chrome.runtime.lastError; sendResponse({ cmds: (o && o.zb_custom_cmds) || [] }); }); }
      catch (e) { sendResponse({ cmds: [] }); }
      return true; // async sendResponse
    }
    // (theme toggles used to come through here from newtab; newtab now writes the
    // host directly, so those handlers are gone.)
  });
} catch (e) {}

// (Seeding storage from the native file on startup is no longer needed: the
// theme subscription below receives a snapshot of the current scheme + ui the
// instant it connects, and mirrors it into chrome.storage.)

// zpwrchrome is force-loaded via the launcher's --load-extension, which
// re-ENABLES it on every browser start. The extensions manager persists a user
// disable as a kv marker (zwire/zpwr_off) in the native host's state dir; honour
// it here on startup so the disable survives a restart, while zpwrchrome stays
// visible + re-enable-able in the manager. Missing/false marker == leave enabled.
function applyZpwrDisabled() {
  try {
    chrome.runtime.sendNativeMessage(HOST, { cmd: 'kv_get', app: 'zwire', key: 'zpwr_off' }, function (r) {
      void chrome.runtime.lastError;
      if (r && r.value === true) {
        try { chrome.management.setEnabled(ZPWR_ID, false, function () { void chrome.runtime.lastError; }); } catch (e) {}
      }
    });
  } catch (e) {}
}
applyZpwrDisabled();
try { chrome.runtime.onStartup.addListener(applyZpwrDisabled); } catch (e) {}
try { chrome.runtime.onInstalled.addListener(applyZpwrDisabled); } catch (e) {}

// The terminal's open state persists across navigation, but PER TAB — it must not
// re-pop in every OTHER tab / new tab. The old global zb_term_open flag (chrome
// .storage) opened it everywhere once opened anywhere. Track it keyed by tab id
// (from sender.tab, which content scripts can't forge) in worker memory: on a
// worker restart the map is empty and we fail-CLOSED (don't reopen), which is the
// safe direction. Terminal content scripts are top-frame only, so tmux pane
// iframes never trigger this.
var termOpenByTab = {};
try {
  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (!msg || !sender || !sender.tab || sender.tab.id == null) return;
    var tid = sender.tab.id;
    if (msg.type === 'zbTermOpen') {
      if (msg.open) termOpenByTab[tid] = true; else delete termOpenByTab[tid];
      fireHook(msg.open ? 'terminal-opened' : 'terminal-closed', { tabId: tid });
      return;
    }
    if (msg.type === 'zbTermState') { sendResponse({ open: termOpenByTab[tid] === true }); return true; }
  });
} catch (e) {}
try { chrome.tabs.onRemoved.addListener(function (tid) { delete termOpenByTab[tid]; }); } catch (e) {}

// First run: open the HUD App Store page and pop the welcome modal, so the
// MenkeTechnologies app store is shown up front. Unpacked extensions loaded via
// --load-extension fire onInstalled with reason 'install' on EVERY launch, so
// reason alone can't distinguish first-run — gate the welcome modal on a
// persistent flag (zb_welcomed) so it pops only the very first time. Later
// launches still open the App Store tab, just without the welcome popup.
try {
  chrome.runtime.onInstalled.addListener(function (d) {
    if (!d || d.reason !== 'install') return;
    try {
      chrome.storage.local.get('zb_welcomed', function (o) {
        void chrome.runtime.lastError;
        var welcomed = !!(o && o.zb_welcomed);
        var url = chrome.runtime.getURL('pages/store.html') + (welcomed ? '' : '?welcome=1');
        try { chrome.tabs.create({ url: url }); } catch (e) {}
        if (!welcomed) { try { chrome.storage.local.set({ zb_welcomed: 1 }); } catch (e) {} }
      });
    } catch (e) { try { chrome.tabs.create({ url: chrome.runtime.getURL('pages/store.html') }); } catch (e2) {} }
  });
} catch (e) {}

// Seed the ⌘K custom-command registry with a default rule set on FIRST RUN only.
// `zb_custom_cmds` is a user-editable array (commands.html); seed it just when
// the key has never been set, so we never clobber a user's edits/deletions.
// Each rule is a short keyword → URL (`kw arg` in ⌘K puts <arg> where {q} is).
var CUSTOM_CMD_SEED = (function () {
  function u(id, icon, label, kw, url) { return { id: 'def-' + id, icon: icon, label: label, detail: '', keyword: kw, type: 'url', value: url }; }
  function a(id, icon, label, kw, act) { return { id: 'def-' + id, icon: icon, label: label, detail: '', keyword: kw, type: 'action', value: act }; }
  return [
    u('chatgpt', '🤖', 'ChatGPT', 'cg', 'https://chatgpt.com/?q={q}&hints=search'),
    u('claude', '✳️', 'Claude', 'cl', 'https://claude.ai/new?q={q}'),
    u('perplexity', '🔮', 'Perplexity', 'pp', 'https://www.perplexity.ai/search?q={q}'),
    u('gmail', '✉️', 'Gmail', 'gm', 'https://mail.google.com/mail/u/0/#search/{q}'),
    u('gdrive', '📁', 'Google Drive', 'gd', 'https://drive.google.com/drive/search?q={q}'),
    u('gcal', '📅', 'Google Calendar', 'cal', 'https://calendar.google.com/'),
    u('translate', '🌐', 'Google Translate', 'tr', 'https://translate.google.com/?sl=auto&tl=en&text={q}'),
    u('images', '🖼️', 'Google Images', 'img', 'https://www.google.com/search?tbm=isch&q={q}'),
    u('define', '📖', 'Define word', 'def', 'https://www.google.com/search?q=define%3A{q}'),
    u('wolfram', '🧮', 'WolframAlpha', 'wa', 'https://www.wolframalpha.com/input?i={q}'),
    u('hn', '🟧', 'Hacker News', 'hn', 'https://hn.algolia.com/?q={q}'),
    u('linkedin', '💼', 'LinkedIn', 'li', 'https://www.linkedin.com/search/results/all/?keywords={q}'),
    u('imdb', '🎬', 'IMDb', 'imdb', 'https://www.imdb.com/find/?q={q}'),
    u('netflix', '📺', 'Netflix', 'nf', 'https://www.netflix.com/search?q={q}'),
    u('spotify', '🎵', 'Spotify', 'sp', 'https://open.spotify.com/search/{q}'),
    u('ytmusic', '🎧', 'YouTube Music', 'ytm', 'https://music.youtube.com/search?q={q}'),
    u('bing', '🔎', 'Bing', 'bing', 'https://www.bing.com/search?q={q}'),
    u('kagi', '🧭', 'Kagi', 'kagi', 'https://kagi.com/search?q={q}'),
    u('gist', '📝', 'GitHub Gist', 'gist', 'https://gist.github.com/search?q={q}'),
    u('gpr', '🔀', 'GitHub PRs', 'pr', 'https://github.com/pulls'),
    u('gissues', '🐛', 'GitHub Issues', 'iss', 'https://github.com/issues'),
    u('grepapp', '🔍', 'grep.app (code search)', 'grep', 'https://grep.app/search?q={q}'),
    u('caniuse', '✅', 'Can I Use', 'ciu', 'https://caniuse.com/?search={q}'),
    u('bundlephobia', '📦', 'Bundlephobia', 'bp', 'https://bundlephobia.com/package/{q}'),
    u('regex101', '⚙️', 'regex101', 'rex', 'https://regex101.com/'),
    u('mavencentral', '☕', 'Maven Central', 'mvn', 'https://central.sonatype.com/search?q={q}'),
    u('aws', '🟠', 'AWS Console', 'aws', 'https://console.aws.amazon.com/console/home'),
    u('gcp', '🔵', 'GCP Console', 'gcp', 'https://console.cloud.google.com/'),
    u('vercel', '▲', 'Vercel', 'vc', 'https://vercel.com/dashboard'),
    u('cloudflare', '☁️', 'Cloudflare', 'cf', 'https://dash.cloudflare.com/'),
    u('notion', '🗒️', 'Notion', 'no', 'https://www.notion.so/{q}'),
    u('figma', '🎨', 'Figma', 'fig', 'https://www.figma.com/files'),
    u('devdocs', '📚', 'DevDocs', 'dd', 'https://devdocs.io/#q={q}'),
    u('archwiki', '🐧', 'Arch Wiki', 'aw', 'https://wiki.archlinux.org/index.php?search={q}'),
    u('emoji', '🔣', 'Emoji / Unicode', 'uni', 'https://emojipedia.org/search?q={q}'),
    a('reload', '↻', 'Reload page', 'rl', 'reload'),
    a('copyurl', '⧉', 'Copy page URL', 'cu', 'copyUrl'),
    a('scheme', '◐', 'Cycle color scheme', 'cs', 'cycleScheme')
  ];
})();
function seedCustomCmds() {
  try {
    chrome.storage.local.get(['zb_custom_cmds', 'zb_cmds_seeded'], function (o) {
      void chrome.runtime.lastError;
      if (o && o.zb_cmds_seeded) return;                       // seed the defaults exactly once, ever
      var cur = (o && o.zb_custom_cmds) || [], have = {};
      cur.forEach(function (c) { if (c && c.id) have[c.id] = 1; });   // keep any user entries; add missing defaults
      var merged = cur.concat(CUSTOM_CMD_SEED.filter(function (c) { return !have[c.id]; }));
      try { chrome.storage.local.set({ zb_custom_cmds: merged, zb_cmds_seeded: 1 }); } catch (e) {}
    });
  } catch (e) {}
}
seedCustomCmds();
try { chrome.runtime.onInstalled.addListener(seedCustomCmds); } catch (e) {}

// ⌘K command palette. The new-tab page reserves ⌘K at the browser level before
// any page JS sees it (native + chrome.commands shortcuts fire there, page
// keydown listeners don't), so a page-level listener can never open the palette
// on the NTP. A chrome.commands shortcut DOES fire regardless of focus — but it
// fires browser-wide and consumes ⌘K on every tab, so this becomes the single
// owner of ⌘K and routes to whichever palette matches the active tab:
//   normal web page   -> the zpalette content script (tabs.sendMessage)
//   the new-tab page   -> the newtab extension's palette (cross-ext sendMessage)
//   a HUD page         -> that page's zg-boot palette (runtime broadcast)
var ZB_NEWTAB_ID = 'gpoepnekoiplhkegjpocnpeijiefgieb';
try {
  chrome.commands.onCommand.addListener(function (command) {
    if (command !== 'open-palette') return;
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      void chrome.runtime.lastError;
      var tab = tabs && tabs[0];
      if (!tab) return;
      var url = tab.url || tab.pendingUrl || '';
      var selfPages = 'chrome-extension://' + chrome.runtime.id + '/pages/';
      if (url.indexOf('chrome://newtab') === 0 || url.indexOf('chrome-extension://' + ZB_NEWTAB_ID + '/') === 0) {
        try { chrome.runtime.sendMessage(ZB_NEWTAB_ID, { type: 'zwireOpenPalette' }, function () { void chrome.runtime.lastError; }); } catch (e) {}
      } else if (url.indexOf(selfPages) === 0) {
        try { chrome.runtime.sendMessage({ type: 'zwireOpenPalette' }, function () { void chrome.runtime.lastError; }); } catch (e) {}
      } else if (tab.id != null) {
        try { chrome.tabs.sendMessage(tab.id, { type: 'zwireOpenPalette' }, function () { void chrome.runtime.lastError; }); } catch (e) {}
      }
    });
  });
} catch (e) {}

// System-stats stream: a persistent native-messaging port to zwire-host, which
// streams real machine stats (cpu/mem/net/…) every 2s into zb_sys for the
// statusbar. The open port also keeps this MV3 worker alive.
function startSysStream() {
  try {
    var port = chrome.runtime.connectNative(HOST);
    port.onMessage.addListener(function (m) {
      if (!m) return;
      if (m.sys) {
        try { chrome.storage.local.set({ zb_sys: m.sys }); } catch (e) {}
        // Poll for a cross-process browser action queued by a stryke script
        // (App::open("zwire")->call("browser.*") writes it to the file-backed kv, since the host that
        // answered the socket usually isn't this subscribed one). The sysinfo stream is our keep-alive.
        try { port.postMessage({ cmd: 'kv_get', app: 'zwire', key: '__zbus_action', id: 'zbAction' }); } catch (e) {}
      }
      // Reply to the __zbus_action poll: run any action newer than the last we ran, then DELETE it from
      // the kv so it can't re-fire. `_zbLastN` (0 by default) guards against a double-read racing the
      // delete — it does NOT baseline-skip, so a freshly-queued action runs on the very first poll.
      else if (m.id === 'zbAction' && m.value && m.value.a) {
        var n = +m.value._n || 0;
        if (n > (self._zbLastN || 0)) {
          self._zbLastN = n;
          try { var q = {}; for (var k in m.value) { if (k !== '_n') q[k] = m.value[k]; } q._zbn = n; chrome.storage.local.set({ zb_cmd: q }); } catch (e) {}
          try { port.postMessage({ cmd: 'kv_del', app: 'zwire', key: '__zbus_action' }); } catch (e) {}
        }
      }
      // Live theme bus (scheme/ui) + the same-process zbus.action fast path.
      else if (m.ev === 'pub' && m.topic === 'zbus.action') {
        try { var d = m.data || {}; d._zbn = (d._zbn || 0) + (typeof Date !== 'undefined' ? Date.now() : 1); chrome.storage.local.set({ zb_cmd: d }); } catch (e) {}
      }
      else if (m.ev === 'pub') applyThemeFromHost(m.topic, m.data);
    });
    port.onDisconnect.addListener(function () { void chrome.runtime.lastError; setTimeout(startSysStream, 5000); });
    port.postMessage({ cmd: 'sysinfo_start' });
    port.postMessage({ cmd: 'sub', topic: 'scheme' });
    port.postMessage({ cmd: 'sub', topic: 'ui' });
    port.postMessage({ cmd: 'sub', topic: 'zbus.action' });
  } catch (e) { setTimeout(startSysStream, 5000); }
}
startSysStream();

// A hud-internal surface changed the theme in chrome.storage (a content-script
// palette or a HUD page flips zb_ui / zb_scheme). Write it to the host — the
// single source of truth — which persists it to ~/.zwire/global.toml and
// publishes it back to US (echo, skipped below) AND to every other app's
// subscription (newtab, zpwrchrome, zemacs, the fleet). No cross-extension
// messaging: the host fans it out.
try {
  chrome.storage.onChanged.addListener(function (ch, area) {
    if (area !== 'local') return;
    if (ch.zb_scheme && ch.zb_scheme.newValue && ch.zb_scheme.newValue !== _lastHostScheme) {
      try { chrome.runtime.sendNativeMessage(HOST, { scheme: ch.zb_scheme.newValue }, function () { void chrome.runtime.lastError; }); } catch (e) {}
    }
    if (ch.zb_ui && ch.zb_ui.newValue && JSON.stringify(ch.zb_ui.newValue) !== _lastHostUi) {
      try { chrome.runtime.sendNativeMessage(HOST, { ui: ch.zb_ui.newValue }, function () { void chrome.runtime.lastError; }); } catch (e) {}
    }
  });
} catch (e) {}
// (Startup convergence is handled by the theme subscription's snapshot — no
// cross-extension startup push is needed anymore.)

// PTY relay for the terminal overlay (a content script — can't connectNative).
// Sessions are keyed by TAB so the shell SURVIVES page navigation: when the
// tab's overlay re-injects on the next page it reconnects to the same host PTY.
// Output produced while no page is attached is buffered and flushed on reconnect.
var ptySessions = {};   // tabId -> { nat, buf:[], cs, spawned }
try {
  chrome.runtime.onConnect.addListener(function (csPort) {
    if (!csPort || csPort.name !== 'zwire-pty') return;
    var tabId = csPort.sender && csPort.sender.tab && csPort.sender.tab.id;
    if (tabId == null) { csPort.disconnect(); return; }
    var sess = ptySessions[tabId];
    if (!sess) {
      var nat;
      try { nat = chrome.runtime.connectNative(HOST); } catch (e) { csPort.disconnect(); return; }
      sess = { nat: nat, buf: [], cs: null, spawned: false };
      ptySessions[tabId] = sess;
      nat.onMessage.addListener(function (m) {
        if (sess.cs) { try { sess.cs.postMessage(m); } catch (e) {} }
        else { sess.buf.push(m); if (sess.buf.length > 500) sess.buf.shift(); }
      });
      nat.onDisconnect.addListener(function () { void chrome.runtime.lastError; delete ptySessions[tabId]; });
    }
    sess.cs = csPort;
    var pending = sess.buf; sess.buf = [];
    pending.forEach(function (m) { try { csPort.postMessage(m); } catch (e) {} });   // flush buffered output
    csPort.onMessage.addListener(function (m) {
      if (m && m.cmd === 'pty_spawn') { if (sess.spawned) return; sess.spawned = true; }   // one shell per tab
      try { sess.nat.postMessage(m); } catch (e) {}
    });
    csPort.onDisconnect.addListener(function () { if (sess.cs === csPort) sess.cs = null; });   // keep the shell alive across nav
  });
  chrome.tabs.onRemoved.addListener(function (tabId) {
    var s = ptySessions[tabId]; if (s) { try { s.nat.disconnect(); } catch (e) {} delete ptySessions[tabId]; }
  });
} catch (e) {}

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
// Publish every extension's keyboard shortcuts (developerPrivate has the
// commands; chrome.management does not) so the palette can list + search them.
function updateShortcuts() {
  try {
    if (!chrome.developerPrivate || !chrome.developerPrivate.getExtensionsInfo) return;
    chrome.developerPrivate.getExtensionsInfo({ includeDisabled: false, includeTerminated: false }, function (list) {
      void chrome.runtime.lastError;
      var out = [];
      (list || []).forEach(function (e) {
        (e.commands || []).forEach(function (c) {
          out.push({ ext: e.name, desc: c.description || c.name, keybinding: c.keybinding || '', scope: c.scope || 'CHROME' });
        });
      });
      chrome.storage.local.set({ zb_shortcuts: out });
    });
  } catch (e) {}
}
updateShortcuts();
try {
  if (chrome.management) {
    chrome.management.onInstalled.addListener(updateExts);
    chrome.management.onUninstalled.addListener(updateExts);
    chrome.management.onEnabled.addListener(updateExts);
    chrome.management.onDisabled.addListener(updateExts);
    chrome.management.onInstalled.addListener(updateShortcuts);
    chrome.management.onEnabled.addListener(updateShortcuts);
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

// CI status poller: latest workflow-run conclusion per repo, summarized into
// storage 'zb_ci_status' for the HUD statusbar dot. Config shared with the CI
// page ('zb_ci'). A new failure raises a desktop notification.
// 16px hot-pink "CI" tile, inline so notifications never depend on an icon file.
var CI_ICON = 'data:image/svg+xml;base64,' + btoa('<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><rect width="128" height="128" fill="#0a0a12"/><rect x="8" y="8" width="112" height="112" rx="12" fill="none" stroke="#ff2a6d" stroke-width="6"/><text x="64" y="82" font-family="monospace" font-size="52" font-weight="bold" fill="#ff2a6d" text-anchor="middle">CI</text></svg>');
function ghFetch(path, token, cb) {
  var h = { 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  if (token) h['Authorization'] = 'Bearer ' + token;
  try { fetch('https://api.github.com' + path, { headers: h }).then(function (r) { return r.ok ? r.json() : null; }).then(cb).catch(function () { cb(null); }); }
  catch (e) { cb(null); }
}
function pollCi() {
  try {
    chrome.storage.local.get(['zb_ci', 'zb_ci_status'], function (o) {
      void chrome.runtime.lastError;
      var c = (o && o.zb_ci) || {}, prev = (o && o.zb_ci_status) || {};
      var user = c.user || 'MenkeTechnologies', token = c.token || '';
      var limit = Math.min(c.repoLimit || 8, token ? 12 : 5);   // stay under the 60/hr anon cap
      var reposPath = token ? '/user/repos?per_page=100&sort=pushed&affiliation=owner'
        : '/users/' + encodeURIComponent(user) + '/repos?per_page=100&sort=pushed&type=owner';
      ghFetch(reposPath, token, function (repos) {
        if (!repos || !repos.length) return;
        repos = repos.filter(function (r) { return !r.archived; }).slice(0, limit);
        var fail = 0, running = 0, ok = 0, total = 0, pending = repos.length, fails = [];
        repos.forEach(function (rp) {
          ghFetch('/repos/' + rp.full_name + '/actions/runs?per_page=1', token, function (d) {
            var run = d && d.workflow_runs && d.workflow_runs[0];
            if (run) {
              total++;
              if (run.status !== 'completed') running++;
              else if (run.conclusion === 'success') ok++;
              else if (['failure', 'timed_out', 'startup_failure'].indexOf(run.conclusion) >= 0) { fail++; fails.push(rp.name); }
            }
            if (--pending === 0) {
              chrome.storage.local.set({ zb_ci_status: { fail: fail, running: running, ok: ok, total: total, at: Date.now() } });
              if (fail > (prev.fail || 0) && chrome.notifications) {
                try { chrome.notifications.create('zb-ci-fail', { type: 'basic', iconUrl: CI_ICON, title: 'CI failing', message: fails.slice(0, 4).join(', ') + (fails.length > 4 ? '…' : '') }, function () { void chrome.runtime.lastError; }); } catch (e) {}
              }
            }
          });
        });
      });
    });
  } catch (e) {}
}
try {
  chrome.alarms.create('zb-ci-poll', { periodInMinutes: 10 });
  chrome.alarms.onAlarm.addListener(function (a) { if (a.name === 'zb-ci-poll') pollCi(); });
} catch (e) {}
pollCi();

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
  if (area !== 'local') return;
  if (!changes.zb_cmd || !changes.zb_cmd.newValue) return;
  var c = changes.zb_cmd.newValue;
  function active(cb) {
    chrome.tabs.query({ active: true, lastFocusedWindow: true }, function (tabs) {
      if (tabs && tabs[0]) { cb(tabs[0]); return; }
      chrome.tabs.query({ active: true }, function (a) { cb(a && a[0]); });
    });
  }
  try {
    if (c.a === 'ping') { updateTabs(); updateExts(); updateFrecent(); updateShortcuts(); return; }   // wake + refresh lists
    if (c.a === 'open' && c.url) {
      active(function (t) { if (t) chrome.tabs.update(t.id, { url: c.url }); else chrome.tabs.create({ url: c.url }); });
    } else if (c.a === 'openTab' && c.url) {
      chrome.tabs.create({ url: c.url });
    } else if (c.a === 'activate' && c.tabId != null) {
      chrome.tabs.update(c.tabId, { active: true }, function (t) { void chrome.runtime.lastError; if (t && t.windowId != null) chrome.windows.update(t.windowId, { focused: true }); });
    } else if (c.a === 'newTab') { chrome.tabs.create({});
    } else if (c.a === 'newWindow') { chrome.windows.create({});
    } else if (c.a === 'duplicateTab') { active(function (t) { if (t) chrome.tabs.duplicate(t.id); });
    } else if (c.a === 'reopenTab') { try { chrome.sessions.restore(function () { void chrome.runtime.lastError; }); } catch (e) {}
    } else if (c.a === 'pinTab') { active(function (t) { if (t) chrome.tabs.update(t.id, { pinned: !t.pinned }); });
    } else if (c.a === 'muteTab') { active(function (t) { if (t) chrome.tabs.update(t.id, { muted: !(t.mutedInfo && t.mutedInfo.muted) }); });
    } else if (c.a === 'closeOthers') {
      active(function (t) { if (!t) return; chrome.tabs.query({ windowId: t.windowId }, function (all) { (all || []).forEach(function (x) { if (x.id !== t.id && !x.pinned) chrome.tabs.remove(x.id); }); }); });
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
    } else if (c.a === 'tmux') { tmuxCmd(c.sub, c); }
  } catch (e) {}
});

chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  // HUD pages fire their own lifecycle events (palette-command, session-saved,
  // pane-split, audio-eq-changed, …) through this relay so all hook firing goes
  // through the one native-host seam. { type:'zbFireHook', event, payload }.
  if (msg && msg.type === 'zbFireHook' && msg.event) {
    fireHook(String(msg.event), msg.payload || {});
    // Mirror command-ish HUD events into the generic `action` catch-all so one
    // hook bound to `action` can react to every command (filter by $_.command).
    if (msg.event === 'palette-command' && msg.payload && msg.payload.command && self.__zbAct) {
      try { self.__zbAct('palette:' + msg.payload.command); } catch (e) {}
    }
    return;
  }
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
  // zwire-host relay: content scripts can't call sendNativeMessage, so custom
  // `host`-type commands (and anything else in a page) send the JSON here and we
  // forward it to the native host, returning its JSON reply.
  if (msg && msg.type === 'zb-host' && msg.req) {
    try {
      chrome.runtime.sendNativeMessage(HOST, msg.req, function (reply) {
        if (chrome.runtime.lastError) { sendResponse({ ok: false, err: chrome.runtime.lastError.message }); return; }
        // A relayed stryke_run (global palette on a web page — content scripts can't reach the
        // native host or chrome.tabs) may have queued a browser.* action in the host KV. Drain it
        // here so the tab/window op fires without waiting on the sysinfo poll.
        if (msg.req.cmd === 'stryke_run') drainZbAction();
        sendResponse({ ok: true, reply: reply });
      });
    } catch (e) { sendResponse({ ok: false, err: String(e) }); }
    return true;   // async sendResponse
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

/* ===========================================================================
 * tmux-style pane / window tiling engine.
 * PANES  = real browser windows, tiled by chrome.windows geometry.
 * WINDOWS (tmux) = named groups of panes; only the active group is visible,
 *   the rest are minimized. SESSIONS = the whole thing, persisted to storage.
 * Driven from the ztmux.js prefix-key content script via zb_cmd {a:'tmux'}.
 * State is mirrored to zb_tmux for the statusbar.
 * ======================================================================== */
var TMUX = { windows: [], active: 0 };
var WORKAREA = null;
function loadWorkArea(cb) {
  try {
    chrome.system.display.getInfo(function (ds) {
      void chrome.runtime.lastError;
      var d = (ds || []).filter(function (x) { return x.isPrimary; })[0] || (ds || [])[0];
      WORKAREA = (d && d.workArea) || { left: 0, top: 0, width: 1440, height: 820 };
      if (cb) cb();
    });
  } catch (e) { WORKAREA = { left: 0, top: 0, width: 1440, height: 820 }; if (cb) cb(); }
}
loadWorkArea();

function curWin() { return TMUX.windows[TMUX.active]; }
function findPaneWin(winId) { for (var w = 0; w < TMUX.windows.length; w++) if (TMUX.windows[w].panes.indexOf(winId) >= 0) return TMUX.windows[w]; return null; }

// Drop any pane whose browser window has since closed, prune empty groups, and
// clamp indices — the MV3 worker can be evicted between commands, so restored
// state must be reconciled against the windows that are actually open now.
function reconcile(state, openIds) {
  var open = {}; (openIds || []).forEach(function (id) { open[id] = 1; });
  var wins = ((state && state.windows) || []).map(function (w) {
    var panes = (w.panes || []).filter(function (id) { return open[id]; });
    return {
      name: w.name, panes: panes, layout: w.layout || 'cols',
      zoom: panes.indexOf(w.zoom) >= 0 ? w.zoom : null,
      active: panes.indexOf(w.active) >= 0 ? w.active : (panes[0] || null),
      sync: !!w.sync
    };
  }).filter(function (w) { return w.panes.length; });
  return { windows: wins, active: Math.min((state && state.active) || 0, Math.max(0, wins.length - 1)) };
}

function ensureInit(cb) {
  if (TMUX.windows.length) { cb(); return; }
  // MV3 worker restarted -> rebuild from persisted state, keeping only still-open
  // windows; fall back to "current window is the sole pane" when nothing survives.
  chrome.storage.local.get('zb_tmux_state', function (o) {
    void chrome.runtime.lastError;
    var saved = o && o.zb_tmux_state;
    chrome.windows.getAll({}, function (wins) {
      void chrome.runtime.lastError;
      var openIds = (wins || []).map(function (w) { return w.id; });
      if (saved && saved.windows && saved.windows.length) {
        var rec = reconcile(saved, openIds);
        if (rec.windows.length) { TMUX.windows = rec.windows; TMUX.active = rec.active; cb(); return; }
      }
      chrome.windows.getLastFocused({}, function (win) {
        void chrome.runtime.lastError;
        var id = win && win.id;
        TMUX.windows = [{ name: '1', panes: id ? [id] : [], layout: 'cols', zoom: null, active: id || null, sync: false }];
        TMUX.active = 0; cb();
      });
    });
  });
}

function rectsFor(n, layout) {
  var W = WORKAREA, out = [], i;
  if (n <= 0) return out;
  if (n === 1) return [{ left: W.left, top: W.top, width: W.width, height: W.height }];
  if (layout === 'cols') { var w = Math.floor(W.width / n); for (i = 0; i < n; i++) out.push({ left: W.left + i * w, top: W.top, width: (i === n - 1 ? W.width - i * w : w), height: W.height }); }
  else if (layout === 'rows') { var h = Math.floor(W.height / n); for (i = 0; i < n; i++) out.push({ left: W.left, top: W.top + i * h, width: W.width, height: (i === n - 1 ? W.height - i * h : h) }); }
  else if (layout === 'main-v') { var mw = Math.floor(W.width * 0.6), rn = n - 1, rh = Math.floor(W.height / rn); out.push({ left: W.left, top: W.top, width: mw, height: W.height }); for (i = 0; i < rn; i++) out.push({ left: W.left + mw, top: W.top + i * rh, width: W.width - mw, height: (i === rn - 1 ? W.height - i * rh : rh) }); }
  else { var cols = Math.ceil(Math.sqrt(n)), rows = Math.ceil(n / cols), cw = Math.floor(W.width / cols), ch = Math.floor(W.height / rows); for (i = 0; i < n; i++) { var r = Math.floor(i / cols), cI = i % cols; out.push({ left: W.left + cI * cw, top: W.top + r * ch, width: cw, height: ch }); } }
  return out;
}
function upd(id, props) { try { chrome.windows.update(id, props, function () { void chrome.runtime.lastError; }); } catch (e) {} }

function tile() {
  var win = curWin(); if (!win) { publishTmux(); return; }
  if (!WORKAREA) { loadWorkArea(tile); return; }
  // minimize every pane that isn't in the active tmux window
  TMUX.windows.forEach(function (w, idx) { if (idx !== TMUX.active) w.panes.forEach(function (id) { upd(id, { state: 'minimized' }); }); });
  var panes = win.panes.filter(Boolean);
  if (win.zoom && panes.indexOf(win.zoom) >= 0) {
    panes.forEach(function (id) { id === win.zoom ? upd(id, { state: 'normal', left: WORKAREA.left, top: WORKAREA.top, width: WORKAREA.width, height: WORKAREA.height, focused: true }) : upd(id, { state: 'minimized' }); });
    publishTmux(); return;
  }
  var rects = rectsFor(panes.length, win.layout);
  panes.forEach(function (id, i) { var r = rects[i]; if (r) upd(id, { state: 'normal', left: r.left, top: r.top, width: r.width, height: r.height }); });
  if (win.active != null) upd(win.active, { focused: true });
  publishTmux();
}

function publishTmux() {
  try {
    chrome.storage.local.set({
      // statusbar projection (counts only)…
      zb_tmux: {
        windows: TMUX.windows.map(function (w) { return { name: w.name, panes: w.panes.length, layout: w.layout, zoom: !!w.zoom, sync: !!w.sync }; }),
        active: TMUX.active, anySync: TMUX.windows.some(function (w) { return w.sync; })
      },
      // …and the FULL state, so panes/groups survive an MV3 worker eviction and
      // ensureInit() can rebuild the tiling instead of forgetting every split.
      zb_tmux_state: { windows: TMUX.windows, active: TMUX.active }
    });
  } catch (e) {}
}

function tmuxCmd(sub, c) {
  ensureInit(function () {
    var win = curWin();
    if (sub === 'split') {
      win.layout = (c.dir === 'down') ? 'rows' : 'cols'; win.zoom = null;
      chrome.windows.create({ focused: true }, function (w) {
        void chrome.runtime.lastError; if (!w) return;
        var idx = win.panes.indexOf(win.active);
        win.panes.splice(idx < 0 ? win.panes.length : idx + 1, 0, w.id); win.active = w.id; tile();
        fireHook('pane-split', { dir: (c.dir === 'down') ? 'v' : 'h', paneId: w.id });
      });
    } else if (sub === 'navigate') {
      var panes = win.panes; if (!panes.length) return;
      var ci = panes.indexOf(win.active); if (ci < 0) ci = 0;
      var ni = (c.dir === 'prev' || c.dir === 'left' || c.dir === 'up') ? (ci - 1 + panes.length) % panes.length : (ci + 1) % panes.length;
      win.active = panes[ni]; upd(win.active, { focused: true }); publishTmux();
    } else if (sub === 'zoom') { win.zoom = win.zoom ? null : win.active; tile(); }
    else if (sub === 'closePane') { if (win.active != null) upd_remove(win.active); }
    else if (sub === 'newWindow') {
      chrome.windows.create({ focused: true }, function (w) {
        void chrome.runtime.lastError; if (!w) return;
        TMUX.windows.push({ name: String(TMUX.windows.length + 1), panes: [w.id], layout: 'cols', zoom: null, active: w.id, sync: false });
        TMUX.active = TMUX.windows.length - 1; tile();
      });
    } else if (sub === 'nextWindow' || sub === 'prevWindow') {
      if (TMUX.windows.length < 2) return;
      TMUX.active = sub === 'nextWindow' ? (TMUX.active + 1) % TMUX.windows.length : (TMUX.active - 1 + TMUX.windows.length) % TMUX.windows.length; tile();
    } else if (sub === 'selectLayout') {
      var order = ['cols', 'rows', 'main-v', 'grid']; win.layout = order[(order.indexOf(win.layout) + 1) % order.length]; win.zoom = null; tile();
    } else if (sub === 'syncToggle') { win.sync = !win.sync; publishTmux(); }
    else if (sub === 'killWindow') { win.panes.slice().forEach(function (id) { upd_remove(id); }); }
    else if (sub === 'retile') { tile(); }
  });
}
function upd_remove(id) { try { chrome.windows.remove(id, function () { void chrome.runtime.lastError; }); } catch (e) {} }

try {
  chrome.windows.onRemoved.addListener(function (winId) {
    var changed = false;
    TMUX.windows.forEach(function (w) { var i = w.panes.indexOf(winId); if (i >= 0) { w.panes.splice(i, 1); changed = true; if (w.active === winId) w.active = w.panes[Math.max(0, i - 1)] || null; if (w.zoom === winId) w.zoom = null; } });
    var before = TMUX.windows.length;
    TMUX.windows = TMUX.windows.filter(function (w) { return w.panes.length; });
    if (TMUX.windows.length !== before && TMUX.active >= TMUX.windows.length) TMUX.active = Math.max(0, TMUX.windows.length - 1);
    if (changed) { TMUX.windows.length ? tile() : publishTmux(); }
  });
  chrome.windows.onFocusChanged.addListener(function (winId) {
    if (winId == null || winId < 0) return;
    var w = findPaneWin(winId); if (w) { w.active = winId; var idx = TMUX.windows.indexOf(w); if (idx >= 0) TMUX.active = idx; publishTmux(); }
  });
} catch (e) {}

// synchronize-panes: a pane's content script relays a keystroke; if its tmux
// window has sync on, fan it out to every SIBLING pane's active tab to replay.
chrome.runtime.onMessage.addListener(function (msg, sender) {
  if (!msg || msg.type !== 'zbSync' || !sender || !sender.tab) return;
  var srcWin = sender.tab.windowId, w = findPaneWin(srcWin);
  if (!w || !w.sync) return;
  w.panes.forEach(function (pid) {
    if (pid === srcWin) return;
    chrome.tabs.query({ windowId: pid, active: true }, function (tabs) {
      void chrome.runtime.lastError;
      if (tabs && tabs[0]) chrome.tabs.sendMessage(tabs[0].id, { type: 'zbSyncApply', key: msg.key, code: msg.code }, function () { void chrome.runtime.lastError; });
    });
  });
});

/* ---- zwire lifecycle hooks: fire browser events to the native host so user
   stryke hooks (pages/hooks.js UI, backend hooks.rs) actually run. Best-effort;
   the host no-ops when no enabled hook is bound to the event. Listeners are
   registered at top level so the MV3 worker wakes for them. Event names match
   hooks::events() in the native host. ---- */
// `fireHook` is defined at the top of this worker. Each listener below is
// registered at top level so the MV3 worker wakes for its event. Every `on*`
// call is wrapped so a missing API/permission on one platform never breaks the
// rest. Event names match hooks::events() in the native host (keep in sync).
(function () {
  var on = function (obj, ev, fn) { try { if (obj && obj[ev] && obj[ev].addListener) obj[ev].addListener(fn); } catch (e) {} };
  // `action` is the catch-all: it fires for EVERY command/menu/palette invocation
  // (ported from the Audio-Haxor `action` hook) so ONE hook can react to anything,
  // filtered by $_.command. Specific events still fire too — bind whichever you want.
  var act = function (command, extra) { var p = { command: command }; if (extra) for (var k in extra) p[k] = extra[k]; fireHook('action', p); };

  // ── runtime / browser lifecycle ──
  on(chrome.runtime, 'onStartup', function () { fireHook('host-ready', {}); fireHook('app-open', {}); });
  on(chrome.runtime, 'onInstalled', function (d) { fireHook('extension-installed', { reason: d && d.reason }); });
  on(chrome.runtime, 'onSuspend', function () { fireHook('browser-suspend', {}); });
  on(chrome.runtime, 'onUpdateAvailable', function (d) { fireHook('update-available', { version: d && d.version }); });

  // ── tabs ──
  on(chrome.tabs, 'onCreated', function (tab) { fireHook('tab-created', { tabId: tab.id, url: tab.url || tab.pendingUrl || '', windowId: tab.windowId }); });
  on(chrome.tabs, 'onRemoved', function (tabId, info) { fireHook('tab-closed', { tabId: tabId, windowId: info && info.windowId, windowClosing: !!(info && info.isWindowClosing) }); });
  on(chrome.tabs, 'onActivated', function (info) { fireHook('tab-activated', { tabId: info.tabId, windowId: info.windowId }); });
  on(chrome.tabs, 'onUpdated', function (tabId, ch, tab) { if (ch && ch.status === 'complete') fireHook('tab-updated', { tabId: tabId, url: (tab && tab.url) || '', status: 'complete' }); });
  on(chrome.tabs, 'onMoved', function (tabId, info) { fireHook('tab-moved', { tabId: tabId, windowId: info.windowId, fromIndex: info.fromIndex, toIndex: info.toIndex }); });
  on(chrome.tabs, 'onDetached', function (tabId, info) { fireHook('tab-detached', { tabId: tabId, oldWindowId: info.oldWindowId, oldPosition: info.oldPosition }); });
  on(chrome.tabs, 'onAttached', function (tabId, info) { fireHook('tab-attached', { tabId: tabId, newWindowId: info.newWindowId, newPosition: info.newPosition }); });
  on(chrome.tabs, 'onReplaced', function (added, removed) { fireHook('tab-replaced', { addedTabId: added, removedTabId: removed }); });
  on(chrome.tabs, 'onHighlighted', function (info) { fireHook('tab-highlighted', { windowId: info.windowId, tabIds: info.tabIds }); });
  on(chrome.tabs, 'onZoomChange', function (info) { fireHook('tab-zoom-changed', { tabId: info.tabId, newZoom: info.newZoomFactor, oldZoom: info.oldZoomFactor }); });

  // ── windows ──
  on(chrome.windows, 'onCreated', function (w) { fireHook('window-created', { windowId: w.id, type: w.type, incognito: w.incognito }); });
  on(chrome.windows, 'onRemoved', function (winId) {
    fireHook('window-closed', { windowId: winId });
    // Last window gone ≈ the browser is closing → app-close (no direct quit event).
    try { chrome.windows.getAll({}, function (wins) { void chrome.runtime.lastError; if (!wins || !wins.length) fireHook('app-close', {}); }); } catch (e) {}
  });
  on(chrome.windows, 'onFocusChanged', function (winId) { fireHook('window-focus-changed', { windowId: winId }); });

  // ── navigation (top frame only) ──
  on(chrome.webNavigation, 'onBeforeNavigate', function (d) { if (d.frameId === 0) fireHook('navigation-started', { tabId: d.tabId, url: d.url }); });
  on(chrome.webNavigation, 'onCommitted', function (d) { if (d.frameId === 0) fireHook('navigation', { tabId: d.tabId, url: d.url, transition: d.transitionType }); });
  on(chrome.webNavigation, 'onDOMContentLoaded', function (d) { if (d.frameId === 0) fireHook('dom-content-loaded', { tabId: d.tabId, url: d.url }); });
  on(chrome.webNavigation, 'onCompleted', function (d) { if (d.frameId === 0) fireHook('navigation-completed', { tabId: d.tabId, url: d.url }); });
  on(chrome.webNavigation, 'onErrorOccurred', function (d) { if (d.frameId === 0) fireHook('navigation-error', { tabId: d.tabId, url: d.url, error: d.error }); });
  on(chrome.webNavigation, 'onHistoryStateUpdated', function (d) { if (d.frameId === 0) fireHook('history-state-updated', { tabId: d.tabId, url: d.url }); });

  // ── downloads ──
  on(chrome.downloads, 'onCreated', function (d) { fireHook('download-started', { id: d.id, url: d.url, filename: d.filename }); });
  on(chrome.downloads, 'onChanged', function (d) { if (d.state && d.state.current === 'complete') fireHook('download-completed', { id: d.id }); });
  on(chrome.downloads, 'onErased', function (id) { fireHook('download-erased', { id: id }); });

  // ── bookmarks ──
  on(chrome.bookmarks, 'onCreated', function (id, node) { fireHook('bookmark-created', { id: id, title: node && node.title, url: node && node.url }); });
  on(chrome.bookmarks, 'onRemoved', function (id) { fireHook('bookmark-removed', { id: id }); });
  on(chrome.bookmarks, 'onChanged', function (id, ch) { fireHook('bookmark-changed', { id: id, title: ch && ch.title, url: ch && ch.url }); });
  on(chrome.bookmarks, 'onMoved', function (id) { fireHook('bookmark-moved', { id: id }); });

  // ── history ──
  on(chrome.history, 'onVisited', function (item) { fireHook('history-visited', { url: item.url, title: item.title }); });
  on(chrome.history, 'onVisitRemoved', function (r) { fireHook('history-removed', { allHistory: !!(r && r.allHistory), urls: r && r.urls }); });

  // ── sessions (restore) ──
  on(chrome.sessions, 'onChanged', function () { fireHook('session-restored', {}); });

  // ── management (other extensions) ──
  on(chrome.management, 'onInstalled', function (info) { fireHook('management-installed', { id: info.id, name: info.name }); });
  on(chrome.management, 'onUninstalled', function (id) { fireHook('management-uninstalled', { id: id }); });
  on(chrome.management, 'onEnabled', function (info) { fireHook('management-enabled', { id: info.id, name: info.name }); });
  on(chrome.management, 'onDisabled', function (info) { fireHook('management-disabled', { id: info.id, name: info.name }); });

  // ── keyboard commands + alarms + notifications + toolbar action + display ──
  on(chrome.commands, 'onCommand', function (command) { fireHook('command', { command: command }); act('command:' + command); });
  on(chrome.alarms, 'onAlarm', function (a) { fireHook('alarm', { name: a && a.name }); });
  on(chrome.notifications, 'onClicked', function (id) { fireHook('notification-clicked', { id: id }); });
  on(chrome.notifications, 'onClosed', function (id, byUser) { fireHook('notification-closed', { id: id, byUser: !!byUser }); });
  on(chrome.action, 'onClicked', function (tab) { fireHook('action-clicked', { tabId: tab && tab.id }); act('action-clicked'); });
  on(chrome.system && chrome.system.display, 'onDisplayChanged', function () { fireHook('display-changed', {}); });

  // ── HUD scheme (any storage key change is also surfaced generically) ──
  on(chrome.storage, 'onChanged', function (ch, area) {
    if (area !== 'local' || !ch) return;
    if (ch.zb_scheme && ch.zb_scheme.newValue) fireHook('scheme-changed', { scheme: ch.zb_scheme.newValue });
  });

  // expose `act` so the zbFireHook relay can also emit the generic action mirror
  self.__zbAct = act;
})();
