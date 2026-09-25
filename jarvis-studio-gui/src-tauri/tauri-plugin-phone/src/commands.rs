use tauri::{command, AppHandle, Runtime};

use crate::models::*;
use crate::PhoneExt;

/// Every command below is a pure pass-through: wrap its positional args into the
/// matching request struct (same field names, so `$req { $($arg),* }` shorthand
/// applies) and forward to the `PhoneExt` method of the same name. One macro
/// covers all of them instead of repeating the wrapper by hand per command.
macro_rules! phone_command {
    ($name:ident ( $($arg:ident : $ty:ty),+ $(,)? ) -> $resp:ty, $req:ident) => {
        #[command]
        pub(crate) async fn $name<R: Runtime>(
            app: AppHandle<R>,
            $($arg: $ty),+
        ) -> crate::Result<$resp> {
            app.phone().$name($req { $($arg),+ })
        }
    };
    ($name:ident () -> $resp:ty) => {
        #[command]
        pub(crate) async fn $name<R: Runtime>(app: AppHandle<R>) -> crate::Result<$resp> {
            app.phone().$name()
        }
    };
}

/// Optional v2 TaskSpec fields keep older callers source-compatible. Kotlin still
/// validates and derives the authenticated source identity before persistence.
#[command]
pub(crate) async fn task_begin<R: Runtime>(
    app: AppHandle<R>,
    task_id: String,
    goal: String,
    deadline_at_ms: i64,
    risk: String,
    idempotency_key: Option<String>,
    source_device_id: Option<String>,
    capability_profile_json: Option<String>,
    retry_budget: Option<i32>,
    typed_plan_json: Option<String>,
) -> crate::Result<TaskBeginResponse> {
    app.phone().task_begin(TaskBeginRequest {
        task_id,
        idempotency_key: idempotency_key.unwrap_or_default(),
        goal,
        deadline_at_ms,
        risk,
        source_device_id: source_device_id.unwrap_or_default(),
        capability_profile_json: capability_profile_json.unwrap_or_default(),
        retry_budget: retry_budget.unwrap_or_else(default_task_retry_budget),
        typed_plan_json: typed_plan_json.unwrap_or_default(),
    })
}

#[command]
pub(crate) async fn task_checkpoint<R: Runtime>(
    app: AppHandle<R>,
    task_id: String,
    state: String,
    step: i32,
    receipt: String,
    verified_checkpoint: Option<String>,
) -> crate::Result<ActionResponse> {
    app.phone().task_checkpoint(TaskCheckpointRequest {
        task_id,
        state,
        step,
        receipt,
        verified_checkpoint: verified_checkpoint.unwrap_or_default(),
    })
}

fn default_task_retry_budget() -> i32 {
    3
}

phone_command!(is_enabled() -> IsEnabledResponse);
phone_command!(observe() -> ObserveResponse);
phone_command!(tap(index: i32, observation_generation: i64, selector: String, expected_app: String, window_id: i32) -> ActionResponse, TapRequest);
phone_command!(tap_xy(x: i32, y: i32, observation_generation: i64, expected_app: String) -> ActionResponse, TapXyRequest);
phone_command!(long_press(index: i32, observation_generation: i64, selector: String, expected_app: String, window_id: i32) -> ActionResponse, TapRequest);
phone_command!(double_tap(index: i32, observation_generation: i64, selector: String, expected_app: String, window_id: i32) -> ActionResponse, TapRequest);
phone_command!(set_text(index: i32, text: String, observation_generation: i64, selector: String, expected_app: String, window_id: i32) -> ActionResponse, SetTextRequest);
phone_command!(type_text(text: String, index: i32, observation_generation: i64, selector: String, expected_app: String, window_id: i32) -> ActionResponse, TypeTextRequest);
phone_command!(scroll(direction: String) -> ActionResponse, ScrollRequest);
phone_command!(back() -> ActionResponse);
phone_command!(home() -> ActionResponse);
phone_command!(swipe(start_x: i32, start_y: i32, end_x: i32, end_y: i32, duration: i64, observation_generation: i64, expected_app: String) -> ActionResponse, SwipeRequest);
phone_command!(open_app(name: String) -> ActionResponse, OpenAppRequest);
phone_command!(close_app(name: String) -> ActionResponse, CloseAppRequest);
phone_command!(open_url(url: String) -> ActionResponse, OpenUrlRequest);
phone_command!(set_volume(level: i32) -> ActionResponse, VolumeRequest);
phone_command!(read_clipboard() -> ActionResponse);
phone_command!(open_system_settings(target: String) -> ActionResponse, SystemSettingsRequest);
phone_command!(open_accessibility_settings() -> ActionResponse);
phone_command!(speak(text: String) -> ActionResponse, SpeakRequest);
phone_command!(stop_speaking() -> ActionResponse);
phone_command!(poll_speaking() -> crate::models::SpeakingStateResponse);
phone_command!(start_wake_word() -> ActionResponse);
phone_command!(stop_wake_word() -> ActionResponse);
phone_command!(poll_wake_word() -> crate::models::WakeStateResponse);
phone_command!(show_stop_overlay() -> ActionResponse);
phone_command!(hide_stop_overlay() -> ActionResponse);
phone_command!(poll_stop_overlay() -> crate::models::StopOverlayStateResponse);
phone_command!(request_overlay_permission() -> ActionResponse);
phone_command!(get_device_stats() -> DeviceStatsResponse);
phone_command!(capture_screenshot() -> crate::models::CaptureScreenshotResponse);
phone_command!(pick_folder() -> PickFolderResponse);
phone_command!(list_directory(uri: String, path: String) -> ListDirectoryResponse, FileOpRequest);
phone_command!(read_file(uri: String, path: String) -> ReadFileResponse, FileOpRequest);
phone_command!(clock_action(action: String, label: String, hour: i32, minute: i32, seconds: i32, days: String) -> ActionResponse, ClockActionRequest);
phone_command!(calendar_action(action: String, title: String, notes: String, start_millis: i64, end_millis: i64, event_id: i64) -> CalendarResponse, CalendarActionRequest);
phone_command!(task_finish(task_id: String, state: String, result: String, verification_receipt: String) -> ActionResponse, TaskFinishRequest);
phone_command!(task_cancel(task_id: String) -> ActionResponse, TaskIdRequest);
phone_command!(task_status(task_id: String) -> TaskStatusResponse, TaskIdRequest);
// The native operator's replies are open-ended JSON (step lines, a result object),
// passed through untouched rather than mirrored field-by-field here.
phone_command!(operator_start(task_id: String, goal: String, consent: bool, routes_json: String, stay_in_app: bool) -> serde_json::Value, OperatorStartRequest);
phone_command!(operator_status(task_id: String, since: i32) -> serde_json::Value, OperatorStatusRequest);
phone_command!(config_secret_set(name: String, value: String) -> ActionResponse, ConfigSecretSetRequest);
phone_command!(config_secret_get(name: String) -> ConfigSecretResponse, ConfigSecretNameRequest);
phone_command!(config_secret_delete(name: String) -> ActionResponse, ConfigSecretNameRequest);
phone_command!(identity_info() -> IdentityInfoResponse);
phone_command!(identity_sign_auth(host_id: String, nonce: String) -> IdentitySignedResponse, IdentityAuthRequest);
phone_command!(identity_sign_envelope(connection_nonce: String, message_type: String, task_id: String, payload_digest: String) -> IdentitySignedResponse, IdentityEnvelopeRequest);
phone_command!(identity_sign_pairing(host_id: String, challenge_id: String, connection_nonce: String, device_name: String) -> IdentitySignedResponse, IdentityPairingRequest);
phone_command!(identity_verify_host_challenge(public_key: String, expected_fingerprint: String, host_id: String, nonce: String, expires_at: i64, connection_id: String, signature: String) -> IdentityVerifyResponse, IdentityVerifyHostChallengeRequest);
phone_command!(identity_verify_host_envelope(public_key: String, expected_fingerprint: String, host_id: String, connection_nonce: String, counter: i64, message_type: String, task_id: String, payload_digest: String, signature: String) -> IdentityVerifyResponse, IdentityVerifyHostEnvelopeRequest);
