// zgui-core/fzf.js — the canonical fzf fuzzy matcher + matched-char highlighter,
// EXTRACTED VERBATIM from Audio-Haxor frontend/js/utils.js (fzf-style scoring, configurable
// weights, `<mark class="fzf-hl">` highlight). Shared so the 14 apps stop drifting their own
// copies. Self-contained: host-util couplings (escapeHtml/prefs/toast/renderFzfSettings) are
// shimmed below; a host may pre-define window.prefs / window.renderFzfSettings to override.
(function () {
  'use strict';
  // ---- host-util shims (no-ops / fallbacks unless the host provided richer versions) ----
  const _escDiv = document.createElement('div');
  if (typeof window.escapeHtml !== 'function') {
    window.escapeHtml = function escapeHtml(s) { _escDiv.textContent = s == null ? '' : String(s); return _escDiv.innerHTML; };
  }
  const escapeHtml = window.escapeHtml;
  if (!window.prefs || typeof window.prefs.getItem !== 'function') {
    window.prefs = {
      getItem(k) { try { return localStorage.getItem(k); } catch (_) { return null; } },
      setItem(k, v) { try { localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v)); } catch (_) {} },
      removeItem(k) { try { localStorage.removeItem(k); } catch (_) {} },
      getObject(k, f) { try { const v = localStorage.getItem(k); return v == null ? f : JSON.parse(v); } catch (_) { return f; } },
    };
  }
  const prefs = window.prefs;
  const renderFzfSettings = () => { if (typeof window.renderFzfSettings === 'function') window.renderFzfSettings(); };
  const showToast = (...a) => { if (typeof window.showToast === 'function') window.showToast(...a); };
  const toastFmt = (...a) => (typeof window.toastFmt === 'function' ? window.toastFmt(...a) : '');

  // ===== canonical block (Audio-Haxor utils.js 217–722) =====
let SCORE_MATCH = 16;
let SCORE_GAP_START = -3;
let SCORE_GAP_EXTENSION = -1;
let BONUS_BOUNDARY = 9;
let BONUS_NON_WORD = 8;
let BONUS_CAMEL = 7;
let BONUS_CONSECUTIVE = 4;
let BONUS_FIRST_CHAR_MULT = 2;

const FZF_DEFAULTS = {
    SCORE_MATCH: 16,
    SCORE_GAP_START: -3,
    SCORE_GAP_EXTENSION: -1,
    BONUS_BOUNDARY: 9,
    BONUS_NON_WORD: 8,
    BONUS_CAMEL: 7,
    BONUS_CONSECUTIVE: 4,
    BONUS_FIRST_CHAR_MULT: 2
};

// [min, max] tuning bounds per weight — drives the ZGui.fzf.settingsPanel sliders (fzf-settings.js).
const FZF_BOUNDS = {
    SCORE_MATCH: [1, 50],
    SCORE_GAP_START: [-20, 0],
    SCORE_GAP_EXTENSION: [-10, 0],
    BONUS_BOUNDARY: [0, 30],
    BONUS_NON_WORD: [0, 30],
    BONUS_CAMEL: [0, 30],
    BONUS_CONSECUTIVE: [0, 20],
    BONUS_FIRST_CHAR_MULT: [1, 5]
};

// Set one weight live. The scoring fns close over these module-local bindings, so reassigning here
// updates scoring immediately; persisted via saveFzfParams. Used by the tuning panel.
function setFzfParam(key, value) {
    const v = Number(value);
    if (!Number.isFinite(v)) return;
    switch (key) {
        case 'SCORE_MATCH': SCORE_MATCH = v; break;
        case 'SCORE_GAP_START': SCORE_GAP_START = v; break;
        case 'SCORE_GAP_EXTENSION': SCORE_GAP_EXTENSION = v; break;
        case 'BONUS_BOUNDARY': BONUS_BOUNDARY = v; break;
        case 'BONUS_NON_WORD': BONUS_NON_WORD = v; break;
        case 'BONUS_CAMEL': BONUS_CAMEL = v; break;
        case 'BONUS_CONSECUTIVE': BONUS_CONSECUTIVE = v; break;
        case 'BONUS_FIRST_CHAR_MULT': BONUS_FIRST_CHAR_MULT = v; break;
        default: return;
    }
    saveFzfParams();
}

function loadFzfParams() {
    const saved = prefs.getObject('fzfParams', null);
    if (saved) {
        SCORE_MATCH = saved.SCORE_MATCH ?? 16;
        SCORE_GAP_START = saved.SCORE_GAP_START ?? -3;
        SCORE_GAP_EXTENSION = saved.SCORE_GAP_EXTENSION ?? -1;
        BONUS_BOUNDARY = saved.BONUS_BOUNDARY ?? 9;
        BONUS_NON_WORD = saved.BONUS_NON_WORD ?? 8;
        BONUS_CAMEL = saved.BONUS_CAMEL ?? 7;
        BONUS_CONSECUTIVE = saved.BONUS_CONSECUTIVE ?? 4;
        BONUS_FIRST_CHAR_MULT = saved.BONUS_FIRST_CHAR_MULT ?? 2;
    }
    if (typeof renderFzfSettings === 'function') renderFzfSettings();
}

function saveFzfParams() {
    prefs.setItem('fzfParams', {
        SCORE_MATCH,
        SCORE_GAP_START,
        SCORE_GAP_EXTENSION,
        BONUS_BOUNDARY,
        BONUS_NON_WORD,
        BONUS_CAMEL,
        BONUS_CONSECUTIVE,
        BONUS_FIRST_CHAR_MULT
    });
}

function resetFzfParams() {
    Object.assign(window, FZF_DEFAULTS);
    SCORE_MATCH = FZF_DEFAULTS.SCORE_MATCH;
    SCORE_GAP_START = FZF_DEFAULTS.SCORE_GAP_START;
    SCORE_GAP_EXTENSION = FZF_DEFAULTS.SCORE_GAP_EXTENSION;
    BONUS_BOUNDARY = FZF_DEFAULTS.BONUS_BOUNDARY;
    BONUS_NON_WORD = FZF_DEFAULTS.BONUS_NON_WORD;
    BONUS_CAMEL = FZF_DEFAULTS.BONUS_CAMEL;
    BONUS_CONSECUTIVE = FZF_DEFAULTS.BONUS_CONSECUTIVE;
    BONUS_FIRST_CHAR_MULT = FZF_DEFAULTS.BONUS_FIRST_CHAR_MULT;
    saveFzfParams();
    if (typeof renderFzfSettings === 'function') renderFzfSettings();
    if (typeof showToast === 'function' && typeof toastFmt === 'function') {
        showToast(toastFmt('toast.search_weights_reset'));
    }
}

function charClass(c) {
    if (c >= 'a' && c <= 'z') return 1; // lower
    if (c >= 'A' && c <= 'Z') return 2; // upper
    if (c >= '0' && c <= '9') return 3; // digit
    return 0; // non-word
}

function positionBonus(prev, curr) {
    const pc = charClass(prev);
    const cc = charClass(curr);
    if (pc === 0 && cc !== 0) return BONUS_BOUNDARY;       // word boundary
    if (pc === 1 && cc === 2) return BONUS_CAMEL;           // camelCase
    if (cc !== 0 && pc !== 0 && pc !== cc) return BONUS_NON_WORD;
    return 0;
}

// Fuzzy match with fzf-style scoring. Returns { score, indices } or null.
function fzfMatch(needle, haystack) {
    const nLen = needle.length, hLen = haystack.length;
    if (nLen === 0) return {score: 0, indices: []};
    if (nLen > hLen) return null;

    const nLower = needle.toLowerCase();
    const hLower = haystack.toLowerCase();

    // Quick check: all chars present in order
    let ni = 0;
    for (let hi = 0; hi < hLen && ni < nLen; hi++) {
        if (hLower[hi] === nLower[ni]) ni++;
    }
    if (ni < nLen) return null;

    // Find best match using greedy-with-backtrack
    // Try to find the match that maximizes score
    let bestScore = -Infinity, bestIndices = null;

    // Find all positions of first char
    const starts = [];
    for (let i = 0; i <= hLen - nLen; i++) {
        if (hLower[i] === nLower[0]) starts.push(i);
    }

    for (const start of starts) {
        const indices = [start];
        let si = start;
        let valid = true;

        for (let n = 1; n < nLen; n++) {
            let found = false;
            for (let h = si + 1; h < hLen; h++) {
                if (hLower[h] === nLower[n]) {
                    indices.push(h);
                    si = h;
                    found = true;
                    break;
                }
            }
            if (!found) {
                valid = false;
                break;
            }
        }
        if (!valid) continue;

        // Score this match
        let score = 0;
        let prevIdx = -2;
        for (let i = 0; i < indices.length; i++) {
            const idx = indices[i];
            score += SCORE_MATCH;

            // Position bonus
            const prev = idx > 0 ? haystack[idx - 1] : ' ';
            let bonus = positionBonus(prev, haystack[idx]);
            if (i === 0) bonus *= BONUS_FIRST_CHAR_MULT;
            score += bonus;

            // Consecutive bonus / gap penalty
            if (prevIdx === idx - 1) {
                score += BONUS_CONSECUTIVE;
            } else if (i > 0) {
                const gap = idx - prevIdx - 1;
                score += SCORE_GAP_START + SCORE_GAP_EXTENSION * (gap - 1);
            }
            prevIdx = idx;
        }

        if (score > bestScore) {
            bestScore = score;
            bestIndices = indices;
        }
    }

    if (!bestIndices) return null;
    return {score: bestScore, indices: bestIndices};
}

// Parse fzf extended search syntax: 'exact, ^prefix, suffix$, !negate, term1 | term2
function parseFzfQuery(query) {
    // Split by spaces, but group | as OR
    const tokens = query.split(/\s+/).filter(Boolean);
    const groups = []; // array of OR-groups, each is array of terms
    let currentGroup = [];

    for (const token of tokens) {
        if (token === '|') continue; // standalone pipe
        if (token.startsWith('|')) {
            currentGroup.push(parseToken(token.slice(1)));
        } else if (token.endsWith('|')) {
            currentGroup.push(parseToken(token.slice(0, -1)));
            groups.push(currentGroup);
            currentGroup = [];
        } else {
            if (currentGroup.length > 0) {
                groups.push(currentGroup);
                currentGroup = [];
            }
            currentGroup = [parseToken(token)];
        }
    }
    if (currentGroup.length > 0) groups.push(currentGroup);
    return groups;
}

function parseToken(token) {
    let negate = false, type = 'fuzzy', text = token;
    if (text.startsWith('!')) {
        negate = true;
        text = text.slice(1);
    }
    if (text.startsWith("'") && text.endsWith("'") && text.length > 2) {
        type = 'exact';
        text = text.slice(1, -1);
    } else if (text.startsWith("'")) {
        type = 'exact';
        text = text.slice(1);
    } else if (text.startsWith('^')) {
        type = 'prefix';
        text = text.slice(1);
    } else if (text.endsWith('$')) {
        type = 'suffix';
        text = text.slice(0, -1);
    }
    return {type, text, negate};
}

// Score bonus for substring/exact matches over fuzzy-only
const SCORE_SUBSTRING_BONUS = 1000;
const SCORE_EXACT_BONUS = 2000;      // full string match
const SCORE_PREFIX_BONUS = 1500;

// Score a single token against a value. Returns score > 0 for match, 0 for no match.
function scoreToken(token, value) {
    const v = value.toLowerCase(), t = token.text.toLowerCase();
    switch (token.type) {
        case 'exact':
            return v.includes(t) ? SCORE_SUBSTRING_BONUS + t.length * SCORE_MATCH : 0;
        case 'prefix':
            return v.startsWith(t) ? SCORE_PREFIX_BONUS + t.length * SCORE_MATCH : 0;
        case 'suffix':
            return v.endsWith(t) ? SCORE_SUBSTRING_BONUS + t.length * SCORE_MATCH : 0;
        case 'fuzzy': {
            // Try exact/substring first — always prioritized
            if (v === t) return SCORE_EXACT_BONUS + t.length * SCORE_MATCH;
            if (v.includes(t)) return SCORE_SUBSTRING_BONUS + t.length * SCORE_MATCH;
            // Fuzzy fallback
            const m = fzfMatch(token.text, value);
            return m ? m.score : 0;
        }
    }
    return 0;
}

// Unified search: checks fields against fzf-style query.
// mode: 'fuzzy' (default) or 'regex'
// Returns score > 0 for match, 0 for no match. Use searchMatch() for boolean.
function searchScore(query, fields, mode) {
    if (!query) return 1; // empty query matches everything
    if (mode === 'regex') {
        try {
            const re = new RegExp(query, 'i');
            return fields.some(f => re.test(f)) ? 1 : 0;
        } catch {
            return fields.some(f => f.toLowerCase().includes(query.toLowerCase())) ? 1 : 0;
        }
    }
    const groups = parseFzfQuery(query);
    let totalScore = 0;
    // All groups must match (AND between groups)
    for (const orGroup of groups) {
        let bestGroupScore = 0;
        for (const token of orGroup) {
            let tokenBest = 0;
            for (let fi = 0; fi < fields.length; fi++) {
                // First field (name) gets 500 bonus, subsequent fields get less
                const fieldBonus = fi === 0 ? 500 : 0;
                const s = scoreToken(token, fields[fi]);
                if (s > 0 && s + fieldBonus > tokenBest) tokenBest = s + fieldBonus;
            }
            if (token.negate) {
                if (tokenBest > 0) return 0; // negated term matched => fail
                bestGroupScore = 1; // negated term didn't match => pass
            } else {
                if (tokenBest > bestGroupScore) bestGroupScore = tokenBest;
            }
        }
        if (bestGroupScore === 0) return 0; // group didn't match
        totalScore += bestGroupScore;
    }
    return totalScore;
}

// Boolean wrapper for backward compat
function searchMatch(query, fields, mode) {
    return searchScore(query, fields, mode) > 0;
}

// Get best fuzzy match indices for highlighting a single field
function getMatchIndices(query, text, mode) {
    if (!query || !text || mode === 'regex') {
        if (mode === 'regex' && query) {
            try {
                const re = new RegExp(query, 'ig');
                const indices = [];
                let m;
                while ((m = re.exec(text)) !== null) {
                    for (let i = m.index; i < m.index + m[0].length; i++) indices.push(i);
                }
                return indices;
            } catch {
                return [];
            }
        }
        return [];
    }
    // For fzf mode, collect indices from all fuzzy tokens
    const groups = parseFzfQuery(query);
    const allIndices = new Set();
    for (const group of groups) {
        for (const token of group) {
            if (token.negate) continue;
            if (token.type === 'fuzzy') {
                const m = fzfMatch(token.text, text);
                if (m) m.indices.forEach(i => allIndices.add(i));
            } else {
                const t = token.text.toLowerCase();
                const idx = text.toLowerCase().indexOf(t);
                if (idx >= 0) {
                    for (let i = idx; i < idx + t.length; i++) allIndices.add(i);
                }
            }
        }
    }
    return [...allIndices].sort((a, b) => a - b);
}

function highlightWithIndices(text, indices) {
    if (!text) return '';
    if (!indices || indices.length === 0) return escapeHtml(text);
    const idxSet = new Set(indices);
    let result = '';
    let inMark = false;
    for (let i = 0; i < text.length; i++) {
        const ch = escapeHtml(text[i]);
        if (idxSet.has(i)) {
            if (!inMark) {
                result += '<mark class="fzf-hl">';
                inMark = true;
            }
            result += ch;
        } else {
            if (inMark) {
                result += '</mark>';
                inMark = false;
            }
            result += ch;
        }
    }
    if (inMark) result += '</mark>';
    return result;
}

/**
 * Mirror of `parse_name_path_prefixes` (Rust `db.rs`) — keeps the highlight in sync
 * with what the server-side filter actually applies. Strips `name:<value>` and
 * `path:<value>` (quoted with `"..."` or bare) tokens out of the input and returns
 * them alongside the residual general search. In regex mode the input is passed
 * through unchanged because `name:` could be intentional regex syntax.
 */
function parseNamePathPrefixes(rawQuery, mode) {
    const empty = {residual: '', nameValues: [], pathValues: []};
    if (!rawQuery) return empty;
    if (mode === 'regex') return {residual: rawQuery, nameValues: [], pathValues: []};

    const nameValues = [];
    const pathValues = [];
    const residualParts = [];
    const chars = Array.from(rawQuery);
    let i = 0;
    while (i < chars.length) {
        while (i < chars.length && /\s/.test(chars[i])) i++;
        if (i >= chars.length) break;
        const lower = chars.slice(i, i + 5).join('').toLowerCase();
        let prefix = null;
        if (lower === 'name:') prefix = 'name';
        else if (lower === 'path:') prefix = 'path';
        if (prefix) {
            i += 5;
            const v = readNamePathTokenValue(chars, () => i, (n) => { i = n; });
            if (v) (prefix === 'name' ? nameValues : pathValues).push(v);
            continue;
        }
        const v = readNamePathTokenValue(chars, () => i, (n) => { i = n; });
        if (v) residualParts.push(v);
    }
    return {
        residual: residualParts.join(' '),
        nameValues,
        pathValues,
    };
}

function readNamePathTokenValue(chars, getI, setI) {
    let i = getI();
    if (i >= chars.length) return '';
    if (chars[i] === '"') {
        i++;
        let out = '';
        while (i < chars.length) {
            const c = chars[i];
            if (c === '\\' && i + 1 < chars.length) {
                out += chars[i + 1];
                i += 2;
                continue;
            }
            if (c === '"') {
                setI(i + 1);
                return out.trim();
            }
            out += c;
            i++;
        }
        setI(i);
        return out.trim();
    }
    const start = i;
    while (i < chars.length && !/\s/.test(chars[i])) i++;
    setI(i);
    return chars.slice(start, i).join('').trim();
}

/**
 * Build a column-specific highlight query for a row text cell. `column` is one of:
 *   - `'name'`  — residual + `name:<val>` tokens
 *   - `'path'`  — residual + `path:<val>` tokens
 *   - `'other'` — residual only (e.g. format / size / bpm columns the prefix doesn't touch)
 *   - undefined — pass through unchanged (callers without prefix awareness)
 *
 * Multi-word values are re-quoted so `parseFzfQuery` keeps them as a single phrase.
 */
function buildColumnHighlightQuery(rawQuery, mode, column) {
    if (!rawQuery || !column) return rawQuery || '';
    if (mode === 'regex') return rawQuery;
    const plan = parseNamePathPrefixes(rawQuery, mode);
    if (plan.nameValues.length === 0 && plan.pathValues.length === 0) return rawQuery;
    const tokens =
        column === 'name' ? plan.nameValues :
        column === 'path' ? plan.pathValues :
        [];
    const parts = [];
    if (plan.residual) parts.push(plan.residual);
    for (const t of tokens) parts.push(t.includes(' ') ? `"${t}"` : t);
    return parts.join(' ');
}

// Highlight matched characters in text. Optional `column` ('name' | 'path' | 'other')
// makes the highlight aware of `name:` / `path:` prefix syntax — see
// `buildColumnHighlightQuery`.
function highlightMatch(text, query, mode, column) {
    if (!query || !text) return escapeHtml(text);
    const eff = column ? buildColumnHighlightQuery(query, mode, column) : query;
    if (!eff) return escapeHtml(text);
    return highlightWithIndices(text, getMatchIndices(eff, text, mode));
}

/**
 * When the DB matches on full `path` (FTS) but the UI shows only the basename, match indices may
 * exist only on `path`. Map those indices onto `name` when basename equals `name`. Optional
 * `column` argument enables `name:` / `path:` prefix-aware highlighting.
 */
function highlightBasenameFromPath(path, name, query, mode, column) {
    if (!query || !name) return escapeHtml(name);
    const eff = column ? buildColumnHighlightQuery(query, mode, column) : query;
    if (!eff) return escapeHtml(name);
    let idx = getMatchIndices(eff, name, mode);
    if (idx.length) return highlightWithIndices(name, idx);
    if (!path) return escapeHtml(name);
    idx = getMatchIndices(eff, path, mode);
    if (!idx.length) return escapeHtml(name);
    const basenameStart = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1;
    const pBase = path.slice(basenameStart);
    if (pBase.length !== name.length || pBase.toLowerCase() !== name.toLowerCase()) return escapeHtml(name);
    const mapped = idx.filter(i => i >= basenameStart && i < path.length).map(i => i - basenameStart);
    if (mapped.length === 0) return escapeHtml(name);
    return highlightWithIndices(name, mapped);
}

/**
 * Same idea for the directory column: matches may only appear in the full path prefix. Optional
 * `column` argument enables `name:` / `path:` prefix-aware highlighting.
 */
function highlightPathPrefixFromPath(path, dirField, query, mode, column) {
    if (!query || !dirField) return escapeHtml(dirField);
    const eff = column ? buildColumnHighlightQuery(query, mode, column) : query;
    if (!eff) return escapeHtml(dirField);
    let idx = getMatchIndices(eff, dirField, mode);
    if (idx.length) return highlightWithIndices(dirField, idx);
    if (!path) return escapeHtml(dirField);
    idx = getMatchIndices(eff, path, mode);
    if (!idx.length) return escapeHtml(dirField);
    const nPath = path.replace(/\\/g, '/');
    const nDir = dirField.replace(/\\/g, '/');
    if (!nPath.startsWith(nDir)) return escapeHtml(dirField);
    const mapped = idx.filter(i => i < nDir.length);
    if (mapped.length === 0) return escapeHtml(dirField);
    return highlightWithIndices(dirField, mapped);
}

/**
 * Apply search highlights to a name cell during scan DOM-toggle filtering.
 * Preserves .row-badge spans while replacing the text portion with highlighted HTML.
 */
function applyScanCellHighlight(cell, originalText, search, mode, hlFn) {
    if (!cell) return;
    // Preserve badge spans
    const badges = cell.querySelectorAll('.row-badge');
    const badgeHtml = Array.from(badges).map(b => b.outerHTML).join('');
    cell.innerHTML = (search ? hlFn(originalText, search, mode) : escapeHtml(originalText)) + badgeHtml;
}

// Extension-to-dropdown value mapping for auto-select
  // ===== end canonical block =====

  window.ZGui = window.ZGui || {};
  window.ZGui.fzf = {
    // core matcher + highlight
    fzfMatch, getMatchIndices, highlightWithIndices, highlightMatch, positionBonus, charClass,
    // full query engine (extended syntax: 'exact, ^prefix, suffix$, !negate, a | b, .*regex)
    parseFzfQuery, parseToken, scoreToken, searchScore, searchMatch, parseNamePathPrefixes,
    // column / path-aware highlight helpers
    buildColumnHighlightQuery, highlightBasenameFromPath, highlightPathPrefixFromPath, applyScanCellHighlight,
    // tunable scoring weights
    resetFzfParams, saveFzfParams, setParam: setFzfParam,
    defaults: FZF_DEFAULTS, bounds: FZF_BOUNDS,
    get weights() {
      return { SCORE_MATCH, SCORE_GAP_START, SCORE_GAP_EXTENSION, BONUS_BOUNDARY, BONUS_NON_WORD, BONUS_CAMEL, BONUS_CONSECUTIVE, BONUS_FIRST_CHAR_MULT };
    },
  };
})();
