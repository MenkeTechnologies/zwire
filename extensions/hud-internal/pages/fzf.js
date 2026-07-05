/* zwire HUD — fzf-style fuzzy match + per-char highlight, shared by our
 * HUD pages and the Cmd+F filter bar. Algorithm/constants identical to
 * audio-haxor/frontend/js/utils.js (a.k.a. "ahxor") and zpwrchrome/lib/fzf.js,
 * so matching + highlighting behave the same across MenkeTechnologies tools.
 * Exposed as window.ZBFzf (plain script — usable in pages and content scripts). */
(function () {
  'use strict';
  var SCORE_MATCH = 16, GAP_START = -3, GAP_EXT = -1,
      B_BOUNDARY = 9, B_NONWORD = 8, B_CAMEL = 7, B_CONSEC = 4, B_FIRST = 2;

  function charClass(c) {
    if (c >= 'a' && c <= 'z') return 1;
    if (c >= 'A' && c <= 'Z') return 2;
    if (c >= '0' && c <= '9') return 3;
    return 0;
  }
  function posBonus(prev, curr) {
    var pc = charClass(prev), cc = charClass(curr);
    if (pc === 0 && cc !== 0) return B_BOUNDARY;
    if (pc === 1 && cc === 2) return B_CAMEL;
    if (cc !== 0 && pc !== 0 && pc !== cc) return B_NONWORD;
    return 0;
  }

  function fzfMatch(needle, haystack) {
    haystack = haystack || '';
    var nLen = needle.length, hLen = haystack.length;
    if (nLen === 0) return { score: 0, indices: [] };
    if (nLen > hLen) return null;
    var nLower = needle.toLowerCase(), hLower = haystack.toLowerCase();
    var ni = 0, hi;
    for (hi = 0; hi < hLen && ni < nLen; hi++) if (hLower[hi] === nLower[ni]) ni++;
    if (ni < nLen) return null;

    var bestScore = -Infinity, bestIndices = null, starts = [];
    for (var i = 0; i <= hLen - nLen; i++) if (hLower[i] === nLower[0]) starts.push(i);
    for (var s = 0; s < starts.length; s++) {
      var start = starts[s], indices = [start], si = start, valid = true;
      for (var n = 1; n < nLen; n++) {
        var found = false;
        for (var h = si + 1; h < hLen; h++) {
          if (hLower[h] === nLower[n]) { indices.push(h); si = h; found = true; break; }
        }
        if (!found) { valid = false; break; }
      }
      if (!valid) continue;
      var score = 0, prevIdx = -2;
      for (var k = 0; k < indices.length; k++) {
        var idx = indices[k];
        score += SCORE_MATCH;
        var prev = idx > 0 ? haystack[idx - 1] : ' ';
        var bonus = posBonus(prev, haystack[idx]);
        if (k === 0) bonus *= B_FIRST;
        score += bonus;
        if (prevIdx === idx - 1) score += B_CONSEC;
        else if (k > 0) { var gap = idx - prevIdx - 1; score += GAP_START + GAP_EXT * (gap - 1); }
        prevIdx = idx;
      }
      if (score > bestScore) { bestScore = score; bestIndices = indices; }
    }
    if (!bestIndices) return null;
    return { score: bestScore, indices: bestIndices };
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  // Wrap matched chars in <mark class="fzf-hl">…</mark> (HTML-escaped output).
  function highlightWithIndices(text, indices) {
    if (!text) return '';
    if (!indices || indices.length === 0) return esc(text);
    var set = {}, i;
    for (i = 0; i < indices.length; i++) set[indices[i]] = 1;
    var out = '', inMark = false;
    for (i = 0; i < text.length; i++) {
      var ch = esc(text[i]);
      if (set[i]) { if (!inMark) { out += '<mark class="fzf-hl">'; inMark = true; } out += ch; }
      else { if (inMark) { out += '</mark>'; inMark = false; } out += ch; }
    }
    if (inMark) out += '</mark>';
    return out;
  }

  window.ZBFzf = { fzfMatch: fzfMatch, highlightWithIndices: highlightWithIndices, esc: esc };
})();
