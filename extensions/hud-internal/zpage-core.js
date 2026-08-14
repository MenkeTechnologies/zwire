/* zwire HUD — the rendered page as typed state: the pure projection engine.
 *
 * The suite bus can now ASK the browser what it is rendering (zwire-host `page.rs`): another
 * running app sends `{"t":"get","state":"page.tables"}`, the host publishes the query to this
 * extension's service worker, and the worker injects THIS file into the target tab to answer.
 *
 * A projection is a typed view of the live DOM — after the login, after the JavaScript, in the
 * session the user is actually in:
 *
 *     page.url · page.title · page.text · page.links · page.headings
 *     page.tables · page.forms · page.meta · page.selection
 *
 * plus `page.extract`, the escape hatch: any selector, optionally one attribute.
 *
 * THIS FILE IS PURE. It reads a `document` and returns JSON; it never touches chrome.*, never
 * writes to the page, and has no state. That is what lets background.js inject it into an arbitrary
 * tab, lets tests/pagestate.mjs run every projection headless against a hand-rolled DOM, and lets
 * the worker itself load it (importScripts) for the two decisions it makes BEFORE injecting
 * anything: is this origin allowed, and which tab is being asked about.
 *
 * TWO RULES THIS FILE ENFORCES, because nothing downstream can:
 *
 *  1. NO WRITES. There is no projection that changes the page. Page mutation already exists as
 *     `browser.*` verbs with a compensation journal behind them; a second write path through here
 *     would be a way to change the browser that `txn_abort` cannot unwind.
 *  2. NO FIELD VALUES. `page.forms` reports a form's SHAPE — action, method, field names and types —
 *     and never what is typed into them. Autofilled credentials and a half-finished payment form
 *     are on the page too, and a read surface that hands them to any process on the bus is not a
 *     trade a browser gets to make for its user.
 *
 * Consumers: background.js (worker: PROJECTIONS + originAllowed + planTargets; tab: project),
 * tests/pagestate.mjs. The projection ids are pinned against the host's catalogue
 * (native/zwire-host/src/page.rs `STATES`) by that test — one catalogue, two languages. */
(function (root) {
  'use strict';

  /* ------------------------------------------------------------------ caps */
  // A projection crosses a native-messaging pipe and lands in another process's JSON parser, so
  // every list and every string is bounded here rather than at the far end. A page with 40k links
  // (a sitemap, an infinite scroller) must not be able to stall the bus or the app that asked.
  var MAX_ITEMS = 500;      // entries per list projection
  var MAX_TEXT = 200000;    // characters of page text
  var MAX_CELL = 2000;      // characters per link label / table cell / field name
  var MAX_ROWS = 200;       // rows per table
  var MAX_TABLES = 25;

  // The catalogue, in the host's order. `label` is what a picker shows.
  var PROJECTIONS = [
    { id: 'page.url', label: 'Address of the rendered page' },
    { id: 'page.title', label: 'Document title' },
    { id: 'page.text', label: 'Rendered text of the page body' },
    { id: 'page.links', label: 'Every link: text + resolved href' },
    { id: 'page.headings', label: 'Heading outline: level + text' },
    { id: 'page.tables', label: 'Every table as rows of cells' },
    { id: 'page.forms', label: 'Form shape: action, method, field names + types — never values' },
    { id: 'page.meta', label: 'Document metadata: description, canonical, og:*, JSON-LD' },
    { id: 'page.selection', label: "The user's current selection" }
  ];
  var EXTRACT = 'page.extract';
  // Several projections in ONE call. Not a projection itself — a container for them — so
  // `isProjection` deliberately says no and the batch path is entered by name.
  var BATCH = 'page.batch';
  // Ceiling on one batch, mirrored by the host (`page.rs` MAX_BATCH) so an oversized set is refused
  // before it ever reaches a renderer. Bounds the synchronous work one injection can ask a tab to do.
  var MAX_BATCH = 32;

  function str(v) { return v == null ? '' : String(v); }
  function trim(s) { return str(s).replace(/^\s+|\s+$/g, ''); }
  // Rendered text arrives with the source's indentation in it; collapse runs of whitespace so a
  // `contains` postcondition matches what the user SEES rather than how the markup was formatted.
  function tidy(s, cap) { return trim(str(s).replace(/\s+/g, ' ')).slice(0, cap || MAX_CELL); }
  function isProjection(id) {
    for (var i = 0; i < PROJECTIONS.length; i++) if (PROJECTIONS[i].id === id) return true;
    return id === EXTRACT;
  }

  /* ---------------------------------------------------------- origin gate */
  // Schemes that never carry a user's page: extension pages, devtools, data/blob URLs, the browser's
  // own internals. Injection would fail on most of them anyway — refusing by NAME gives the caller
  // "that origin is not readable" instead of an opaque scripting error.
  var SCHEME_OK = /^(https?|file):/i;

  /* Decide whether a url may be projected at all.
   *
   * `deny` is the user's list of patterns (chrome.storage 'zb_page_deny'), each a regex source
   * string matched against the whole url. It is empty by default — the bus socket is already
   * owner-only — and it exists so a banking or health origin can be excluded from a surface that
   * every app on the machine can read. An invalid pattern DENIES: a deny rule that silently stops
   * applying because of a typo is worse than one that over-blocks and gets noticed. */
  function originAllowed(url, deny) {
    var u = trim(url);
    if (!u) return { ok: false, reason: 'no url' };
    if (!SCHEME_OK.test(u)) return { ok: false, reason: 'not a readable origin: ' + u.split(':')[0] + ':' };
    var list = deny || [];
    for (var i = 0; i < list.length; i++) {
      var p = trim(list[i]);
      if (!p) continue;
      var re;
      try { re = new RegExp(p, 'i'); } catch (e) { return { ok: false, reason: 'denied (unparsable rule: ' + p + ')' }; }
      if (re.test(u)) return { ok: false, reason: 'origin denied by policy' };
    }
    return { ok: true, reason: '' };
  }

  /* ---------------------------------------------------------- tab picking */
  /* Which open tab a query addresses, given the worker's tab list.
   *
   * Precedence: an explicit `tabId`, then a `urls` regex (first match in the list), then the active
   * tab. A `urls` filter that matches nothing returns null rather than falling back to the active
   * tab — quietly answering about a DIFFERENT page than the one asked for is the worst possible
   * failure for something whose whole job is to report what is on screen. */
  function planTargets(tabs, args) {
    var list = tabs || [], a = args || {}, i;
    if (a.tabId != null) {
      for (i = 0; i < list.length; i++) if (list[i] && list[i].id === a.tabId) return list[i];
      return null;
    }
    if (trim(a.urls)) {
      var re;
      try { re = new RegExp(trim(a.urls), 'i'); } catch (e) { return null; }
      for (i = 0; i < list.length; i++) if (list[i] && re.test(str(list[i].url))) return list[i];
      return null;
    }
    for (i = 0; i < list.length; i++) if (list[i] && list[i].active) return list[i];
    return list[0] || null;
  }

  /* ------------------------------------------------------------ projections */
  function all(node, sel) {
    if (!node || !node.querySelectorAll) return [];
    var found;
    try { found = node.querySelectorAll(sel); } catch (e) { return []; }
    var out = [], i;
    for (i = 0; i < found.length && out.length < MAX_ITEMS; i++) out.push(found[i]);
    return out;
  }
  function attr(el, name) {
    if (!el || !el.getAttribute) return '';
    var v;
    try { v = el.getAttribute(name); } catch (e) { return ''; }
    return v == null ? '' : String(v);
  }
  function text(el, cap) { return el ? tidy(el.textContent, cap) : ''; }

  function links(doc) {
    return all(doc, 'a[href]').map(function (a) {
      // `a.href` is the RESOLVED absolute url the browser computed; the attribute is whatever the
      // markup said. An app receiving `/login` cannot resolve it — it does not know the base — so
      // prefer the resolved form and fall back only when there isn't one.
      return { text: text(a), href: str(a.href || attr(a, 'href')).slice(0, MAX_CELL) };
    });
  }

  function headings(doc) {
    return all(doc, 'h1,h2,h3,h4,h5,h6').map(function (h) {
      return { level: parseInt(str(h.tagName).slice(1), 10) || 1, text: text(h) };
    });
  }

  function tables(doc) {
    return all(doc, 'table').slice(0, MAX_TABLES).map(function (t) {
      var rows = all(t, 'tr').slice(0, MAX_ROWS).map(function (tr) {
        return all(tr, 'th,td').map(function (c) { return text(c); });
      });
      var cap = all(t, 'caption')[0];
      return { caption: cap ? text(cap) : '', rows: rows };
    });
  }

  function forms(doc) {
    return all(doc, 'form').map(function (f) {
      var fields = all(f, 'input,select,textarea').map(function (el) {
        // NAME and TYPE only. See rule 2 at the top of this file: no `el.value`, ever, and no
        // `placeholder` either (password managers and card forms put real hints there).
        return {
          name: tidy(attr(el, 'name') || attr(el, 'id')),
          type: tidy(attr(el, 'type') || str(el.tagName).toLowerCase()),
          // `getAttribute('required')` answers "" for a present bare attribute AND for an absent
          // one, so presence has to be asked for directly.
          required: !!(el.required || (el.hasAttribute && el.hasAttribute('required')))
        };
      });
      return {
        action: str(f.action || attr(f, 'action')).slice(0, MAX_CELL),
        method: tidy(attr(f, 'method') || 'get').toLowerCase(),
        fields: fields
      };
    });
  }

  function meta(doc) {
    var out = { title: tidy(doc.title) || text(all(doc, 'title')[0]), description: '', canonical: '', og: {}, jsonld: [] };
    all(doc, 'meta[name]').forEach(function (m) {
      if (tidy(attr(m, 'name')).toLowerCase() === 'description') out.description = tidy(attr(m, 'content'), MAX_CELL);
    });
    all(doc, 'meta[property]').forEach(function (m) {
      var p = tidy(attr(m, 'property')).toLowerCase();
      if (p.indexOf('og:') === 0) out.og[p.slice(3)] = tidy(attr(m, 'content'), MAX_CELL);
    });
    var canon = all(doc, 'link[rel="canonical"]')[0];
    if (canon) out.canonical = str(canon.href || attr(canon, 'href')).slice(0, MAX_CELL);
    all(doc, 'script[type="application/ld+json"]').forEach(function (s) {
      // Structured data is the one place a page states what it IS (an article, a product, a
      // dataset) in machine terms, which is exactly what an engine on the other end wants. Parsed
      // here so the consumer gets objects; a malformed block is skipped rather than failing the
      // whole projection, because one bad script tag must not cost the other nine.
      if (out.jsonld.length >= 20) return;
      try { out.jsonld.push(JSON.parse(str(s.textContent))); } catch (e) {}
    });
    return out;
  }

  function extract(doc, opts) {
    var sel = trim(opts.selector);
    if (!sel) return { __err: 'page.extract needs a selector' };
    var name = trim(opts.attr);
    return all(doc, sel).map(function (el) {
      return name ? { text: text(el), attr: tidy(attr(el, name), MAX_CELL) } : { text: text(el) };
    });
  }

  /* Project one typed view of `doc`.
   *
   * `opts.selection` is supplied by the caller because a selection lives on the WINDOW, not the
   * document, and this file is deliberately window-free so it can be tested without one. */
  function project(doc, kind, opts) {
    var o = opts || {};
    if (!doc) return { __err: 'no document' };
    if (!isProjection(kind)) return { __err: 'unknown projection: ' + kind };
    switch (kind) {
      case 'page.url': return str(doc.location && doc.location.href);
      case 'page.title': return tidy(doc.title);
      case 'page.text': return tidy(doc.body ? doc.body.textContent : '', MAX_TEXT);
      case 'page.links': return links(doc);
      case 'page.headings': return headings(doc);
      case 'page.tables': return tables(doc);
      case 'page.forms': return forms(doc);
      case 'page.meta': return meta(doc);
      case 'page.selection': return tidy(o.selection, MAX_TEXT);
      default: return extract(doc, o);
    }
  }

  /* Project SEVERAL views of `doc` in ONE synchronous pass.
   *
   * This is what makes a PREMISE set checkable. zwire-host re-reads every premise of a transaction
   * before it lets the commit stand (native/zwire-host/src/witness.rs), and re-reading them one at a
   * time would let the page move BETWEEN the answers — a set could then validate in a state the page
   * was never simultaneously in, which is worse than not checking, because it looks like a guarantee.
   * The whole set is therefore projected inside a single function body: the DOM cannot change while
   * it runs, so every value comes from one moment.
   *
   * One entry per read, in the order asked, each `{ok:true,value}` or `{ok:false,err}`. A read that
   * fails is ISOLATED — a bad selector in read 3 must not cost reads 1, 2 and 4 their answers, since
   * on the host side each one gates a different premise. */
  function projectMany(doc, reads, opts) {
    var list = reads || [], out = [], i, key, r, src, o, v;
    for (i = 0; i < list.length && i < MAX_BATCH; i++) {
      r = list[i] || {};
      src = r.args || {};
      o = {};
      for (key in src) if (Object.prototype.hasOwnProperty.call(src, key)) o[key] = src[key];
      o.selection = (opts || {}).selection;
      v = project(doc, str(r.state), o);
      if (v && v.__err) out.push({ ok: false, err: str(v.__err) });
      else out.push({ ok: true, value: v });
    }
    return out;
  }

  var API = {
    PROJECTIONS: PROJECTIONS,
    EXTRACT: EXTRACT,
    BATCH: BATCH,
    MAX_BATCH: MAX_BATCH,
    MAX_ITEMS: MAX_ITEMS,
    MAX_TEXT: MAX_TEXT,
    MAX_CELL: MAX_CELL,
    isProjection: isProjection,
    isBatch: function (id) { return id === BATCH; },
    originAllowed: originAllowed,
    planTargets: planTargets,
    project: project,
    projectMany: projectMany
  };

  try { root.ZWIRE_PAGE = API; } catch (e) {}
  try { if (typeof module !== 'undefined' && module.exports) module.exports = API; } catch (e) {}
})(typeof self !== 'undefined' ? self : typeof window !== 'undefined' ? window : this);
