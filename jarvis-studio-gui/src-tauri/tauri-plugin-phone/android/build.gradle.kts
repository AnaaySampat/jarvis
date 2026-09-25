plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.kapt")
}

android {
    namespace = "com.jarvis.phone"
    compileSdk = 34
    defaultConfig {
        minSdk = 24
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }
    buildTypes {
        getByName("release") {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
        }
    }
    kotlinOptions {
        jvmTarget = "1.8"
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")
    implementation("androidx.room:room-runtime:2.6.1")
    implementation("androidx.room:room-ktx:2.6.1")
    kapt("androidx.room:room-compiler:2.6.1")
    implementation("androidx.work:work-runtime-ktx:2.9.0")
    // Same openWakeWord family the desktop Python backend uses (hey_jarvis.onnx in assets).
    implementation("xyz.rementia:openwakeword:0.1.5")
    // openwakeword pins onnxruntime 1.18.0, whose .so files are 4 KB-aligned; devices
    // with 16 KB memory pages (Android 15+) flag them. Force a 16 KB-compliant build.
    implementation("com.microsoft.onnxruntime:onnxruntime-android:1.22.0")
    // SAF tree navigation for the user-granted read-only folder (read_file/list_directory).
    implementation("androidx.documentfile:documentfile:1.0.1")
    // Provides app.tauri.plugin.* (Plugin/Invoke/JSObject) + the annotations. Tauri
    // wires the :tauri-android project into the app's Gradle build during init.
    implementation(project(":tauri-android"))
    testImplementation("junit:junit:4.13.2")
    // android.jar's org.json is a stub on the JVM; the operator core parses JSON.
    testImplementation("org.json:json:20240303")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    androidTestImplementation("androidx.test:core:1.6.1")
    androidTestImplementation("androidx.test:runner:1.6.2")
    androidTestImplementation("androidx.room:room-testing:2.6.1")
}
