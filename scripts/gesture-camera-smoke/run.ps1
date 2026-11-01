param(
    [string]$Serial = "emulator-5554",
    [ValidateSet("x86_64", "arm64-v8a", "armeabi-v7a")]
    [string]$Abi = "x86_64",
    [switch]$Baseline,
    [switch]$SkipBuild
)
$ErrorActionPreference = "Stop"
$Repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$Android = Join-Path $Repo "jarvis-studio-gui\src-tauri\gen\android"
$Package = "com.jarvis.gesturesmoke"

function Invoke-TestDevice {
    param([string[]]$DeviceArgs)
    & adb -s $Serial @DeviceArgs
    if ($LASTEXITCODE -ne 0) { throw "ADB failed: $($DeviceArgs -join ' ')" }
}

if (-not $SkipBuild) {
    Push-Location $Android
    try {
        $BuildArgs = @("-I", (Join-Path $PSScriptRoot "include.gradle"),
            "-PgestureSmokeAbi=$Abi", ":gesture-camera-smoke:packageRelease", "--max-workers=2")
        if ($Baseline) { $BuildArgs += "-PgestureSmokeBaseline=true" }
        & .\gradlew.bat @BuildArgs
        if ($LASTEXITCODE -ne 0) { throw "Release camera test build failed" }
    } finally { Pop-Location }
}

$BootState = (Invoke-TestDevice -DeviceArgs @("shell", "getprop", "sys.boot_completed") | Out-String).Trim()
if ($BootState -ne "1") { throw "Wait for the unlocked emulator/device to finish booting." }
Invoke-TestDevice -DeviceArgs @("install", "-r", (Join-Path $PSScriptRoot "build\outputs\apk\release\gesture-camera-smoke-release.apk"))
Invoke-TestDevice -DeviceArgs @("shell", "pm", "grant", $Package, "android.permission.CAMERA")
Invoke-TestDevice -DeviceArgs @("shell", "appops", "set", $Package, "SYSTEM_ALERT_WINDOW", "allow")
# Only the isolated smoke app is restarted; never force-stop com.jarvis.app.
Invoke-TestDevice -DeviceArgs @("shell", "am", "force-stop", $Package)
try {
    Invoke-TestDevice -DeviceArgs @("shell", "am", "start", "-W", "-n", "$Package/.SmokeActivity")
    $CameraTestPid = (Invoke-TestDevice -DeviceArgs @("shell", "pidof", $Package) | Out-String).Trim()
    $Deadline = (Get-Date).AddSeconds(60)
    do {
        $TestLog = Invoke-TestDevice -DeviceArgs @("logcat", "-d", "--pid=$CameraTestPid", "-s",
            "GestureCameraSmoke:I", "GestureCamera:E", "AndroidRuntime:E", "*:S") | Out-String
        if ($TestLog -match "GestureCameraSmoke.*FAIL:|FATAL EXCEPTION") { throw $TestLog }
        if ($TestLog -match "GestureCameraSmoke.*PASS:") { Write-Output $TestLog; return }
        Start-Sleep -Seconds 1
    } while ((Get-Date) -lt $Deadline)
    throw "No PASS result from the release camera test within 60 seconds. $TestLog"
} finally {
    Invoke-TestDevice -DeviceArgs @("shell", "am", "force-stop", $Package)
}
