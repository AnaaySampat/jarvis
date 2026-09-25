use serde::{Deserialize, Serialize};

/// On-screen bounds in device pixels.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Bounds {
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
}

/// One actionable element from the accessibility tree (matches the TS A11yNode).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NodeInfo {
    pub index: i32,
    pub text: String,
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub selector: String,
    #[serde(default, rename = "windowId")]
    pub window_id: i32,
    #[serde(default)]
    pub path: String,
    #[serde(default, rename = "collectionIndex")]
    pub collection_index: i32,
    pub role: String,
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub focused: bool,
    pub clickable: bool,
    pub editable: bool,
    pub scrollable: bool,
    #[serde(default)]
    pub checked: bool,
    #[serde(default)]
    pub selected: bool,
    #[serde(default)]
    pub password: bool,
    #[serde(default)]
    pub actions: Vec<i32>,
    pub bounds: Bounds,
}

/// A screen snapshot (matches the TS Observation).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ObserveResponse {
    pub app: String,
    pub nodes: Vec<NodeInfo>,
    pub ready: bool,
    #[serde(default)]
    pub generation: i64,
    #[serde(default, rename = "windowId")]
    pub window_id: i32,
    #[serde(default, rename = "observedAtMs")]
    pub observed_at_ms: i64,
}

/// The result of an action command (matches the TS ToolResult subset the bridge reads).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActionResponse {
    pub ok: bool,
    pub summary: String,
    #[serde(default)]
    pub code: Option<String>,
    #[serde(default)]
    pub generation: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IsEnabledResponse {
    pub enabled: bool,
}

/// Polled wake-word state. `seq` is a monotonic detection counter (JS reacts when it
/// grows); `listening` reports whether the engine is currently up so JS can restart it
/// if it died. Polling this over the reliable request/response path avoids the Tauri
/// event/Channel bridge, which drops callbacks on this device during startup reloads.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WakeStateResponse {
    #[serde(default)]
    pub seq: i32,
    #[serde(default)]
    pub listening: bool,
}

/// Polled TTS state so JS can hold "speaking" (and anything gated on it, like the
/// phone-control STOP banner) until the utterance actually finishes, instead of an
/// estimated duration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpeakingStateResponse {
    #[serde(default)]
    pub speaking: bool,
}

/// Polled tap count for the cross-app floating STOP overlay. `seq` is a monotonic
/// counter (JS reacts when it grows) — same pattern as [`WakeStateResponse`].
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StopOverlayStateResponse {
    #[serde(default)]
    pub seq: i32,
}

// ── Request payloads forwarded to the Kotlin plugin ──

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TapRequest {
    pub index: i32,
    #[serde(default, rename = "observationGeneration")]
    pub observation_generation: i64,
    #[serde(default)]
    pub selector: String,
    #[serde(default, rename = "expectedApp")]
    pub expected_app: String,
    #[serde(default, rename = "windowId")]
    pub window_id: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TapXyRequest {
    pub x: i32,
    pub y: i32,
    #[serde(default, rename = "observationGeneration")]
    pub observation_generation: i64,
    #[serde(default, rename = "expectedApp")]
    pub expected_app: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SetTextRequest {
    pub index: i32,
    pub text: String,
    #[serde(default, rename = "observationGeneration")]
    pub observation_generation: i64,
    #[serde(default)]
    pub selector: String,
    #[serde(default, rename = "expectedApp")]
    pub expected_app: String,
    #[serde(default, rename = "windowId")]
    pub window_id: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TypeTextRequest {
    pub text: String,
    pub index: i32,
    #[serde(default, rename = "observationGeneration")]
    pub observation_generation: i64,
    #[serde(default)]
    pub selector: String,
    #[serde(default, rename = "expectedApp")]
    pub expected_app: String,
    #[serde(default, rename = "windowId")]
    pub window_id: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScrollRequest {
    pub direction: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SwipeRequest {
    #[serde(rename = "startX")]
    pub start_x: i32,
    #[serde(rename = "startY")]
    pub start_y: i32,
    #[serde(rename = "endX")]
    pub end_x: i32,
    #[serde(rename = "endY")]
    pub end_y: i32,
    pub duration: i64,
    #[serde(default, rename = "observationGeneration")]
    pub observation_generation: i64,
    #[serde(default, rename = "expectedApp")]
    pub expected_app: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskBeginRequest {
    #[serde(rename = "taskId")]
    pub task_id: String,
    #[serde(default, rename = "idempotencyKey")]
    pub idempotency_key: String,
    pub goal: String,
    #[serde(rename = "deadlineAtMs")]
    pub deadline_at_ms: i64,
    pub risk: String,
    #[serde(default, rename = "sourceDeviceId")]
    pub source_device_id: String,
    #[serde(default, rename = "capabilityProfileJson")]
    pub capability_profile_json: String,
    #[serde(default = "default_retry_budget", rename = "retryBudget")]
    pub retry_budget: i32,
    #[serde(default, rename = "typedPlanJson")]
    pub typed_plan_json: String,
}

fn default_retry_budget() -> i32 {
    3
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskBeginResponse {
    pub ok: bool,
    pub summary: String,
    #[serde(default, rename = "taskId")]
    pub task_id: String,
    #[serde(default)]
    pub state: String,
    #[serde(default, rename = "eventSeq")]
    pub event_seq: i64,
    #[serde(default)]
    pub created: bool,
    #[serde(default)]
    pub idempotent: bool,
    #[serde(default)]
    pub result: String,
    #[serde(default, rename = "cancelRequested")]
    pub cancel_requested: bool,
    #[serde(default)]
    pub verified: bool,
    #[serde(default, rename = "verificationReceipt")]
    pub verification_receipt: String,
    #[serde(default, rename = "verificationDigest")]
    pub verification_digest: String,
    #[serde(default, rename = "verifiedAtMs")]
    pub verified_at_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskCheckpointRequest {
    #[serde(rename = "taskId")]
    pub task_id: String,
    pub state: String,
    pub step: i32,
    pub receipt: String,
    #[serde(default, rename = "verifiedCheckpoint")]
    pub verified_checkpoint: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskFinishRequest {
    #[serde(rename = "taskId")]
    pub task_id: String,
    pub state: String,
    pub result: String,
    #[serde(default, rename = "verificationReceipt")]
    pub verification_receipt: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskIdRequest {
    #[serde(rename = "taskId")]
    pub task_id: String,
}

/// Start the native phone operator on an already-begun journal task.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OperatorStartRequest {
    #[serde(rename = "taskId")]
    pub task_id: String,
    pub goal: String,
    #[serde(default)]
    pub consent: bool,
    /// Resolved model routes (url + auth headers + wire format); memory-only natively.
    #[serde(rename = "routesJson")]
    pub routes_json: String,
    /// Stay in the driven app on success instead of bringing JARVIS back.
    #[serde(rename = "stayInApp", default)]
    pub stay_in_app: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OperatorStatusRequest {
    #[serde(rename = "taskId")]
    pub task_id: String,
    #[serde(default)]
    pub since: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskEventResponse {
    #[serde(default, rename = "taskId")]
    pub task_id: String,
    #[serde(default)]
    pub seq: i64,
    #[serde(default, rename = "eventType")]
    pub event_type: String,
    #[serde(default)]
    pub state: String,
    #[serde(default)]
    pub step: i32,
    #[serde(default, rename = "checkpointJson")]
    pub checkpoint_json: String,
    #[serde(default, rename = "evidenceDigest")]
    pub evidence_digest: String,
    #[serde(default, rename = "createdAtMs")]
    pub created_at_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskStatusResponse {
    pub ok: bool,
    pub summary: String,
    #[serde(default, rename = "taskId")]
    pub task_id: String,
    #[serde(default)]
    pub state: String,
    #[serde(default)]
    pub step: i32,
    #[serde(default)]
    pub receipt: String,
    #[serde(default)]
    pub result: String,
    #[serde(default, rename = "eventSeq")]
    pub event_seq: i64,
    #[serde(default, rename = "idempotencyKey")]
    pub idempotency_key: String,
    #[serde(default, rename = "sourceDeviceId")]
    pub source_device_id: String,
    #[serde(default, rename = "capabilityProfileJson")]
    pub capability_profile_json: String,
    #[serde(default, rename = "retryBudget")]
    pub retry_budget: i32,
    #[serde(default, rename = "retryCount")]
    pub retry_count: i32,
    #[serde(default, rename = "typedPlanJson")]
    pub typed_plan_json: String,
    #[serde(default, rename = "lastVerifiedCheckpoint")]
    pub last_verified_checkpoint: String,
    #[serde(default, rename = "cancelRequested")]
    pub cancel_requested: bool,
    #[serde(default)]
    pub verified: bool,
    #[serde(default, rename = "verificationDigest")]
    pub verification_digest: String,
    #[serde(default, rename = "verifiedAtMs")]
    pub verified_at_ms: i64,
    #[serde(default, rename = "updatedAtMs")]
    pub updated_at_ms: i64,
    #[serde(default)]
    pub events: Vec<TaskEventResponse>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfigSecretNameRequest {
    pub name: String,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct ConfigSecretSetRequest {
    pub name: String,
    pub value: String,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct ConfigSecretResponse {
    #[serde(default)]
    pub ok: bool,
    #[serde(default)]
    pub present: bool,
    #[serde(default)]
    pub value: Option<String>,
    #[serde(default)]
    pub summary: String,
}

// ── Android Keystore-backed remote PC identity ──

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IdentityInfoResponse {
    #[serde(default)]
    pub ok: bool,
    #[serde(default, rename = "deviceId")]
    pub device_id: String,
    #[serde(default, rename = "publicKey")]
    pub public_key: String,
    #[serde(default)]
    pub fingerprint: String,
    #[serde(default)]
    pub summary: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IdentitySignedResponse {
    #[serde(default)]
    pub ok: bool,
    #[serde(default, rename = "deviceId")]
    pub device_id: String,
    #[serde(default)]
    pub counter: i64,
    #[serde(default)]
    pub signature: String,
    #[serde(default, rename = "publicKey")]
    pub public_key: String,
    #[serde(default)]
    pub fingerprint: String,
    #[serde(default, rename = "deviceName")]
    pub device_name: String,
    #[serde(default)]
    pub summary: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IdentityVerifyResponse {
    #[serde(default)]
    pub ok: bool,
    #[serde(default)]
    pub verified: bool,
    #[serde(default)]
    pub summary: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IdentityAuthRequest {
    #[serde(rename = "hostId")]
    pub host_id: String,
    pub nonce: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IdentityEnvelopeRequest {
    #[serde(rename = "connectionNonce")]
    pub connection_nonce: String,
    #[serde(rename = "messageType")]
    pub message_type: String,
    #[serde(rename = "taskId")]
    pub task_id: String,
    #[serde(rename = "payloadDigest")]
    pub payload_digest: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IdentityPairingRequest {
    #[serde(rename = "hostId")]
    pub host_id: String,
    #[serde(rename = "challengeId")]
    pub challenge_id: String,
    #[serde(rename = "connectionNonce")]
    pub connection_nonce: String,
    #[serde(rename = "deviceName")]
    pub device_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IdentityVerifyHostChallengeRequest {
    #[serde(rename = "publicKey")]
    pub public_key: String,
    #[serde(rename = "expectedFingerprint")]
    pub expected_fingerprint: String,
    #[serde(rename = "hostId")]
    pub host_id: String,
    pub nonce: String,
    #[serde(rename = "expiresAt")]
    pub expires_at: i64,
    #[serde(rename = "connectionId")]
    pub connection_id: String,
    pub signature: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IdentityVerifyHostEnvelopeRequest {
    #[serde(rename = "publicKey")]
    pub public_key: String,
    #[serde(rename = "expectedFingerprint")]
    pub expected_fingerprint: String,
    #[serde(rename = "hostId")]
    pub host_id: String,
    #[serde(rename = "connectionNonce")]
    pub connection_nonce: String,
    pub counter: i64,
    #[serde(rename = "messageType")]
    pub message_type: String,
    #[serde(rename = "taskId")]
    pub task_id: String,
    #[serde(rename = "payloadDigest")]
    pub payload_digest: String,
    pub signature: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpenAppRequest {
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CloseAppRequest {
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpenUrlRequest {
    pub url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VolumeRequest {
    pub level: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemSettingsRequest {
    pub target: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpeakRequest {
    pub text: String,
}

/// Live HUD telemetry from the native Android layer.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceStatsResponse {
    #[serde(default)]
    pub cpu: i32,
    #[serde(default)]
    pub ram: i32,
    #[serde(default)]
    pub disk: i32,
    #[serde(default, rename = "diskUsedGb")]
    pub disk_used_gb: f64,
    #[serde(default, rename = "diskTotalGb")]
    pub disk_total_gb: f64,
    #[serde(default, rename = "ramTotalGb")]
    pub ram_total_gb: f64,
    #[serde(default, rename = "batteryPct")]
    pub battery_pct: Option<i32>,
    #[serde(default)]
    pub charging: bool,
    #[serde(default)]
    pub remaining: String,
    #[serde(default)]
    pub temp: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CaptureScreenshotResponse {
    pub ok: bool,
    #[serde(default)]
    pub base64: Option<String>,
    #[serde(default)]
    pub summary: Option<String>,
}

// ── Read-only file access (Storage Access Framework) ──

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileOpRequest {
    pub uri: String,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PickFolderResponse {
    pub ok: bool,
    pub summary: String,
    #[serde(default)]
    pub uri: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileEntry {
    pub name: String,
    #[serde(rename = "isDir")]
    pub is_dir: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ListDirectoryResponse {
    pub ok: bool,
    pub summary: String,
    #[serde(default)]
    pub entries: Option<Vec<FileEntry>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReadFileResponse {
    pub ok: bool,
    pub summary: String,
    #[serde(default)]
    pub content: Option<String>,
}

// ── Clock: alarms and timers in the user's real Clock app ──
// Goes to android.provider.AlarmClock, not an in-app AlarmManager alarm — see
// PhonePlugin.clockAction for why.

// ── Calendar: agenda items in the user's real calendar ──
// CalendarContract when permission allows, else an ACTION_INSERT picker — see
// PhonePlugin.calendarAction.

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CalendarActionRequest {
    /// add | remove | show
    pub action: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub notes: String,
    #[serde(rename = "startMillis", default)]
    pub start_millis: i64,
    #[serde(rename = "endMillis", default)]
    pub end_millis: i64,
    /// Event id from a previous `add`, for `remove`.
    #[serde(rename = "eventId", default)]
    pub event_id: i64,
}

/// Like ActionResponse, plus the id of a newly created event so the agenda can
/// delete the real thing later instead of orphaning it.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CalendarResponse {
    pub ok: bool,
    pub summary: String,
    #[serde(rename = "eventId", default)]
    pub event_id: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClockActionRequest {
    /// alarm | timer | show_alarms | show_timers | dismiss_timer
    pub action: String,
    #[serde(default)]
    pub label: String,
    /// Hour of day 0-23 for an alarm; -1 when not applicable.
    #[serde(default)]
    pub hour: i32,
    #[serde(default)]
    pub minute: i32,
    /// Timer length in seconds.
    #[serde(default)]
    pub seconds: i32,
    /// "daily", "weekdays", "weekends", or "mon,wed,fri".
    #[serde(default)]
    pub days: String,
}
