/* zwire HUD — Hide Cookie Warnings (ports Vivaldi's cookie-banner dismisser).
 * Hides cookie-consent / GDPR banners on every page and unlocks any scroll they
 * pinned. Curated selectors for the big consent SDKs + a heuristic for the rest
 * (a fixed/sticky element whose text reads like a consent notice). Runs on load
 * and briefly watches for late-injected banners. Toggle via zb_cookiehide.
 *
 * The pure consent-text heuristic is exposed as window.__zbIsConsent for tests. */
(function () {
  'use strict';

  // Text that marks an element as a cookie/consent notice — consent CONTEXT, not
  // a bare "cookies" mention (so a bakery page isn't mistaken for a banner).
  var CONSENT_RE = /(cookie (policy|consent|settings|banner|notice|preferences))|((accept|reject|allow|manage|decline|enable)\s+(all\s+)?cookies)|(we use cookies|uses? cookies|use of cookies)|\b(consent|gdpr|ccpa)\b|(accept all|reject all)|(privacy preferences|we value your privacy)|(manage (your )?preferences)/i;
  function isConsent(text) { return CONSENT_RE.test(String(text || '')); }
  if (typeof window !== 'undefined') window.__zbIsConsent = isConsent;

  if (typeof window === 'undefined' || typeof document === 'undefined' || typeof chrome === 'undefined' || !chrome.storage) return;
  if (window.__zbCookiesLoaded) return;
  window.__zbCookiesLoaded = true;

  // Known consent-SDK containers — hidden outright. No `.cmp-*` classes: Adobe AEM
  // Core Components prefix every component with `cmp-` (`.cmp-container` is the
  // page's own layout root), so they blank whole AEM sites.
  var SELECTORS = [
    '#onetrust-banner-sdk', '#onetrust-consent-sdk', '.ot-sdk-container',
    '#cookie-banner', '#cookie-consent', '#cookieConsent', '.cookie-banner', '.cookie-consent',
    '.cc-window', '.cc-banner', '#CybotCookiebotDialog', '#cmpbox',
    '#gdpr-consent-tool-wrapper', '.qc-cmp2-container', '#usercentrics-root', '#sp_message_container_1',
    '.osano-cm-window', '#hs-eu-cookie-confirmation', '.cookienotice', '.cookie-notice',
    '[aria-label*="cookie" i]', '[class*="cookie" i][class*="consent" i]', '[id*="cookie" i][class*="banner" i]'
  ];
  var enabled = true;
  try {
    chrome.storage.local.get('zb_cookiehide', function (o) { void chrome.runtime.lastError; if (o && o.zb_cookiehide === false) enabled = false; if (enabled) run(); });
    chrome.storage.onChanged.addListener(function (ch, area) { if (area === 'local' && ch.zb_cookiehide) { enabled = ch.zb_cookiehide.newValue !== false; if (enabled) run(); } });
  } catch (e) {}

  function unlockScroll() {
    try {
      var h = document.documentElement, b = document.body;
      [h, b].forEach(function (el) { if (el && getComputedStyle(el).overflow === 'hidden') { el.style.setProperty('overflow', 'auto', 'important'); } });
    } catch (e) {}
  }
  // A selector that collides with a site's own class names must not take the page
  // down with it: never hide anything that wraps the page's main content.
  function wrapsPage(el) {
    var main = document.querySelector('main, [role="main"], h1');
    return el === document.body || el === document.documentElement || !!(main && el.contains(main));
  }
  function hide(el) {
    if (wrapsPage(el)) return false;
    try { el.style.setProperty('display', 'none', 'important'); } catch (e) {}
    return true;
  }
  function sweep() {
    if (!enabled) return;
    var hit = false;
    SELECTORS.forEach(function (s) { try { document.querySelectorAll(s).forEach(function (el) { if (hide(el)) hit = true; }); } catch (e) {} });
    // Heuristic: a fixed/sticky overlay whose text looks like consent + isn't the whole page.
    try {
      var nodes = document.querySelectorAll('div,section,aside,dialog');
      for (var i = 0; i < nodes.length && i < 4000; i++) {
        var el = nodes[i], pos;
        try { pos = getComputedStyle(el).position; } catch (e) { continue; }
        if (pos !== 'fixed' && pos !== 'sticky') continue;
        var txt = (el.textContent || '').slice(0, 400);
        if (txt.length > 12 && txt.length < 1500 && isConsent(txt) && el.querySelector('button,a')) { if (hide(el)) hit = true; }
      }
    } catch (e) {}
    if (hit) unlockScroll();
  }
  var obs = null, deadline = 0;
  function run() {
    sweep();
    // Banners often inject a second or two after load — watch briefly.
    try {
      if (!obs) { obs = new MutationObserver(function () { if (Date.now() < deadline) sweep(); }); }
      deadline = Date.now() + 6000;
      obs.observe(document.documentElement, { childList: true, subtree: true });
      setTimeout(function () { try { if (obs) obs.disconnect(); } catch (e) {} obs = null; }, 6200);
    } catch (e) {}
  }
  window.__zbCookiesToggle = function () {
    try { chrome.storage.local.get('zb_cookiehide', function (o) { void chrome.runtime.lastError; var on = !(o && o.zb_cookiehide === false); chrome.storage.local.set({ zb_cookiehide: !on }); }); } catch (e) {}
  };
})();
