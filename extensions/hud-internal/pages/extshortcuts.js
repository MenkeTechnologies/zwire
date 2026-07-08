/* zwire HUD — Extension shortcuts. Every installed extension's keyboard
 * commands in one table (chrome://extensions/shortcuts only shows them one
 * expander at a time) — AND rebind them right here: click a row, press the new
 * combo. Rebinding uses chrome.developerPrivate (the same private API the native
 * shortcuts page uses); data comes from getExtensionsInfo. All UI is ZGui.* per
 * the zgui-core-only rule. */
(function () {
  'use strict';
  var Z = window.ZGui;
  var esc = (Z.util && Z.util.escapeHtml) || function (s) { return String(s == null ? '' : s); };
  var dp = chrome.developerPrivate;
  var IS_MAC = /Mac|iP(hone|ad|od)/.test(navigator.platform || navigator.userAgent || '');

  var shell = window.ZBHUD.mount({
    title: 'EXT SHORTCUTS', current: 'extshortcuts.html', filterPlaceholder: '>_ filter shortcuts…',
    onFilter: function (v, rx) { filter = (v || '').trim(); matchFn = window.ZBHUD.matcher(v, rx); draw(); }
  });
  var body = shell.body;

  var filter = '', matchFn = function () { return true; };
  var rows = [];
  var recording = null;   // the row currently capturing a new combo

  function load(cb) {
    try {
      if (dp && dp.getExtensionsInfo) {
        dp.getExtensionsInfo({ includeDisabled: false, includeTerminated: false }, function (list) {
          void chrome.runtime.lastError;
          var out = [];
          (list || []).forEach(function (e) {
            (e.commands || []).forEach(function (c) {
              out.push({ id: e.id, cmd: c.name, ext: e.name, desc: c.description || c.name, keybinding: c.keybinding || '', scope: c.scope || '' });
            });
          });
          if (out.length) { rows = out; cb(); return; }
          fromStore(cb);
        });
        return;
      }
    } catch (e) {}
    fromStore(cb);
  }
  function fromStore(cb) {
    try { chrome.storage.local.get('zb_shortcuts', function (o) { void chrome.runtime.lastError; rows = (o && o.zb_shortcuts) || []; cb(); }); }
    catch (e) { cb(); }
  }

  function matches(r) {
    return matchFn(r.ext + ' ' + r.desc + ' ' + (r.keybinding || ''));
  }
  function clip(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; }

  /* ---- key capture -> Chrome accelerator string --------------------------- */
  function keyToken(e) {
    var c = e.code || '';
    if (/^Key[A-Z]$/.test(c)) return c.slice(3);
    if (/^Digit[0-9]$/.test(c)) return c.slice(5);
    if (/^F([1-9]|1[0-9]|2[0-4])$/.test(c)) return c;
    switch (c) {
      case 'ArrowUp': return 'Up'; case 'ArrowDown': return 'Down';
      case 'ArrowLeft': return 'Left'; case 'ArrowRight': return 'Right';
      case 'Space': return 'Space'; case 'Home': return 'Home'; case 'End': return 'End';
      case 'PageUp': return 'PageUp'; case 'PageDown': return 'PageDown';
      case 'Insert': return 'Insert'; case 'Delete': return 'Delete';
      case 'Comma': return 'Comma'; case 'Period': return 'Period';
      case 'Tab': return 'Tab';
    }
    return null;   // modifier-only or unsupported key
  }
  // -> accelerator string | {incomplete:true} | null (ignore)
  function toAccelerator(e) {
    var key = keyToken(e);
    if (!key) return null;
    var mods = [];
    if (IS_MAC) { if (e.metaKey) mods.push('Command'); if (e.ctrlKey) mods.push('MacCtrl'); }
    else if (e.ctrlKey) mods.push('Ctrl');
    if (e.altKey) mods.push('Alt');
    if (e.shiftKey) mods.push('Shift');
    var hasPrimary = mods.some(function (m) { return m === 'Ctrl' || m === 'Alt' || m === 'Command' || m === 'MacCtrl'; });
    if (!hasPrimary) return { incomplete: true };   // Chrome requires Ctrl/Alt/⌘
    return mods.concat([key]).join('+');
  }
  function suspend(on) { try { if (dp && dp.setShortcutHandlingSuspended) dp.setShortcutHandlingSuspended(on); } catch (e) {} }
  function toast(m) { try { if (Z.toast) Z.toast.show(m); } catch (e) {} }

  function startRecord(r) {
    if (!dp || !dp.updateExtensionCommandKeybinding || !r || !r.id || !r.cmd) {
      openRebind(); return;   // no private API (store fallback) — bounce to Chrome
    }
    recording = r; suspend(true); draw();
  }
  function cancelRecord() { recording = null; suspend(false); draw(); }
  function applyRebind(r, accel) {
    suspend(false); recording = null;
    try {
      dp.updateExtensionCommandKeybinding({ extensionId: r.id, commandName: r.cmd, keybinding: accel }, function () {
        var err = chrome.runtime.lastError;
        if (err) { toast('Could not bind ' + accel + (err.message ? ' — ' + err.message : '')); }
        else { toast(r.desc + ' → ' + accel); }
        load(draw);
      });
    } catch (e) { toast('Rebind failed'); load(draw); }
  }
  document.addEventListener('keydown', function (e) {
    if (!recording) return;
    e.preventDefault(); e.stopImmediatePropagation();
    if (e.key === 'Escape') { cancelRecord(); return; }
    var a = toAccelerator(e);
    if (a == null) return;              // modifier-only — keep waiting
    if (a.incomplete) return;           // need a real modifier — keep waiting
    applyRebind(recording, a);
  }, true);

  function openRebind() {
    try { chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }); } catch (e) { window.open('chrome://extensions/shortcuts', '_blank'); }
  }

  var tableHost = document.createElement('div');
  function draw() {
    tableHost.innerHTML = '';
    var list = rows.filter(matches).slice().sort(function (a, b) {
      return a.ext.localeCompare(b.ext) || a.desc.localeCompare(b.desc);
    });
    if (!list.length) {
      tableHost.innerHTML = '<div class="ci-hint" style="padding:24px 4px;">' +
        (filter ? 'No extension shortcuts match “' + esc(filter) + '”.' : 'No extension keyboard shortcuts found.') + '</div>';
      return;
    }
    Z.dataTable(tableHost, {
      id: 'extkeys-table', resizable: true, sortScope: 'zb-extkeys',
      columns: [
        { key: 'ext', label: 'EXTENSION', width: '200px', render: function (r) { return '<span class="ci-repo">' + esc(clip(r.ext, 28)) + '</span>'; } },
        { key: 'desc', label: 'COMMAND', render: function (r) {
            return '<div class="ci-wf" title="' + esc(r.desc) + '" style="max-width:520px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + esc(clip(r.desc, 64)) + '</div>';
          } },
        { key: 'keybinding', label: 'SHORTCUT', width: '190px', render: function (r) {
            if (recording && recording.id === r.id && recording.cmd === r.cmd) {
              return '<span class="ci-when" style="color:var(--accent);">press keys… <span class="ci-num">⎋ cancel</span></span>';
            }
            return r.keybinding ? '<kbd>' + esc(r.keybinding) + '</kbd>' : '<span class="ci-num">click to set</span>';
          } }
      ],
      rows: list,
      onRowClick: function (r) { if (recording) cancelRecord(); else startRecord(r); }
    });
  }

  function buildToolbar() {
    var wrap = document.createElement('div'); wrap.className = 'ci-toolbar';
    var actions = document.createElement('div'); actions.className = 'ci-actions';
    actions.appendChild(Z.button({ label: '↻ REFRESH', variant: 'mini', onClick: function () { load(draw); } }));
    actions.appendChild(Z.button({ label: '⌨ CHROME PAGE', variant: 'mini', onClick: openRebind }));
    wrap.appendChild(actions);
    var hint = document.createElement('div'); hint.className = 'ci-hint';
    hint.innerHTML = '<b>Click any row and press the new combo to rebind</b> (needs Ctrl/Alt' + (IS_MAC ? '/⌘' : '') + '; Esc cancels). ' +
      'Chrome only ships up to 4 commands with default keys — the rest start unset.';
    var inner = document.createElement('div');
    inner.appendChild(wrap); inner.appendChild(hint);
    return Z.card({ body: inner }).el;
  }

  body.appendChild(buildToolbar());
  body.appendChild(tableHost);

  load(draw);
  try { chrome.storage.onChanged.addListener(function (ch, area) { if (area === 'local' && ch.zb_shortcuts && !recording) { load(draw); } }); } catch (e) {}
})();
