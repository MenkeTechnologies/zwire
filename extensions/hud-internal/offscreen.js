// Offscreen document: a PERSISTENT page that runs stryke via native messaging on behalf of external
// web pages. A content script can't reach the native host or chrome.tabs, so it delegates to the
// service worker — but the worker is ephemeral and does not reliably survive the ~200ms native
// round-trip. A page is never torn down mid-operation (proven by the internal HUD pages), so we do
// the slow round-trip HERE, then hand the resulting browser action back to the worker as a fresh
// message. The worker only performs the fast chrome.tabs op, which the browser process completes even
// if the worker is reclaimed right after.
var HOST = 'com.zwire.hud';

chrome.runtime.onMessage.addListener(function (msg) {
  if (!msg || msg.type !== 'zbOffStryke' || !msg.code) return;
  try {
    chrome.runtime.sendNativeMessage(HOST, { cmd: 'stryke_run', code: msg.code }, function (reply) {
      void chrome.runtime.lastError;
      // The host piggybacks any browser.* action the script queued onto the reply (reply.zbAction).
      // Send it to the worker to execute (chrome.tabs.create etc.).
      if (reply && reply.zbAction && reply.zbAction.a) {
        try { chrome.runtime.sendMessage({ type: 'zbExec', action: reply.zbAction }); } catch (e) {}
      }
    });
  } catch (e) {}
});
