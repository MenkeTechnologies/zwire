"use strict";

/* zwire new tab — the inline layout editor.
 *
 * Ports the way Vivaldi edits a Start Page: you customize it ON the page, not in a
 * settings tree. The bottom bar carries the layout switcher, the "Widgets" picker
 * and "Customize" (Vivaldi's Quick Settings); edit mode adds a per-widget menu
 * (Widget Size, width, configure, remove) and turns on drag-to-reorder for widgets
 * and dials. The HUD page (pages/newtab.html) is the same model from the other side
 * — library-level CRUD, import/export — and both write the same chrome.storage key.
 *
 * Every mutation goes through zntp-core and ZBNTP.commit, so nothing here decides
 * what a valid layout is; it only decides what the user is asked. All dialogs are
 * ZGui.modal (the vendored zgui-core copy) — no inline handlers, no innerHTML with
 * user data, per the extension CSP. */

var ZBEdit = (function () {
  var N = window.ZWIRE_NTP;
  var Z = window.ZGui || {};
  var editing = false;

  function el(tag, cls, text) { return window.ZBNTP.el(tag, cls, text); }
  function cfg() { return window.ZBNTP.config(); }
  function layout() { return N.activeLayout(cfg()); }
  function commit(next) { return window.ZBNTP.commit(next); }
  function toast(msg, type) {
    try { if (Z.toast && Z.toast.show) Z.toast.show(msg, 2200, type || ''); } catch (e) { /* no-op */ }
  }

  /* ------------------------------------------------------------ form modal */
  /* One dialog builder for every prompt on this page (add dial, configure widget,
   * quick settings, rename…). `onChange` makes a form LIVE — quick settings applies
   * as you drag a slider, the way Vivaldi's does; forms without it collect values
   * and hand them to `onSubmit` when OK is pressed.
   *
   * fields: [{ key, label, type:'text'|'url'|'select'|'range'|'check'|'color'|'image',
   *            value, options:[[value,label]], min, max, hint }] */
  function formModal(title, fields, opts) {
    opts = opts || {};
    var values = {};
    var form = el('div', 'ntp-form');

    fields.forEach(function (f) {
      values[f.key] = f.value;
      var row = el('label', 'ntp-form-row');
      row.appendChild(el('span', 'ntp-form-label', f.label));
      var input;
      if (f.type === 'select') {
        input = el('select', 'ntp-form-input');
        (f.options || []).forEach(function (o) {
          var op = el('option', null, o[1]);
          op.value = o[0];
          if (String(o[0]) === String(f.value)) op.selected = true;
          input.appendChild(op);
        });
      } else if (f.type === 'check') {
        input = el('input', 'ntp-form-check');
        input.type = 'checkbox';
        input.checked = !!f.value;
      } else if (f.type === 'range') {
        input = el('input', 'ntp-form-range');
        input.type = 'range';
        input.min = String(f.min);
        input.max = String(f.max);
        input.step = '1';
        input.value = String(f.value);
      } else if (f.type === 'image') {
        input = el('input', 'ntp-form-file');
        input.type = 'file';
        input.accept = 'image/*';
      } else {
        input = el('input', 'ntp-form-input');
        input.type = f.type === 'color' ? 'color' : 'text';
        input.value = f.value == null ? '' : String(f.value);
        if (f.placeholder) input.placeholder = f.placeholder;
      }
      var out = el('span', 'ntp-form-out', f.type === 'range' ? String(f.value) : '');

      function read() {
        if (f.type === 'check') return input.checked;
        if (f.type === 'range') return parseInt(input.value, 10);
        return input.value;
      }
      input.addEventListener(f.type === 'select' || f.type === 'check' || f.type === 'image' ? 'change' : 'input', function () {
        if (f.type === 'image') {
          readImage(input.files && input.files[0], function (dataUrl, err) {
            if (err) { toast(err, 'error'); return; }
            values[f.key] = dataUrl;
            if (opts.onChange) opts.onChange(f.key, dataUrl, values);
          });
          return;
        }
        values[f.key] = read();
        if (f.type === 'range') out.textContent = String(values[f.key]);
        if (opts.onChange) opts.onChange(f.key, values[f.key], values);
      });

      row.appendChild(input);
      if (f.type === 'range') row.appendChild(out);
      form.appendChild(row);
      if (f.hint) form.appendChild(el('div', 'ntp-form-hint', f.hint));
    });

    var actions = [];
    if (opts.onSubmit) {
      actions.push({ label: opts.okLabel || 'Save', primary: true, onClick: function () { opts.onSubmit(values); } });
      actions.push({ label: 'Cancel' });
    } else {
      actions.push({ label: opts.okLabel || 'Done', primary: true });
    }
    if (opts.extraActions) actions = opts.extraActions.concat(actions);
    if (Z.modal && Z.modal.open) return Z.modal.open({ title: title, body: form, actions: actions, small: !!opts.small });
    return null;
  }

  /* A wallpaper goes into chrome.storage.local, which is a few megabytes for the
   * whole profile — an untouched phone photo would blow the quota and take every
   * other layout down with it. Downscale to at most 1920px wide and re-encode
   * before it ever reaches the model. */
  function readImage(file, cb) {
    if (!file) { cb('', 'no file'); return; }
    if (!/^image\//.test(file.type)) { cb('', 'not an image'); return; }
    var reader = new FileReader();
    reader.onerror = function () { cb('', 'could not read that file'); };
    reader.onload = function () {
      var img = new Image();
      img.onerror = function () { cb('', 'could not decode that image'); };
      img.onload = function () {
        var max = 1920;
        var scale = Math.min(1, max / (img.naturalWidth || max));
        var c = document.createElement('canvas');
        c.width = Math.max(1, Math.round((img.naturalWidth || max) * scale));
        c.height = Math.max(1, Math.round((img.naturalHeight || max) * scale));
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        try { cb(c.toDataURL('image/jpeg', 0.82), null); } catch (e) { cb('', 'could not encode that image'); }
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  }

  /* A short list of buttons in a modal — the "menu" this page uses instead of a
   * native context menu (which an extension page cannot style). */
  function menuModal(title, items) {
    var host = el('div', 'ntp-menu');
    var m = null;
    items.filter(Boolean).forEach(function (it) {
      var b = el('button', 'ntp-menu-item' + (it.danger ? ' is-danger' : '') + (it.active ? ' is-active' : ''), it.label);
      b.type = 'button';
      if (it.sub) b.appendChild(el('span', 'ntp-menu-sub', it.sub));
      b.addEventListener('click', function () { if (m) m.close(); it.run(); });
      host.appendChild(b);
    });
    if (Z.modal && Z.modal.open) m = Z.modal.open({ title: title, body: host, actions: [{ label: 'Close' }], small: true });
    return m;
  }

  /* --------------------------------------------------------------- layouts */
  function layoutMenu() {
    var c = cfg();
    var items = c.layouts.map(function (l) {
      return {
        label: l.name, active: l.id === c.activeId,
        sub: l.pages.length + (l.pages.length === 1 ? ' group' : ' groups'),
        run: function () { commit(N.setActiveLayout(cfg(), l.id)); toast('layout: ' + l.name); }
      };
    });
    items.push({ label: '+ New layout', run: newLayout });
    items.push({ label: 'Duplicate this layout', run: function () { commit(N.duplicateLayout(cfg(), cfg().activeId)); toast('layout duplicated'); } });
    items.push({ label: 'Rename this layout', run: renameLayout });
    items.push({ label: 'Manage layouts…', run: openManager });
    if (c.layouts.length > 1) items.push({ label: 'Delete this layout', danger: true, run: deleteLayout });
    menuModal('Layouts', items);
  }
  function newLayout() {
    formModal('New layout', [{ key: 'name', label: 'Name', type: 'text', value: '' }], {
      small: true, okLabel: 'Create',
      onSubmit: function (v) { commit(N.createLayout(cfg(), v.name)); toast('layout created'); }
    });
  }
  function renameLayout() {
    var l = layout();
    formModal('Rename layout', [{ key: 'name', label: 'Name', type: 'text', value: l.name }], {
      small: true, onSubmit: function (v) { commit(N.renameLayout(cfg(), l.id, v.name)); }
    });
  }
  function deleteLayout() {
    var l = layout();
    if (!Z.modal || !Z.modal.confirm) { commit(N.removeLayout(cfg(), l.id)); return; }
    Z.modal.confirm({ title: 'Delete layout', message: 'Delete "' + l.name + '"? This cannot be undone.' })
      .then(function (ok) { if (ok) { commit(N.removeLayout(cfg(), l.id)); toast('layout deleted'); } });
  }
  function openManager() {
    // The HUD layout manager lives in the OTHER extension. Its `pages/*` are declared
    // web-accessible (hud-internal manifest), which is what lets this top-level
    // navigation across extensions resolve — verified against this build, and the
    // same route palette.js already takes to the HUD's CI page.
    window.location.href = 'chrome-extension://omcgnnjfmbmpdlofklbpddkhnfibfhgg/pages/newtab.html';
  }

  /* ---------------------------------------------------------------- groups */
  function groupMenu() {
    var l = layout();
    var items = l.pages.map(function (p, i) {
      return {
        label: p.name, active: p.id === l.activePageId, sub: (i + 1) + ' · ' + p.dials.length + ' dials',
        run: function () { commit(N.setActivePage(cfg(), l.id, p.id)); }
      };
    });
    items.push({ label: '+ New group', run: function () {
      formModal('New Speed Dial group', [{ key: 'name', label: 'Name', type: 'text', value: '' }], {
        small: true, okLabel: 'Create',
        onSubmit: function (v) { commit(N.addPage(cfg(), layout().id, v.name)); }
      });
    } });
    items.push({ label: 'Rename this group', run: function () {
      var p = N.activePage(layout());
      formModal('Rename group', [{ key: 'name', label: 'Name', type: 'text', value: p.name }], {
        small: true, onSubmit: function (v) { commit(N.renamePage(cfg(), layout().id, p.id, v.name)); }
      });
    } });
    if (l.pages.length > 1) items.push({ label: 'Delete this group', danger: true, run: function () {
      var p = N.activePage(layout());
      commit(N.removePage(cfg(), l.id, p.id));
      toast('group deleted');
    } });
    menuModal('Speed Dial groups', items);
  }

  /* ----------------------------------------------------------------- dials */
  function addDial(pageId) {
    formModal('Add Speed Dial', [
      { key: 'url', label: 'Address', type: 'url', value: '', placeholder: 'example.com' },
      { key: 'label', label: 'Title', type: 'text', value: '', placeholder: 'optional' }
    ], {
      small: true, okLabel: 'Add',
      onSubmit: function (v) {
        if (!N.safeUrl(v.url)) { toast('that address cannot be opened', 'error'); return; }
        commit(N.addDial(cfg(), layout().id, pageId, { url: v.url, label: v.label }));
      }
    });
  }
  function editDial(pageId, dialId) {
    var page = N.pageById(layout(), pageId);
    var d = (page.dials || []).filter(function (x) { return x.id === dialId; })[0];
    if (!d) return;
    formModal('Edit Speed Dial', [
      { key: 'url', label: 'Address', type: 'url', value: d.url },
      { key: 'label', label: 'Title', type: 'text', value: d.label },
      { key: 'thumb', label: 'Custom thumbnail', type: 'image', value: d.thumb,
        hint: d.thumb ? 'A custom thumbnail is set — pick another to replace it.' : 'Optional: replaces the site favicon.' }
    ], {
      onSubmit: function (v) { commit(N.updateDial(cfg(), layout().id, pageId, dialId, v)); },
      extraActions: d.thumb ? [{ label: 'Clear thumbnail', onClick: function () {
        commit(N.updateDial(cfg(), layout().id, pageId, dialId, { thumb: '' }));
      } }] : null
    });
  }
  function dialMenu(pageId, dialId) {
    var l = layout();
    var items = [
      { label: 'Edit', run: function () { editDial(pageId, dialId); } },
      { label: 'Remove', danger: true, run: function () { commit(N.removeDial(cfg(), l.id, pageId, dialId)); } }
    ];
    l.pages.forEach(function (p) {
      if (p.id === pageId) return;
      items.splice(1, 0, { label: 'Move to "' + p.name + '"', run: function () {
        commit(N.moveDialToPage(cfg(), l.id, pageId, dialId, p.id));
      } });
    });
    menuModal('Speed Dial', items);
  }

  /* --------------------------------------------------------------- widgets */
  function widgetPicker() {
    var page = N.activePage(layout());
    var host = el('div', 'ntp-picker');
    var m = null;
    N.WIDGETS.forEach(function (spec) {
      var present = page.widgets.some(function (w) { return w.type === spec.type; });
      var taken = spec.single && present;
      var b = el('button', 'ntp-pick' + (taken ? ' is-taken' : ''));
      b.type = 'button';
      b.disabled = !!taken;
      b.appendChild(el('span', 'ntp-pick-glyph', spec.glyph));
      b.appendChild(el('span', 'ntp-pick-label', spec.label));
      b.appendChild(el('span', 'ntp-pick-sub', taken ? 'already on this group' : (spec.single ? 'one per group' : 'add as many as you like')));
      b.addEventListener('click', function () {
        if (m) m.close();
        addWidget(spec);
      });
      host.appendChild(b);
    });
    if (Z.modal && Z.modal.open) m = Z.modal.open({ title: 'Widgets', body: host, actions: [{ label: 'Close' }] });
  }
  function addWidget(spec) {
    var page = N.activePage(layout());
    // A widget that needs a target (a URL, a folder) is configured on the way in,
    // so it never lands on the page as an empty box.
    if (spec.type === 'webpage') {
      formModal('Webpage widget', [{ key: 'url', label: 'Address', type: 'url', value: '', placeholder: 'example.com' }], {
        small: true, okLabel: 'Add',
        onSubmit: function (v) {
          if (!N.safeUrl(v.url)) { toast('that address cannot be framed', 'error'); return; }
          commit(N.addWidget(cfg(), layout().id, page.id, 'webpage', { url: v.url }));
        }
      });
      return;
    }
    if (spec.type === 'bookmarks') { bookmarkFolderPicker(page.id); return; }
    commit(N.addWidget(cfg(), layout().id, page.id, spec.type, {}));
    toast(spec.label + ' added');
  }
  function bookmarkFolderPicker(pageId, widgetId) {
    var fallback = [['1', 'Bookmarks bar'], ['2', 'Other bookmarks']];
    function show(options) {
      formModal('Bookmarks widget', [{ key: 'folderId', label: 'Folder', type: 'select', value: options[0][0], options: options }], {
        small: true, okLabel: widgetId ? 'Save' : 'Add',
        onSubmit: function (v) {
          var name = (options.filter(function (o) { return o[0] === v.folderId; })[0] || [null, ''])[1];
          var patch = { folderId: v.folderId, folderName: name, count: 8 };
          commit(widgetId
            ? N.updateWidget(cfg(), layout().id, pageId, widgetId, { cfg: patch })
            : N.addWidget(cfg(), layout().id, pageId, 'bookmarks', patch));
        }
      });
    }
    try {
      chrome.bookmarks.getTree(function (tree) {
        if (chrome.runtime.lastError || !tree) { show(fallback); return; }
        var out = [];
        (function walk(nodes, depth) {
          (nodes || []).forEach(function (n) {
            if (n.url) return;
            if (n.id !== '0') out.push([n.id, new Array(depth + 1).join('  ') + (n.title || 'Bookmarks')]);
            walk(n.children, n.id === '0' ? depth : depth + 1);
          });
        })(tree, 0);
        show(out.length ? out : fallback);
      });
    } catch (e) { show(fallback); }
  }

  function widgetMenu(widgetId) {
    var l = layout(), page = N.activePage(l);
    var w = (page.widgets || []).filter(function (x) { return x.id === widgetId; })[0];
    if (!w) return;
    var spec = N.WIDGET_BY_TYPE[w.type];
    var items = [];
    if (spec.sizes) {
      N.SIZES.forEach(function (s) {
        items.push({ label: 'Widget size: ' + (s === 'tall' ? 'Tall' : 'Regular'), active: w.size === s,
          run: function () { commit(N.updateWidget(cfg(), l.id, page.id, w.id, { size: s })); } });
      });
    }
    items.push({ label: 'Width…', sub: w.span + ' of ' + N.MAX_SPAN, run: function () {
      formModal(spec.label + ' width', [{ key: 'span', label: 'Columns', type: 'range', value: w.span, min: 1, max: N.MAX_SPAN }], {
        small: true, onChange: function (k, v) { commit(N.updateWidget(cfg(), l.id, page.id, w.id, { span: v })); }
      });
    } });
    if (spec.cfg.indexOf('count') >= 0) items.push({ label: 'Rows…', sub: String((w.cfg && w.cfg.count) || 8), run: function () {
      formModal(spec.label + ' rows', [{ key: 'count', label: 'Rows', type: 'range', value: (w.cfg && w.cfg.count) || 8, min: 1, max: 20 }], {
        small: true, onChange: function (k, v) {
          var patch = JSON.parse(JSON.stringify(w.cfg || {}));
          patch.count = v;
          commit(N.updateWidget(cfg(), l.id, page.id, w.id, { cfg: patch }));
        }
      });
    } });
    if (w.type === 'webpage') items.push({ label: 'Address…', sub: (w.cfg && w.cfg.url) || '', run: function () {
      formModal('Webpage widget', [{ key: 'url', label: 'Address', type: 'url', value: (w.cfg && w.cfg.url) || '' }], {
        small: true, onSubmit: function (v) { commit(N.updateWidget(cfg(), l.id, page.id, w.id, { cfg: { url: v.url } })); }
      });
    } });
    if (w.type === 'bookmarks') items.push({ label: 'Folder…', sub: (w.cfg && w.cfg.folderName) || '', run: function () { bookmarkFolderPicker(page.id, w.id); } });
    if (w.type === 'feeds') items.push({ label: 'Feed…', sub: (w.cfg && w.cfg.feedUrl) || 'all feeds', run: function () {
      formModal('Feeds widget', [{ key: 'feedUrl', label: 'Feed URL', type: 'url', value: (w.cfg && w.cfg.feedUrl) || '',
        placeholder: 'blank = every subscribed feed' }], {
        small: true, onSubmit: function (v) {
          var patch = JSON.parse(JSON.stringify(w.cfg || {}));
          patch.feedUrl = v.feedUrl;
          commit(N.updateWidget(cfg(), l.id, page.id, w.id, { cfg: patch }));
        }
      });
    } });
    items.push({ label: 'Remove widget', danger: true, run: function () { commit(N.removeWidget(cfg(), l.id, page.id, w.id)); } });
    menuModal(spec.label, items);
  }

  /* -------------------------------------------------------- quick settings */
  /* Vivaldi's "Quick Settings" popover: start-page navigation, background, and the
   * Speed Dial appearance block, all applying live. */
  function quickSettings() {
    var l = layout();
    formModal('Customize start page', [
      { key: 'navpos', label: 'Navigation', type: 'select', value: l.nav.pos,
        options: N.NAV_POS.map(function (p) { return [p, p.charAt(0).toUpperCase() + p.slice(1)]; }) },
      { key: 'navshow', label: 'Show navigation', type: 'select', value: l.nav.show,
        options: [['always', 'Always'], ['start', 'On start pages'], ['hidden', 'Hide']] },
      { key: 'columns', label: 'Maximum columns', type: 'range', value: l.dial.columns, min: 0, max: N.MAX_COLUMNS,
        hint: '0 = no limit, the way Vivaldi\'s "No limit" works.' },
      { key: 'thumb', label: 'Thumbnail size', type: 'range', value: l.dial.thumb, min: 1, max: N.MAX_THUMB },
      { key: 'titles', label: 'Speed Dial titles', type: 'select', value: l.dial.titles,
        options: [['always', 'Always show'], ['auto', 'When needed'], ['never', 'Never show']] },
      { key: 'showAdd', label: 'Show the Add button', type: 'check', value: l.dial.showAdd },
      { key: 'dragReorder', label: 'Reorder by drag and drop', type: 'check', value: l.dial.dragReorder },
      { key: 'bgkind', label: 'Background', type: 'select', value: l.bg.kind,
        options: [['none', 'None'], ['color', 'Color'], ['gradient', 'Gradient'], ['image', 'Image']] },
      { key: 'bgcolor', label: 'Background color', type: 'color', value: /^#/.test(l.bg.value) ? l.bg.value : '#05050a' },
      { key: 'bgimage', label: 'Background image', type: 'image', value: '' }
    ], {
      onChange: function (key, value, all) {
        var id = layout().id;
        if (key === 'navpos') commit(N.setLayoutPrefs(cfg(), id, { nav: { pos: value } }));
        else if (key === 'navshow') commit(N.setLayoutPrefs(cfg(), id, { nav: { show: value } }));
        // Switching KIND keeps whatever value that kind already had, except color,
        // which adopts the picker's current swatch so the change is visible at once.
        else if (key === 'bgkind') commit(N.setLayoutPrefs(cfg(), id, { bg: { kind: value, value: value === 'color' ? all.bgcolor : layout().bg.value } }));
        else if (key === 'bgcolor') commit(N.setLayoutPrefs(cfg(), id, { bg: { kind: 'color', value: value } }));
        else if (key === 'bgimage') commit(N.setLayoutPrefs(cfg(), id, { bg: { kind: 'image', value: value } }));
        else commit(N.setLayoutPrefs(cfg(), id, { dial: keyed(key, value) }));
      }
    });
  }
  function keyed(k, v) { var o = {}; o[k] = v; return o; }

  /* ------------------------------------------------------------- edit mode */
  function setEditing(v) {
    editing = !!v;
    document.getElementById('app').classList.toggle('is-editing', editing);
    window.ZBNTP.render();
  }
  function isEditing() { return editing; }

  /* Decorate a fresh paint: menu buttons on every widget, drag on the grid and the
   * dial grid. Runs on every render (the DOM is rebuilt each time), so listeners
   * never accumulate on stale nodes. */
  function decorate(l, page) {
    var grid = document.getElementById('ntp-grid');
    if (!grid) return;

    if (editing) {
      Array.prototype.forEach.call(grid.querySelectorAll('.ntp-w'), function (box) {
        var id = box.dataset.widgetId;
        var bar = el('div', 'ntp-w-edit');
        var handle = el('span', 'ntp-w-grip', '⠿');
        handle.title = 'Drag to reorder';
        var menu = el('button', 'ntp-w-menu', '⋯');
        menu.type = 'button';
        menu.title = 'Widget menu';
        menu.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); widgetMenu(id); });
        bar.appendChild(handle);
        bar.appendChild(menu);
        box.appendChild(bar);
      });
    }

    if (editing && Z.drag && Z.drag.init) {
      Z.drag.init(grid, '.ntp-w', null, {
        direction: 'horizontal', handleSelector: '.ntp-w-grip',
        getKey: function (e) { return e.dataset.widgetId; },
        onReorder: function () {
          commit(N.orderWidgets(cfg(), l.id, page.id, ids(grid, '.ntp-w', 'widgetId')));
        }
      });
    }

    var dialGrid = grid.querySelector('.ntp-dials');
    if (dialGrid && l.dial.dragReorder && Z.drag && Z.drag.init) {
      Z.drag.init(dialGrid, '.ntp-dial:not(.ntp-dial-add)', null, {
        direction: 'horizontal',
        getKey: function (e) { return e.dataset.dialId; },
        onReorder: function () {
          commit(N.orderDials(cfg(), l.id, page.id, ids(dialGrid, '.ntp-dial[data-dial-id]', 'dialId')));
        }
      });
    }
    // Right-click a dial for its menu (edit / move to another group / remove) —
    // the same actions Vivaldi hangs off a dial's own context menu.
    if (dialGrid) {
      dialGrid.addEventListener('contextmenu', function (e) {
        var a = e.target.closest ? e.target.closest('.ntp-dial[data-dial-id]') : null;
        if (!a) return;
        e.preventDefault();
        dialMenu(page.id, a.dataset.dialId);
      });
    }
  }
  function ids(host, sel, key) {
    return Array.prototype.map.call(host.querySelectorAll(sel), function (e) { return e.dataset[key]; });
  }

  /* --------------------------------------------------------------- toolbar */
  function button(cls, label, title, onClick) {
    var b = el('button', 'ntp-bar-btn ' + cls, label);
    b.type = 'button';
    b.title = title;
    b.addEventListener('click', onClick);
    return b;
  }
  function buildToolbar() {
    var host = document.getElementById('ntp-bar');
    if (!host) return;
    var name = el('span', 'ntp-bar-name');
    var layoutBtn = button('is-layout', '', 'Switch layout', layoutMenu);
    layoutBtn.appendChild(name);
    host.appendChild(layoutBtn);
    host.appendChild(button('', 'Groups', 'Speed Dial groups', groupMenu));
    host.appendChild(button('', 'Widgets', 'Add a widget to this group', widgetPicker));
    host.appendChild(button('', 'Customize', 'Start page settings', quickSettings));
    var edit = button('is-edit', 'Edit', 'Rearrange widgets and dials', function () { setEditing(!editing); });
    host.appendChild(edit);
    window.ZBNTP.onRender(function (l, page) {
      name.textContent = l.name + ' · ' + page.name;
      edit.classList.toggle('is-on', editing);
      edit.textContent = editing ? 'Done' : 'Edit';
      decorate(l, page);
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    buildToolbar();
    // The toolbar registers its render hook after the first paint has already run,
    // so ask for one more so the layout name and any edit chrome show immediately.
    if (window.ZBNTP.painted()) window.ZBNTP.render();
  });

  return {
    addDial: addDial, editDial: editDial, dialMenu: dialMenu,
    widgetPicker: widgetPicker, widgetMenu: widgetMenu, quickSettings: quickSettings,
    layoutMenu: layoutMenu, groupMenu: groupMenu, newLayout: newLayout,
    setEditing: setEditing, isEditing: isEditing, openManager: openManager
  };
})();

window.ZBEdit = ZBEdit;
