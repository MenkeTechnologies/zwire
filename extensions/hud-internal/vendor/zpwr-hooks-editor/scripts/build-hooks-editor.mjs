// Bundles the shared stryke Hooks code editor (Monaco + monaco-vim + monaco-emacs + a
// thin stryke-LSP adapter) into vendored IIFE artifacts:
//   - hooks-editor.bundle.js  (+ hooks-editor.bundle.css)  — the editor
//   - hooks-editor.worker.js                               — Monaco's base worker
//
// SHARED-SUBMODULE build: the editor SOURCE lives in this repo (src/), but the build runs
// in the CONSUMING app so it resolves that app's monaco-* deps and writes into that app's
// frontend/lib. Invoke from the consumer's project root (where node_modules + frontend/ are),
// e.g. in tauri.conf.json beforeDevCommand:
//
//   node crates/zpwr-hooks-editor/scripts/build-hooks-editor.mjs
//
// Output dir defaults to <cwd>/frontend/lib; override with HOOKS_EDITOR_OUT.
// Each consumer must keep esbuild + monaco-editor/monaco-vim/monaco-emacs in devDependencies.
import { build } from 'esbuild';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url)); // this repo's scripts/
const src = join(here, '..', 'src'); // shared editor source
const consumer = process.cwd(); // the app invoking the build
const lib = process.env.HOOKS_EDITOR_OUT || join(consumer, 'frontend', 'lib');

// Force monaco-vim's ESM build (dist/index.mjs). Its package `exports` map lists a
// `browser` condition pointing at the UMD bundle, which esbuild picks for platform=browser
// — and that UMD carries a bare AMD `define()` (the embedded CodeMirror vim keymap) that
// throws "define is not defined" in the WebView, aborting the whole bundle so the hook
// editor silently degrades to a textarea. A path alias can't reach dist/index.mjs (exports
// blocks the subpath), so resolve it directly. The ESM build is verified free of `define`.
const monacoVimEsm = join(consumer, 'node_modules', 'monaco-vim', 'dist', 'index.mjs');
if (!existsSync(monacoVimEsm)) {
    throw new Error(
        `monaco-vim ESM build not found at ${monacoVimEsm} — run pnpm install in the consumer (it must keep monaco-* + esbuild devDeps)`
    );
}
const monacoDir = join(consumer, 'node_modules', 'monaco-editor');
const resolveFix = {
    name: 'monaco-resolve-fix',
    setup(b) {
        // Force monaco-vim to its ESM build (see above).
        b.onResolve({ filter: /^monaco-vim$/ }, () => ({ path: monacoVimEsm }));
        // Bare `monaco-editor` (monaco-emacs is CommonJS and require()s it) would resolve
        // via the package's `require` export condition to the AMD *min* build, which calls
        // bare `define(...)` and throws "define is not defined" in the WebView. Pin it to
        // the ESM editor API instead — same lean instance our entry uses, no AMD bloat.
        b.onResolve({ filter: /^monaco-editor$/ }, () => ({
            path: join(monacoDir, 'esm/vs/editor/edcore.main.js'),
        }));
        // monaco-editor's `exports` map ("./*": "./*") only resolves paths that already
        // carry a file extension. The ESM monaco-vim (and our entry) import deep monaco
        // subpaths without `.js`, so append it and resolve to the package dir directly.
        b.onResolve({ filter: /^monaco-editor\/esm\// }, (args) => {
            let p = args.path;
            if (!/\.(js|mjs|css|ttf)$/.test(p)) p += '.js';
            return { path: join(monacoDir, p.slice('monaco-editor/'.length)) };
        });
    },
};

const common = {
    bundle: true,
    format: 'iife',
    target: 'es2020',
    minify: true,
    sourcemap: false,
    legalComments: 'none',
    // Monaco's CSS pulls in the codicon font; inline it so the single .css artifact is
    // self-contained (no separate font file to serve).
    loader: { '.ttf': 'dataurl' },
    plugins: [resolveFix],
};

// Main editor bundle (emits hooks-editor.bundle.js + hooks-editor.bundle.css).
await build({
    ...common,
    entryPoints: [join(src, 'hooks-editor-entry.mjs')],
    outfile: join(lib, 'hooks-editor.bundle.js'),
});

// Monaco base web worker (serves the stryke editor).
await build({
    ...common,
    entryPoints: [join(src, 'hooks-editor-worker-entry.mjs')],
    outfile: join(lib, 'hooks-editor.worker.js'),
});

// Monaco TypeScript/JavaScript language worker (serves JS IntelliSense for the
// plain, non-LSP editor). Skipped cleanly if the entry is absent (older checkout).
if (existsSync(join(src, 'hooks-editor-ts-worker-entry.mjs'))) {
    await build({
        ...common,
        entryPoints: [join(src, 'hooks-editor-ts-worker-entry.mjs')],
        outfile: join(lib, 'hooks-editor.ts.worker.js'),
    });
}

console.log(`Wrote ${lib}/hooks-editor.bundle.{js,css} + hooks-editor.worker.js + hooks-editor.ts.worker.js`);
