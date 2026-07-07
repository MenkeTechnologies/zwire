// ── Embedded Terminal (PTY-backed, xterm.js) — shared zpwr-embed-terminal frontend ──
// Fixed-position pane with dock-to-corner drag, geometry persistence, and visibility
// saved to prefs. Extracted verbatim from Audio-Haxor; the only changes are a transport
// shim (auto-detects Tauri vs JUCE) and a `prefs` fallback so the same file backs
// Audio-Haxor, traderview, ztranslator (Tauri) and zpwr-daw (JUCE/C++).
//
// Backend contract (each host provides one):
//   commands  terminal_spawn(rows,cols) · terminal_write(data) · terminal_resize(rows,cols) · terminal_kill()
//   events    terminal-output(string)  · terminal-exit()
// HTML the host must provide: #terminalPane > #terminalContainer (+ optional #termDragHandle,
// #dockOverlay/#dockTL.. for drag-docking, and [data-action] toolbar buttons).

// prefs: use the host's global if present, else a localStorage shim. Named termPrefs (not
// `prefs`) so this top-level binding never collides with a host that declares its own global
// `let`/`const prefs` — a same-named `var` in shared (non-module) script scope is a fatal
// parse-time "duplicate variable" SyntaxError that would stop this whole file from running.
var termPrefs = window.prefs || {
    getItem: (k) => { try { return localStorage.getItem(k); } catch (_) { return null; } },
    setItem: (k, v) => { try { localStorage.setItem(k, v); } catch (_) {} },
};

// Transport: abstract the IPC so the same UI drives Tauri commands/events or JUCE
// native functions/backend events.
const TT = (function () {
    // zwire: PTY over a chrome native-messaging port to hud_host.py.
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.connectNative) {
        let _port = null, _outCb = null, _exitCb = null;
        const ensure = () => {
            if (_port) return _port;
            _port = chrome.runtime.connectNative('com.zwire.hud');
            _port.onMessage.addListener((m) => {
                if (!m) return;
                if (m.ev === 'output' && m.b64 != null && _outCb) {
                    const bin = atob(m.b64), arr = new Uint8Array(bin.length);
                    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
                    _outCb(arr);                 // xterm.write accepts Uint8Array (handles UTF-8)
                } else if (m.ev === 'exit' && _exitCb) { _exitCb(); }
            });
            _port.onDisconnect.addListener(() => { _port = null; if (_exitCb) _exitCb(); });
            return _port;
        };
        return {
            spawn: (rows, cols) => { ensure().postMessage({ cmd: 'pty_spawn', rows, cols }); return Promise.resolve(); },
            write: (data) => { if (_port) _port.postMessage({ cmd: 'pty_write', data }); return Promise.resolve(); },
            resize: (rows, cols) => { if (_port) _port.postMessage({ cmd: 'pty_resize', rows, cols }); return Promise.resolve(); },
            kill: () => { if (_port) { try { _port.postMessage({ cmd: 'pty_kill' }); _port.disconnect(); } catch (e) {} _port = null; } return Promise.resolve(); },
            onOutput: (cb) => { _outCb = cb; return Promise.resolve(() => { _outCb = null; }); },
            onExit: (cb) => { _exitCb = cb; return Promise.resolve(() => { _exitCb = null; }); },
        };
    }
    // zwire content-script overlay: PTY relayed through the background worker
    // (content scripts can't connectNative themselves).
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.connect && !chrome.runtime.connectNative) {
        let _port = null, _outCb = null, _exitCb = null;
        const ensure = () => {
            if (_port) return _port;
            _port = chrome.runtime.connect({ name: 'zwire-pty' });
            _port.onMessage.addListener((m) => {
                if (!m) return;
                if (m.ev === 'output' && m.b64 != null && _outCb) {
                    const bin = atob(m.b64), arr = new Uint8Array(bin.length);
                    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
                    _outCb(arr);
                } else if (m.ev === 'exit' && _exitCb) { _exitCb(); }
            });
            _port.onDisconnect.addListener(() => { _port = null; if (_exitCb) _exitCb(); });
            return _port;
        };
        return {
            spawn: (rows, cols) => { ensure().postMessage({ cmd: 'pty_spawn', rows, cols }); return Promise.resolve(); },
            write: (data) => { if (_port) _port.postMessage({ cmd: 'pty_write', data }); return Promise.resolve(); },
            resize: (rows, cols) => { if (_port) _port.postMessage({ cmd: 'pty_resize', rows, cols }); return Promise.resolve(); },
            kill: () => { if (_port) { try { _port.postMessage({ cmd: 'pty_kill' }); _port.disconnect(); } catch (e) {} _port = null; } return Promise.resolve(); },
            onOutput: (cb) => { _outCb = cb; return Promise.resolve(() => { _outCb = null; }); },
            onExit: (cb) => { _exitCb = cb; return Promise.resolve(() => { _exitCb = null; }); },
        };
    }
    if (typeof window !== 'undefined' && window.__TAURI__) {
        const {invoke} = window.__TAURI__.core;
        const {listen} = window.__TAURI__.event;
        return {
            spawn: (rows, cols) => invoke('terminal_spawn', {rows, cols}),
            write: (data) => invoke('terminal_write', {data}),
            resize: (rows, cols) => invoke('terminal_resize', {rows, cols}),
            kill: () => invoke('terminal_kill'),
            onOutput: (cb) => listen('terminal-output', (e) => cb(e.payload)),
            onExit: (cb) => listen('terminal-exit', () => cb()),
        };
    }
    if (typeof window !== 'undefined' && window.Juce && typeof window.Juce.getNativeFunction === 'function') {
        const gnf = window.Juce.getNativeFunction;
        const backend = window.__JUCE__ && window.__JUCE__.backend;
        const sub = (event, cb) => {
            if (backend && typeof backend.addEventListener === 'function') {
                backend.addEventListener(event, cb);
                return Promise.resolve(() => backend.removeEventListener(event, cb));
            }
            return Promise.resolve(() => {});
        };
        return {
            spawn: (rows, cols) => gnf('terminal_spawn')(rows, cols),
            write: (data) => gnf('terminal_write')(data),
            resize: (rows, cols) => gnf('terminal_resize')(rows, cols),
            kill: () => gnf('terminal_kill')(),
            onOutput: (cb) => sub('terminal-output', cb),
            onExit: (cb) => sub('terminal-exit', () => cb()),
        };
    }
    // No backend — keep the UI from throwing.
    const noop = () => Promise.resolve();
    return {
        spawn: noop, write: noop, resize: noop, kill: noop,
        onOutput: () => Promise.resolve(() => {}),
        onExit: () => Promise.resolve(() => {}),
    };
})();

let _termInstance = null;
let _termUnlistenOutput = null;
let _termUnlistenExit = null;
let _termFitDebounce = null;
let _termSessionAlive = false;

const TERM_DOCK_CLASSES = ['dock-tl', 'dock-tr', 'dock-bl', 'dock-br'];

// Inject the pane DOM if the host didn't provide #terminalPane (drop-in mode: the app
// only needs to include terminal.css + xterm + this file). Hosts that ship their own
// markup (Audio-Haxor, traderview) already have #terminalPane, so this is a no-op there.
function _ensureTerminalDom() {
    if (typeof document === 'undefined' || document.getElementById('terminalPane')) return;
    if (!document.body) return;
    const pane = document.createElement('div');
    pane.className = 'terminal-pane dock-br';
    pane.id = 'terminalPane';

    const ZG = (typeof window !== 'undefined') ? window.ZGui : null;
    if (ZG && ZG.toolbar && ZG.buttonBar) {
        // Toolbar chrome from the shared zgui-core: a ZGui.toolbar (which is also the
        // #termDragHandle the dock/drag system below keys off) holding the title on the left and
        // a ZGui.buttonBar (hide · kill) on the right. No hand-rolled toolbar/button markup.
        const toolbarHost = document.createElement('div');
        toolbarHost.className = 'term-toolbar';
        toolbarHost.id = 'termDragHandle';
        pane.appendChild(toolbarHost);
        const tb = ZG.toolbar(toolbarHost);
        const title = document.createElement('span');
        title.className = 'term-toolbar-title';
        title.textContent = '⟢ Terminal';
        tb.add(title);
        const actions = ZG.buttonBar();
        actions.add('⎯', 'Hide', () => hideTerminal());
        actions.add('✕', 'Kill & close', () => killTerminal());
        tb.add(actions.el, 'right');
        const body = document.createElement('div');
        body.className = 'term-body';
        body.id = 'terminalContainer';
        pane.appendChild(body);
    } else {
        // Fallback for hosts that haven't adopted zgui-core yet: keep the legacy markup so the
        // shared embedded terminal still works everywhere it's dropped in. (The ztunnel app and
        // other zgui-core hosts take the branch above.) The [data-action] wiring binds these.
        pane.innerHTML = `
        <div class="term-toolbar" id="termDragHandle">
            <span class="term-toolbar-title">⟢ Terminal</span>
            <div class="term-toolbar-actions">
                <button type="button" class="term-btn" data-action="hideTerminal" title="Hide">⎯</button>
                <button type="button" class="term-btn term-btn-close" data-action="killTerminal" title="Kill &amp; close">✕</button>
            </div>
        </div>
        <div class="term-body" id="terminalContainer"></div>`;
    }
    document.body.appendChild(pane);
}

// ── Public API ──

function toggleTerminalPopup() {
    const pane = document.getElementById('terminalPane');
    if (!pane) return;
    if (pane.classList.contains('active')) {
        hideTerminal();
    } else {
        showTerminal();
    }
}

function showTerminal() {
    const pane = document.getElementById('terminalPane');
    if (!pane) return;
    pane.classList.add('active');
    termPrefs.setItem('terminalPaneHidden', 'off');

    // Restore saved dimensions
    _termRestoreDimensions();

    // Spawn PTY session if needed
    if (!_termSessionAlive) {
        _termSpawnSession();
    } else if (_termInstance) {
        _termInstance.focus();
        _termSendResize();
    }
}

function hideTerminal() {
    const pane = document.getElementById('terminalPane');
    if (!pane) return;
    pane.classList.remove('active');
    termPrefs.setItem('terminalPaneHidden', 'on');
}

// ── Dock system (mirrors audio player) ──

function _termGetCurrentDock() {
    const pane = document.getElementById('terminalPane');
    if (!pane) return 'dock-br';
    for (const c of TERM_DOCK_CLASSES) {
        if (pane.classList.contains(c)) return c;
    }
    return 'dock-br';
}

function _termSetDock(dock) {
    const pane = document.getElementById('terminalPane');
    if (!pane) return;
    TERM_DOCK_CLASSES.forEach((c) => pane.classList.remove(c));
    pane.classList.add(dock);
    termPrefs.setItem('terminalDock', dock);
}

function _termNearestDock(x, y) {
    const midX = window.innerWidth / 2;
    const midY = window.innerHeight / 2;
    if (x < midX) return y < midY ? 'dock-tl' : 'dock-bl';
    return y < midY ? 'dock-tr' : 'dock-br';
}

function restoreTerminalDock() {
    const saved = termPrefs.getItem('terminalDock');
    const dock = saved && TERM_DOCK_CLASSES.includes(saved) ? saved : 'dock-br';
    const pane = document.getElementById('terminalPane');
    if (pane) {
        TERM_DOCK_CLASSES.forEach((c) => pane.classList.remove(c));
        pane.classList.add(dock);
    }
}

function restoreTerminalDimensions() {
    const pane = document.getElementById('terminalPane');
    if (!pane) return;
    const saved = termPrefs.getItem('modal_terminalPane');
    if (!saved) return;
    try {
        const geo = JSON.parse(saved);
        if (geo.width >= 200) pane.style.width = geo.width + 'px';
        if (geo.height >= 150) pane.style.height = geo.height + 'px';
    } catch (_) { /* ignore */ }
}

function _termRestoreDimensions() {
    if (typeof restoreTerminalDimensions === 'function') restoreTerminalDimensions();
}

function restoreTerminalPaneVisibilityFromPrefs() {
    const hidden = termPrefs.getItem('terminalPaneHidden');
    const pane = document.getElementById('terminalPane');
    if (!pane) return;
    if (hidden === 'on') {
        pane.classList.remove('active');
    }
}

// ── Drag-to-dock ──

let _termDragState = null;

function _termOnDragStart(e) {
    const pane = document.getElementById('terminalPane');
    if (!pane) return;

    // Don't drag from buttons, input, or the xterm canvas/textarea
    if (e.target.closest('button, input, select, textarea, canvas, .xterm')) return;
    if (e.button !== 0) return;
    e.preventDefault();

    const rect = pane.getBoundingClientRect();
    TERM_DOCK_CLASSES.forEach((c) => pane.classList.remove(c));
    pane.classList.remove('snapping');
    pane.style.position = 'fixed';
    pane.style.left = rect.left + 'px';
    pane.style.top = rect.top + 'px';
    pane.style.right = 'auto';
    pane.style.bottom = 'auto';
    pane.classList.add('dragging');

    // Reuse the shared dock overlay (same as audio player) with pixel-based positioning
    // CSS calc() with percentages doesn't resolve in release WebView
    const overlay = document.getElementById('dockOverlay');
    if (overlay) {
        const vw = window.innerWidth, vh = window.innerHeight, gap = 4;
        const zw = Math.floor(vw / 2 - gap * 1.5) + 'px';
        const zh = Math.floor(vh / 2 - gap * 1.5) + 'px';
        const mid = Math.ceil(vw / 2 + gap / 2) + 'px';
        const midY = Math.ceil(vh / 2 + gap / 2) + 'px';
        const g = gap + 'px';
        const tl = document.getElementById('dockTL');
        const tr = document.getElementById('dockTR');
        const bl = document.getElementById('dockBL');
        const br = document.getElementById('dockBR');
        if (tl) tl.style.cssText = `top:${g};left:${g};width:${zw};height:${zh}`;
        if (tr) tr.style.cssText = `top:${g};left:${mid};width:${zw};height:${zh}`;
        if (bl) bl.style.cssText = `top:${midY};left:${g};width:${zw};height:${zh}`;
        if (br) br.style.cssText = `top:${midY};left:${mid};width:${zw};height:${zh}`;
        overlay.classList.add('visible');
    }

    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'grabbing';
    _termDragState = {startX: e.clientX, startY: e.clientY, origLeft: rect.left, origTop: rect.top};
}

document.addEventListener('mousemove', (e) => {
    if (!_termDragState) return;
    const pane = document.getElementById('terminalPane');
    if (!pane) return;
    const dx = e.clientX - _termDragState.startX;
    const dy = e.clientY - _termDragState.startY;
    pane.style.left = (_termDragState.origLeft + dx) + 'px';
    pane.style.top = (_termDragState.origTop + dy) + 'px';

    // Highlight nearest dock zone (shared overlay)
    const nearest = _termNearestDock(e.clientX, e.clientY);
    const zoneMap = {
        'dock-tl': 'dockTL', 'dock-tr': 'dockTR',
        'dock-bl': 'dockBL', 'dock-br': 'dockBR',
    };
    Object.entries(zoneMap).forEach(([dock, id]) => {
        const el = document.getElementById(id);
        if (el) el.classList.toggle('active', dock === nearest);
    });
});

document.addEventListener('mouseup', (e) => {
    if (!_termDragState) return;
    const pane = document.getElementById('terminalPane');
    _termDragState = null;
    document.body.style.userSelect = '';
    document.body.style.cursor = '';

    const overlay = document.getElementById('dockOverlay');
    if (overlay) {
        overlay.classList.remove('visible');
        ['dockTL', 'dockTR', 'dockBL', 'dockBR'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.classList.remove('active');
        });
    }

    if (!pane) return;
    pane.classList.remove('dragging');

    // Snap to nearest dock
    const dock = _termNearestDock(e.clientX, e.clientY);
    pane.style.left = '';
    pane.style.top = '';
    pane.style.right = '';
    pane.style.bottom = '';
    pane.classList.add('snapping');
    _termSetDock(dock);
    setTimeout(() => pane.classList.remove('snapping'), 300);

    // Save dimensions
    const rect = pane.getBoundingClientRect();
    termPrefs.setItem('modal_terminalPane', JSON.stringify({
        width: Math.round(rect.width),
        height: Math.round(rect.height),
    }));

    // Re-fit after dock
    clearTimeout(_termFitDebounce);
    _termFitDebounce = setTimeout(() => _termSendResize(), 60);
});

// ── PTY session management ──

async function _termSpawnSession() {
    const pane = document.getElementById('terminalPane');
    const container = document.getElementById('terminalContainer');
    if (!pane || !container) return;

    if (typeof Terminal !== 'function') {
        container.textContent = 'xterm.js not loaded';
        return;
    }

    // Create xterm.js instance
    const term = new Terminal({
        cursorBlink: true,
        cursorStyle: 'block',
        fontSize: 13,
        fontFamily: "'Hack Nerd Font', 'Hack Nerd Font Mono', 'Hack', 'Share Tech Mono', 'Menlo', monospace",
        theme: {
            background: 'rgba(0, 0, 0, 0)',
            foreground: '#e0e0e0',
            cursor: '#00e5ff',
            cursorAccent: '#0a0a12',
            selectionBackground: 'rgba(0,229,255,0.25)',
            black: '#1a1a2e',
            red: '#ff3860',
            green: '#23d160',
            yellow: '#ffdd57',
            blue: '#3273dc',
            magenta: '#b86bff',
            cyan: '#00e5ff',
            white: '#e0e0e0',
            brightBlack: '#4a4a6a',
            brightRed: '#ff6b8a',
            brightGreen: '#5dfc8a',
            brightYellow: '#ffe27a',
            brightBlue: '#5a9cff',
            brightMagenta: '#d19cff',
            brightCyan: '#4df0ff',
            brightWhite: '#ffffff',
        },
        allowProposedApi: true,
        allowTransparency: true,
        scrollback: 10000,
    });

    term.open(container);
    _termInstance = term;

    // Release WebKit ignores setAttribute("style", ...) on dynamically-created
    // elements under tauri://localhost. xterm.js DOM renderer uses setAttribute
    // for truecolor (24-bit RGB) via _addStyle(). Monkey-patch to use the DOM
    // .style API instead, which DOES work (proven by letter-spacing).
    // Walk the _core tree to find _rowFactory regardless of nesting depth.
    try {
        const core = term._core;
        let rf = null;
        // Try common paths — xterm.js v5 minified structure varies
        const candidates = [
            core._renderService?._rowFactory,
            core._renderService?._renderer?._rowFactory,
        ];
        // Deep scan: find any object with _addStyle method
        if (!candidates.some(c => c)) {
            const scan = (obj, depth) => {
                if (!obj || depth > 4 || rf) return;
                if (typeof obj._addStyle === 'function') { rf = obj; return; }
                for (const k of Object.keys(obj)) {
                    if (k.startsWith('_') && typeof obj[k] === 'object' && obj[k]) {
                        scan(obj[k], depth + 1);
                    }
                }
            };
            scan(core, 0);
        } else {
            rf = candidates.find(c => c);
        }
        if (rf && typeof rf._addStyle === 'function') {
            rf._addStyle = function (el, styleStr) {
                const colorMatch = styleStr.match(/^color:(#[0-9a-fA-F]{3,8})/);
                if (colorMatch) { el.style.color = colorMatch[1]; return; }
                const bgMatch = styleStr.match(/^background-color:(#[0-9a-fA-F]{3,8})/);
                if (bgMatch) { el.style.backgroundColor = bgMatch[1]; return; }
                const parts = styleStr.split(':');
                if (parts.length === 2) {
                    const prop = parts[0].trim().replace(/-([a-z])/g, (_, c) => c.toUpperCase());
                    el.style[prop] = parts[1].trim().replace(/;$/, '');
                }
            };
        }
    } catch (_) { /* xterm internals may change — fail gracefully */ }

    // Force xterm.js to re-measure font metrics after static CSS takes effect.
    requestAnimationFrame(() => {
        if (_termInstance) {
            _termInstance.resize(_termInstance.cols, _termInstance.rows);
            _termInstance.refresh(0, _termInstance.rows - 1);
        }
    });

    // Initial fit
    const dims = _termFit(term, container);

    // Subscribe to PTY events BEFORE spawning so nothing is lost
    _termUnlistenOutput = await TT.onOutput((payload) => {
        if (!_termInstance) return;
        // Detect ESC[2J (erase display) — clear xterm.js scrollback so
        // Ctrl+L (zle clear-screen) actually blanks the viewport.
        if (payload.includes('\x1b[2J')) {
            _termInstance.clear();
        }
        _termInstance.write(payload);
    });
    _termUnlistenExit = await TT.onExit(() => {
        _termSessionAlive = false;
        if (_termInstance) _termInstance.write('\r\n\x1b[90m[session ended — press any key to restart]\x1b[0m\r\n');
    });

    // Spawn PTY
    try {
        await TT.spawn(dims.rows, dims.cols);
        _termSessionAlive = true;
    } catch (err) {
        term.write(`\x1b[31mFailed to spawn terminal: ${err}\x1b[0m\r\n`);
    }

    // Forward keystrokes to PTY (or restart on dead session)
    term.onData((data) => {
        if (!_termSessionAlive) {
            _termDestroyInstance();
            _termSpawnSession();
            return;
        }
        Promise.resolve(TT.write(data)).catch(() => {});
    });

    // Observe pane resize
    const observer = new ResizeObserver(() => {
        clearTimeout(_termFitDebounce);
        _termFitDebounce = setTimeout(() => _termSendResize(), 50);
    });
    observer.observe(pane);
    pane._termResizeObserver = observer;

    term.focus();
}

function _termDestroyInstance() {
    if (_termUnlistenOutput) { _termUnlistenOutput(); _termUnlistenOutput = null; }
    if (_termUnlistenExit) { _termUnlistenExit(); _termUnlistenExit = null; }

    const pane = document.getElementById('terminalPane');
    if (pane?._termResizeObserver) {
        pane._termResizeObserver.disconnect();
        pane._termResizeObserver = null;
    }

    if (_termInstance) {
        _termInstance.dispose();
        _termInstance = null;
    }

    const container = document.getElementById('terminalContainer');
    if (container) container.innerHTML = '';

    _termSessionAlive = false;
}

/** Kill the backend PTY, tear down the frontend instance, and close (hide) the pane.
 *  Wired to the ✕ "Kill & close" button — closing means the pane disappears, not just
 *  that the session dies and leaves an empty pane on screen. */
function killTerminal() {
    Promise.resolve(TT.kill()).catch(() => {});
    _termDestroyInstance();
    hideTerminal();
}

// ── Fit helpers ──

function _termFit(term, container) {
    if (!term || !container) return {rows: 24, cols: 80};
    const core = term._core;
    if (!core) return {rows: 24, cols: 80};

    const dims = core._renderService?.dimensions;
    if (!dims || !dims.css || !dims.css.cell || !dims.css.cell.width || !dims.css.cell.height) {
        return {rows: term.rows, cols: term.cols};
    }

    const cellW = dims.css.cell.width;
    const cellH = dims.css.cell.height;
    const availW = container.clientWidth;
    const availH = container.clientHeight;

    if (availW <= 0 || availH <= 0) return {rows: term.rows, cols: term.cols};

    const cols = Math.max(2, Math.floor(availW / cellW));
    const rows = Math.max(1, Math.floor(availH / cellH));

    if (cols !== term.cols || rows !== term.rows) {
        term.resize(cols, rows);
    }
    return {rows, cols};
}

function _termSendResize() {
    if (!_termInstance) return;
    const container = document.getElementById('terminalContainer');
    if (!container) return;
    const dims = _termFit(_termInstance, container);
    Promise.resolve(TT.resize(dims.rows, dims.cols)).catch(() => {});
}

// ── Toolbar button handlers + drag init ──

// Drag-to-dock via toolbar header
document.addEventListener('mousedown', (e) => {
    const handle = e.target.closest('#termDragHandle');
    if (!handle) return;
    _termOnDragStart(e);
});

// Resize handles are initialised inside wire() below — AFTER _ensureTerminalDom()
// injects #terminalPane. Doing it here at top level found no pane on web pages
// (where the host doesn't pre-provide it), so resize silently never wired; it
// worked only in apps that ship the pane in HTML (Audio-Haxor) or on HUD pages.

// ── Wiring: toolbar [data-action] buttons + Ctrl+` toggle + restore from prefs ──
(function initTerminalWiring() {
    const wire = () => {
        _ensureTerminalDom(); // inject the pane if the host didn't provide it
        const pane = document.getElementById('terminalPane');
        if (pane) {
            pane.querySelectorAll('[data-action]').forEach((btn) => {
                btn.addEventListener('click', () => {
                    const fn = window[btn.dataset.action];
                    if (typeof fn === 'function') fn();
                });
            });
            // Wire resize handles now that the pane exists (idempotent — modal-drag
            // guards with pane._dragInit). This is what makes the terminal resizable
            // on web pages, where the pane is injected here rather than by the host.
            if (typeof initModalDragResize === 'function') initModalDragResize(pane);
        }
        document.addEventListener('keydown', (e) => {
            // Ctrl+` (Backquote) toggles the embedded terminal. (Cmd/Ctrl+T is
            // left to Chrome for new-tab.)
            const toggle = e.ctrlKey && !e.metaKey && !e.altKey && (e.key === '`' || e.code === 'Backquote');
            if (toggle) {
                e.preventDefault();
                if (typeof toggleTerminalPopup === 'function') toggleTerminalPopup();
            }
        });
        // macOS WKWebView applies emacs key bindings (Ctrl-A/E/K/U/W…) to the input textarea and
        // swallows them before xterm forwards them — and global app shortcuts can grab others.
        // Forward Ctrl+<letter> straight to the PTY so the editor's readline (pickers, : prompt)
        // works. Capture phase + stopImmediatePropagation gets ahead of both the OS and app handlers.
        if (!window.__zptyCtrlForward) {
            window.__zptyCtrlForward = true;
            document.addEventListener('keydown', (e) => {
                if (!e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
                if (e.key === '`' || e.code === 'Backquote') return; // terminal toggle
                const k = (e.key || '').toLowerCase();
                if (k === 't') return; // Ctrl-T reserved for the terminal toggle
                if (k.length !== 1 || k < 'a' || k > 'z') return;
                const pane = document.getElementById('terminalPane');
                if (!pane || !pane.contains(document.activeElement)) return;
                Promise.resolve(TT.write(String.fromCharCode(k.charCodeAt(0) - 96))).catch(() => {});
                e.preventDefault();
                e.stopImmediatePropagation();
            }, true);
        }
        if (typeof restoreTerminalPaneVisibilityFromPrefs === 'function') restoreTerminalPaneVisibilityFromPrefs();
        if (typeof restoreTerminalDock === 'function') restoreTerminalDock();
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
    else wire();
})();

// Expose globals for data-action wiring + external callers.
window.toggleTerminalPopup = toggleTerminalPopup;
window.showTerminal = showTerminal;
window.hideTerminal = hideTerminal;
window.killTerminal = killTerminal;
// zwire — open the popup terminal (spawning the PTY if needed) and run a shell
// command. Used by custom ⌘K commands (type "shell"). Polls for the session to
// come alive so the very first run isn't dropped before the PTY exists.
window.zwireTermRun = function (cmd) {
    if (typeof cmd !== 'string' || !cmd) return;
    showTerminal();
    let tries = 0;
    (function pump() {
        if (_termSessionAlive && _termInstance) {
            try { _termInstance.focus(); } catch (e) {}
            Promise.resolve(TT.write(cmd + '\r')).catch(() => {});
            return;
        }
        if (tries++ > 200) return;   // ~10s ceiling
        setTimeout(pump, 50);
    })();
};
