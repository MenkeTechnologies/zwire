/* zwire HUD — pane pipelines: the pure engine.
 *
 * A pane pipeline is a persisted, reactive dataflow EDGE between two tiled webviews:
 *
 *     source pane  --[ extract ]-->  [ filter ]  -->  sink pane
 *
 * It promotes the ztmux tiling overlay from a layout manager to a dataflow graph
 * (the browser-native analog of `curl … | jq | xargs`, where the stages are live
 * rendered pages). SOURCE extracts text from any pane whose URL matches (a CSS
 * selector's text, a regex over rendered text, the current selection, or the live
 * URL). FILTER transforms it (a stryke-style `|>` op chain, a JS expression, or a
 * passthrough). SINK delivers the result to any pane whose URL matches (navigate,
 * fill a field, replace/append a node, or batch-open).
 *
 * THIS FILE IS PURE: no DOM, no chrome.*, no window side effects beyond hanging the
 * API off a `window`-like global. Every decision the reactive runtime makes — what a
 * source emits, how a filter transforms it, whether an emission fires (cooldown /
 * once / dedupe), the sink message to post, and — critically — whether an edge would
 * close a cycle in the graph — is computed here so it can be unit-tested headlessly
 * and reused verbatim in the pane forwarder (ztmux-pane.js) and the top-frame relay
 * (ztmux-config.js). The runtime is a thin shell that calls runEdge() / wouldCycle().
 *
 * Consumers: ztmux-pane.js (extractSource + applySinkMessage), ztmux-config.js
 * (runEdge relay + wouldCycle guard), pages/pipes.js (validateEdge + wouldCycle),
 * tests/pipes.mjs. Storage key: chrome.storage.local 'zb_pipes' (array of edges). */
(function (root) {
  'use strict';

  // A per-emission hop budget: an edge chain (A→B, B→C, …) may traverse at most this
  // many hops before the runtime drops it. Even with the cycle check below rejecting
  // A→B→A at edge-creation, a long fan-out or a self-referential DOM write can still
  // re-arm an observer; the budget is the belt to the cycle check's suspenders.
  var HOP_BUDGET = 8;

  var SOURCE_KINDS = ['selector', 'regex', 'selection', 'url'];
  // 'app' is the one sink that does not end in a pane: it delivers into ANOTHER running
  // MenkeTechnologies app by calling a typed verb on its bus socket (zwire-host suite.rs).
  // A pipeline therefore reaches past the browser entirely — page text becomes an argument to
  // zcite/zreq/zpdf/… with the peer's own reply coming back as the dispatch result.
  var SINK_KINDS = ['navigate', 'fill', 'replace', 'append', 'batch', 'app'];
  var FILTER_KINDS = ['none', 'ops', 'js'];

  // Cap lines a source emits per flush (mirrors ztriggers MAX_SCAN_LINES intent) and
  // the length of any single line so a minified blob can't stall a transform.
  var MAX_LINES = 2000;
  var MAX_LINE_LEN = 4000;

  function str(v) { return v == null ? '' : String(v); }
  function isArr(v) { return Object.prototype.toString.call(v) === '[object Array]'; }
  function trim(s) { return str(s).replace(/^\s+|\s+$/g, ''); }

  /* ---------------------------------------------------------------- lines --- */
  // Split a text chunk into candidate lines: trimmed, non-empty, length-capped, and
  // count-capped. Identical semantics to ztriggers.linesOf so a pipeline source and a
  // trigger see page text the same way.
  function linesOf(text) {
    if (!text) return [];
    var out = [];
    var parts = str(text).split(/\r?\n/);
    for (var i = 0; i < parts.length && out.length < MAX_LINES; i++) {
      var s = trim(parts[i]);
      if (s && s.length <= MAX_LINE_LEN) out.push(s);
    }
    return out;
  }

  /* ------------------------------------------------------------- url match --- */
  // A pattern is a case-insensitive regex over the pane's live URL. Empty pattern =
  // matches every pane (an unfiltered source/sink). An invalid regex never matches
  // (fail closed) rather than throwing into the reactive loop.
  function matchUrl(pattern, url) {
    var p = trim(pattern);
    if (!p) return true;
    var re;
    try { re = new RegExp(p, 'i'); } catch (e) { return false; }
    return re.test(str(url));
  }

  /* ----------------------------------------------------------- normalize ---- */
  function normSource(s) {
    s = s || {};
    var kind = SOURCE_KINDS.indexOf(s.kind) >= 0 ? s.kind : 'selector';
    return {
      kind: kind,
      urls: str(s.urls),                 // source-pane URL filter (regex, '' = any)
      selector: str(s.selector),         // for kind 'selector'
      pattern: str(s.pattern),           // for kind 'regex'
      flags: str(s.flags || 'i')
    };
  }
  function normFilter(f) {
    f = f || {};
    var kind = FILTER_KINDS.indexOf(f.kind) >= 0 ? f.kind : 'none';
    return { kind: kind, value: str(f.value) };
  }
  function normSink(k) {
    k = k || {};
    var kind = SINK_KINDS.indexOf(k.kind) >= 0 ? k.kind : 'navigate';
    return {
      kind: kind,
      urls: str(k.urls),                 // sink-pane URL filter (regex, '' = any)
      selector: str(k.selector),         // for fill / replace / append
      sep: k.sep != null ? str(k.sep) : '\n',
      app: str(k.app),                   // for kind 'app': the peer's bus name (zcite, zreq, …)
      verb: str(k.verb),                 // for kind 'app': the verb to call on it
      // The JSON argument object, with {q} substituted by the delivered text. Empty means
      // "just the text", which is sent as { q: <text> } — the same placeholder every other
      // zwire chain step uses for its argument, so one habit covers all of them.
      args: str(k.args)
    };
  }
  function normalizeEdge(raw) {
    raw = raw || {};
    var cd = Number(raw.cooldownMs);
    return {
      id: str(raw.id),
      name: str(raw.name),
      enabled: raw.enabled !== false,
      source: normSource(raw.source),
      filter: normFilter(raw.filter),
      sink: normSink(raw.sink),
      cooldownMs: (isFinite(cd) && cd >= 0) ? cd : 1500,
      once: !!raw.once,
      dedupe: raw.dedupe !== false        // default on: don't re-fire on an unchanged value
    };
  }

  /* ------------------------------------------------------------- validate --- */
  function validateEdge(edge) {
    var e = normalizeEdge(edge);
    if (!trim(e.name)) return { ok: false, error: 'Name is required' };
    if (e.source.kind === 'selector' && !trim(e.source.selector)) return { ok: false, error: 'Selector source needs a CSS selector' };
    if (e.source.kind === 'regex') {
      if (!trim(e.source.pattern)) return { ok: false, error: 'Regex source needs a pattern' };
      try { new RegExp(e.source.pattern, normReFlags(e.source.flags)); } catch (x) { return { ok: false, error: 'Invalid source regex: ' + x.message }; }
    }
    if (e.source.urls) { try { new RegExp(e.source.urls, 'i'); } catch (x) { return { ok: false, error: 'Invalid source URL filter: ' + x.message }; } }
    if (e.sink.urls) { try { new RegExp(e.sink.urls, 'i'); } catch (x) { return { ok: false, error: 'Invalid sink URL filter: ' + x.message }; } }
    if ((e.sink.kind === 'fill' || e.sink.kind === 'replace' || e.sink.kind === 'append') && !trim(e.sink.selector)) {
      return { ok: false, error: e.sink.kind + ' sink needs a target selector' };
    }
    if (e.sink.kind === 'app') {
      if (!trim(e.sink.app)) return { ok: false, error: 'App sink needs a bus name (the app to call)' };
      if (!trim(e.sink.verb)) return { ok: false, error: 'App sink needs a verb' };
      // A bus name becomes a socket filename in the host; reject the separators here too so the
      // author sees it while editing rather than as a host error at 3am.
      if (/[\\/]|\.\./.test(e.sink.app)) return { ok: false, error: 'App sink: invalid bus name ' + e.sink.app };
      // Validated with {q} removed, exactly as the runtime substitutes it — a template that only
      // parses once the text is spliced in would save clean and fail on every emission.
      if (trim(e.sink.args)) {
        try { JSON.parse(str(e.sink.args).replace(/\{q\}/g, '')); }
        catch (x) { return { ok: false, error: 'App sink: args must be valid JSON (' + x.message + ')' }; }
      }
    }
    if (e.filter.kind === 'ops') { var pe = parseOps(e.filter.value); if (pe.error) return { ok: false, error: 'Filter: ' + pe.error }; }
    return { ok: true };
  }

  // Strip g/y from a source-regex flag string — a sticky/global .test() advances
  // lastIndex and would skip lines. Default case-insensitive (matches ztriggers).
  function normReFlags(f) { var out = str(f || 'i').replace(/[gy]/g, ''); return out || ''; }

  /* -------------------------------------------------------- extractSource --- */
  // Given a source spec and a resolved context, return the emitted lines. The caller
  // (pane forwarder) supplies the DOM-resolved pieces so this stays pure:
  //   ctx.text      element textContent for kind 'selector', or full page text
  //   ctx.selection current selection string for kind 'selection'
  //   ctx.url       the pane's live URL for kind 'url'
  function extractSource(source, ctx) {
    var s = normSource(source);
    ctx = ctx || {};
    if (s.kind === 'url') { var u = trim(ctx.url); return u ? [u] : []; }
    if (s.kind === 'selection') return linesOf(ctx.selection);
    if (s.kind === 'selector') return linesOf(ctx.text);
    // 'regex': test each line; emit capture group 1 when the pattern has one, else the line.
    var re;
    try { re = new RegExp(s.pattern, normReFlags(s.flags)); } catch (e) { return []; }
    var out = [];
    var lines = linesOf(ctx.text);
    for (var i = 0; i < lines.length; i++) {
      var m = re.exec(lines[i]);
      if (m) out.push(m.length > 1 && m[1] != null ? m[1] : m[0]);
    }
    return out;
  }

  /* ------------------------------------------------------------ ops filter --- */
  // A stryke-flavoured op chain: stages separated by `|>` (also newline). Each stage
  // is `verb arg`. Verbs operate on the working array of strings. Parsed once so an
  // invalid chain is a validation error, never a runtime throw.
  var ARG_OPS = { nth: 1, take: 1, drop: 1, join: 1, grep: 1, reject: 1, replace: 1, prepend: 1, append: 1 };
  var NOARG_OPS = { trim: 1, upper: 1, lower: 1, uniq: 1, sort: 1, reverse: 1, nonempty: 1, first: 1, last: 1, count: 1, collapse: 1 };

  function parseOps(spec) {
    var stages = str(spec).split(/\|>|\n/).map(trim).filter(Boolean);
    var out = [];
    for (var i = 0; i < stages.length; i++) {
      var st = stages[i];
      var sp = st.indexOf(' ');
      var verb = (sp < 0 ? st : st.slice(0, sp)).toLowerCase();
      var arg = sp < 0 ? '' : st.slice(sp + 1);
      if (NOARG_OPS[verb]) { out.push({ verb: verb, arg: '' }); continue; }
      if (ARG_OPS[verb]) {
        if (!trim(arg) && verb !== 'join' && verb !== 'prepend' && verb !== 'append') return { error: verb + ' needs an argument' };
        if (verb === 'grep' || verb === 'reject') { try { new RegExp(arg); } catch (e) { return { error: verb + ' regex: ' + e.message }; } }
        if (verb === 'replace') { var r = parseReplace(arg); if (r.error) return { error: r.error }; }
        out.push({ verb: verb, arg: arg });
        continue;
      }
      return { error: 'unknown op "' + verb + '"' };
    }
    return { ops: out };
  }

  // replace /pattern/replacement/flags — the leading delimiter is whatever the first
  // char is (usually '/'), so replacements may contain '/'. flags default to 'g'.
  function parseReplace(arg) {
    var s = str(arg);
    var d = s.charAt(0);
    if (!d) return { error: 'replace needs /pattern/replacement/' };
    var parts = [], cur = '', esc = false;
    for (var i = 1; i < s.length; i++) {
      var c = s.charAt(i);
      if (esc) { cur += (c === d || c === '\\') ? c : '\\' + c; esc = false; continue; }
      if (c === '\\') { esc = true; continue; }
      if (c === d) { parts.push(cur); cur = ''; if (parts.length === 2) { cur = s.slice(i + 1); break; } continue; }
      cur += c;
    }
    if (parts.length < 2) return { error: 'replace needs /pattern/replacement/' };
    var flags = trim(cur) || 'g';
    var re;
    try { re = new RegExp(parts[0], flags.replace(/[^gimsuy]/g, '')); } catch (e) { return { error: 'replace regex: ' + e.message }; }
    return { re: re, repl: parts[1] };
  }

  function applyOps(ops, values) {
    var a = values.slice();
    for (var i = 0; i < ops.length; i++) {
      var v = ops[i].verb, arg = ops[i].arg, out, j;
      switch (v) {
        case 'trim': a = a.map(trim); break;
        case 'upper': a = a.map(function (x) { return str(x).toUpperCase(); }); break;
        case 'lower': a = a.map(function (x) { return str(x).toLowerCase(); }); break;
        case 'nonempty': a = a.filter(function (x) { return trim(x) !== ''; }); break;
        case 'uniq': out = []; var seen = {}; for (j = 0; j < a.length; j++) { if (!Object.prototype.hasOwnProperty.call(seen, a[j])) { seen[a[j]] = 1; out.push(a[j]); } } a = out; break;
        case 'sort': a = a.slice().sort(); break;
        case 'reverse': a = a.slice().reverse(); break;
        case 'first': a = a.slice(0, 1); break;
        case 'last': a = a.length ? [a[a.length - 1]] : []; break;
        case 'count': a = [String(a.length)]; break;
        case 'collapse': a = [a.join(' ')]; break;
        case 'nth': j = parseInt(arg, 10); a = (isFinite(j) && a[j] != null) ? [a[j]] : []; break;
        case 'take': j = parseInt(arg, 10); a = a.slice(0, Math.max(0, j)); break;
        case 'drop': j = parseInt(arg, 10); a = a.slice(Math.max(0, j)); break;
        case 'join': a = [a.join(arg)]; break;
        case 'grep': var g = new RegExp(arg); a = a.filter(function (x) { return g.test(x); }); break;
        case 'reject': var rj = new RegExp(arg); a = a.filter(function (x) { return !rj.test(x); }); break;
        case 'replace': var pr = parseReplace(arg); a = a.map(function (x) { return str(x).replace(pr.re, pr.repl); }); break;
        case 'prepend': a = a.map(function (x) { return arg + x; }); break;
        case 'append': a = a.map(function (x) { return x + arg; }); break;
      }
    }
    return a;
  }

  /* --------------------------------------------------------------- filter --- */
  // Transform the emitted lines. Returns an array of strings (the sink decides how to
  // fold it). 'none' passes lines through; 'ops' runs the parsed chain; 'js' evaluates
  // an expression with `lines` (the array) and `text` (newline-joined) in scope, and
  // returns whatever it yields (array → lines, else String()).
  function applyFilter(filter, values) {
    var f = normFilter(filter);
    var arr = isArr(values) ? values : linesOf(values);
    if (f.kind === 'none' || !trim(f.value)) return arr;
    if (f.kind === 'ops') { var pe = parseOps(f.value); return pe.error ? arr : applyOps(pe.ops, arr); }
    // 'js'
    try {
      // eslint-disable-next-line no-new-func
      var fn = new Function('lines', 'text', 'return (' + f.value + ');');
      var r = fn(arr, arr.join('\n'));
      if (isArr(r)) return r.map(str);
      if (r == null) return [];
      return [str(r)];
    } catch (e) { return arr; }
  }

  /* ------------------------------------------------------- buildSinkMessage --- */
  // Fold the post-filter lines into the typed message the sink pane forwarder applies.
  // The runtime posts this DOWN to every pane matching sink.urls (never a direct
  // top-frame DOM write into a cross-origin iframe). Returns null when there's nothing
  // to deliver (so the runtime can skip an empty emission).
  function buildSinkMessage(sink, values) {
    var k = normSink(sink);
    var arr = (isArr(values) ? values : linesOf(values)).map(str).filter(function (x) { return trim(x) !== ''; });
    if (!arr.length) return null;
    var joined = arr.join(k.sep);
    if (k.kind === 'navigate') return { act: 'navigate', url: arr[0] };
    if (k.kind === 'batch') return { act: 'batch', urls: arr };
    if (k.kind === 'app') {
      var args;
      if (!trim(k.args)) { args = { q: joined }; }
      else {
        // {q} is spliced in JSON-ESCAPED, not raw. Page text routinely contains a quote, a
        // backslash or a newline, and a raw splice turns `{"doi":"{q}"}` into a parse error —
        // silently, on some pages and not others. Escaping the VALUE (stringify, minus its own
        // quotes) keeps the template's surrounding quotes and stays valid for any text.
        var esc = JSON.stringify(joined); esc = esc.substring(1, esc.length - 1);
        try { args = JSON.parse(str(k.args).replace(/\{q\}/g, esc)); }
        catch (e) { return null; }        // an unparseable template delivers nothing, never a guess
      }
      return { act: 'app', app: k.app, verb: k.verb, args: args, text: joined };
    }
    // fill / replace / append all address a selector and carry text
    return { act: k.kind, selector: k.selector, text: joined };
  }

  /* ---------------------------------------------------------------- gate ---- */
  // Decide whether an emission fires, given the edge's per-edge runtime state
  // { lastFired, lastValue, firedOnce }. Pure: returns the decision plus the state to
  // store on a fire (the caller persists it). value is the post-filter joined string
  // used for dedupe. Mirrors ztriggers' cooldown + once-per-page, plus value dedupe.
  function gate(edge, state, now, value) {
    var e = normalizeEdge(edge);
    state = state || {};
    now = now || 0;
    if (!e.enabled) return { fire: false, reason: 'disabled' };
    if (e.once && state.firedOnce) return { fire: false, reason: 'once' };
    if (state.lastFired && (now - state.lastFired) < e.cooldownMs) return { fire: false, reason: 'cooldown' };
    if (e.dedupe && state.lastValue != null && state.lastValue === value) return { fire: false, reason: 'dedupe' };
    return {
      fire: true,
      reason: 'fire',
      state: { lastFired: now, lastValue: value, firedOnce: true }
    };
  }

  /* --------------------------------------------------------------- cycles --- */
  // The edge graph is directed: an edge connects its source-URL pattern to its
  // sink-URL pattern (a node = a normalized pattern string; '' = the "any pane" node).
  // A pipeline that writes into a pane which is itself a source can loop, so the CRUD
  // page rejects an edge that would close a cycle BEFORE it is saved.
  function nodeId(pattern) { return trim(pattern) || '*'; }

  // The graph node an edge DELIVERS to. A pane sink is its URL pattern; an `app` sink is not a
  // pane at all, so it gets its own terminal node (`app:<name>.<verb>`) that no source pattern can
  // ever name. Without this, an app-sink edge with an empty URL filter would collapse onto the
  // "any pane" node `*` and be rejected as a self-loop — refusing an edge that cannot loop,
  // because nothing it writes lands in a pane a source could read back.
  function sinkNode(sink) {
    var k = normSink(sink);
    return k.kind === 'app' ? 'app:' + k.app + '.' + k.verb : nodeId(k.urls);
  }

  function adjacency(edges) {
    var adj = {};
    (edges || []).forEach(function (raw) {
      var e = normalizeEdge(raw);
      if (!e.enabled) return;
      var a = nodeId(e.source.urls), b = sinkNode(e.sink);
      (adj[a] = adj[a] || {})[b] = true;
    });
    return adj;
  }

  // Would adding source→sink close a cycle among the (enabled) existing edges? True if
  // sink already reaches source (or sink === source, a self-loop).
  function wouldCycle(existing, sourcePattern, sinkPattern) {
    var a = nodeId(sourcePattern), b = nodeId(sinkPattern);
    if (a === b) return true;
    var adj = adjacency(existing);
    // DFS from b; if we reach a, source→sink closes a loop.
    var stack = [b], seen = {};
    while (stack.length) {
      var n = stack.pop();
      if (n === a) return true;
      if (seen[n]) continue;
      seen[n] = true;
      var nbrs = adj[n];
      if (nbrs) for (var m in nbrs) if (Object.prototype.hasOwnProperty.call(nbrs, m)) stack.push(m);
    }
    return false;
  }

  // Is there ANY cycle already present in the whole edge set? Returns a node on a cycle
  // or null. Used by the runtime to refuse to arm a corrupt registry.
  function graphCycle(edges) {
    var adj = adjacency(edges);
    var state = {};                 // 0/undef = unvisited, 1 = on stack, 2 = done
    var hit = null;
    function dfs(n) {
      state[n] = 1;
      var nbrs = adj[n];
      if (nbrs) for (var m in nbrs) if (Object.prototype.hasOwnProperty.call(nbrs, m)) {
        if (state[m] === 1) { hit = m; return true; }
        if (!state[m] && dfs(m)) return true;
      }
      state[n] = 2;
      return false;
    }
    for (var k in adj) if (Object.prototype.hasOwnProperty.call(adj, k)) { if (!state[k] && dfs(k)) return hit; }
    return null;
  }

  /* -------------------------------------------------------------- runEdge --- */
  // The whole reactive step in one pure call: extract → filter → gate → sink message.
  // The runtime supplies the DOM-resolved ctx and the edge's stored state + clock, and
  // gets back { fire, message, value, state, hops } — nothing else to decide. hops is
  // threaded through so a chain that has already travelled HOP_BUDGET hops is dropped.
  function runEdge(edge, ctx, state, now, hops) {
    hops = hops || 0;
    if (hops >= HOP_BUDGET) return { fire: false, reason: 'hop-budget' };
    var lines = extractSource(edge && edge.source, ctx);
    if (!lines.length) return { fire: false, reason: 'no-match' };
    var filtered = applyFilter(edge && edge.filter, lines);
    var msg = buildSinkMessage(edge && edge.sink, filtered);
    if (!msg) return { fire: false, reason: 'empty' };
    var value = msg.act === 'batch' ? msg.urls.join('\n') : (msg.url || msg.text || '');
    var g = gate(edge, state, now, value);
    if (!g.fire) return { fire: false, reason: g.reason };
    return { fire: true, reason: 'fire', message: msg, value: value, state: g.state, hops: hops + 1 };
  }

  var API = {
    HOP_BUDGET: HOP_BUDGET,
    SOURCE_KINDS: SOURCE_KINDS,
    SINK_KINDS: SINK_KINDS,
    FILTER_KINDS: FILTER_KINDS,
    linesOf: linesOf,
    matchUrl: matchUrl,
    normalizeEdge: normalizeEdge,
    validateEdge: validateEdge,
    extractSource: extractSource,
    parseOps: parseOps,
    applyFilter: applyFilter,
    buildSinkMessage: buildSinkMessage,
    gate: gate,
    sinkNode: sinkNode,
    wouldCycle: wouldCycle,
    graphCycle: graphCycle,
    runEdge: runEdge
  };

  try { root.ZWIRE_PIPES = API; } catch (e) {}
  try { if (typeof module !== 'undefined' && module.exports) module.exports = API; } catch (e) {}
})(typeof window !== 'undefined' ? window : this);
