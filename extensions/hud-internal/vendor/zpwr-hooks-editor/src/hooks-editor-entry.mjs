// Entry for the vendored Hooks code-editor bundle.
// Built by scripts/build-hooks-editor.mjs (esbuild, IIFE) into
// frontend/lib/hooks-editor.bundle.js (+ .css) and loaded via <script>/<link>
// tags — the app frontend has no runtime bundler, so this is pre-bundled like
// lib/xterm.js. Exposes a small `window.HooksEditor` facade.
//
// Editor: Monaco (the VS Code engine) for the full IDE feature set — IntelliSense
// popup, multi-cursor, minimap, command palette. Modal editing via monaco-vim /
// monaco-emacs (Default / Vim / Emacs). stryke is a Perl-5 superset, so we reuse
// Monaco's Perl Monarch tokens for highlighting.
//
// Language intelligence (completion / hover / diagnostics) comes from the stryke
// language server (`stryke --lsp`) reached through a caller-supplied transport.
// We speak LSP JSON-RPC directly — a thin ~150-line adapter mapping to Monaco's
// provider APIs — rather than monaco-languageclient, whose v10 line requires the
// bundler-coupled @codingame/monaco-vscode-api and won't vendor into a plain IIFE.
//
// Transport contract: `send(message)` ships one raw (unframed) JSON-RPC string;
// the host bridge (Rust) adds LSP Content-Length framing to the server's stdin
// and strips it from stdout. Inbound messages are fed back via receive().

// edcore.main (NOT editor.api): editor.api is the bare API with ZERO editor
// contributions — no suggest controller, so the completion popup never renders,
// Ctrl+Space (editor.action.triggerSuggest) is a no-op, and monaco-vim's
// action-based commands (editor.action.insertLineAfter, …) throw "command not
// found". edcore.main bundles ALL editor contributions (suggest, hover, find,
// folding, …) but NO languages — exactly what we want (we register stryke tokens
// ourselves from the Perl basic-language below).
import * as monaco from 'monaco-editor/esm/vs/editor/edcore.main.js';
import { conf as perlConf, language as perlLang } from 'monaco-editor/esm/vs/basic-languages/perl/perl.js';
// JavaScript language service — powers IntelliSense (completion / hover / signature)
// for the non-LSP plain editor (the ⌘K "Run JavaScript" command step). The Monarch
// grammar below handles colorization; the TS worker handles the language features.
import 'monaco-editor/esm/vs/language/typescript/monaco.contribution';
import { conf as jsConf, language as jsLang } from 'monaco-editor/esm/vs/basic-languages/javascript/javascript.js';
import { initVimMode } from 'monaco-vim';
import { EmacsExtension } from 'monaco-emacs';
import { createLspCore } from './lsp-client-core.mjs';

// Monaco needs a worker factory. Resolve workers relative to THIS bundle's own URL,
// not document.baseURI: the bundle and its workers ship side-by-side in one lib/
// dir, but the HTML that loads them may live elsewhere (e.g. an extension's pages/),
// so baseURI would mis-resolve the worker path. The base editor worker serves the
// stryke editor (LSP intelligence is main-thread); the typescript worker serves JS
// IntelliSense for the plain editor. (CSP worker-src 'self' covers the same origin.)
const _bundleUrl =
    (typeof document !== 'undefined' && document.currentScript && document.currentScript.src) ||
    (typeof self !== 'undefined' && self.location && self.location.href) ||
    '';
self.MonacoEnvironment = {
    getWorker(_moduleId, label) {
        const file =
            label === 'typescript' || label === 'javascript'
                ? 'hooks-editor.ts.worker.js'
                : 'hooks-editor.worker.js';
        return new Worker(new URL(file, _bundleUrl));
    },
};

const LANG_ID = 'stryke';
monaco.languages.register({ id: LANG_ID });
monaco.languages.setMonarchTokensProvider(LANG_ID, perlLang);
monaco.languages.setLanguageConfiguration(LANG_ID, perlConf);

// JavaScript: edcore bundles no languages, and the ts contribution only lazily
// hooks `onLanguage('javascript')` — it does NOT register the language. So register
// it ourselves (which fires that hook and wires the worker-backed language service),
// then overlay the Monarch grammar for colorization and relax diagnostics so
// referencing host globals (chrome, q) doesn't red-squiggle while genuine syntax
// errors still surface.
const JS_LANG_ID = 'javascript';
monaco.languages.register({ id: JS_LANG_ID, extensions: ['.js', '.mjs', '.cjs'], aliases: ['JavaScript', 'javascript', 'js'] });
monaco.languages.setMonarchTokensProvider(JS_LANG_ID, jsLang);
monaco.languages.setLanguageConfiguration(JS_LANG_ID, jsConf);
if (monaco.languages.typescript && monaco.languages.typescript.javascriptDefaults) {
    monaco.languages.typescript.javascriptDefaults.setCompilerOptions({
        target: monaco.languages.typescript.ScriptTarget.ESNext,
        allowNonTsExtensions: true,
        allowJs: true,
    });
    monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({
        noSemanticValidation: true,
        noSyntaxValidation: false,
    });
}

// Cyberpunk theme — neon on near-black, matching the apps' aesthetic. Also styles
// the suggest/hover widgets explicitly so the completion popup is clearly visible.
const THEME = 'stryke-cyberpunk';
monaco.editor.defineTheme(THEME, {
    base: 'vs-dark',
    inherit: true,
    rules: [
        { token: 'comment', foreground: '4a6a7a', fontStyle: 'italic' },
        { token: 'string', foreground: '00e5ff' },
        { token: 'keyword', foreground: 'ff2e97' },
        { token: 'number', foreground: 'f5a623' },
        { token: 'variable', foreground: '39ff14' },
        { token: 'type', foreground: 'b14eff' },
        { token: 'operator', foreground: 'ff2e97' },
        { token: 'delimiter', foreground: '8aa0b4' },
    ],
    colors: {
        'editor.background': '#0a0e14',
        'editor.foreground': '#c8d4e0',
        'editorLineNumber.foreground': '#2a3a4a',
        'editorLineNumber.activeForeground': '#00e5ff',
        'editorCursor.foreground': '#00e5ff',
        'editor.selectionBackground': '#1f3a4a',
        'editor.lineHighlightBackground': '#0d1622',
        'editorWidget.background': '#0d1219',
        'editorWidget.border': '#1f2a36',
        'editorSuggestWidget.background': '#0d1219',
        'editorSuggestWidget.border': '#00e5ff',
        'editorSuggestWidget.foreground': '#c8d4e0',
        'editorSuggestWidget.selectedBackground': '#16324a',
        'editorSuggestWidget.highlightForeground': '#39ff14',
        'editorHoverWidget.background': '#0d1219',
        'editorHoverWidget.border': '#1f2a36',
    },
});

// Single body-level node for Monaco's overflow widgets (suggest/hover popups).
// The editor lives inside an overflow:hidden, fixed-height container; without a
// body-level overflow node Monaco clips the suggest popup so it never shows even
// though completion data is flowing. (CodeMirror needed the same fix via
// fixed-position tooltips.) `fixedOverflowWidgets` + this node lets popups escape.
let _overflowNode = null;
function overflowWidgetsNode() {
    if (!_overflowNode) {
        _overflowNode = document.createElement('div');
        // Must carry `monaco-editor` so the widget CSS (scoped under it) applies.
        _overflowNode.className = 'monaco-editor';
        _overflowNode.style.position = 'absolute';
        _overflowNode.style.top = '0';
        _overflowNode.style.left = '0';
        _overflowNode.style.zIndex = '10000';
        document.body.appendChild(_overflowNode);
    }
    return _overflowNode;
}

// Editor construction options shared by the stryke (LSP) editor and the plain JS
// editor. Per-editor extras (the model, the overflow node, semantic highlighting)
// are merged in at create time.
const BASE_EDITOR_OPTS = {
    theme: THEME,
    automaticLayout: true,
    fontSize: 13,
    minimap: { enabled: true },
    scrollBeyondLastLine: false,
    tabSize: 2,
    renderWhitespace: 'selection',
    // Render suggest/hover popups in a body-level node so the editor's
    // overflow:hidden container can't clip them (the "no popup ever" bug).
    fixedOverflowWidgets: true,
    // Completion: auto-popup on typing everywhere + trigger chars.
    quickSuggestions: { other: true, comments: true, strings: true },
    suggestOnTriggerCharacters: true,
    tabCompletion: 'on',
};

// Attach modal (vim/emacs) editing to an editor. Returns { applyMode(mode), dispose() }.
// Shared by both editors so Default/Vim/Emacs switching behaves identically.
function attachModal(editor, statusBar) {
    let modal = null;
    const applyMode = (m) => {
        if (modal) {
            try { modal.dispose(); } catch (_) {}
            modal = null;
            if (statusBar) statusBar.textContent = '';
        }
        if (m === 'vim') {
            modal = initVimMode(editor, statusBar || undefined);
        } else if (m === 'emacs') {
            const ext = new EmacsExtension(editor);
            ext.start();
            modal = ext;
        }
    };
    return { applyMode, dispose() { if (modal) { try { modal.dispose(); } catch (_) {} } } };
}

// ── LSP client ───────────────────────────────────────────────────────────────
// Editor-agnostic protocol logic lives in the Monaco-free core (unit-tested in
// tests/lsp_client_core); this file only maps it onto Monaco's provider/marker
// APIs. `lsp.ready` gates document notifications + feature requests on the
// initialize→initialized handshake (see core for why).
const lsp = createLspCore();
let providersRegistered = false;
const modelUris = new Map();    // monaco model → the exact LSP uri string we opened
lsp.onDiagnostics(applyDiagnostics);

const CK = monaco.languages.CompletionItemKind;
// LSP CompletionItemKind (1-based) → Monaco kind. Only the kinds stryke emits.
function lspKindToMonaco(k) {
    switch (k) {
        case 2: return CK.Method;
        case 3: return CK.Function;
        case 5: return CK.Field;
        case 6: return CK.Variable;
        case 7: return CK.Class;
        case 9: return CK.Module;
        case 14: return CK.Keyword;
        case 21: return CK.Constant;
        default: return CK.Text;
    }
}

const MS = monaco.MarkerSeverity;
function lspSeverityToMonaco(s) {
    switch (s) {
        case 1: return MS.Error;
        case 2: return MS.Warning;
        case 3: return MS.Info;
        case 4: return MS.Hint;
        default: return MS.Error;
    }
}

function docText(doc) {
    if (doc == null) return '';
    if (typeof doc === 'string') return doc.value || doc;
    return doc.value || '';
}

// ── LSP↔Monaco shared mappers ────────────────────────────────────────────────
// LSP positions/ranges are 0-based; Monaco is 1-based. SymbolKind/DocumentHighlightKind
// enums are offset by 1 between the two (Monaco = LSP − 1).
function lspPos(position) {
    return { line: position.lineNumber - 1, character: position.column - 1 };
}
function toRange(r) {
    return {
        startLineNumber: r.start.line + 1,
        startColumn: r.start.character + 1,
        endLineNumber: r.end.line + 1,
        endColumn: r.end.character + 1,
    };
}
function uriParam(model) {
    return modelUris.get(model);
}
// One live request to the server, gated on the handshake; null on any failure.
async function req(method, params) {
    if (!lsp.connected()) return null;
    await lsp.ready;
    try {
        return await lsp.request(method, params);
    } catch {
        return null;
    }
}
// LSP Location | LocationLink → Monaco Location {uri, range}.
function mapLoc(l) {
    if (!l) return null;
    const uri = l.uri || l.targetUri;
    const range = l.range || l.targetSelectionRange || l.targetRange;
    if (!uri || !range) return null;
    return { uri: monaco.Uri.parse(uri), range: toRange(range) };
}
function mapLocs(res) {
    if (!res) return [];
    return (Array.isArray(res) ? res : [res]).map(mapLoc).filter(Boolean);
}
// LSP WorkspaceEdit (changes map and/or documentChanges) → Monaco {edits:[…]}.
// File-creation/rename/delete operations are skipped — stryke rename only edits text.
function mapWsEdit(we) {
    const edits = [];
    if (we && we.changes) {
        for (const [uri, tes] of Object.entries(we.changes)) {
            for (const te of tes) {
                edits.push({
                    resource: monaco.Uri.parse(uri),
                    textEdit: { range: toRange(te.range), text: te.newText },
                    versionId: undefined,
                });
            }
        }
    }
    if (we && Array.isArray(we.documentChanges)) {
        for (const dc of we.documentChanges) {
            if (!dc || !dc.textDocument || !Array.isArray(dc.edits)) continue;
            const uri = dc.textDocument.uri;
            for (const te of dc.edits) {
                edits.push({
                    resource: monaco.Uri.parse(uri),
                    textEdit: { range: toRange(te.range), text: te.newText },
                    versionId: undefined,
                });
            }
        }
    }
    return { edits };
}
// LSP DocumentSymbol (hierarchical) or SymbolInformation (flat) → Monaco DocumentSymbol.
function mapSym(d) {
    const range = d.range ? toRange(d.range) : d.location ? toRange(d.location.range) : null;
    if (!range) return null;
    return {
        name: d.name,
        detail: d.detail || '',
        kind: (d.kind || 1) - 1, // LSP SymbolKind is 1-based; Monaco is 0-based
        tags: d.tags || [],
        range,
        selectionRange: d.selectionRange ? toRange(d.selectionRange) : range,
        children: (d.children || []).map(mapSym).filter(Boolean),
    };
}

// Register Monaco language providers once. Every feature the stryke server advertises
// (verified against `stryke --lsp` capabilities) is mapped here; each queries the server
// live (it has the latest doc via didOpen/didChange) and maps the result to Monaco.
function registerProviders() {
    if (providersRegistered) return;
    providersRegistered = true;

    monaco.languages.registerCompletionItemProvider(LANG_ID, {
        triggerCharacters: ['$', '@', '%', '-', '>', ':', '.', '"'],
        async provideCompletionItems(model, position) {
            const uri = modelUris.get(model);
            if (!lsp.connected() || !uri) return { suggestions: [] };
            await lsp.ready;
            const word = model.getWordUntilPosition(position);
            const range = {
                startLineNumber: position.lineNumber,
                endLineNumber: position.lineNumber,
                startColumn: word.startColumn,
                endColumn: word.endColumn,
            };
            let res;
            try {
                res = await lsp.request('textDocument/completion', {
                    textDocument: { uri },
                    position: { line: position.lineNumber - 1, character: position.column - 1 },
                });
            } catch {
                return { suggestions: [] };
            }
            const items = Array.isArray(res) ? res : (res && res.items) || [];
            const SNIPPET = monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet;
            return {
                suggestions: items.map((it) => ({
                    label: it.label,
                    kind: lspKindToMonaco(it.kind),
                    insertText: (it.textEdit && it.textEdit.newText) || it.insertText || it.label,
                    // LSP insertTextFormat 2 = Snippet (${1:..} tab-stops). Tell Monaco
                    // to expand it rather than insert the literal placeholder text.
                    insertTextRules: it.insertTextFormat === 2 ? SNIPPET : undefined,
                    detail: it.detail || undefined,
                    documentation: it.documentation
                        ? { value: docText(it.documentation) }
                        : undefined,
                    range,
                    // Stash the raw LSP item so resolveCompletionItem can lazily fetch
                    // detail/documentation (server advertised resolveProvider:true).
                    __lsp: it,
                })),
            };
        },
        // Lazily enrich a highlighted item with detail/documentation via
        // completionItem/resolve. Monaco hands back the mapped item; we resolve from
        // the stashed raw LSP item and merge any newly-returned fields.
        async resolveCompletionItem(item) {
            if (!item.__lsp) return item;
            const r = await req('completionItem/resolve', item.__lsp);
            if (!r) return item;
            if (r.detail) item.detail = r.detail;
            if (r.documentation) item.documentation = { value: docText(r.documentation) };
            return item;
        },
    });

    monaco.languages.registerHoverProvider(LANG_ID, {
        async provideHover(model, position) {
            const uri = modelUris.get(model);
            if (!lsp.connected() || !uri) return null;
            await lsp.ready;
            let res;
            try {
                res = await lsp.request('textDocument/hover', {
                    textDocument: { uri },
                    position: { line: position.lineNumber - 1, character: position.column - 1 },
                });
            } catch {
                return null;
            }
            if (!res || !res.contents) return null;
            const c = res.contents;
            const value = Array.isArray(c)
                ? c.map((x) => (typeof x === 'string' ? x : x.value || '')).join('\n\n')
                : typeof c === 'string' ? c : c.value || '';
            if (!value) return null;
            return { contents: [{ value }] };
        },
    });

    // Parameter hints while typing a call: `func(` and `,` (server trigger chars).
    monaco.languages.registerSignatureHelpProvider(LANG_ID, {
        signatureHelpTriggerCharacters: ['(', ','],
        signatureHelpRetriggerCharacters: [','],
        async provideSignatureHelp(model, position) {
            const uri = uriParam(model);
            if (!uri) return null;
            const r = await req('textDocument/signatureHelp', {
                textDocument: { uri },
                position: lspPos(position),
            });
            if (!r || !Array.isArray(r.signatures) || r.signatures.length === 0) return null;
            const value = {
                signatures: r.signatures.map((s) => ({
                    label: s.label,
                    documentation: s.documentation ? { value: docText(s.documentation) } : undefined,
                    parameters: (s.parameters || []).map((p) => ({
                        label: p.label,
                        documentation: p.documentation
                            ? { value: docText(p.documentation) }
                            : undefined,
                    })),
                    activeParameter: s.activeParameter,
                })),
                activeSignature: r.activeSignature || 0,
                activeParameter: r.activeParameter || 0,
            };
            return { value, dispose() {} };
        },
    });

    // Go-to-definition / go-to-declaration (Cmd+click, F12).
    const defProvider = (method) => ({
        async provideDefinition(model, position) {
            const uri = uriParam(model);
            if (!uri) return null;
            const r = await req(method, { textDocument: { uri }, position: lspPos(position) });
            return mapLocs(r);
        },
    });
    monaco.languages.registerDefinitionProvider(LANG_ID, defProvider('textDocument/definition'));
    monaco.languages.registerDeclarationProvider(LANG_ID, {
        async provideDeclaration(model, position) {
            const uri = uriParam(model);
            if (!uri) return null;
            const r = await req('textDocument/declaration', {
                textDocument: { uri },
                position: lspPos(position),
            });
            return mapLocs(r);
        },
    });

    // Find all references (Shift+F12).
    monaco.languages.registerReferenceProvider(LANG_ID, {
        async provideReferences(model, position, context) {
            const uri = uriParam(model);
            if (!uri) return [];
            const r = await req('textDocument/references', {
                textDocument: { uri },
                position: lspPos(position),
                context: { includeDeclaration: !!(context && context.includeDeclaration) },
            });
            return mapLocs(r);
        },
    });

    // Symbol rename (F2), with prepare to validate the rename target first.
    monaco.languages.registerRenameProvider(LANG_ID, {
        async provideRenameEdits(model, position, newName) {
            const uri = uriParam(model);
            if (!uri) return { edits: [] };
            const r = await req('textDocument/rename', {
                textDocument: { uri },
                position: lspPos(position),
                newName,
            });
            return mapWsEdit(r);
        },
        async resolveRenameLocation(model, position) {
            const uri = uriParam(model);
            if (!uri) return null;
            const r = await req('textDocument/prepareRename', {
                textDocument: { uri },
                position: lspPos(position),
            });
            if (!r) return null;
            // prepareRename → {range, placeholder} | Range | {defaultBehavior}
            const range = r.range || (r.start && r.end ? r : null);
            if (!range) return null;
            const word = model.getWordAtPosition(position);
            return { range: toRange(range), text: r.placeholder || (word && word.word) || '' };
        },
    });

    // Outline / breadcrumbs / Cmd+Shift+O.
    monaco.languages.registerDocumentSymbolProvider(LANG_ID, {
        displayName: 'stryke',
        async provideDocumentSymbols(model) {
            const uri = uriParam(model);
            if (!uri) return [];
            const r = await req('textDocument/documentSymbol', { textDocument: { uri } });
            return (Array.isArray(r) ? r : []).map(mapSym).filter(Boolean);
        },
    });

    // Format document.
    monaco.languages.registerDocumentFormattingEditProvider(LANG_ID, {
        async provideDocumentFormattingEdits(model, options) {
            const uri = uriParam(model);
            if (!uri) return [];
            const r = await req('textDocument/formatting', {
                textDocument: { uri },
                options: {
                    tabSize: options.tabSize,
                    insertSpaces: options.insertSpaces,
                },
            });
            return (Array.isArray(r) ? r : []).map((te) => ({
                range: toRange(te.range),
                text: te.newText,
            }));
        },
    });

    // LSP-driven folding ranges (more accurate than indentation folding).
    monaco.languages.registerFoldingRangeProvider(LANG_ID, {
        async provideFoldingRanges(model) {
            const uri = uriParam(model);
            if (!uri) return [];
            const r = await req('textDocument/foldingRange', { textDocument: { uri } });
            return (Array.isArray(r) ? r : []).map((f) => ({
                start: f.startLine + 1,
                end: f.endLine + 1,
            }));
        },
    });

    // Highlight all occurrences of the symbol under the cursor.
    const DH = monaco.languages.DocumentHighlightKind;
    monaco.languages.registerDocumentHighlightProvider(LANG_ID, {
        async provideDocumentHighlights(model, position) {
            const uri = uriParam(model);
            if (!uri) return [];
            const r = await req('textDocument/documentHighlight', {
                textDocument: { uri },
                position: lspPos(position),
            });
            return (Array.isArray(r) ? r : []).map((h) => ({
                range: toRange(h.range),
                // LSP DocumentHighlightKind 1=Text/2=Read/3=Write; Monaco 0/1/2.
                kind: h.kind ? h.kind - 1 : DH.Text,
            }));
        },
    });

    // Quick fixes / refactors. Only edit-bearing actions are surfaced — pure-command
    // actions would need a workspace/executeCommand round-trip we don't wire, so
    // including them would be dead menu entries.
    monaco.languages.registerCodeActionProvider(LANG_ID, {
        async provideCodeActions(model, range, context) {
            const uri = uriParam(model);
            if (!uri) return { actions: [], dispose() {} };
            const r = await req('textDocument/codeAction', {
                textDocument: { uri },
                range: {
                    start: { line: range.startLineNumber - 1, character: range.startColumn - 1 },
                    end: { line: range.endLineNumber - 1, character: range.endColumn - 1 },
                },
                context: { diagnostics: [], only: (context && context.only) ? [context.only] : undefined },
            });
            const list = (Array.isArray(r) ? r : []).filter((a) => a && a.edit);
            return {
                actions: list.map((a) => ({
                    title: a.title,
                    kind: a.kind,
                    isPreferred: a.isPreferred,
                    diagnostics: [],
                    edit: mapWsEdit(a.edit),
                })),
                dispose() {},
            };
        },
    });
}

// Semantic-token highlighting. Registered lazily on `ready` because Monaco calls
// getLegend() synchronously and the legend must come from the server's initialize
// result (the token-type/modifier order indexes the encoded data — a mismatched
// legend mis-colors). This replaces the Perl-Monarch approximation with the server's
// real stryke tokens.
let semanticRegistered = false;
function registerSemanticTokens() {
    if (semanticRegistered) return;
    const caps = lsp.capabilities();
    const legend = caps && caps.semanticTokensProvider && caps.semanticTokensProvider.legend;
    if (!legend || !Array.isArray(legend.tokenTypes)) return;
    semanticRegistered = true;
    monaco.languages.registerDocumentSemanticTokensProvider(LANG_ID, {
        getLegend: () => ({
            tokenTypes: legend.tokenTypes,
            tokenModifiers: legend.tokenModifiers || [],
        }),
        async provideDocumentSemanticTokens(model) {
            const uri = uriParam(model);
            if (!uri) return null;
            const r = await req('textDocument/semanticTokens/full', { textDocument: { uri } });
            if (!r || !Array.isArray(r.data)) return null;
            return { data: new Uint32Array(r.data), resultId: r.resultId };
        },
        releaseDocumentSemanticTokens() {},
    });
}

// Apply server-pushed diagnostics to the matching model's markers.
function applyDiagnostics(params) {
    if (!params || !params.uri) return;
    let model = null;
    for (const [m, u] of modelUris) {
        if (u === params.uri) { model = m; break; }
    }
    if (!model) return;
    const markers = (params.diagnostics || []).map((d) => ({
        severity: lspSeverityToMonaco(d.severity),
        message: d.message,
        source: d.source || 'stryke',
        startLineNumber: d.range.start.line + 1,
        startColumn: d.range.start.character + 1,
        endLineNumber: d.range.end.line + 1,
        endColumn: d.range.end.character + 1,
    }));
    monaco.editor.setModelMarkers(model, 'stryke', markers);
}

const HooksEditor = {
    /**
     * Wire the LSP client to a caller-supplied transport. `send(message)` ships a
     * raw JSON-RPC string to the server (host bridge adds Content-Length framing).
     * Inbound messages must be fed back via `HooksEditor.receive(message)`.
     */
    initClient(s) {
        registerProviders();
        const r = lsp.init(s);
        // Semantic tokens need the server legend from the handshake (see fn comment).
        lsp.ready.then(registerSemanticTokens);
        return r;
    },

    /** Feed one raw JSON-RPC message from the server to the client. */
    receive(message) {
        lsp.receive(message);
    },

    clientReady() {
        return lsp.connected();
    },

    /**
     * Real LSP readiness: resolves true once the stryke `initialize` handshake
     * actually completed, false if it failed/was absent. Use this for a status
     * indicator — unlike a transport "connected" flag, it means the server
     * answered. Must be called after initClient().
     */
    whenReady() {
        return lsp.ready.then(() => lsp.isInitialized());
    },

    /**
     * Mount an editor into `parent`.
     *  - `uri`: file:// URI identifying the document to the language server (LSP off if absent)
     *  - `doc`: initial text
     *  - `onChange(text)`: fires on every edit with the full text
     *  - `mode`: 'default' | 'vim' | 'emacs'
     *  - `statusBar`: optional element for the vim mode/command line
     * Returns a handle with getValue/setValue/focus/setMode/destroy.
     */
    create(parent, { uri, doc, onChange, mode, statusBar } = {}) {
        const model = monaco.editor.createModel(
            doc || '',
            LANG_ID,
            uri ? monaco.Uri.parse(uri) : undefined,
        );
        if (uri) modelUris.set(model, uri);

        const editor = monaco.editor.create(parent, {
            ...BASE_EDITOR_OPTS,
            model,
            overflowWidgetsDomNode: overflowWidgetsNode(),
            // Use server-provided semantic tokens for highlighting (overlaid on Monarch).
            'semanticHighlighting.enabled': true,
        });

        let version = 1;
        let opened = false;
        if (lsp.connected() && uri) {
            // Defer didOpen until the LSP handshake completes; capture the live
            // buffer (not the stale initial `doc`) so edits during boot aren't lost.
            lsp.ready.then(() => {
                lsp.notify('textDocument/didOpen', {
                    textDocument: { uri, languageId: LANG_ID, version, text: model.getValue() },
                });
                opened = true;
            });
        }
        const changeSub = model.onDidChangeContent(() => {
            const text = model.getValue();
            if (typeof onChange === 'function') onChange(text);
            if (lsp.connected() && uri && opened) {
                version += 1;
                lsp.notify('textDocument/didChange', {
                    textDocument: { uri, version },
                    contentChanges: [{ text }],
                });
            }
        });

        const modal = attachModal(editor, statusBar);
        modal.applyMode(mode || 'default');

        return {
            getValue: () => model.getValue(),
            setValue: (text) => model.setValue(text == null ? '' : text),
            focus: () => editor.focus(),
            setMode: (m) => modal.applyMode(m),
            destroy: () => {
                modal.dispose();
                changeSub.dispose();
                if (lsp.connected() && uri) lsp.notify('textDocument/didClose', { textDocument: { uri } });
                monaco.editor.setModelMarkers(model, 'stryke', []);
                modelUris.delete(model);
                editor.dispose();
                model.dispose();
            },
        };
    },

    /**
     * Mount a PLAIN editor (no LSP) for a Monaco-registered language — used for the
     * JavaScript command step, which gets IntelliSense from Monaco's built-in TS
     * language service rather than the stryke LSP. Same handle shape as create().
     *  - `language`: a registered language id (e.g. 'javascript')
     *  - `uri`, `doc`, `onChange(text)`, `mode`, `statusBar` — as create()
     */
    createPlain(parent, { language, uri, doc, onChange, mode, statusBar } = {}) {
        const model = monaco.editor.createModel(
            doc || '',
            language || 'javascript',
            uri ? monaco.Uri.parse(uri) : undefined,
        );
        const editor = monaco.editor.create(parent, {
            ...BASE_EDITOR_OPTS,
            model,
            overflowWidgetsDomNode: overflowWidgetsNode(),
        });
        const changeSub = model.onDidChangeContent(() => {
            if (typeof onChange === 'function') onChange(model.getValue());
        });
        const modal = attachModal(editor, statusBar);
        modal.applyMode(mode || 'default');

        return {
            getValue: () => model.getValue(),
            setValue: (text) => model.setValue(text == null ? '' : text),
            focus: () => editor.focus(),
            setMode: (m) => modal.applyMode(m),
            destroy: () => {
                modal.dispose();
                changeSub.dispose();
                editor.dispose();
                model.dispose();
            },
        };
    },
};

window.HooksEditor = HooksEditor;
