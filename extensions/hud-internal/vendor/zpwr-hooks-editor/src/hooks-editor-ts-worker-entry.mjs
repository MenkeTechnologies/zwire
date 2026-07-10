// Entry for Monaco's TypeScript/JavaScript language web worker, bundled to
// hooks-editor.ts.worker.js by scripts/build-hooks-editor.mjs.
//
// The base editor worker (hooks-editor.worker.js) serves the stryke editor, whose
// intelligence comes from the stryke LSP. The PLAIN JavaScript editor
// (HooksEditor.createPlain) instead uses Monaco's built-in TS language service,
// which runs in THIS worker — completion, hover, and signature help for JS.
// Importing this module self-installs the worker's message handler.
import 'monaco-editor/esm/vs/language/typescript/ts.worker.js';
