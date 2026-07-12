/* zwire HUD Translate (ports Vivaldi's Translate panel) — type text, pick source
 * (or auto-detect) + target language, get the translation live. As an extension
 * page it fetches the keyless Google translate endpoint directly (host_permissions
 * <all_urls>); no key, no external command. Swap languages, copy the result.
 *
 * The pure response parser + language list are exposed on window.ZBTranslate for
 * headless tests. */
(function () {
  'use strict';

  // Google translate_a/single returns [[["translated","src",…],…], …, "detected", …].
  function parseTranslation(json) {
    if (!json || !Array.isArray(json[0])) return { text: '', detected: '' };
    var text = json[0].map(function (seg) { return (seg && seg[0]) || ''; }).join('');
    return { text: text, detected: (json[2] || '') };
  }
  var LANGS = [
    ['en', 'English'], ['es', 'Spanish'], ['fr', 'French'], ['de', 'German'], ['it', 'Italian'],
    ['pt', 'Portuguese'], ['nl', 'Dutch'], ['ru', 'Russian'], ['uk', 'Ukrainian'], ['pl', 'Polish'],
    ['sv', 'Swedish'], ['da', 'Danish'], ['no', 'Norwegian'], ['fi', 'Finnish'], ['cs', 'Czech'],
    ['el', 'Greek'], ['tr', 'Turkish'], ['ar', 'Arabic'], ['he', 'Hebrew'], ['fa', 'Persian'],
    ['hi', 'Hindi'], ['bn', 'Bengali'], ['ja', 'Japanese'], ['ko', 'Korean'],
    ['zh-CN', 'Chinese (Simpl.)'], ['zh-TW', 'Chinese (Trad.)'], ['th', 'Thai'], ['vi', 'Vietnamese'],
    ['id', 'Indonesian'], ['ms', 'Malay'], ['ro', 'Romanian'], ['hu', 'Hungarian'], ['la', 'Latin']
  ];
  function langName(code) { for (var i = 0; i < LANGS.length; i++) if (LANGS[i][0] === code) return LANGS[i][1]; return code || ''; }
  function translateUrl(text, sl, tl) {
    return 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=' + encodeURIComponent(sl || 'auto')
      + '&tl=' + encodeURIComponent(tl || 'en') + '&dt=t&q=' + encodeURIComponent(text || '');
  }

  var ZBTranslate = { parseTranslation: parseTranslation, LANGS: LANGS, langName: langName, translateUrl: translateUrl };
  if (typeof window !== 'undefined') window.ZBTranslate = ZBTranslate;

  if (typeof window === 'undefined' || !window.ZBHUD || typeof chrome === 'undefined') return;   // headless: helpers only

  // ---- UI -------------------------------------------------------------------
  function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
  var shell = window.ZBHUD.mount({ title: 'TRANSLATE', current: 'translate.html' });
  var body = shell.body;

  var srcSel, tgtSel, srcTa, outBox, detBadge, timer = 0, reqId = 0;
  function build() {
    body.innerHTML = '';
    var wrap = el('div', 'zt-wrap');

    var bar = el('div', 'zt-bar');
    srcSel = el('select', 'zt-lang'); srcSel.appendChild(new Option('Detect language', 'auto'));
    LANGS.forEach(function (l) { srcSel.appendChild(new Option(l[1], l[0])); });
    var swap = el('button', 'zt-swap', '⇄'); swap.title = 'Swap languages';
    tgtSel = el('select', 'zt-lang'); LANGS.forEach(function (l) { tgtSel.appendChild(new Option(l[1], l[0])); });
    tgtSel.value = 'en';
    detBadge = el('span', 'zt-det');
    bar.appendChild(srcSel); bar.appendChild(swap); bar.appendChild(tgtSel); bar.appendChild(detBadge);
    wrap.appendChild(bar);

    var panes = el('div', 'zt-panes');
    srcTa = el('textarea', 'zt-src'); srcTa.placeholder = 'Enter text to translate…';
    var right = el('div', 'zt-out-wrap');
    outBox = el('div', 'zt-out'); outBox.textContent = '';
    var copy = el('button', 'zt-btn zt-copy', '⧉ Copy'); copy.addEventListener('click', function () { try { navigator.clipboard.writeText(outBox.textContent || ''); if (window.ZGui && ZGui.toast) ZGui.toast.show('copied'); } catch (e) {} });
    right.appendChild(outBox); right.appendChild(copy);
    panes.appendChild(srcTa); panes.appendChild(right);
    wrap.appendChild(panes);
    body.appendChild(wrap);

    srcTa.addEventListener('input', schedule);
    srcSel.addEventListener('change', run);
    tgtSel.addEventListener('change', run);
    swap.addEventListener('click', function () {
      var s = srcSel.value; if (s === 'auto') s = detBadge.dataset.code || 'en';
      srcSel.value = tgtSel.value; tgtSel.value = s;
      srcTa.value = outBox.textContent || srcTa.value; run();
    });
    srcTa.focus();
  }
  function schedule() { if (timer) clearTimeout(timer); timer = setTimeout(run, 350); }
  function run() {
    var text = (srcTa.value || '').trim();
    detBadge.textContent = ''; detBadge.dataset.code = '';
    if (!text) { outBox.textContent = ''; return; }
    outBox.textContent = '…';
    var id = ++reqId;
    fetch(translateUrl(text, srcSel.value, tgtSel.value))
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (id !== reqId) return;   // a newer request superseded this one
        var res = parseTranslation(j);
        outBox.textContent = res.text || '(no translation)';
        if (srcSel.value === 'auto' && res.detected) { detBadge.textContent = 'detected: ' + langName(res.detected); detBadge.dataset.code = res.detected; }
      })
      .catch(function () { if (id === reqId) outBox.textContent = 'translation unavailable (offline?)'; });
  }
  build();
})();
