/* zwire HUD — Clear browsing data. The HUD shadows every chrome://settings/*
 * URL (redirect.js), so Chrome's own "Delete browsing data" dialog is
 * unreachable: this IS the replacement, a four-step ZGui.wizard (time range →
 * data types → scope → review/run) over chrome.browsingData with a per-type
 * result report. Mounted by pages/settings.js in the Privacy section and
 * deep-linked from chrome://settings/clearBrowserData.
 *
 * The data-type table is not guesswork — it mirrors MaskForKey() in
 * chrome/browser/extensions/api/browsing_data/browsing_data_api.cc of the
 * pinned Chromium (fork/CHROMIUM_VERSION): exactly these ten keys map to a
 * non-zero removal mask. `passwords`, `pluginData`, `appcache`,
 * `serverBoundCertificates` and `webSQL` all resolve to mask 0 — the call
 * "succeeds" and deletes nothing — so they are deliberately absent here
 * instead of being offered as a lie.
 *
 * Pure helpers hang off window.ZBClear so tests/cleardata.mjs can exercise the
 * range math, the RemovalOptions/DataTypeSet mapping and the API's own filter
 * rules headless (no chrome, no DOM). */
(function () {
  'use strict';

  var HOUR = 3600e3, DAY = 24 * HOUR;

  var RANGES = [
    { id: 'hour', label: 'Last hour', ms: HOUR },
    { id: 'day', label: 'Last 24 hours', ms: DAY },
    { id: 'week', label: 'Last 7 days', ms: 7 * DAY },
    { id: 'month', label: 'Last 4 weeks', ms: 28 * DAY },
    { id: 'all', label: 'All time', ms: 0 }
  ];

  // filterable: accepts an origins/excludeOrigins filter. browsing_data_api.cc
  // allows a filter only for SITE_DATA | CACHE (kFilterableDataTypes) and errors
  // with kNonFilterableError otherwise.
  // policyGated: deletion refused outright when the AllowDeletingBrowserHistory
  // policy is off (IsRemovalPermitted covers HISTORY | DOWNLOADS).
  var TYPES = [
    { id: 'history', label: 'Browsing history', desc: 'Visited URLs and omnibox suggestions', dflt: true, filterable: false, policyGated: true },
    { id: 'downloads', label: 'Download history', desc: 'The download list — not the files on disk', dflt: true, filterable: false, policyGated: true },
    { id: 'cookies', label: 'Cookies and site data', desc: 'Signs you out of most sites', dflt: true, filterable: true },
    { id: 'cache', label: 'Cached images and files', desc: 'Frees disk; pages reload slower once', dflt: true, filterable: true },
    { id: 'formData', label: 'Autofill form data', desc: 'Saved form entries', dflt: false, filterable: false },
    { id: 'localStorage', label: 'Local storage', desc: 'Per-site localStorage', dflt: false, filterable: true },
    { id: 'indexedDB', label: 'IndexedDB', desc: 'Per-site databases', dflt: false, filterable: true },
    { id: 'cacheStorage', label: 'Cache storage', desc: 'Service-worker Cache API entries', dflt: false, filterable: true },
    { id: 'serviceWorkers', label: 'Service workers', desc: 'Registered background workers', dflt: false, filterable: true },
    { id: 'fileSystems', label: 'File systems', desc: 'Sandboxed per-site file systems', dflt: false, filterable: true }
  ];

  // Accepted by the API and silently ignored by this Chromium — never offered.
  var IGNORED_TYPES = ['passwords', 'pluginData', 'appcache', 'serverBoundCertificates', 'webSQL'];

  function rangeById(id) { for (var i = 0; i < RANGES.length; i++) if (RANGES[i].id === id) return RANGES[i]; return null; }
  function typeById(id) { for (var i = 0; i < TYPES.length; i++) if (TYPES[i].id === id) return TYPES[i]; return null; }

  // Epoch ms for RemovalOptions.since. 0 means "everything" per the API.
  function sinceFor(rangeId, now) {
    var r = rangeById(rangeId);
    if (!r || !r.ms) return 0;
    return Math.max(0, (now == null ? 0 : now) - r.ms);
  }

  function pickedTypes(sel) { return TYPES.filter(function (t) { return !!(sel && sel[t.id]); }); }

  // Origin lists arrive as free text (one per line / comma separated).
  function parseOrigins(text) {
    return String(text == null ? '' : text).split(/[\s,]+/).filter(Boolean);
  }

  /* Build the exact ({RemovalOptions}, {DataTypeSet}) pair the API wants, plus
   * the errors Chromium would reject the call with — so the wizard can refuse
   * before firing rather than surfacing a raw lastError. */
  function buildRemoval(sel, rangeId, scope, now) {
    scope = scope || {};
    var picked = pickedTypes(sel), errors = [];
    var origins = scope.origins || [], exclude = scope.excludeOrigins || [];

    if (!picked.length) errors.push('Select at least one data type.');
    // kIncompatibleFilterError — origins and excludeOrigins are mutually exclusive.
    if (origins.length && exclude.length) errors.push('Use either an origin list or an exclude list, not both.');
    if (origins.length || exclude.length) {
      var blocked = picked.filter(function (t) { return !t.filterable; });
      // kNonFilterableError — a filter only applies to site data + cache.
      if (blocked.length) {
        errors.push('Origin filtering does not apply to: ' +
          blocked.map(function (t) { return t.label.toLowerCase(); }).join(', ') + '.');
      }
    }

    var options = {
      since: sinceFor(rangeId, now),
      originTypes: {
        unprotectedWeb: scope.unprotectedWeb !== false,
        protectedWeb: !!scope.protectedWeb,
        extension: !!scope.extension
      }
    };
    if (origins.length) options.origins = origins.slice();
    else if (exclude.length) options.excludeOrigins = exclude.slice();

    var dataToRemove = {};
    picked.forEach(function (t) { dataToRemove[t.id] = true; });

    return { options: options, dataToRemove: dataToRemove, types: picked.map(function (t) { return t.id; }), errors: errors };
  }

  function summarize(sel, rangeId) {
    var picked = pickedTypes(sel), r = rangeById(rangeId);
    if (!picked.length) return 'Nothing selected';
    return picked.map(function (t) { return t.label; }).join(', ') + ' — ' + ((r && r.label) || 'All time').toLowerCase();
  }

  /* Run one remove() per data type instead of a single combined call: a type the
   * profile refuses (history under AllowDeletingBrowserHistory=false) would
   * otherwise abort the whole batch, and per-type calls are what make the result
   * report truthful about what actually got deleted. */
  function run(built, done, onStep) {
    var results = [], i = 0, ids = (built && built.types) || [];
    (function next() {
      if (i >= ids.length) { if (done) done(results); return; }
      var id = ids[i++], one = {};
      one[id] = true;
      function settle(ok, msg) {
        results.push({ id: id, ok: ok, error: msg || '' });
        if (onStep) onStep(results.length / ids.length, id);
        next();
      }
      try {
        chrome.browsingData.remove(built.options, one, function () {
          var err = chrome.runtime.lastError;
          settle(!err, err ? err.message : '');
        });
      } catch (e) { settle(false, String((e && e.message) || e)); }
    })();
  }

  /* ------------------------------------------------------------------ wizard */
  function el(t, c, h) { var e = document.createElement(t); if (c) e.className = c; if (h != null) e.innerHTML = h; return e; }
  function txt(t, c, s) { var e = document.createElement(t); if (c) e.className = c; e.textContent = s == null ? '' : s; return e; }

  function mount(host, opts) {
    opts = opts || {};
    var Z = window.ZGui || {};
    if (!host) return null;
    host.innerHTML = '';

    var state = {
      range: opts.range || 'hour',
      sel: {},
      scope: { unprotectedWeb: true, protectedWeb: false, extension: false, mode: 'all', originsText: '' }
    };
    TYPES.forEach(function (t) { state.sel[t.id] = !!t.dflt; });

    // browsingData.settings() reports what the native dialog has ticked plus
    // dataRemovalPermitted (enterprise policy), so seed from the profile rather
    // than from our own defaults, and grey out what policy forbids.
    var permitted = null;
    try {
      chrome.browsingData.settings(function (res) {
        void chrome.runtime.lastError;
        if (!res) return;
        permitted = res.dataRemovalPermitted || null;
        if (res.dataToRemove) TYPES.forEach(function (t) { if (typeof res.dataToRemove[t.id] === 'boolean') state.sel[t.id] = res.dataToRemove[t.id]; });
        if (wiz && wiz.current() === 1) wiz.goTo(1);          // re-render the types step in place
      });
    } catch (e) {}

    function allowed(t) { return !permitted || permitted[t.id] !== false; }
    function scopeOrigins() { return state.scope.mode === 'only' ? parseOrigins(state.scope.originsText) : []; }
    function scopeExcludes() { return state.scope.mode === 'except' ? parseOrigins(state.scope.originsText) : []; }
    function built() {
      return buildRemoval(state.sel, state.range, {
        unprotectedWeb: state.scope.unprotectedWeb,
        protectedWeb: state.scope.protectedWeb,
        extension: state.scope.extension,
        origins: scopeOrigins(),
        excludeOrigins: scopeExcludes()
      }, Date.now());
    }

    function head(body, title, sub) {
      body.appendChild(txt('div', 'set-h', '// ' + title));
      if (sub) body.appendChild(txt('div', 'zc-sub', sub));
    }

    function stepRange(body) {
      head(body, 'TIME RANGE', 'Data newer than this is deleted. "All time" ignores the cutoff.');
      var holder = el('div');
      body.appendChild(holder);
      if (Z.radio) {
        Z.radio(holder, {
          options: RANGES.map(function (r) { return { value: r.id, label: r.label }; }),
          value: state.range,
          onChange: function (v) { state.range = v; }
        });
      }
    }

    function stepTypes(body) {
      head(body, 'DATA TYPES', 'Seeded from this profile’s Clear-browsing-data selection.');
      TYPES.forEach(function (t) {
        var row = el('label', 'xt-switch full');
        var lab = el('span');
        lab.appendChild(txt('span', null, t.label));
        lab.appendChild(txt('span', 'zc-sub', ' · ' + t.desc));
        row.appendChild(lab);
        var tg = Z.toggle({ checked: !!state.sel[t.id] && allowed(t), onChange: function (on) { state.sel[t.id] = on; } });
        if (!allowed(t)) { tg.el.style.pointerEvents = 'none'; tg.el.style.opacity = '.5'; state.sel[t.id] = false; }
        row.appendChild(tg.el);
        body.appendChild(row);
      });
      if (permitted && TYPES.some(function (t) { return !allowed(t); }) && Z.alert) {
        body.appendChild(Z.alert({ kind: 'warning', text: 'Some types are blocked by policy on this profile and cannot be deleted.' }).el);
      }
      body.appendChild(txt('div', 'footer-docs',
        '[ ignored by this Chromium build: ' + IGNORED_TYPES.join(', ') + ' ]'));
    }

    function stepScope(body) {
      head(body, 'SCOPE', 'Which origins, and which classes of storage, the deletion touches.');
      [['protectedWeb', 'Include hosted-app data (protected web)'],
        ['extension', 'Include extension data']].forEach(function (p) {
        var row = el('label', 'xt-switch full');
        row.appendChild(txt('span', null, p[1]));
        row.appendChild(Z.toggle({ checked: !!state.scope[p[0]], onChange: function (on) { state.scope[p[0]] = on; } }).el);
        body.appendChild(row);
      });
      var modeHost = el('div');
      body.appendChild(modeHost);
      if (Z.radio) {
        Z.radio(modeHost, {
          options: [{ value: 'all', label: 'Every site' },
            { value: 'only', label: 'Only these origins' },
            { value: 'except', label: 'Every site except these origins' }],
          value: state.scope.mode,
          onChange: function (v) { state.scope.mode = v; ta.el.style.display = v === 'all' ? 'none' : ''; }
        });
      }
      var ta = Z.textarea({ value: state.scope.originsText, rows: 3,
        placeholder: 'https://example.com  https://news.example.org',
        onInput: function (v) { state.scope.originsText = v; } });
      ta.el.style.display = state.scope.mode === 'all' ? 'none' : '';
      body.appendChild(ta.el);
      body.appendChild(txt('div', 'footer-docs',
        '[ an origin filter applies to cookies, cache and site storage only — not history, downloads or form data ]'));
    }

    function stepReview(body) {
      var b = built();
      head(body, 'REVIEW', summarize(state.sel, state.range));
      var pre = txt('pre', 'zc-pre', JSON.stringify({ options: b.options, dataToRemove: b.dataToRemove }, null, 2));
      pre.style.cssText = 'overflow-x:auto;font-size:11px;';
      body.appendChild(pre);
      b.errors.forEach(function (m) { if (Z.alert) body.appendChild(Z.alert({ kind: 'error', text: m }).el); });
      if (!b.errors.length) {
        body.appendChild(txt('div', 'footer-docs', '[ Finish deletes immediately — there is no undo ]'));
      }
    }

    function report(results) {
      host.innerHTML = '';
      var okCount = results.filter(function (r) { return r.ok; }).length;
      var list = el('div');
      results.forEach(function (r) {
        var t = typeById(r.id);
        var row = el('div', 'xt-switch full');
        row.appendChild(txt('span', null, (r.ok ? '✓ ' : '✕ ') + ((t && t.label) || r.id)));
        if (!r.ok) row.appendChild(txt('span', 'zc-sub', r.error || 'refused'));
        list.appendChild(row);
      });
      if (Z.result) {
        host.appendChild(Z.result(null, {
          status: okCount === results.length ? 'success' : 'warning',
          title: okCount + ' of ' + results.length + ' data types cleared',
          subtitle: summarize(state.sel, state.range),
          actions: [{ label: 'Clear something else', primary: true, onClick: function () { mount(host, opts); } }]
        }).el);
      }
      host.appendChild(list);
      if (opts.onDone) opts.onDone(results);
    }

    var shell = el('div', 'zc-wizard');
    host.appendChild(shell);
    var wiz = Z.wizard ? Z.wizard(shell, {
      steps: [
        { title: 'Time range', render: stepRange },
        { title: 'Data types', render: stepTypes },
        { title: 'Scope', render: stepScope },
        { title: 'Review', render: stepReview }
      ],
      onFinish: function () {
        var b = built();
        if (b.errors.length) { if (window.ZGui && ZGui.toast) ZGui.toast.show(b.errors[0]); return; }
        run(b, report);
      }
    }) : null;
    return { el: shell, wizard: wiz, state: state };
  }

  window.ZBClear = {
    RANGES: RANGES, TYPES: TYPES, IGNORED_TYPES: IGNORED_TYPES,
    rangeById: rangeById, typeById: typeById, sinceFor: sinceFor,
    pickedTypes: pickedTypes, parseOrigins: parseOrigins,
    buildRemoval: buildRemoval, summarize: summarize, run: run, mount: mount
  };
})();
