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
        });
      }
    } catch (e) {}
  }

  poll();
  setInterval(poll, 1500);
})();
