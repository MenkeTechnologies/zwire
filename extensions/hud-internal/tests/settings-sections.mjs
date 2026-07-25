// Settings section routing (pages/settings.js). The page exposes its routing
// model on `window.ZBSettings` and bails before touching settingsPrivate/DOM, so
// it loads headless here.
//
// This is the layer the "no way to clear browser history" bug lived in: the HUD
// shadows every chrome://settings/* URL, so a slug that routes nowhere means the
// feature is unreachable in the whole browser. Each assertion below is a URL a
// user (or Chrome's own Cmd+Shift+Delete) can land on.
import fs from 'node:fs';
import assert from 'node:assert/strict';

const src = fs.readFileSync(new URL('../pages/settings.js', import.meta.url), 'utf8');
const win = {};
new Function('window', src)(win);
const S = win.ZBSettings;
assert.ok(S && S.sectionForSlug, 'window.ZBSettings not exposed');

const ids = S.SECTIONS.map((s) => s.id);
assert.ok(ids.includes('advanced'), 'advanced catch-all section missing');

// Every slug route points at a section that actually exists — a typo here is a
// dead deep-link, which is exactly how clearBrowserData went nowhere.
for (const [slug, id] of Object.entries(S.SLUG_SECTION)) {
  assert.ok(ids.includes(id), `slug ${slug} routes to unknown section ${id}`);
  assert.equal(slug, slug.toLowerCase(), `slug ${slug} must be lowercase to match the lookup`);
}
// Same for the key table.
for (const [id, prefix, mode] of S.SECTION_KEYS) {
  assert.ok(ids.includes(id), `key prefix ${prefix} routes to unknown section ${id}`);
  assert.ok(mode === undefined || mode === 'raw', `key prefix ${prefix} has unknown match mode ${mode}`);
}

// --- the clear-data path -----------------------------------------------------
// Chrome's own shortcut and menu item land on chrome://settings/clearBrowserData.
assert.equal(S.sectionForSlug('clearBrowserData'), 'privacy');
assert.equal(S.sectionForSlug('deleteBrowsingData'), 'privacy');
assert.ok(S.isClearSlug('clearBrowserData'));
assert.ok(S.isClearSlug('deleteBrowsingData'));
// Landing on the privacy section is not the same as being asked to clear.
assert.ok(!S.isClearSlug('privacy'));
assert.ok(!S.isClearSlug(null));

// --- the rest of Chrome's settings slugs -------------------------------------
const SLUGS = {
  appearance: 'appearance', autofill: 'autofill', payments: 'autofill', addresses: 'autofill',
  passwords: 'autofill', privacy: 'privacy', security: 'privacy', cookies: 'privacy',
  content: 'privacy', syncSetup: 'privacy', search: 'search', onStartup: 'startup',
  downloads: 'downloads', languages: 'languages', performance: 'performance',
  accessibility: 'accessibility', system: 'advanced', reset: 'advanced'
};
for (const [slug, want] of Object.entries(SLUGS)) {
  assert.equal(S.sectionForSlug(slug), want, `slug ${slug} should route to ${want}`);
}
// An unknown slug routes nowhere rather than to a wrong section — the caller
// then keeps its default section instead of jumping somewhere random.
assert.equal(S.sectionForSlug('someFuturePage'), null);

// --- pref key routing --------------------------------------------------------
// Keys are real Chromium pref names (chrome/common/pref_names.h and the
// component pref_names headers of the pinned checkout), not invented ones.
const KEYS = {
  'browser.show_home_button': 'appearance',
  'bookmark_bar.show_on_all_tabs': 'appearance',
  'webkit.webprefs.default_font_size': 'appearance',
  'safebrowsing.enabled': 'privacy',
  'https_only_mode_enabled': 'privacy',
  'https_first_balanced_mode_enabled': 'privacy',
  'dns_over_https.mode': 'privacy',
  'enable_do_not_track': 'privacy',
  'profile.cookie_controls_mode': 'privacy',
  'autofill.profile_enabled': 'autofill',
  'credentials_enable_service': 'autofill',
  'payments.can_make_payment_enabled': 'autofill',
  'default_search_provider.enabled': 'search',
  'session.restore_on_startup': 'startup',
  'download.default_directory': 'downloads',
  'intl.accept_languages': 'languages',
  'translate.enabled': 'languages',
  'spellcheck.dictionaries': 'languages',
  'performance_tuning.high_efficiency_mode.state': 'performance',
  'net.network_prediction_options': 'performance',
  'settings.a11y.caretbrowsing.enabled': 'accessibility',
  'accessibility.captions.live_caption_enabled': 'accessibility'
};
for (const [key, want] of Object.entries(KEYS)) {
  assert.equal(S.sectionForKey(key), want, `pref ${key} should route to ${want}`);
}

// A prefix match must be on a dotted boundary — 'download' must not swallow an
// unrelated key that merely starts with the same letters.
assert.equal(S.sectionForKey('downloadable_fonts.enabled'), 'advanced');
assert.equal(S.sectionForKey('sessionless_thing.x'), 'advanced');
// Password-leak detection is a password pref even though it is a generated.*
// key, and generated.* otherwise belongs to privacy.
assert.equal(S.sectionForKey('generated.password_leak_detection'), 'autofill');
assert.equal(S.sectionForKey('generated.https_first_mode'), 'privacy');
// Anything unrecognized still shows up — in Advanced, never dropped.
assert.equal(S.sectionForKey('some.future.pref'), 'advanced');
assert.equal(S.sectionForKey(''), 'advanced');
assert.equal(S.sectionForKey(undefined), 'advanced');

console.log('settings-sections: ok');
