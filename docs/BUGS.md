# zwire — known defects

Defects found against the zwire fork of Chromium, and the fork patch that
closed each one. Patches live in `fork/patches/`; the numbering here is the
patch that fixes the entry.

Every entry below is **fixed**. Nothing in this file is open.

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

---

## FIXED — auto-hibernate discarded a tab that was in a video call

**Fixed by** `fork/patches/0028-ext-discard-respect-capture.patch` plus the
extension-side guard in `extensions/hud-internal/zhibernate-core.js` /
`zcapture-main.js`.

A Google Meet presentation ended itself after about 40 minutes: the screen share
stopped, the microphone was released, and the tab came back dead. No crash, no
crash dump, a clean `exit_type: "Normal"` in the profile. The macOS capture
indicator recorded the whole failure in three milliseconds:

```
20:02:25.347  scr released  (com.menketechnologies.zwire)
20:02:25.350  mic released  (com.menketechnologies.zwire)
```

Two capture sessions ending in the same instant is not a network drop and not a
stall — it is the WebContents being destroyed. The HUD's auto-hibernate sweep
did it: a 5-minute alarm discards any tab idle past `zb_autohibernate` minutes
(default 30), and the guards were `active || pinned || audible || discarded`.
A tab you present *from* is none of those. It is not active (you are looking at
what you are sharing) and it is not audible — `audible` means the tab *produces*
sound, and a tab that is consuming a microphone and a screen produces none.

`chrome.tabs.discard()` then honoured it, because the extension path does not
consult the policy that protects Chrome's own Memory Saver. The eligibility
checks — `IsCapturingVideo`, `IsCapturingAudio`, `IsBeingMirrored`,
`IsCapturingWindow`, `IsCapturingDisplay` — live in
`DiscardEligibilityPolicy::CanDiscard`, and the call arrives instead at:

```
TabsDiscardFunction::Run          (extensions/api/tabs/tabs_api.cc)
  -> TabListBridge::DiscardTab    (ui/tabs/tab_list_bridge.cc, reason EXTERNAL)
    -> TabLifecycleUnit::Discard  (resource_coordinator/tab_lifecycle_unit.cc)
```

which checks only `IsDiscardBlockedByFeature`, tab-strip membership, and the
already-discarded bit. That is the whole reason Chrome never drops a call this
way and zwire did.

The fix is in both halves. The patch asks the `MediaStreamCaptureIndicator` —
the same source the eligibility policy reads — inside `TabListBridge::DiscardTab`
and returns "not discarded" for a capturing tab, which covers every
extension-initiated discard including the HUD's manual *discard tab* / *discard
others* commands. The extension keeps its own per-frame capture map, fed by a
MAIN-world hook on `getUserMedia` / `getDisplayMedia` / `RTCPeerConnection`, so
the sweep never proposes such a tab in the first place; `tests/hibernate.mjs`
pins that decision.
