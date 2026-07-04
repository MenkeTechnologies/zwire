/* zbrowser HUD — hijack Cmd/Ctrl+F on any page and show our own fzf filter bar
 * instead of Chrome's native find. Substring find-in-page (all occurrences,
 * navigable) with an fzf fuzzy fallback when there's no substring hit — the
 * same fzf engine as the sibling apps. Highlighting uses the CSS Custom
 * Highlight API so we never mutate the page's DOM. Themed by the active scheme
 * (chrome.storage 'zb_scheme' bus, same as theme.js). */
(function () {
  'use strict';
  if (window.__zbFindLoaded) return;            // guard against double-inject
  window.__zbFindLoaded = true;

  var HUD = window.ZBROWSER_HUD || {};
  var SCHEMES = HUD.SCHEMES || {};
  var VAR_KEYS = HUD.VAR_KEYS || [];
  var FZ = window.ZBFzf;
  if (!('highlights' in CSS)) return;           // needs Custom Highlight API

  var bar, input, countEl, styleEl;
  var matches = [];                              // [{range}] navigable anchors
  var cur = -1;

  function schemeVars(cb) {
    try {
      chrome.storage.local.get('zb_scheme', function (o) {
        void chrome.runtime.lastError;
        var s = SCHEMES[(o && o.zb_scheme) || 'cyberpunk'] || SCHEMES.cyberpunk || { vars: {} };
        cb(s.vars || {});
      });
    } catch (e) { cb((SCHEMES.cyberpunk || { vars: {} }).vars || {}); }
  }

  // The canonical Audio-Haxor / zgui-core search-box CSS (search-box.css) plus
  // the fzf-hl highlight rule (zgui.css) — so this IS the haxor bar, verbatim.
  var HAXOR_CSS = [
    '.zfind-bar{position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:2147483647;',
    ' display:none;align-items:center;gap:8px;width:min(560px,90vw);padding:10px 12px;',
    ' background:var(--bg-primary);border:1px solid var(--border);border-radius:3px;',
    ' font-family:"Share Tech Mono",Monaco,monospace;box-shadow:0 0 26px var(--accent-glow,rgba(255,42,109,.4));}',
    '.zfind-bar.on{display:flex;}',
    /* zgui-core .zg-searchbox (Audio-Haxor .search-box) */
    '.zg-searchbox{position:relative;display:flex;align-items:center;flex:1;}',
    '.zg-searchbox-icon{position:absolute;left:12px;top:50%;transform:translateY(-50%);color:var(--cyan);font-size:14px;opacity:.6;pointer-events:none;z-index:1;}',
    '.zg-searchbox-input{width:100%;padding:9px 36px 9px 36px;border-radius:2px;',
    ' border:1px solid var(--border);background:var(--bg-secondary);color:var(--cyan);',
    ' font-family:inherit;font-size:13px;letter-spacing:.5px;outline:none;}',
    '.zg-searchbox-input:focus{border-color:var(--cyan);box-shadow:0 0 15px var(--cyan-glow),0 0 30px rgba(5,217,232,.08),inset 0 0 8px rgba(5,217,232,.05);}',
    '.zg-searchbox-input::placeholder{color:var(--text-muted,var(--text-dim));}',
    '.zg-searchbox-clear{position:absolute;right:8px;top:50%;transform:translateY(-50%);z-index:2;',
    ' background:transparent;border:none;color:var(--text-muted,var(--text-dim));font-size:12px;cursor:pointer;padding:2px 4px;}',
    '.zg-searchbox-clear:hover{color:var(--cyan);}',
    '.zfind-count{color:var(--cyan);font-size:12px;min-width:52px;text-align:center;letter-spacing:.5px;}',
    '.zfind-btn{background:var(--bg-secondary);border:1px solid var(--border);color:var(--text-muted,var(--text-dim));',
    ' cursor:pointer;font-family:inherit;font-size:13px;border-radius:2px;padding:5px 9px;line-height:1;}',
    '.zfind-btn:hover{border-color:var(--cyan);color:var(--cyan);}'
  ].join('');

  // hex (#rgb/#rrggbb) or rgb() -> rgba string with alpha
  function hexA(c, a) {
    c = String(c || '').trim();
    var m = c.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (m) {
      var h = m[1]; if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
      var n = parseInt(h, 16);
      return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
    }
    var r = c.match(/rgba?\(([^)]+)\)/);
    if (r) { var p = r[1].split(',').slice(0, 3).map(function (x) { return x.trim(); }); return 'rgba(' + p.join(',') + ',' + a + ')'; }
    return c;
  }

  function injectStyle(v) {
    if (!styleEl) { styleEl = document.createElement('style'); (document.head || document.documentElement).appendChild(styleEl); }
    // ::highlight can't read var() from page elements, so bake concrete scheme
    // colors: translucent cyan for matches, solid accent for the current one.
    var cyan = v['--cyan'] || '#05d9e8', accent = v['--accent'] || '#ff2a6d', bg = v['--bg-primary'] || '#0a0a12';
    styleEl.textContent = HAXOR_CSS +
      // haxor .fzf-hl look: theme-cyan text, underlined. Current match uses the
      // accent color (still underlined) so it stands out while navigating.
      '::highlight(zfind){color:' + cyan + ';text-decoration:underline;text-decoration-color:' + cyan + ';}' +
      '::highlight(zfind-cur){color:' + accent + ';text-decoration:underline;text-decoration-color:' + accent + ';background-color:' + hexA(accent, 0.16) + ';}';
    // Set the scheme vars on the bar so var(--cyan) etc. resolve to the scheme.
    if (bar) for (var i = 0; i < VAR_KEYS.length; i++) if (v[VAR_KEYS[i]]) bar.style.setProperty(VAR_KEYS[i], v[VAR_KEYS[i]]);
  }

  function buildBar() {
    bar = document.createElement('div');
    bar.className = 'zfind-bar';
    bar.innerHTML =
      '<div class="zg-searchbox">' +
        '<span class="zg-searchbox-icon">⌕</span>' +
        '<input class="zg-searchbox-input" type="text" spellcheck="false" placeholder="fzf filter…">' +
        '<button class="zg-searchbox-clear" data-clear="1" title="Clear">✕</button>' +
      '</div>' +
      '<span class="zfind-count">0/0</span>' +
      '<button class="zfind-btn" data-nav="-1" title="Prev (Shift+Enter)">↑</button>' +
      '<button class="zfind-btn" data-nav="1" title="Next (Enter)">↓</button>' +
      '<button class="zfind-btn" data-close="1" title="Close (Esc)">✕</button>';
    (document.body || document.documentElement).appendChild(bar);
    input = bar.querySelector('.zg-searchbox-input');
    countEl = bar.querySelector('.zfind-count');
    input.addEventListener('input', function () { run(input.value); });
    bar.querySelector('[data-clear]').addEventListener('click', function () { input.value = ''; run(''); input.focus(); });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); nav(e.shiftKey ? -1 : 1); }
      else if (e.key === 'Escape') { e.preventDefault(); close(); }
    });
    bar.querySelectorAll('[data-nav]').forEach(function (b) {
      b.addEventListener('click', function () { nav(parseInt(b.getAttribute('data-nav'), 10)); input.focus(); });
    });
    bar.querySelector('[data-close]').addEventListener('click', close);
  }

  function ensureStyle() {
    // Inject the bar CSS (position:fixed) SYNCHRONOUSLY so the bar is out of
    // normal flow before we focus it — otherwise focusing an in-flow bar
    // scrolls the page down to it (the "Cmd+F scrolls down" bug).
    if (!styleEl) { styleEl = document.createElement('style'); (document.head || document.documentElement).appendChild(styleEl); styleEl.textContent = HAXOR_CSS; }
  }
  function open() {
    if (!bar) buildBar();
    ensureStyle();                       // sync: fixed positioning before focus
    bar.classList.add('on');
    input.focus(); input.select();
    schemeVars(injectStyle);             // async: scheme colors + ::highlight
    if (input.value) run(input.value);
  }
  function close() {
    if (bar) bar.classList.remove('on');
    clearHi();
  }
  function clearHi() {
    try { CSS.highlights.delete('zfind'); CSS.highlights.delete('zfind-cur'); } catch (e) {}
    matches = []; cur = -1;
  }

  function textNodes() {
    var out = [], walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        if (!n.nodeValue || !n.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        var p = n.parentNode;
        if (!p) return NodeFilter.FILTER_REJECT;
        var tag = p.nodeName;
        if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT' || tag === 'TEXTAREA') return NodeFilter.FILTER_REJECT;
        if (p.closest && p.closest('.zfind-bar')) return NodeFilter.FILTER_REJECT;
        // skip hidden
        var el = p.nodeType === 1 ? p : p.parentElement;
        if (el) { var cs = getComputedStyle(el); if (cs.visibility === 'hidden' || cs.display === 'none') return NodeFilter.FILTER_REJECT; }
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    var n; while ((n = walker.nextNode())) { out.push(n); if (out.length > 6000) break; }
    return out;
  }

  var CAP = 2000;
  function run(q) {
    clearHi();
    q = (q || '').trim();
    if (!q) { count(); return; }
    var nodes = textNodes(), all = [], ql = q.toLowerCase();
    // 1) substring occurrences (what a find bar is expected to do)
    for (var i = 0; i < nodes.length && matches.length < CAP; i++) {
      var t = nodes[i].nodeValue, tl = t.toLowerCase(), from = 0, p;
      while ((p = tl.indexOf(ql, from)) !== -1) {
        var r = document.createRange();
        try { r.setStart(nodes[i], p); r.setEnd(nodes[i], p + q.length); } catch (e) { break; }
        all.push(r); matches.push({ range: r });
        from = p + q.length;
        if (matches.length >= CAP) break;
      }
    }
    // 2) fuzzy fallback (fzf) when nothing matched as a substring
    if (matches.length === 0 && q.length >= 2 && FZ) {
      for (var j = 0; j < nodes.length && matches.length < CAP; j++) {
        var txt = nodes[j].nodeValue;
        if (txt.length > 300) continue;                 // keep fuzzy spans tight
        var m = FZ.fzfMatch(q, txt);
        if (!m || !m.indices.length) continue;
        // one anchor range + a char-range per matched index (per-char highlight)
        var a = document.createRange();
        try { a.setStart(nodes[j], m.indices[0]); a.setEnd(nodes[j], m.indices[0] + 1); } catch (e) { continue; }
        matches.push({ range: a });
        for (var k = 0; k < m.indices.length; k++) {
          var cr = document.createRange();
          try { cr.setStart(nodes[j], m.indices[k]); cr.setEnd(nodes[j], m.indices[k] + 1); all.push(cr); } catch (e) {}
        }
      }
    }
    var hl = new Highlight();
    all.forEach(function (r) { hl.add(r); });
    try { CSS.highlights.set('zfind', hl); } catch (e) {}
    cur = matches.length ? 0 : -1;
    showCur();
  }

  function showCur() {
    try { CSS.highlights.delete('zfind-cur'); } catch (e) {}
    if (cur >= 0 && matches[cur]) {
      var h = new Highlight(); h.add(matches[cur].range);
      try { CSS.highlights.set('zfind-cur', h); } catch (e) {}
      var el = matches[cur].range.startContainer.parentElement;
      if (el && el.scrollIntoView) el.scrollIntoView({ block: 'center', inline: 'nearest' });
    }
    count();
  }
  function nav(d) {
    if (!matches.length) return;
    cur = (cur + d + matches.length) % matches.length;
    showCur();
  }
  function count() {
    if (countEl) countEl.textContent = (matches.length ? (cur + 1) : 0) + '/' + matches.length;
  }

  window.__zbFindOpen = open;                    // vim mode ('/') calls this

  document.addEventListener('keydown', function (e) {
    var isFind = (e.key === 'f' || e.key === 'F') && (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey;
    if (isFind) {
      e.preventDefault();                        // suppress Chrome's native find
      e.stopPropagation();
      open();
    } else if (e.key === 'Escape' && bar && bar.classList.contains('on')) {
      close();
    }
  }, true);
})();
