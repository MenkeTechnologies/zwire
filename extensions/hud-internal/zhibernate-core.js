/* zwire HUD — auto-hibernate decision core (see background.js `hibernateSweep`).
 *
 * Which tabs the sweep is allowed to discard is the whole safety question here, so the
 * decision lives in its own pure module: background.js loads it with importScripts and
 * tests/hibernate.mjs loads the same file headless.
 *
 * `chrome.tabs.discard()` destroys the tab's WebContents. Everything the page owns dies
 * with it, INCLUDING every live MediaStreamTrack — a video call on that tab loses its
 * camera, microphone and screen share in the same instant, with no crash and nothing in
 * the log to read afterwards. Chromium refuses this for its own Memory Saver
 * (DiscardEligibilityPolicy::CanDiscard checks IsCapturingVideo/Audio/Window/Display and
 * IsBeingMirrored), but the extension path does NOT consult that policy: it reaches
 * TabLifecycleUnit::Discard with reason EXTERNAL, which only checks tab-strip membership
 * and the already-discarded bit. So the guard has to be here — and, for the native half,
 * in fork patch 0028.
 *
 * `tab.audible` does not cover it. A tab is audible when it PRODUCES sound; a tab that is
 * capturing your microphone and screen while you present produces none, so the audible
 * check waves a live call straight through. Capture state comes instead from
 * zcapture-main.js (MAIN world: getUserMedia / getDisplayMedia / RTCPeerConnection), which
 * reports per frame — `captureByTab` is {tabId: {frameId: true|false}} and a tab counts as
 * live while ANY of its frames is. */
(function (root) {
  'use strict';

  // A tab is capture-live while at least one of its frames reports live capture.
  function isCaptureLive(captureByTab, tabId) {
    var frames = captureByTab && captureByTab[tabId];
    if (!frames) return false;
    for (var f in frames) {
      if (Object.prototype.hasOwnProperty.call(frames, f) && frames[f]) return true;
    }
    return false;
  }

  // Ids of tabs idle longer than `thresholdMs` that are safe to discard.
  // `lastActive` is {tabId: epochMs} (seeded by the sweep, updated on activation);
  // a tab with no entry is skipped so the next sweep can age it from a known start.
  function staleTabIds(tabs, lastActive, now, thresholdMs, captureByTab) {
    return (tabs || []).filter(function (t) {
      if (t.active || t.pinned || t.audible || t.discarded) return false;
      if (isCaptureLive(captureByTab, t.id)) return false;   // live camera/mic/screen share
      var la = lastActive[t.id]; if (la == null) return false;
      return (now - la) > thresholdMs;
    }).map(function (t) { return t.id; });
  }

  root.ZWIRE_HIBERNATE = { staleTabIds: staleTabIds, isCaptureLive: isCaptureLive };
})(typeof self !== 'undefined' ? self : this);
