# zbrowser HUD patch map

The whole-browser cyberpunk HUD look requires patching Chromium's native C++
(Views) UI and recompiling — a Chrome theme extension cannot change tab shape,
fonts, borders, or toolbar layout (only colors). This directory holds the patch
series that restyles the chrome. Patches are authored against the pinned tree
(`fork/CHROMIUM_VERSION` = `150.0.7871.46`) and listed in `series`.

Do not fabricate these blind. Each patch here was authored by reading its target
file at the exact tag on the Chromium GitHub mirror
(`raw.githubusercontent.com/chromium/chromium/150.0.7871.46/…`) and is verified
**apply-clean** against that tree with `git apply --check`. Apply-clean proves
the context matches; it does **not** prove the C++ compiles. Compile-verify by
running `fork/build.sh` — that is the gate for the native (Views) patches.

## Target-file map (verified against 150.0.7871.46)

| # | HUD element | Target file (exact anchor) | Approach | Status |
|---|---|---|---|---|
| 0001 | **Tab shape** | `chrome/browser/ui/views/tabs/tab_style_views.cc` (`TabStyleViewsImpl::GetPath`, radius calc) | Clamp `content_corner_radius` / `extension_corner_radius` to `2 * scale` so tabs render with the HUD's sharp 2px corners (rather than rewriting the Refresh bezier, which re-anchors every milestone). | authored · apply-clean |
| 0002 | **UI colors** | `chrome/browser/ui/color/chrome_color_mixer.cc` (`AddChromeColorMixer`, before the high-contrast early-return) | Force the cyberpunk palette onto frame / toolbar / toolbar text+icons / tab bg+fg / omnibox bg+border and recolor the under-toolbar separator neon cyan (`#05050a` / `#0a0a14` / `#0d0d1a` / `#05d9e8` / `#e0f0ff`). Beyond what the theme extension can reach. | authored · apply-clean |
| 0003 | **UI font** | font-resource pipeline (`SetDefaultFontDescription` call site + bundle `Orbitron` / `Share Tech Mono` OTF + register with CoreText/fontconfig) | Route the browser UI font list to the HUD faces. **Not authored** — faithful impl needs the checked-out tree + a build; setting only the description string silently no-ops when the faces aren't registered. Author after `fork/fetch.sh`. | pending (needs tree) |
| 0004 | **Toolbar neon border** | `chrome/browser/ui/views/toolbar/toolbar_view.cc` (`Init`, `kNormal` branch) | Add a 2px cyan bottom border via `views::CreateSolidSidedBorder(…, kColorToolbarContentAreaSeparator)`; the separator color itself is set neon cyan in 0002. | authored · apply-clean |
| 0005 | **Omnibox field** | `chrome/browser/ui/views/location_bar/location_bar_view.cc` (`ComputeBorderRadius`) | Clamp the field radius to 2px so the omnibox is the sharp HUD field instead of the rounded pill. Background + border colors come from 0002. | authored · apply-clean |
| 0006 | **Product strings** | `chrome/app/theme/chromium/BRANDING` | `Chromium` → `zbrowser` product names, `MenkeTechnologies` company, `com.menketechnologies.zbrowser` bundle id. This is the file the unbranded (`is_chrome_branded=false`) build reads. | authored · apply-clean |

## Rebasing onto a new Chromium release

1. Bump `fork/CHROMIUM_VERSION` to the new tag.
2. `fork/apply-patches.sh SRC --reverse` on the old tree (or start clean).
3. `fork/fetch.sh` the new tag.
4. `fork/apply-patches.sh SRC` — fix any rejects (`.rej`) against the new source.
5. `fork/build.sh SRC` — compile-test each patch still does what it claims.

The radius-calc, color-mixer, toolbar `Init` and `ComputeBorderRadius` anchors
shift between milestones; expect to re-anchor most releases. To re-verify an
anchor without a full checkout, read the target file at the new tag from
`raw.githubusercontent.com/chromium/chromium/<TAG>/<path>` and `git apply
--check` against it. This is the ongoing fork-maintenance cost.
