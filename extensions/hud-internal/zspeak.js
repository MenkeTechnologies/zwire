/* zwire HUD — Read Aloud (ports Edge's Read Aloud). Speaks the current selection,
 * else the main article, else the page body, via the Web Speech API. Chunked on
 * sentence boundaries (speechSynthesis chokes on very long utterances). Toggle
 * from the ⌘K palette ("Read aloud") via window.__zbSpeakToggle().
 *
 * The pure sentence chunker is exposed as window.__zbSpeakChunks for tests. */
(function () {
  'use strict';

  function chunkText(text, max) {
    max = max || 220;
    text = String(text || '').replace(/\s+/g, ' ').trim();
    if (!text) return [];
    var sentences = text.match(/[^.!?]+[.!?]+\s*|[^.!?]+$/g) || [text];
    var chunks = [], cur = '';
    sentences.forEach(function (s) {
      if ((cur + s).length > max && cur) { chunks.push(cur.trim()); cur = s; }
      else cur += s;
    });
    if (cur.trim()) chunks.push(cur.trim());
    return chunks;
  }
  if (typeof window !== 'undefined') window.__zbSpeakChunks = chunkText;

  if (typeof window === 'undefined' || typeof document === 'undefined' || !window.speechSynthesis) return;
  if (window.__zbSpeakLoaded) return;
  window.__zbSpeakLoaded = true;

  var speaking = false;
  function gatherText() {
    var sel = ''; try { sel = String(window.getSelection ? window.getSelection().toString() : '').trim(); } catch (e) {}
    if (sel) return sel;
    var main = document.querySelector('article, main, [role=main], .post, .entry-content, .markdown-body');
    var src = main || document.body;
    var t = ''; try { t = (src && src.innerText) || ''; } catch (e) {}
    return t;
  }
  function stop() { try { window.speechSynthesis.cancel(); } catch (e) {} speaking = false; }
  function toggle() {
    if (speaking || window.speechSynthesis.speaking) { stop(); return; }
    var chunks = chunkText(gatherText(), 220);
    if (!chunks.length) return;
    speaking = true;
    var i = 0;
    function next() {
      if (!speaking || i >= chunks.length) { speaking = false; return; }
      var u = new SpeechSynthesisUtterance(chunks[i++]);
      u.rate = 1; u.onend = next; u.onerror = function () { speaking = false; };
      try { window.speechSynthesis.speak(u); } catch (e) { speaking = false; }
    }
    next();
  }
  window.__zbSpeakToggle = toggle;
  document.addEventListener('keydown', function (e) { if (speaking && e.key === 'Escape') stop(); }, true);
  window.addEventListener('beforeunload', stop);
})();
