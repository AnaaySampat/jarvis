use serde::de::DeserializeOwned;
use tauri::{
    plugin::{PluginApi, PluginHandle},
    AppHandle, Runtime,
};

use crate::models::*;

#[cfg(target_os = "android")]
const PLUGIN_IDENTIFIER: &str = "com.jarvis.phone";

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_phone);

/// Register the native Android (or iOS) plugin and return the handle wrapper.
pub fn init<R: Runtime, C: DeserializeOwned>(
    _app: &AppHandle<R>,
    api: PluginApi<R, C>,
) -> crate::Result<Phone<R>> {
    #[cfg(target_os = "android")]
    let handle = api.register_android_plugin(PLUGIN_IDENTIFIER, "PhonePlugin")?;
    #[cfg(target_os = "ios")]
    let handle = api.register_ios_plugin(init_plugin_phone)?;
    Ok(Phone(handle))
}

/// Access to the native phone-control plugin. Each method forwards to the Kotlin
/// @Command of the matching camelCase name.
pub struct Phone<R: Runtime>(PluginHandle<R>);

/// Every method below just forwards a (possibly unit) payload to the Kotlin
/// @Command of the given camelCase name — one macro instead of repeating that
/// `run_mobile_plugin(...).map_err(Into::into)` wrapper by hand per command.
macro_rules! mobile_command {
    ($name:ident ( $arg:ident : $ty:ty ) -> $resp:ty, $js:literal) => {
        pub fn $name(&self, $arg: $ty) -> crate::Result<$resp> {
            self.0.run_mobile_plugin($js, $arg).map_err(Into::into)
        }
    };
    ($name:ident () -> $resp:ty, $js:literal) => {
        pub fn $name(&self) -> crate::Result<$resp> {
            self.0.run_mobile_plugin($js, ()).map_err(Into::into)
        }
    };
}

impl<R: Runtime> Phone<R> {
    mobile_command!(is_enabled() -> IsEnabledResponse, "isEnabled");
    mobile_command!(observe() -> ObserveResponse, "observe");
    mobile_command!(tap(payload: TapRequest) -> ActionResponse, "tap");
    mobile_command!(tap_xy(payload: TapXyRequest) -> ActionResponse, "tapXy");
    mobile_command!(long_press(payload: TapRequest) -> ActionResponse, "longPress");
    mobile_command!(double_tap(payload: TapRequest) -> ActionResponse, "doubleTap");
    mobile_command!(set_text(payload: SetTextRequest) -> ActionResponse, "setText");
    mobile_command!(type_text(payload: TypeTextRequest) -> ActionResponse, "typeText");
    mobile_command!(scroll(payload: ScrollRequest) -> ActionResponse, "scroll");
    mobile_command!(back() -> ActionResponse, "back");
    mobile_command!(home() -> ActionResponse, "home");
    mobile_command!(swipe(payload: SwipeRequest) -> ActionResponse, "swipe");
    mobile_command!(open_app(payload: OpenAppRequest) -> ActionResponse, "openApp");
    mobile_command!(close_app(payload: CloseAppRequest) -> ActionResponse, "closeApp");
    mobile_command!(open_url(payload: OpenUrlRequest) -> ActionResponse, "openUrl");
    mobile_command!(set_volume(payload: VolumeRequest) -> ActionResponse, "setVolume");
    mobile_command!(read_clipboard() -> ActionResponse, "readClipboard");
    mobile_command!(open_system_settings(payload: SystemSettingsRequest) -> ActionResponse, "openSystemSettings");
    mobile_command!(open_accessibility_settings() -> ActionResponse, "openAccessibilitySettings");
    mobile_command!(speak(payload: SpeakRequest) -> ActionResponse, "speak");
    mobile_command!(stop_speaking() -> ActionResponse, "stopSpeaking");
    mobile_command!(poll_speaking() -> crate::models::SpeakingStateResponse, "pollSpeaking");
    mobile_command!(start_wake_word() -> ActionResponse, "startWakeWord");
    mobile_command!(stop_wake_word() -> ActionResponse, "stopWakeWord");
    mobile_command!(poll_wake_word() -> crate::models::WakeStateResponse, "pollWakeWord");
    mobile_command!(show_stop_overlay() -> ActionResponse, "showStopOverlay");
    mobile_command!(hide_stop_overlay() -> ActionResponse, "hideStopOverlay");
    mobile_command!(poll_stop_overlay() -> crate::models::StopOverlayStateResponse, "pollStopOverlay");
    mobile_command!(request_overlay_permission() -> ActionResponse, "requestOverlayPermission");
    mobile_command!(get_device_stats() -> DeviceStatsResponse, "getDeviceStats");
    mobile_command!(capture_screenshot() -> crate::models::CaptureScreenshotResponse, "captureScreenshot");
    mobile_command!(pick_folder() -> PickFolderResponse, "pickFolder");
    mobile_command!(list_directory(payload: FileOpRequest) -> ListDirectoryResponse, "listDirectory");
    mobile_command!(read_file(payload: FileOpRequest) -> ReadFileResponse, "readFile");
    mobile_command!(clock_action(payload: ClockActionRequest) -> ActionResponse, "clockAction");
    mobile_command!(calendar_action(payload: CalendarActionRequest) -> CalendarResponse, "calendarAction");
    mobile_command!(task_begin(payload: TaskBeginRequest) -> TaskBeginResponse, "taskBegin");
    mobile_command!(task_checkpoint(payload: TaskCheckpointRequest) -> ActionResponse, "taskCheckpoint");
    mobile_command!(task_finish(payload: TaskFinishRequest) -> ActionResponse, "taskFinish");
    mobile_command!(task_cancel(payload: TaskIdRequest) -> ActionResponse, "taskCancel");
    mobile_command!(task_status(payload: TaskIdRequest) -> TaskStatusResponse, "taskStatus");
    mobile_command!(operator_start(payload: OperatorStartRequest) -> serde_json::Value, "operatorStart");
    mobile_command!(operator_status(payload: OperatorStatusRequest) -> serde_json::Value, "operatorStatus");
    mobile_command!(config_secret_set(payload: ConfigSecretSetRequest) -> ActionResponse, "configSecretSet");
    mobile_command!(config_secret_get(payload: ConfigSecretNameRequest) -> ConfigSecretResponse, "configSecretGet");
    mobile_command!(config_secret_delete(payload: ConfigSecretNameRequest) -> ActionResponse, "configSecretDelete");
    mobile_command!(identity_info() -> IdentityInfoResponse, "identityInfo");
    mobile_command!(identity_sign_auth(payload: IdentityAuthRequest) -> IdentitySignedResponse, "identitySignAuth");
    mobile_command!(identity_sign_envelope(payload: IdentityEnvelopeRequest) -> IdentitySignedResponse, "identitySignEnvelope");
    mobile_command!(identity_sign_pairing(payload: IdentityPairingRequest) -> IdentitySignedResponse, "identitySignPairing");
    mobile_command!(identity_verify_host_challenge(payload: IdentityVerifyHostChallengeRequest) -> IdentityVerifyResponse, "identityVerifyHostChallenge");
    mobile_command!(identity_verify_host_envelope(payload: IdentityVerifyHostEnvelopeRequest) -> IdentityVerifyResponse, "identityVerifyHostEnvelope");
}
