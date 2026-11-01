plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.jarvis.gesturesmoke"
    compileSdk = 36
    defaultConfig {
        applicationId = "com.jarvis.gesturesmoke"
        minSdk = 24
        targetSdk = 36
        ndk { abiFilters += providers.gradleProperty("gestureSmokeAbi").getOrElse("x86_64") }
    }
    buildTypes {
        getByName("release") {
            isMinifyEnabled = true
            signingConfig = signingConfigs.getByName("debug")
            // Use the real app's shrinker rules: debug-only tests miss JNI/reflection failures.
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"),
                "../../jarvis-studio-gui/src-tauri/gen/android/app/proguard-rules.pro")
        }
    }
    kotlinOptions { jvmTarget = "1.8" }
}

dependencies {
    implementation(project(":tauri-plugin-phone"))
}
