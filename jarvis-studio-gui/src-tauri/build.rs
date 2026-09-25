fn main() {
    // Android 15+ devices with 16 KB memory pages refuse/warn on 4 KB-aligned
    // native libs; rustc doesn't pass this alignment by default with NDK 27.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("android") {
        println!("cargo:rustc-cdylib-link-arg=-Wl,-z,max-page-size=16384");
    }
    tauri_build::build()
}
