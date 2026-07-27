# zwire fork — the full-HUD Chromium build

The HUD extension layer (`extensions/hud-internal` + the HUD new-tab) gives you
the tiling workspace, the ⌘K palette, the scheme picker, and your extensions —
but it **cannot** reshape the browser chrome: tab shape, UI fonts, toolbar
borders are native C++, not themeable.

This `fork/` directory is the **source build** — the way zwire ships. It
restyles the chrome itself: sharp cyberpunk tabs, Share Tech Mono / Monaco UI
type, neon toolbar, HUD-colored frame, and the 8 HUD schemes wired into the
DevTools Theme dropdown. It compiles a patched Chromium and installs it as the
zwire base, which the `bin/zwire` launcher then runs with the extensions
preloaded.

## Cost (be sure you want this)

- **First build:** ~100 GB checkout + **1–4 hours** compile. Incremental
  rebuilds after a patch: minutes.
- **Disk:** ~150 GB (src + one out dir).
- **Maintenance:** rebase `fork/patches/` onto each Chromium release you track,
  plus security-patch cadence. This is the solo-fork commitment.

## Pipeline

```sh
fork/fetch.sh                 # depot_tools + fetch pinned Chromium (long)
fork/apply-patches.sh  ~/zwire-chromium/src
fork/build.sh          ~/zwire-chromium/src      # the long compile
fork/package.sh        ~/zwire-chromium/src/out/zwire
zwire                                            # runs the HUD-chromed fork
```

| File | Role |
|---|---|
| `CHROMIUM_VERSION` | pinned release tag the patch series targets |
| `args.gn` | GN build config — unbranded (`is_chrome_branded=false`), release, proprietary codecs on (H.264/AAC) |
| `fetch.sh` | install depot_tools, fetch + checkout the pinned tag, sync deps |
| `apply-patches.sh` | apply / reverse the HUD patch series over `src/` |
| `build.sh` | `gn gen` + `autoninja chrome` |
| `package.sh` | install the built app as the zwire base + rebrand |
| `patches/` | the HUD patch series + `patches/README.md` target-file map |

## Media codecs

Stock Chromium builds with `ffmpeg_branding="Chromium"` — open codecs only
(VP8/VP9/AV1/Opus/Vorbis), no H.264/AAC. Sites that stream H.264 (Synology
SurveillanceStation web live-view, most IP cameras, MP4/AAC media) play in Google
Chrome but not in an unpatched Chromium build. `args.gn` sets
`proprietary_codecs = true` + `ffmpeg_branding = "Chrome"` so zwire decodes what
Chrome does. H.265/HEVC is not software-decoded — Chromium routes it to the OS
hardware decoder (`enable_platform_hevc`, VideoToolbox on macOS); Synology gates
H.265/MPEG4/MxPEG to its native Client anyway, so set such cameras' live-view
stream to H.264 for browser playback.

## Status

Pipeline: ready. HUD patches (`patches/series`): **all 27 authored** against the
pinned tag `150.0.7871.46` and verified **apply-clean** (`git apply --check`
against each target file read at that exact tag):

| Patch | Restyles | State |
|---|---|---|
| 0001 tab shape | sharp 2px HUD tab corners | authored · apply-clean |
| 0002 UI colors | HUD palette on frame / toolbar / tabs / omnibox + neon separator | authored · apply-clean |
| 0003 UI font | Share Tech Mono / Monaco UI type (`resource_bundle.cc`) | authored · apply-clean |
| 0004 toolbar border | 2px neon cyan line under the toolbar | authored · apply-clean |
| 0005 omnibox | sharp 2px omnibox field | authored · apply-clean |
| 0006 branding | `zwire` product strings | authored · apply-clean |
| 0007 DevTools theme | 8 HUD schemes in the DevTools Theme dropdown (3 front_end files) | authored · apply-clean |

Apply-clean proves the diff context matches the pinned source; it does **not**
prove the C++ compiles — `fork/build.sh` is that gate. See `patches/README.md`
for the target-file map and anchors. Reference models: ungoogled-chromium (patch
series), helium-chromium and brave-core (native-chrome restyle).
