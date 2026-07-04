/* zbrowser HUD generic internal-page shell — for pages with no extension API. */
(function () {
  'use strict';
  var DESC = {
    'flags': 'Access experimental features and beta settings. (Native page — not scriptable by extensions.)',
    'discards': 'View open tabs and manage memory usage / tab discarding to free RAM.',
    'dns': 'View DNS pre-fetching status and host cache.',
    'password-manager': 'Saved passwords live in the OS keychain and are not readable by extensions.',
    'net-internals': 'Network internals, sockets, and event logging.',
    'gpu': 'Graphics feature status and GPU diagnostics.',
    'about': 'Index of zbrowser / Chromium internal pages.'
  };
  var q = new URLSearchParams(location.search);
  var orig = q.get('u') || '';
  var name = (orig.replace(/^chrome:\/\//, '').replace(/[\/?#].*$/, '')) || 'internal';
  var pretty = name.replace(/-/g, ' ').toUpperCase();
  document.getElementById('ti').textContent = '// ' + pretty;
  document.getElementById('pname').textContent = pretty;
  document.getElementById('ptag').textContent = DESC[name] || 'zbrowser internal page.';
  document.getElementById('orig').textContent = orig || ('chrome://' + name);
  document.title = 'zbrowser · ' + pretty;
})();
