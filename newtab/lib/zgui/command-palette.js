// zgui-core/command-palette.js — the command palette (⌘/Ctrl+K). The chrome, keyboard handling, fzf
// filtering (via ZGui.fzf) and CSS live here. window.ZGui.palette.
//
//   SINGLETON (host-only): register(item|[items]); open(); bindHotkey()  — the one global ⌘K palette.
//   INSTANCE  (cores):     palette.create({ items, scope }) -> { open, close, isOpen, setItems }
//     A core opens its OWN palette from a BUTTON — no global hotkey, so it never fights the host's ⌘K
//     (see GUI_APP_ARCHITECTURE.md). Pass `scope` to render it inside the core's pane, not full-screen.
//
// item: { label/name, hint?, icon?, detail?, shortcut?, type?, run() }.
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
      const m = fz.fzfMatch(q, text);
      if (m) return fz.highlightWithIndices(text, m.indices);
    }
    return escapeHtml(text);
  }

  // A palette bound to one items array. `scope` (optional) renders the overlay inside that element
  // (pane-scoped) instead of full-screen on <body>.
  function makePalette(itemsRef, scope) {
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
        filtered = q && fz
          ? itemsRef.map(function (it) { const m = fz.fzfMatch(q, it.name != null ? it.name : it.label); return m ? { it: it, score: m.score } : null; })
              .filter(Boolean).sort(function (a, b) { return b.score - a.score; }).map(function (x) { return x.it; })
          : itemsRef.slice();
        sel = 0;
        results.innerHTML = "";
        filtered.forEach(function (it) {
          const row = document.createElement("div");
          row.className = "palette-row";
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
  const singleton = makePalette(items);
  function register(list) { (Array.isArray(list) ? list : [list]).forEach(function (i) { if (i && i.label) items.push(i); }); }
  function clear() { items.length = 0; }
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
    register: register, clear: clear, open: singleton.open, close: singleton.close,
    isOpen: singleton.isOpen, bindHotkey: bindHotkey, create: create, items: items,
  };
})();
