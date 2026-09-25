# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# If your project uses WebView with JS, uncomment the following
# and specify the fully qualified class name to the JavaScript interface
# class:
#-keepclassmembers class fqcn.of.javascript.interface.for.webview {
#   public *;
#}

# Uncomment this to preserve the line number information for
# debugging stack traces.
#-keepattributes SourceFile,LineNumberTable

# If you keep the line number information, uncomment this to
# hide the original source file name.
#-renamesourcefileattribute SourceFile

# ONNX Runtime's native (.so) layer resolves these Java classes by name via JNI
# (FindClass/GetMethodID) at runtime, not through any Java-visible reference R8 can
# see. On the first-ever minified release build R8 renamed/stripped them, and the
# native lookup aborted the whole process (SIGABRT) the instant openWakeWord ran a
# model -- which happens as soon as WakeWordService starts, so the app couldn't even
# open. All prior installs were debug (isMinifyEnabled=false) and never hit this.
-keep class ai.onnxruntime.** { *; }
-dontwarn ai.onnxruntime.**

# Defensive: xyz.rementia:openwakeword wraps onnxruntime and is the only thing that
# runs a native model this early -- keep its classes too rather than discover a
# second JNI break later.
-keep class xyz.rementia.** { *; }
-dontwarn xyz.rementia.**

# Our own Tauri plugin package (com.jarvis.phone.*: PhonePlugin, the accessibility
# service, WakeWordService, and every @InvokeArg args class). Tauri's OWN generated
# rules (proguard-wry.pro) only keep com.jarvis.app.* -- this plugin's package was
# never covered. @Command methods are dispatched by NAME via reflection from JS
# (run_mobile_plugin("showStopOverlay", ...)), and @InvokeArg fields (TapXyArgs.x/y,
# SwipeArgs.startX, ...) are populated by matching JSON keys to FIELD NAMES via
# reflection -- an unkept rename wouldn't necessarily crash, it would just silently
# stop working (wrong/no method found, or args left at their zero-value default).
-keep class com.jarvis.phone.** { *; }
-keepclassmembers class com.jarvis.phone.** { *; }