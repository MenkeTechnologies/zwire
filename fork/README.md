# zbrowser fork — the full-HUD Chromium build

The runtime rebrand (top-level `bin/zbrowser` + a Chromium snapshot base) gives
you HUD **colors** + a HUD **new-tab** + your extensions, with zero build. It
cannot reshape the browser chrome — tab shape, UI fonts, toolbar borders are
native C++, not themeable.

This `fork/` directory is the **source-build path** that restyles the chrome
itself: sharp cyberpunk tabs, Orbitron/Share Tech Mono UI type, neon toolbar,
HUD-colored frame. It compiles a patched Chromium and installs it as the
zbrowser base, which the same `bin/zbrowser` launcher then runs with the
extensions preloaded.

## Cost (be sure you want this)

- **First build:** ~100 GB checkout + **1–4 hours** compile. Incremental
  rebuilds after a patch: minutes.
- **Disk:** ~150 GB (src + one out dir).
- **Maintenance:** rebase `fork/patches/` onto each Chromium release you track,
  plus security-patch cadence. This is the solo-fork commitment.

## Pipeline

```sh
fork/fetch.sh                 # depot_tools + fetch pinned Chromium (long)
fork/apply-patches.sh  ~/zbrowser-chromium/src
fork/build.sh          ~/zbrowser-chromium/src      # the long compile
fork/package.sh        ~/zbrowser-chromium/src/out/zbrowser
zbrowser                                            # runs the HUD-chromed fork
```

| File | Role |
|---|---|
| `CHROMIUM_VERSION` | pinned release tag the patch series targets |
| `args.gn` | GN build config — unbranded (`is_chrome_branded=false`), release |
| `fetch.sh` | install depot_tools, fetch + checkout the pinned tag, sync deps |
| `apply-patches.sh` | apply / reverse the HUD patch series over `src/` |
| `build.sh` | `gn gen` + `autoninja chrome` |
| `package.sh` | install the built app as the zbrowser base + rebrand |
| `patches/` | the HUD patch series + `patches/README.md` target-file map |

## Status

Pipeline: ready. HUD patches (`patches/series`): **Phase 1 — authored against the
checked-out tree, not before.** See `patches/README.md` for the verified
target-file map (tab shape → `tab_style_views.cc` `GetPath`, colors → the color
mixer, fonts → the UI font list). Reference models: ungoogled-chromium (patch
series), helium-chromium and brave-core (the same `GetPath` tab-shape edit).
