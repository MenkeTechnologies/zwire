/* zwire — sandboxed runner for the palette's "Run JavaScript" step.
 *
 * Every other zwire surface (content scripts, HUD pages, New Tab) is bound by the
 * MV3 default CSP `script-src 'self' 'wasm-unsafe-eval'`, which forbids eval /
 * `new Function`, so `(new Function('q', code))()` throws EvalError there and the
 * user's JS silently never runs. A manifest-declared sandbox page (see
 * `content_security_policy.sandbox` + `sandbox.pages`) has its OWN CSP with
 * `'unsafe-eval'` and the `allow-modals` sandbox flag, so both `new Function` and
 * `window.alert()` work here. The palettes embed this page as a hidden iframe and
 * postMessage the code in; we eval it with `q` bound to the typed argument and
 * post the outcome back so the caller can surface errors.
 *
 * Trade-off of the sandbox: no `chrome.*` and no access to the host page's DOM —
 * only this frame's own window/eval. That is inherent to how MV3 permits eval. */
(function () {
  'use strict';
  window.addEventListener('message', function (e) {
    var d = e.data;
    if (!d || d.zjs !== 1 || typeof d.code !== 'string') return;
    var reply = { zjs: 1, id: d.id, ok: true };
    try {
      (new Function('q', d.code))(d.arg || '');
    } catch (err) {
      reply.ok = false;
      reply.err = String((err && err.message) || err);
    }
    try { if (e.source) e.source.postMessage(reply, '*'); } catch (x) {}
  });
})();
