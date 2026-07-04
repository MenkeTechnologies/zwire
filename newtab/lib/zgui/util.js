// zgui-core/util.js — the pure helpers every app reimplements (and drifts on), distilled from
// Audio-Haxor's utils.js + context-menu.js. No DOM-framework assumptions; safe to load first.
// window.ZGui.util — and, for ergonomics, a few are also published as bare globals when unset
// (escapeHtml, debounce, throttle, copyToClipboard) since other ZGui modules already shim them.
(function () {
    "use strict";

    const _escDiv = typeof document !== "undefined" ? document.createElement("div") : null;
    function escapeHtml(str) {
        if (!_escDiv) return String(str == null ? "" : str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
        _escDiv.textContent = str == null ? "" : str;
        return _escDiv.innerHTML;
    }

    // Throttle: invoke at most once per `ms` (trailing call guaranteed).
    function throttle(fn, ms) {
        let last = 0, timer = null;
        return function (...args) {
            const now = performance.now();
            const remaining = ms - (now - last);
            if (remaining <= 0) {
                if (timer) { clearTimeout(timer); timer = null; }
                last = now;
                fn.apply(this, args);
            } else if (!timer) {
                timer = setTimeout(() => { last = performance.now(); timer = null; fn.apply(this, args); }, remaining);
            }
        };
    }
    // Debounce: invoke after `ms` of inactivity.
    function debounce(fn, ms) {
        let timer = null;
        return function (...args) { clearTimeout(timer); timer = setTimeout(() => fn.apply(this, args), ms); };
    }
    // Yield to the event loop so pending input/paint runs before a heavy synchronous chunk.
    function yieldToBrowser() { return new Promise((resolve) => setTimeout(resolve, 0)); }
    function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

    // Human byte size: 0 B / 1.5 MB / …
    function formatBytes(bytes) {
        if (!bytes || bytes === 0) return "0 B";
        const units = ["B", "KB", "MB", "GB", "TB", "PB"];
        const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
        return (bytes / Math.pow(1024, i)).toFixed(1) + " " + units[i];
    }
    // Seconds -> m:ss (and h:mm:ss past an hour).
    function formatDuration(sec) {
        if (!sec || !isFinite(sec)) return "0:00";
        sec = Math.floor(sec);
        const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
        if (h > 0) return h + ":" + String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
        return m + ":" + String(s).padStart(2, "0");
    }

    function escapePath(str) { return String(str).replace(/\\/g, "\\\\").replace(/'/g, "\\'"); }
    function slugify(str) {
        return String(str)
            .replace(/([a-z])([A-Z])/g, "$1-$2")
            .replace(/([a-zA-Z])(\d)/g, "$1-$2")
            .replace(/(\d)([a-zA-Z])/g, "$1-$2")
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "");
    }

    // Copy to the OS clipboard (navigator.clipboard, textarea fallback). Optional success toast.
    function copyToClipboard(text, toastMsg) {
        const done = function () { if (toastMsg && typeof window.showToast === "function") window.showToast(toastMsg); };
        const fail = function (e) { if (typeof window.showToast === "function") window.showToast(String(e), 4000, "error"); };
        if (navigator.clipboard && navigator.clipboard.writeText) {
            return navigator.clipboard.writeText(text).then(done).catch(function () { fallback(text) ? done() : fail("copy failed"); });
        }
        if (fallback(text)) done(); else fail("copy failed");
        return Promise.resolve();
    }
    function fallback(text) {
        try {
            const ta = document.createElement("textarea");
            ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
            document.body.appendChild(ta); ta.select();
            const ok = document.execCommand("copy");
            ta.remove();
            return ok;
        } catch { return false; }
    }

    // Toggle a button's loading spinner (.btn-loading) + disabled state.
    function btnLoading(btn, loading) {
        if (!btn) return;
        btn.classList.toggle("btn-loading", !!loading);
        btn.disabled = !!loading;
    }
    // Shimmer skeleton placeholder rows into a container.
    function skeletonRows(container, count) {
        if (!container) return;
        count = count || 5;
        container.innerHTML = Array.from({ length: count }, () =>
            `<div class="skeleton-row fade-in">
              <div class="skeleton skeleton-bar" style="flex:2;"></div>
              <div class="skeleton skeleton-bar" style="flex:1;"></div>
              <div class="skeleton skeleton-bar" style="width:80px;"></div>
              <div class="skeleton skeleton-bar" style="width:80px;"></div>
            </div>`).join("");
    }

    // ETA estimator for progress loops.
    function createETA() {
        let startTime = 0;
        return {
            start() { startTime = performance.now(); },
            estimate(processed, total) {
                if (!startTime || processed <= 0 || total <= 0) return "";
                const elapsed = (performance.now() - startTime) / 1000;
                const remaining = (total - processed) / (processed / elapsed);
                if (remaining < 1) return "< 1s";
                if (remaining < 60) return `~${Math.ceil(remaining)}s`;
                return `~${Math.floor(remaining / 60)}m ${Math.ceil(remaining % 60)}s`;
            },
            elapsed() {
                if (!startTime) return "";
                const secs = Math.floor((performance.now() - startTime) / 1000);
                return secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m ${secs % 60}s`;
            },
        };
    }

    // ---- Readline / Emacs line editing for text inputs --------------------------------------
    // The WebView gives none of these in a text field; the whole stack expects them. `lineEdit`
    // applies one keystroke (Emacs/readline bindings) to a text <input>/<textarea>, line-aware so
    // it works in multi-line fields too. `installReadline` wires it globally (see auto-install
    // below) so EVERY input in a consumer gets it — no per-input wiring.
    //
    //   Move:  ^A start-of-line  ^E end-of-line  ^B back-char  ^F fwd-char  M-b back-word  M-f fwd-word
    //   Kill:  ^W word-back  ^K to-line-end  ^U to-line-start  M-d word-fwd   (all feed the kill-ring)
    //   Edit:  ^H backspace  ^D delete-char  ^Y yank (paste last kill)  ^T transpose-chars
    let killRing = "";

    function isTextInput(el) {
        if (!el) return false;
        const tag = (el.tagName || "").toLowerCase();
        if (tag === "textarea") return !el.disabled && !el.readOnly;
        if (tag !== "input") return false;
        const t = (el.type || "text").toLowerCase();
        const nonText = ["checkbox", "radio", "range", "color", "file", "button", "submit", "reset", "image", "date", "time", "datetime-local", "month", "week"];
        return !el.disabled && !el.readOnly && nonText.indexOf(t) < 0;
    }

    function lineEdit(input, e) {
        if (!e || e.metaKey || e.isComposing || !isTextInput(input)) return false;
        const ctrl = e.ctrlKey && !e.altKey, alt = e.altKey && !e.ctrlKey;
        if (!ctrl && !alt) return false;
        const v = input.value, p = input.selectionStart;
        if (p == null) return false;
        const ls = v.lastIndexOf("\n", p - 1) + 1;                 // start of the current line
        let le = v.indexOf("\n", p); if (le < 0) le = v.length;     // end of the current line
        const wordBack = (i) => { while (i > 0 && /\s/.test(v[i - 1])) i--; while (i > 0 && !/\s/.test(v[i - 1])) i--; return i; };
        const wordFwd = (i) => { while (i < v.length && /\s/.test(v[i])) i++; while (i < v.length && !/\s/.test(v[i])) i++; return i; };
        const k = (e.key || "").toLowerCase();
        let nv = null, caret = p;   // nv !== null ⇒ value changed

        if (ctrl) {
            switch (k) {
                case "a": caret = ls; break;
                case "e": caret = le; break;
                case "b": caret = Math.max(0, p - 1); break;
                case "f": caret = Math.min(v.length, p + 1); break;
                case "h": if (p <= 0) return false; nv = v.slice(0, p - 1) + v.slice(p); caret = p - 1; break;
                case "d": if (p >= v.length) return false; nv = v.slice(0, p) + v.slice(p + 1); caret = p; break;
                case "k": killRing = v.slice(p, le); nv = v.slice(0, p) + v.slice(le); caret = p; break;
                case "u": killRing = v.slice(ls, p); nv = v.slice(0, ls) + v.slice(p); caret = ls; break;
                case "w": { const i = wordBack(p); killRing = v.slice(i, p); nv = v.slice(0, i) + v.slice(p); caret = i; break; }
                case "y": nv = v.slice(0, p) + killRing + v.slice(p); caret = p + killRing.length; break;
                case "t": { if (v.length < 2 || p === 0) return false; const i = p < v.length ? p : v.length - 1; nv = v.slice(0, i - 1) + v[i] + v[i - 1] + v.slice(i + 1); caret = Math.min(i + 1, v.length); break; }
                default: return false;
            }
        } else { // alt / Meta-word ops
            switch (k) {
                case "b": caret = wordBack(p); break;
                case "f": caret = wordFwd(p); break;
                case "d": { const i = wordFwd(p); killRing = v.slice(p, i); nv = v.slice(0, p) + v.slice(i); caret = p; break; }
                default: return false;
            }
        }

        if (nv !== null) input.value = nv;
        input.selectionStart = input.selectionEnd = caret;
        if (nv !== null) input.dispatchEvent(new Event("input", { bubbles: true }));
        return true;
    }

    // Wire readline into every text input under `root` (default: the whole document). One capture
    // listener handles all current + future inputs; idempotent. Handled keys are swallowed so a
    // widget's own keydown never double-applies them (its non-readline keys still pass through).
    function installReadline(root) {
        const target = root || (typeof document !== "undefined" ? document : null);
        if (!target || target.__zguiReadline) return;
        target.__zguiReadline = true;
        target.addEventListener("keydown", function (e) {
            if (lineEdit(e.target, e)) { e.preventDefault(); e.stopPropagation(); }
        }, true);
    }

    // The standard "focus the filter/search bar" affordance, bound app-wide to
    // Cmd+F (macOS) / Ctrl+F below. Focuses the first VISIBLE filter input, in
    // priority order: an explicit [data-zg-filter], the zgui filter bar
    // (.zg-searchbox-input), a search input, then the common overlay classes/ids.
    // Returns true if one was focused (so the caller can preventDefault).
    const FILTER_SELECTORS = [
        "[data-zg-filter]",
        ".zg-searchbox-input",
        'input[type="search"]',
        ".srch-input",
        "#searchMount input",
    ];
    function isVisible(el) {
        return !!(el && !el.disabled && el.offsetParent !== null);
    }
    function focusFilterBar() {
        if (typeof document === "undefined") return false;
        for (const sel of FILTER_SELECTORS) {
            const list = document.querySelectorAll(sel);
            for (const el of list) {
                if (isVisible(el)) {
                    el.focus();
                    if (typeof el.select === "function") el.select();
                    return true;
                }
            }
        }
        return false;
    }

    // Turn off the browser/OS text-correction features on a text input or
    // textarea — autocorrect, autocapitalize, spellcheck, autofill. These are
    // wrong for the code/config/command/search fields this stack is full of
    // (macOS WKWebView forces them on by default). Non-text inputs are skipped.
    const TEXTLIKE = { text: 1, search: 1, url: 1, email: 1, tel: 1, password: 1, number: 1, "": 1 };
    function dampenInput(el) {
        if (!el || el.nodeType !== 1) return;
        const tag = el.tagName;
        if (tag !== "INPUT" && tag !== "TEXTAREA") return;
        if (tag === "INPUT" && !TEXTLIKE[(el.getAttribute("type") || "text").toLowerCase()]) return;
        el.setAttribute("autocorrect", "off");
        el.setAttribute("autocapitalize", "off");
        if (!el.hasAttribute("autocomplete")) el.setAttribute("autocomplete", "off");
        el.setAttribute("spellcheck", "false");
        el.spellcheck = false;
    }
    // Apply to every current and future text field under `root`. One MutationObserver
    // catches inputs added later (the widgets build their DOM lazily); idempotent.
    function installInputDefaults(root) {
        const target = root || (typeof document !== "undefined" ? document : null);
        if (!target || target.__zguiInputDefaults) return;
        target.__zguiInputDefaults = true;
        const sweep = (node) => {
            dampenInput(node);
            if (node && node.querySelectorAll) node.querySelectorAll("input, textarea").forEach(dampenInput);
        };
        sweep(target.body || target.documentElement || target);
        if (typeof MutationObserver !== "undefined") {
            const obs = new MutationObserver((muts) => {
                for (const m of muts) for (const n of m.addedNodes) sweep(n);
            });
            obs.observe(target.body || target.documentElement, { childList: true, subtree: true });
        }
    }

    const util = {
        escapeHtml, throttle, debounce, yieldToBrowser, clamp,
        formatBytes, formatDuration, escapePath, slugify,
        copyToClipboard, btnLoading, skeletonRows, createETA, lineEdit, installReadline,
        focusFilterBar, dampenInput, installInputDefaults,
    };
    window.ZGui = window.ZGui || {};
    window.ZGui.util = util;
    // Readline in every text input/textarea, app-wide, by default — the stack expects it everywhere.
    if (typeof document !== "undefined") installReadline(document);
    // Disable autocorrect/autocapitalize/spellcheck/autofill on every text field,
    // current and future — wrong for code/config/command fields, and forced on by
    // default in macOS WKWebView. Bound once here since util.js loads everywhere.
    if (typeof document !== "undefined") installInputDefaults(document);
    // Cmd+F (macOS) / Ctrl+F: focus the page's filter/search bar — the standard
    // shortcut across every zgui app. Bound once here since util.js loads on every
    // page. No-op (and leaves the event alone) when the page has no filter bar.
    if (typeof document !== "undefined" && !document.__zguiFilterKey) {
        document.__zguiFilterKey = true;
        document.addEventListener("keydown", function (e) {
            const find = (e.key === "f" || e.key === "F") && (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey;
            if (find && focusFilterBar()) e.preventDefault();
        });
    }
    // Publish the most-shimmed helpers as bare globals when the host hasn't already.
    if (typeof window.escapeHtml !== "function") window.escapeHtml = escapeHtml;
    if (typeof window.debounce !== "function") window.debounce = debounce;
    if (typeof window.throttle !== "function") window.throttle = throttle;
    if (typeof window.copyToClipboard !== "function") window.copyToClipboard = copyToClipboard;
})();
