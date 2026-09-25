//! tauri-plugin-phone — on-phone app control for JARVIS.
//!
//! Exposes the Android AccessibilityService to the in-app brain so the phone operator
//! (src/brain/operator/phone.ts) can read the screen and tap/type/scroll/navigate.
//! Android only; the desktop impl returns "unavailable" so the shared brain still runs.

use tauri::{
    plugin::{Builder, TauriPlugin},
    Manager, Runtime,
};

mod commands;
mod error;
mod models;

pub use error::{Error, Result};
pub use models::*;

#[cfg(desktop)]
mod desktop;
#[cfg(mobile)]
mod mobile;

#[cfg(desktop)]
use desktop::Phone;
#[cfg(mobile)]
use mobile::Phone;

/// Extension trait to access the phone APIs from an `AppHandle`/`Manager`.
pub trait PhoneExt<R: Runtime> {
    fn phone(&self) -> &Phone<R>;
}

impl<R: Runtime, T: Manager<R>> PhoneExt<R> for T {
    fn phone(&self) -> &Phone<R> {
        self.state::<Phone<R>>().inner()
    }
}

/// Initialise the plugin. Register it in the app builder: `.plugin(tauri_plugin_phone::init())`.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("phone")
        .invoke_handler(tauri::generate_handler![
            commands::is_enabled,
            commands::observe,
            commands::tap,
            commands::tap_xy,
            commands::long_press,
            commands::double_tap,
            commands::set_text,
            commands::type_text,
            commands::scroll,
            commands::back,
            commands::home,
            commands::swipe,
            commands::open_app,
            commands::close_app,
            commands::open_url,
            commands::set_volume,
            commands::read_clipboard,
            commands::open_system_settings,
            commands::open_accessibility_settings,
            commands::speak,
            commands::stop_speaking,
            commands::poll_speaking,
            commands::start_wake_word,
            commands::stop_wake_word,
            commands::poll_wake_word,
            commands::show_stop_overlay,
            commands::hide_stop_overlay,
            commands::poll_stop_overlay,
            commands::request_overlay_permission,
            commands::get_device_stats,
            commands::capture_screenshot,
            commands::pick_folder,
            commands::list_directory,
            commands::read_file,
            commands::clock_action,
            commands::calendar_action,
            commands::task_begin,
            commands::task_checkpoint,
            commands::task_finish,
            commands::task_cancel,
            commands::task_status,
            commands::operator_start,
            commands::operator_status,
            commands::config_secret_set,
            commands::config_secret_get,
            commands::config_secret_delete,
            commands::identity_info,
            commands::identity_sign_auth,
            commands::identity_sign_envelope,
            commands::identity_sign_pairing,
            commands::identity_verify_host_challenge,
            commands::identity_verify_host_envelope,
        ])
        .setup(|app, api| {
            #[cfg(mobile)]
            let phone = mobile::init(app, api)?;
            #[cfg(desktop)]
            let phone = desktop::init(app, api)?;
            app.manage(phone);
            Ok(())
        })
        .build()
}
