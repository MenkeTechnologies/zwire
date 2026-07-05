"use strict";

// Default quick-launch tiles. Overridable via localStorage key "zb.tiles"
// (an array of { label, url } objects).
const DEFAULT_TILES = [
  { label: "GitHub",   url: "https://github.com/MenkeTechnologies" },
  { label: "Search",   url: "https://duckduckgo.com" },
  { label: "MDN",      url: "https://developer.mozilla.org" },
  { label: "crates",   url: "https://crates.io" },
  { label: "Hacker",   url: "https://news.ycombinator.com" },
  { label: "Docs",     url: "https://menketechnologies.github.io" }
];

// Search engine for non-URL omnibox input. Override via localStorage "zb.engine".
const DEFAULT_ENGINE = "https://duckduckgo.com/?q=%s";

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function pad(n) { return String(n).padStart(2, "0"); }

function tick() {
  const now = new Date();
  const time = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  const date = now
    .toLocaleDateString(undefined, { weekday: "short", year: "numeric", month: "short", day: "numeric" })
    .toUpperCase();
  document.getElementById("time").textContent = time;
  document.getElementById("date").textContent = date;
}

// Heuristic: does the input look like a URL rather than a search query?
function looksLikeUrl(s) {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return true;       // has a scheme
  if (/\s/.test(s)) return false;                             // has whitespace -> search
  return /^[^\s.]+\.[^\s.]{2,}(\/.*)?$/.test(s) || s === "localhost";
}

function navigate(input) {
  const s = input.trim();
  if (!s) return;
  let dest;
  if (looksLikeUrl(s)) {
    dest = /^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`;
  } else {
    const engine = readJSON("zb.engine", DEFAULT_ENGINE);
    dest = engine.replace("%s", encodeURIComponent(s));
  }
  window.location.href = dest;
}

function renderTiles() {
  const tiles = readJSON("zb.tiles", DEFAULT_TILES);
  const host = document.getElementById("tiles");
  host.textContent = "";
  for (const t of tiles) {
    const a = document.createElement("a");
    a.className = "tile";
    a.href = t.url;
    const glyph = document.createElement("span");
    glyph.className = "tile-glyph";
    glyph.textContent = (t.label || "?").slice(0, 2).toUpperCase();
    const label = document.createElement("span");
    label.textContent = t.label || t.url;
    a.append(glyph, label);
    host.appendChild(a);
  }
}

// Chrome parks the cursor in the omnibox on the new tab and defeats the
// <input autofocus>, so the page never receives keystrokes — the ⌘K palette
// and typing both die until you click in. A JS .focus() reclaims focus where
// the attribute can't (verified: it moves activeElement to #q), which routes
// keys to the page again. Retried across the first frames + when the tab is
// re-shown, with preventScroll so it never jumps the layout.
function reclaimFocus() {
  const q = document.getElementById("q");
  if (!q) return;
  try { q.focus({ preventScroll: true }); } catch (e) { try { q.focus(); } catch (e2) {} }
}

document.addEventListener("DOMContentLoaded", () => {
  tick();
  setInterval(tick, 1000);
  renderTiles();
  document.getElementById("search").addEventListener("submit", (e) => {
    e.preventDefault();
    navigate(document.getElementById("q").value);
  });
  // ⌘K / Ctrl+K while the search bar is focused must open the command palette,
  // not beep. The document-level palette handler doesn't win when the input has
  // focus here, so bind directly on the input in the CAPTURE phase and consume
  // the key (preventDefault kills the macOS unhandled-key beep;
  // stopImmediatePropagation stops the field seeing it).
  const qEl = document.getElementById("q");
  if (qEl) {
    qEl.addEventListener("keydown", (e) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && (e.key || "").toLowerCase() === "k") {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (typeof window.__zbPaletteOpen === "function") window.__zbPaletteOpen();
      }
    }, true);
  }
  reclaimFocus();
  requestAnimationFrame(reclaimFocus);
  setTimeout(reclaimFocus, 60);
  setTimeout(reclaimFocus, 200);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) reclaimFocus(); });
});
