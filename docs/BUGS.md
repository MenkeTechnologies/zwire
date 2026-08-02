# zwire — known defects

Defects found against the zwire fork of Chromium, and the fork patch that
closed each one. Patches live in `fork/patches/`; the numbering here is the
patch that fixes the entry.

Both entries below are **fixed**. Nothing in this file is open.

---

## FIXED — browser process crashes on an extension API call during navigation

**Fixed by** `fork/patches/0018-ext-dispatch-null-policy-container.patch`
**Upstream** crbug.com/455908853

Navigating the Chrome Web Store top-charts page could take down the whole
browser process — not a tab, the browser.

`ExtensionFunctionDispatcher::DispatchWithCallbackInternal` computed an
`is_sandboxed` flag straight off the requesting frame:

```cpp
bool is_sandboxed =
    render_frame_host && render_frame_host->IsSandboxed(
                             network::mojom::WebSandboxFlags::kOrigin);
```

An extension-function IPC is asynchronous, so it can be processed after the
requesting frame has already left the active lifecycle — pending-deletion, or
speculative mid-navigation. Such a `RenderFrameHostImpl` has a null
`policy_container_host_`, so `IsSandboxed()` → `active_sandbox_flags()` reaches
`NOTREACHED()` and traps.

Signature, on the browser main thread:

```
Exception Type:  EXC_BREAKPOINT (SIGTRAP)
Thread 0 Crashed:: CrBrowserMain  Dispatch queue: com.apple.main-thread

0  content::RenderFrameHostImpl::IsSandboxed(network::mojom::WebSandboxFlags)
1  extensions::ExtensionFunctionDispatcher::DispatchWithCallbackInternal(...)
2  extensions::ExtensionFunctionDispatcher::Dispatch(...)
3  extensions::ExtensionFrameHost::Request(...)
4  extensions::mojom::LocalFrameHostStubDispatch::AcceptWithResponder(...)
5  mojo::InterfaceEndpointClient::HandleValidatedMessage(mojo::Message*)
```

`is_sandboxed` only feeds a UMA histogram further down, so the patch gates it on
`IsActive()` — a committed active document always has a policy container:

```cpp
bool is_sandboxed =
    render_frame_host && render_frame_host->IsActive() &&
    render_frame_host->IsSandboxed(
        network::mojom::WebSandboxFlags::kOrigin);
```

---

## FIXED — HUD palette (`Cmd K`) inert on Chrome Web Store pages

**Fixed by** `fork/patches/0019-ext-script-webstore.patch`

`Cmd K` did nothing on `https://chromewebstore.google.com/top-charts/popular`,
and content scripts and `tabs.executeScript` were silently refused on every
webstore URL.

Stock Chromium special-cases the gallery as a restricted URL in
`ChromeExtensionsClient::IsScriptableURL`, hard-blocking all extension scripting
on the webstore domains. zwire's HUD ships its own new-tab, palette and
extension-management surfaces that have to script the store — one-click install
flows, store re-skins — so the patch drops the special case behind a named
constant and lets those pages script like any other.

The store's own privileged JS bindings remain gated separately, by the
`IsWebstoreOrigin` checks in `permissions_data.cc`, which the patch does not
touch.
