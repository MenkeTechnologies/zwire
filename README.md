```
 _______        _____ ____  _____ 
|__  /\ \      / /_ _|  _ \| ____|
  / /  \ \ /\ / / | || |_) |  _|  
 / /_   \ V  V /  | ||  _ <| |___ 
/____|   \_/\_/  |___|_| \_\_____|
```

[![Base](https://img.shields.io/badge/base-chromium%20fork-05d9e8.svg)](#0x02-architecture)
[![Workspace](https://img.shields.io/badge/HUD-tiling%20workspace-ff2a6d.svg)](#0x01-the-hud-workspace)
[![Patches](https://img.shields.io/badge/native%20fork-28%20patches-d300c5.svg)](#0x05-full-hud-fork)
[![Docs](https://img.shields.io/badge/docs-online-05d9e8.svg)](https://menketechnologies.github.io/zwire/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

### `[FORKED CHROMIUM · TILING HUD · CYBERPUNK]`

> *"Not Chrome with a skin — a real Blink engine turned into a keyboard-driven, tiling, cyberpunk workspace."*

zwire is a **Chromium/Blink browser forked into a cyberpunk HUD**. It is not a
theme and not a wrapper — it is a real engine running a full keyboard-driven
workspace layered on top:

- a **tmux-style tiling overlay** — unlimited windows, recursive pane splits,
  each pane an embedded webview of any site;
- a **⌘K command palette**, **vim-style navigation**, and a **find bar**;
- **the real tmux server too** — the same ⌘K palette lists the live panes of the
  multiplexer running in the user's terminal, runs commands in them, and moves
  text between the browser and tmux's paste buffers, over tmux's own wire
  protocol (no `tmux` subprocess);
- durable, named **session management** with full CRUD + SVG layout previews;
- **HUD reimplementations of Chrome's own internal pages** (extensions,
  settings, history, bookmarks, version) — Settings is sectioned like Chrome's
  own (Appearance, Privacy & data, Autofill, Search, On startup, Downloads,
  Languages, Performance, Accessibility, Advanced) and hosts a **clear browsing
  data wizard** (time range → data types → origin scope → per-type result), and
  History supports per-entry delete plus range/all clear — plus a keyboard-remap page and a
  **dashboard** — one searchable, drag-orderable tile grid that launches every
  HUD page *and* every `chrome://` internal page;
- **8 color schemes** — each with a **light variant** — that drive the browser
  chrome natively, with a light/dark toggle that syncs across the HUD, new-tab
  page, and `zpwrchrome` instantly;
- a **browser-wide audio engine** — an always-on zdsp-core chain (parametric EQ +
  channel strip + saturation/dynamics + modulation + time FX + spatial + limiter)
  compiled into the audio service (every tab, live-reconfigurable
  with nothing open) plus a live **Audio HUD page** with real post-DSP spectrum
  and meters;
- **lifecycle hooks** — a **Hooks HUD page** that binds
  [stryke](https://github.com/MenkeTechnologies/strykelang) scripts to 54
  browser events (tab / window / navigation / download / bookmark / terminal /
  scheme / audio / ⌘K-command lifecycle, plus an `action` catch-all), with a
  searchable event picker;
- **output triggers** — a **Triggers HUD page** that binds a regex to page text
  *as it renders/streams* (the browser analog of a terminal-emulator trigger) and,
  on a match, runs a chain of typed steps — shell / stryke / JavaScript /
  AppleScript / batch / browser-action / suite-app-call / page-assert / page-premise / scheme /
  host — the
  identical step set a ⌘K command runs, with the matched line passed as `{q}`; per-trigger cooldown, a
  **once-per-page** mode, and an optional URL-filter regex keep it scoped, and a
  **self-reverting** mode runs the whole chain as one `zwire-host` transaction so a
  failure at any step undoes the steps that already ran;
- **pane pipelines** — a **Pipelines HUD page** (and the tmux prefix then `|`)
  that wires a persisted, reactive dataflow **edge** between tiled webviews:
  extract text from a source pane (selector / regex / selection / URL), transform
  it (a stryke `|>` op chain, JS, or passthrough), and deliver it to a sink pane
  (navigate / fill a field / replace or append a node / batch-open) — or past the
  browser entirely, into another running MenkeTechnologies app as a typed bus call —
  with a graph cycle-check that refuses an A→B→A loop. No rival ships piping between
  tiled views;
- an **automation verb bus** — one namespaced `browser.*` surface (tab / group /
  window ops, edge-snapping, downloads, browsing-data clearing, bookmarks,
  reading list, extensions, power, screenshot, notify, tmux toggle) that the ⌘K
  palette, keyboard shortcuts, and stryke hooks all drive through a single
  service-worker executor, published as a typed, introspectable manifest;
- **undoable browsing** — a chain of those verbs runs as one unit that rolls
  back. "Open 40 tabs from this list, group them, pin three, close the
  duplicates" is a transaction: each step's pre-state is journaled in the service
  worker as it executes, and an abort replays the inverses in reverse order —
  reopening closed tabs at their prior index, window, pinned and muted state,
  restoring prior positions, selection, url and zoom. Nothing else does this:
  Chrome, Arc, Vivaldi, Edge and Safari stop at ⇧⌘T (reopen the last tab) and
  cannot roll back a chain. A verb with no compensation is refused when the
  transaction opens rather than stranding one half-done, and the whole N-step
  unwind arrives as a single `browser.undo` frame — one native-messaging round
  trip, not N;
- **the rendered page as typed state** — the suite bus can ask this browser what
  it is *showing*, not just tell it what to do. `page.url` · `page.title` ·
  `page.text` · `page.links` · `page.headings` · `page.tables` · `page.forms` ·
  `page.meta` · `page.selection` (plus `page.extract` for any selector) are
  answered from the **live DOM** — after the login, after the JavaScript, inside
  the session the user is actually in — to any running app that dials
  `App::open("zwire")->get("page.tables")`, with no browser client library, no
  remote-debugging port and no JavaScript eval channel. The page stops being a
  destination and becomes an input: zoffice pulls the tables, zreq reads the
  JSON an authenticated endpoint really returned, a stryke one-liner pipes
  `page.links` into anything. There are deliberately **no page writes** here
  (mutation stays on the journaled `browser.*` path, so nothing can change the
  browser behind `txn_abort`'s back) and `page.forms` publishes a form's *shape*
  — action, method, field names and types — and never a field's value;
- **postcondition-gated chains** — the piece the two features above only make
  sense together. `page.assert` projects the live page and tests it
  (`contains` · `not_contains` · `equals` · `empty` · `nonempty` ·
  `count_at_least` · `count_at_most`), and a failed assertion is a failed step —
  so inside a transaction the browser **unwinds itself when the page did not come
  out right**. "Open these 40 tabs, group them, pin three — and if the page that
  came back does not say `Order confirmed`, put my browser back exactly as it
  was." The commit decision stops being *did the calls return* and becomes *what
  did the browser actually render*. Playwright and Cypress assert over rendered
  state but have nothing to roll back to (their isolation model is a throwaway
  context, not your live browser); browser MCP servers and agentic browsers read
  the live page and stop or retry on failure rather than restoring what they
  changed. A page read is `pure` in the host's reversibility table, which is what
  lets the deciding step run *inside* the transaction it is deciding about;
- **premise-gated chains** — the other half of that gate, and the half nothing else
  has. A postcondition tests the page a chain *produced*; nothing tested the page it
  was *decided on*. Between reading a projection and committing, the browser is a
  shared mutable object with other writers — the user, a `setInterval`, a server
  push, a second agent — so a chain can act on a reading that stopped being true
  while it was mid-flight. `page.witness` declares a projection as a **premise** of
  the transaction: with an op it must still satisfy that predicate at commit,
  without one it must be byte-identical. `txn_commit` re-reads the whole premise set
  and, on any violation, turns the commit into an **abort** — the journaled inverses
  replay and the browser ends where it started. A premise nobody could re-read
  (browser closed, tab gone, origin denied) refuses the commit too, because "could
  not confirm" is not "held". Validation is **one round trip**: the set goes out as a
  single `page.batch` answered by one `scripting.executeScript` per target tab, so
  every projection in it comes from one DOM turn — checking them one at a time would
  let a set "hold" in a state the page was never simultaneously in. A transaction
  with no premises costs nothing and behaves exactly as before;
- **custom new-tab layouts** — a port of Vivaldi's Start Page onto the zwire new
  tab, and then some: named layouts you switch between (not one start page you
  reconfigure), each with its own **Speed Dial groups**, **widget grid**,
  navigation rail (any edge, or hidden) and background. Vivaldi's Speed Dial
  appearance block is ported setting for setting — maximum columns (or no limit),
  five thumbnail sizes, titles always / when-needed / never, the add button,
  drag-to-reorder, per-dial custom thumbnails — alongside its widget model
  (Date, Speed Dial, Search, Top Sites, Bookmarks, History, Feeds, Notes, Reading
  List, Sessions, Webpage; add-once vs. repeatable, Regular/Tall sizes). Editing
  happens **on the page** the way Vivaldi does it, and a **HUD layout manager**
  (`pages/newtab.html`) adds the library view Vivaldi has no equivalent for:
  previews of each layout's real grid, duplicate, and JSON import/export;
- the **`zpwrchrome`** power-tool preloaded against a dedicated profile, so it
  never touches your system Chrome.

The HUD layer (`extensions/hud-internal`) is ~18,300 lines of extension code
across 11 subsystems and 26 pages, assembled on the **`zgui-core`** shared GUI
toolkit (260 `ZGui.*` components, a git submodule loaded straight from
`lib/zgui-core/webui/`) and bridged to the **`zwire-host`** native agent (a
single Rust binary, its own submodule). Under it, a **28-patch C++ fork**
restyles the *native* chrome the extension layer can't reach.

**zwire is the full fork.** The 28-patch series (`fork/`) compiles a patched
Chromium so the *native* chrome carries the HUD too — sharp tab shapes, the
Share Tech Mono UI font, the neon toolbar, the omnibox, the 8 HUD schemes wired
into the color mixer + DevTools, native Views menus/dialogs bound to the HUD
palette, and a browser-wide audio EQ + live meters — the styling and behavior an
extension can't reach. See [`fork/README.md`](fork/README.md).

## `[0x00] WHY A REAL BLINK BASE`

`zpwrchrome` is a Manifest V3 extension that needs `userScripts`,
`declarativeNetRequestWithHostAccess`, `nativeMessaging`, `webRequest`, and a
service-worker background (`minimum_chrome_version: 127`). None of that runs on
WebKit (Tauri/Safari) or Servo — **only a real Chromium engine loads it.** The
tiling overlay also iframes arbitrary sites into its panes, which needs the
fork's frame-ancestors bypass (patch 0008) — impossible in a wrapper.

The fork compiles unbranded (`is_chrome_branded=false`), so it carries **no
Google logo and no "for automated testing" banner** (that stripe is exclusive to
Chrome for Testing), and it retains the `--load-extension` switch that preloads
`zpwrchrome` — [removed from *branded* Chrome in version 137][psa]. Stock Google
Chrome can no longer be scripted this way; a Chromium build can.

[psa]: https://groups.google.com/a/chromium.org/g/chromium-extensions/c/1-g8EFx2BBY/m/S0ET5wPjCAAJ

## `[0x01] THE HUD WORKSPACE`

`extensions/hud-internal` is where zwire stops being "a browser" and becomes a
workspace. It is a content-script + page bundle (~18,300 LOC), not a theme.

**`ztmux` — the tiling overlay.** A tmux server, in the browser. The tiling
window-manager itself is `ZGui.tmux` from the shared `zgui-core` toolkit; zwire
drives it with two thin adapters — `ztmux-config.js` (top frame: mounts each
pane as an address-bar + framed webview, feeds the WM) and `ztmux-pane.js` (the
`all_frames` pane-side forwarder that relays the prefix, synced keystrokes, and
copy-mode yanks up to the top frame). Recursive binary pane splits, unlimited
windows, and **every pane is a live webview** (any URL, iframed via the
allow-framing patch). Driven by a
**rebindable prefix** (default `Ctrl-b` / `⌥B`; set your own — `C-a` — on the
Keyboard page, with a configurable timeout). 49 prefix actions, all remappable:

- **panes** — split h/v, directional nav (arrows + `h/j/k/l`), resize
  (`H/J/K/L`), zoom, close, swap, rotate, break-to-window, pane numbers;
- **layouts** — cycle even/main/tiled, plus preset grids (4 / 8 / 16 panes), and
  a saved-layouts editor (`M`, or the overlay tab strip's Layouts button);
- **windows** — new, next/prev/last, rename, move, go-to, list, kill;
- **partial synchronize-panes** — broadcast typing to a *chosen subset* of
  panes, not just all-or-nothing (`Ctrl-b e` toggles all, `Ctrl-b E` toggles one);
- **copy mode** — scroll + yank selection into a paste-buffer stack;
- **marks**, **clock**, and a registry-driven **help** overlay.

Beyond the 49 remappable actions, the prefix then `|` starts a **pane pipeline**
(see below) — a reactive dataflow edge from the active pane into a sink pane.

**Sessions (`pages/sessions.html`).** Durable, named tmux sessions — windows,
panes, and each pane's webview — saved to `chrome.storage` (survives restart).
A full CRUD page: create / rename / duplicate / delete / load / import-export,
per-pane URL editing, and a **live SVG preview** of each window's tiling. Save
the current layout with `Ctrl-b S` and attach a saved one with `Ctrl-b s`, or give
a layout its own one-key `C-b <key>` **hotkey** on its card — the page warns when
that key shadows a built-in tmux binding. Loading picks the layout's first web
page as the carrier tab the overlay attaches to; an
all-new-tab layout (no web page) instead opens the new-tab extension's own
carrier page, which hosts the overlay and tiles the new-tab panes itself.

The page is **split-aware**: a saved window is `panes[]` (flat, depth-first)
*plus* `tree` — the tiling shape (split direction + ratio) — and every geometry
read and structural edit goes through **`ZGui.tmux.layout`** (`rects` / `dirs` /
`split` / `close`), the same helpers the overlay tiles with and its built-in
saved-layouts editor (prefix `M`) runs on. So the preview draws the real shape, a
per-pane glyph shows which split that pane sits in (`→` left-right, `↓`
top-bottom, `·` lone pane), and *split →* / *split ↓* insert a leaf beside the
pane they split while close collapses the split and promotes the sibling. The
page used to keep its own flat copy of the rebuild, so a top/bottom split
previewed — and reloaded — as side-by-side columns. Both surfaces read and write
the one `zb_tmux_sessions` array, so an edit in either shows up in the other.

**Files (`pages/files.html`).** The fleet's file manager, inside the browser.
The page mounts `zpwr-file-browser` (`lib/file-browser`, a submodule) **unmodified** —
tabbed panes with recursive tiling splits, a folder tree, preview pane, favourites,
colour labels, bulk rename, and its own fuzzy filter. zwire contributes only the
backend: `pages/files-host.js` binds `window.zfbHost` to `zwire-host` over one
persistent native-messaging port, mapping each method to an `fs_*` command. All 32
methods the browser calls are wired, so no control is dead. Two behave differently
here by choice — *Open Terminal* opens **zwire's own** PTY terminal tab at that
directory rather than launching the platform's terminal application, and the
directory watch resolves as a no-op, matching every other backend in the fleet
(the shared browser has no host-event channel on any of them).

**Timeline (`pages/timeline.html`).** Browsing history as an arrangement. The grid
is `zpwr-clip-engine` (`lib/clip-engine`, a submodule) and is not forked, patched or
subclassed; zwire adds a single domain file (`pages/history-domain.js`) in the same
shape as the engine's own `domains/*.js`. The mapping is literal — lane = an origin
you visited, unit = one hour, cell value = visit intensity normalised against the
busiest hour, drawn as the engine's 0..1 band. The surface is deliberately
read-only: painting a cell would assert a visit that never happened, and the
domain's `serialize` would then hand that back as real data.

**Hooks (`pages/hooks.html`).** Bind
[stryke](https://github.com/MenkeTechnologies/strykelang) scripts to browser
lifecycle events. The service worker fires 55 catalogued events — tab
open/close/activate/update/move, window open/close/focus, navigation, downloads,
bookmarks, history, the HUD terminal, scheme changes, the audio engine, ⌘K
palette commands, `zdiagnostic` (a UI layer reporting a wiring problem it will
not print), plus an `action` catch-all for every command — and `zwire-host`
runs each **enabled** hook whose event matches, feeding it the event JSON on
stdin. The script prints an `{actions:[…]}` object the host dispatches (`notify` /
`open` / `exec` / `pub`). The page has a searchable event picker, a Monaco editor
with the stryke LSP (vim/emacs modes), and a Test-run button.

**Triggers (`pages/triggers.html`).** Where Hooks react to browser *events*,
triggers react to page *content*. A content-script engine (`ztriggers.js`) runs on
every web page, watches its text as it renders and streams (a `MutationObserver`
over the DOM, throttled and line-capped), and matches each enabled trigger's regex
against the fresh output — the browser analog of a terminal emulator's output
triggers, a thing a tab-multiplexer can't do because it never sees rendered text.
On a match the trigger runs a **chain of typed steps** — the identical wizard a ⌘K
command uses (`shell` / `stryke` / `js` / `applescript` / `batch` / `action` /
`suite` / `scheme` / `host` / `url`), rendered by the shared `ZwireStepWizard` and executed
through the same `window.ZWIRE_CMD_EXEC` path — with the matched line passed as the
`{q}` argument. Each trigger carries its own cooldown (no process storm on bursty
output), an optional **once-per-page** mode (fires at most once per page load,
resetting on the next full navigation), and an optional URL-filter regex to scope
which pages it fires on. zwire's own injected UI — the ⌘K palette overlay and
toasts — is excluded from scanning, so the palette's command text never matches and
a trigger's own result toast can't recursively re-fire it. Stored in
`chrome.storage.local` (`zb_triggers`); the page is full CRUD with a per-trigger
enable toggle.

A trigger may also be **self-reverting**. Its chain then runs inside one
`zwire-host` transaction: the steps run one at a time, and if any step fails the
host replays the inverse of every step that already ran, so the browser is left as
it was rather than two-thirds changed. A trigger fires unattended, which is exactly
where a half-applied chain sits unnoticed until you happen to look. Only steps the
host can undo are allowed — a browser action or a URL becomes a journaled bus verb,
while `shell` / `stryke` / `js` / `applescript` / `batch` / `scheme` have no inverse
and are refused. The refusal happens while you are still editing: the Triggers page
reads the host's own surface (`{"cmd":"verbs"}`) and declines to save a chain it could
not revert.

Both halves ask the host the same question. `{"cmd":"verbs"}` answers with every verb
*and* its reversibility class, so **which** action ids are bus verbs and **whether**
each can be undone both come from the host — the page keeps no table of its own beyond
a small seed used for the moment before the host has answered (and for a host that is
absent, where nothing is accepted anyway). That matters because the two halves used to
disagree: the executor mirrored eleven ids and refused the rest at run time, and once
it started asking the host, the authoring check was left mirroring the same eleven and
refused at *save* time nearly every browser verb the host can revert. Neither half
records how many those are — the host's table grows as verbs are classified, and a
number written down here would be wrong by the next release.

**Pane pipelines (`pages/pipes.html`).** Where a trigger's sink is a step chain,
a pipeline's sink is *another pane*. A pipeline is a persisted, reactive dataflow
**edge** between tiled webviews — the browser-native analog of `curl … | jq |
xargs`, except the stages are live rendered pages:

```
source pane  --[ extract ]-->  [ filter ]  -->  sink pane
```

The **source** extracts text from any pane whose live URL matches its filter — a
CSS selector's text, a regex over rendered text (capture group 1 when present),
the current selection, or the URL — re-emitting reactively when the source pane's
content changes (the same throttled `MutationObserver` the triggers engine uses).
The **filter** transforms the emitted lines: a stryke-flavoured `|>` op chain
(`trim |> uniq |> first`, plus `grep`/`reject`/`replace`/`nth`/`take`/`join`/… ),
a JS expression (`lines`/`text` in scope), or passthrough. The **sink** delivers
the result to any pane whose URL matches — navigate it to a URL, fill a
selector-addressed field, replace or append a node, or batch-open every line — or,
with the **app** sink kind, leave the browser altogether and call a typed verb on
another running MenkeTechnologies app over its bus socket (see the suite bus client
below), which is how live page text lands in `zcite` / `zreq` / `zpdf` reactively.
Sink writes into a pane are posted through the pane forwarder, never a direct
cross-origin DOM write. Each edge carries a cooldown, an optional once-per-page mode, and
value-dedupe. Start one from the overlay with the tmux prefix then `|` (seeds the
active pane as the source); the page is full CRUD with per-edge enable toggles.

The whole thing is one pure engine — `zpipes-core.js` (`window.ZWIRE_PIPES`) —
that computes every decision (source extraction, filter, the gate, the sink
message, and the graph **cycle check** that refuses an A→B→A edge before it can
livelock the observer), reused verbatim by the pane forwarder, the top-frame
relay, and the CRUD page. No rival ships a data relationship between tiled views:
Vivaldi's Command Chains are sequence-only, Zen and Arc tile without cross-split
dataflow, and qutebrowser has no tiling at all. Stored in `chrome.storage.local`
(`zb_pipes`).

**Automation verb bus (`background.js` → `execZbCmd`).** Every HUD surface —
the ⌘K palette, content-script shortcuts, and stryke hooks — drives the browser
through one namespaced verb bus. A custom-command store seeds the defaults on
first run; each invocation routes through the `zb_cmd` storage bus to a single
executor in the service worker. The surface spans **tab ops** (open / close
left/right/others/duplicates / reopen / duplicate / pin / mute / discard / move /
sort / group), **tab-group** collapse/expand, **window ops** (new / close /
merge / min-max-restore / fullscreen / center / next-display), **edge snapping**
(left / right / top / bottom + four corners), **navigation** (back / forward /
home / zoom), **downloads** (pause / resume / cancel / retry / clear / reveal),
**browsing-data** clearing (cache / cookies / history / passwords / all),
**history + bookmark + reading-list** edits, **extension** enable/disable/
uninstall + **app launch**, **keep-awake** power control, **screenshot**,
**notify**, and the **`tmux`** overlay toggle. The typed manifest is published
through `ZGui.automation` — the shared registry every embedded core contributes
verbs to — so a stryke script sees one combined, introspectable `browser.*`
surface via `App::here()->verbs()`.

**Suite bus client (`zwire-host/src/suite.rs`).** The verb bus above is zwire being
*driven*. This is zwire *driving*: the browser calls typed verbs on the **other running
MenkeTechnologies apps** over their own bus sockets, and gets their return values back.
It is reachable three ways, all on the same host command set (`suite_list` /
`suite_verbs` / `suite_call` / `suite_get`):

- a **⌘K command / trigger step** of type **app** — `{"app":"zcite","verb":"item.add",
  "args":{"doi":"{q}"}}`, so a regex matching a DOI on a page as it renders files that
  paper in the reference manager without a human in the loop;
- a **pipeline sink** of kind **app** — a pane pipeline whose sink is not a pane at all
  but another application, so extracted page text is delivered reactively into
  `zcite` / `zreq` / `zpdf` / … as a typed call;
- the palette command **Apps on the bus**, which reports which apps are actually
  running.

Three details are load-bearing. **Liveness is proven, not assumed**: the socket
directory keeps entries from processes that died without unlinking, so enumeration
dials every candidate and keeps only the ones that answer. **`{q}` is spliced
JSON-escaped**, because page text routinely carries a quote, a backslash or a newline
and a raw splice would produce a template that parses on some pages and not others.
And a cross-app step is **refused inside a self-reverting chain** — `suite_call` is
classed `irreversible` in the host's reversibility table, because zwire's journal holds
zwire's own writes and cannot compensate one that happened inside another process. A
chain that needs all-or-nothing across apps asks the suite's saga coordinator for it
*through* this client rather than having zwire invent a second one.

Chrome cannot do any of this. An extension's only route out of the browser is **native
messaging**, and that requires a host that was installed ahead of time with its own
manifest file whose `allowed_origins` names the calling extension's id — the docs are
explicit that those values ["can't contain wildcards"](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging).
Nothing in that API discovers what is running, asks a program what it can do, calls a
named operation with typed arguments, or returns a value from one. Every app zwire
reaches here is found at runtime, introspected for its verb list, and called by name.

**The page as typed state, and the postcondition it enables (`zpage-core.js` +
`zwire-host/src/page.rs`).** The two sections above both move COMMANDS. This moves DATA
the other way: any app on the bus can read what the browser is rendering *right now*.

```jsonc
{"t":"get","id":1,"state":"page.tables"}    // the tables on the active tab, typed
{"t":"call","id":2,"verb":"page.extract","args":{"selector":"h2 a","attr":"href"}}
{"t":"call","id":3,"verb":"page.assert","args":{"state":"page.text","op":"contains","value":"Order confirmed"}}
```

Nine projections plus `page.extract`, each computed in the tab by a pure engine
(`zpage-core.js`) that the service worker injects on demand. `args` accepts a `tabId` or
a `urls` regex, so an app can read a **background** tab — and a filter that matches
nothing answers nothing rather than quietly reporting on a different page.

Two limits are structural, not settings. **No page writes**: mutation stays on the
journaled `browser.*` verbs, so nothing can change the browser behind `txn_abort`'s
back. **No field values**: `page.forms` publishes action, method, field names and types,
never what is typed into them, because autofilled credentials are on the page too. That
read-only-ness is why every `page.*` verb is `pure` in the reversibility table — and
*that* is what lets a postcondition run inside the transaction it is deciding about.

The **assert** step (⌘K commands, trigger chains, and the step wizard) is where it pays
off: `{"state":"page.text","op":"contains","value":"Order confirmed"}`. The host projects
the live DOM, evaluates the predicate, and answers `ok:false` when it does not hold —
which the chain executor already treats as a failed step, which aborts the transaction,
which replays the journaled inverses. A chain therefore commits on **what the browser
rendered**, not on whether its calls returned. A malformed assertion (an unknown op, a
projection that does not exist) is refused before the page is ever read and carries no
verdict, so a chain can never revert because of a typo in its own editor.

The **premise** step is its mirror, and closes the window an assertion cannot see. An
assert asks *did the browser end up where we said it would*; a premise asks *was the
page we decided on still the page we acted on*:

```jsonc
{"t":"begin","id":1,"txn":9001}
{"t":"call","id":2,"verb":"page.witness","args":{"state":"page.tables"},"txn":9001}
{"t":"call","id":3,"verb":"browser.newTab","args":{},"txn":9001}
{"t":"commit","id":4,"txn":9001}
// ← {"ok":false,"conflict":true,"aborted":true,"steps":1,
//    "violations":[{"state":"page.tables","reason":"changed"}]}
```

`page.witness` ledgers the projection against the open transaction; `txn_commit`
re-reads every premise in ONE `page.batch` and refuses the commit if any of them moved,
unwinding through the same journal a failed step uses. Premises are **declared, not
inferred** — a chain's own steps navigate, so an implicitly captured read set would
conflict with itself on nearly every real chain. In the step wizard a premise is a step
type like any other (`{"state":"page.links","op":"count_at_least","value":"1"}`), and a
chain that is not self-reverting is refused it at save time rather than at 3am from a
trigger, because a premise with no transaction to gate would silently protect nothing.

Mechanically it is a rendezvous, because the DOM is a process away and the host→browser
direction had always been fire-and-forget. The browser-attached host process binds a
second endpoint (`zgui/zwire-page.sock`); every other host process forwards there with
the bus client; the query is published with a correlation id and the worker answers it
by id. Nobody polls, a closed browser fails the dial immediately instead of waiting out
a timeout, and a page read always answers on its own thread — in the attached process
the query and its answer share one connection, so answering inline would block the only
reader that could deliver the answer.

**Around it:** a **⌘K command palette** (`zpalette`) — which also carries the
scheme picker, the light/dark toggle, the settings controls, a **window/tab
exposé** (`zexpose` — a tile grid with one tile per tab showing a live text
excerpt of the page's content; click to focus that tab, Esc to close; ports
zterm's ztmux pane exposé via `ZGui.expose`), **Page Actions** (`zpageactions` —
Vivaldi-style live CSS-filter transforms on the current page: grayscale, sepia,
invert, high-contrast, blur, hue-rotate…, remembered per site), a **Reader view**
(`zreader` — distraction-free article extraction), **Periodic reload**, **Break
mode** (`zbreak` — pause every tab behind a break screen), **full-page capture**
(scroll + `captureVisibleTab` slices stitched on an `OffscreenCanvas` → PNG, plus
a visible-area capture), **mouse gestures** (`zgestures` — right-drag navigation:
back / forward / new / close / reload), **Web Panels** (`zpanels` — pinned
websites in a docked side panel; the `frame_bust` rule lets any site load),
**pop-out video** (Picture-in-Picture), **quick note from selection** (save the
current selection into Notes), a **Trash** dropdown (`ztrash` — restore recently
closed tabs), **tab hibernation** (discard this / other tabs) + **tab stacks**
(group tabs by domain), a **cookie-banner blocker** (`zcookies` — hides consent /
GDPR popups + unlocks scroll), **spatial navigation** (`zspatial` — Shift+Arrow
jumps focus to the nearest link/field), **Read Aloud** (`zspeak` — text-to-speech
of the selection/article), **Link Peek** (`zpeek` — Alt+click a link → floating
preview), **Element Zapper** (`zzap` — click to hide page clutter, persists per
site), **auto-hibernate** (sleeping tabs after 30 min idle — never a tab holding
a live camera, microphone, screen share or WebRTC session), and an **inline
compute layer** (ported from zgo-core): type a sum (`2^10`, `sqrt(2)+1`), a unit
conversion (`10 km to miles`, `72 f in c`, `1 gb to mb`), a live currency
conversion (`100 usd to eur`, rates fetched + cached by the host), a percentage
(`20% of 150`, `150 + 20%`, `10 to 12`), or an `@`-prefixed stryke expression
(`@ 1:10 |> sum`) and the answer pins to the top row, copyable with ⏎ — a
**tab-query language** (`tabs:` — a boolean query over every open tab: bare words
match title+url, field predicates (`host:`/`title:`/`url:`/`older:`/`newer:`) and
flags (`dup`/`audible`/`discarded`/`pinned`/`muted`/`active`/`loading`) refine,
`AND`/`OR`/`NOT` compose, then one row bulk-**closes**, **reloads**, or focuses the
matches — a capability no other browser's command bar has) — a **brace-expansion
batch launcher** (`makeBraceProvider` — a zsh-faithful port of shell brace
expansion applied to the address layer: type ONE URL pattern carrying `{a,b}`
alternations and/or `{1..10}`/`{a..e}` sequences — zero-padded (`{01..12}`),
stepped (`{0..20..5}`), descending, nested, and cartesian (`{a,b}{1,2}`) — and it
expands to N destinations and opens the whole batch from a single ⏎;
`gh.com/{issues,pulls,wiki}` opens three tabs at once. It fires only when the
pattern has no whitespace and every expansion is a real URL, so it never hijacks
prose or a plain word list — no browser's address bar or command palette expands a
brace/sequence pattern into a batch tab-open) — a **URL-surgery mini-language**
(`makeUrlSurgeryProvider` — a `url:`/`u:` prefix turns the palette into a rewrite
engine over the CURRENT tab's URL: a compact, space-separated op list transforms the
live href and one ⏎ re-navigates to the result. `s/blob/edit/` sed-style regex
substitution over the whole URL (any single char after `s` is the delimiter, so
`s|old|new|` skips escaping slashes; `$1` backrefs and `g`/`i` flags work); `+k=v`
sets/overrides a query param, `-k` removes one, `-?`/`-*` strip ALL of them (drop
trackers), `#frag`/`-#` set/clear the fragment, `^`/`^^^`/`^3` climb N path segments
toward root, and `@host` swaps the hostname — composed left→right, e.g.
`url: @github.dev ^ -utm` swaps host, climbs one segment, and drops a param in one
⏎. Distinct from brace-expansion (which GENERATES many URLs) and the tab query
(which FILTERS open tabs): this REWRITES one live URL. Firefox/Brave/Eraser-style
strippers auto-remove a FIXED tracker list; no browser's command bar exposes an
interactive URL-rewrite language over the current page — this is the first) —
**vim-style
motions** (`zkeys`/`zvim` — jump / scroll / tabs / launch categories), a **find
bar** (`zfind`), a **powerline status bar** (`ZGui.powerline`, fed by
`zpowerline.js` from the native host's `zb_sys` system stats + the tmux
window/pane segment), and **HUD reimplementations**
of `chrome://{extensions,settings,history,bookmarks,downloads,version}` — the
**History** page defaults to a full-height, all-time list (Cmd+Y) and adds a
Vivaldi-style calendar dashboard (Month/Week/Day: a month calendar with per-day
activity, a per-day Entries list, and an analytics rail — a Browsing Activity area
chart, a Link Transition donut, and Top Domains) with per-entry delete and a
range/all clear, while **Settings** carries Chrome's section layout over
`settingsPrivate` and hosts the **clear browsing data wizard** (time range →
data types → origin scope → per-type result) — reachable from
`chrome://settings/clearBrowserData` and from Chrome's own ⌘⇧⌫ / Ctrl+Shift+Del,
which the HUD pages bind themselves (a HUD page focuses its filter box on load,
and a focused field swallows the key before the browser command can run) — plus a **Feeds** RSS/Atom
reader, a **Reading List**, a **Notes** manager
(Markdown notes in folders, ported from Vivaldi), a **Translate** panel
(30+ languages, auto-detect, ported from Vivaldi),
Keyboard, Commands, Sessions, a **Hooks** page, CI, a **Host** console, a
**Terminal**, and an **App Store**, plus a live **Audio** page. Files, Timeline, Notes, Translate, Feeds,
Reading List and Terminal open from the **Dashboard** tile grid rather than the
page nav bar, which is kept short enough to scan. ``Ctrl+` `` — and the ⌘K
*Toggle terminal* row — opens the same floating, draggable, dock-to-corner
terminal pane on any HUD page and on the new-tab page, not only on web pages:
those are extension pages, where content scripts never run, so each loads the
terminal itself on first use. Every shortcut, and the tmux prefix itself, is
remappable on the Keyboard page.

**New Tab layouts (`newtab/` + `pages/newtab.html`).** The new tab is a *layout*,
not a fixed page. A layout owns a nav rail of **Speed Dial groups**, a
**background**, the **Speed Dial appearance** block, and a **widget grid** per
group; you keep as many named layouts as you like and switch with one ⌘K command.

Ported from Vivaldi's Start Page, setting for setting:

| Vivaldi | zwire |
|---|---|
| Start Page navigation (show on internal pages / start pages / hide) | nav rail with the same three modes, positionable on any edge |
| Speed Dial groups (bookmark folders) | groups, each with its own dials **and** its own widget grid |
| Maximum Columns (n / single / No limit) | `0` = no limit, else 1–12 — treated as a maximum, with rows balanced so a wrap can't strand a single tile (seven dials under a six-column cap lay out 4+3, not 6+1) |
| 5 thumbnail sizes | 5 sizes (96 → 248 px) |
| Speed Dial titles: always / when needed / never | same three modes (when-needed hides behind a custom thumbnail) |
| Show the Add button · reorder by drag and drop | same two toggles |
| Select Custom Thumbnail | per-dial upload, downscaled before it is stored |
| Widgets: Date, Bookmarks, Feeds, Notes, Top Sites, Webpage | same, plus History, Reading List and tmux Sessions |
| add-once widgets vs. repeatable ones | enforced by the model, not the UI |
| Widget Size → Regular / Tall | same, on the list widgets only |
| Background: color / image | color, CSS gradient, or an uploaded image |

Editing is inline the way Vivaldi does it — a **Widgets** picker, a **Customize**
dialog that applies live, and an edit mode with drag-to-reorder for widgets and
dials. What Vivaldi has no equivalent for is the **library**: `pages/newtab.html`
lists every layout with an SVG preview of its real widget placement (computed by
the same routine the page's CSS grid follows, so the preview cannot lie), and adds
duplicate, per-layout export, and JSON import.

The layouts live in the New Tab extension's own storage (`zb_ntp`), so open new
tabs repaint the moment one changes; the HUD manager reaches them over the
external-message bridge, and every write it makes is re-normalized by the same
engine the page renders with. Widgets whose data belongs to the HUD extension
(feeds, notes, reading list, sessions) are served over that bridge too, parsed by
the HUD pages' own parsers rather than a second copy. Pre-layout installs are
migrated once from the old `zb.tiles` list, by copy — the legacy key is left
untouched.

**Host console (`pages/host.html`).** A HUD tab that talks to the `zwire-host`
native-messaging host directly — inspect and drive the native bridge from inside
the browser.

**App Store (`pages/store.html`).** A HUD storefront tab for the
**MenkeTechnologies app store** — the paid Rust desktop apps and audio plugins,
each a `ZGui.productCard` (cover-filled with the app's screenshot — webp vendored
under `pages/store-assets/` so the tab renders offline, glyph fallback) linking to
its live product page to buy. zwire is free
and open source; this is its shop window. On **first run** (`onInstalled`),
`background.js` opens this page once with a welcome modal, so the store is shown
up front — the new-tab page stays untouched.

**Audio (`pages/audio.html`).** A live audio dashboard over a browser-wide DSP
engine the fork compiles into the audio service (patches 0022–0024): an always-on
**zdsp-core** chain applied to **every** output stream (media element, MSE/YouTube,
Web Audio, WebRTC) before the OS device, live-reconfigurable with nothing open and
no relaunch. The chain, in order:

- **EQ** — preamp + RBJ-biquad cascade; band types `lowshelf` · `peaking` ·
  `highshelf` · `lowpass` · `highpass` · `bandpass` · `notch` · `allpass`.
- **Channel strip** — gain · drive (tanh soft-clip) · equal-power pan · mono-fold.
- **Saturation / dynamics** — waveshaper (arctan/foldback/hard-clip) · harmonic
  exciter · bit-crusher + decimator · noise gate · stereo-linked feed-forward
  compressor · auto-wah (envelope-swept resonant band-pass).
- **Modulation** — chorus · flanger (with feedback) · phaser (LFO-swept all-pass
  cascade) · ring modulator · tremolo (LFO amplitude), each with rate/depth.
- **Time** — stereo feedback delay/echo · reduced-Freeverb reverb.
- **Spatial** — Haas widener · headphone cross-feed · auto-pan (LFO stereo) ·
  M/S stereo width.
- **Limiter** — brickwall peak limiter, dead-last so nothing re-clips.

Every block is unity/bypass by default and per-stream (own buffers), so the engine
stays bit-identical passthrough until a control is engaged. The page renders the
**real post-DSP output** — Goertzel spectrum bars, peak/RMS meters, phase
correlation, and a stereo scope — pumped back over the native host (no
`tabCapture`, so watching the meters never touches the audio). DSP correctness is
pinned by `fork/tests/run_dsp_tests.sh`, which extracts the engine straight from
patch 0022 and asserts per-effect invariants.

**`zgui-core` — the shared GUI toolkit (`lib/zgui-core`, submodule).** The HUD is
not hand-rolled per page; it is assembled from **`ZGui`**, a cyberpunk web-component
library (260 modules under `webui/`) shared across the MenkeTechnologies app
suite and loaded **directly from the submodule path** — the HUD extension never
copies a `ZGui` module, because copies go stale. The New Tab extension is the one
exception, and not by choice: Chrome loads each unpacked extension from its own
directory and an extension cannot read a sibling's files, so `newtab/lib/` holds
the handful of modules that page needs (`command-palette`, `fzf`, `util`, the
`modal`/`toast`/`drag` set the layout editor runs on, and the tmux overlay set).
They are copies of the submodule's files at the same revision and are re-copied
when the submodule moves. The same constraint applies to zwire's own shared
sources — `schemes.js`, `palette-cmds.js`, `cmd-defaults.js` and `zntp-core.js`
exist as byte-identical copies in `newtab/` and `extensions/hud-internal/`; edit
the `hud-internal` copy and re-copy, and `scripts/test.sh` fails the run if the
two ever drift. The tiling WM (`ZGui.tmux`), the ⌘K
palette (`ZGui.palette`), fuzzy find
(`ZGui.fzf`), the scheme engine (`ZGui.colorscheme`), the powerline
(`ZGui.powerline`), the store's product cards (`ZGui.productCard`), and the whole
Audio meter chain (`ZGui.spectrumAnalyzer`, `goniometer`, `correlationMeter`,
`peakMeter`, `lufsMeter`, `eq`, `dbFader`) are all `ZGui` components; the
`extensions/hud-internal` code is the zwire-specific glue that wires them to
Chrome APIs and the native host.

**`zwire-host` — the native agent (`native/zwire-host`, submodule).** A single
self-contained Rust binary that the HUD talks to over Chrome native messaging. It
exposes the local machine — sysmon (the `zb_sys` stats the powerline renders),
filesystem, `exec`, PTY, a key-value store, hooks/jobs/watch, and OS ops — and
also runs as a Unix-socket NDJSON daemon. It backs the **Host** console page,
feeds the status bar, and is the filesystem bridge for the audio engine (the page
writes the EQ spec and reads the meter frames over its persistent port; the
sandboxed audio service can't touch those files itself — see patches 0022–0024).

**`zpwrchrome-host` — the second native agent (`extensions/zpwrchrome/zpwrchrome-host`,
submodule).** The BP-protocol host behind zpwrchrome's segmented downloader (`dl.*`),
otp, search and `run.spawn`. The installer builds it, copies it into the bundle next
to `zwire-host`, and the launcher registers `com.menketechnologies.zpwrchrome.json`
into zwire's profile pointing at the bundled binary — rewritten on every launch, so a
separately installed (e.g. package-managed) manifest can never leave zwire's downloads
without a host and silently hand them back to the browser's built-in downloader.

## `[0x02] ARCHITECTURE`

| Layer | What it is |
|---|---|
| **Base** | The compiled `fork/` build — a patched Chromium (pinned tag `150.0.7871.46`), unbranded release |
| **HUD workspace** | `extensions/hud-internal` — the tiling overlay (`ztmux-config`/`ztmux-pane` driving `ZGui.tmux`), ⌘K palette (`zpalette`), vim nav + keymap (`zkeys`/`zvim`), find (`zfind`), status bar (`zpowerline` → `ZGui.powerline`), the 8-scheme picker (with light/dark toggle), and 26 HUD pages (incl. the Files browser, the History Timeline, the Sessions manager, the Pipelines editor, Keyboard remapper, Host console, App Store + a live Audio page). MV3 content scripts on `chrome://*/*` + `http(s)`; bridges to a native host. Needs `--extensions-on-chrome-urls` |
| **GUI toolkit** | `extensions/hud-internal/lib/zgui-core` — the shared `ZGui` component library (260 `webui/*` modules), a submodule loaded straight from path. Every HUD page composes `ZGui` components; zwire supplies only the glue. The New Tab extension cannot read another extension's directory, so `newtab/lib/` carries same-revision copies of the few modules it loads |
| **Native host** | `extensions/hud-internal/native/zwire-host` — a single Rust binary (native-messaging host + Unix-socket daemon: sysmon, fs, exec, PTY, KV, hooks, OS ops), a submodule. Backs the Host console + powerline stats + the audio EQ/meters file bridge |
| **New tab** | `newtab/` — a `chrome_url_overrides.newtab` extension (in-repo, not a submodule): the full HUD new-tab (Orbitron, CRT scanlines, neon omnibox), fonts vendored locally, plus the custom **layout** engine (`zntp-core.js`), its widgets (`widgets.js`) and its inline editor (`layout-edit.js`) |
| **Power-tool** | `extensions/zpwrchrome` — the MV3 power-tool, loaded as a submodule (reuse, not copy) |
| **Theme** | `theme/` — a colors-only Chrome theme. Present but **not** launcher-loaded — the fork's native color mixer (patch 0002) and the HUD skin own the palette, and a static theme applies last and would override them |
| **Launcher** | `bin/zwire` — starts the base against `$ZWIRE_STATE/profile` with `newtab` + `zpwrchrome` + `hud-internal` loaded and `--extensions-on-chrome-urls` set (any dir missing a `manifest.json` is skipped, so a missing submodule degrades gracefully) |
| **Fork** | `fork/` — the 28-patch source build that restyles the native chrome (tab shapes, fonts, borders, omnibox, DevTools schemes, native menus/dialogs) and tunes native behavior (forced zwire new-tab, session restore, framing, browser-wide audio EQ + meters) the extension layer can't reach; this is what zwire ships as |

A Chrome theme extension changes **colors only** — it cannot reshape tabs, fonts,
or toolbar (those are native C++), and it cannot add a tiling overlay or a
command palette. The HUD extension layer adds the workspace; the `fork/` build
adds the native styling — together they are zwire.

### Command palette (⌘K)

The **same** palette renders on **four** surfaces — they can't be one instance
(different extensions / execution contexts), so they share one item source
instead. This is the part that reads as "how many palettes are there?", so it is
spelled out here.

| # | Surface | Where | File | Context |
|---|---|---|---|---|
| 1 | Web-page palette | any `http(s)`/`file`/`chrome://` tab | `hud-internal/zpalette.js` | content script |
| 2 | HUD-page palette | HUD pages (Settings, Sessions, Host, …) | `hud-internal/pages/zg-boot.js` | extension page |
| 3 | New Tab palette | the new-tab page | `newtab/palette.js` | extension page |
| 4 | zpwrchrome palette | zpwrchrome dashboard pages | `zpwrchrome/lib/zpc-palette.js` | extension page |

Surfaces **1 and 2 are both hud-internal** (a web page gets the content-script
palette; a HUD page gets the zg-boot palette) — that is why it looks like three
but is four.

- **Single source of truth:** `palette-cmds.js` (`ZWIRE_PALETTE_CMDS`) owns the
  item set + ranking (search, custom commands, inline compute, the `tabs:`
  boolean tab-query provider, the brace-expansion batch launcher, the `url:`
  URL-surgery rewrite engine, and the zpwrchrome page list via `makeZpwrItems`).
  Backend-agnostic; **vendored verbatim** into `hud-internal/` (canonical — edit
  this) and `newtab/`. Each surface must actually load it or its zpwrchrome rows
  silently vanish (HUD pages load it via `<script src="../palette-cmds.js">`).
  `zpwrchrome/lib/palette-cmds.js` is a **separate, older copy** in its own
  submodule — it stops before the tab-query engine and does not track this file.
  Treat surface 4 as its own vocabulary until that copy is re-vendored.
- **The id contract:** every row the web-page palette publishes carries a stable
  slug `id` — `zw.newTab`, `zw.page.settings`, `zw.chrome.gpu`, `zw.tab.<tabId>`,
  `zw.ext.<extId>`, `zw.cmd.<commandId>`. The slug comes from the row's identity
  (the action verb it runs, its page file, its chrome:// URL, an extension or tab
  id) and **never** from its label: a label is the translatable half of a row, so
  an id keyed on one renames itself per locale and breaks every saved chain, hook
  and trigger that referenced it. Built-in rows use `zw.<action>` for the action
  they run, so the palette and the chain/trigger vocabularies cannot disagree
  about what a command is called, and the `palette-command` hook fires with that
  `id` alongside the display `command`. Rows are deduped by id on publish (first
  wins), so one command cannot render twice. A row published with no id, or with
  whitespace in its id, is recorded in `window.ZGui.diagnostics`, raised on a
  `zgui:diagnostic` document event and forwarded to the native host as a
  `zdiagnostic` hook — never printed. `tests/palette-ids.mjs` pins all of this
  over the real shipped vocabulary.
- **⌘K ownership:** hud-internal owns ⌘K browser-wide as a `chrome.commands`
  shortcut (a page keydown can't intercept it) and its service worker routes to
  the palette matching the active tab (web page → 1, HUD page → 2, new tab → 3,
  zpwrchrome page → 4 via cross-extension message).
- **Gotchas:** content scripts (surface 1) can't cross-extension message, so the
  zpwrchrome rows are registered unconditionally there rather than gated on a
  liveness ping. MV3 service-worker code changes are the one thing a reinstall
  cannot deliver on its own: Chromium keys the worker's script cache on the
  worker's **script URL**, and a manifest version bump does not evict it —
  measured on 150.0.7871.46, the browser served the new `background.js` over
  `chrome-extension://` while still running the previous build's worker, across
  a full restart. Symptom: every message kind the new pages send but the cached
  worker never learned fails with *"The message port closed before a response
  was received."* `localinstall.sh` therefore points each staged manifest at a
  content-keyed shim worker (`background.sw-<hash>.js`, one line importing the
  real `background.js`), so changed worker code always registers as a new
  worker. Content-script / extension-page / HTML changes only need a page reload.
  The rename has a second half that is just as load-bearing: the staged tree is
  rsynced with `--delete`, so the *previous* shim file is gone, and a profile
  that still holds a registration for it holds a **dangling** one — that worker
  can never start, silently, across restarts. Two defences, both in
  `localinstall.sh`: every extension (hud-internal included — it was the one
  left out, and the one that broke) gets a content-derived 4th manifest-version
  component so Chromium sees a version change and re-registers; and the
  launcher's Service-Worker-cache eviction is keyed on each staged manifest's
  version **and** its declared `service_worker` filename, so any shim rename
  clears the old registration on the next launch. Failure signature when this
  goes wrong: hud-internal's worker never starts, so browser-level ⌘K stays
  bound in the profile but has no listener — the palette stops opening on web
  pages and from the omnibox, while HUD pages (page-level ⌘K) still work.

### Real tmux from ⌘K

zwire has two things called tmux and they are not the same thing. The **tiling
overlay** above is a window manager for *web panes* that borrows tmux's model and
its prefix key. This is the other one: the **actual multiplexer running in the
terminal**, driven from the same palette.

The rows go out over `zb-host` to `zwire-host`'s `tmux_*` commands, which speak
tmux's client/server wire protocol (imsg framing, protocol version 8) straight to
the server socket via [`ztmux-core`](https://crates.io/crates/ztmux-core) — not
control mode, and no `tmux` subprocess per action. A running
[`ztmux`](https://github.com/MenkeTechnologies/ztmux) server is preferred over
upstream `tmux` when both are up.

| Row | What it does |
|---|---|
| `tmux` (typed) | lists every live pane — `session:window.pane — cmd` — plus the saved sessions; ⏎ focuses one |
| `tmux <text>` (typed) | turns every pane into a send target for that text; the pane you are looking at leads the list |
| `Tmux: run a command in the active pane` | prompts, then types it and presses ⏎ |
| `Tmux: send this page URL to the active pane` | types the URL and stops — pressing Enter stays yours, so you can wrap it in `curl` first |
| `Tmux: copy the active pane` | that pane's visible text → the browser clipboard |
| `Tmux: selection → tmux buffer` / `newest tmux buffer → clipboard` | the two directions of the browser↔terminal text seam, through tmux's paste buffers |
| `Tmux: toggle synchronize-panes` | broadcast typing across the active window, read off its current state |
| `Tmux: save / restore the session` | native session snapshots (layout, cwd, command lines, pane contents) kept in zwire's own state dir |
| `Tmux: new window · split · zoom · next/prev window` | the one-key window verbs |

Two shapes for two costs. The **action rows are always published**, server or no
server: their ids (`zw.tmux.*`) are what a chain, a trigger or a hook names, and a
row that comes and goes with the server is a row none of them can depend on — so
they report "no tmux server" instead of vanishing. The **pane rows are
query-only**: sixteen panes is a normal day, and a palette that opens with sixteen
unasked rows in it is a worse palette.

Every write re-reads the session tree first. The palette caches panes when it
opens, but between opening ⌘K and pressing ⏎ you can switch panes — and a command
typed into the pane you just left is the one failure this surface must not have.
Pane row ids come from the tmux pane id, so renaming a session, a window or the
running program never moves them. `tests/tmux.mjs` pins all of it.

## `[0x03] INSTALL`

```sh
git clone --recurse-submodules https://github.com/MenkeTechnologies/zwire.git
cd zwire
scripts/install.sh          # fetch base + link `zwire` on PATH + rebrand (macOS)
zwire                    # launch
```

`install.sh` downloads the Chromium base into `$ZWIRE_STATE/base`, builds the Monaco
code-editor bundle the Hooks / Commands / Triggers pages load, symlinks `bin/zwire`
into `~/.local/bin`, and on macOS rebrands the base bundle's Dock name and icon in
place. Re-run after a base upgrade.

That path runs zwire **out of the checkout**. For a **self-contained** install that
survives deleting the repo, run `scripts/localinstall.sh` (`pnpm localinstall`)
instead — it bundles the browser, all three extensions, and the native binaries
(`zwire-host`, `zpwrchrome-host`, `stryke`) into one artifact per platform, and
needs the Rust toolchain (`cargo`) at build time:

| Platform | Script | Installs to |
|---|---|---|
| macOS | `scripts/localinstall.sh` | `/Applications/zwire.app` (self-contained `.app`) |
| Linux | `scripts/localinstall-linux.sh` (auto-dispatched by `localinstall.sh`) | `~/.local/opt/zwire` + a `zwire` launcher on PATH + a `.desktop` entry |
| Windows | `scripts/localinstall-windows.ps1` | `%LOCALAPPDATA%\zwire` + a `zwire.cmd` launcher + Start Menu shortcut; the native host is registered under `HKCU` (Windows doesn't read host manifests from the profile dir) |

Only the per-user profile lives outside the install, so the install dir stays
disposable.

The editor bundle (`extensions/hud-internal/lib/hooks-editor/`) is a build artifact, not
checked in: `scripts/build-hooks-editor.sh` esbuilds it from
`extensions/hud-internal/vendor/zpwr-hooks-editor/src` and needs node ≥ 20 + pnpm (which
pulls the `monaco-editor` / `monaco-vim` / `monaco-emacs` devDeps). `install.sh`, all three
`localinstall` scripts, and the extension's own `scripts/build.sh` all run it and hard-fail
if any artifact is missing — without it those three pages render their surrounding chrome
and simply no editor.

`--recurse-submodules` pulls the shared repositories zwire depends on:
`extensions/zpwrchrome` (the MV3 power-tool), `extensions/hud-internal/lib/zgui-core`
(the shared `ZGui` toolkit the HUD pages are built from),
`extensions/hud-internal/lib/file-browser` (`zpwr-file-browser` — the fleet's file
manager, which the Files page mounts unmodified),
`extensions/hud-internal/lib/clip-engine` (`zpwr-clip-engine` — the arrangement grid
the History Timeline renders on, to which zwire contributes only a domain), and
`extensions/hud-internal/native/zwire-host` (the Rust native host). The launcher
skips any extension dir missing a `manifest.json`, so a not-yet-fetched submodule
degrades gracefully rather than failing the launch.

## `[0x04] USAGE`

```sh
zwire                         # open with the HUD new tab
zwire https://github.com      # open a url
zwire --incognito             # any Chromium flag is passed through
```

Once running, press the tmux prefix (default `Ctrl-b` or `⌥B`) to arm the tiling
overlay, then a pane/window action; `⌘K` opens the command palette. Rebind the
prefix and every shortcut on the Keyboard HUD page.

State lives under `$ZWIRE_STATE`, which defaults to the OS application-data
directory — macOS `~/Library/Application Support/com.menketechnologies.zwire`
(the bundle id), Linux `${XDG_CONFIG_HOME:-~/.config}/zwire`, Windows
`%APPDATA%\zwire`. A one-time launch auto-migrates a legacy `~/.zwire` (and, on
macOS, an earlier bare `~/Library/Application Support/zwire`) into the new
location:

| Path | Purpose |
|---|---|
| `base/` | the Chromium binary |
| `base.path` / `base.version` | resolved binary + pinned revision |
| `profile/` | the dedicated user-data-dir (bookmarks, history, sessions) |
| `ext/` | per-user copy of the loaded extensions, staged from the `.app` bundle at launch (each user needs a writable copy — Chromium writes extension `_metadata/` indexes there) |

Override the base with `ZWIRE_BASE=/path/to/chromium zwire`.

## `[0x05] FULL-HUD FORK`

The extension layer can't restyle the native chrome (tab shapes, fonts, toolbar
are C++), so zwire ships as the fork: `fork/` compiles a patched Chromium
(~100 GB checkout, 1–4 hr first build, ongoing rebase maintenance):

```sh
fork/fetch.sh                                   # depot_tools + pinned Chromium
fork/apply-patches.sh  ~/zwire-chromium/src  # HUD patch series
fork/build.sh          ~/zwire-chromium/src  # the long compile
fork/package.sh        ~/zwire-chromium/src/out/zwire
```

All **27** HUD patches are **authored** against the pinned tag (`150.0.7871.46`)
and verified apply-clean. The nine styling/behavior patches: hard trapezoid tabs
(`tab_style_views.cc`), the cyberpunk palette + the 8 HUD schemes on
frame/toolbar/tabs/omnibox (`chrome_color_mixer.cc`), the Share Tech Mono /
Monaco UI font (`resource_bundle.cc`), a neon cyan under-toolbar line
(`toolbar_view.cc`), a sharp omnibox field (`location_bar_view.cc`), `zwire`
product strings (`BRANDING`), the 8 HUD schemes in the DevTools Theme dropdown
(`design_system_tokens.css` + `main-meta.ts` + `ThemeSupport.ts`), allow-framing
any site so the `ztmux` overlay can iframe pages (`ancestor_throttle.cc`), and
extension-command focus hand-off so the ⌘K palette is typeable from the omnibox
(`extension_keybinding_registry_views.cc`). Six patches force zwire's behavior
over Chromium's defaults: `chrome://newtab` always resolves to the zwire new-tab
(`search.cc`), pinned extension actions never drop to the overflow puzzle
(`toolbar_view.cc`), a host page's `frame-src`/`child-src` CSP never blocks a
sub-frame nav so panes can embed any site (`navigation_request.cc`), startup
restores the last session (`session_startup_pref.cc`), no "Restore pages?" crash
bubble (`session_crashed_bubble_view.cc`), and no navigation block for a
not-yet-registered extension so the new-tab override always loads
(`extension_navigation_throttle.cc`). Two more bind the *native* Views surface to
the HUD palette so app/context menus, dialogs, dropdowns, and textfields track
the scheme + light/dark toggle instead of the OS default
(`chrome_color_mixer.cc`, the menu family then every core primitive). Three keep
the HUD's own extension pages and the Chrome Web Store working: allowlist
`hud-internal` for `developerPrivate` + `settingsPrivate` so the Extensions /
Settings pages have their APIs (`_permission_features.json`), a crash fix so a
content script can call `chrome.*` mid-navigation on the store without tripping a
`NOTREACHED` (`extension_function_dispatcher.cc`), and dropping the gallery
script-block so content scripts + `executeScript` run on the Web Store domains
(`chrome_extensions_client.cc`). One forces immediate ⌘Q (no hold-to-quit)
(`app_controller_mac.mm`). The last three are the **audio engine**: an always-on
zdsp-core chain (EQ + channel strip + saturation/dynamics + modulation + time FX +
spatial + limiter) compiled into the audio service so
*every* stream is processed before the OS device (`output_controller.cc` +
`chrome_content_browser_client.cc`), tab-capture with no picker so the Audio page
can analyze a playing tab (`tab_capture_api.cc`), and live EQ reconfiguration +
an output-meters back-channel to the Audio page
(`audio_service.mojom` + `service.cc` + `audio_service.cc`). One retargets a
native toast: the **Open** button on "Page added to reading list" opens the HUD
reading-list page (`pages/readinglist.html`, as a singleton tab) instead of
Chromium's read-later side panel — the toast is registered in C++
(`toast_service.cc`), so no extension API can redirect it. Apply-clean proves
the diff context matches; `fork/build.sh` is the compile gate. See
[`fork/README.md`](fork/README.md) and [`fork/patches/README.md`](fork/patches/README.md).

**Building it:** the fork is a normal Chromium checkout + `autoninja`, so any box
that can build Chromium can build zwire — no paid infra required. It does **not**
fit on stock GitHub-hosted runners (the ~100 GB checkout exceeds their disk and a
cold build races the 6 h job cap); build it locally, or point a self-hosted
runner at a warm checkout so only the delta rebuilds.

## `[0x06] UPDATING THE BASE`

```sh
scripts/fetch-base.sh              # latest Chromium snapshot
scripts/fetch-base.sh 1656770      # pin an exact revision
scripts/rebrand-macos.sh           # re-apply the rebrand after the swap
```

## `[0x07] NOTES`

- **Native messaging:** `zpwrchrome`'s `pass` and segmented-download features
  need its native host installed — see the
  [zpwrchrome](https://github.com/MenkeTechnologies/zpwrchrome) setup.
- **Developer-mode banner:** unpacked extensions loaded via `--load-extension`
  show Chromium's developer-extensions notice. It is cosmetic; the extensions
  run fully.
- **Cross-platform:** the `bin/zwire` launcher works on macOS (aarch64/x64) and
  Linux (x86_64); Windows is installed with `scripts/localinstall-windows.ps1`,
  which drops its own `zwire.cmd` launcher. The in-place Dock rebrand is
  macOS-only; on Linux and Windows the launcher name is the brand.

## `[0x08] LICENSE`

MIT — see [LICENSE](LICENSE).
