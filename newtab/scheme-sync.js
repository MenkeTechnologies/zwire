/* zwire newtab theme-follower — the new-tab page subscribes DIRECTLY to the
 * zwire-host theme bus (the single source of truth, ~/.zwire/global.toml). One
 * persistent connectNative port `sub`s to `scheme` + `ui` + `palette`; the host
 * pushes the CURRENT value on subscribe (snapshot) and every change after — from
 * ANY app in the fleet. `palette` carries a custom/edited colorscheme's resolved
 * var->hex map (no name in the baked SCHEMES table); without it the new-tab page
 * cannot follow a custom scheme. No polling, no cross-extension messaging. */
(function () {
  'use strict';
  var HUD = window.ZWIRE_HUD || {};
  var SCHEMES = HUD.SCHEMES || {};
  var VAR_KEYS = HUD.VAR_KEYS || [];
  var HOST = 'com.zwire.hud';
  var applied = null;
  var appliedUi = '';
  var appliedPal = '';

  // Follow the shared light-mode + effect prefs (set on the HUD settings page,
  // written to the native file). Each effect ON = class ABSENT, matching ZGui.fx.
  function applyUi(ui) {
    ui = ui || {};
    // An EMPTY reply (missing/fresh native file) carries no state — ignore it so
    // it can't clobber an optimistically-applied or pushed value back to dark.
    if (!Object.keys(ui).length) return;
    var key = JSON.stringify(ui);
    if (key === appliedUi) return;
    appliedUi = key;
    var app = document.querySelector('.app') || document.body;
    // Apply each pref only when it's EXPLICITLY present, so a partial reply never
    // silently resets an unrelated pref (e.g. a light-only write flipping fx).
    if (typeof ui.scanlines === 'boolean') app.classList.toggle('no-scanlines', ui.scanlines === false);
    if (typeof ui.vignette === 'boolean') app.classList.toggle('no-vignette', ui.vignette === false);
    if (typeof ui.glow === 'boolean') app.classList.toggle('no-neon-glow', ui.glow === false);
    if (typeof ui.anim === 'boolean') app.classList.toggle('no-anim', ui.anim === false);
    if (typeof ui.light === 'boolean') document.documentElement.setAttribute('data-theme', ui.light ? 'light' : 'dark');
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
    appliedPal = '';
  }

  // Apply a RESOLVED palette (a custom/edited colorscheme, published on the
  // `palette` topic as a var->hex map already accounting for light mode). A
  // built-in named scheme has no `[theme.palette]` so this never fires for one;
  // a custom scheme has no entry in the baked SCHEMES table, so `apply(name)`
  // can't render it — this is the only path that themes the new-tab page for a
  // custom scheme. Mirrors hud-internal/pages/zg-boot.js's zb_palette listener.
  function applyPalette(pal) {
    // An empty `{}` snapshot (built-in scheme, no `[theme.palette]`) carries no
    // custom colours — ignore it so it can't reset the scheme dedup state below.
    if (!pal || typeof pal !== 'object' || !Object.keys(pal).length) return;
    var key = JSON.stringify(pal);
    if (key === appliedPal) return;
    appliedPal = key;
    var root = document.documentElement.style;
    for (var k in pal) {
      if (k.charAt(0) === '-' && typeof pal[k] === 'string' && pal[k]) root.setProperty(k, pal[k]);
    }
    // Force a subsequent same-named `scheme` push (custom -> back to X) to
    // re-apply instead of dedup-skipping and leaving these inline vars behind.
    applied = null;
  }

  // Persistent subscription to the host theme bus. On (re)connect we `sub` to
  // all three topics; the host replies with a snapshot (current value) and pushes
  // every future change as {ev:'pub', topic, data}. If the host drops (idle/exit)
  // we reconnect — the next snapshot re-converges us.
  function onFrame(m) {
    if (!m || m.ev !== 'pub') return;
    if (m.topic === 'scheme' && m.data && m.data.scheme) apply(m.data.scheme);
    else if (m.topic === 'ui' && m.data) applyUi(m.data);
    else if (m.topic === 'palette' && m.data) applyPalette(m.data);
  }
  function connect() {
    var port;
    try { port = chrome.runtime.connectNative(HOST); } catch (e) { setTimeout(connect, 2000); return; }
    port.onMessage.addListener(onFrame);
    port.onDisconnect.addListener(function () { void chrome.runtime.lastError; setTimeout(connect, 1500); });
    try { port.postMessage({ cmd: 'sub', topic: 'scheme' }); port.postMessage({ cmd: 'sub', topic: 'ui' }); port.postMessage({ cmd: 'sub', topic: 'palette' }); } catch (e) {}
  }
  connect();
})();
