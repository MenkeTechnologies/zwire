/* zwire app store — catalog for the HUD App Store page + the first-run modal.
 *
 * These are the PAID apps from the MenkeTechnologies storefront — the "buy"
 * targets. The live catalog at app-store/store.js is the canonical source of
 * truth for pricing; prices are intentionally NOT duplicated here, because they
 * change. Every card links to the live product page, which renders the current
 * price and runs checkout. Keep the `id`s in sync with store.js; free CLI/dev
 * tools and the book catalog live on the site (linked via "Browse full store").
 */
(function () {
  'use strict';

  var BASE = 'https://menketechnologies.github.io/app-store/';
  function url(id) { return BASE + 'product.html?id=' + encodeURIComponent(id); }

  var PRODUCTS = [
    // ---- Desktop Apps -------------------------------------------------------
    { id: 'zpdf',        glyph: 'P',  name: 'zpdf',        category: 'Desktop Apps', badge: 'NEW',
      tag: 'PDF editor — edit, annotate, sign; replaces Acrobat & Preview.', pills: ['Tauri v2', 'Rust'] },
    { id: 'zphoto',      glyph: 'PH', name: 'zphoto',      category: 'Desktop Apps', badge: 'NEW',
      tag: 'Raster photo editor — layers, filters, brushes; replaces Photoshop.', pills: ['Tauri v2', 'Rust'] },
    { id: 'zoffice',     glyph: 'O',  name: 'zoffice',     category: 'Desktop Apps', badge: 'NEW',
      tag: 'Office suite — docs, sheets, slides; replaces Microsoft Office.', pills: ['Tauri v2', 'Rust'] },
    { id: 'zemail',      glyph: 'E',  name: 'zemail',      category: 'Desktop Apps', badge: 'NEW',
      tag: 'A fast, owned desktop email client in Rust.', pills: ['Tauri v2', 'Rust'] },
    { id: 'zstation',    glyph: 'ST', name: 'zstation',    category: 'Desktop Apps', badge: 'NEW',
      tag: 'A workspace of session-isolated web apps; replaces station.app.', pills: ['Tauri v2', 'Isolated webviews'] },
    { id: 'audio-haxor', glyph: 'A',  name: 'audio haxor', category: 'Desktop Apps', badge: 'BESTSELLER',
      tag: 'Maps every VST/AU/CLAP, sample library and DAW project you own.', pills: ['Tauri v2', 'JUCE'] },
    { id: 'traderview',  glyph: 'T',  name: 'traderview',  category: 'Desktop Apps', badge: 'NEW',
      tag: 'A trading journal — broker import, FIFO roll-up, equity curve.', pills: ['Tauri v2', '13 brokers'] },
    { id: 'ztranslator', glyph: 'ZT', name: 'ztranslator', category: 'Desktop Apps', badge: 'NEW',
      tag: 'Real-time MIDI / OSC / DMX / file-watcher event router.', pills: ['MIDI · OSC · DMX', '.bmtp import'] },
    { id: 'zcite',       glyph: 'C',  name: 'zcite',       category: 'Desktop Apps', badge: 'NEW',
      tag: 'Reference manager — cite, BibTeX, DOI lookup; replaces Zotero.', pills: ['Tauri v2', 'Rust'] },
    { id: 'zreq',        glyph: 'R',  name: 'zreq',        category: 'Desktop Apps', badge: 'NEW',
      tag: 'API client — collections, auth, codegen; replaces Postman.', pills: ['Tauri v2', 'Rust'] },
    { id: 'ztunnel',     glyph: 'TN', name: 'ztunnel',     category: 'Desktop Apps', badge: 'NEW',
      tag: 'VPN manager — OpenVPN & WireGuard; replaces Tunnelblick.', pills: ['Tauri v2', 'Rust'] },
    { id: 'zgo',         glyph: 'G',  name: 'zgo',         category: 'Desktop Apps', badge: 'NEW',
      tag: 'A launcher — workflows, script filters, snippets; replaces Alfred.', pills: ['Tauri v2', 'Rust'] },
    { id: 'zftp',        glyph: 'FT', name: 'zftp',        category: 'Desktop Apps', badge: 'NEW',
      tag: 'File transfer — FTP/SFTP/WebDAV + S3 & cloud; replaces Cyberduck.', pills: ['Tauri v2', 'FTP · SFTP · S3'] },
    { id: 'zcontainer',  glyph: 'CT', name: 'zcontainer',  category: 'Desktop Apps', badge: 'WORLD FIRST',
      tag: 'The first native (non-Electron) Docker + Kubernetes desktop GUI.', pills: ['Docker · Kubernetes', 'Rust'] },
    { id: 'zterminal',   glyph: 'TE', name: 'zterminal',   category: 'Desktop Apps', badge: 'NEW',
      tag: 'GPU-accelerated terminal emulator with native tmux control.', pills: ['OpenGL GPU', 'Native tmux'] },
    { id: 'zpwr-daw',    glyph: 'D',  name: 'zpwr-daw',    category: 'Desktop Apps', badge: 'NEW',
      tag: 'A two-view DAW — Arrangement timeline + Session clip launcher.', pills: ['JUCE + Tauri', 'Arrangement + Session'] },

    // ---- Audio Plugins ------------------------------------------------------
    { id: 'zpwr-synth',  glyph: 'S',  name: 'zpwr-synth',  category: 'Audio Plugins', badge: 'WORLD FIRST',
      tag: 'A fully modular patch-graph synthesizer built on JUCE.', pills: ['VST3/AU/CLAP', 'Fully modular'] },
    { id: 'zpwr-fx',     glyph: 'F',  name: 'zpwr-fx',     category: 'Audio Plugins', badge: 'WORLD FIRST',
      tag: 'A fully modular patch-graph effects plugin with a mod matrix.', pills: ['VST3/AU/CLAP', 'Analog models'] },
    { id: 'zpwr-midi-fx',glyph: 'M',  name: 'zpwr-midi-fx',category: 'Audio Plugins', badge: 'WORLD FIRST',
      tag: 'A fully modular MIDI-effects plugin on the same patch-graph engine.', pills: ['VST3/AU/CLAP', 'Fully modular'] }
  ];

  // Primary screenshot per app (a webp in app-store/assets), shown as the card
  // thumb. Mirrors the first DETAILS[id].screenshots entry on the live
  // storefront; a card falls back to its glyph when an app has no shot yet
  // (e.g. zpwr-daw). Paths are relative to BASE, so they resolve to the live
  // gh-pages assets.
  var SHOTS = {
    zpdf:           'assets/zpdf.webp',
    zphoto:         'assets/zphoto.webp',
    zoffice:        'assets/zoffice.webp',
    zemail:         'assets/zemail.webp',
    zstation:       'assets/zstation.webp',
    'audio-haxor':  'assets/audio-haxor/plugins.webp',
    traderview:     'assets/traderview.webp',
    ztranslator:    'assets/ztranslator.webp',
    zcite:          'assets/zcite.webp',
    zreq:           'assets/zreq.webp',
    ztunnel:        'assets/ztunnel.webp',
    zgo:            'assets/zgo.webp',
    zftp:           'assets/zftp.webp',
    zcontainer:     'assets/zcontainer/dashboard.webp',
    zterminal:      'assets/zterminal/dashboard.webp',
    'zpwr-synth':   'assets/zsynth-synth.webp',
    'zpwr-fx':      'assets/zpwr-fx.webp',
    'zpwr-midi-fx': 'assets/zpwr-midi-fx.webp'
  };
  PRODUCTS.forEach(function (p) { if (SHOTS[p.id]) p.shot = SHOTS[p.id]; });

  window.ZWIRE_STORE = {
    BASE: BASE,
    url: url,
    PRODUCTS: PRODUCTS,
    FEATURED: ['zpdf', 'zoffice', 'zphoto', 'zemail', 'audio-haxor', 'zcontainer']
  };
})();
