/* zwire HUD — CI runs dashboard. Aggregates GitHub Actions workflow runs
 * across your repos into one page (the thing chrome makes you click 20 times
 * for). Config (user + optional token) lives in chrome.storage.local 'zb_ci'.
 * All UI is ZGui.* per the zgui-core-only rule. */
(function () {
  'use strict';
  var Z = window.ZGui;
  var esc = (Z.util && Z.util.escapeHtml) || function (s) { return String(s == null ? '' : s); };

  var shell = window.ZBHUD.mount({
    title: 'CI', current: 'ci.html', filterPlaceholder: '>_ filter runs…',
    onFilter: function (v, rx) { matchFn = window.ZBHUD.matcher(v, rx); drawTable(); }
  });
  var body = shell.body;

  var matchFn = function () { return true; };
  var CFG = { user: 'MenkeTechnologies', token: '', repoLimit: 20 };
  var allRuns = [];
  var lastError = '';
  var loading = false;
  var loadedAt = 0;
  var rateLimitReset = 0;        // ms epoch; set from X-RateLimit-Reset on a 403
  var openState = {};            // repo -> user's expand/collapse, survives redraws
  var CACHE_KEY = 'zb_ci_cache';
  var TTL = 300000;              // 5 min — anon GitHub allows only 60 req/hr, and one
                                 // sync is ~1+repoLimit requests, so don't hammer it.

  function loadCache(cb) {
    try {
      chrome.storage.local.get(CACHE_KEY, function (o) {
        void chrome.runtime.lastError;
        var c = o && o[CACHE_KEY];
        if (c && c.user === CFG.user && c.token === !!CFG.token && Array.isArray(c.runs)) {
          allRuns = c.runs; loadedAt = c.at || 0;
        }
        cb();
      });
    } catch (e) { cb(); }
  }
  function saveCache() {
    try { var o = {}; o[CACHE_KEY] = { user: CFG.user, token: !!CFG.token, at: loadedAt, runs: allRuns }; chrome.storage.local.set(o); } catch (e) {}
  }

  function loadCfg(cb) {
    try {
      chrome.storage.local.get('zb_ci', function (o) {
        var c = (o && o.zb_ci) || {};
        if (c.user) CFG.user = c.user;
        if (c.token != null) CFG.token = c.token;
        if (c.repoLimit) CFG.repoLimit = c.repoLimit;
        cb();
      });
    } catch (e) { cb(); }
  }
  function saveCfg() {
    try { chrome.storage.local.set({ zb_ci: { user: CFG.user, token: CFG.token, repoLimit: CFG.repoLimit } }); } catch (e) {}
  }

  /* ---- GitHub API ---------------------------------------------------------- */
  function ghHeaders() {
    var h = { 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
    if (CFG.token) h['Authorization'] = 'Bearer ' + CFG.token;
    return h;
  }
  function api(path) {
    return fetch('https://api.github.com' + path, { headers: ghHeaders() }).then(function (r) {
      if (!r.ok) {
        if (r.status === 403 || r.status === 429) {
          var rs = parseInt(r.headers.get('x-ratelimit-reset'), 10);
          if (rs) rateLimitReset = rs * 1000;
        }
        var extra = (r.status === 403 || r.status === 429) ? ' — rate limited, add a token below'
          : r.status === 401 ? ' — bad token'
          : r.status === 404 ? ' — not found (private repo needs a token)' : '';
        var e = new Error('HTTP ' + r.status + extra); e.status = r.status; throw e;
      }
      return r.json();
    });
  }
  function reposUrl() {
    return CFG.token
      ? '/user/repos?per_page=100&sort=pushed&affiliation=owner,collaborator,organization_member'
      : '/users/' + encodeURIComponent(CFG.user) + '/repos?per_page=100&sort=pushed&type=owner';
  }
  function normalize(run, rp) {
    return {
      repo: rp.name, full: rp.full_name,
      wf: run.name || run.display_title || 'workflow',
      title: run.display_title || run.head_commit && run.head_commit.message || '',
      branch: run.head_branch || '', event: run.event || '',
      status: run.status || '', conclusion: run.conclusion || '',
      url: run.html_url, actor: (run.actor && run.actor.login) || '',
      ts: Date.parse(run.run_started_at || run.created_at) || 0, num: run.run_number || 0
    };
  }
  function fetchAll(manual) {
    if (loading) return;
    // Respect a known rate-limit window for AUTO refreshes so we don't keep
    // burning 403s; a manual REFRESH always tries (the window may have reset).
    if (!manual && rateLimitReset && Date.now() < rateLimitReset) { drawTable(); return; }
    loading = true; lastError = ''; drawTable();
    api(reposUrl()).then(function (repos) {
      repos = (repos || []).filter(function (r) { return !r.archived; }).slice(0, CFG.repoLimit);
      return Promise.all(repos.map(function (rp) {
        return api('/repos/' + rp.full_name + '/actions/runs?per_page=8')
          .then(function (d) { return (d.workflow_runs || []).map(function (run) { return normalize(run, rp); }); })
          .catch(function () { return []; });
      }));
    }).then(function (lists) {
      allRuns = [].concat.apply([], lists).sort(function (a, b) { return b.ts - a.ts; }).slice(0, 100);
      loading = false; loadedAt = Date.now(); rateLimitReset = 0; saveCache(); drawTable();
    }).catch(function (e) {
      // Keep the cached runs on screen (esp. on 403) instead of blanking the page.
      lastError = (e && e.message) || String(e); loading = false; drawTable();
    });
  }

  /* ---- rendering ----------------------------------------------------------- */
  function pill(run) {
    var s = run.status, c = run.conclusion, kind, label;
    if (s && s !== 'completed') { kind = 'warn'; label = s.replace(/_/g, ' '); }
    else if (c === 'success') { kind = 'ok'; label = 'success'; }
    else if (c === 'failure' || c === 'timed_out' || c === 'startup_failure') { kind = 'err'; label = c.replace(/_/g, ' '); }
    else { kind = 'info'; label = c ? c.replace(/_/g, ' ') : (s || '—'); }
    return Z.statusPill(kind, { kind: kind, label: label });
  }
  function ago(ts) {
    if (!ts) return '—';
    var s = Math.max(0, (Date.now() - ts) / 1000);
    if (s < 60) return Math.floor(s) + 's ago';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    return Math.floor(s / 86400) + 'd ago';
  }
  function matches(r) {
    return matchFn(r.repo + ' ' + r.wf + ' ' + r.branch + ' ' + r.event + ' ' + r.actor + ' ' + r.conclusion + ' ' + r.status);
  }

  var tableHost = document.createElement('div');
  var statusEl = document.createElement('div'); statusEl.className = 'ci-status';

  function isBad(r) { return r.conclusion === 'failure' || r.conclusion === 'timed_out' || r.conclusion === 'startup_failure'; }
  function isRunning(r) { return r.status && r.status !== 'completed'; }
  function glyph(r) { return isRunning(r) ? '◔' : isBad(r) ? '✗' : r.conclusion === 'success' ? '✓' : '○'; }

  function repoTable(host, list) {
    var dt = Z.dataTable(host, {
      id: 'ci-' + (list[0] && list[0].repo || 'x'), resizable: true, sortScope: 'zb-ci',
      columns: [
        { key: 'st', label: 'STATUS', sortable: false, width: '120px', render: function (r) { return pill(r); } },
        { key: 'wf', label: 'WORKFLOW', render: function (r) {
            var td = '<div class="ci-wf">' + esc(r.wf) + '</div>';
            if (r.title && r.title !== r.wf) td += '<div class="ci-num">' + esc(r.title.slice(0, 80)) + '</div>';
            return td;
          } },
        { key: 'branch', label: 'BRANCH', width: '130px', render: function (r) { return '<span class="ci-branch">' + esc(r.branch || '—') + '</span>'; } },
        { key: 'event', label: 'EVENT', width: '100px' },
        { key: 'actor', label: 'ACTOR', width: '120px' },
        { key: 'ts', label: 'WHEN', width: '90px', render: function (r) { return '<span class="ci-when">' + ago(r.ts) + '</span>'; } },
        { key: 'num', label: '#', width: '60px', render: function (r) { return '<span class="ci-num">#' + r.num + '</span>'; } }
      ],
      rows: list,
      onRowClick: function (r) { if (r.url) try { chrome.tabs.create({ url: r.url }); } catch (e) { window.open(r.url, '_blank'); } }
    });
    if (dt && dt.el) dt.el.querySelectorAll('tr').forEach(function (tr) { var td = tr.children[1]; if (td && td.tagName === 'TD') td.classList.add('ci-wfcell'); });
  }

  function drawTable() {
    // status line — keep cached counts visible even when a fetch just errored.
    var bits = [];
    if (loading) bits.push('<span>syncing…</span>');
    if (lastError) {
      bits.push('<span class="err">⚠ ' + esc(lastError) + (allRuns.length ? ' · showing cached (' + ago(loadedAt) + ')' : '') + '</span>');
      if (rateLimitReset && Date.now() < rateLimitReset) bits.push('<span>· resets in ' + Math.ceil((rateLimitReset - Date.now()) / 60000) + 'm</span>');
    }
    if (!loading && !lastError) bits.push('<span>' + allRuns.length + ' runs · ' + esc(CFG.user) + (CFG.token ? ' · authed' : ' · anon') + (loadedAt ? ' · ' + ago(loadedAt) : '') + '</span>');
    statusEl.innerHTML = bits.join(' ');

    tableHost.innerHTML = '';
    var rows = allRuns.filter(matches);
    if (!rows.length && !loading) {
      tableHost.innerHTML = '<div class="ci-hint" style="padding:24px 4px;">' +
        (lastError ? 'Could not load runs. ' : 'No workflow runs found. ') +
        'Set your GitHub user (and a token for private repos / higher rate limits) above.</div>';
      return;
    }
    // Collapse by repo: one accordion section per repo (rows are pre-sorted by
    // recency, so the first per repo is newest). Repos with a failing/in-flight
    // latest run open by default; a user's manual toggle wins on redraw.
    var order = [], groups = {};
    rows.forEach(function (r) { if (!groups[r.repo]) { groups[r.repo] = []; order.push(r.repo); } groups[r.repo].push(r); });
    var sections = order.map(function (repo) {
      var list = groups[repo];
      var latest = list[0];
      var bad = list.some(function (r) { return isBad(r) || isRunning(r); });
      var host = document.createElement('div');
      repoTable(host, list);
      return {
        title: glyph(latest) + '  ' + repo + '   ·   ' + list.length + ' run' + (list.length > 1 ? 's' : ''),
        body: host,
        open: openState[repo] != null ? openState[repo] : bad
      };
    });
    ZGui.accordion(tableHost, sections, { multi: true, onToggle: function (i, isOpen) { openState[order[i]] = isOpen; } });
  }

  /* ---- toolbar (built once) ------------------------------------------------ */
  function buildToolbar() {
    var wrap = document.createElement('div'); wrap.className = 'ci-toolbar';

    var userTf = Z.textfield({ value: CFG.user, placeholder: 'github user', onEnter: apply });
    var userField = Z.field({ label: 'USER', control: userTf.el });

    var tokTf = Z.textfield({ value: CFG.token, placeholder: 'ghp_… (optional, for private repos)', type: 'password', onEnter: apply });
    tokTf.el.classList.add('ci-tok');
    var tokField = Z.field({ label: 'TOKEN', control: tokTf.el, help: '' });

    var limTf = Z.textfield({ value: String(CFG.repoLimit), placeholder: '20', onEnter: apply });
    limTf.el.style.minWidth = '70px';
    var limField = Z.field({ label: 'REPOS', control: limTf.el });

    function apply() {
      CFG.user = (userTf.get() || '').trim() || 'MenkeTechnologies';
      CFG.token = (tokTf.get() || '').trim();
      CFG.repoLimit = Math.max(1, Math.min(100, parseInt(limTf.get(), 10) || 20));
      saveCfg(); rateLimitReset = 0; fetchAll(true);
    }

    var actions = document.createElement('div'); actions.className = 'ci-actions';
    actions.appendChild(Z.button({ label: 'SAVE', variant: 'primary', onClick: apply }));
    actions.appendChild(Z.button({ label: '↻ REFRESH', variant: 'mini', onClick: function () { fetchAll(true); } }));

    wrap.appendChild(userField.el);
    wrap.appendChild(tokField.el);
    wrap.appendChild(limField.el);
    wrap.appendChild(actions);

    var hint = document.createElement('div'); hint.className = 'ci-hint';
    hint.innerHTML = 'Rows link straight to the run on GitHub. A <a href="https://github.com/settings/tokens" target="_blank">fine-grained token</a> ' +
      '(Actions: read) lifts the 60-req/hr anon limit and reveals private repos.';

    var inner = document.createElement('div');
    inner.appendChild(wrap);
    inner.appendChild(hint);
    return Z.card({ body: inner }).el;
  }

  body.appendChild(buildToolbar());
  body.appendChild(statusEl);
  body.appendChild(tableHost);

  // Render cache instantly (survives a 403), then only hit the API if it's stale.
  loadCfg(function () { loadCache(function () { drawTable(); if (Date.now() - loadedAt > TTL) fetchAll(false); }); });
  // Light auto-refresh so long-running builds update without a manual reload —
  // gated by TTL + the rate-limit window so it never hammers the anon API.
  setInterval(function () { if (!document.hidden && Date.now() - loadedAt > TTL) fetchAll(false); }, 60000);
})();
