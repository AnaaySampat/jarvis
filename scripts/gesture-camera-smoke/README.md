# Gesture camera release regression

This opt-in test app runs the real `GestureCameraService` and bundled recognizer
with R8 enabled and the production app's ProGuard rules. It checks frame delivery,
stop, and restart inside the optimized application. It needs no Rust/WebView build,
network model download, real hand, or saved photo. It is a separate package:
`com.jarvis.gesturesmoke`; the user's JARVIS installation is untouched.

Start an unlocked emulator with a front camera. The existing `jarvis_test` AVD needs
`-camera-front emulated` because its default configuration has no front camera.
Then run from the repository root:

```powershell
.\scripts\gesture-camera-smoke\run.ps1
```

The default ABI is x86_64. For a connected phone use `-Serial <adb-serial> -Abi arm64-v8a`.
The script builds, installs, grants the test app camera/overlay access, and requires
an explicit PASS in its process's log. It always stops the test app afterward.
`-SkipBuild` tests the last APK. `-Baseline` deliberately excludes the phone plugin's
consumer shrinker rules in this isolated build to reproduce the original failure.

The Gradle init script includes the test host only for the requested invocation;
production Gradle settings remain unchanged. Generated files stay under `build/`.
