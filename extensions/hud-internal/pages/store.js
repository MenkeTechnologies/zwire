/* zwire HUD — App Store page. Renders the paid-app catalog (store-catalog.js)
 * as zgui-core product cards, grouped by category and filterable, each linking
 * to the live product page to buy. Also drives the first-run welcome modal
 * (opened with ?welcome=1 by background.js on install) so the store is shown
 * once, up front — without touching the new-tab page. All UI is ZGui.* per the
 * zgui-core-only rule. */
(function () {
  'use strict';
  var S = window.ZWIRE_STORE || { PRODUCTS: [], FEATURED: [], BASE: '', url: function () { return '#'; } };
  var FZ = window.ZGui && ZGui.fzf;
  var body, query = '', regexOn = false;

  function el(t, c, h) { var e = document.createElement(t); if (c) e.className = c; if (h != null) e.innerHTML = h; return e; }
  function open(u) { try { chrome.tabs.create({ url: u }); } catch (e) { try { location.href = u; } catch (x) {} } }
  function byId(id) { for (var i = 0; i < S.PRODUCTS.length; i++) if (S.PRODUCTS[i].id === id) return S.PRODUCTS[i]; return null; }

  function buyBtn(p) { return ZGui.button({ label: 'Buy ↗', variant: 'primary', onClick: function () { open(S.url(p.id)); } }); }
  function card(p) {
    return ZGui.productCard({
      glyph: p.glyph, badge: p.badge, badgeFirst: p.badge === 'WORLD FIRST' || p.badge === 'BESTSELLER',
      category: p.category, name: p.name, tag: p.tag, meta: p.pills, actions: buyBtn(p)
    }).el;
  }

  function matches(p) {
    if (!query.trim()) return true;
    if (regexOn) { try { var re = new RegExp(query, 'i'); return re.test(p.name) || re.test(p.tag) || re.test(p.category); } catch (e) { return false; } }
    return !!(FZ.fzfMatch(query, p.name) || FZ.fzfMatch(query, p.tag) || FZ.fzfMatch(query, p.category));
  }

  /* ------- header: pitch + a link out to the full storefront ------- */
  function intro() {
    var wrap = el('div', 'store-intro');
    wrap.appendChild(el('div', 'set-h', '// MENKETECHNOLOGIES · APP STORE'));
    wrap.appendChild(el('p', 'store-lead',
      'zwire is free — the shop window for the MenkeTechnologies app store. Every app below is a from-scratch Rust build behind the same cyberpunk HUD. Click <strong>Buy</strong> to open its product page and check out.'));
    var row = el('div', 'store-actions');
    row.appendChild(ZGui.button({ label: 'Browse the full store ↗', variant: 'primary', onClick: function () { open(S.BASE); } }));
    row.appendChild(ZGui.button({ label: 'Free CLI & dev tools ↗', variant: 'mini', onClick: function () { open(S.BASE); } }));
    row.appendChild(ZGui.button({ label: 'Books ↗', variant: 'mini', onClick: function () { open(S.BASE); } }));
    wrap.appendChild(row);
    return ZGui.card({ body: wrap }).el;
  }

  function render() {
    body.innerHTML = '';
    body.appendChild(intro());
    var groups = {}, order = [];
    S.PRODUCTS.forEach(function (p) { if (!matches(p)) return; if (!groups[p.category]) { groups[p.category] = []; order.push(p.category); } groups[p.category].push(p); });
    if (!order.length) { body.appendChild(el('div', 'footer-docs', '[ no apps match ]')); return; }
    order.forEach(function (cat) {
      var inner = el('div');
      inner.appendChild(el('div', 'set-h', '// ' + cat.toUpperCase()));
      var grid = el('div', 'product-grid');
      groups[cat].forEach(function (p) { grid.appendChild(card(p)); });
      inner.appendChild(grid);
      body.appendChild(ZGui.card({ body: inner }).el);
    });
    body.appendChild(el('div', 'footer-docs', '[ ' + S.PRODUCTS.length + ' apps · prices + checkout on the live store ]'));
  }

  /* ------- first-run welcome modal ------- */
  function welcomeModal() {
    if (!(ZGui.modal && ZGui.productCard)) { open(S.BASE); return; }
    var wrap = el('div', 'store-welcome');
    wrap.appendChild(el('p', 'store-lead',
      'Welcome to zwire — it’s free, and it’s the front door to the MenkeTechnologies app store: a suite of from-scratch Rust desktop apps behind this same cyberpunk HUD. A few to start with:'));
    var grid = el('div', 'product-grid');
    S.FEATURED.forEach(function (id) { var p = byId(id); if (p) grid.appendChild(card(p)); });
    wrap.appendChild(grid);
    ZGui.modal.open({
      title: 'WELCOME · MENKE APP STORE',
      body: wrap,
      className: 'store-welcome-modal',
      actions: [
        { label: 'Browse the full store ↗', primary: true, close: true, onClick: function () { open(S.BASE); } },
        { label: 'Later', close: true }
      ]
    });
  }

  function injectCss() {
    if (document.getElementById('zb-store-css')) return;
    var s = document.createElement('style'); s.id = 'zb-store-css';
    s.textContent = [
      '.store-intro .store-lead{font-family:"Share Tech Mono",monospace;font-size:12px;color:var(--text-dim);line-height:1.6;margin:.4rem 0 .8rem;}',
      '.store-actions{display:flex;flex-wrap:wrap;gap:.5rem;}',
      '.store-welcome .store-lead{font-size:12px;color:var(--text-dim);line-height:1.6;margin:0 0 1rem;}',
      '.store-welcome-modal .modal-content{width:min(920px,94vw);}'
    ].join('');
    document.head.appendChild(s);
  }

  function boot() {
    injectCss();
    var shell = ZBHUD.mount({ title: 'APP STORE', current: 'store.html', filterPlaceholder: 'filter apps…',
      onFilter: function (q, rx) { query = q; regexOn = rx; render(); } });
    body = shell.body;
    render();
    var welcome = false;
    try { welcome = new URLSearchParams(location.search).get('welcome') === '1'; } catch (e) {}
    // Show the welcome modal only the very FIRST time ever. Gate on a persistent
    // flag (not just the ?welcome param), so a session-restored ?welcome tab or a
    // stale background worker that re-adds ?welcome can't pop it every launch.
    if (welcome) {
      try {
        chrome.storage.local.get('zb_welcomed', function (o) {
          void chrome.runtime.lastError;
          if (o && o.zb_welcomed) return;
          try { chrome.storage.local.set({ zb_welcomed: 1 }); } catch (e) {}
          setTimeout(welcomeModal, 120);
        });
      } catch (e) { setTimeout(welcomeModal, 120); }
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
