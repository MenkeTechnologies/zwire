/* zwire HUD — Dashboard. One searchable, categorized tile grid that launches EVERY zwire HUD
 * page AND every chrome:// internal page. Launcher chrome is ZGui.tiles (zgui-core's ported
 * traderview/Audio-Haxor launcher); per-category order is drag-reorderable + persisted via
 * ZGui.drag. The shell header filter (ZGui.searchBox) drives the grid — tiles' own search is off
 * so there's a single filter box. All UI is ZGui.* per the zgui-core-only rule.
 *
 * The chrome:// catalog below is transcribed verbatim from this build's chrome://chrome-urls
 * (both the regular WebUI list and the "Internal Debugging Page URLs" list). Deliberately EXCLUDED:
 *   - the "Command URLs for Debug" (chrome://crash, kill, hang, gpucrash, memory-exhaust, quit, …)
 *     — they crash or hang the renderer on purpose;
 *   - chrome-untrusted:// origins — component/iframe origins, not navigable top-level.
 * When the browser gains/loses a WebUI, re-dump chrome://chrome-urls and reconcile this list. */
(function () {
  'use strict';
  var Z = window.ZGui;

  // ---- label prettifier: slug -> Title Case, with acronym fixups ----------
  var UPPER = { gpu: 'GPU', ukm: 'UKM', gcm: 'GCM', usb: 'USB', ntp: 'NTP', ai: 'AI', url: 'URL', urls: 'URLs', ml: 'ML', dns: 'DNS', webnn: 'WebNN', glic: 'GLIC' };
  function titleize(slug) {
    return slug.replace(/\.top-chrome$/, '')
      .split(/[-_]/).map(function (w) {
        if (UPPER[w]) return UPPER[w];
        if (w === 'webrtc') return 'WebRTC';
        if (w === 'indexeddb') return 'IndexedDB';
        return w.charAt(0).toUpperCase() + w.slice(1);
      }).join(' ');
  }

  // A url entry is "slug" (chrome://slug) or ["slug","Custom Label"] or a full URL.
  var _seq = 0;
  function tile(entry, glyph) {
    var url, label;
    if (Array.isArray(entry)) { url = entry[0]; label = entry[1]; }
    else { url = entry; label = null; }
    var target = /:\/\//.test(url) ? url : ('chrome://' + url);
    var slug = target.replace(/^chrome:\/\//, '');
    return { id: 'd' + (++_seq), target: target, label: label || titleize(slug), desc: target, glyph: glyph || '▸' };
  }
  function section(cat, label, glyph, entries) {
    return { cat: cat, label: label, tiles: entries.map(function (e) { return tile(e, glyph); }) };
  }

  // ---- ZWIRE HUD pages (extension pages, opened as pages/<file>) -----------
  var _z = 0;
  function zt(file, label, desc, glyph) { return { id: 'z' + (++_z), target: file, label: label, desc: desc || '', glyph: glyph || '▸' }; }

  var SECTIONS = [
    {
      cat: 'zwire', label: '// ZWIRE · HUD PAGES', tiles: [
        zt('audio.html',        'Audio',         'Live audio dashboard — parametric EQ, gain, compressor, spectrum + meters.', '♪'),
        zt('hooks.html',        'Hooks',         'stryke lifecycle hooks — run a script on browser events (Monaco + vim/emacs).', '⚡'),
        zt('extensions.html',   'Extensions',    'HUD extension manager — toggle, detail, shortcuts.', '⬡'),
        zt('settings.html',     'Settings',      'zwire HUD settings — colorscheme, CRT/neon, behavior.', '⚙'),
        zt('store.html',        'App Store',     'MenkeTechnologies app catalog — install house apps.', '▦'),
        zt('history.html',      'History',       'Browsing history with fzf fuzzy search.', '◷'),
        zt('bookmarks.html',    'Bookmarks',     'HUD bookmark browser + editor.', '★'),
        zt('notes.html',        'Notes',         'Markdown notes in folders — attach pages, live preview.', '▤'),
        zt('translate.html',    'Translate',     'Translate text between 30+ languages with auto-detect.', '🌐'),
        zt('feeds.html',        'Feeds',         'RSS/Atom feed reader — add feeds, read items inline.', '📡'),
        zt('readinglist.html',  'Reading List',  'Saved pages to read later — mark read, open, remove.', '📑'),
        zt('sessions.html',     'Sessions',      'Named tiling-workspace sessions — CRUD + SVG previews.', '▤'),
        zt('commands.html',     'Commands',      'Custom ⌘K palette commands (url / shell / js / scheme).', '⌘'),
        zt('triggers.html',     'Triggers',      'Regex-on-page-output triggers — run a step chain (shell / stryke / js / …) when page text matches.', '◎'),
        zt('keys.html',         'Keyboard',      'Remap every zwire shortcut + the tmux prefix.', '⌨'),
        zt('extshortcuts.html', 'Ext Shortcuts', 'Extension command shortcuts.', '⎇'),
        zt('ci.html',           'CI',            'Continuous-integration status board.', '◉'),
        zt('host.html',         'Host',          'Native-host bridge status + console.', '⌂'),
        zt('version.html',      'System',        'Build, version, engine + fork patch info.', '◈'),
        zt('terminal.html',     'Terminal',      'Embedded terminal (ztmux pane).', '▮'),
        zt('chrome://downloads','Downloads',     'Native downloads (zpwrchrome owns the segmented manager).', '↓'),
        zt('chrome://newtab',   'New Tab',       'The zwire new-tab HUD.', '✚'),
      ]
    },

    // ---- everyday destinations ------------------------------------------------
    section('browser', '// CHROME · BROWSER', '◆', [
      'settings', 'extensions', 'history', 'downloads', 'bookmarks', 'newtab',
      ['new-tab-page', 'New Tab Page'], 'apps', 'app-settings', 'flags',
      ['password-manager', 'Password Manager'], ['chrome-urls', 'All chrome:// URLs'],
      'version', ['whats-new', "What's New"], 'management', ['certificate-manager', 'Certificate Manager'],
      'print', 'feedback', 'support-tool', 'updater', ['profile-picker', 'Profile Picker'],
    ]),

    // ---- curated chrome://settings sub-pages (not enumerated by chrome-urls) --
    section('settings', '// CHROME · SETTINGS', '⚙', [
      ['settings/appearance', 'Appearance'], ['settings/people', 'You & Google'],
      ['settings/autofill', 'Autofill'], ['settings/payments', 'Payment Methods'],
      ['settings/addresses', 'Addresses'], ['settings/privacy', 'Privacy & Security'],
      ['settings/security', 'Security'], ['settings/clearBrowserData', 'Clear Browsing Data'],
      ['settings/content', 'Site Settings'], ['settings/cookies', 'Cookies'],
      ['settings/searchEngines', 'Search Engines'], ['settings/languages', 'Languages'],
      ['settings/downloads', 'Downloads'], ['settings/accessibility', 'Accessibility'],
      ['settings/system', 'System'], ['settings/reset', 'Reset Settings'],
      ['settings/help', 'About Chrome'],
    ]),

    // ---- flows / dialogs / misc WebUI ----------------------------------------
    section('webui', '// CHROME · WEBUI & DIALOGS', '▤', [
      'access-code-cast', 'actor-overlay', 'batch-upload', 'browser-switch', 'connection-help',
      'connection-monitoring-detected', 'constrained-test', 'contextual-tasks', 'credits',
      'debug-webuis-disabled', 'default-browser-modal', 'drive-picker-host', 'extensions-zero-state',
      'feature-showcase', 'glic', 'glic-experimental-opt-in', 'history-sync-optin', 'internals',
      'intro', 'managed-user-profile-notice', 'personal-context-notice', 'profile-customization',
      'reset-password', 'saved-tab-groups-unsupported', 'search-engine-choice', 'signin-email-confirmation',
      'signin-error', 'signout-confirmation', 'skills', 'sync-confirmation', 'tab-group-home', 'terms',
      'view-cert', 'watermark', 'webui-browser', 'new-tab-page-third-party', 'newtab-footer',
    ]),

    // ---- side panels & top-chrome bubbles ------------------------------------
    section('panels', '// CHROME · SIDE PANELS & TOP-CHROME', '◧', [
      'bookmarks-side-panel.top-chrome', 'comments-side-panel.top-chrome',
      'customize-chrome-side-panel.top-chrome', 'history-clusters-side-panel.top-chrome',
      'history-side-panel.top-chrome', 'omnibox-popup.top-chrome', 'read-later.top-chrome',
      'shopping-insights-side-panel.top-chrome', 'signin-dice-web-intercept.top-chrome',
      'tab-search.top-chrome', 'tabs-from-other-devices.top-chrome', 'webui-toolbar.top-chrome',
    ]),

    // ---- internals & diagnostics (regular list) ------------------------------
    section('internals', '// CHROME · INTERNALS & DIAGNOSTICS', '▣', [
      'accessibility', 'app-service-internals', 'attribution-internals', 'autofill-internals',
      'blob-internals', 'bluetooth-internals', 'components', 'connectors-internals', 'crashes',
      'device-log', 'dino', 'extensions-internals', 'gcm-internals', 'gpu', 'histograms',
      'indexeddb-internals', 'inspect', 'media-engagement', 'media-internals', 'metrics-internals',
      'net-export', 'net-internals', 'ntp-tiles-internals', 'on-device-translation-internals',
      'password-manager-internals', 'policy', 'predictors', 'prefs-internals', 'privacy-sandbox-internals',
      'private-aggregation-internals', 'process-internals', 'profile-internals', 'quota-internals',
      'segmentation-internals', 'serviceworker-internals', 'signin-internals', 'site-engagement',
      'suggest-internals', 'sync-internals', 'system', 'topics-internals', 'traces', 'traces-internals',
      'translate-internals', 'usb-internals', 'web-app-internals', 'webnn-internals', 'webrtc-internals',
    ]),

    // ---- internal debugging pages (chrome-urls' second list) -----------------
    section('debug', '// CHROME · DEBUG INTERNALS', '⛭', [
      'actor-internals', 'autofill-ml-internals', 'chrome-finds-internals', 'color-pipeline-internals',
      'commerce-internals', 'content-annotator-internals', 'context-hub', 'data-sharing-internals',
      'discards', 'download-internals', 'family-link-user-internals', 'history-clusters-internals',
      'indigo-internals', 'infobar-internals', 'interstitials', 'local-state', 'location-internals',
      'media-router-internals', 'memory-internals', 'multistep-filter-internals', 'network-errors',
      'omnibox', 'on-device-internals', 'optimization-guide-internals', 'personal-context-internals',
      'private-ai-internals', 'regional-capabilities-internals', 'safe-browsing',
      'subresource-filter-internals', 'tab-strip-internals', 'tracing', 'ukm',
      'unexportable-keys-internals', 'user-actions', 'user-education-internals', 'webrtc-logs',
      'webui-gallery',
    ]),
  ];

  function isExternal(target) {
    return /^(chrome|chrome-extension|https?|about|view-source|edge|file):/i.test(target) || target.indexOf('://') >= 0;
  }
  function open(target) {
    if (!target) return;
    var url = isExternal(target) ? target : chrome.runtime.getURL('pages/' + target);
    try { chrome.tabs.create({ url: url }); }
    catch (e) { try { location.href = url; } catch (x) {} }
  }

  var shell = window.ZBHUD.mount({
    title: 'DASHBOARD', current: 'dashboard.html',
    filterPlaceholder: '>_ filter tiles… pages · chrome:// internals',
    // ZGui.tiles filters by substring only; to honor the shell's regex toggle we
    // filter the sections ourselves with ZBHUD.matcher and re-render the grid.
    onFilter: function (v, rx) { renderTiles(window.ZBHUD.matcher(v, rx)); }
  });

  function renderTiles(m) {
    var secs = SECTIONS.map(function (s) {
      return { cat: s.cat, label: s.label, tiles: s.tiles.filter(function (t) { return m(t.label + ' ' + (t.desc || '') + ' ' + t.target); }) };
    }).filter(function (s) { return s.tiles.length; });
    Z.tiles.render(shell.body, secs, {
      search: false,               // the shell header already provides the filter
      dragPrefix: 'zbDashOrder',
      onActivate: function (id, t) { if (t && t.target) open(t.target); }
    });
  }

  renderTiles(function () { return true; });
})();
