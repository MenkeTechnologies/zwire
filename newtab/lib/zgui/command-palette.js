// zgui-core/command-palette.js — the command palette (⌘/Ctrl+K). The chrome, keyboard handling, fzf
// filtering (via ZGui.fzf) and CSS live here. window.ZGui.palette.
//
//   SINGLETON (host-only): register(item|[items]); registerProvider(fn); setUserItems([items]); open(); bindHotkey()
//     — the one global ⌘K palette. registerProvider(fn(query)->items) adds query-reactive rows each
//     keystroke; setUserItems([items]) sets the personal/user commands that ALWAYS rank above the app's
//     built-in items (the ZGui.userCommands personal palette, shared across every zgui app).
//   INSTANCE  (cores):     palette.create({ items, scope }) -> { open, close, isOpen, setItems }
//     A core opens its OWN palette from a BUTTON — no global hotkey, so it never fights the host's ⌘K
//     (see GUI_APP_ARCHITECTURE.md). Pass `scope` to render it inside the core's pane, not full-screen.
//
// item: { label/name, hint?, icon?, detail?, shortcut?, type?, keyword?, run() }. Scoring matches the
// label AND the keyword. Ranking flags: `user` (personal commands, first), `top` (pin to the top of its
// tier — exact keyword/alias hits), `secondary` (reference rows, below real matches), `fallback` (last).
(function () {
  "use strict";
  const escapeHtml = window.escapeHtml || function (s) {
    const d = document.createElement("div");
    d.textContent = s == null ? "" : String(s);
    return d.innerHTML;
  };

  // Highlight matched chars via the shared fzf (falls back to escaped text).
  function labelHtml(text, q) {
    const fz = window.ZGui && window.ZGui.fzf;
    if (fz && q) {
      const idx = fz.getMatchIndices(q, text);   // handles multi-word / extended queries
      if (idx && idx.length) return fz.highlightWithIndices(text, idx);
    }
    return escapeHtml(text);
  }

  // A palette bound to one items array. `scope` (optional) renders the overlay inside that element
  // (pane-scoped) instead of full-screen on <body>.
  function makePalette(itemsRef, scope, providersRef) {
    let overlay = null;
    function open() {
      if (overlay) return;
      overlay = document.createElement("div");
      overlay.className = "palette-overlay" + (scope ? " palette-overlay--scoped" : "");
      const box = document.createElement("div");
      box.className = "palette-box";
      const input = document.createElement("input");
      input.className = "palette-input";
      input.placeholder = "Type a command…";
      input.spellcheck = false; input.autocomplete = "off"; input.autocapitalize = "off"; input.setAttribute("autocorrect", "off");
      const results = document.createElement("div");
      results.className = "palette-results";
      box.appendChild(input);
      box.appendChild(results);
      overlay.appendChild(box);
      if (scope) { if (getComputedStyle(scope).position === "static") scope.style.position = "relative"; scope.appendChild(overlay); }
      else document.body.appendChild(overlay);

      let filtered = itemsRef.slice(), sel = 0;
      function render() {
        const q = input.value.trim();
        const fz = window.ZGui && window.ZGui.fzf;
        // zgo-style dynamic providers: query-reactive rows (web-search keywords,
        // "open url", calc…) computed fresh each keystroke.
        let extra = [];
        if (providersRef && providersRef.length && q) {
          providersRef.forEach(function (fn) { try { const r = fn(q); if (r && r.length) extra = extra.concat(r); } catch (e) {} });
        }
        const userProv = [], strong = [], secondary = [], fallback = [];
        extra.forEach(function (it) {
          if (!it) return;
          if (it.fallback) fallback.push(it);
          else if (it.secondary) secondary.push(it);
          else if (it.user) userProv.push(it);
          else strong.push(it);
        });
        // User-defined commands (ZGui.userCommands — added by the user in the app-shell
        // Settings modal, shared across every zgui desktop app) carry `user:true` and
        // ALWAYS rank above the app's built-in ("stdlib") items — the whole point of a
        // personal palette. Below the user tier, the same three-tier relevance ranking,
        // each tier fzf-scored against the query:
        //   tier 0 — real targets: built-in commands/tabs + strong provider rows
        //            (keyword destinations, open-url). Ties favor the static item.
        //   tier 1 — `secondary:true` reference rows (keyboard-shortcut lists) —
        //            below any real match, so typing "ci" surfaces the CI *page*
        //            first, not a shortcut that merely contains "ci".
        //   tier 2 — `fallback:true` generic web search (Google/DDG), always last.
        const userStatic = [], factory = [];
        itemsRef.forEach(function (it) { (it && it.user ? userStatic : factory).push(it); });
        if (q && fz) {
          const labelOf = function (it) { return it.name != null ? it.name : it.label; };
          // Score the label AND the item's keyword through the app's shared fzf query
          // engine (searchScore): handles multi-word queries ("git hub" → "GitHub") and
          // substring/prefix bonuses that a single-needle match can't. `top:true` rows
          // (exact keyword/alias hits) pin to the top of their tier, above raw score.
          const fieldsOf = function (it) { return it.keyword ? [labelOf(it), String(it.keyword)] : [labelOf(it)]; };
          const byRank = function (a, b) { return ((b.it.top ? 1 : 0) - (a.it.top ? 1 : 0)) || (b.score - a.score) || (a.prov - b.prov); };
          const scoreTier = function (statics, provRows) {
            const s = [];
            statics.forEach(function (it) { const sc = fz.searchScore(q, fieldsOf(it)); if (sc > 0) s.push({ it: it, score: sc, prov: 0 }); });
            provRows.forEach(function (it) { s.push({ it: it, score: fz.searchScore(q, fieldsOf(it)), prov: 1 }); });
            s.sort(byRank);
            return s.map(function (x) { return x.it; });
          };
          const uTier = scoreTier(userStatic, userProv);            // user commands, always first
          const t0 = scoreTier(factory, strong);
          const t1 = secondary.map(function (it) { return { it: it, score: fz.searchScore(q, fieldsOf(it)) }; })
            .sort(function (a, b) { return ((b.it.top ? 1 : 0) - (a.it.top ? 1 : 0)) || (b.score - a.score); }).map(function (x) { return x.it; });
          filtered = uTier.concat(t0, t1, fallback);
        } else {
          filtered = userStatic.concat(userProv, strong, factory, secondary, fallback);
        }
        sel = 0;
        results.innerHTML = "";
        filtered.forEach(function (it) {
          const row = document.createElement("div");
          row.className = "palette-row" + (it.user ? " palette-row--user" : "");
          const ic = document.createElement("span");
          ic.className = "palette-icon";
          ic.innerHTML = it.icon || "&#9656;";
          const name = document.createElement("span");
          name.className = "palette-name";
          name.innerHTML = labelHtml(it.name != null ? it.name : it.label, q);
          row.appendChild(ic);
          row.appendChild(name);
          if (it.detail) {
            const d = document.createElement("span");
            d.className = "palette-detail";
            d.textContent = it.detail;
            row.appendChild(d);
          }
          if (it.shortcut) {
            const s = document.createElement("span");
            s.className = "palette-shortcut";
            const k = document.createElement("kbd");
            k.textContent = it.shortcut;
            s.appendChild(k);
            row.appendChild(s);
          } else if (it.hint) {
            const h = document.createElement("span");
            h.className = "palette-hint";
            h.textContent = it.hint;
            row.appendChild(h);
          }
          if (it.type) {
            const b = document.createElement("span");
            b.className = "palette-badge palette-type-" + it.type;
            b.textContent = it.typeLabel != null ? it.typeLabel : it.type;
            row.appendChild(b);
          }
          row.addEventListener("click", function () { run(it); });
          results.appendChild(row);
        });
        hi();
      }
      function hi() {
        const rows = results.querySelectorAll(".palette-row");
        rows.forEach(function (r, i) { r.classList.toggle("palette-selected", i === sel); });
        const c = rows[sel];
        if (c && c.scrollIntoView) c.scrollIntoView({ block: "nearest" });
      }
      function run(it) { close(); if (it && it.run) it.run(); }

      input.addEventListener("input", render);
      input.addEventListener("keydown", function (e) {
        if (e.key === "ArrowDown") { e.preventDefault(); sel = Math.min(sel + 1, filtered.length - 1); hi(); }
        else if (e.key === "ArrowUp") { e.preventDefault(); sel = Math.max(sel - 1, 0); hi(); }
        else if (e.key === "Enter") { e.preventDefault(); if (filtered[sel]) run(filtered[sel]); }
        else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); }
      });
      overlay.addEventListener("click", function (e) { if (e.target === overlay) close(); });
      render();
      input.focus();
    }
    function close() { if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay); overlay = null; }
    function isOpen() { return !!overlay; }
    return { open: open, close: close, isOpen: isOpen };
  }

  // ── the host singleton (one global ⌘K palette) ──
  const items = [];
  const providers = [];
  const singleton = makePalette(items, null, providers);
  function register(list) { (Array.isArray(list) ? list : [list]).forEach(function (i) { if (i && i.label) items.push(i); }); }
  // registerProvider(fn): fn(query) -> [items] merged on top each keystroke.
  function registerProvider(fn) { if (typeof fn === "function") providers.push(fn); }
  // setUserItems(list): replace the USER-defined commands (the personal palette managed in the
  // app-shell settings modal, shared across every zgui app). They are flagged `user:true` so they
  // always rank above the app's built-in items, and are swapped wholesale here WITHOUT touching the
  // app's registered ("stdlib") items — so `clear()` + re-`register()` of app items never wipes them
  // and re-setting them on every edit never wipes the app's.
  function setUserItems(list) {
    for (let i = items.length - 1; i >= 0; i--) if (items[i] && items[i].user) items.splice(i, 1);
    (Array.isArray(list) ? list : list ? [list] : []).forEach(function (it) {
      if (it && (it.label || it.name)) { it.user = true; items.push(it); }
    });
  }
  // clear() resets the app's registered items + providers, but PRESERVES user commands and any
  // provider tagged `__user` (they are global/cross-app, owned by ZGui.userCommands, not by whatever
  // app called clear()).
  function clear() {
    for (let i = items.length - 1; i >= 0; i--) if (!items[i] || !items[i].user) items.splice(i, 1);
    for (let i = providers.length - 1; i >= 0; i--) if (!providers[i] || !providers[i].__user) providers.splice(i, 1);
  }
  // ⌘/Ctrl+K toggles the singleton. HOST-ONLY (an embedded core must NOT call this — see the design doc).
  function bindHotkey() {
    // On macOS use ⌘K only, so Ctrl-K stays free for a focused terminal / readline (Ctrl-K = up,
    // kill-line, etc.). On other platforms (no ⌘) keep Ctrl-K as the palette toggle.
    var isMac = /Mac|iPhone|iPad/.test((navigator && navigator.platform) || "");
    document.addEventListener("keydown", function (e) {
      var mod = isMac ? e.metaKey : e.ctrlKey;
      if (mod && e.key.toLowerCase() === "k") { e.preventDefault(); singleton.isOpen() ? singleton.close() : singleton.open(); }
    });
  }

  // ── a scoped instance for a core (button-opened, NO global hotkey) ──
  function create(opts) {
    opts = opts || {};
    const arr = (opts.items || []).slice();
    const p = makePalette(arr, opts.scope || null);
    p.setItems = function (x) { arr.length = 0; (x || []).forEach(function (i) { arr.push(i); }); };
    return p;
  }

  window.ZGui = window.ZGui || {};
  window.ZGui.palette = {
    register: register, registerProvider: registerProvider, setUserItems: setUserItems, clear: clear,
    open: singleton.open, close: singleton.close,
    isOpen: singleton.isOpen, bindHotkey: bindHotkey, create: create, items: items,
  };
})();
