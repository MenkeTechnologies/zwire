/* zbrowser HUD Extensions manager — our own page replacing chrome://extensions.
 * Uses chrome.management for real list / enable-disable / remove. */
(function () {
  'use strict';
  var grid = document.getElementById('grid');
  var countEl = document.getElementById('count');
  var searchEl = document.getElementById('search');
  var all = [];

  function iconUrl(ext) {
    if (ext.icons && ext.icons.length) {
      return ext.icons.sort(function (a, b) { return b.size - a.size; })[0].url;
    }
    return null;
  }

  function render(filter) {
    filter = (filter || '').toLowerCase();
    grid.innerHTML = '';
    var shown = all.filter(function (e) {
      return e.type === 'extension' && (!filter || e.name.toLowerCase().indexOf(filter) !== -1);
    });
    countEl.textContent = shown.length;
    if (!shown.length) { grid.innerHTML = '<div class="footer-docs">[ no extensions ]</div>'; return; }
    shown.forEach(function (ext) {
      var card = document.createElement('div');
      card.className = 'product-card' + (ext.enabled ? '' : ' off');
      var ic = iconUrl(ext);
      var kind = ext.installType === 'development' ? 'UNPACKED' : String(ext.installType).toUpperCase();
      card.innerHTML =
        '<div class="product-thumb">' +
          '<span class="badge">' + esc(kind) + '</span>' +
          (ic ? '<img class="xt-icon" src="' + ic + '">' : '') +
        '</div>' +
        '<div class="product-body">' +
          '<span class="p-cat">' + (ext.enabled ? 'ENABLED' : 'DISABLED') + '</span>' +
          '<span class="p-name">' + esc(ext.name) + ' <span class="card-chip">v' + esc(ext.version) + '</span></span>' +
          '<span class="p-tag">' + esc(ext.description || '') + '</span>' +
          '<div class="xt-id">ID: ' + esc(ext.id) + '</div>' +
        '</div>' +
        '<div class="product-foot">' +
          '<div class="xt-foot">' +
            (ext.optionsUrl ? '<button class="xt-btn" data-act="options">OPTIONS</button>' : '') +
            (ext.mayDisable ? '<button class="xt-btn danger" data-act="remove">REMOVE</button>' : '<span class="badge">LOCKED</span>') +
            '<span class="grow"></span>' +
            '<div class="xt-toggle' + (ext.enabled ? ' on' : '') + '" data-act="toggle" title="enable/disable"></div>' +
          '</div>' +
        '</div>';
      card.querySelectorAll('[data-act]').forEach(function (el) {
        el.onclick = function (e) { e.preventDefault(); e.stopPropagation(); action(el.getAttribute('data-act'), ext); };
      });
      grid.appendChild(card);
    });
  }

  function action(act, ext) {
    if (act === 'toggle') {
      if (!ext.mayDisable) return;
      chrome.management.setEnabled(ext.id, !ext.enabled, function () { void chrome.runtime.lastError; refresh(); });
    } else if (act === 'remove') {
      chrome.management.uninstall(ext.id, { showConfirmDialog: true }, function () { void chrome.runtime.lastError; refresh(); });
    } else if (act === 'options' && ext.optionsUrl) {
      chrome.tabs ? chrome.tabs.create({ url: ext.optionsUrl }) : (window.location.href = ext.optionsUrl);
    }
  }

  var tries = 0;
  function refresh() {
    chrome.management.getAll(function (list) {
      if (chrome.runtime.lastError) { void chrome.runtime.lastError; }
      all = (list || []).slice().sort(function (a, b) { return a.name.localeCompare(b.name); });
      render(searchEl.value);
      // getAll can return empty right after the page loads; retry a few times.
      if (!all.length && tries < 8) { tries++; setTimeout(refresh, 400); }
    });
  }

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  if (searchEl) searchEl.addEventListener('input', function () { render(searchEl.value); });
  if (chrome.management && chrome.management.onInstalled) {
    chrome.management.onInstalled.addListener(refresh);
    chrome.management.onUninstalled.addListener(refresh);
    chrome.management.onEnabled.addListener(refresh);
    chrome.management.onDisabled.addListener(refresh);
  }
  refresh();
})();
