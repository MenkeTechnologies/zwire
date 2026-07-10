/* zwire — SHARED command-palette providers. ONE source of truth for the keyword
 * web-search registry + the user/default custom-command rows, consumed by BOTH
 * the global HUD palette (hud-internal/zpalette.js, worker-backed) and the New
 * Tab palette (newtab/palette.js, direct-chrome). Each consumer injects its own
 * backend adapter (open(url) / runCustom(entry,arg)); the item + ranking logic
 * lives here so the two palettes can't drift. Backend-agnostic: no chrome.* here.
 *
 * NOTE: this file is duplicated verbatim into newtab/ (like schemes.js). Edit the
 * hud-internal copy; keep newtab/palette-cmds.js identical. */
(function (root) {
  'use strict';

  // Keyword search (from zgo BUILTINS) + package registries. Each entry is
  // [aliases, label, urlTemplate]. Typing a keyword (even alone) surfaces that
  // destination FIRST: `crate`->crates.io, `crate serde`->crates.io/serde.
  var SEARCH = [
    [['g', 'google'], 'Google', 'https://www.google.com/search?q={q}'],
    [['ddg'], 'DuckDuckGo', 'https://duckduckgo.com/?q={q}'],
    [['gh', 'github'], 'GitHub', 'https://github.com/search?q={q}'],
    [['yt', 'youtube'], 'YouTube', 'https://www.youtube.com/results?search_query={q}'],
    [['mdn'], 'MDN', 'https://developer.mozilla.org/en-US/search?q={q}'],
    [['so', 'stackoverflow'], 'Stack Overflow', 'https://stackoverflow.com/search?q={q}'],
    [['wiki'], 'Wikipedia', 'https://en.wikipedia.org/w/index.php?search={q}'],
    [['maps'], 'Google Maps', 'https://www.google.com/maps/search/{q}'],
    // package registries
    [['crate', 'crates', 'cargo', 'rust'], 'crates.io', 'https://crates.io/search?q={q}'],
    [['npm', 'node'], 'npm', 'https://www.npmjs.com/search?q={q}'],
    [['pip', 'pypi', 'python'], 'PyPI', 'https://pypi.org/search/?q={q}'],
    [['gem', 'gems', 'ruby'], 'RubyGems', 'https://rubygems.org/search?query={q}'],
    [['go', 'golang'], 'pkg.go.dev', 'https://pkg.go.dev/search?q={q}'],
    [['hex', 'elixir'], 'Hex.pm', 'https://hex.pm/packages?search={q}'],
    [['brew', 'formula'], 'Homebrew', 'https://formulae.brew.sh/formula/{q}'],
    [['docker', 'hub'], 'Docker Hub', 'https://hub.docker.com/search?q={q}'],
    [['am', 'amazon', 'amzn', 'ama'], 'Amazon', 'https://www.amazon.com/s?k={q}'],
    [['reddit'], 'Reddit', 'https://www.reddit.com/search/?q={q}'],
    [['twitter', 'x'], 'X / Twitter', 'https://twitter.com/search?q={q}'],
    [['imdb'], 'IMDb', 'https://www.imdb.com/find/?q={q}'],
    [['maps'], 'Google Maps', 'https://www.google.com/maps/search/{q}']
  ];
  function slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]/g, ''); }

  // makeSearchProvider(open) -> provider(q). `open(url)` is the consumer's nav.
  function makeSearchProvider(open) {
    return function searchProvider(q) {
      if (!q) return [];
      var out = [];
      var sp = q.indexOf(' ');
      var kw = (sp > 0 ? q.slice(0, sp) : q).toLowerCase();
      var rest = sp > 0 ? q.slice(sp + 1).trim() : '';
      // exact alias first; else prefix-match an alias or the destination name, so
      // `git`->GitHub, `ama`->Amazon, `you`->YouTube, `cra`->crates.io — a known
      // destination beats a raw web search.
      var exact = SEARCH.filter(function (s) { return s[0].indexOf(kw) >= 0; })[0];
      var hit = exact;
      if (!hit && kw.length >= 2) {
        hit = SEARCH.filter(function (s) {
          return s[0].some(function (a) { return a.indexOf(kw) === 0; }) || slug(s[1]).indexOf(kw) === 0;
        })[0];
      }
      if (hit) {
        var url;
        if (rest) url = hit[2].replace('{q}', encodeURIComponent(rest));
        else { try { url = new URL(hit[2]).origin + '/'; } catch (e) { url = hit[2].replace('{q}', ''); } }
        out.push({ icon: '⌕', label: hit[1] + (rest ? ': ' + rest : ''), detail: rest ? 'search' : 'open', top: !!exact, run: function () { open(url); } });
        return out;   // exact keyword (am/gh/wa) pins to the very top; prefix stays strong
      }
      // url / domain? offer to open it directly.
      if (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(q) && q.indexOf(' ') < 0) {
        out.push({ icon: '↗', label: 'Open ' + q, detail: 'go to site', run: function () { open(/^https?:\/\//.test(q) ? q : 'https://' + q); } });
      }
      // generic web fallback (Alfred-style) — Google + DDG for the raw query.
      // fallback:true sinks these below any real command/tab/shortcut match.
      out.push({ icon: '⌕', label: 'Google: ' + q, detail: 'web search', fallback: true, run: function () { open('https://www.google.com/search?q=' + encodeURIComponent(q)); } });
      out.push({ icon: '⌕', label: 'DuckDuckGo: ' + q, detail: 'web search', fallback: true, run: function () { open('https://duckduckgo.com/?q=' + encodeURIComponent(q)); } });
      return out;
    };
  }

  var TYPE_LABEL = { url: 'open url', shell: 'shell', stryke: 'stryke', js: 'javascript', applescript: 'applescript', batch: 'batch', action: 'action', scheme: 'scheme', host: 'host' };
  function typeLabel(t) { return TYPE_LABEL[t] || 'custom'; }
  function isDefaultCmd(e) { return String((e && e.id) || '').indexOf('def-') === 0; }
  // A command is a chain of typed steps (steps[]) or a legacy single {type,value};
  // summarise it as "url → shell → scheme" for the palette sub-text.
  function stepsSummary(e, tl) {
    tl = tl || typeLabel;
    var st = (e && Array.isArray(e.steps)) ? e.steps : (e && e.type ? [{ type: e.type }] : []);
    if (!st.length) return 'custom';
    return st.map(function (s) { return tl(s.type); }).join(' → ');
  }

  // ctx: { runCustom(entry, arg), typeLabel?, isDefaultCmd? } — consumer supplies
  // runCustom (backend-specific: worker bus vs direct chrome.tabs).
  function ctxTypeLabel(ctx) { return (ctx && ctx.typeLabel) || typeLabel; }
  function ctxIsDefault(ctx) { return (ctx && ctx.isDefaultCmd) || isDefaultCmd; }

  // makeCustomItems(list, ctx) -> rows carrying `keyword` (scored) + `user` tier.
  function makeCustomItems(list, ctx) {
    var tl = ctxTypeLabel(ctx), isDef = ctxIsDefault(ctx), run = ctx.runCustom;
    return (list || []).map(function (e) {
      return { icon: e.icon || '✦', label: e.label, detail: e.detail || (e.keyword ? e.keyword + ' …' : stepsSummary(e, tl)),
        keyword: e.keyword || '', user: !isDef(e), run: function () { run(e, ''); } };
    });
  }

  // makeCustomProvider(getCache, ctx) -> provider(q). Exact keyword hit pins top.
  function makeCustomProvider(getCache, ctx) {
    var tl = ctxTypeLabel(ctx), isDef = ctxIsDefault(ctx), run = ctx.runCustom;
    return function customProvider(q) {
      if (!q) return [];
      var sp = q.indexOf(' ');
      var kw = (sp > 0 ? q.slice(0, sp) : q).toLowerCase();
      var rest = sp > 0 ? q.slice(sp + 1).trim() : '';
      // Only emit the arg-taking row (`arx 2312.001` -> "arXiv: 2312.001"). With NO
      // arg, the command's own registered row already surfaces (and ranks first via
      // its exact-keyword score), so a pinned provider row would just duplicate it.
      if (!rest) return [];
      var out = [];
      (getCache() || []).forEach(function (e) {
        if (e.keyword && e.keyword.toLowerCase() === kw) {
          out.push({ icon: e.icon || '✦', label: e.label + ': ' + rest, detail: e.detail || stepsSummary(e, tl), user: !isDef(e), top: true,
            run: function () { run(e, rest); } });
        }
      });
      return out;
    };
  }

  root.ZWIRE_PALETTE_CMDS = {
    SEARCH: SEARCH,
    slug: slug,
    typeLabel: typeLabel,
    stepsSummary: stepsSummary,
    isDefaultCmd: isDefaultCmd,
    makeSearchProvider: makeSearchProvider,
    makeCustomItems: makeCustomItems,
    makeCustomProvider: makeCustomProvider
  };
})(typeof window !== 'undefined' ? window : this);
