<#
.SYNOPSIS
  Self-contained Windows install of zwire, mirroring the macOS .app / Linux
  ~/.local installers.

.DESCRIPTION
  Assembles everything the browser needs under %LOCALAPPDATA%\zwire :
    browser\   the Chromium Win_x64 snapshot (chrome.exe + resources)
    ext\       newtab + zpwrchrome + hud-internal extensions
    native\    zwire-host.exe (cross-platform Rust binary) + its manifest
  then wires the native-messaging host via the REGISTRY (Windows does not read
  host manifests from the profile dir like macOS/Linux do), drops a zwire.cmd
  launcher, and creates a Start Menu shortcut with the zwire icon.

  No admin rights needed — everything is per-user (HKCU + %LOCALAPPDATA%).
  The user PROFILE lives at %USERPROFILE%\.zwire\profile, outside the install,
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
$State   = if ($env:ZWIRE_STATE) { $env:ZWIRE_STATE } else { Join-Path $env:USERPROFILE ".zwire" }
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

Copy-Item -Force $HostBin (Join-Path $Dest "native\zwire-host.exe")
Say "native // zwire-host.exe"

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

# --- 5. launcher (.cmd): writes nothing, just execs the bundled browser -------
$launcher = Join-Path $Dest "zwire.cmd"
$load = "$Dest\ext\newtab,$Dest\ext\zpwrchrome,$Dest\ext\hud-internal"
@"
@echo off
setlocal
set "PROFILE=%USERPROFILE%\.zwire\profile"
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
