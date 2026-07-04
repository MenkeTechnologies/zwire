/* zbrowser HUD: replace Chrome's chrome://extensions with our own HUD page.
 * Runs at document_start so Chrome's WebUI never renders. */
try {
  location.replace(chrome.runtime.getURL('pages/extensions.html'));
} catch (e) {
  location.href = chrome.runtime.getURL('pages/extensions.html');
}
