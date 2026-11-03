# Keep the Tauri plugin + the accessibility service (instantiated by name/reflection).
-keep class com.jarvis.phone.PhonePlugin { *; }
-keep class com.jarvis.phone.JarvisAccessibilityService { *; }

# MediaPipe calls these Java callbacks/factories by name from JNI. Android's default
# native-method rule does not protect Java methods called FROM native code.
# These are the Java entry points referenced by the pinned tasks-core JNI library.
# Keep them explicitly: retaining the entire framework also retains optional graph
# profiling/template APIs whose protobuf classes are not shipped in tasks-core.
-keep class com.google.mediapipe.framework.MediaPipeException { *; }
-keep class com.google.mediapipe.framework.Packet { *; }
-keep class com.google.mediapipe.framework.PacketCreator { *; }
-keep interface com.google.mediapipe.framework.PacketListCallback { *; }
-keep class com.google.mediapipe.framework.ProtoUtil$SerializedMessage { *; }
-keep interface com.google.mediapipe.framework.TextureReleaseCallback { *; }

# The gesture model's graph options/results use protobuf-lite reflection. R8 can
# remove or rename fields (e.g. bitField0_) even though serialization needs them.
# https://github.com/protocolbuffers/protobuf/blob/main/java/lite.md
-keep class * extends com.google.protobuf.GeneratedMessageLite { *; }

# MediaPipe initializes FluentLogger while loading Graph. Flogger locates its
# caller by walking the Java stack; R8 inlining/merging its factory and caller
# finder removes frames it requires ("no caller found on the stack"). Keep this
# small logging runtime intact, including its stack-walking helpers.
# https://github.com/google/flogger/issues/388
-keep class com.google.common.flogger.** { *; }
