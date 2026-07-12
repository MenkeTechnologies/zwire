/* zwire HUD — two small Vivaldi content-script actions:
 *   • Pop-out video (Picture-in-Picture): window.__zbPipToggle() PiPs the playing
 *     (or largest) <video>, or exits PiP if already popped out.
 *   • Quick note from selection: window.__zbQuickNote() saves the current text
 *     selection (title + url) into the Notes store (zb_notes) — pairs with the
 *     Notes page. Both are opened from the ⌘K palette.
 *
 * The pure video-picker (biggest visible playing video) is exposed as
 * window.__zbPickVideo for tests. */
(function () {
  'use strict';

  // Pick the best <video> to pop out: prefer a playing one, then the largest.
  function pickVideo(videos) {
    var best = null, bestArea = -1;
    (videos || []).forEach(function (v) {
      var area = (v.w || 0) * (v.h || 0);
      var score = area + (v.playing ? 1e9 : 0);   // playing videos always win
      if (score > bestArea) { bestArea = score; best = v; }
    });
    return best;
  }
  if (typeof window !== 'undefined') window.__zbPickVideo = pickVideo;

  if (typeof window === 'undefined' || typeof document === 'undefined' || typeof chrome === 'undefined') return;
  if (window.__zbExtrasLoaded) return;
  window.__zbExtrasLoaded = true;

  function toast(msg) {
    try { if (window.ZGui && ZGui.toast) { ZGui.toast.show(msg); return; } } catch (e) {}
    var d = document.createElement('div'); d.textContent = msg;
    d.style.cssText = 'position:fixed;bottom:16px;right:16px;z-index:2147483647;background:#0a0d16;color:#05d9e8;border:1px solid #05d9e8;padding:8px 12px;font:12px "Share Tech Mono",monospace;border-radius:4px;';
    (document.body || document.documentElement).appendChild(d); setTimeout(function () { try { d.remove(); } catch (e) {} }, 2600);
  }

  window.__zbPipToggle = function () {
    try {
      if (document.pictureInPictureElement) { document.exitPictureInPicture(); return; }
      var vids = Array.prototype.slice.call(document.querySelectorAll('video')).map(function (v) {
        var r = v.getBoundingClientRect();
        return { v: v, w: r.width, h: r.height, playing: !v.paused && !v.ended && v.readyState > 2 };
      });
      var picked = pickVideo(vids);
      if (!picked || !picked.v) { toast('no video on this page'); return; }
      if (picked.v.requestPictureInPicture) picked.v.requestPictureInPicture().catch(function () { toast('pip blocked'); });
      else toast('pip unsupported');
    } catch (e) { toast('pip failed'); }
  };

  window.__zbQuickNote = function () {
    try {
      var sel = ''; try { sel = String(window.getSelection ? window.getSelection().toString() : '').trim(); } catch (e) {}
      var title = document.title || location.hostname;
      var content = sel || title;
      var note = { id: 'n' + Date.now().toString(36), parentId: null, type: 'note', title: title.slice(0, 120), content: content, url: location.href, ts: Date.now() };
      chrome.storage.local.get('zb_notes', function (o) {
        void chrome.runtime.lastError;
        var notes = (o && o.zb_notes) || [];
        notes.unshift(note);
        chrome.storage.local.set({ zb_notes: notes }, function () { void chrome.runtime.lastError; toast(sel ? 'selection saved to Notes' : 'page saved to Notes'); });
      });
    } catch (e) { toast('could not save note'); }
  };
})();
