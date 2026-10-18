# Run the debug APK on a local Android emulator, no phone needed.
# Usage:
#   .\scripts\emulator.ps1           # boot the emulator (created on first run), install the last debug APK, launch
#   .\scripts\emulator.ps1 -Build    # rebuild the debug APK first (arm64 + x86_64, so it installs on phone and emulator)
#   .\scripts\emulator.ps1 -Mic      # pass the laptop microphone into the emulator (off by default)
# -Mic only applies when this script boots the emulator; close the emulator window to change it.

param(
    [switch]$Build,
    [switch]$Mic
)

$Sdk = $env:ANDROID_HOME
$Avd = "jarvis_test"
$Image = "system-images;android-36.1;google_apis_playstore;x86_64"
$Gui = Join-Path (Split-Path -Parent $PSScriptRoot) "jarvis-studio-gui"
$Apk = Join-Path $Gui "src-tauri\gen\android\app\build\outputs\apk\universal\debug\app-universal-debug.apk"
$adb = "$Sdk\platform-tools\adb.exe"
$emu = "$Sdk\emulator\emulator.exe"

if (-not (& $emu -list-avds | Where-Object { $_ -eq $Avd })) {
    Write-Host "Creating emulator $Avd..." -ForegroundColor Cyan
    & "$Sdk\cmdline-tools\latest\bin\sdkmanager.bat" $Image
    "no" | & "$Sdk\cmdline-tools\latest\bin\avdmanager.bat" create avd -n $Avd -k $Image -d pixel_7
    if ($LASTEXITCODE) { exit $LASTEXITCODE }
    # This SDK's old cmdline-tools write target=android-0; the emulator then boots API 36.1
    # into a surfaceflinger crash loop ("hasReadColorBufferDma") that kills every install.
    $ini = "$env:USERPROFILE\.android\avd\$Avd.ini"
    (Get-Content $ini) -replace "^target=.*", "target=android-36.1" | Set-Content $ini -Encoding ascii
    # Host GPU: the default software GPU is what made SystemUI ANR under the animated HUD.
    $set = [ordered]@{
        "avd.id" = $Avd; "avd.name" = $Avd
        "hw.gpu.enabled" = "yes"; "hw.gpu.mode" = "host"
        "hw.ramSize" = "3072"; "hw.keyboard" = "yes"; "disk.dataPartition.size" = "8G"
    }
    $cfg = "$env:USERPROFILE\.android\avd\$Avd.avd\config.ini"
    $keep = Get-Content $cfg | Where-Object { $set.Keys -notcontains ($_ -split "=")[0] -and $_ -notmatch "^disk\.dataPartition\.path=" }
    $keep + ($set.Keys | ForEach-Object { "$_=$($set[$_])" }) | Set-Content $cfg -Encoding ascii
}

if ($Build) {
    Push-Location $Gui
    npx tauri android build --debug --apk --target aarch64 x86_64
    $code = $LASTEXITCODE
    Pop-Location
    if ($code) { exit $code }
}

if (-not (& $adb devices | Select-String "^emulator-\d+\s+device")) {
    $emuArgs = @("-avd", $Avd, "-no-boot-anim")
    if ($Mic) { $emuArgs += "-allow-host-audio" }
    Start-Process $emu -ArgumentList $emuArgs
}

Write-Host "Waiting for the emulator to boot..." -ForegroundColor Cyan
$deadline = (Get-Date).AddMinutes(5)
do {
    if ((Get-Date) -gt $deadline) { Write-Error "Emulator didn't finish booting within 5 minutes."; exit 1 }
    Start-Sleep 3
} until ("$(& $adb -e shell getprop sys.boot_completed 2>$null)".Trim() -eq "1")

& $adb -e install -r $Apk
if ($LASTEXITCODE) { Write-Error "Install failed. INSTALL_FAILED_NO_MATCHING_ABIS means the APK is phone-only: rerun with -Build."; exit 1 }
& $adb -e shell am start -n com.jarvis.app/.MainActivity
