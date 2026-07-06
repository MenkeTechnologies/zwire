/* zwire newtab scheme-follower — makes the new-tab page follow the shared
 * 8-scheme picker. Reads the active scheme from the native host (the single
 * source of truth, ~/.zwire/hud-scheme) and applies that palette's HUD vars
 * to :root, polling so it live-follows changes made on any chrome:// page. */
(function () {
  'use strict';
  var HUD = window.ZWIRE_HUD || {};
  var SCHEMES = HUD.SCHEMES || {};
  var VAR_KEYS = HUD.VAR_KEYS || [];
  var HOST = 'com.zwire.hud';
  var applied = null;
  var appliedUi = '';

  // Follow the shared light-mode + effect prefs (set on the HUD settings page,
  // written to the native file). Each effect ON = class ABSENT, matching ZGui.fx.
  function applyUi(ui) {
    ui = ui || {};
    var key = JSON.stringify(ui);
    if (key === appliedUi) return;
    appliedUi = key;
    var app = document.querySelector('.app') || document.body;
    app.classList.toggle('no-scanlines', ui.scanlines === false);
    app.classList.toggle('no-vignette', ui.vignette === false);
    app.classList.toggle('no-neon-glow', ui.glow === false);
    app.classList.toggle('no-anim', ui.anim === false);
    document.documentElement.setAttribute('data-theme', ui.light ? 'light' : 'dark');
  }

  function apply(name) {
    var s = SCHEMES[name];
    if (!s || name === applied) return;
    var vars = s.vars || {};
    var root = document.documentElement;
    for (var i = 0; i < VAR_KEYS.length; i++) {
      var k = VAR_KEYS[i];
      if (vars[k]) root.style.setProperty(k, vars[k]);
    }
    root.setAttribute('data-hud-scheme', name);
    applied = name;
  }

  function poll() {
    try {
      if (chrome && chrome.runtime && chrome.runtime.sendNativeMessage) {
        chrome.runtime.sendNativeMessage(HOST, { cmd: 'get' }, function (resp) {
          if (chrome.runtime.lastError) return;
          if (resp && resp.scheme) apply(resp.scheme);
          if (resp) applyUi(resp.ui);
        });
      }
    } catch (e) {}
  }

  // Instant path: the HUD pushes zb-scheme / zb-ui the moment they change, so we
  // don't wait up to 1.5s for the next poll. The poll stays as a fallback.
  var HUD_ID = 'omcgnnjfmbmpdlofklbpddkhnfibfhgg';
  try {
    chrome.runtime.onMessageExternal.addListener(function (msg, sender) {
      if (!sender || sender.id !== HUD_ID || !msg) return;
      if (msg.type === 'zb-scheme' && msg.scheme) apply(msg.scheme);
      if (msg.type === 'zb-ui' && msg.ui) applyUi(msg.ui);
    });
  } catch (e) {}

  poll();
  setInterval(poll, 1500);
})();
