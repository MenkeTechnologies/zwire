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

  // ---- the shared compute provider ----------------------------------------
  // ctx: { copy(text), toast(text,bad?), runStryke(code), stamp() }.
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
      // 1) stryke `@`-prefix — run inline stryke through the host bridge.
      if (q.charAt(0) === '@') {
        var code = q.slice(1).trim(); if (!code) return [];
        return [{ icon: 'ƛ', label: 'stryke: ' + code, detail: 'run · ⏎', top: true,
          run: function () { try { if (ctx.runStryke) ctx.runStryke(code); } catch (e) {} } }];
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

  root.ZWIRE_PALETTE_CMDS = {
    SEARCH: SEARCH,
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
    makeComputeProvider: makeComputeProvider
  };
})(typeof window !== 'undefined' ? window : this);
