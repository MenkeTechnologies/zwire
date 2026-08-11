/* zwire — new-tab LAYOUTS: the pure engine. A port of Vivaldi's Start Page model
 * (Speed Dial groups + the widget Dashboard) onto the zwire new tab.
 *
 * A LAYOUT is a complete, named new-tab design. One is active; the rest sit in the
 * library, switchable from the ⌘K palette or the HUD page. Each layout owns:
 *
 *     nav   — the start-page navigation rail: where it sits, when it shows
 *     bg    — the page background (none / color / gradient / uploaded image)
 *     dial  — Speed Dial appearance, Vivaldi's Settings > Start Page > Speed Dial:
 *             maximum columns, thumbnail size, when titles show, the add button,
 *             drag-to-reorder
 *     pages — the Speed Dial GROUPS (Vivaldi's start-page tabs). Each group holds
 *             its own dials AND its own widget grid, so "work" and "home" can be
 *             entirely different surfaces inside one layout.
 *
 * THIS FILE IS PURE: no DOM, no chrome.*, no timers, no side effects beyond hanging
 * the API off a `window`-like global. Every decision the new tab makes — what a
 * normalized config looks like, what a widget may be configured with, whether a URL
 * is safe to load into a dial or an iframe, how columns resolve, what an import is
 * allowed to contain — is computed here so it can be unit-tested headlessly and
 * shared verbatim by the new tab (rendering) and the HUD (editing).
 *
 * Consumers: newtab/newtab.js + newtab/widgets.js + newtab/layout-edit.js (render +
 * inline editor), pages/newtab.js (the HUD layout manager), tests/ntp-layout.mjs.
 * Storage key: chrome.storage.local 'zb_ntp'.
 *
 * NOTE: this file is duplicated verbatim into newtab/ (like schemes.js and
 * palette-cmds.js). Edit the hud-internal copy; keep newtab/zntp-core.js identical. */
(function (root) {
  'use strict';

  var SCHEMA = 1;

  /* ------------------------------------------------------------------ widgets */
  /* The catalog. `single` ports Vivaldi's add-once widgets (Date, Tip of the Day);
   * everything else can be added repeatedly with a different config per instance
   * (a bookmarks widget per folder, a webpage widget per site). `sizes` ports the
   * widget menu's "Widget Size → Regular | Tall" — only the widgets whose content
   * is a list get the tall option, exactly as Vivaldi restricts it. */
  var WIDGETS = [
    { type: 'speeddial',   label: 'Speed Dial',   glyph: '▦', single: true,  sizes: false, cfg: [] },
    { type: 'search',      label: 'Search',       glyph: '⌕', single: true,  sizes: false, cfg: [] },
    { type: 'clock',       label: 'Date',         glyph: '◷', single: true,  sizes: false, cfg: [] },
    { type: 'topsites',    label: 'Top Sites',    glyph: '★', single: true,  sizes: true,  cfg: ['count'] },
    { type: 'bookmarks',   label: 'Bookmarks',    glyph: '❏', single: false, sizes: true,  cfg: ['folderId', 'folderName', 'count'] },
    { type: 'history',     label: 'History',      glyph: '⟲', single: false, sizes: true,  cfg: ['count'] },
    { type: 'feeds',       label: 'Feeds',        glyph: '📡', single: false, sizes: true,  cfg: ['feedUrl', 'count'] },
    { type: 'notes',       label: 'Notes',        glyph: '▤', single: false, sizes: true,  cfg: ['folderId', 'count'] },
    { type: 'readinglist', label: 'Reading List', glyph: '📑', single: false, sizes: true,  cfg: ['count'] },
    { type: 'sessions',    label: 'Sessions',     glyph: '⧉', single: false, sizes: true,  cfg: ['count'] },
    { type: 'webpage',     label: 'Webpage',      glyph: '▣', single: false, sizes: true,  cfg: ['url'] }
  ];
  var WIDGET_BY_TYPE = {};
  WIDGETS.forEach(function (w) { WIDGET_BY_TYPE[w.type] = w; });

  var NAV_POS = ['top', 'bottom', 'left', 'right'];
  var NAV_SHOW = ['always', 'start', 'hidden'];      // Vivaldi: internal+start / start only / hide
  var TITLES = ['always', 'auto', 'never'];          // Vivaldi: always / when needed / never
  var BG_KINDS = ['none', 'color', 'gradient', 'image'];
  var SIZES = ['regular', 'tall'];
  var MAX_COLUMNS = 12;                              // 0 == unlimited (Vivaldi's "No limit")
  var MAX_THUMB = 5;                                 // Vivaldi ships 5 thumbnail sizes
  var MAX_SPAN = 4;                                  // grid columns a widget may cover
  var MAX_COUNT = 50;                                // rows a list widget may render

  /* ----------------------------------------------------------------- helpers */
  var seq = 0;
  function uid(p) { return (p || 'x') + Date.now().toString(36) + (++seq).toString(36); }
  function str(v, d) { return typeof v === 'string' ? v : (d || ''); }
  function bool(v, d) { return typeof v === 'boolean' ? v : !!d; }
  function oneOf(v, list, d) { return list.indexOf(v) >= 0 ? v : d; }
  function clamp(v, lo, hi, d) {
    var n = typeof v === 'number' ? v : parseInt(v, 10);
    if (!isFinite(n)) return d;
    return Math.max(lo, Math.min(hi, Math.round(n)));
  }
  function arr(v) { return Array.isArray(v) ? v : []; }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  /* A dial/widget URL is loaded by navigation or dropped into an iframe, so the
   * scheme is a security boundary, not a formatting detail: `javascript:` would run
   * in the new tab's own extension origin and `data:`/`blob:` would smuggle markup
   * past the same check. Everything else gets https:// when a scheme is missing,
   * matching the omnibox heuristic. Returns '' when nothing safe can be made. */
  var SAFE_SCHEME = /^(https?|ftp|chrome|chrome-extension|file):/i;
  function safeUrl(s) {
    var v = str(s).trim();
    if (!v) return '';
    if (/^[a-z][a-z0-9+.-]*:/i.test(v)) return SAFE_SCHEME.test(v) ? v : '';
    if (/^\/\//.test(v)) return 'https:' + v;
    return 'https://' + v;
  }
  /* A background image is an uploaded data: URL (there is no network fetch — the
   * new tab must paint offline and under the extension CSP), so it takes the
   * opposite rule from safeUrl: image data only, nothing executable. */
  function safeImage(s) {
    var v = str(s).trim();
    return /^data:image\/(png|jpeg|gif|webp|avif|svg\+xml);base64,[a-z0-9+/=\s]+$/i.test(v) ? v : '';
  }
  function labelFor(url, label) {
    var l = str(label).trim();
    if (l) return l;
    var m = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)/i.exec(str(url));
    return m ? m[1].replace(/^www\./, '') : str(url);
  }

  /* ------------------------------------------------------------- normalization */
  /* normalize() is the ONLY gate between stored/imported JSON and the renderer: it
   * clamps every number, enum-checks every string, drops unknown widget types, and
   * re-issues duplicate ids (a duplicated layout that kept its page ids would make
   * "switch page" ambiguous). Anything that survives is renderable. */
  function normDial(d, seen) {
    var url = safeUrl(d && d.url);
    if (!url) return null;
    var id = str(d && d.id) || uid('d');
    if (seen[id]) id = uid('d');
    seen[id] = 1;
    return { id: id, url: url, label: labelFor(url, d && d.label), thumb: safeImage(d && d.thumb) };
  }

  function normWidgetCfg(type, cfg) {
    var spec = WIDGET_BY_TYPE[type];
    var src = (cfg && typeof cfg === 'object') ? cfg : {};
    var out = {};
    (spec ? spec.cfg : []).forEach(function (k) {
      if (k === 'count') out.count = clamp(src.count, 1, MAX_COUNT, 8);
      else if (k === 'url') out.url = safeUrl(src.url);
      else if (k === 'feedUrl') out.feedUrl = safeUrl(src.feedUrl);
      else out[k] = str(src[k]);
    });
    return out;
  }

  function normWidget(w, seen) {
    var type = str(w && w.type);
    var spec = WIDGET_BY_TYPE[type];
    if (!spec) return null;                                   // unknown type from a newer build
    var id = str(w && w.id) || uid('w');
    if (seen[id]) id = uid('w');
    seen[id] = 1;
    return {
      id: id,
      type: type,
      size: spec.sizes ? oneOf(w && w.size, SIZES, 'regular') : 'regular',
      span: clamp(w && w.span, 1, MAX_SPAN, 1),
      cfg: normWidgetCfg(type, w && w.cfg)
    };
  }

  function normPage(p, seen) {
    var id = str(p && p.id) || uid('p');
    if (seen[id]) id = uid('p');
    seen[id] = 1;
    var dialSeen = {}, widgetSeen = {}, single = {};
    var widgets = arr(p && p.widgets).map(function (w) { return normWidget(w, widgetSeen); }).filter(Boolean)
      .filter(function (w) {                                  // enforce the add-once widgets
        var spec = WIDGET_BY_TYPE[w.type];
        if (!spec.single) return true;
        if (single[w.type]) return false;
        single[w.type] = 1;
        return true;
      });
    return {
      id: id,
      name: str(p && p.name) || 'Speed Dial',
      dials: arr(p && p.dials).map(function (d) { return normDial(d, dialSeen); }).filter(Boolean),
      widgets: widgets
    };
  }

  function normLayout(l, seen) {
    var id = str(l && l.id) || uid('l');
    if (seen[id]) id = uid('l');
    seen[id] = 1;
    var pageSeen = {};
    var pages = arr(l && l.pages).map(function (p) { return normPage(p, pageSeen); });
    if (!pages.length) pages = [normPage({ name: 'Speed Dial' }, pageSeen)];
    var nav = (l && l.nav) || {};
    var bg = (l && l.bg) || {};
    var dial = (l && l.dial) || {};
    var bgKind = oneOf(bg.kind, BG_KINDS, 'none');
    var bgValue = bgKind === 'image' ? safeImage(bg.value) : str(bg.value);
    if (bgKind === 'image' && !bgValue) bgKind = 'none';      // rejected payload must not leave a blank image
    var active = str(l && l.activePageId);
    return {
      id: id,
      name: str(l && l.name) || 'Layout',
      created: clamp(l && l.created, 0, 8.64e15, 0),
      updated: clamp(l && l.updated, 0, 8.64e15, 0),
      nav: { pos: oneOf(nav.pos, NAV_POS, 'top'), show: oneOf(nav.show, NAV_SHOW, 'start') },
      bg: { kind: bgKind, value: bgValue },
      dial: {
        columns: clamp(dial.columns, 0, MAX_COLUMNS, 6),
        thumb: clamp(dial.thumb, 1, MAX_THUMB, 3),
        titles: oneOf(dial.titles, TITLES, 'always'),
        showAdd: bool(dial.showAdd, true),
        dragReorder: bool(dial.dragReorder, true)
      },
      pages: pages,
      activePageId: pages.some(function (p) { return p.id === active; }) ? active : pages[0].id
    };
  }

  function normalize(cfg) {
    var seen = {};
    var layouts = arr(cfg && cfg.layouts).map(function (l) { return normLayout(l, seen); });
    if (!layouts.length) layouts = [normLayout(defaultLayout(), seen)];
    var active = str(cfg && cfg.activeId);
    return {
      v: SCHEMA,
      activeId: layouts.some(function (l) { return l.id === active; }) ? active : layouts[0].id,
      layouts: layouts
    };
  }

  /* ---------------------------------------------------------------- defaults */
  var DEFAULT_DIALS = [
    { label: 'GitHub', url: 'https://github.com' },
    { label: 'Search', url: 'https://duckduckgo.com' },
    { label: 'MDN', url: 'https://developer.mozilla.org' },
    { label: 'crates', url: 'https://crates.io' },
    { label: 'Hacker', url: 'https://news.ycombinator.com' },
    { label: 'Docs', url: 'https://menketechnologies.github.io' }
  ];

  function defaultLayout(name) {
    return {
      name: name || 'Default',
      nav: { pos: 'top', show: 'start' },
      bg: { kind: 'none', value: '' },
      dial: { columns: 6, thumb: 3, titles: 'always', showAdd: true, dragReorder: true },
      pages: [{
        name: 'Speed Dial',
        dials: DEFAULT_DIALS.slice(),
        widgets: [
          { type: 'clock', span: 4 },
          { type: 'search', span: 4 },
          { type: 'speeddial', span: 4 },
          { type: 'topsites', span: 2, cfg: { count: 8 } },
          { type: 'history', span: 2, cfg: { count: 8 } }
        ]
      }]
    };
  }

  function defaultConfig() { return normalize({ layouts: [defaultLayout()] }); }

  /* The pre-layouts new tab kept its quick-launch tiles in localStorage 'zb.tiles'
   * ([{label,url}]). Migration COPIES them into the default layout's first page;
   * the legacy key is never written or cleared, so rolling the feature back leaves
   * the old page exactly as it was. ('zb.engine' is unrelated to layout — the
   * omnibox still reads it directly.) */
  function migrate(legacyTiles) {
    var cfg = defaultConfig();
    var seen = {};
    var dials = arr(legacyTiles).map(function (t) { return normDial(t, seen); }).filter(Boolean);
    if (dials.length) cfg.layouts[0].pages[0].dials = dials;
    return cfg;
  }

  /* ---------------------------------------------------------------- accessors */
  function activeLayout(cfg) {
    var c = cfg || {};
    return arr(c.layouts).filter(function (l) { return l.id === c.activeId; })[0] || arr(c.layouts)[0] || null;
  }
  function layoutById(cfg, id) {
    return arr(cfg && cfg.layouts).filter(function (l) { return l.id === id; })[0] || null;
  }
  function activePage(layout) {
    var l = layout || {};
    return arr(l.pages).filter(function (p) { return p.id === l.activePageId; })[0] || arr(l.pages)[0] || null;
  }
  function pageById(layout, id) {
    return arr(layout && layout.pages).filter(function (p) { return p.id === id; })[0] || null;
  }

  /* ------------------------------------------------------------------- edits */
  /* Every edit takes a config and returns a NEW one (the caller's copy is never
   * mutated), so the inline editor can diff, undo, and persist without aliasing. */
  function withLayout(cfg, layoutId, fn) {
    var next = normalize(cfg);
    var l = layoutById(next, layoutId) || activeLayout(next);
    if (!l) return next;
    fn(l, next);
    l.updated = Date.now();
    return normalize(next);
  }
  function withPage(cfg, layoutId, pageId, fn) {
    return withLayout(cfg, layoutId, function (l, next) {
      var p = pageById(l, pageId) || activePage(l);
      if (p) fn(p, l, next);
    });
  }

  function createLayout(cfg, name) {
    var next = normalize(cfg);
    var made = normLayout(defaultLayout(name || 'Layout ' + (next.layouts.length + 1)), {});
    made.created = made.updated = Date.now();
    next.layouts.push(made);
    next.activeId = made.id;
    return normalize(next);
  }
  function duplicateLayout(cfg, layoutId, name) {
    var next = normalize(cfg);
    var src = layoutById(next, layoutId);
    if (!src) return next;
    var copy = clone(src);
    // Strip every id so normalize() re-issues them — a copy that kept the source's
    // page ids would make "switch to page X" resolve to the wrong layout's page.
    copy.id = ''; copy.activePageId = '';
    copy.name = str(name) || (src.name + ' copy');
    copy.created = copy.updated = Date.now();
    (copy.pages || []).forEach(function (p) {
      p.id = '';
      (p.dials || []).forEach(function (d) { d.id = ''; });
      (p.widgets || []).forEach(function (w) { w.id = ''; });
    });
    next.layouts.push(copy);
    return normalize(next);
  }
  function renameLayout(cfg, layoutId, name) {
    return withLayout(cfg, layoutId, function (l) { l.name = str(name) || l.name; });
  }
  function removeLayout(cfg, layoutId) {
    var next = normalize(cfg);
    if (next.layouts.length <= 1) return next;                // the library is never empty
    next.layouts = next.layouts.filter(function (l) { return l.id !== layoutId; });
    return normalize(next);
  }
  function setActiveLayout(cfg, layoutId) {
    var next = normalize(cfg);
    if (layoutById(next, layoutId)) next.activeId = layoutId;
    return next;
  }
  function setLayoutPrefs(cfg, layoutId, patch) {
    return withLayout(cfg, layoutId, function (l) {
      var p = patch || {};
      if (p.nav) l.nav = { pos: p.nav.pos != null ? p.nav.pos : l.nav.pos, show: p.nav.show != null ? p.nav.show : l.nav.show };
      if (p.bg) l.bg = { kind: p.bg.kind != null ? p.bg.kind : l.bg.kind, value: p.bg.value != null ? p.bg.value : l.bg.value };
      if (p.dial) { for (var k in p.dial) { if (l.dial[k] !== undefined) l.dial[k] = p.dial[k]; } }
    });
  }

  function addPage(cfg, layoutId, name) {
    return withLayout(cfg, layoutId, function (l) {
      var p = normPage({ name: name || 'Group ' + (l.pages.length + 1) }, {});
      l.pages.push(p);
      l.activePageId = p.id;
    });
  }
  function removePage(cfg, layoutId, pageId) {
    return withLayout(cfg, layoutId, function (l) {
      if (l.pages.length <= 1) return;                        // a layout always has one group
      l.pages = l.pages.filter(function (p) { return p.id !== pageId; });
      if (l.activePageId === pageId) l.activePageId = l.pages[0].id;
    });
  }
  function renamePage(cfg, layoutId, pageId, name) {
    return withPage(cfg, layoutId, pageId, function (p) { p.name = str(name) || p.name; });
  }
  function setActivePage(cfg, layoutId, pageId) {
    return withLayout(cfg, layoutId, function (l) { if (pageById(l, pageId)) l.activePageId = pageId; });
  }

  function addDial(cfg, layoutId, pageId, dial) {
    return withPage(cfg, layoutId, pageId, function (p) {
      var d = normDial(dial, {});
      if (d) p.dials.push(d);
    });
  }
  function updateDial(cfg, layoutId, pageId, dialId, patch) {
    return withPage(cfg, layoutId, pageId, function (p) {
      p.dials = p.dials.map(function (d) {
        if (d.id !== dialId) return d;
        var merged = { id: d.id, url: patch && patch.url != null ? patch.url : d.url,
          label: patch && patch.label != null ? patch.label : d.label,
          thumb: patch && patch.thumb != null ? patch.thumb : d.thumb };
        return normDial(merged, {}) || d;
      });
    });
  }
  function removeDial(cfg, layoutId, pageId, dialId) {
    return withPage(cfg, layoutId, pageId, function (p) {
      p.dials = p.dials.filter(function (d) { return d.id !== dialId; });
    });
  }

  function addWidget(cfg, layoutId, pageId, type, widgetCfg) {
    return withPage(cfg, layoutId, pageId, function (p) {
      var spec = WIDGET_BY_TYPE[str(type)];
      if (!spec) return;
      if (spec.single && p.widgets.some(function (w) { return w.type === type; })) return;
      var w = normWidget({ type: type, cfg: widgetCfg, span: type === 'webpage' ? 2 : 1 }, {});
      if (w) p.widgets.push(w);
    });
  }
  function updateWidget(cfg, layoutId, pageId, widgetId, patch) {
    return withPage(cfg, layoutId, pageId, function (p) {
      p.widgets = p.widgets.map(function (w) {
        if (w.id !== widgetId) return w;
        var q = patch || {};
        return normWidget({
          id: w.id, type: w.type,
          size: q.size != null ? q.size : w.size,
          span: q.span != null ? q.span : w.span,
          cfg: q.cfg != null ? q.cfg : w.cfg
        }, {}) || w;
      });
    });
  }
  function removeWidget(cfg, layoutId, pageId, widgetId) {
    return withPage(cfg, layoutId, pageId, function (p) {
      p.widgets = p.widgets.filter(function (w) { return w.id !== widgetId; });
    });
  }

  /* Reorder within a list, used by every drag surface (dials, widgets, groups,
   * layouts). Out-of-range indices are a no-op, not a splice at the wrong end. */
  function reorder(list, from, to) {
    var out = arr(list).slice();
    if (from < 0 || from >= out.length || to < 0 || to >= out.length || from === to) return out;
    out.splice(to, 0, out.splice(from, 1)[0]);
    return out;
  }
  function moveDial(cfg, layoutId, pageId, from, to) {
    return withPage(cfg, layoutId, pageId, function (p) { p.dials = reorder(p.dials, from, to); });
  }
  function moveWidget(cfg, layoutId, pageId, from, to) {
    return withPage(cfg, layoutId, pageId, function (p) { p.widgets = reorder(p.widgets, from, to); });
  }
  function movePage(cfg, layoutId, from, to) {
    return withLayout(cfg, layoutId, function (l) { l.pages = reorder(l.pages, from, to); });
  }
  /* A drag surface reports its result as the final DOM order, not a from/to pair
   * (a drop can cross containers, and the DOM is the only place that knows where
   * the item landed). orderBy() replays that order onto the model: ids it doesn't
   * recognise are ignored, and items the caller didn't mention keep their relative
   * order at the end, so a stale id list can never delete anything. */
  function orderBy(list, ids) {
    var rank = {};
    arr(ids).forEach(function (id, i) { rank[id] = i; });
    var known = arr(list).filter(function (x) { return rank[x.id] !== undefined; })
      .sort(function (a, b) { return rank[a.id] - rank[b.id]; });
    var rest = arr(list).filter(function (x) { return rank[x.id] === undefined; });
    return known.concat(rest);
  }
  function orderDials(cfg, layoutId, pageId, ids) {
    return withPage(cfg, layoutId, pageId, function (p) { p.dials = orderBy(p.dials, ids); });
  }
  function orderWidgets(cfg, layoutId, pageId, ids) {
    return withPage(cfg, layoutId, pageId, function (p) { p.widgets = orderBy(p.widgets, ids); });
  }
  function orderPages(cfg, layoutId, ids) {
    return withLayout(cfg, layoutId, function (l) { l.pages = orderBy(l.pages, ids); });
  }

  /* Move a dial to ANOTHER group — the drop target of a drag onto the nav rail. */
  function moveDialToPage(cfg, layoutId, fromPageId, dialId, toPageId) {
    return withLayout(cfg, layoutId, function (l) {
      var from = pageById(l, fromPageId), to = pageById(l, toPageId);
      if (!from || !to || from === to) return;
      var d = from.dials.filter(function (x) { return x.id === dialId; })[0];
      if (!d) return;
      from.dials = from.dials.filter(function (x) { return x.id !== dialId; });
      to.dials.push(d);
    });
  }

  /* -------------------------------------------------------------- geometry */
  /* Vivaldi's "Maximum Columns": a number, or "No limit" (0 here) which fits as many
   * dials per row as the viewport allows. Resolving it needs the dial count so a
   * 3-dial page on a 6-column setting doesn't stretch 3 dials across the page.
   *
   * When the dials don't divide evenly the rows are BALANCED rather than packed:
   * seven tiles under a six-column cap lay out 4+3, not 6+1. Packing left a single
   * stranded tile — usually the add button — sitting alone under a full row, which
   * is what made the page look broken. The cap is still a maximum: balancing only
   * ever returns fewer columns, never more, and it never adds a row. */
  function dialColumns(layout, dialCount) {
    var max = (layout && layout.dial && layout.dial.columns) || 0;
    var n = Math.max(1, dialCount || 1);
    if (!max || max >= n) return n;
    return Math.ceil(n / Math.ceil(n / max));
  }

  /* The cap is only half of what decides a row: the window decides the rest. Under
   * "No limit" (or any cap wider than the viewport) the tiles wrap wherever they run
   * out of room, which strands a tile again — the balancing above never sees it,
   * because nothing in the model knows how wide the page is. dialFit() takes the
   * measured space and balances against whatever actually fits, so the arrangement
   * is even at every window size. Pure: the caller measures, this decides. */
  function dialFit(availablePx, sizePx, gapPx, dialCount, cap) {
    var size = Math.max(1, sizePx || 1);
    var gap = Math.max(0, gapPx || 0);
    var n = Math.max(1, dialCount || 1);
    var fits = Math.max(1, Math.floor(((availablePx || 0) + gap) / (size + gap)));
    if (cap) fits = Math.min(fits, cap);
    if (fits >= n) return n;
    return Math.ceil(n / Math.ceil(n / fits));
  }
  var THUMB_PX = [96, 128, 160, 200, 248];                    // the 5 Vivaldi thumbnail sizes
  function dialSizePx(layout) {
    return THUMB_PX[clamp(layout && layout.dial && layout.dial.thumb, 1, MAX_THUMB, 3) - 1];
  }
  /* How wide the favicon paints inside a dial. Owned here rather than in CSS because
   * the favicon request has to ask Chrome for exactly this many device pixels — a
   * percentage in the stylesheet would leave the JS guessing at the paint size and the
   * icon would come back at the wrong resolution.
   *
   * The cap is the size of the data, not a style choice: Chrome's favicon store only
   * ever holds 16px and 32px bitmaps (verified against a real profile's Favicons DB —
   * 736 rows, no other width, SVG sources included), so anything wider than FAV_MAX_PX
   * is Chrome upscaling a 32px image. A small sharp icon beats a big soft one. */
  var FAV_MAX_PX = 32;
  function dialFavPx(sizePx) {
    return Math.min(Math.round((sizePx || 0) * 0.52), FAV_MAX_PX);
  }
  /* Titles: 'always' shows, 'never' hides, 'auto' is Vivaldi's "when needed" — the
   * title is redundant next to a custom thumbnail, so it only shows without one. */
  function showTitle(layout, dial) {
    var mode = (layout && layout.dial && layout.dial.titles) || 'always';
    if (mode === 'always') return true;
    if (mode === 'never') return false;
    return !(dial && dial.thumb);
  }

  /* Where the widget grid actually puts each widget. The page uses CSS grid, so the
   * HUD's layout preview would drift from reality if it guessed; this reproduces CSS
   * grid's sparse auto-placement — row-major, the cursor never moves backwards, a
   * widget wider than the row's remainder wraps, and a Tall widget occupies two rows
   * that later widgets must flow around. Returns cells in grid units. */
  function gridPlace(widgets, columns) {
    var cols = clamp(columns, 1, MAX_SPAN, MAX_SPAN);
    var taken = {}, out = [], row = 0, col = 0;
    function free(r, c, w, h) {
      for (var i = 0; i < h; i++) {
        for (var j = 0; j < w; j++) { if (taken[(r + i) + ':' + (c + j)]) return false; }
      }
      return true;
    }
    arr(widgets).forEach(function (wd) {
      var w = Math.min(clamp(wd.span, 1, MAX_SPAN, 1), cols);
      var h = wd.size === 'tall' ? 2 : 1;
      var r = row, c = col;
      while (true) {
        if (c + w > cols) { c = 0; r++; continue; }
        if (free(r, c, w, h)) break;
        c++;
      }
      for (var i = 0; i < h; i++) {
        for (var j = 0; j < w; j++) { taken[(r + i) + ':' + (c + j)] = 1; }
      }
      out.push({ id: wd.id, type: wd.type, x: c, y: r, w: w, h: h });
      row = r; col = c + w;
    });
    return out;
  }
  function gridRows(cells) {
    return arr(cells).reduce(function (n, c) { return Math.max(n, c.y + c.h); }, 0);
  }

  /* ------------------------------------------------------------ import/export */
  function exportJSON(cfg) { return JSON.stringify(normalize(cfg), null, 2); }
  /* Import is the widest attack surface here — it is arbitrary JSON pasted from
   * anywhere — so it goes through the same normalize() the renderer trusts, and
   * throws (rather than half-applying) on anything that isn't a config object. */
  function importJSON(text) {
    var raw;
    try { raw = JSON.parse(String(text)); } catch (e) { throw new Error('not valid JSON'); }
    if (!raw || typeof raw !== 'object') throw new Error('not a layout config');
    if (Array.isArray(raw)) raw = { layouts: raw };
    if (!Array.isArray(raw.layouts) || !raw.layouts.length) throw new Error('no layouts in payload');
    return normalize(raw);
  }
  /* Import layouts INTO an existing library rather than replacing it. */
  function mergeImport(cfg, text) {
    var incoming = importJSON(text);
    var next = normalize(cfg);
    incoming.layouts.forEach(function (l) { l.id = ''; next.layouts.push(l); });
    return normalize(next);
  }

  var API = {
    SCHEMA: SCHEMA,
    WIDGETS: WIDGETS,
    WIDGET_BY_TYPE: WIDGET_BY_TYPE,
    NAV_POS: NAV_POS,
    NAV_SHOW: NAV_SHOW,
    TITLES: TITLES,
    BG_KINDS: BG_KINDS,
    SIZES: SIZES,
    MAX_COLUMNS: MAX_COLUMNS,
    MAX_THUMB: MAX_THUMB,
    MAX_SPAN: MAX_SPAN,
    THUMB_PX: THUMB_PX,
    uid: uid,
    safeUrl: safeUrl,
    safeImage: safeImage,
    labelFor: labelFor,
    normalize: normalize,
    defaultLayout: defaultLayout,
    defaultConfig: defaultConfig,
    migrate: migrate,
    activeLayout: activeLayout,
    layoutById: layoutById,
    activePage: activePage,
    pageById: pageById,
    createLayout: createLayout,
    duplicateLayout: duplicateLayout,
    renameLayout: renameLayout,
    removeLayout: removeLayout,
    setActiveLayout: setActiveLayout,
    setLayoutPrefs: setLayoutPrefs,
    addPage: addPage,
    removePage: removePage,
    renamePage: renamePage,
    setActivePage: setActivePage,
    addDial: addDial,
    updateDial: updateDial,
    removeDial: removeDial,
    moveDial: moveDial,
    moveDialToPage: moveDialToPage,
    addWidget: addWidget,
    updateWidget: updateWidget,
    removeWidget: removeWidget,
    moveWidget: moveWidget,
    movePage: movePage,
    reorder: reorder,
    orderBy: orderBy,
    orderDials: orderDials,
    orderWidgets: orderWidgets,
    orderPages: orderPages,
    dialColumns: dialColumns,
    dialFit: dialFit,
    dialSizePx: dialSizePx,
    dialFavPx: dialFavPx,
    FAV_MAX_PX: FAV_MAX_PX,
    gridPlace: gridPlace,
    gridRows: gridRows,
    showTitle: showTitle,
    exportJSON: exportJSON,
    importJSON: importJSON,
    mergeImport: mergeImport
  };

  try { root.ZWIRE_NTP = API; } catch (e) {}
  try { if (typeof module !== 'undefined' && module.exports) module.exports = API; } catch (e) {}
})(typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : this));
