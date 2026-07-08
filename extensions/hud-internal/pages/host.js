/* zwire HUD — HOST page: talk to zwire-host (the native Rust host) directly.
 * Three panes, all via a persistent connectNative port (extension page → host):
 *   STATUS   — hello handshake: version / os / arch / pid / capabilities
 *   LIVE     — the exact statusbar stream (zb_sys), rendered as live metric tiles
 *   REPL     — send arbitrary JSON commands, see JSON replies + streamed events
 * Protocol is JSON in / JSON out. Everything from ZGui.* per the zgui-core rule. */
(function () {
  'use strict';
  var Z = window.ZGui;
  var esc = (Z.util && Z.util.escapeHtml) || function (s) { return String(s == null ? '' : s); };
  var HOST = 'com.zwire.hud';

  var curFilter = '';
  var logMatch = function () { return true; };
  var shell = window.ZBHUD.mount({
    title: 'HOST', current: 'host.html', filterPlaceholder: 'filter REPL log…',
    onFilter: function (v, rx) { curFilter = (v || '').trim(); logMatch = window.ZBHUD.matcher(v, rx); applyLogFilter(); }
  });
  var body = shell.body;
  function el(t, c, h) { var e = document.createElement(t); if (c) e.className = c; if (h != null) e.innerHTML = h; return e; }

  /* ------------------------------- styles -------------------------------- */
  var css = [
    '.zh-sub{color:var(--text-muted,#5a6b82);font-size:12px;}',
    '.zh-caps{display:flex;flex-wrap:wrap;gap:5px;margin-top:6px;}',
    '.zh-cap{border:1px solid var(--border,#1a2233);border-radius:3px;padding:1px 7px;font-size:11px;color:var(--cyan,#05d9e8);font-family:"Share Tech Mono",monospace;}',
    '.zh-live{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px;}',
    '.zh-metric{border:1px solid var(--border,#1a2233);border-radius:5px;padding:8px 10px;background:var(--bg-primary,#05060a);}',
    '.zh-mlabel{color:var(--text-muted,#5a6b82);font-size:10px;letter-spacing:1px;text-transform:uppercase;}',
    '.zh-mval{color:var(--cyan,#05d9e8);font-size:18px;font-family:"Share Tech Mono",monospace;margin-top:2px;}',
    '.zh-msub{color:var(--text-dim,#5a6b82);font-size:11px;}',
    '.zh-bar{height:4px;border-radius:2px;background:var(--border,#1a2233);margin-top:5px;overflow:hidden;}',
    '.zh-bar>i{display:block;height:100%;background:var(--cyan,#05d9e8);box-shadow:0 0 8px var(--cyan-glow,rgba(5,217,232,.6));}',
    '.zh-chips{display:flex;flex-wrap:wrap;gap:6px;margin:2px 0 10px;}',
    '.zh-chip{cursor:pointer;border:1px solid var(--border,#1a2233);border-radius:3px;padding:3px 9px;font-size:11px;',
    ' font-family:"Share Tech Mono",monospace;color:var(--text,#c8d2e0);background:var(--bg-primary,#05060a);}',
    '.zh-chip:hover{border-color:var(--cyan,#05d9e8);color:var(--cyan,#05d9e8);}',
    // command catalog — grouped, scrollable, click a chip to load its template
    '.zh-cat{max-height:170px;overflow:auto;border:1px solid var(--border,#1a2233);border-radius:4px;padding:8px 10px;margin-bottom:10px;background:var(--bg-primary,#05060a);}',
    '.zh-catlabel{color:var(--text-muted,#5a6b82);font-size:10px;letter-spacing:1px;text-transform:uppercase;margin:8px 0 3px;}',
    '.zh-catlabel:first-child{margin-top:0;}',
    // big JSON editor — drag the textarea corner to resize it taller/shorter
    '.zh-ed{margin-bottom:8px;}',
    '.zh-repl .zg-code{border:1px solid var(--cyan,#05d9e8);border-radius:4px;overflow:hidden;align-items:stretch;}',
    '.zh-repl .zg-code-ta{resize:vertical;min-height:120px;height:200px;font:13px "Share Tech Mono",monospace;}',
    '.zh-in{width:100%;box-sizing:border-box;resize:vertical;min-height:120px;height:200px;background:var(--bg-primary,#05060a);color:var(--text,#c8d2e0);',
    ' border:1px solid var(--cyan,#05d9e8);font:13px "Share Tech Mono",monospace;padding:8px;outline:none;border-radius:4px;}',
    '.zh-btns{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 10px;}',
    // JSON tree output log — bigger
    '.zh-log{height:min(52vh,520px);overflow:auto;background:var(--bg-primary,#05060a);border:1px solid var(--border,#1a2233);',
    ' border-radius:4px;padding:6px 8px;}',
    '.zh-entry{border-bottom:1px solid var(--border,#1a2233);padding:5px 2px;}',
    '.zh-ehead{display:flex;align-items:center;gap:8px;font:11px "Share Tech Mono",monospace;color:var(--text-muted,#5a6b82);}',
    '.zh-etime{opacity:.7;}',
    '.zh-ar{font-weight:700;}',
    '.zh-entry.out .zh-ar{color:var(--cyan,#05d9e8);} .zh-entry.in .zh-ar{color:#3fff9f;} .zh-entry.ev .zh-ar{color:#ffcf4a;}',
    '.zh-entry.err{color:var(--accent,#ff2a6d);font:12px "Share Tech Mono",monospace;}',
    '.zh-tree{margin:2px 0 0 2px;font-size:12px;}',
    '.zh-dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:7px;vertical-align:middle;}'
  ];
  var styleEl = el('style'); styleEl.textContent = css.join(''); document.head.appendChild(styleEl);

  function card(title, inner) {
    var wrap = el('div');
    wrap.appendChild(el('div', 'set-h', '// ' + title));
    wrap.appendChild(inner);
    var c = Z.card({ body: wrap }).el; body.appendChild(c); return c;
  }

  /* --------------------- COMMAND LOG (all tx/rx) ------------------------- */
  // Every command sent to zwire-host from ANY page/process, via the shared
  // ~/.zwire/hostlog.jsonl the host appends to. Chrome spawns a separate host
  // process per sendNativeMessage, so this shared file is the only place that
  // sees them all. Polls the `hostlog` command (itself excluded from the log).
  var clogStyle = el('style'); clogStyle.textContent = [
    '.zh-clog{height:min(42vh,440px);overflow:auto;background:var(--bg-primary,#05060a);',
    ' border:1px solid var(--border,#1a2233);border-radius:4px;padding:6px 8px;font:12px "Share Tech Mono",monospace;}',
    '.zh-clr{display:flex;gap:8px;padding:2px 0;border-bottom:1px solid rgba(255,255,255,.03);}',
    '.zh-clt{color:var(--text-muted,#5a6b82);opacity:.7;flex:0 0 auto;}',
    '.zh-cld{font-weight:700;flex:0 0 14px;}',
    '.zh-clr.tx .zh-cld{color:var(--cyan,#05d9e8);} .zh-clr.rx .zh-cld{color:#3fff9f;}',
    '.zh-clc{color:var(--accent,#ff2a6d);flex:0 0 90px;overflow:hidden;text-overflow:ellipsis;}',
    '.zh-clm{color:var(--text,#c8d2e0);flex:1 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
    '.zh-clog.hide-sys .zh-clr.sysrow{display:none;}',   // toggle: hide the high-frequency statusbar stream
    '.zh-clbar{display:flex;align-items:center;gap:10px;margin:2px 0 6px;}',
    '.zh-clbar .zh-sub{flex:1 1 auto;}'
  ].join(''); document.head.appendChild(clogStyle);
  var clogInner = el('div');
  var clbar = el('div', 'zh-clbar');
  clbar.appendChild(el('div', 'zh-sub', 'every command sent to zwire-host — ▶ tx (request) / ◀ rx (reply), from any page or process'));
  var clog = el('div', 'zh-clog hide-sys');   // statusbar (sysinfo) stream hidden by default
  if (ZGui.toggle) {
    var tgWrap = el('div'); tgWrap.style.cssText = 'display:flex;align-items:center;gap:6px;';
    tgWrap.appendChild(el('span', 'zh-sub', 'show sysinfo'));
    tgWrap.appendChild(ZGui.toggle({ checked: false, onChange: function (on) { clog.classList.toggle('hide-sys', !on); } }).el);
    clbar.appendChild(tgWrap);
  }
  clogInner.appendChild(clbar);
  clogInner.appendChild(clog);
  // NOTE: the card() call is deferred to the end of the file so COMMAND LOG
  // renders LAST (at the bottom of the page), below STATUS / LIVE / REPL.
  var clogKeys = new Set();
  function fmtTime(ms) { var d = new Date(ms || 0); function p(n) { return (n < 10 ? '0' : '') + n; } return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()); }
  function renderClog(entries) {
    if (!entries || !entries.length) return;
    var atBottom = clog.scrollHeight - clog.scrollTop - clog.clientHeight < 40;
    var frag = document.createDocumentFragment(), added = 0;
    entries.forEach(function (e) {
      var k = (e.t || 0) + '|' + (e.pid || 0) + '|' + (e.dir || '') + '|' + (e.cmd || '') + '|' + (e.msg || '');
      if (clogKeys.has(k)) return;
      clogKeys.add(k);
      var row = el('div', 'zh-clr ' + (e.dir === 'rx' ? 'rx' : 'tx') + (e.cmd === 'sysinfo' ? ' sysrow' : ''));
      row.appendChild(el('span', 'zh-clt', esc(fmtTime(e.t))));
      row.appendChild(el('span', 'zh-cld', e.dir === 'rx' ? '◀' : '▶'));
      row.appendChild(el('span', 'zh-clc', esc(e.cmd || '?')));
      row.appendChild(el('span', 'zh-clm', esc(e.msg || '')));
      frag.appendChild(row); added++;
    });
    if (added) { clog.appendChild(frag); if (atBottom) clog.scrollTop = clog.scrollHeight; }
    while (clog.children.length > 1200) clog.removeChild(clog.firstChild);
    if (clogKeys.size > 5000) clogKeys.clear();   // bounded; the ring file re-seeds the view
  }
  function pollClog() {
    // Route over the SAME persistent connectNative port the STATUS/REPL panes
    // use (proven channel); the reply comes back through onHostMsg (id zh-clog).
    try {
      if (!portOk && !connect()) return;
      port.postMessage({ cmd: 'hostlog', limit: 300, _nolog: true, id: 'zh-clog' });
    } catch (e) {}
  }
  setInterval(pollClog, 1200);
  setTimeout(pollClog, 300);   // first poll after the port has a moment to open

  /* ------------------------------ STATUS --------------------------------- */
  var statusInner = el('div');
  statusInner.appendChild(el('div', 'zh-status', '<span class="zh-dot" style="background:#ffcf4a"></span><span class="zh-sub">connecting…</span>'));
  card('STATUS', statusInner);
  function setStatus(html) { var s = statusInner.querySelector('.zh-status'); if (s) s.innerHTML = html; }
  function setStatusFromHello(m) {
    var caps = (m.caps || []).map(function (c) { return '<span class="zh-cap">' + esc(c) + '</span>'; }).join('');
    setStatus('<span class="zh-dot" style="background:#3fff9f"></span><b style="color:var(--cyan,#05d9e8)">connected</b>'
      + ' <span class="zh-sub">' + esc(m.host || 'zwire-host') + ' v' + esc(m.version || '?') + ' · ' + esc(m.os || '') + '/' + esc(m.arch || '') + ' · pid ' + esc(String(m.pid || '?')) + '</span>'
      + (caps ? '<div class="zh-caps">' + caps + '</div>' : ''));
  }

  /* --------------------------- LIVE STATUSBAR ---------------------------- */
  var liveInner = el('div', 'zh-live'); card('LIVE — statusbar stream (zb_sys)', liveInner);
  function fmtBytes(n) { n = +n || 0; var u = ['B', 'K', 'M', 'G', 'T']; var i = 0; while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; } return (n < 10 && i ? n.toFixed(1) : Math.round(n)) + u[i]; }
  function fmtDur(s) { s = +s || 0; var d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60); return (d ? d + 'd ' : '') + (h ? h + 'h ' : '') + m + 'm'; }
  function tile(label, val, sub, pct) {
    var t = el('div', 'zh-metric');
    t.appendChild(el('div', 'zh-mlabel', esc(label)));
    t.appendChild(el('div', 'zh-mval', val == null ? '—' : esc(String(val))));
    if (sub != null) t.appendChild(el('div', 'zh-msub', esc(sub)));
    if (pct != null) { var b = el('div', 'zh-bar'); b.appendChild(el('i', null)); b.firstChild.style.width = Math.max(0, Math.min(100, pct)) + '%'; t.appendChild(b); }
    return t;
  }
  function renderSys(s) {
    if (!s) { liveInner.innerHTML = '<span class="zh-sub">no statusbar data yet — the worker streams it every ~2s once a page is open</span>'; return; }
    var tiles = [];
    if (s.cpu != null) tiles.push(tile('CPU', s.cpu + '%', null, s.cpu));
    if (s.mem) tiles.push(tile('Memory', s.mem.p + '%', fmtBytes(s.mem.u) + ' / ' + fmtBytes(s.mem.t), s.mem.p));
    if (s.swap) tiles.push(tile('Swap', s.swap.p + '%', fmtBytes(s.swap.u) + ' / ' + fmtBytes(s.swap.t), s.swap.p));
    if (s.disk) tiles.push(tile('Disk', s.disk.p + '%', fmtBytes(s.disk.u) + ' / ' + fmtBytes(s.disk.t), s.disk.p));
    if (s.net) tiles.push(tile('Network', '↓' + fmtBytes(s.net.down) + '/s', '↑' + fmtBytes(s.net.up) + '/s'));
    if (s.io) tiles.push(tile('Disk I/O', '↓' + fmtBytes(s.io.r) + '/s', '↑' + fmtBytes(s.io.w) + '/s'));
    if (s.load) tiles.push(tile('Load', s.load[0], s.load.join('  '), null));
    if (s.temp != null) tiles.push(tile('Temp', s.temp + '°C', null, s.temp));
    if (s.batt) tiles.push(tile('Battery', s.batt.p + '%', s.batt.c ? 'charging' : 'on battery', s.batt.p));
    if (s.uptime != null) tiles.push(tile('Uptime', fmtDur(s.uptime), null, null));
    if (s.host) tiles.push(tile('Host', s.host, s.lip || '', null));
    liveInner.innerHTML = ''; tiles.forEach(function (t) { liveInner.appendChild(t); });
  }
  try { chrome.storage.local.get('zb_sys', function (o) { void chrome.runtime.lastError; renderSys(o && o.zb_sys); }); } catch (e) {}
  try { chrome.storage.onChanged.addListener(function (ch, area) { if (area === 'local' && ch.zb_sys) renderSys(ch.zb_sys.newValue); }); } catch (e) {}

  /* --------------------- REPL: catalog · editor · tree ------------------- */
  // The full zwire-host command surface (50+), one ready-to-edit JSON template
  // per command, grouped by subsystem. Click a chip to load it into the editor.
  var CATALOG = [
    ['handshake', ['{"cmd":"hello"}', '{"cmd":"ping"}', '{"cmd":"hostinfo"}', '{"cmd":"get"}']],
    ['key/value store', ['{"cmd":"kv_get","app":"zwire","key":"KEY"}', '{"cmd":"kv_set","app":"zwire","key":"KEY","value":123}',
      '{"cmd":"kv_merge","app":"zwire","key":"KEY","value":{"a":1}}', '{"cmd":"kv_del","app":"zwire","key":"KEY"}', '{"cmd":"kv_keys","app":"zwire"}']],
    ['filesystem', ['{"cmd":"fs_read","path":"~/.zshrc"}', '{"cmd":"fs_write","path":"/tmp/zw.txt","text":"hi"}',
      '{"cmd":"fs_append","path":"/tmp/zw.txt","text":"more\\n"}', '{"cmd":"fs_stat","path":"~"}',
      '{"cmd":"fs_list","path":"~","dirs_only":false}', '{"cmd":"fs_walk","path":"~","depth":2,"ext":"js"}',
      '{"cmd":"fs_mkdir","path":"/tmp/zwdir","recursive":true}', '{"cmd":"fs_rm","path":"/tmp/zwdir","recursive":true}']],
    ['file watchers · stream', ['{"cmd":"fs_watch","path":"/tmp"}', '{"cmd":"fs_tail","path":"/var/log/system.log"}',
      '{"cmd":"watch_list"}', '{"cmd":"watch_stop","key":"KEY"}']],
    ['subprocess', ['{"cmd":"exec","program":"uname","args":["-a"]}', '{"cmd":"exec","program":"sh","args":["-c","echo hi"],"cwd":"/tmp"}']],
    ['background jobs · stream', ['{"cmd":"job_start","program":"ping","args":["-c","3","1.1.1.1"],"label":"ping"}',
      '{"cmd":"job_poll","id":"JOB_ID"}', '{"cmd":"job_result","id":"JOB_ID"}', '{"cmd":"job_list"}']],
    ['processes', ['{"cmd":"ps","filter":"","limit":30}', '{"cmd":"which","program":"node"}', '{"cmd":"kill","pid":0,"signal":"TERM"}']],
    ['pub / sub bus · stream', ['{"cmd":"sub","topic":"my.topic"}', '{"cmd":"unsub","topic":"my.topic"}', '{"cmd":"pub","topic":"my.topic","data":{"x":1}}']],
    ['system stats · stream', ['{"cmd":"sysinfo_once"}', '{"cmd":"sysinfo_start","interval_ms":1000}', '{"cmd":"sysinfo_stop"}']],
    ['os integration', ['{"cmd":"open","target":"https://example.com"}', '{"cmd":"clipboard_get"}',
      '{"cmd":"clipboard_set","text":"copied by zwire-host"}', '{"cmd":"notify","title":"zwire","body":"hello"}']],
    ['terminal · pty · stream', ['{"cmd":"pty_spawn"}', '{"cmd":"pty_write","data":"ls\\n"}', '{"cmd":"pty_resize","cols":80,"rows":24}', '{"cmd":"pty_kill"}']],
    ['peering', ['{"cmd":"peers"}', '{"cmd":"peer_connect","addr":"127.0.0.1:9999"}', '{"cmd":"remote","peer":"127.0.0.1:9999","request":{"cmd":"hello"}}']],
    ['theme', ['{"scheme":"cyberpunk"}', '{"cmd":"sub","topic":"scheme"}']]
  ];

  var replInner = el('div', 'zh-repl');
  var catBox = el('div', 'zh-cat');
  CATALOG.forEach(function (group) {
    catBox.appendChild(el('div', 'zh-catlabel', esc(group[0])));
    var row = el('div', 'zh-chips');
    group[1].forEach(function (tpl) {
      var cmd = (tpl.match(/"cmd":"([a-z_]+)"/) || [, tpl.match(/"scheme"/) ? 'scheme' : tpl])[1];
      var b = el('span', 'zh-chip', esc(cmd)); b.title = tpl;
      b.addEventListener('click', function () { setEditor(pretty(tpl)); });   // load the template PRETTY-printed
      row.appendChild(b);
    });
    catBox.appendChild(row);
  });
  replInner.appendChild(catBox);

  // Full JSON editor (zgui-core codeEditor: line-gutter, Tab-indent, multi-line).
  var edHost = el('div', 'zh-ed'); replInner.appendChild(edHost);
  var editor = (Z.codeEditor && Z.codeEditor(edHost, { value: '{\n  "cmd": "hello"\n}' })) || null;
  // Pretty-print a JSON template; fall back to the raw string if it doesn't parse.
  function pretty(s) { try { return JSON.stringify(JSON.parse(s), null, 2); } catch (e) { return s; } }
  var taFallback = null;
  if (!editor) { taFallback = el('textarea', 'zh-in'); taFallback.value = '{"cmd":"hello"}'; edHost.appendChild(taFallback); }
  function getEditor() { return editor ? editor.get() : (taFallback ? taFallback.value : ''); }
  function setEditor(v) { if (editor) editor.set(v); else if (taFallback) taFallback.value = v; focusEditor(); }
  function focusEditor() { try { (edHost.querySelector('textarea') || edHost).focus(); } catch (e) {} }
  function formatEditor() { try { setEditor(JSON.stringify(JSON.parse(getEditor()), null, 2)); } catch (e) { logErr('invalid JSON: ' + e.message); } }
  edHost.addEventListener('keydown', function (e) { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); doSend(); } }, true);

  var btns = el('div', 'zh-btns');
  function mkBtn(label, mini, fn) { var b = Z.button ? Z.button({ label: label, variant: mini ? 'mini' : undefined, onClick: fn }) : el('button', null, label); if (!Z.button) b.addEventListener('click', fn); return b; }
  btns.appendChild(mkBtn('Send ▶  (⌘/Ctrl-Enter)', false, function () { doSend(); }));
  btns.appendChild(mkBtn('Format', true, formatEditor));
  btns.appendChild(mkBtn('Export ↓', true, exportLog));
  btns.appendChild(mkBtn('Clear log', true, function () { logEl.innerHTML = ''; logData = []; }));
  replInner.appendChild(btns);
  function exportLog() {
    if (!logData.length) { logErr('nothing to export yet'); return; }
    var blob = new Blob([JSON.stringify(logData, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var name = 'zwire-host-repl-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json';
    // saveAs:true → native Save As dialog: pick filename AND location.
    if (chrome.downloads && chrome.downloads.download) {
      chrome.downloads.download({ url: url, filename: name, saveAs: true }, function () {
        void chrome.runtime.lastError; setTimeout(function () { URL.revokeObjectURL(url); }, 8000);
      });
    } else {
      var a = el('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
    }
  }

  var logEl = el('div', 'zh-log'); replInner.appendChild(logEl);
  card('REPL — JSON in / JSON out', replInner);

  var logData = [];   // structured transcript for Export
  function stamp() { var d = new Date(); return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2) + ':' + ('0' + d.getSeconds()).slice(-2); }
  // Each message rendered as a collapsible JSON tree (zgui-core jsonView); newest
  // appended at the bottom, then scrolled into view so the latest is always shown.
  function logJson(kind, obj) {
    logData.push({ t: new Date().toISOString(), dir: kind, msg: obj });
    var arrow = kind === 'out' ? '▸' : kind === 'in' ? '◂' : '⚡';
    var entry = el('div', 'zh-entry ' + kind);
    var head = el('div', 'zh-ehead');
    head.appendChild(el('span', 'zh-ar', arrow));
    head.appendChild(el('span', 'zh-etime', stamp()));
    if (kind === 'out') { head.title = 'click to edit + resend'; head.style.cursor = 'pointer'; head.addEventListener('click', function () { setEditor(JSON.stringify(obj, null, 2)); }); }
    entry.appendChild(head);
    var treeHost = el('div', 'zh-tree');
    if (Z.jsonView) Z.jsonView(treeHost, obj, { collapseDepth: 2 }); else treeHost.textContent = JSON.stringify(obj);
    entry.appendChild(treeHost);
    logEl.appendChild(entry);
    if (curFilter) entry.style.display = logMatch(entry.textContent) ? '' : 'none';
    entry.scrollIntoView({ block: 'nearest' });            // keep the latest entry in view at the bottom
  }
  function logErr(text) { var e2 = el('div', 'zh-entry err'); e2.textContent = '✕ ' + text; logEl.appendChild(e2); logEl.scrollTop = logEl.scrollHeight; }
  function applyLogFilter() { Array.prototype.forEach.call(logEl.children, function (en) { en.style.display = logMatch(en.textContent) ? '' : 'none'; }); }

  // COMMAND LOG card, appended last so it sits at the BOTTOM of the page.
  card('COMMAND LOG', clogInner);

  /* --------------------------- native port ------------------------------- */
  var port = null, portOk = false, seq = 0;
  function connect() {
    if (portOk && port) return true;   // idempotent: the log poll may connect first
    try { port = chrome.runtime.connectNative(HOST); } catch (e) { setStatus('<span class="zh-dot" style="background:var(--accent,#ff2a6d)"></span><span class="zh-sub">unavailable — ' + esc(e.message) + '</span>'); return false; }
    portOk = true;
    port.onMessage.addListener(onHostMsg);
    port.onDisconnect.addListener(function () {
      void chrome.runtime.lastError; portOk = false; port = null;
      setStatus('<span class="zh-dot" style="background:var(--accent,#ff2a6d)"></span><span class="zh-sub">disconnected — ' + esc((chrome.runtime.lastError && chrome.runtime.lastError.message) || 'port closed') + ' (a new request reconnects)</span>');
    });
    try { port.postMessage({ cmd: 'hello', id: 'zh-hello' }); } catch (e) {}
    return true;
  }
  function onHostMsg(m) {
    if (m && m.id === 'zh-clog') { renderClog(m.log || []); return; }   // COMMAND LOG poll reply
    if (m && m.host === 'zwire-host') setStatusFromHello(m);
    if (m && m.sys) { renderSys(m.sys); return; }          // shown live above, kept out of the log
    if (m && m.id === 'zh-hello') return;                   // silent status probe
    logJson(m && m.id == null ? 'ev' : 'in', m);            // no id ⇒ a streamed/pushed event
  }
  function doSend() {
    var raw = (getEditor() || '').trim(); if (!raw) return;
    var obj; try { obj = JSON.parse(raw); } catch (e) { logErr('invalid JSON: ' + e.message); return; }
    if (obj && typeof obj === 'object' && obj.id == null) obj.id = 'r' + (++seq);
    if (!portOk && !connect()) { logErr('not connected'); return; }
    logJson('out', obj);
    try { port.postMessage(obj); } catch (e) { logErr(String(e)); }
  }

  connect();
  setTimeout(focusEditor, 60);
})();
