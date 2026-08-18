<#
.SYNOPSIS
  Self-contained Windows install of zwire, mirroring the macOS .app / Linux
  ~/.local installers.

.DESCRIPTION
  Assembles everything the browser needs under %LOCALAPPDATA%\zwire :
    browser\   the Chromium Win_x64 snapshot (chrome.exe + resources)
    ext\       newtab + zpwrchrome + hud-internal extensions
    native\    zwire-host.exe (cross-platform Rust binary) + zpwrchrome-host.exe
               (downloads · otp · search) + stryke.exe (Hooks sidecar) + their manifests
  then wires the native-messaging host via the REGISTRY (Windows does not read
  host manifests from the profile dir like macOS/Linux do), drops a zwire.cmd
  launcher, and creates a Start Menu shortcut with the zwire icon.

  No admin rights needed — everything is per-user (HKCU + %LOCALAPPDATA%).
  The user PROFILE lives at %APPDATA%\zwire\profile, outside the install,
  so the install dir stays disposable.

  Requires the Rust toolchain (cargo) on PATH to build the native host.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\localinstall-windows.ps1
#>
[CmdletBinding()]
param(
  [string]$Revision = ""   # pin a Chromium snapshot revision; default = latest
)
$ErrorActionPreference = "Stop"

# Stable extension IDs (pinned via each manifest "key").
$HUD_ID    = "omcgnnjfmbmpdlofklbpddkhnfibfhgg"
$ZPWR_ID   = "hpppdchpnphmiijdeanibpcadgknmaja"
$NEWTAB_ID = "gpoepnekoiplhkegjpocnpeijiefgieb"

$Root    = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$State   = if ($env:ZWIRE_STATE) { $env:ZWIRE_STATE } else { Join-Path $env:APPDATA "zwire" }
$Profile = Join-Path $State "profile"
$Dest    = Join-Path $env:LOCALAPPDATA "zwire"
$IconSrc = Join-Path $Root "branding\zwire.ico"

function Say($m) { Write-Host "  [zwire] $m" -ForegroundColor Cyan }

Write-Host ""
Write-Host "  ZWIRE // localinstall (windows) -> $Dest" -ForegroundColor Magenta
Write-Host ""

# --- 1. base browser snapshot (Win_x64) --------------------------------------
$BaseUrl = "https://storage.googleapis.com/chromium-browser-snapshots/Win_x64"
$BaseDir = Join-Path $State "base"
New-Item -ItemType Directory -Force -Path $BaseDir | Out-Null
$ChromeExe = Join-Path $BaseDir "chrome-win\chrome.exe"
if (-not (Test-Path $ChromeExe)) {
  if (-not $Revision) { $Revision = (Invoke-WebRequest -UseBasicParsing "$BaseUrl/LAST_CHANGE").Content.Trim() }
  Say "downloading Chromium snapshot r$Revision (Win_x64) ..."
  $zip = Join-Path $State "chrome-win.zip"
  Invoke-WebRequest -UseBasicParsing "$BaseUrl/$Revision/chrome-win.zip" -OutFile $zip
  if (Test-Path (Join-Path $BaseDir "chrome-win")) { Remove-Item -Recurse -Force (Join-Path $BaseDir "chrome-win") }
  Expand-Archive -Path $zip -DestinationPath $BaseDir -Force
  Remove-Item $zip -Force
  Set-Content -Path (Join-Path $State "base.path") -Value $ChromeExe
  Set-Content -Path (Join-Path $State "base.version") -Value "r$Revision"
}
if (-not (Test-Path $ChromeExe)) { throw "base chrome.exe not found after fetch: $ChromeExe" }
Say "base browser // $ChromeExe"

# --- 2. native host (Rust) ---------------------------------------------------
if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
  throw "cargo not found — install Rust: https://rustup.rs"
}
$HostDir = Join-Path $Root "extensions\hud-internal\native\zwire-host"
Say "building zwire-host (release) ..."
Push-Location $HostDir
try { cargo build --release | Out-Null } finally { Pop-Location }
$HostBin = Join-Path $HostDir "target\release\zwire-host.exe"
if (-not (Test-Path $HostBin)) { throw "native host build produced no zwire-host.exe" }
Say "host // zwire-host.exe"

# zpwrchrome's own native host (BP protocol) — backs dl.* segmented downloads,
# otp, search, run.spawn. Bundled so downloads never depend on a separately
# installed host whose manifest can go stale and silently hand every download
# back to the browser's built-in downloader.
$ZpwrHostDir = Join-Path $Root "extensions\zpwrchrome\zpwrchrome-host"
Say "building zpwrchrome-host (release) ..."
Push-Location $ZpwrHostDir
try { cargo build --release | Out-Null } finally { Pop-Location }
$ZpwrHostBin = Join-Path $ZpwrHostDir "target\release\zpwrchrome-host.exe"
if (-not (Test-Path $ZpwrHostBin)) { throw "zpwrchrome host build produced no zpwrchrome-host.exe" }
Say "host // zpwrchrome-host.exe"

# --- 2b. hooks editor bundle (Monaco) ----------------------------------------
# lib\hooks-editor\ is a gitignored esbuild artifact, so a fresh clone (or a tree whose
# extensions\hud-internal\node_modules was cleaned) has NOTHING for the copy below to
# take — and the Hooks / Commands / Triggers pages then mount no editor at all,
# silently: each only builds one `if (window.HooksEditor)`, which the dead <script src>
# never defines. Same build the bash installers run (via node directly — no bash needed).
$HeExt = Join-Path $Root "extensions\hud-internal"
$HeOut = Join-Path $HeExt "lib\hooks-editor"
$HeBuilder = Join-Path $HeExt "vendor\zpwr-hooks-editor\scripts\build-hooks-editor.mjs"
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw "node not found (need >=20) — required for the Monaco hooks editor bundle" }
if (-not (Test-Path $HeBuilder)) { throw "hooks editor builder missing: $HeBuilder" }
if (-not (Test-Path (Join-Path $HeExt "node_modules\monaco-editor"))) {
  if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) { throw "pnpm not found — needed for the monaco devDeps" }
  Push-Location $HeExt
  try { pnpm install | Out-Null } finally { Pop-Location }
}
Push-Location $HeExt
try {
  $env:HOOKS_EDITOR_OUT = $HeOut
  node $HeBuilder | Out-Null
} finally { Pop-Location; Remove-Item Env:\HOOKS_EDITOR_OUT -ErrorAction SilentlyContinue }
foreach ($f in @("hooks-editor.bundle.js","hooks-editor.bundle.css","hooks-editor.worker.js","hooks-editor.ts.worker.js")) {
  $p = Join-Path $HeOut $f
  if (-not (Test-Path $p) -or (Get-Item $p).Length -eq 0) { throw "hooks editor artifact missing/empty: $f — Hooks/Commands/Triggers would ship without Monaco" }
}
Say "monaco // hooks editor bundle + 2 workers"

# --- 3. assemble the self-contained install ----------------------------------
if (Test-Path $Dest) { Remove-Item -Recurse -Force $Dest }
New-Item -ItemType Directory -Force -Path (Join-Path $Dest "browser"),(Join-Path $Dest "ext"),(Join-Path $Dest "native") | Out-Null

Say "copy browser ..."
Copy-Item -Recurse -Force (Join-Path $BaseDir "chrome-win\*") (Join-Path $Dest "browser")

foreach ($pair in @(@("newtab","newtab"), @("extensions\zpwrchrome","zpwrchrome"), @("extensions\hud-internal","hud-internal"))) {
  $src = Join-Path $Root $pair[0]; $name = $pair[1]
  $out = Join-Path $Dest "ext\$name"
  New-Item -ItemType Directory -Force -Path $out | Out-Null
  Copy-Item -Recurse -Force "$src\*" $out
  foreach ($junk in @("node_modules",".git","tests","target")) {
    $p = Join-Path $out $junk; if (Test-Path $p) { Remove-Item -Recurse -Force $p }
  }
  Say "ext // $name"
}

# The Monaco bundle built above must have SURVIVED the copy — the pages 404 silently if not.
$HeStaged = Join-Path $Dest "ext\hud-internal\lib\hooks-editor\hooks-editor.bundle.js"
if (-not (Test-Path $HeStaged) -or (Get-Item $HeStaged).Length -eq 0) {
  throw "installed hud-internal is missing lib\hooks-editor\ — Hooks/Commands/Triggers would ship without Monaco"
}

# Same trap for the git SUBMODULE libs: an uninitialised submodule is an EMPTY
# directory, so the copy above succeeds and the pages that import from it render
# blank with only a console 404. Guard the one entry point each page loads.
#   lib\file-browser  -> pages\files.js injects webui\file-browser.js
#   lib\clip-engine   -> pages\timeline.js imports webui\grid\index.js
foreach ($sub in @("lib\file-browser\webui\file-browser.js", "lib\clip-engine\webui\grid\index.js")) {
  $SubStaged = Join-Path $Dest "ext\hud-internal\$sub"
  if (-not (Test-Path $SubStaged) -or (Get-Item $SubStaged).Length -eq 0) {
    throw "installed hud-internal is missing $sub — run: git submodule update --init --recursive"
  }
}

Copy-Item -Force $HostBin (Join-Path $Dest "native\zwire-host.exe")
Say "native // zwire-host.exe"

Copy-Item -Force $ZpwrHostBin (Join-Path $Dest "native\zpwrchrome-host.exe")
Say "native // zpwrchrome-host.exe"

# stryke sidecar for the Hooks feature (runner + `stryke --lsp`), bundled next to
# zwire-host.exe so resolve_stryke() finds it as a sibling. Skipped with a warning
# if absent (the host falls back to a system stryke on PATH).
$StrykeSrc = $null
$cands = @()
if ($env:ZWIRE_STRYKE) { $cands += $env:ZWIRE_STRYKE }
$onPath = (Get-Command stryke.exe -ErrorAction SilentlyContinue)
if ($onPath) { $cands += $onPath.Source }
$cands += (Join-Path $env:USERPROFILE ".cargo\bin\stryke.exe")
foreach ($c in $cands) { if ($c -and (Test-Path $c)) { $StrykeSrc = $c; break } }
if ($StrykeSrc) {
  Copy-Item -Force $StrykeSrc (Join-Path $Dest "native\stryke.exe")
  Say "native // stryke.exe (Hooks sidecar) <- $StrykeSrc"
} else {
  Say "stryke.exe not found - Hooks sidecar skipped (host falls back to a system stryke on PATH)"
}

# --- 4. native-messaging host manifest + REGISTRY registration ---------------
# Windows locates native hosts via a registry key whose default value is the
# full path to the manifest json (unlike macOS/Linux which scan directories).
$manifestPath = Join-Path $Dest "native\com.zwire.hud.json"
$hostExe = (Join-Path $Dest "native\zwire-host.exe")
$manifest = [ordered]@{
  name            = "com.zwire.hud"
  description     = "zwire HUD native host"
  path            = $hostExe
  type            = "stdio"
  allowed_origins = @("chrome-extension://$HUD_ID/", "chrome-extension://$ZPWR_ID/", "chrome-extension://$NEWTAB_ID/")
}
($manifest | ConvertTo-Json -Depth 5) | Set-Content -Encoding UTF8 -Path $manifestPath

# Register under both Chromium and Chrome hives — the snapshot is "Chromium",
# but registering both makes the host resolve regardless of the browser's name.
foreach ($hive in @("HKCU:\Software\Chromium\NativeMessagingHosts\com.zwire.hud",
                    "HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.zwire.hud")) {
  New-Item -Path $hive -Force | Out-Null
  Set-ItemProperty -Path $hive -Name "(default)" -Value $manifestPath
}
Say "native host // registered (HKCU)"

# Same registration for zpwrchrome's BP host, pointed at the bundled exe. The
# HKCU value is overwritten on every install, so a previously registered
# (e.g. package-managed) manifest can never win and strand downloads.
$zpwrManifestPath = Join-Path $Dest "native\com.menketechnologies.zpwrchrome.json"
$zpwrManifest = [ordered]@{
  name            = "com.menketechnologies.zpwrchrome"
  description     = "zpwrchrome native host (BP protocol)"
  path            = (Join-Path $Dest "native\zpwrchrome-host.exe")
  type            = "stdio"
  allowed_origins = @("chrome-extension://$ZPWR_ID/")
}
($zpwrManifest | ConvertTo-Json -Depth 5) | Set-Content -Encoding UTF8 -Path $zpwrManifestPath

foreach ($hive in @("HKCU:\Software\Chromium\NativeMessagingHosts\com.menketechnologies.zpwrchrome",
                    "HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.menketechnologies.zpwrchrome")) {
  New-Item -Path $hive -Force | Out-Null
  Set-ItemProperty -Path $hive -Name "(default)" -Value $zpwrManifestPath
}
Say "zpwrchrome host // registered (HKCU)"

# --- 5. launcher (.cmd): writes nothing, just execs the bundled browser -------
$launcher = Join-Path $Dest "zwire.cmd"
$load = "$Dest\ext\newtab,$Dest\ext\zpwrchrome,$Dest\ext\hud-internal"
@"
@echo off
setlocal
set "PROFILE=%APPDATA%\zwire\profile"
if not exist "%PROFILE%" mkdir "%PROFILE%"
start "" "$Dest\browser\chrome.exe" ^
  --user-data-dir="%PROFILE%" ^
  --load-extension="$load" ^
  --extensions-on-chrome-urls ^
  --test-type ^
  --no-first-run ^
  --no-default-browser-check ^
  --homepage=chrome://newtab ^
  --disable-features=NtpFooter ^
  --enable-features=SplitViewHorizontal,SplitViewTabRestore ^
  %*
"@ | Set-Content -Encoding ASCII -Path $launcher
Say "launcher // $launcher"

# --- 6. Start Menu shortcut with the zwire icon ------------------------------
$startMenu = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs"
New-Item -ItemType Directory -Force -Path $startMenu | Out-Null
$lnk = Join-Path $startMenu "zwire.lnk"
$ws = New-Object -ComObject WScript.Shell
$sc = $ws.CreateShortcut($lnk)
$sc.TargetPath       = "$Dest\browser\chrome.exe"
$sc.Arguments        = "--user-data-dir=`"$Profile`" --load-extension=`"$load`" --extensions-on-chrome-urls --test-type --no-first-run --no-default-browser-check --homepage=chrome://newtab --disable-features=NtpFooter --enable-features=SplitViewHorizontal,SplitViewTabRestore"
$sc.WorkingDirectory = "$Dest\browser"
$sc.Description       = "Chromium superset with the zwire cyberpunk HUD"
if (Test-Path $IconSrc) {
  Copy-Item -Force $IconSrc (Join-Path $Dest "zwire.ico")
  $sc.IconLocation = (Join-Path $Dest "zwire.ico")
}
$sc.Save()
Say "shortcut // Start Menu > zwire"

Write-Host ""
$size = "{0:N0} MB" -f ((Get-ChildItem -Recurse $Dest | Measure-Object Length -Sum).Sum / 1MB)
Say "installed // $size // $Dest  (self-contained — repo can be deleted)"
Say "launch // Start Menu > zwire   (or run $Dest\zwire.cmd)"
Write-Host ""
