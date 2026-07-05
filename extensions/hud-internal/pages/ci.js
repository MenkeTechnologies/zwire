/* zbrowser HUD — CI runs dashboard. Aggregates GitHub Actions workflow runs
 * across your repos into one page (the thing chrome makes you click 20 times
 * for). Config (user + optional token) lives in chrome.storage.local 'zb_ci'.
 * All UI is ZGui.* per the zgui-core-only rule. */
(function () {
  'use strict';
  var Z = window.ZGui;
  var esc = (Z.util && Z.util.escapeHtml) || function (s) { return String(s == null ? '' : s); };

  var shell = window.ZBHUD.mount({
    title: 'CI', current: 'ci.html', filterPlaceholder: '>_ filter runs…',
    onFilter: function (v) { filter = (v || '').toLowerCase(); drawTable(); }
  });
  var body = shell.body;

  var filter = '';
  var CFG = { user: 'MenkeTechnologies', token: '', repoLimit: 20 };
  var allRuns = [];
  var lastError = '';
  var loading = false;
  var loadedAt = 0;

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
        var extra = r.status === 403 ? ' — rate limited, add a token below'
          : r.status === 401 ? ' — bad token'
          : r.status === 404 ? ' — not found (private repo needs a token)' : '';
        throw new Error('HTTP ' + r.status + extra);
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
  function fetchAll() {
    if (loading) return;
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
      loading = false; loadedAt = Date.now(); drawTable();
    }).catch(function (e) {
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
    if (!filter) return true;
    return (r.repo + ' ' + r.wf + ' ' + r.branch + ' ' + r.event + ' ' + r.actor + ' ' + r.conclusion + ' ' + r.status)
      .toLowerCase().indexOf(filter) >= 0;
  }

  var tableHost = document.createElement('div');
  var statusEl = document.createElement('div'); statusEl.className = 'ci-status';

  function drawTable() {
    // status line
    var bits = [];
    if (loading) bits.push('<span>syncing…</span>');
    if (lastError) bits.push('<span class="err">⚠ ' + esc(lastError) + '</span>');
    if (!loading && !lastError) bits.push('<span>' + allRuns.length + ' runs · ' + esc(CFG.user) + (CFG.token ? ' · authed' : ' · anon') + (loadedAt ? ' · ' + ago(loadedAt) : '') + '</span>');
    statusEl.innerHTML = bits.join('');

    tableHost.innerHTML = '';
    var rows = allRuns.filter(matches);
    if (!rows.length && !loading) {
      tableHost.innerHTML = '<div class="ci-hint" style="padding:24px 4px;">' +
        (lastError ? 'Could not load runs. ' : 'No workflow runs found. ') +
        'Set your GitHub user (and a token for private repos / higher rate limits) above.</div>';
      return;
    }
    var dt = Z.dataTable(tableHost, {
      id: 'ci-table', resizable: true, sortScope: 'zb-ci',
      columns: [
        { key: 'st', label: 'STATUS', sortable: false, width: '120px', render: function (r) { return pill(r); } },
        { key: 'repo', label: 'REPO', width: '150px', render: function (r) { return '<span class="ci-repo">' + esc(r.repo) + '</span>'; } },
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
      rows: rows,
      onRowClick: function (r) { if (r.url) try { chrome.tabs.create({ url: r.url }); } catch (e) { window.open(r.url, '_blank'); } }
    });
    // apply the wide-cell class to the workflow column
    if (dt && dt.el) dt.el.querySelectorAll('tr').forEach(function (tr) { var td = tr.children[2]; if (td && td.tagName === 'TD') td.classList.add('ci-wfcell'); });
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
      saveCfg(); fetchAll();
    }

    var actions = document.createElement('div'); actions.className = 'ci-actions';
    actions.appendChild(Z.button({ label: 'SAVE', variant: 'primary', onClick: apply }));
    actions.appendChild(Z.button({ label: '↻ REFRESH', variant: 'mini', onClick: fetchAll }));

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

  loadCfg(function () { fetchAll(); });
  // light auto-refresh so long-running builds update without a manual reload.
  setInterval(function () { if (!document.hidden && Date.now() - loadedAt > 45000) fetchAll(); }, 30000);
})();
