/* zwire HUD — live-capture detector (MAIN world).
 *
 * Reports "this frame holds a live capture" so the auto-hibernate sweep never discards a
 * tab that is on camera, on a microphone, sharing a screen, or holding an open WebRTC
 * session (see zhibernate-core.js for why discarding one of those kills the call).
 *
 * This runs in the MAIN world because that is the only place the page's own
 * `navigator.mediaDevices` and `RTCPeerConnection` exist — an isolated-world content
 * script gets its own copies and would watch a set of objects no page ever calls. The MAIN
 * world has no chrome.* APIs in turn, so the state goes out by window.postMessage and
 * zcapture.js (isolated) relays it to the worker.
 *
 * Liveness is re-derived from the objects themselves on a timer rather than tracked
 * through wrapped stop()/close() calls: MediaStreamTrack.stop() deliberately does NOT fire
 * `ended`, so an event-only tracker would keep reporting a call that hung up minutes ago.
 * The timer runs only while something is being watched, and stops itself when the last
 * track and peer connection are gone. */
(function () {
  'use strict';
  if (typeof window === 'undefined' || window.__zwireCaptureHook) return;
  window.__zwireCaptureHook = true;

  var POLL_MS = 4000;
  var tracks = [];      // MediaStreamTrack handed out by getUserMedia / getDisplayMedia
  var conns = [];       // RTCPeerConnection instances
  var timer = 0;
  var reported = null;  // last value posted, so an unchanged state is silent

  function prune() {
    tracks = tracks.filter(function (t) {
      try { return t.readyState === 'live'; } catch (e) { return false; }
    });
    conns = conns.filter(function (pc) {
      try {
        var s = pc.connectionState || pc.iceConnectionState || '';
        return s !== 'closed' && s !== 'failed';
      } catch (e) { return false; }
    });
  }
  function isLive() { return tracks.length > 0 || conns.length > 0; }
  function post(live) {
    if (live === reported) return;
    reported = live;
    try { window.postMessage({ __zwireCapture: 1, live: live }, '*'); } catch (e) {}
  }
  function tick() {
    prune();
    post(isLive());
    if (!isLive() && timer) { clearInterval(timer); timer = 0; }
  }
  function watch() {
    post(isLive());
    if (!timer) { try { timer = setInterval(tick, POLL_MS); } catch (e) {} }
  }

  // getUserMedia / getDisplayMedia — collect the tracks each grant hands back. The
  // original promise is returned untouched on any failure so a hook bug can never break
  // a page's capture.
  try {
    var md = navigator.mediaDevices;
    if (md) {
      ['getUserMedia', 'getDisplayMedia'].forEach(function (name) {
        var orig = md[name];
        if (typeof orig !== 'function') return;
        md[name] = function () {
          var p = orig.apply(md, arguments);
          try {
            return p.then(function (stream) {
              try {
                stream.getTracks().forEach(function (t) { tracks.push(t); });
                watch();
              } catch (e) {}
              return stream;
            });
          } catch (e) { return p; }
        };
      });
    }
  } catch (e) {}

  // RTCPeerConnection — a construct trap keeps the real constructor's prototype, statics
  // and instanceof intact, which subclassing by hand does not.
  try {
    var RPC = window.RTCPeerConnection;
    if (typeof RPC === 'function' && typeof Proxy === 'function') {
      window.RTCPeerConnection = new Proxy(RPC, {
        construct: function (target, args, newTarget) {
          var pc = Reflect.construct(target, args, newTarget);
          try { conns.push(pc); watch(); } catch (e) {}
          return pc;
        }
      });
    }
  } catch (e) {}
})();
