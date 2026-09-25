# Build a signed Android APK you can sideload onto a phone.
# Usage:
#   .\scripts\build-android.ps1              # release APK (signed with debug key if no keystore)
#   .\scripts\build-android.ps1 -Debug       # debug APK (fastest for testing)
#   .\scripts\build-android.ps1 -Target arm64 # phone-only ABI (smaller APK)

param(
    [switch]$Debug,
    [ValidateSet("universal", "arm64", "arm")]
    [string]$Target = "universal"
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Gui = Join-Path $Root "jarvis-studio-gui"
$AndroidGen = Join-Path $Gui "src-tauri\gen\android"

if (-not (Test-Path $AndroidGen)) {
    Write-Error "Android project not found at $AndroidGen. Run: npx tauri android init"
}

Push-Location $Gui
try {
    $tauriArgs = @("android", "build", "--apk")
    if ($Debug) { $tauriArgs += "--debug" }

    switch ($Target) {
        "arm64" { $tauriArgs += @("--target", "aarch64") }
        "arm"   { $tauriArgs += @("--target", "armv7") }
    }

    Write-Host "Building Android APK ($($tauriArgs -join ' '))..." -ForegroundColor Cyan
    npx tauri @tauriArgs
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

    $variant = if ($Debug) { "debug" } else { "release" }
    # --target only picks the ABIs; without --split-per-abi the output is still "universal".
    $apkDir = Join-Path $AndroidGen "app\build\outputs\apk\universal\$variant"
    $apk = Get-ChildItem -Path $apkDir -Filter "*.apk" -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -notmatch "-unsigned" } |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1

    if (-not $apk) {
        $unsigned = Get-ChildItem -Path $apkDir -Filter "*unsigned*.apk" -ErrorAction SilentlyContinue |
            Select-Object -First 1
        if ($unsigned) {
            Write-Warning "Only unsigned APK found: $($unsigned.FullName)"
            Write-Warning "Release builds must be signed. Re-run after Gradle signing config is applied."
        } else {
            Write-Error "No APK found under $apkDir"
        }
        exit 1
    }

    Write-Host ""
    Write-Host "Install this file on your phone:" -ForegroundColor Green
    Write-Host "  $($apk.FullName)"
    Write-Host "  Size: $([math]::Round($apk.Length / 1MB, 1)) MB"
    Write-Host ""
    Write-Host "Do NOT install .aab bundles or output-metadata.json - only the .apk file."
}
finally {
    Pop-Location
}
