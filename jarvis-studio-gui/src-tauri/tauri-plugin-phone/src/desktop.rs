use serde::de::DeserializeOwned;
use tauri::{plugin::PluginApi, AppHandle, Runtime};

use crate::models::*;

/// Desktop has no AccessibilityService — phone control is Android-only. Every method
/// returns a truthful "unavailable" so the shared brain degrades gracefully.
pub fn init<R: Runtime, C: DeserializeOwned>(
    app: &AppHandle<R>,
    _api: PluginApi<R, C>,
) -> crate::Result<Phone<R>> {
    Ok(Phone(app.clone()))
}

pub struct Phone<R: Runtime>(#[allow(dead_code)] AppHandle<R>);

fn unavailable() -> ActionResponse {
    ActionResponse {
        ok: false,
        summary: "On-phone control is only available on Android.".into(),
        code: Some("not_on_device".into()),
        generation: None,
    }
}

/// Every action command is unreachable on desktop and returns the same
/// `unavailable()` ActionResponse regardless of its (ignored) payload — one
/// macro instead of repeating that stub by hand per command. The handful of
/// read-style commands with their own zero-value response type (is_enabled,
/// observe, the poll_* commands, get_device_stats, capture_screenshot,
/// pick_folder, list_directory, read_file) stay hand-written below since each
/// returns a genuinely different struct, not a repeat of this same one.
macro_rules! unavailable_command {
    ($name:ident ( $ty:ty )) => {
        pub fn $name(&self, _p: $ty) -> crate::Result<ActionResponse> {
            Ok(unavailable())
        }
    };
    ($name:ident ()) => {
        pub fn $name(&self) -> crate::Result<ActionResponse> {
            Ok(unavailable())
        }
    };
}

impl<R: Runtime> Phone<R> {
    pub fn is_enabled(&self) -> crate::Result<IsEnabledResponse> {
        Ok(IsEnabledResponse { enabled: false })
    }
    pub fn observe(&self) -> crate::Result<ObserveResponse> {
        Ok(ObserveResponse {
            app: String::new(),
            nodes: Vec::new(),
            ready: false,
            generation: 0,
            window_id: -1,
            observed_at_ms: 0,
        })
    }
    unavailable_command!(tap(TapRequest));
    unavailable_command!(tap_xy(TapXyRequest));
    unavailable_command!(long_press(TapRequest));
    unavailable_command!(double_tap(TapRequest));
    unavailable_command!(set_text(SetTextRequest));
    unavailable_command!(type_text(TypeTextRequest));
    unavailable_command!(scroll(ScrollRequest));
    unavailable_command!(back());
    unavailable_command!(home());
    unavailable_command!(swipe(SwipeRequest));
    unavailable_command!(open_app(OpenAppRequest));
    unavailable_command!(close_app(CloseAppRequest));
    unavailable_command!(open_url(OpenUrlRequest));
    unavailable_command!(set_volume(VolumeRequest));
    unavailable_command!(read_clipboard());
    unavailable_command!(open_system_settings(SystemSettingsRequest));
    unavailable_command!(open_accessibility_settings());
    unavailable_command!(speak(SpeakRequest));
    unavailable_command!(stop_speaking());
    pub fn poll_speaking(&self) -> crate::Result<crate::models::SpeakingStateResponse> {
        Ok(crate::models::SpeakingStateResponse { speaking: false })
    }
    unavailable_command!(start_wake_word());
    unavailable_command!(stop_wake_word());
    pub fn poll_wake_word(&self) -> crate::Result<crate::models::WakeStateResponse> {
        Ok(crate::models::WakeStateResponse { seq: 0, listening: false })
    }
    unavailable_command!(show_stop_overlay());
    unavailable_command!(hide_stop_overlay());
    pub fn poll_stop_overlay(&self) -> crate::Result<crate::models::StopOverlayStateResponse> {
        Ok(crate::models::StopOverlayStateResponse { seq: 0 })
    }
    unavailable_command!(request_overlay_permission());
    pub fn get_device_stats(&self) -> crate::Result<DeviceStatsResponse> {
        Ok(DeviceStatsResponse {
            cpu: 0,
            ram: 0,
            disk: 0,
            disk_used_gb: 0.0,
            disk_total_gb: 0.0,
            ram_total_gb: 0.0,
            battery_pct: None,
            charging: false,
            remaining: String::new(),
            temp: None,
        })
    }
    pub fn capture_screenshot(&self) -> crate::Result<crate::models::CaptureScreenshotResponse> {
        Ok(crate::models::CaptureScreenshotResponse {
            ok: false,
            base64: None,
            summary: Some("On-phone control is only available on Android.".into()),
        })
    }
    pub fn pick_folder(&self) -> crate::Result<PickFolderResponse> {
        Ok(PickFolderResponse {
            ok: false,
            summary: "On-phone control is only available on Android.".into(),
            uri: None,
            name: None,
        })
    }
    pub fn list_directory(&self, _p: FileOpRequest) -> crate::Result<ListDirectoryResponse> {
        Ok(ListDirectoryResponse {
            ok: false,
            summary: "On-phone control is only available on Android.".into(),
            entries: None,
        })
    }
    pub fn read_file(&self, _p: FileOpRequest) -> crate::Result<ReadFileResponse> {
        Ok(ReadFileResponse {
            ok: false,
            summary: "On-phone control is only available on Android.".into(),
            content: None,
        })
    }
    unavailable_command!(clock_action(ClockActionRequest));
    pub fn calendar_action(&self, _p: CalendarActionRequest) -> crate::Result<CalendarResponse> {
        Ok(CalendarResponse {
            ok: false,
            summary: "On-phone control is only available on Android.".into(),
            event_id: None,
        })
    }
    pub fn task_begin(&self, _p: TaskBeginRequest) -> crate::Result<TaskBeginResponse> {
        Ok(TaskBeginResponse {
            ok: false,
            summary: "On-phone control is only available on Android.".into(),
            task_id: String::new(),
            state: String::new(),
            event_seq: 0,
            created: false,
            idempotent: false,
            result: String::new(),
            cancel_requested: false,
            verified: false,
            verification_receipt: String::new(),
            verification_digest: String::new(),
            verified_at_ms: 0,
        })
    }
    unavailable_command!(task_checkpoint(TaskCheckpointRequest));
    unavailable_command!(task_finish(TaskFinishRequest));
    unavailable_command!(task_cancel(TaskIdRequest));
    pub fn operator_start(&self, _p: OperatorStartRequest) -> crate::Result<serde_json::Value> {
        Ok(serde_json::json!({ "ok": false, "summary": "On-phone control is only available on Android.", "error": "not_on_device" }))
    }
    pub fn operator_status(&self, _p: OperatorStatusRequest) -> crate::Result<serde_json::Value> {
        Ok(serde_json::json!({ "ok": false, "summary": "On-phone control is only available on Android." }))
    }
    pub fn task_status(&self, _p: TaskIdRequest) -> crate::Result<TaskStatusResponse> {
        Ok(TaskStatusResponse {
            ok: false,
            summary: "On-phone control is only available on Android.".into(),
            task_id: String::new(),
            state: String::new(),
            step: 0,
            receipt: String::new(),
            result: String::new(),
            event_seq: 0,
            idempotency_key: String::new(),
            source_device_id: String::new(),
            capability_profile_json: String::new(),
            retry_budget: 0,
            retry_count: 0,
            typed_plan_json: String::new(),
            last_verified_checkpoint: String::new(),
            cancel_requested: false,
            verified: false,
            verification_digest: String::new(),
            verified_at_ms: 0,
            updated_at_ms: 0,
            events: Vec::new(),
        })
    }
    unavailable_command!(config_secret_set(ConfigSecretSetRequest));
    pub fn config_secret_get(&self, _p: ConfigSecretNameRequest) -> crate::Result<ConfigSecretResponse> {
        Ok(ConfigSecretResponse {
            ok: false,
            present: false,
            value: None,
            summary: "Android Keystore credential storage is only available on Android.".into(),
        })
    }
    unavailable_command!(config_secret_delete(ConfigSecretNameRequest));
    pub fn identity_info(&self) -> crate::Result<IdentityInfoResponse> {
        Ok(IdentityInfoResponse {
            ok: false,
            device_id: String::new(),
            public_key: String::new(),
            fingerprint: String::new(),
            summary: "Android Keystore identity is only available on Android.".into(),
        })
    }
    pub fn identity_sign_auth(&self, _p: IdentityAuthRequest) -> crate::Result<IdentitySignedResponse> {
        Ok(identity_signed_unavailable())
    }
    pub fn identity_sign_envelope(&self, _p: IdentityEnvelopeRequest) -> crate::Result<IdentitySignedResponse> {
        Ok(identity_signed_unavailable())
    }
    pub fn identity_sign_pairing(&self, _p: IdentityPairingRequest) -> crate::Result<IdentitySignedResponse> {
        Ok(identity_signed_unavailable())
    }
    pub fn identity_verify_host_challenge(&self, _p: IdentityVerifyHostChallengeRequest) -> crate::Result<IdentityVerifyResponse> {
        Ok(identity_verify_unavailable())
    }
    pub fn identity_verify_host_envelope(&self, _p: IdentityVerifyHostEnvelopeRequest) -> crate::Result<IdentityVerifyResponse> {
        Ok(identity_verify_unavailable())
    }
}

fn identity_signed_unavailable() -> IdentitySignedResponse {
    IdentitySignedResponse {
        ok: false,
        device_id: String::new(),
        counter: 0,
        signature: String::new(),
        public_key: String::new(),
        fingerprint: String::new(),
        device_name: String::new(),
        summary: "Android Keystore identity is only available on Android.".into(),
    }
}

fn identity_verify_unavailable() -> IdentityVerifyResponse {
    IdentityVerifyResponse {
        ok: false,
        verified: false,
        summary: "Host verification is only available on Android.".into(),
    }
}
