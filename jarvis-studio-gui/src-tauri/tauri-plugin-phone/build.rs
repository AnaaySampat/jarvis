// Tauri plugin build script. Lists the commands the JS side can invoke
// (`plugin:phone|<command>`) and points at the android/ native project so the Kotlin
// plugin is compiled into the app. Command names here are the snake_case JS names;
// the Rust mobile layer maps each to its camelCase Kotlin @Command method.
const COMMANDS: &[&str] = &[
    "is_enabled",
    "observe",
    "tap",
    "tap_xy",
    "long_press",
    "double_tap",
    "set_text",
    "type_text",
    "scroll",
    "back",
    "home",
    "swipe",
    "open_app",
    "close_app",
    "open_url",
    "set_volume",
    "read_clipboard",
    "open_system_settings",
    "open_accessibility_settings",
    "speak",
    "stop_speaking",
    "poll_speaking",
    "start_wake_word",
    "stop_wake_word",
    "poll_wake_word",
    "show_stop_overlay",
    "hide_stop_overlay",
    "poll_stop_overlay",
    "request_overlay_permission",
    "get_device_stats",
    "capture_screenshot",
    "pick_folder",
    "list_directory",
    "read_file",
    "clock_action",
    "calendar_action",
    "task_begin",
    "task_checkpoint",
    "task_finish",
    "task_cancel",
    "task_status",
    "operator_start",
    "operator_status",
    "config_secret_set",
    "config_secret_get",
    "config_secret_delete",
    "identity_info",
    "identity_sign_auth",
    "identity_sign_envelope",
    "identity_sign_pairing",
    "identity_verify_host_challenge",
    "identity_verify_host_envelope",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .build();
}
