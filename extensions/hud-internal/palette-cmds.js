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

  // zpwrchrome pages — the sibling extension's tool surfaces (Downloads, Pass,
  // Userscripts, Host Console, …). Listed here so EVERY palette (the HUD content
  // script, the New Tab, and zpwrchrome's own pages) offers the same rows and
  // can't drift. Absolute chrome-extension:// URLs, so the consumer's open(url)
  // routes to them the same as any other destination. Backend-agnostic.
  // NOTE: the id is zpwrchrome's fixed key-derived id; parity assumes it stays
  // installed + enabled (a palette row to a disabled extension opens nothing).
  var ZPWR_ID = 'hpppdchpnphmiijdeanibpcadgknmaja';
  var ZPWR_BASE = 'chrome-extension://' + ZPWR_ID + '/scripts-manager/';
  var ZPWR_PAGES = [
    ['⚡', 'Dashboard', 'dashboard.html'],
    ['📥', 'Downloads', 'downloads.html'],
    ['📜', 'Userscripts', 'manager.html'],
    ['🔑', 'Pass', 'pass.html'],
    ['🔌', 'Host Console', 'host.html'],
    ['🔍', 'Find in All Tabs', 'find-all.html'],
    ['📖', 'Reader Mode', 'reader-mode.html'],
    ['🌙', 'Lights Off', 'lights-off.html'],
    ['🎨', 'Cyberpunk Theme', 'theme-injector.html'],
    ['🧬', 'ModHeader', 'modheader.html'],
    ['🕵', 'User-Agent Switcher', 'ua-switcher.html'],
    ['⚙', 'Download Settings', 'dl-settings.html'],
    ['⚖', 'Download Rules', 'dl-rules.html'],
    ['🧯', 'Extension Filter', 'dl-extfilter.html'],
    ['⌨', 'Post-Download Commands', 'dl-postcommands.html'],
    ['🖥', 'Download Interface', 'dl-interface.html'],
    ['⚠', 'Diagnostics', 'dl-diag.html'],
    ['❔', 'Help', 'dl-help.html'],
    ['ℹ', 'About', 'dl-about.html']
  ];
  // makeZpwrItems(open) -> palette rows; `open(url)` is the consumer's nav adapter.
  function makeZpwrItems(open) {
    return ZPWR_PAGES.map(function (p) {
      var url = ZPWR_BASE + p[2];
      return { icon: p[0], label: 'zpwrchrome: ' + p[1], detail: p[2], run: function () { open(url); } };
    });
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

  /* ==== inline compute (ported from zgo-core) ================================
   * The zgo launcher answers a typed sum / conversion inline as the top row
   * (Alfred/Raycast "type a sum, get the answer"). These are faithful JS ports
   * of the zgo-core engines — calc.rs (recursive-descent arithmetic), units.rs
   * (dimensional conversion), numfmt.rs (percentage), currency.rs (cross-rate
   * over a live rate table). Plus the stryke `@`-prefix: `@ <code>` runs stryke
   * through the host bridge. Pure/offline except currency, whose rate table is
   * fetched+cached by the host (the same split zgo uses: host fetches, engine
   * does the math). All backend-agnostic — the consumer injects copy/run/rates. */

  // ---- calc.rs port: recursive-descent f64 evaluator ----------------------
  // Returns a real Error (constructor returns an object, so `new CalcErr(x)`
  // yields it) — callers `throw new CalcErr(...)` and catch a proper Error.
  function CalcErr(m) { return new Error(m); }
  function Calc(input, vars) { this.c = Array.from(input); this.i = 0; this.vars = vars || {}; }
  Calc.prototype.ws = function () { while (this.i < this.c.length && /\s/.test(this.c[this.i])) this.i++; };
  Calc.prototype.pk = function () { return this.i < this.c.length ? this.c[this.i] : null; };
  Calc.prototype.expr = function () {
    var acc = this.term();
    for (;;) { this.ws(); var c = this.pk();
      if (c === '+') { this.i++; acc += this.term(); }
      else if (c === '-') { this.i++; acc -= this.term(); }
      else return acc; }
  };
  Calc.prototype.term = function () {
    var acc = this.power();
    for (;;) { this.ws(); var c = this.pk();
      if (c === '*') { this.i++; acc *= this.power(); }
      else if (c === '/') { this.i++; var r = this.power(); if (r === 0) throw new CalcErr('division by zero'); acc /= r; }
      else if (c === '%') { this.i++; var m = this.power(); if (m === 0) throw new CalcErr('modulo by zero'); acc %= m; }
      else return acc; }
  };
  Calc.prototype.power = function () {
    var base = this.unary(); this.ws();
    if (this.pk() === '^') { this.i++; return Math.pow(base, this.power()); }   // right-associative
    return base;
  };
  Calc.prototype.unary = function () {
    this.ws(); var c = this.pk();
    if (c === '-') { this.i++; return -this.unary(); }
    if (c === '+') { this.i++; return this.unary(); }
    return this.atom();
  };
  Calc.prototype.atom = function () {
    this.ws(); var c = this.pk();
    if (c === '(') { this.i++; var v = this.expr(); this.ws(); if (this.pk() !== ')') throw new CalcErr('expected `)`'); this.i++; return v; }
    if (c !== null && (/[0-9]/.test(c) || c === '.')) return this.number();
    if (c !== null && /[a-zA-Z]/.test(c)) return this.ident();
    throw new CalcErr(c === null ? 'unexpected end of expression' : 'unexpected character `' + c + '`');
  };
  Calc.prototype.number = function () {
    var s = this.i;
    while (this.i < this.c.length && (/[0-9]/.test(this.c[this.i]) || this.c[this.i] === '.')) this.i++;
    if (this.pk() === 'e' || this.pk() === 'E') { this.i++;
      if (this.pk() === '+' || this.pk() === '-') this.i++;
      while (this.i < this.c.length && /[0-9]/.test(this.c[this.i])) this.i++; }
    var lit = this.c.slice(s, this.i).join(''); var v = parseFloat(lit);
    if (isNaN(v)) throw new CalcErr('invalid number `' + lit + '`');
    return v;
  };
  var CALC_FNS = {
    sqrt: Math.sqrt, cbrt: Math.cbrt, abs: Math.abs, ceil: Math.ceil, floor: Math.floor, round: Math.round,
    ln: Math.log, log: Math.log10, log10: Math.log10, log2: Math.log2, exp: Math.exp, sin: Math.sin, cos: Math.cos, tan: Math.tan
  };
  Calc.prototype.ident = function () {
    var s = this.i;
    while (this.i < this.c.length && /[a-zA-Z0-9]/.test(this.c[this.i])) this.i++;
    var name = this.c.slice(s, this.i).join(''); this.ws();
    if (this.pk() === '(') { this.i++; var arg = this.expr(); this.ws();
      if (this.pk() !== ')') throw new CalcErr('expected `)` after function argument'); this.i++;
      var fn = CALC_FNS[name]; if (!fn) throw new CalcErr('unknown function `' + name + '`'); return fn(arg); }
    if (name === 'pi') return Math.PI;
    if (name === 'e') return Math.E;
    if (Object.prototype.hasOwnProperty.call(this.vars, name)) return this.vars[name];
    throw new CalcErr('unknown identifier `' + name + '`');
  };
  function calcEval(input, vars) {
    var p = new Calc(input, vars); var v = p.expr(); p.ws();
    if (p.i !== p.c.length) throw new CalcErr('unexpected trailing input');
    if (!isFinite(v)) throw new CalcErr('result is not finite');
    return v;
  }
  // format_result: integers drop the decimal; else 10 sig-frac digits, zeros trimmed.
  function fmtNum(v) {
    if (v === Math.trunc(v) && Math.abs(v) < 1e15) return String(v);
    var s = v.toFixed(10);
    s = s.replace(/0+$/, '').replace(/\.$/, '');
    return s;
  }

  // ---- units.rs port: dimensional conversion ------------------------------
  // (canonical, dim, factor-to-base, [aliases…]). Temperature is affine.
  var UNIT_TABLE = [
    ['meters', 'len', 1.0, ['m', 'meter', 'metre', 'metres']],
    ['kilometers', 'len', 1000.0, ['km', 'kilometer', 'kilometre']],
    ['centimeters', 'len', 0.01, ['cm', 'centimeter']],
    ['millimeters', 'len', 0.001, ['mm', 'millimeter']],
    ['miles', 'len', 1609.344, ['mi', 'mile']],
    ['yards', 'len', 0.9144, ['yd', 'yard']],
    ['feet', 'len', 0.3048, ['ft', 'foot']],
    ['inches', 'len', 0.0254, ['in', 'inch']],
    ['nauticalmiles', 'len', 1852.0, ['nmi', 'nauticalmile']],
    ['grams', 'mass', 1.0, ['g', 'gram']],
    ['kilograms', 'mass', 1000.0, ['kg', 'kilogram']],
    ['milligrams', 'mass', 0.001, ['mg', 'milligram']],
    ['pounds', 'mass', 453.59237, ['lb', 'lbs', 'pound']],
    ['ounces', 'mass', 28.349523125, ['oz', 'ounce']],
    ['tonnes', 'mass', 1000000.0, ['t', 'tonne', 'metricton']],
    ['stones', 'mass', 6350.29318, ['st', 'stone']],
    ['celsius', 'temp', 1.0, ['c', '°c', 'centigrade']],
    ['fahrenheit', 'temp', 1.0, ['f', '°f']],
    ['kelvin', 'temp', 1.0, ['k']],
    ['bytes', 'data', 1.0, ['b', 'byte']],
    ['kilobytes', 'data', 1000.0, ['kb']],
    ['megabytes', 'data', 1e6, ['mb']],
    ['gigabytes', 'data', 1e9, ['gb']],
    ['terabytes', 'data', 1e12, ['tb']],
    ['kibibytes', 'data', 1024.0, ['kib']],
    ['mebibytes', 'data', 1048576.0, ['mib']],
    ['gibibytes', 'data', 1073741824.0, ['gib']],
    ['bits', 'data', 0.125, ['bit']],
    ['seconds', 'time', 1.0, ['s', 'sec', 'second']],
    ['minutes', 'time', 60.0, ['min', 'minute']],
    ['hours', 'time', 3600.0, ['h', 'hr', 'hour']],
    ['days', 'time', 86400.0, ['d', 'day']],
    ['weeks', 'time', 604800.0, ['wk', 'week']],
    ['milliseconds', 'time', 0.001, ['ms', 'millisecond']],
    ['meterspersecond', 'speed', 1.0, ['mps', 'm/s']],
    ['kilometersperhour', 'speed', 0.2777777778, ['kmh', 'kph', 'km/h']],
    ['milesperhour', 'speed', 0.44704, ['mph']],
    ['knots', 'speed', 0.514444444, ['kn', 'knot']],
    ['degrees', 'angle', 1.0, ['deg', 'degree', '°']],
    ['radians', 'angle', 57.29577951308232, ['rad', 'radian']]
  ];
  function unitLookup(name) {
    var n = String(name).trim().toLowerCase();
    for (var i = 0; i < UNIT_TABLE.length; i++) {
      var r = UNIT_TABLE[i];
      if (n === r[0] || r[3].indexOf(n) >= 0) return { canonical: r[0], dim: r[1], factor: r[2] };
    }
    return null;
  }
  function convertTemp(v, from, to) {
    var c = from === 'fahrenheit' ? (v - 32) * 5 / 9 : (from === 'kelvin' ? v - 273.15 : v);
    if (to === 'fahrenheit') return c * 9 / 5 + 32;
    if (to === 'kelvin') return c + 273.15;
    return c;
  }
  function unitConvert(value, from, to) {
    var fu = unitLookup(from), tu = unitLookup(to);
    if (!fu) throw new CalcErr('unknown unit `' + from + '`');
    if (!tu) throw new CalcErr('unknown unit `' + to + '`');
    if (fu.dim !== tu.dim) throw new CalcErr('cannot convert `' + from + '` to `' + to + '`');
    var result = fu.dim === 'temp' ? convertTemp(value, fu.canonical, tu.canonical) : value * fu.factor / tu.factor;
    return { value: value, from: fu.canonical, to: tu.canonical, result: result };
  }
  function splitConnective(lower, seps) {
    for (var i = 0; i < seps.length; i++) { var idx = lower.indexOf(seps[i]); if (idx >= 0) return [lower.slice(0, idx), lower.slice(idx + seps[i].length)]; }
    return null;
  }
  // Same split but returns the connective's index/length so callers can slice the
  // ORIGINAL (case-preserving) string — currency codes stay upper-case like zgo.
  function splitConnectiveIdx(lower, seps) {
    for (var i = 0; i < seps.length; i++) { var idx = lower.indexOf(seps[i]); if (idx >= 0) return { i: idx, len: seps[i].length }; }
    return null;
  }
  function unitParseConvert(input) {
    var lower = String(input).trim().toLowerCase();
    var parts = splitConnective(lower, [' to ', ' in ', ' as ', '->', '>']);
    if (!parts) throw new CalcErr('expected `<n> <from> to <to>`');
    var lhs = parts[0].trim(), toUnit = parts[1].trim();
    var split = lhs.length;
    for (var i = 0; i < lhs.length; i++) { var ch = lhs[i];
      if (!(/[0-9]/.test(ch) || ch === '.' || ch === '-' || ch === '+' || ch === 'e')) { split = i; break; } }
    var numStr = lhs.slice(0, split), fromUnit = lhs.slice(split).trim(), value;
    if (numStr.trim() === '') { value = 1.0; fromUnit = lhs.trim(); }
    else { value = parseFloat(numStr.trim()); if (isNaN(value)) throw new CalcErr('bad number `' + numStr.trim() + '`'); }
    return unitConvert(value, fromUnit, toUnit);
  }

  // ---- numfmt.rs port: percentage calculator ------------------------------
  function pctNum(s) { var v = parseFloat(String(s).trim().replace(/%$/, '').replace(/,/g, '').trim()); return isNaN(v) ? null : v; }
  function percent(expr) {
    var s = String(expr).trim(), low = s.toLowerCase(), m;
    function ok(result, detail) { return { result: result, formatted: fmtNum(result), detail: detail }; }
    if ((m = low.split(' off ')).length === 2) {
      var pb = pctNum(m[0]), base0 = pctNum(m[1]); if (pb === null || base0 === null) return null;
      var r0 = base0 - base0 * pb / 100; return ok(r0, fmtNum(base0) + ' minus ' + fmtNum(pb) + '% = ' + fmtNum(r0));
    }
    if ((m = low.split(' of ')).length === 2) {
      var base1 = pctNum(m[1]); if (base1 === null) return null;
      if (/%\s*$/.test(m[0])) { var p1 = pctNum(m[0]); if (p1 === null) return null;
        var r1 = p1 / 100 * base1; return ok(r1, fmtNum(p1) + '% of ' + fmtNum(base1) + ' = ' + fmtNum(r1)); }
      var x = pctNum(m[0]); if (x === null || base1 === 0) return null;
      var r2 = x / base1 * 100; return ok(r2, fmtNum(x) + ' is ' + fmtNum(r2) + '% of ' + fmtNum(base1));
    }
    if ((m = low.split(' to ')).length === 2) {
      var from = pctNum(m[0]), to = pctNum(m[1]); if (from === null || to === null || from === 0) return null;
      var r3 = (to - from) / from * 100; return ok(r3, fmtNum(from) + ' → ' + fmtNum(to) + ' is a ' + (r3 >= 0 ? '+' : '') + fmtNum(r3) + '% change');
    }
    if (low.indexOf('%') >= 0) {
      var plus = low.indexOf('+');
      if (plus > 0) { var b2 = pctNum(low.slice(0, plus)), a2 = pctNum(low.slice(plus + 1)); if (b2 === null || a2 === null) return null;
        var r4 = b2 + b2 * a2 / 100; return ok(r4, fmtNum(b2) + ' + ' + fmtNum(a2) + '% = ' + fmtNum(r4)); }
      var minus = low.slice(1).indexOf('-'); if (minus >= 0) { minus += 1;
        var b3 = pctNum(low.slice(0, minus)), a3 = pctNum(low.slice(minus + 1)); if (b3 === null || a3 === null) return null;
        var r5 = b3 - b3 * a3 / 100; return ok(r5, fmtNum(b3) + ' - ' + fmtNum(a3) + '% = ' + fmtNum(r5)); }
    }
    return null;
  }

  // ---- currency.rs port: cross-rate over a live rate table ----------------
  // Rates are "units per base" (base USD=1); from->to = amount/rate[from]*rate[to].
  // The host fetches + caches the table (open.er-api.com); the consumer primes it.
  var RATES = {};        // { CODE: unitsPerBase }
  var RATES_TS = 0;      // last fetch epoch ms (0 = never loaded)
  function primeRates(getRates, refresh) {
    if (typeof getRates !== 'function') return;
    try {
      getRates(function (data) {
        if (data && data.rates && typeof data.rates === 'object') { RATES = data.rates; RATES_TS = data.ts || 1; if (typeof refresh === 'function') try { refresh(); } catch (e) {} }
      });
    } catch (e) {}
  }
  function currencyConvert(amount, from, to) {
    from = String(from).trim().toUpperCase(); to = String(to).trim().toUpperCase();
    var rf = RATES[from], rt = RATES[to];
    if (rf == null) throw new CalcErr('no rate for `' + from + '`');
    if (rt == null) throw new CalcErr('no rate for `' + to + '`');
    if (rf === 0) throw new CalcErr('rate for ' + from + ' is zero');
    var cross = rt / rf;
    return { amount: amount, from: from, to: to, result: amount * cross, rate: cross };
  }
  function currencyParse(q) {
    q = String(q);
    var at = splitConnectiveIdx(q.toLowerCase(), [' to ', ' in ', ' into ', '>']);
    if (!at) return null;
    var lt = q.slice(0, at.i).trim().split(/\s+/), rt = q.slice(at.i + at.len).trim().split(/\s+/);
    if (lt.length < 2 || !rt[0]) return null;
    var amount = parseFloat(lt[0]); if (isNaN(amount)) return null;
    return { amount: amount, from: lt[1], to: rt[0] };
  }

  // ---- inline stryke: `@ <code>` live-evaluates like zgo's launcher ---------
  // The result is async (host round-trip), so — like currency rates — we cache
  // the stdout per code and re-render (ctx.refresh) when it lands. Enter copies.
  var strykeCache = {}, strykeInflight = {}, strykePending = 0, strykePendingCode = '';
  function kickStryke(code, ctx) {
    if (strykeCache[code] || strykeInflight[code] || !ctx.evalStryke) return;
    if (strykePendingCode === code) return;   // already scheduled this exact code
    strykePendingCode = code;
    if (strykePending) { try { clearTimeout(strykePending); } catch (e) {} }
    // Debounce keystrokes: only the code the user pauses on actually evaluates.
    strykePending = setTimeout(function () {
      strykePendingCode = '';
      if (strykeCache[code] || strykeInflight[code]) return;
      strykeInflight[code] = true;
      ctx.evalStryke(code, function (res) {
        strykeInflight[code] = false;
        strykeCache[code] = res || { out: '' };
        if (Object.keys(strykeCache).length > 200) strykeCache = {};   // bound growth
        try { if (ctx.refresh) ctx.refresh(); } catch (e) {}
      });
    }, 200);
  }

  // ---- the shared compute provider ----------------------------------------
  // ctx: { copy(text), toast(text,bad?), evalStryke(code,cb), refresh() }.
  var CALC_HINT = /[-+*/%^()]|\b(sqrt|cbrt|abs|ceil|floor|round|ln|log|log2|log10|exp|sin|cos|tan|pi|e)\b/;
  function copyRow(ctx, icon, label, detail, value) {
    return { icon: icon, label: label, detail: detail, top: true, run: function () {
      try { if (ctx.copy) ctx.copy(value); } catch (e) {}
      try { if (ctx.toast) ctx.toast('copied ' + value); } catch (e) {}
    } };
  }
  function makeComputeProvider(ctx) {
    ctx = ctx || {};
    return function computeProvider(q) {
      q = (q || '').trim(); if (!q) return [];
      // 1) stryke `@`-prefix — live-evaluate inline through the host (zgo-style):
      // stdout becomes the row, ⏎ copies it. Kicks an async eval, shows the cached
      // result once it lands (ctx.refresh re-runs this provider).
      if (q.charAt(0) === '@') {
        var code = q.slice(1).trim(); if (!code) return [];
        if (!strykeCache[code]) kickStryke(code, ctx);   // may resolve synchronously under a fake clock (tests)
        var sres = strykeCache[code];
        if (sres) {
          if (sres.err) return [{ icon: 'ƛ', label: 'stryke: error', detail: '@ ' + code + ' · ' + sres.err, top: true, run: function () {} }];
          var sout = sres.out || '(no output)';
          return [copyRow(ctx, 'ƛ', sout, 'stryke · ' + code + '  (⏎ copies)', sres.out || '')];
        }
        return [{ icon: 'ƛ', label: '…', detail: 'stryke · ' + code + '  (evaluating)', top: true, run: function () {} }];
      }
      // 2) currency (needs a loaded rate table + both codes known).
      try {
        var cp = currencyParse(q);
        if (cp && RATES_TS && RATES[cp.from.toUpperCase()] != null && RATES[cp.to.toUpperCase()] != null) {
          var cc = currencyConvert(cp.amount, cp.from, cp.to);
          var cval = fmtNum(cc.result);
          return [copyRow(ctx, '💱', cval + ' ' + cc.to, fmtNum(cc.amount) + ' ' + cc.from + ' · copy ⏎', cval)];
        }
      } catch (e) {}
      // 3) unit conversion.
      try {
        var u = unitParseConvert(q); var uval = fmtNum(u.result);
        return [copyRow(ctx, '⇄', uval + ' ' + u.to, fmtNum(u.value) + ' ' + u.from + ' · copy ⏎', uval)];
      } catch (e) {}
      // 4) percentage.
      try { var pr = percent(q); if (pr) return [copyRow(ctx, '％', '= ' + pr.formatted, pr.detail + ' · copy ⏎', pr.formatted)]; } catch (e) {}
      // 5) plain arithmetic (only when it looks like a sum, not a bare word/number).
      if (CALC_HINT.test(q)) { try { var v = calcEval(q); var cvs = fmtNum(v); return [copyRow(ctx, '=', '= ' + cvs, q + ' · copy ⏎', cvs)]; } catch (e) {} }
      return [];
    };
  }

  /* ==== tab-query engine ====================================================
   * A `tabs:` / `tab:` prefix turns the palette input into a BOOLEAN QUERY over
   * every open tab, with one-key BULK operations on the matches (close / reload /
   * focus). Bare words substring-match title+url; field predicates
   * (host:/url:/title:/older:/newer:) and flags (dup/audible/muted/discarded/
   * pinned/active/loading/http/https) refine it; AND (implicit) / OR / NOT (or a
   * leading -/! ) compose them. The matcher is PURE — the consumer injects the live
   * tab list and the focus/close/reload adapters (direct chrome.tabs on the New Tab
   * page; the worker action bus on a web page). Backend-agnostic: no chrome.* here.
   * No browser's command bar exposes a boolean tab-query language driving bulk tab
   * mutations — this is the first. */
  function tabHost(u) { try { return new URL(u).host.toLowerCase(); } catch (e) { return ''; } }
  function normUrl(u) { return String(u || '').replace(/#.*$/, '').replace(/\/+$/, '').toLowerCase(); }
  var TAB_FLAGS = { dup: 1, audible: 1, playing: 1, muted: 1, discarded: 1, asleep: 1, pinned: 1, active: 1, loading: 1, http: 1, https: 1 };
  function parsePred(t) {
    var i = t.indexOf(':');
    if (i > 0) return { field: t.slice(0, i).toLowerCase(), val: t.slice(i + 1).toLowerCase() };
    var low = t.toLowerCase();
    if (TAB_FLAGS[low]) return { flag: low };
    return { text: low };
  }
  // parseTabQuery(q) -> { body, clauses } when q carries the tab sigil, else null.
  // clauses is an OR-list of AND-lists of { neg, pred }.
  function parseTabQuery(q) {
    var m = /^tabs?:\s*([\s\S]*)$/i.exec(String(q || ''));
    if (!m) return null;
    var body = m[1].trim();
    var toks = body ? body.split(/\s+/) : [];
    var clauses = [[]], neg = false;
    toks.forEach(function (tk) {
      var up = tk.toUpperCase();
      if (up === 'OR' || tk === '||') { clauses.push([]); neg = false; return; }
      if (up === 'AND' || tk === '&&') { return; }                 // implicit AND anyway
      if (up === 'NOT') { neg = true; return; }
      var t = tk, localNeg = neg; neg = false;
      while (t && (t.charAt(0) === '-' || t.charAt(0) === '!')) { localNeg = !localNeg; t = t.slice(1); }
      if (!t) return;
      clauses[clauses.length - 1].push({ neg: localNeg, pred: parsePred(t) });
    });
    return { body: body, clauses: clauses };
  }
  // evalPred(pred, tab, ctx) -> bool. ctx = { now, dup } (dup: set of duplicate URLs).
  function evalPred(p, tab, ctx) {
    if (p.text != null) return ((tab.title || '') + ' ' + (tab.url || '')).toLowerCase().indexOf(p.text) >= 0;
    if (p.flag != null) {
      switch (p.flag) {
        case 'dup': return !!ctx.dup[normUrl(tab.url)];
        case 'audible': case 'playing': return !!tab.audible;
        case 'muted': return !!(tab.mutedInfo && tab.mutedInfo.muted);
        case 'discarded': case 'asleep': return !!tab.discarded;
        case 'pinned': return !!tab.pinned;
        case 'active': return !!tab.active;
        case 'loading': return tab.status === 'loading';
        case 'http': return /^http:\/\//i.test(tab.url || '');
        case 'https': return /^https:\/\//i.test(tab.url || '');
      }
      return false;
    }
    switch (p.field) {
      case 'host': case 'by': case 'site': case 'domain': return tabHost(tab.url).indexOf(p.val) >= 0;
      case 'url': return String(tab.url || '').toLowerCase().indexOf(p.val) >= 0;
      case 'title': return String(tab.title || '').toLowerCase().indexOf(p.val) >= 0;
      case 'older': return (ctx.now - (tab.lastAccessed || 0)) / 60000 >= parseFloat(p.val || '0');
      case 'newer': return (ctx.now - (tab.lastAccessed || 0)) / 60000 < parseFloat(p.val || '0');
    }
    return false;                                                   // unknown field matches nothing (a typo can't select all)
  }
  function matchTab(tab, ast, ctx) {
    var clauses = (ast.clauses || []).filter(function (c) { return c.length; });
    if (!clauses.length) return true;                              // bare `tabs:` = every tab
    for (var i = 0; i < clauses.length; i++) {
      var cl = clauses[i], ok = true;
      for (var j = 0; j < cl.length; j++) {
        var r = evalPred(cl[j].pred, tab, ctx);
        if (cl[j].neg) r = !r;
        if (!r) { ok = false; break; }
      }
      if (ok) return true;                                         // any OR-clause satisfied
    }
    return false;
  }
  // filterTabs(tabs, ast, now) -> matching tabs (precomputes the duplicate-URL set).
  function filterTabs(tabs, ast, now) {
    tabs = tabs || [];
    var seen = {}, dup = {};
    tabs.forEach(function (t) { var k = normUrl(t.url); if (k) { if (seen[k]) dup[k] = 1; else seen[k] = 1; } });
    var ctx = { now: now || Date.now(), dup: dup };
    return tabs.filter(function (t) { return matchTab(t, ast, ctx); });
  }
  // makeTabQueryProvider(ctx) -> provider(q). ctx: { getTabs():tab[], focus(tab),
  // close(tabs[]), reload?(tabs[]), now?():ms }. Emits bulk-op rows (pinned top) +
  // bounded per-match focus rows.
  function makeTabQueryProvider(ctx) {
    ctx = ctx || {};
    return function tabQueryProvider(q) {
      var ast = parseTabQuery(q);
      if (!ast) return [];
      var tabs = (ctx.getTabs && ctx.getTabs()) || [];
      var now = (ctx.now && ctx.now()) || Date.now();
      var matches = filterTabs(tabs, ast, now);
      var n = matches.length, label = ast.body || 'all tabs', out = [];
      if (!n) return [{ icon: '▣', label: 'No tabs match', detail: 'tab query · ' + label, top: true, run: function () {} }];
      out.push({ icon: '⊗', label: 'Close ' + n + ' tab' + (n === 1 ? '' : 's'), detail: 'tab query · ' + label, top: true,
        run: function () { if (ctx.close) ctx.close(matches.slice()); } });
      if (ctx.reload) out.push({ icon: '↻', label: 'Reload ' + n + ' tab' + (n === 1 ? '' : 's'), detail: 'tab query · ' + label, top: true,
        run: function () { ctx.reload(matches.slice()); } });
      matches.slice(0, 12).forEach(function (t) {
        out.push({ icon: '▣', label: 'Focus: ' + (t.title || t.url || '(tab)'), detail: t.url, run: function () { if (ctx.focus) ctx.focus(t); } });
      });
      return out;
    };
  }

  /* ==== brace-expansion batch navigation ===================================
   * A faithful port of zsh/bash BRACE EXPANSION applied to the address layer:
   * type ONE URL pattern carrying `{a,b}` alternations and/or `{1..10}` /
   * `{a..e}` sequences (zero-padded, stepped, descending, nested, cartesian) and
   * the palette expands it into N destinations and opens the whole batch from a
   * single ⏎. `{01..12}` → 01…12, `{0..20..5}` → 0 5 10 15 20, `{a,b}{1,2}` →
   * a1 a2 b1 b2, `gh.com/{issues,pulls,wiki}` → three tabs. Pure/offline — the
   * consumer injects only open(url). No browser's address bar or command palette
   * expands a brace/sequence pattern into a batch tab-open — this is the first.
   * The engine (expandBraces) matches zsh semantics: comma takes precedence over
   * a range, an unbalanced / comma-less / rangeless `{…}` stays literal, and
   * `\{`/`\}` escape. */
  function unescapeBraces(s) { return String(s).replace(/\\([{},\\])/g, '$1'); }
  // splitTopLevel(body, sep) -> parts split on a depth-0 single-char `sep`,
  // respecting nested `{…}` and `\` escapes (empty parts preserved: `,b` -> ['','b']).
  function splitTopLevel(body, sep) {
    var parts = [], depth = 0, cur = '';
    for (var i = 0; i < body.length; i++) {
      var c = body.charAt(i);
      if (c === '\\') { cur += c + (body.charAt(i + 1) || ''); i++; continue; }
      if (c === '{') { depth++; cur += c; }
      else if (c === '}') { depth--; cur += c; }
      else if (c === sep && depth === 0) { parts.push(cur); cur = ''; }
      else cur += c;
    }
    parts.push(cur);
    return parts;
  }
  function hasTopLevelComma(body) { return splitTopLevel(body, ',').length > 1; }
  // fmtInt(n, pad) -> zero-padded integer string (pad=0 disables). Sign is kept
  // outside the padding, matching `{-1..1}` / `{01..10}` behaviour.
  function fmtInt(n, pad) {
    if (!pad) return String(n);
    var neg = n < 0, s = String(Math.abs(n));
    while (s.length < pad) s = '0' + s;
    return (neg ? '-' : '') + s;
  }
  // parseRange(body) -> string[] for `A..B` / `A..B..STEP` (numeric or single
  // char), else null. Descending when A>B; step is magnitude only (direction is
  // inferred). Numeric ranges zero-pad to the widest operand when either operand
  // is written with a leading zero (`{08..10}` -> 08 09 10).
  function parseRange(body) {
    var m = /^(-?\d+)\.\.(-?\d+)(?:\.\.(-?\d+))?$/.exec(body);
    if (m) {
      var a = parseInt(m[1], 10), b = parseInt(m[2], 10);
      var step = m[3] != null ? Math.abs(parseInt(m[3], 10)) : 1; if (!step) step = 1;
      var pad = 0;
      if (/^-?0\d/.test(m[1]) || /^-?0\d/.test(m[2])) pad = Math.max(m[1].replace('-', '').length, m[2].replace('-', '').length);
      var out = [], i;
      if (a <= b) { for (i = a; i <= b; i += step) out.push(fmtInt(i, pad)); }
      else { for (i = a; i >= b; i -= step) out.push(fmtInt(i, pad)); }
      return out;
    }
    // Single-char range. zsh does NOT expand a *stepped* char range (`{a..e..2}`
    // stays literal — only numeric ranges take a step), so no step group here.
    var c = /^([A-Za-z])\.\.([A-Za-z])$/.exec(body);
    if (c) {
      var ca = c[1].charCodeAt(0), cb = c[2].charCodeAt(0), cout = [], j;
      if (ca <= cb) { for (j = ca; j <= cb; j++) cout.push(String.fromCharCode(j)); }
      else { for (j = ca; j >= cb; j--) cout.push(String.fromCharCode(j)); }
      return cout;
    }
    return null;
  }
  // firstBraceSegment(str) -> { start, end } of the leftmost balanced `{…}` whose
  // body is a real expansion (top-level comma OR a valid range), else null. A `{`
  // that is unbalanced or holds no comma/range is literal and scanning continues.
  function firstBraceSegment(str) {
    for (var i = 0; i < str.length; i++) {
      var ch = str.charAt(i);
      if (ch === '\\') { i++; continue; }
      if (ch !== '{') continue;
      var depth = 0, k, close = -1;
      for (k = i; k < str.length; k++) {
        var c = str.charAt(k);
        if (c === '\\') { k++; continue; }
        if (c === '{') depth++;
        else if (c === '}') { depth--; if (depth === 0) { close = k; break; } }
      }
      if (close < 0) continue;                                       // unbalanced -> literal `{`
      var body = str.slice(i + 1, close);
      if (hasTopLevelComma(body) || parseRange(body) !== null) return { start: i, end: close };
    }
    return null;
  }
  // expandBraces(str) -> string[] (zsh-faithful). Recursively expands the leftmost
  // group, cartesian-combines with the expansion of the tail, and unescapes leaves.
  function expandBraces(str) {
    str = String(str);
    var seg = firstBraceSegment(str);
    if (!seg) return [unescapeBraces(str)];
    var pre = unescapeBraces(str.slice(0, seg.start));
    var body = str.slice(seg.start + 1, seg.end);
    var postExp = expandBraces(str.slice(seg.end + 1));
    var mids;
    if (hasTopLevelComma(body)) { mids = []; splitTopLevel(body, ',').forEach(function (p) { mids = mids.concat(expandBraces(p)); }); }
    else mids = parseRange(body);                                    // guaranteed non-null by firstBraceSegment
    var out = [];
    for (var i = 0; i < mids.length; i++) { for (var j = 0; j < postExp.length; j++) out.push(pre + mids[i] + postExp[j]); }
    return out;
  }
  // A token is a batch-nav destination when it carries a scheme or a dotted host.
  function braceNavigable(t) { return /^https?:\/\//i.test(t) || /^([a-z0-9-]+\.)+[a-z]{2,}(?:[/:?#]|$)/i.test(t); }
  function braceUrl(t) { return /^https?:\/\//i.test(t) ? t : 'https://' + t; }
  // makeBraceProvider(ctx) -> provider(q). ctx: { open(url), openMany?(urls) }.
  // Fires only when the input has a brace group, no whitespace (URLs never do),
  // expands to >=2 tokens, and EVERY token is a navigable URL — so it can't hijack
  // prose or a plain `{a,b}` word list. Emits a pinned "Open N tabs" batch row plus
  // bounded per-URL open rows. openMany defaults to looping open().
  function makeBraceProvider(ctx) {
    ctx = ctx || {};
    var open = ctx.open || function () {};
    var openMany = ctx.openMany || function (urls) { urls.forEach(function (u) { open(u); }); };
    return function braceProvider(q) {
      q = (q || '').trim();
      if (!q || q.indexOf('{') < 0 || /\s/.test(q)) return [];
      var toks = expandBraces(q);
      if (toks.length < 2 || !toks.every(braceNavigable)) return [];
      var seen = {}, urls = [];
      toks.forEach(function (t) { var u = braceUrl(t); if (!seen[u]) { seen[u] = 1; urls.push(u); } });
      if (urls.length < 2) return [];
      var n = urls.length;
      var out = [{ icon: '⧉', label: 'Open ' + n + ' tabs', detail: 'brace expand · ' + q, top: true, run: function () { openMany(urls.slice()); } }];
      urls.slice(0, 12).forEach(function (u) { out.push({ icon: '↗', label: u, detail: 'brace expand', run: function () { open(u); } }); });
      return out;
    };
  }

  /* ==== URL surgery mini-language ==========================================
   * A `url:` / `u:` prefix turns the palette into a REWRITE ENGINE over the
   * CURRENT tab's URL: a compact, space-separated op list transforms the live
   * href and one ⏎ re-navigates to the result. Ops apply left→right:
   *   s/pat/rep/[gi]  sed-style regex substitution on the whole URL — any single
   *                   non-word char after `s` is the delimiter, so `s|blob|edit|`
   *                   avoids escaping slashes; `\`+delim is a literal delim, other
   *                   escapes (\d, \.) pass through to the RegExp; `$1` backrefs work
   *   +k=v            set / override a query param (v is url-encoded); bare `+k` => k=
   *   -k              remove a query param
   *   -?  /  -*       strip ALL query params (declutter / drop trackers)
   *   #frag  /  -#    set / clear the fragment
   *   ^  (^^^ / ^3)   climb N path segments toward root  (/a/b/c + ^ => /a/b)
   *   @host           swap the hostname (keeps path + query + fragment)
   * Pure/offline — the consumer injects getUrl() + nav/open(url) (+ optional copy).
   * Distinct from brace-expansion (which GENERATES many URLs) and the tab query
   * (which FILTERS open tabs): this REWRITES one live URL. No browser's command bar
   * exposes an interactive URL-rewrite language over the current page — this is the
   * first (Firefox/Brave/Eraser-style strippers auto-remove a FIXED tracker list;
   * none take arbitrary substitution / path / host edits from a typed expression). */
  function surgeryUrl(href) { try { return new URL(href); } catch (e) { return null; } }
  // splitDelim(str, delim) -> fields split on an unescaped single-char `delim`.
  // `\`+delim collapses to a literal delim; any OTHER `\x` is preserved verbatim so
  // regex escapes (\d, \., \w) survive into the RegExp.
  function splitDelim(str, delim) {
    var fields = [], cur = '';
    for (var i = 0; i < str.length; i++) {
      var c = str.charAt(i);
      if (c === '\\' && i + 1 < str.length) {
        var nx = str.charAt(i + 1);
        if (nx === delim) cur += delim; else cur += c + nx;
        i++; continue;
      }
      if (c === delim) { fields.push(cur); cur = ''; continue; }
      cur += c;
    }
    fields.push(cur);
    return fields;
  }
  // applySub(href, op, delim) -> href with the sed substitution applied. Malformed
  // ops (bad regex, missing pattern) no-op rather than throwing.
  function applySub(href, op, delim) {
    var f = splitDelim(op.slice(2), delim);
    if (f.length < 2 || !f[0]) return href;
    var flags = (f[2] || '').replace(/[^gi]/g, '');
    var re; try { re = new RegExp(f[0], flags); } catch (e) { return href; }
    try { return href.replace(re, f[1]); } catch (e) { return href; }
  }
  function surgeryClimb(u, op) {
    var n = /^\^(\d+)$/.test(op) ? parseInt(op.slice(1), 10) : op.length;
    var segs = u.pathname.split('/').filter(Boolean);
    segs = segs.slice(0, Math.max(0, segs.length - n));
    u.pathname = '/' + segs.join('/');
  }
  function surgeryParam(u, kv) {
    if (!kv) return;
    var eq = kv.indexOf('=');
    var key = eq >= 0 ? kv.slice(0, eq) : kv;
    if (key) u.searchParams.set(key, eq >= 0 ? kv.slice(eq + 1) : '');
  }
  // urlSurgery(href, expr) -> rewritten href string (unchanged on a no-op expr).
  // Substitution edits the raw string; structured ops parse the current string into
  // a URL, mutate, and re-serialize (skipped if it isn't a valid absolute URL).
  function urlSurgery(href, expr) {
    var ops = String(expr || '').trim().split(/\s+/).filter(Boolean);
    var cur = String(href || '');
    for (var i = 0; i < ops.length; i++) {
      var op = ops[i];
      var sm = /^s([^\w\s])/.exec(op);
      if (sm) { cur = applySub(cur, op, sm[1]); continue; }
      var u = surgeryUrl(cur);
      if (!u) continue;
      if (op === '-?' || op === '-*') u.search = '';
      else if (op === '-#') u.hash = '';
      else if (/^\^+$/.test(op) || /^\^\d+$/.test(op)) surgeryClimb(u, op);
      else if (op.charAt(0) === '+') surgeryParam(u, op.slice(1));
      else if (op.charAt(0) === '-') u.searchParams.delete(op.slice(1));
      else if (op.charAt(0) === '#') u.hash = op;
      else if (op.charAt(0) === '@') { if (op.length > 1) try { u.host = op.slice(1); } catch (e) {} }
      else continue;                                                 // unknown op: ignore
      cur = u.href;
    }
    return cur;
  }
  // makeUrlSurgeryProvider(ctx) -> provider(q). ctx: { getUrl():string, nav?(url),
  // open?(url), copy?(text) }. Fires only on a `url:`/`u:` sigil. Top row re-navigates
  // the current tab (nav, falling back to open); optional new-tab + copy rows follow.
  function makeUrlSurgeryProvider(ctx) {
    ctx = ctx || {};
    var getUrl = ctx.getUrl || function () { return ''; };
    var nav = ctx.nav || ctx.open || function () {};
    var openNew = ctx.open;
    var copy = ctx.copy;
    return function urlSurgeryProvider(q) {
      var m = /^u(?:rl)?:\s*([\s\S]*)$/i.exec(String(q || ''));
      if (!m) return [];
      var expr = m[1].trim();
      var src = String(getUrl() || '');
      if (!surgeryUrl(src)) return [];                               // nothing to rewrite (e.g. New Tab surface)
      if (!expr) return [{ icon: '✂', label: src, detail: 'url surgery · s/…/…/  +k=v  -k  -?  ^  @host  #frag', top: true, run: function () {} }];
      var out = urlSurgery(src, expr);
      if (out === src) return [{ icon: '✂', label: 'No change', detail: 'url surgery · ' + expr, top: true, run: function () {} }];
      if (!surgeryUrl(out)) return [{ icon: '✂', label: 'Invalid result', detail: 'url surgery · ' + expr, top: true, run: function () {} }];
      var rows = [{ icon: '✂', label: out, detail: 'url surgery · rewrite here ⏎', top: true, run: function () { nav(out); } }];
      if (openNew && openNew !== nav) rows.push({ icon: '↗', label: 'New tab: ' + out, detail: 'url surgery', run: function () { openNew(out); } });
      if (copy) rows.push({ icon: '⧉', label: 'Copy: ' + out, detail: 'url surgery', run: function () { try { copy(out); } catch (e) {} } });
      return rows;
    };
  }

  root.ZWIRE_PALETTE_CMDS = {
    SEARCH: SEARCH,
    parseTabQuery: parseTabQuery,
    matchTab: matchTab,
    filterTabs: filterTabs,
    makeTabQueryProvider: makeTabQueryProvider,
    tabHost: tabHost,
    ZPWR_ID: ZPWR_ID,
    ZPWR_PAGES: ZPWR_PAGES,
    makeZpwrItems: makeZpwrItems,
    slug: slug,
    typeLabel: typeLabel,
    stepsSummary: stepsSummary,
    isDefaultCmd: isDefaultCmd,
    makeSearchProvider: makeSearchProvider,
    makeCustomItems: makeCustomItems,
    makeCustomProvider: makeCustomProvider,
    // inline compute (ported from zgo-core)
    calcEval: calcEval,
    fmtNum: fmtNum,
    unitConvert: unitConvert,
    unitParseConvert: unitParseConvert,
    percent: percent,
    currencyConvert: currencyConvert,
    currencyParse: currencyParse,
    primeRates: primeRates,
    makeComputeProvider: makeComputeProvider,
    // brace-expansion batch navigation
    expandBraces: expandBraces,
    makeBraceProvider: makeBraceProvider,
    // URL surgery mini-language
    urlSurgery: urlSurgery,
    makeUrlSurgeryProvider: makeUrlSurgeryProvider
  };
})(typeof window !== 'undefined' ? window : this);
