// Monaco-free LSP JSON-RPC client core for the stryke hooks editor.
//
// Owns the editor-agnostic half of the LSP client: transport wiring, request/
// response id correlation, the initialize→initialized handshake, answering
// server→client requests, and diagnostics fan-out. Deliberately imports nothing
// from Monaco so it is unit-testable headlessly (see tests/lsp_client_core).
//
// Transport contract: `send(message)` ships ONE raw (unframed) JSON-RPC string;
// the host bridge (Rust) adds the LSP `Content-Length` framing. Inbound raw
// strings are handed back via `receive()`.
//
// `ready` resolves only after the handshake completes. Callers MUST gate document
// notifications (didOpen/didChange) and feature requests (completion/hover) on it
// — the LSP base protocol lets a server ignore anything sent before `initialized`,
// which otherwise makes completion silently return nothing on a fresh mount.

export function createLspCore() {
    let send = null;
    let initialized = false;
    let serverCaps = null;         // the server's advertised capabilities (from initialize)
    let nextId = 1;
    const pending = new Map();     // request id → { resolve, reject }
    let diagnosticsHandler = null;
    let markReady;
    const ready = new Promise((r) => { markReady = r; });

    function request(method, params) {
        if (!send) return Promise.reject(new Error('no transport'));
        const id = nextId++;
        return new Promise((resolve, reject) => {
            pending.set(id, { resolve, reject });
            send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
        });
    }

    function notify(method, params) {
        if (send) send(JSON.stringify({ jsonrpc: '2.0', method, params }));
    }

    function respond(id, result) {
        if (send) send(JSON.stringify({ jsonrpc: '2.0', id, result }));
    }

    return {
        /** Promise that resolves once initialize→initialized has completed. */
        ready,
        /** Whether a transport has been wired (parity with the old clientReady). */
        connected: () => !!send,
        /** Whether the initialize handshake has completed. */
        isInitialized: () => initialized,
        /** The server's advertised capabilities (null until the handshake completes). */
        capabilities: () => serverCaps,
        /** Register the handler invoked with `publishDiagnostics` params. */
        onDiagnostics(fn) { diagnosticsHandler = fn; },
        /** Send a JSON-RPC request; resolves/rejects when its response arrives. */
        request,
        /** Send a JSON-RPC notification (no response). */
        notify,

        /** Wire the transport and kick off the initialize handshake (idempotent). */
        init(transport) {
            if (send) return true;
            send = transport;
            request('initialize', {
                processId: null,
                rootUri: null,
                clientInfo: { name: 'hooks-editor-monaco' },
                capabilities: {
                    textDocument: {
                        synchronization: { dynamicRegistration: false, didSave: false },
                        completion: { completionItem: { snippetSupport: true } },
                        hover: { contentFormat: ['markdown', 'plaintext'] },
                        publishDiagnostics: {},
                    },
                },
            })
                .then((res) => {
                    serverCaps = (res && res.capabilities) || null;
                    initialized = true;
                    notify('initialized', {});
                    markReady();
                })
                // Even on a failed/absent initialize, release waiters so feature
                // requests fail fast (returning nothing) instead of hanging forever.
                .catch(() => markReady());
            return true;
        },

        /** Feed one raw JSON-RPC message from the server to the client. */
        receive(message) {
            let msg;
            try {
                msg = JSON.parse(typeof message === 'string' ? message : String(message));
            } catch {
                return;
            }
            // Response to one of our requests.
            if (msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined)) {
                const p = pending.get(msg.id);
                if (!p) return;
                pending.delete(msg.id);
                if (msg.error) p.reject(msg.error);
                else p.resolve(msg.result);
                return;
            }
            // Server → client request: answer minimally so the server never blocks.
            if (msg.id !== undefined && msg.method) {
                respond(msg.id, msg.method === 'workspace/configuration' ? [] : null);
                return;
            }
            // Notification.
            if (msg.method === 'textDocument/publishDiagnostics' && diagnosticsHandler) {
                diagnosticsHandler(msg.params);
            }
        },
    };
}
