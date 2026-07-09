// Entry for Monaco's base editor web worker, bundled to
// frontend/lib/hooks-editor.worker.js by scripts/build-hooks-editor.mjs.
//
// Monaco requires a worker (set via MonacoEnvironment.getWorker in
// hooks-editor-entry.mjs). The stryke editor only uses the base editor worker
// (links, basic edits, diff) — no TS/JSON/CSS language workers — since all
// language intelligence comes from the stryke LSP over the host transport.
// Importing this module self-installs the worker's message handler.
import 'monaco-editor/esm/vs/editor/editor.worker.js';
