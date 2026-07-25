use tauri::Manager;
#[cfg(desktop)]
use tauri::menu::{Menu, MenuItem};
#[cfg(desktop)]
use tauri::tray::TrayIconBuilder;
use once_cell::sync::Lazy;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::Duration;
mod platform;
mod sync;
mod workflows;

/// Cached notification access status so we don't re-poll it on every get_notifications() call.
static NOTIFICATION_ACCESS_GRANTED: AtomicBool = AtomicBool::new(false);

// Windows-only imports (Android builds must not compile Win32 code)
#[cfg(target_os = "windows")]
use windows::Win32::UI::WindowsAndMessaging::{
    AllowSetForegroundWindow, GetForegroundWindow, GetWindowRect, GetWindowLongPtrW, GWL_STYLE, WS_POPUP, WS_CAPTION,
};
#[cfg(target_os = "windows")]
use windows::Win32::UI::WindowsAndMessaging::{ASFW_ANY, SW_SHOWNORMAL};
#[cfg(target_os = "windows")]
use windows::Media::Control::{
    GlobalSystemMediaTransportControlsSessionManager,
    GlobalSystemMediaTransportControlsSession,
    GlobalSystemMediaTransportControlsSessionPlaybackStatus,
    GlobalSystemMediaTransportControlsSessionMediaProperties,
};
#[cfg(target_os = "windows")]
use windows::Media::MediaPlaybackAutoRepeatMode;
#[cfg(target_os = "windows")]
use windows::Foundation::AsyncStatus;
#[cfg(target_os = "windows")]
use windows::Win32::Media::Audio::{
    eRender, eConsole, eMultimedia,
    Endpoints::IAudioEndpointVolume,
    IMMDeviceEnumerator, IMMDevice, IMMDeviceCollection, MMDeviceEnumerator,
    IAudioSessionManager2, IAudioSessionEnumerator, IAudioSessionControl, IAudioSessionControl2,
    ISimpleAudioVolume, AudioSessionState,
    DEVICE_STATE_ACTIVE,
};
#[cfg(target_os = "windows")]
use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CoTaskMemFree, CLSCTX_ALL, COINIT_MULTITHREADED, STGM_READ};
#[cfg(target_os = "windows")]
use windows::Win32::System::Com::StructuredStorage::PropVariantToStringAlloc;
#[cfg(target_os = "windows")]
use windows::Win32::UI::Shell::PropertiesSystem::IPropertyStore;
#[cfg(target_os = "windows")]
use windows::Win32::UI::Shell::ShellExecuteW;
#[cfg(target_os = "windows")]
use windows::Win32::Devices::FunctionDiscovery::PKEY_Device_FriendlyName;
#[cfg(target_os = "windows")]
use windows::Win32::Devices::Display::{
    GetNumberOfPhysicalMonitorsFromHMONITOR, GetPhysicalMonitorsFromHMONITOR,
    GetMonitorBrightness, SetMonitorBrightness, DestroyPhysicalMonitor,
    PHYSICAL_MONITOR,
};
#[cfg(target_os = "windows")]
use windows::Win32::Graphics::Gdi::{MonitorFromWindow, MONITOR_DEFAULTTOPRIMARY};
#[cfg(target_os = "windows")]
use windows::core::{HSTRING, Interface};
#[cfg(target_os = "windows")]
use windows::Foundation::TypedEventHandler;
#[cfg(target_os = "windows")]
use windows::Storage::Streams::{DataReader, InputStreamOptions};
#[cfg(target_os = "windows")]
use windows::UI::Notifications::Management::{UserNotificationListener, UserNotificationListenerAccessStatus};
#[cfg(target_os = "windows")]
use windows::UI::Notifications::{UserNotification, UserNotificationChangedEventArgs, UserNotificationChangedKind};

#[cfg(target_os = "windows")]
use brightness::blocking::Brightness;


// =============================================================================
// Media Session Types
// =============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MediaInfo {
    pub title: String,
    pub artist: String,
    pub album: Option<String>,
    pub is_playing: bool,
    pub app_name: Option<String>,
}

// =============================================================================
// Volume Types
// =============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VolumeInfo {
    pub level: u32,      // 0-100
    pub is_muted: bool,
}

// =============================================================================
// Audio Device Types
// =============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioDevice {
    pub id: String,
    pub name: String,
    pub is_default: bool,
}

// =============================================================================
// Audio Session Types (Per-App Volume)
// =============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioSession {
    pub session_id: String,      // Unique session identifier
    pub app_name: String,        // Display name of the app
    pub process_id: u32,         // Windows process ID
    pub volume: f32,             // 0.0 - 1.0
    pub is_muted: bool,
    pub is_active: bool,         // Whether session is currently playing audio
}

// =============================================================================
// Notification Types
// =============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemNotification {
    pub id: u32,
    pub app_name: String,
    pub title: String,
    pub body: String,
    pub timestamp: u64,          // Unix timestamp in milliseconds
    pub aumid: Option<String>,   // App User Model ID for activation after Windows dismissal
}

// =============================================================================
// Battery Types
// =============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BatteryInfo {
    pub percent: u32,           // 0-100
    pub is_charging: bool,      // actively drawing charge
    #[serde(default)]
    pub is_plugged_in: bool,    // AC cord connected (may be true while not charging: full, or conservation mode)
    pub is_battery_saver: bool,
    pub has_battery: bool,      // false on desktops without a battery
}

// =============================================================================
// Settings Persistence Types
// =============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppearanceSettingsData {
    #[serde(default = "default_mode")]
    pub mode: String,
    #[serde(default = "default_opacity")]
    pub opacity: u32,
    #[serde(default = "default_accent_color")]
    pub accent_color: String,
    #[serde(default = "default_true")]
    pub use_album_accent: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MotionSettingsData {
    #[serde(default = "default_animation_speed")]
    pub animation_speed: f64,
    #[serde(default = "default_reduced_motion")]
    pub reduced_motion_override: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BehaviorSettingsData {
    #[serde(default)]
    pub launch_at_startup: bool,
    #[serde(default)]
    pub pause_other_sessions: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimerSettingsData {
    #[serde(default)]
    pub last_custom_label: String,
    #[serde(default = "default_custom_minutes")]
    pub last_custom_minutes: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LayoutVisibleTabsData {
    #[serde(default = "default_true")]
    pub timer: bool,
    #[serde(default = "default_true")]
    pub media: bool,
    #[serde(default = "default_true")]
    pub notifications: bool,
    #[serde(default = "default_true")]
    pub settings: bool,
    #[serde(default = "default_true")]
    pub clipboard: bool,
    #[serde(default = "default_true")]
    pub shelf: bool,
    #[serde(default = "default_true")]
    pub lyrics: bool,
    #[serde(default = "default_true")]
    pub prism: bool,
    #[serde(default = "default_true")]
    pub productivity: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LayoutIdleIndicatorsData {
    #[serde(default = "default_true")]
    pub media: bool,
    #[serde(default = "default_true")]
    pub battery: bool,
    #[serde(default = "default_true")]
    pub notifications: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LayoutSettingsData {
    #[serde(default)]
    pub visible_tabs: LayoutVisibleTabsData,
    #[serde(default)]
    pub idle_indicators: LayoutIdleIndicatorsData,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSettings {
    #[serde(default)]
    pub appearance: AppearanceSettingsData,
    #[serde(default)]
    pub motion: MotionSettingsData,
    #[serde(default)]
    pub behavior: BehaviorSettingsData,
    #[serde(default)]
    pub timer: TimerSettingsData,
    #[serde(default)]
    pub layout: LayoutSettingsData,
}

fn default_mode() -> String { "island".to_string() }
fn default_opacity() -> u32 { 94 }
fn default_accent_color() -> String { "#EB0028".to_string() }
fn default_animation_speed() -> f64 { 1.0 }
fn default_reduced_motion() -> String { "system".to_string() }
fn default_custom_minutes() -> u32 { 25 }
fn default_true() -> bool { true }

impl Default for AppearanceSettingsData {
    fn default() -> Self {
        Self { mode: default_mode(), opacity: default_opacity(), accent_color: default_accent_color(), use_album_accent: true }
    }
}
impl Default for MotionSettingsData {
    fn default() -> Self {
        Self { animation_speed: default_animation_speed(), reduced_motion_override: default_reduced_motion() }
    }
}
impl Default for BehaviorSettingsData {
    fn default() -> Self {
        Self { launch_at_startup: false, pause_other_sessions: false }
    }
}
impl Default for TimerSettingsData {
    fn default() -> Self {
        Self { last_custom_label: String::new(), last_custom_minutes: default_custom_minutes() }
    }
}
impl Default for LayoutVisibleTabsData {
    fn default() -> Self {
        Self {
            timer: true,
            media: true,
            notifications: true,
            settings: true,
            clipboard: true,
            shelf: true,
            lyrics: true,
            prism: true,
            productivity: true,
        }
    }
}
impl Default for LayoutIdleIndicatorsData {
    fn default() -> Self {
        Self { media: true, battery: true, notifications: true }
    }
}
impl Default for LayoutSettingsData {
    fn default() -> Self {
        Self {
            visible_tabs: LayoutVisibleTabsData::default(),
            idle_indicators: LayoutIdleIndicatorsData::default(),
        }
    }
}
impl Default for AppSettings {
    fn default() -> Self {
        Self {
            appearance: AppearanceSettingsData::default(),
            motion: MotionSettingsData::default(),
            behavior: BehaviorSettingsData::default(),
            timer: TimerSettingsData::default(),
            layout: LayoutSettingsData::default(),
        }
    }
}

fn settings_path() -> std::path::PathBuf {
    let app_data = std::env::var("APPDATA").unwrap_or_else(|_| ".".to_string());
    std::path::Path::new(&app_data).join("WINDEYE").join("settings.json")
}

#[tauri::command]
fn load_settings() -> Result<AppSettings, String> {
    let path = settings_path();
    if !path.exists() {
        return Ok(AppSettings::default());
    }
    let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let settings: AppSettings = serde_json::from_str(&content).unwrap_or_default();
    Ok(settings)
}

#[tauri::command]
fn save_settings(settings: AppSettings) -> Result<(), String> {
    let path = settings_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| e.to_string())?;
    Ok(())
}

// =============================================================================
// Accent Color Extraction Types
// =============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccentColorResult {
    pub r: u8,
    pub g: u8,
    pub b: u8,
}

// =============================================================================
// Media Timeline & Playback Info Types
// =============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MediaTimeline {
    pub position_ms: u64,
    pub duration_ms: u64,
    pub can_seek: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MediaPlaybackInfo {
    pub repeat_mode: String,
    pub is_shuffle: bool,
}

// =============================================================================
// Prism AI Types
// =============================================================================

static HTTP_CLIENT: Lazy<Client> = Lazy::new(|| {
    Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .expect("failed to build HTTP client")
});

const PRISM_MODEL: &str = "openai/gpt-oss-20b";
const PRISM_MAX_TOKENS: u32 = 320;
const PRISM_TEMPERATURE: f32 = 0.2;
const MAX_MESSAGE_CHARS: usize = 800;
const MAX_CONTEXT_BLOCKS: usize = 8;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrismChatRequest {
    pub user_message: String,
    pub conversation: Vec<PrismConversationMessage>,
    pub context_blocks: Vec<PrismContextBlock>,
    pub allow_actions: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct PrismConversationMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct PrismContextBlock {
    pub kind: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrismAction {
    #[serde(default)]
    pub id: Option<String>,
    #[serde(rename = "type")]
    pub action_type: String,
    #[serde(default)]
    pub label: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub args: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrismUsage {
    pub prompt_tokens: u32,
    pub completion_tokens: u32,
    pub total_tokens: u32,
}

#[derive(Debug, Serialize)]
pub struct PrismChatResponse {
    pub reply: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub actions: Option<Vec<PrismAction>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub usage: Option<PrismUsage>,
}

#[derive(Debug, Serialize)]
struct GroqChatRequest {
    model: &'static str,
    messages: Vec<GroqChatMessage>,
    temperature: f32,
    max_tokens: u32,
}

#[derive(Debug, Serialize)]
struct GroqChatMessage {
    role: String,
    content: String,
}

#[derive(Debug, Deserialize)]
struct GroqChatResponse {
    choices: Vec<GroqChoice>,
    #[serde(default)]
    usage: Option<GroqUsage>,
}

#[derive(Debug, Deserialize)]
struct GroqChoice {
    message: GroqChoiceMessage,
}

#[derive(Debug, Deserialize)]
struct GroqChoiceMessage {
    content: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GroqUsage {
    #[serde(default)]
    prompt_tokens: u32,
    #[serde(default)]
    completion_tokens: u32,
    #[serde(default)]
    total_tokens: u32,
}

#[derive(Debug, Deserialize)]
struct PrismModelOutput {
    reply: String,
    #[serde(default)]
    actions: Option<Vec<PrismAction>>,
}

fn truncate_chars(value: &str, max_chars: usize) -> String {
    value.chars().take(max_chars).collect()
}

fn normalize_role(role: &str) -> &str {
    let lower = role.trim().to_lowercase();
    if lower == "assistant" {
        "assistant"
    } else {
        "user"
    }
}

fn extract_json_candidate(text: &str) -> Option<String> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return None;
    }

    if serde_json::from_str::<PrismModelOutput>(trimmed).is_ok() {
        return Some(trimmed.to_string());
    }

    let start = trimmed.find('{')?;
    let end = trimmed.rfind('}')?;
    if end <= start {
        return None;
    }
    Some(trimmed[start..=end].to_string())
}

fn is_supported_action_type(action_type: &str) -> bool {
    matches!(
        action_type,
        "start_timer"
            | "pause_timer"
            | "resume_timer"
            | "stop_timer"
            | "set_volume"
            | "toggle_mute"
            | "set_brightness"
            | "media_play_pause"
            | "media_next"
            | "media_previous"
    )
}

fn parse_model_output(raw_content: &str, allow_actions: bool) -> (String, Option<Vec<PrismAction>>) {
    let fallback = raw_content.trim();
    let Some(candidate) = extract_json_candidate(fallback) else {
        return (fallback.to_string(), None);
    };

    let parsed = serde_json::from_str::<PrismModelOutput>(&candidate);
    let Ok(parsed_output) = parsed else {
        return (fallback.to_string(), None);
    };

    let reply = if parsed_output.reply.trim().is_empty() {
        fallback.to_string()
    } else {
        parsed_output.reply.trim().to_string()
    };

    if !allow_actions {
        return (reply, None);
    }

    let actions = parsed_output.actions.map(|items| {
        items
            .into_iter()
            .filter_map(|mut action| {
                if !is_supported_action_type(&action.action_type) {
                    return None;
                }
                if let Some(args) = &action.args {
                    if !args.is_object() {
                        action.args = None;
                    }
                }
                Some(action)
            })
            .take(5)
            .collect::<Vec<_>>()
    });

    (reply, actions.filter(|items| !items.is_empty()))
}

#[tauri::command]
async fn prism_chat(request: PrismChatRequest) -> Result<PrismChatResponse, String> {
    // Runtime env var first (for dev). Then compile-time if set at build (for .exe). No key in source.
    let api_key: String = std::env::var("GROQ_API_KEY")
        .ok()
        .or_else(|| option_env!("GROQ_API_KEY").map(String::from))
        .ok_or_else(|| "GROQ_API_KEY is not set. Set it before building or running WINDEYE.".to_string())?;

    let user_message = truncate_chars(request.user_message.trim(), MAX_MESSAGE_CHARS);
    if user_message.is_empty() {
        return Err("userMessage cannot be empty.".to_string());
    }

    let mut messages: Vec<GroqChatMessage> = Vec::new();

    let system_prompt = if request.allow_actions {
        "You are Prism AI for the WINDEYE desktop app. Use concise, actionable responses. You receive selective app context blocks. Return strict JSON with keys: reply (string), actions (array, optional). Allowed action types: start_timer, pause_timer, resume_timer, stop_timer, set_volume, toggle_mute, set_brightness, media_play_pause, media_next, media_previous. Every action may include: id, label, description, args (object). Never include unsupported action types."
    } else {
        "You are Prism AI for the WINDEYE desktop app. Use concise, actionable responses. You receive selective app context blocks. Return strict JSON with key: reply (string). Do not include actions."
    };
    messages.push(GroqChatMessage {
        role: "system".to_string(),
        content: system_prompt.to_string(),
    });

    let context_summary = request
        .context_blocks
        .into_iter()
        .take(MAX_CONTEXT_BLOCKS)
        .map(|block| {
            let kind = truncate_chars(block.kind.trim(), 32);
            let content = truncate_chars(block.content.trim(), 400);
            format!("{kind}: {content}")
        })
        .collect::<Vec<_>>()
        .join("\n");

    if !context_summary.trim().is_empty() {
        messages.push(GroqChatMessage {
            role: "user".to_string(),
            content: format!("WINDEYE_CONTEXT\n{}", context_summary),
        });
    }

    for item in request.conversation.into_iter().take(12) {
        let content = truncate_chars(item.content.trim(), MAX_MESSAGE_CHARS);
        if content.is_empty() {
            continue;
        }
        messages.push(GroqChatMessage {
            role: normalize_role(&item.role).to_string(),
            content,
        });
    }

    messages.push(GroqChatMessage {
        role: "user".to_string(),
        content: user_message,
    });

    let payload = GroqChatRequest {
        model: PRISM_MODEL,
        messages,
        temperature: PRISM_TEMPERATURE,
        max_tokens: PRISM_MAX_TOKENS,
    };

    let response = HTTP_CLIENT
        .post("https://api.groq.com/openai/v1/chat/completions")
        .bearer_auth(api_key)
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("Failed to call Groq API: {e}"))?;

    if !response.status().is_success() {
        let status = response.status().as_u16();
        let body = response.text().await.unwrap_or_default();
        return Err(format!(
            "Groq API error ({status}): {}",
            truncate_chars(&body, 260)
        ));
    }

    let response_payload = response
        .json::<GroqChatResponse>()
        .await
        .map_err(|e| format!("Invalid Groq response payload: {e}"))?;

    let raw_reply = response_payload
        .choices
        .first()
        .and_then(|choice| choice.message.content.clone())
        .unwrap_or_default();

    let (reply, actions) = parse_model_output(&raw_reply, request.allow_actions);
    if reply.trim().is_empty() {
        return Err("Model returned an empty reply.".to_string());
    }

    let usage = response_payload.usage.map(|value| PrismUsage {
        prompt_tokens: value.prompt_tokens,
        completion_tokens: value.completion_tokens,
        total_tokens: value.total_tokens,
    });

    Ok(PrismChatResponse { reply, actions, usage })
}

// =============================================================================
// Async Helpers - Poll Windows IAsyncOperation until complete
// =============================================================================

/// Max iterations for polling Windows async operations.
/// 30 iterations * 5ms = 150ms max block per operation (down from 100 * 10ms = 1s).
const POLL_MAX_ITERS: usize = 30;
const POLL_SLEEP_MS: u64 = 5;

#[cfg(target_os = "windows")]
fn poll_session_manager() -> Result<GlobalSystemMediaTransportControlsSessionManager, String> {
    let op = GlobalSystemMediaTransportControlsSessionManager::RequestAsync()
        .map_err(|e| format!("Failed to request session manager: {}", e))?;

    for _ in 0..POLL_MAX_ITERS {
        let status = op.Status().map_err(|e| format!("Failed to get status: {}", e))?;
        if status == AsyncStatus::Completed {
            return op.GetResults().map_err(|e| format!("Failed to get results: {}", e));
        }
        if status == AsyncStatus::Error {
            return Err("Async operation failed".to_string());
        }
        thread::sleep(Duration::from_millis(POLL_SLEEP_MS));
    }
    Err("Timeout waiting for session manager".to_string())
}

#[cfg(target_os = "windows")]
fn poll_media_properties(session: &GlobalSystemMediaTransportControlsSession)
    -> Result<GlobalSystemMediaTransportControlsSessionMediaProperties, String>
{
    let op = session.TryGetMediaPropertiesAsync()
        .map_err(|e| format!("Failed to request media properties: {}", e))?;

    for _ in 0..POLL_MAX_ITERS {
        let status = op.Status().map_err(|e| format!("Failed to get status: {}", e))?;
        if status == AsyncStatus::Completed {
            return op.GetResults().map_err(|e| format!("Failed to get results: {}", e));
        }
        if status == AsyncStatus::Error {
            return Err("Async operation failed".to_string());
        }
        thread::sleep(Duration::from_millis(POLL_SLEEP_MS));
    }
    Err("Timeout waiting for media properties".to_string())
}

#[cfg(target_os = "windows")]
fn poll_bool_op(op: windows::Foundation::IAsyncOperation<bool>) -> Result<bool, String> {
    for _ in 0..POLL_MAX_ITERS {
        let status = op.Status().map_err(|e| format!("Failed to get status: {}", e))?;
        if status == AsyncStatus::Completed {
            return op.GetResults().map_err(|e| format!("Failed to get results: {}", e));
        }
        if status == AsyncStatus::Error {
            return Err("Async operation failed".to_string());
        }
        thread::sleep(Duration::from_millis(POLL_SLEEP_MS));
    }
    Err("Timeout waiting for operation".to_string())
}

/// Set click-through mode for the window
/// When enabled, mouse events pass through the window to apps behind it
#[cfg(desktop)]
#[tauri::command]
fn set_click_through(window: tauri::Window, ignore: bool) -> Result<(), String> {
    window
        .set_ignore_cursor_events(ignore)
        .map_err(|e| format!("Failed to set click-through: {}", e))
}

#[cfg(not(desktop))]
#[tauri::command]
fn set_click_through(_window: tauri::Window, _ignore: bool) -> Result<(), String> {
    Err("Click-through not supported on mobile".to_string())
}

/// Resize window to specified dimensions
#[cfg(desktop)]
#[tauri::command]
fn resize_window(window: tauri::Window, width: f64, height: f64) -> Result<(), String> {
    if width <= 0.0 || height <= 0.0 {
        return Err("Invalid dimensions".to_string());
    }
    window
        .set_size(tauri::Size::Logical(tauri::LogicalSize { width, height }))
        .map_err(|e| format!("Failed to resize: {}", e))
}

#[cfg(not(desktop))]
#[tauri::command]
fn resize_window(_window: tauri::Window, _width: f64, _height: f64) -> Result<(), String> {
    Err("Window resize not supported on mobile".to_string())
}

/// Position window at top-center of primary monitor
#[cfg(desktop)]
#[tauri::command]
fn position_window(window: tauri::Window) -> Result<(), String> {
    let monitor = window
        .primary_monitor()
        .map_err(|e| format!("Failed to get monitor: {}", e))?
        .ok_or_else(|| "No primary monitor found".to_string())?;
    
    let monitor_size = monitor.size();
    let scale_factor = monitor.scale_factor();
    let window_size = window
        .outer_size()
        .map_err(|e| format!("Failed to get window size: {}", e))?;
    
    let w = window_size.width as f64 / scale_factor;
    let x = (monitor_size.width as f64 / scale_factor) / 2.0 - w / 2.0;
    
    window
        .set_position(tauri::Position::Logical(tauri::LogicalPosition { x, y: 0.0 }))
        .map_err(|e| format!("Failed to position: {}", e))
}

#[cfg(not(desktop))]
#[tauri::command]
fn position_window(_window: tauri::Window) -> Result<(), String> {
    Err("Window positioning not supported on mobile".to_string())
}

/// Check if the foreground window is "content" fullscreen (video/game), not just window fullscreen.
/// We want: YouTube/Netflix video fullscreen, games → true.
/// We don't want: browser F11 fullscreen, any app maximized/fullscreen → false.
/// Uses window style: WS_POPUP or borderless (no caption) = content fullscreen; normal caption = window fullscreen.
#[cfg(target_os = "windows")]
#[tauri::command]
fn is_foreground_fullscreen(window: tauri::Window) -> Result<bool, String> {
    // Get monitor info, return false if unavailable (safe default)
    let monitor = match window.primary_monitor() {
        Ok(Some(m)) => m,
        _ => return Ok(false),
    };

    let mon_size = monitor.size();
    let mon_w = mon_size.width as i32;
    let mon_h = mon_size.height as i32;

    // Get foreground window handle
    let hwnd = unsafe { GetForegroundWindow() };
    if hwnd.0.is_null() {
        return Ok(false);
    }

    // Get window rectangle
    let mut rect = windows::Win32::Foundation::RECT::default();
    if unsafe { GetWindowRect(hwnd, &mut rect) }.is_err() {
        return Ok(false);
    }

    let w = rect.right - rect.left;
    let h = rect.bottom - rect.top;

    // Must cover 90%+ of monitor to be considered fullscreen at all
    let threshold_w = (mon_w * 90) / 100;
    let threshold_h = (mon_h * 90) / 100;
    if w < threshold_w || h < threshold_h {
        return Ok(false);
    }

    // Distinguish content fullscreen (video/game) from window fullscreen (browser F11, app maximized).
    // Content fullscreen: WS_POPUP (games, many video players) or borderless (no WS_CAPTION).
    // Window fullscreen: normal window with caption (browser F11, VS Code fullscreen, etc.).
    let style = unsafe { GetWindowLongPtrW(hwnd, GWL_STYLE) };
    if style == 0 {
        return Ok(false);
    }
    let style = style as u32;

    let is_popup = (style & WS_POPUP.0) != 0;
    let has_caption = (style & WS_CAPTION.0) != 0;

    // Content fullscreen: popup style (common for games/video) or borderless (no title bar)
    let content_fullscreen = is_popup || !has_caption;
    Ok(content_fullscreen)
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn is_foreground_fullscreen(_window: tauri::Window) -> Result<bool, String> {
    Ok(false)
}

/// Foreground-app context for Prism. Carries ONLY the active window's title and
/// executable name — no screenshots, no content scraping, nothing persisted.
#[derive(serde::Serialize, Default)]
struct ForegroundApp {
    title: String,
    #[serde(rename = "processName")]
    process_name: String,
    available: bool,
}

/// Returns the foreground window's title + exe name so Prism can be context-aware
/// ("knows what you're working on") privately. Skips our own overlay implicitly —
/// the pill is a no-activate window, so it rarely becomes foreground.
#[cfg(target_os = "windows")]
#[tauri::command]
fn get_foreground_app() -> ForegroundApp {
    use windows::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, GetWindowTextLengthW, GetWindowTextW, GetWindowThreadProcessId,
    };
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
        PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows::Win32::Foundation::CloseHandle;
    use windows::core::PWSTR;

    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.0.is_null() {
            return ForegroundApp::default();
        }

        // Window title (truncated below for privacy/size).
        let len = GetWindowTextLengthW(hwnd);
        let mut title = String::new();
        if len > 0 {
            let mut buf = vec![0u16; (len + 1) as usize];
            let copied = GetWindowTextW(hwnd, &mut buf);
            if copied > 0 {
                title = String::from_utf16_lossy(&buf[..copied as usize]);
            }
        }

        // Executable name (basename) from the owning process.
        let mut pid: u32 = 0;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        let mut process_name = String::new();
        if pid != 0 {
            if let Ok(handle) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) {
                if !handle.is_invalid() {
                    let mut buf = vec![0u16; 260];
                    let mut size = buf.len() as u32;
                    if QueryFullProcessImageNameW(
                        handle,
                        PROCESS_NAME_WIN32,
                        PWSTR(buf.as_mut_ptr()),
                        &mut size,
                    )
                    .is_ok()
                        && size > 0
                    {
                        let full = String::from_utf16_lossy(&buf[..size as usize]);
                        process_name = full
                            .rsplit(|c| c == '\\' || c == '/')
                            .next()
                            .unwrap_or(&full)
                            .to_string();
                    }
                    let _ = CloseHandle(handle);
                }
            }
        }

        let title: String = title.chars().take(140).collect();
        ForegroundApp {
            title,
            process_name,
            available: true,
        }
    }
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn get_foreground_app() -> ForegroundApp {
    ForegroundApp::default()
}

// System monitor: a single shared sysinfo::System kept alive across calls so CPU
// usage is a valid delta between refreshes (the frontend polls every ~2.5s).
static SYSTEM_MONITOR: once_cell::sync::Lazy<std::sync::Mutex<sysinfo::System>> =
    once_cell::sync::Lazy::new(|| std::sync::Mutex::new(sysinfo::System::new()));

#[derive(serde::Serialize, Default)]
struct SystemStats {
    #[serde(rename = "cpuPercent")]
    cpu_percent: f32,
    #[serde(rename = "memUsedMb")]
    mem_used_mb: u64,
    #[serde(rename = "memTotalMb")]
    mem_total_mb: u64,
    #[serde(rename = "memPercent")]
    mem_percent: f32,
}

/// Returns current CPU% (system-wide) and RAM usage. CPU is the delta since the
/// previous call, so the first reading after launch reads ~0 until the next poll.
#[tauri::command]
fn get_system_stats() -> SystemStats {
    let mut sys = match SYSTEM_MONITOR.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };
    sys.refresh_cpu_usage();
    sys.refresh_memory();

    let cpu_percent = sys.global_cpu_usage();
    let total = sys.total_memory(); // bytes
    let used = sys.used_memory(); // bytes
    let mem_percent = if total > 0 {
        (used as f64 / total as f64 * 100.0) as f32
    } else {
        0.0
    };

    SystemStats {
        cpu_percent,
        mem_used_mb: used / 1024 / 1024,
        mem_total_mb: total / 1024 / 1024,
        mem_percent,
    }
}

/// Resize window and re-center in a single atomic operation
/// Prevents visual glitches from separate resize + position calls
#[cfg(desktop)]
#[tauri::command]
fn resize_and_center(window: tauri::Window, width: f64, height: f64) -> Result<(), String> {
    if width <= 0.0 || height <= 0.0 {
        return Err("Invalid dimensions".to_string());
    }
    
    // Resize first
    window
        .set_size(tauri::Size::Logical(tauri::LogicalSize { width, height }))
        .map_err(|e| format!("Failed to resize: {}", e))?;

    // If the user dragged the pill somewhere, honor that instead of re-centering —
    // otherwise every resize (hover, media start, notification) would yank the pill
    // back to the top-center and make dragging feel broken. The X is re-derived so
    // the pill grows symmetrically around its own center rather than to the right.
    if let Some(custom) = CUSTOM_PILL_POSITION.lock().ok().and_then(|g| *g) {
        let scale = window.scale_factor().unwrap_or(1.0);
        let current = window.outer_position().ok();
        let current_w = window.outer_size().map(|s| s.width as f64 / scale).unwrap_or(width);
        let center_x = current
            .map(|p| (p.x as f64 / scale) + current_w / 2.0)
            .unwrap_or(custom.x + width / 2.0);

        window
            .set_position(tauri::Position::Logical(tauri::LogicalPosition {
                x: center_x - width / 2.0,
                y: custom.y,
            }))
            .map_err(|e| format!("Failed to position: {}", e))?;
        return Ok(());
    }

    // Default: center on the primary display, flush to the top edge.
    if let Ok(Some(monitor)) = window.primary_monitor() {
        let monitor_size = monitor.size();
        let scale_factor = monitor.scale_factor();
        let x = (monitor_size.width as f64 / scale_factor) / 2.0 - width / 2.0;

        window
            .set_position(tauri::Position::Logical(tauri::LogicalPosition { x, y: 0.0 }))
            .map_err(|e| format!("Failed to center: {}", e))?;
    }

    Ok(())
}

#[cfg(not(desktop))]
#[tauri::command]
fn resize_and_center(_window: tauri::Window, _width: f64, _height: f64) -> Result<(), String> {
    Err("Resize/center not supported on mobile".to_string())
}

/// Cursor position relative to this window's top-left, in logical (CSS) pixels.
/// Used by the frontend to hit-test the pill while the window is click-through
/// (the webview receives no mouse events in that state, so it must poll).
#[cfg(target_os = "windows")]
#[tauri::command]
fn get_cursor_in_window(window: tauri::Window) -> Result<Option<(f64, f64)>, String> {
    use windows::Win32::Foundation::POINT;
    use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;
    let mut p = POINT::default();
    unsafe { GetCursorPos(&mut p) }.map_err(|e| format!("Failed to get cursor: {}", e))?;
    let pos = window.outer_position().map_err(|e| e.to_string())?;
    let scale = window.scale_factor().map_err(|e| e.to_string())?;
    Ok(Some((
        (p.x - pos.x) as f64 / scale,
        (p.y - pos.y) as f64 / scale,
    )))
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn get_cursor_in_window(_window: tauri::Window) -> Result<Option<(f64, f64)>, String> {
    Ok(None)
}

/// Get current monitor scale factor for DPI-aware calculations
#[tauri::command]
fn get_scale_factor(window: tauri::Window) -> Result<f64, String> {
    let monitor = window
        .primary_monitor()
        .map_err(|e| format!("Failed to get monitor: {}", e))?
        .ok_or_else(|| "No primary monitor".to_string())?;
    
    Ok(monitor.scale_factor())
}

// =============================================================================
// Media Session Commands
// =============================================================================

/// Helper to get the current media session
#[cfg(target_os = "windows")]
fn get_current_session() -> Result<GlobalSystemMediaTransportControlsSession, String> {
    let manager = poll_session_manager()?;

    // If the user pinned a specific app (Spotify vs. a browser tab), control that one.
    // Fall back to the system's "current" session when the pinned app has gone away.
    if let Some(preferred) = PREFERRED_MEDIA_SESSION.lock().ok().and_then(|g| g.clone()) {
        if let Ok(sessions) = manager.GetSessions() {
            for session in sessions {
                if session
                    .SourceAppUserModelId()
                    .map(|id| id.to_string() == preferred)
                    .unwrap_or(false)
                {
                    return Ok(session);
                }
            }
        }
    }

    manager.GetCurrentSession()
        .map_err(|e| format!("No active media session: {}", e))
}

#[cfg(target_os = "windows")]
fn timespan_to_ms(duration: windows::Foundation::TimeSpan) -> u64 {
    if duration.Duration <= 0 { 0 } else { (duration.Duration / 10_000) as u64 }
}

#[cfg(target_os = "windows")]
fn repeat_mode_to_string(mode: MediaPlaybackAutoRepeatMode) -> String {
    if mode == MediaPlaybackAutoRepeatMode::Track {
        "track".to_string()
    } else if mode == MediaPlaybackAutoRepeatMode::List {
        "list".to_string()
    } else {
        "none".to_string()
    }
}

// =============================================================================
// Media Timeline, Repeat, Shuffle, Pause-Other Commands
// =============================================================================

/// Current wall-clock time expressed as Windows `DateTime.UniversalTime`
/// (100-nanosecond ticks since 1601-01-01 UTC), for comparison against
/// SMTC's `LastUpdatedTime`.
#[cfg(target_os = "windows")]
fn now_windows_ticks() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    // 100ns ticks between 1601-01-01 and the Unix epoch (1970-01-01).
    const EPOCH_DIFF_TICKS: i64 = 116_444_736_000_000_000;
    match SystemTime::now().duration_since(UNIX_EPOCH) {
        Ok(d) => EPOCH_DIFF_TICKS + (d.as_nanos() / 100) as i64,
        Err(_) => EPOCH_DIFF_TICKS,
    }
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn get_media_timeline() -> Result<MediaTimeline, String> {
    let session = get_current_session()?;
    let timeline = session.GetTimelineProperties()
        .map_err(|e| format!("Failed to get timeline properties: {}", e))?;

    // Timeline values are reported relative to StartTime (usually 0, but honor it).
    let start_ms = timeline.StartTime().map(timespan_to_ms).unwrap_or(0);
    let end_ms = timeline.EndTime().map(timespan_to_ms)
        .map_err(|e| format!("Failed to get duration: {}", e))?;
    let raw_position_ms = timeline.Position().map(timespan_to_ms)
        .map_err(|e| format!("Failed to get position: {}", e))?;

    let duration_ms = end_ms.saturating_sub(start_ms);
    let mut position_ms = raw_position_ms.saturating_sub(start_ms);

    let playback_info = session.GetPlaybackInfo()
        .map_err(|e| format!("Failed to get playback info: {}", e))?;
    let controls = playback_info.Controls()
        .map_err(|e| format!("Failed to get controls: {}", e))?;
    let can_seek = controls.IsPlaybackPositionEnabled()
        .map_err(|e| format!("Failed to check seek support: {}", e))?;

    // Windows reports Position as of LastUpdatedTime, not live. Most apps
    // (Chrome, Spotify) only push a timeline update on play/pause/seek, so while
    // a track keeps playing its Position stays frozen — which is why the progress
    // bar sat at 0:00. When the session is actively playing, advance the reported
    // position by the wall-clock time elapsed since that last update.
    let is_playing = playback_info.PlaybackStatus()
        .map(|s| s == GlobalSystemMediaTransportControlsSessionPlaybackStatus::Playing)
        .unwrap_or(false);
    if is_playing {
        if let Ok(last_updated) = timeline.LastUpdatedTime() {
            let last_ticks = last_updated.UniversalTime; // 100ns ticks since 1601
            let now_ticks = now_windows_ticks();
            if last_ticks > 0 && now_ticks > last_ticks {
                let elapsed_ms = ((now_ticks - last_ticks) / 10_000) as u64;
                position_ms = position_ms.saturating_add(elapsed_ms);
            }
        }
    }

    // Never report past the end of the track.
    if duration_ms > 0 {
        position_ms = position_ms.min(duration_ms);
    }

    Ok(MediaTimeline { position_ms, duration_ms, can_seek })
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn get_media_timeline() -> Result<MediaTimeline, String> {
    Err("Media controls not supported on this platform".to_string())
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn seek_media(position_ms: u64) -> Result<(), String> {
    let session = get_current_session()?;
    let max_position_ms = i64::MAX as u64 / 10_000;
    if position_ms > max_position_ms {
        return Err("Playback position is too large".to_string());
    }
    let requested_position = (position_ms as i64) * 10_000;
    let op = session.TryChangePlaybackPositionAsync(requested_position)
        .map_err(|e| format!("Failed to seek: {}", e))?;
    let _success = poll_bool_op(op)?;
    Ok(())
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn seek_media(_position_ms: u64) -> Result<(), String> {
    Err("Media controls not supported on this platform".to_string())
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn get_media_playback_info() -> Result<MediaPlaybackInfo, String> {
    let session = get_current_session()?;
    let playback_info = session.GetPlaybackInfo()
        .map_err(|e| format!("Failed to get playback info: {}", e))?;
    let repeat_mode = playback_info.AutoRepeatMode().ok()
        .and_then(|v| v.Value().ok())
        .map(repeat_mode_to_string)
        .unwrap_or_else(|| "none".to_string());
    let is_shuffle = playback_info.IsShuffleActive().ok()
        .and_then(|v| v.Value().ok())
        .unwrap_or(false);
    Ok(MediaPlaybackInfo { repeat_mode, is_shuffle })
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn get_media_playback_info() -> Result<MediaPlaybackInfo, String> {
    Err("Media controls not supported on this platform".to_string())
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn media_toggle_repeat() -> Result<(), String> {
    let session = get_current_session()?;
    let playback_info = session.GetPlaybackInfo()
        .map_err(|e| format!("Failed to get playback info: {}", e))?;
    let current_mode = playback_info.AutoRepeatMode().ok()
        .and_then(|v| v.Value().ok())
        .unwrap_or(MediaPlaybackAutoRepeatMode::None);
    let next_mode = if current_mode == MediaPlaybackAutoRepeatMode::None {
        MediaPlaybackAutoRepeatMode::List
    } else if current_mode == MediaPlaybackAutoRepeatMode::List {
        MediaPlaybackAutoRepeatMode::Track
    } else {
        MediaPlaybackAutoRepeatMode::None
    };
    let op = session.TryChangeAutoRepeatModeAsync(next_mode)
        .map_err(|e| format!("Failed to change repeat mode: {}", e))?;
    let _success = poll_bool_op(op)?;
    Ok(())
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn media_toggle_repeat() -> Result<(), String> {
    Err("Media controls not supported on this platform".to_string())
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn media_toggle_shuffle() -> Result<(), String> {
    let session = get_current_session()?;
    let playback_info = session.GetPlaybackInfo()
        .map_err(|e| format!("Failed to get playback info: {}", e))?;
    let current_shuffle = playback_info.IsShuffleActive().ok()
        .and_then(|v| v.Value().ok())
        .unwrap_or(false);
    let op = session.TryChangeShuffleActiveAsync(!current_shuffle)
        .map_err(|e| format!("Failed to toggle shuffle: {}", e))?;
    let _success = poll_bool_op(op)?;
    Ok(())
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn media_toggle_shuffle() -> Result<(), String> {
    Err("Media controls not supported on this platform".to_string())
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn pause_other_sessions() -> Result<(), String> {
    let manager = poll_session_manager()?;
    let current_session = manager.GetCurrentSession()
        .map_err(|e| format!("No active media session: {}", e))?;
    let sessions = manager.GetSessions()
        .map_err(|e| format!("Failed to get sessions: {}", e))?;
    let count = sessions.Size()
        .map_err(|e| format!("Failed to get session count: {}", e))?;
    for index in 0..count {
        let session = sessions.GetAt(index)
            .map_err(|e| format!("Failed to get session: {}", e))?;
        if session == current_session { continue; }
        let playback_info = session.GetPlaybackInfo()
            .map_err(|e| format!("Failed to get playback info: {}", e))?;
        let playback_status = playback_info.PlaybackStatus()
            .map_err(|e| format!("Failed to get playback status: {}", e))?;
        if playback_status == GlobalSystemMediaTransportControlsSessionPlaybackStatus::Playing {
            let op = session.TryPauseAsync()
                .map_err(|e| format!("Failed to pause session: {}", e))?;
            let _success = poll_bool_op(op)?;
        }
    }
    Ok(())
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn pause_other_sessions() -> Result<(), String> {
    Err("Media controls not supported on this platform".to_string())
}

// =============================================================================
// Album Art Accent Color Extraction
// =============================================================================

#[cfg(target_os = "windows")]
#[tauri::command]
fn extract_accent_color() -> Result<AccentColorResult, String> {
    let session = get_current_session()?;

    // Get media properties (async)
    let props_op = session.TryGetMediaPropertiesAsync()
        .map_err(|e| format!("Failed to get media properties: {}", e))?;

    // Poll until complete
    let mut attempts = 0;
    loop {
        let status = props_op.Status().map_err(|e| format!("Status check failed: {}", e))?;
        if status == AsyncStatus::Completed { break; }
        if status == AsyncStatus::Error {
            return Err("Failed to get media properties".to_string());
        }
        attempts += 1;
        if attempts > 100 { return Err("Timeout getting media properties".to_string()); }
        thread::sleep(Duration::from_millis(20));
    }

    let props = props_op.GetResults()
        .map_err(|e| format!("Failed to get properties result: {}", e))?;

    let thumbnail_ref = props.Thumbnail()
        .map_err(|e| format!("No thumbnail available: {}", e))?;

    // Open the thumbnail stream
    let stream_op = thumbnail_ref.OpenReadAsync()
        .map_err(|e| format!("Failed to open thumbnail stream: {}", e))?;

    let mut attempts = 0;
    loop {
        let status = stream_op.Status().map_err(|e| format!("Stream status failed: {}", e))?;
        if status == AsyncStatus::Completed { break; }
        if status == AsyncStatus::Error {
            return Err("Failed to open thumbnail stream".to_string());
        }
        attempts += 1;
        if attempts > 100 { return Err("Timeout opening thumbnail".to_string()); }
        thread::sleep(Duration::from_millis(20));
    }

    let stream = stream_op.GetResults()
        .map_err(|e| format!("Failed to get stream: {}", e))?;

    let size = stream.Size().map_err(|e| format!("Failed to get stream size: {}", e))? as u32;
    if size == 0 {
        return Err("Thumbnail is empty".to_string());
    }

    // Read all bytes
    let reader = DataReader::CreateDataReader(&stream)
        .map_err(|e| format!("Failed to create data reader: {}", e))?;
    reader.SetInputStreamOptions(InputStreamOptions::ReadAhead)
        .map_err(|e| format!("Failed to set stream options: {}", e))?;

    let load_op = reader.LoadAsync(size)
        .map_err(|e| format!("Failed to load bytes: {}", e))?;

    let mut attempts = 0;
    loop {
        let status = load_op.Status().map_err(|e| format!("Load status failed: {}", e))?;
        if status == AsyncStatus::Completed { break; }
        if status == AsyncStatus::Error {
            return Err("Failed to load thumbnail bytes".to_string());
        }
        attempts += 1;
        if attempts > 100 { return Err("Timeout reading thumbnail".to_string()); }
        thread::sleep(Duration::from_millis(20));
    }

    let bytes_loaded = load_op.GetResults()
        .map_err(|e| format!("Failed to get loaded byte count: {}", e))?;

    let mut buf = vec![0u8; bytes_loaded as usize];
    reader.ReadBytes(&mut buf)
        .map_err(|e| format!("Failed to read bytes: {}", e))?;

    // Average color from raw bytes — sample every 4-byte BGRA group
    // Skip first 100 bytes (potential image header) and sample every 16th pixel for speed
    let mut r_sum: u64 = 0;
    let mut g_sum: u64 = 0;
    let mut b_sum: u64 = 0;
    let mut count: u64 = 0;
    let start = 100.min(buf.len());
    let step = 64; // sample every 16th pixel (16*4 bytes)

    let mut i = start;
    while i + 3 < buf.len() {
        let b = buf[i] as u64;
        let g = buf[i + 1] as u64;
        let r = buf[i + 2] as u64;
        // Skip very dark and very bright pixels
        if (r + g + b) > 60 && (r + g + b) < 700 {
            r_sum += r;
            g_sum += g;
            b_sum += b;
            count += 1;
        }
        i += step;
    }

    if count == 0 {
        return Ok(AccentColorResult { r: 128, g: 128, b: 128 });
    }

    Ok(AccentColorResult {
        r: (r_sum / count) as u8,
        g: (g_sum / count) as u8,
        b: (b_sum / count) as u8,
    })
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn extract_accent_color() -> Result<AccentColorResult, String> {
    Err("Accent color extraction not supported on this platform".to_string())
}

/// Get current media session info (now playing)
#[cfg(target_os = "windows")]
#[tauri::command]
fn get_media_session() -> Result<Option<MediaInfo>, String> {
    // Get session manager
    let manager = poll_session_manager()?;

    // Get the current session
    let session = match manager.GetCurrentSession() {
        Ok(s) => s,
        Err(_) => {
            return Ok(None); // No active media session
        },
    };
    
    // Get playback info
    let playback_info = session.GetPlaybackInfo()
        .map_err(|e| format!("Failed to get playback info: {}", e))?;
    
    let playback_status = playback_info.PlaybackStatus()
        .map_err(|e| format!("Failed to get playback status: {}", e))?;
    
    let is_playing = playback_status == GlobalSystemMediaTransportControlsSessionPlaybackStatus::Playing;
    
    // Get media properties
    let properties = poll_media_properties(&session)?;
    
    let title = properties.Title()
        .map(|s: HSTRING| s.to_string())
        .unwrap_or_default();
    
    let artist = properties.Artist()
        .map(|s: HSTRING| s.to_string())
        .unwrap_or_default();
    
    let album = properties.AlbumTitle()
        .map(|s: HSTRING| s.to_string())
        .ok()
        .filter(|s| !s.is_empty());
    
    // Get app name
    let app_name = session.SourceAppUserModelId()
        .map(|s: HSTRING| {
            let s = s.to_string();
            // Extract app name from the model ID
            s.split('\\').last()
                .map(|n| n.trim_end_matches(".exe").to_string())
                .unwrap_or(s)
        })
        .ok();
    
    Ok(Some(MediaInfo {
        title,
        artist,
        album,
        is_playing,
        app_name,
    }))
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn get_media_session() -> Result<Option<MediaInfo>, String> {
    Ok(None)
}

/// Play/pause media
#[cfg(target_os = "windows")]
#[tauri::command]
fn media_play_pause() -> Result<(), String> {
    let session = get_current_session()?;
    
    let op = session.TryTogglePlayPauseAsync()
        .map_err(|e| format!("Failed to toggle play/pause: {}", e))?;
    
    let _success = poll_bool_op(op)?;
    Ok(())
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn media_play_pause() -> Result<(), String> {
    Err("Media controls not supported on this platform".to_string())
}

/// Skip to next track
#[cfg(target_os = "windows")]
#[tauri::command]
fn media_next() -> Result<(), String> {
    let session = get_current_session()?;
    
    let op = session.TrySkipNextAsync()
        .map_err(|e| format!("Failed to skip next: {}", e))?;
    
    let _success = poll_bool_op(op)?;
    Ok(())
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn media_next() -> Result<(), String> {
    Err("Media controls not supported on this platform".to_string())
}

/// Skip to previous track
#[cfg(target_os = "windows")]
#[tauri::command]
fn media_previous() -> Result<(), String> {
    let session = get_current_session()?;
    
    let op = session.TrySkipPreviousAsync()
        .map_err(|e| format!("Failed to skip previous: {}", e))?;
    
    let _success = poll_bool_op(op)?;
    Ok(())
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn media_previous() -> Result<(), String> {
    Err("Media controls not supported on this platform".to_string())
}

// =============================================================================
// Volume Control Commands
// =============================================================================

/// Get system volume
#[cfg(target_os = "windows")]
#[tauri::command]
fn get_system_volume() -> Result<VolumeInfo, String> {
    unsafe {
        // Initialize COM
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        
        // Get device enumerator
        let enumerator: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
            .map_err(|e| format!("Failed to create device enumerator: {}", e))?;
        
        // Get default audio endpoint
        let device = enumerator.GetDefaultAudioEndpoint(eRender, eConsole)
            .map_err(|e| format!("Failed to get audio endpoint: {}", e))?;
        
        // Get volume interface
        let volume: IAudioEndpointVolume = device.Activate(CLSCTX_ALL, None)
            .map_err(|e| format!("Failed to get volume interface: {}", e))?;
        
        // Get volume level (0.0 - 1.0)
        let level = volume.GetMasterVolumeLevelScalar()
            .map_err(|e| format!("Failed to get volume level: {}", e))?;
        
        // Get mute state
        let is_muted = volume.GetMute()
            .map_err(|e| format!("Failed to get mute state: {}", e))?
            .as_bool();
        
        Ok(VolumeInfo {
            level: (level * 100.0).round() as u32,
            is_muted,
        })
    }
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn get_system_volume() -> Result<VolumeInfo, String> {
    Ok(VolumeInfo { level: 0, is_muted: false })
}

/// Set system volume (0-100)
#[cfg(target_os = "windows")]
#[tauri::command]
fn set_system_volume(level: u32) -> Result<(), String> {
    if level > 100 {
        return Err("Volume level must be 0-100".to_string());
    }
    
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        
        let enumerator: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
            .map_err(|e| format!("Failed to create device enumerator: {}", e))?;
        
        let device = enumerator.GetDefaultAudioEndpoint(eRender, eConsole)
            .map_err(|e| format!("Failed to get audio endpoint: {}", e))?;
        
        let volume: IAudioEndpointVolume = device.Activate(CLSCTX_ALL, None)
            .map_err(|e| format!("Failed to get volume interface: {}", e))?;
        
        volume.SetMasterVolumeLevelScalar(level as f32 / 100.0, std::ptr::null())
            .map_err(|e| format!("Failed to set volume: {}", e))?;
        
        Ok(())
    }
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn set_system_volume(_level: u32) -> Result<(), String> {
    Err("Volume control not supported on this platform".to_string())
}

/// Toggle mute
#[cfg(target_os = "windows")]
#[tauri::command]
fn toggle_mute() -> Result<bool, String> {
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        
        let enumerator: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
            .map_err(|e| format!("Failed to create device enumerator: {}", e))?;
        
        let device = enumerator.GetDefaultAudioEndpoint(eRender, eConsole)
            .map_err(|e| format!("Failed to get audio endpoint: {}", e))?;
        
        let volume: IAudioEndpointVolume = device.Activate(CLSCTX_ALL, None)
            .map_err(|e| format!("Failed to get volume interface: {}", e))?;
        
        let is_muted = volume.GetMute()
            .map_err(|e| format!("Failed to get mute state: {}", e))?
            .as_bool();
        
        volume.SetMute(!is_muted, std::ptr::null())
            .map_err(|e| format!("Failed to toggle mute: {}", e))?;
        
        Ok(!is_muted)
    }
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn toggle_mute() -> Result<bool, String> {
    Err("Volume control not supported on this platform".to_string())
}

// =============================================================================
// Audio Device Commands
// =============================================================================

/// Helper to get device friendly name from IMMDevice using Windows Property Store
#[cfg(target_os = "windows")]
fn get_device_name(device: &IMMDevice) -> Result<String, String> {
    unsafe {
        // Open the property store for read access
        let store: IPropertyStore = device.OpenPropertyStore(STGM_READ)
            .map_err(|e| format!("Failed to open property store: {}", e))?;
        
        // Get the friendly name property
        let value = store.GetValue(&PKEY_Device_FriendlyName)
            .map_err(|e| format!("Failed to get device name property: {}", e))?;
        
        // Extract string from PROPVARIANT using Windows API (allocates; we must free)
        if let Ok(pwstr) = PropVariantToStringAlloc(&value) {
            if !pwstr.0.is_null() {
                let len = (0..).take_while(|&i| *pwstr.0.add(i) != 0).count();
                let slice = std::slice::from_raw_parts(pwstr.0, len);
                let name = String::from_utf16_lossy(slice);
                CoTaskMemFree(Some(pwstr.0 as *const _));
                if !name.is_empty() {
                    return Ok(name);
                }
            }
        }
        
        // Fallback: try to get a name from the device ID
        let id = get_device_id(device)?;
        let short_id = if id.len() > 8 { &id[id.len()-8..] } else { &id };
        Ok(format!("Audio Device {}", short_id))
    }
}

/// Helper to get device ID from IMMDevice
#[cfg(target_os = "windows")]
fn get_device_id(device: &IMMDevice) -> Result<String, String> {
    unsafe {
        let id = device.GetId()
            .map_err(|e| format!("Failed to get device ID: {}", e))?;
        
        // Convert PWSTR to String
        let len = (0..).take_while(|&i| *id.0.add(i) != 0).count();
        let slice = std::slice::from_raw_parts(id.0, len);
        let id_str = String::from_utf16_lossy(slice);
        
        // Free the string
        windows::Win32::System::Com::CoTaskMemFree(Some(id.0 as *const _));
        
        Ok(id_str)
    }
}

/// List all audio output devices
#[cfg(target_os = "windows")]
#[tauri::command]
fn list_audio_devices() -> Result<Vec<AudioDevice>, String> {
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        
        let enumerator: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
            .map_err(|e| format!("Failed to create device enumerator: {}", e))?;
        
        // Get default device ID for comparison
        let default_device = enumerator.GetDefaultAudioEndpoint(eRender, eMultimedia)
            .map_err(|e| format!("Failed to get default device: {}", e))?;
        let default_id = get_device_id(&default_device)?;
        
        // Enumerate all active render devices
        let collection: IMMDeviceCollection = enumerator.EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE)
            .map_err(|e| format!("Failed to enumerate devices: {}", e))?;
        
        let count = collection.GetCount()
            .map_err(|e| format!("Failed to get device count: {}", e))?;
        
        let mut devices = Vec::new();
        
        for i in 0..count {
            let device = collection.Item(i)
                .map_err(|e| format!("Failed to get device {}: {}", i, e))?;
            
            let id = get_device_id(&device)?;
            let name = get_device_name(&device).unwrap_or_else(|_| format!("Audio Device {}", i + 1));
            let is_default = id == default_id;
            
            devices.push(AudioDevice {
                id,
                name,
                is_default,
            });
        }
        
        Ok(devices)
    }
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn list_audio_devices() -> Result<Vec<AudioDevice>, String> {
    Ok(Vec::new())
}

/// Get the default audio device
#[cfg(target_os = "windows")]
#[tauri::command]
fn get_default_audio_device() -> Result<AudioDevice, String> {
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        
        let enumerator: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
            .map_err(|e| format!("Failed to create device enumerator: {}", e))?;
        
        let device = enumerator.GetDefaultAudioEndpoint(eRender, eMultimedia)
            .map_err(|e| format!("Failed to get default device: {}", e))?;
        
        let id = get_device_id(&device)?;
        let name = get_device_name(&device)?;
        
        Ok(AudioDevice {
            id,
            name,
            is_default: true,
        })
    }
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn get_default_audio_device() -> Result<AudioDevice, String> {
    Err("Audio devices not supported on this platform".to_string())
}

// =============================================================================
// Per-App Volume Commands
// =============================================================================

/// List all audio sessions (apps playing audio)
#[cfg(target_os = "windows")]
#[tauri::command]
fn list_audio_sessions() -> Result<Vec<AudioSession>, String> {
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        
        let enumerator: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
            .map_err(|e| format!("Failed to create device enumerator: {}", e))?;
        
        let device = enumerator.GetDefaultAudioEndpoint(eRender, eConsole)
            .map_err(|e| format!("Failed to get default audio endpoint: {}", e))?;
        
        // Get audio session manager
        let session_manager: IAudioSessionManager2 = device.Activate(CLSCTX_ALL, None)
            .map_err(|e| format!("Failed to get session manager: {}", e))?;
        
        // Get session enumerator
        let session_enum: IAudioSessionEnumerator = session_manager.GetSessionEnumerator()
            .map_err(|e| format!("Failed to get session enumerator: {}", e))?;
        
        let count = session_enum.GetCount()
            .map_err(|e| format!("Failed to get session count: {}", e))?;
        
        let mut sessions = Vec::new();
        
        for i in 0..count {
            let session: IAudioSessionControl = match session_enum.GetSession(i) {
                Ok(s) => s,
                Err(_) => continue,
            };
            
            // Get session control2 for more info
            let session2: IAudioSessionControl2 = match session.cast() {
                Ok(s) => s,
                Err(_) => continue,
            };
            
            // Get process ID
            let process_id = match session2.GetProcessId() {
                Ok(pid) => pid,
                Err(_) => continue,
            };
            
            // Skip system sounds (process ID 0)
            if process_id == 0 {
                continue;
            }
            
            // Get session state
            let state = session.GetState().unwrap_or(AudioSessionState(0));
            let is_active = state == AudioSessionState(1); // AudioSessionStateActive = 1
            
            // Get display name (or process name as fallback)
            let display_name = session.GetDisplayName()
                .map(|s| {
                    let len = (0..).take_while(|&i| *s.0.add(i) != 0).count();
                    let slice = std::slice::from_raw_parts(s.0, len);
                    let name = String::from_utf16_lossy(slice);
                    windows::Win32::System::Com::CoTaskMemFree(Some(s.0 as *const _));
                    name
                })
                .unwrap_or_default();
            
            // Get app name from session identifier if display name is empty
            let app_name = if display_name.is_empty() || display_name.starts_with("@{") {
                // Try to get from session identifier
                session2.GetSessionIdentifier()
                    .map(|s| {
                        let len = (0..).take_while(|&i| *s.0.add(i) != 0).count();
                        let slice = std::slice::from_raw_parts(s.0, len);
                        let id = String::from_utf16_lossy(slice);
                        windows::Win32::System::Com::CoTaskMemFree(Some(s.0 as *const _));
                        // Extract app name from session ID (usually contains exe path)
                        id.split('\\')
                            .last()
                            .map(|n| n.split('|').next().unwrap_or(n))
                            .map(|n| n.trim_end_matches(".exe").to_string())
                            .unwrap_or_else(|| format!("App {}", process_id))
                    })
                    .unwrap_or_else(|_| format!("App {}", process_id))
            } else {
                display_name
            };
            
            // Get volume interface
            let volume: ISimpleAudioVolume = match session.cast() {
                Ok(v) => v,
                Err(_) => continue,
            };
            
            let level = volume.GetMasterVolume().unwrap_or(1.0);
            let is_muted = volume.GetMute().map(|m| m.as_bool()).unwrap_or(false);
            
            sessions.push(AudioSession {
                session_id: format!("{}", process_id),
                app_name,
                process_id,
                volume: level,
                is_muted,
                is_active,
            });
        }
        
        // Sort by active status (active first), then by name
        sessions.sort_by(|a, b| {
            match (a.is_active, b.is_active) {
                (true, false) => std::cmp::Ordering::Less,
                (false, true) => std::cmp::Ordering::Greater,
                _ => a.app_name.to_lowercase().cmp(&b.app_name.to_lowercase()),
            }
        });
        
        Ok(sessions)
    }
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn list_audio_sessions() -> Result<Vec<AudioSession>, String> {
    Ok(Vec::new())
}

/// Set volume for a specific audio session
#[cfg(target_os = "windows")]
#[tauri::command]
fn set_session_volume(process_id: u32, level: f32) -> Result<(), String> {
    if level < 0.0 || level > 1.0 {
        return Err("Volume level must be 0.0 to 1.0".to_string());
    }
    
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        
        let enumerator: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
            .map_err(|e| format!("Failed to create device enumerator: {}", e))?;
        
        let device = enumerator.GetDefaultAudioEndpoint(eRender, eConsole)
            .map_err(|e| format!("Failed to get default audio endpoint: {}", e))?;
        
        let session_manager: IAudioSessionManager2 = device.Activate(CLSCTX_ALL, None)
            .map_err(|e| format!("Failed to get session manager: {}", e))?;
        
        let session_enum: IAudioSessionEnumerator = session_manager.GetSessionEnumerator()
            .map_err(|e| format!("Failed to get session enumerator: {}", e))?;
        
        let count = session_enum.GetCount()
            .map_err(|e| format!("Failed to get session count: {}", e))?;
        
        for i in 0..count {
            let session: IAudioSessionControl = match session_enum.GetSession(i) {
                Ok(s) => s,
                Err(_) => continue,
            };
            
            let session2: IAudioSessionControl2 = match session.cast() {
                Ok(s) => s,
                Err(_) => continue,
            };
            
            let pid = match session2.GetProcessId() {
                Ok(p) => p,
                Err(_) => continue,
            };
            
            if pid == process_id {
                let volume: ISimpleAudioVolume = session.cast()
                    .map_err(|e| format!("Failed to get volume interface: {}", e))?;
                
                volume.SetMasterVolume(level, std::ptr::null())
                    .map_err(|e| format!("Failed to set volume: {}", e))?;
                
                return Ok(());
            }
        }
        
        Err(format!("Session not found for process ID {}", process_id))
    }
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn set_session_volume(_process_id: u32, _level: f32) -> Result<(), String> {
    Err("Per-app volume not supported on this platform".to_string())
}

/// Mute/unmute a specific audio session
#[cfg(target_os = "windows")]
#[tauri::command]
fn set_session_mute(process_id: u32, muted: bool) -> Result<(), String> {
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        
        let enumerator: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
            .map_err(|e| format!("Failed to create device enumerator: {}", e))?;
        
        let device = enumerator.GetDefaultAudioEndpoint(eRender, eConsole)
            .map_err(|e| format!("Failed to get default audio endpoint: {}", e))?;
        
        let session_manager: IAudioSessionManager2 = device.Activate(CLSCTX_ALL, None)
            .map_err(|e| format!("Failed to get session manager: {}", e))?;
        
        let session_enum: IAudioSessionEnumerator = session_manager.GetSessionEnumerator()
            .map_err(|e| format!("Failed to get session enumerator: {}", e))?;
        
        let count = session_enum.GetCount()
            .map_err(|e| format!("Failed to get session count: {}", e))?;
        
        for i in 0..count {
            let session: IAudioSessionControl = match session_enum.GetSession(i) {
                Ok(s) => s,
                Err(_) => continue,
            };
            
            let session2: IAudioSessionControl2 = match session.cast() {
                Ok(s) => s,
                Err(_) => continue,
            };
            
            let pid = match session2.GetProcessId() {
                Ok(p) => p,
                Err(_) => continue,
            };
            
            if pid == process_id {
                let volume: ISimpleAudioVolume = session.cast()
                    .map_err(|e| format!("Failed to get volume interface: {}", e))?;
                
                volume.SetMute(muted, std::ptr::null())
                    .map_err(|e| format!("Failed to set mute: {}", e))?;
                
                return Ok(());
            }
        }
        
        Err(format!("Session not found for process ID {}", process_id))
    }
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn set_session_mute(_process_id: u32, _muted: bool) -> Result<(), String> {
    Err("Per-app mute not supported on this platform".to_string())
}

// =============================================================================
// Brightness Control Types
// =============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BrightnessInfo {
    pub level: u32,       // 0-100
    pub min: u32,         // minimum brightness level
    pub max: u32,         // maximum brightness level
    pub is_supported: bool,
}

// =============================================================================
// Brightness Control Commands
// =============================================================================

/// Helper to get physical monitor handle
#[cfg(target_os = "windows")]
fn get_primary_physical_monitor() -> Result<PHYSICAL_MONITOR, String> {
    unsafe {
        // Get the primary monitor
        let hwnd = GetForegroundWindow();
        let hmonitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTOPRIMARY);
        
        // Get number of physical monitors
        let mut num_monitors: u32 = 0;
        GetNumberOfPhysicalMonitorsFromHMONITOR(hmonitor, &mut num_monitors)
            .map_err(|e| format!("Failed to get monitor count: {}", e))?;
        
        if num_monitors == 0 {
            return Err("No physical monitors found".to_string());
        }
        
        // Get physical monitor handles
        let mut monitors = vec![PHYSICAL_MONITOR::default(); num_monitors as usize];
        GetPhysicalMonitorsFromHMONITOR(hmonitor, &mut monitors)
            .map_err(|e| format!("Failed to get physical monitors: {}", e))?;
        
        Ok(monitors[0])
    }
}

/// Get system brightness: try WMI (laptops) first via brightness crate, then DDC/CI (external monitors)
#[cfg(target_os = "windows")]
#[tauri::command]
fn get_system_brightness() -> Result<BrightnessInfo, String> {
    // 1. Try brightness crate first (WMI - works on laptop internal panels)
    for device_result in brightness::blocking::brightness_devices() {
        if let Ok(device) = device_result {
            if let Ok(level) = device.get() {
                return Ok(BrightnessInfo {
                    level: level.min(100),
                    min: 0,
                    max: 100,
                    is_supported: true,
                });
            }
        }
    }

    // 2. Fallback: DDC/CI for external monitors
    unsafe {
        let monitor = match get_primary_physical_monitor() {
            Ok(m) => m,
            Err(_) => {
                return Ok(BrightnessInfo {
                    level: 100,
                    min: 0,
                    max: 100,
                    is_supported: false,
                });
            }
        };

        let mut min_brightness: u32 = 0;
        let mut current_brightness: u32 = 0;
        let mut max_brightness: u32 = 0;

        let result = GetMonitorBrightness(
            monitor.hPhysicalMonitor,
            &mut min_brightness,
            &mut current_brightness,
            &mut max_brightness,
        );

        let _ = DestroyPhysicalMonitor(monitor.hPhysicalMonitor);

        if result != 0 {
            let range = max_brightness - min_brightness;
            let normalized = if range > 0 {
                ((current_brightness - min_brightness) * 100) / range
            } else {
                100
            };

            Ok(BrightnessInfo {
                level: normalized,
                min: min_brightness,
                max: max_brightness,
                is_supported: true,
            })
        } else {
            Ok(BrightnessInfo {
                level: 100,
                min: 0,
                max: 100,
                is_supported: false,
            })
        }
    }
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn get_system_brightness() -> Result<BrightnessInfo, String> {
    Ok(BrightnessInfo {
        level: 100,
        min: 0,
        max: 100,
        is_supported: false,
    })
}

/// Set system brightness (0-100): try WMI (laptops) first, then DDC/CI (external monitors)
#[cfg(target_os = "windows")]
#[tauri::command]
fn set_system_brightness(level: u32) -> Result<(), String> {
    let level = level.min(100);

    // 1. Try brightness crate first (WMI - works on laptop internal panels)
    for device_result in brightness::blocking::brightness_devices() {
        if let Ok(device) = device_result {
            if device.set(level).is_ok() {
                return Ok(());
            }
        }
    }

    // 2. Fallback: DDC/CI for external monitors
    unsafe {
        let monitor = get_primary_physical_monitor()?;

        let mut min_brightness: u32 = 0;
        let mut current_brightness: u32 = 0;
        let mut max_brightness: u32 = 0;

        let _ = GetMonitorBrightness(
            monitor.hPhysicalMonitor,
            &mut min_brightness,
            &mut current_brightness,
            &mut max_brightness,
        );

        let range = max_brightness - min_brightness;
        let actual_level = min_brightness + (level * range) / 100;

        let result = SetMonitorBrightness(monitor.hPhysicalMonitor, actual_level);

        let _ = DestroyPhysicalMonitor(monitor.hPhysicalMonitor);

        if result != 0 {
            Ok(())
        } else {
            Err("Failed to set brightness - DDC/CI may not be supported".to_string())
        }
    }
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn set_system_brightness(_level: u32) -> Result<(), String> {
    Err("Brightness control not supported on this platform".to_string())
}

// =============================================================================
// Notification Commands
// =============================================================================

/// Helper to poll notification listener access.
/// Updates the global cache on success.
#[cfg(target_os = "windows")]
fn poll_notification_access() -> Result<UserNotificationListenerAccessStatus, String> {
    let listener = UserNotificationListener::Current()
        .map_err(|e| format!("Failed to get notification listener: {}", e))?;

    let op = listener.RequestAccessAsync()
        .map_err(|e| format!("Failed to request notification access: {}", e))?;

    for _ in 0..POLL_MAX_ITERS {
        let status = op.Status().map_err(|e| format!("Failed to get status: {}", e))?;
        if status == AsyncStatus::Completed {
            let result = op.GetResults().map_err(|e| format!("Failed to get results: {}", e))?;
            NOTIFICATION_ACCESS_GRANTED.store(
                result == UserNotificationListenerAccessStatus::Allowed,
                Ordering::Relaxed,
            );
            return Ok(result);
        }
        if status == AsyncStatus::Error {
            return Err("Async operation failed".to_string());
        }
        thread::sleep(Duration::from_millis(POLL_SLEEP_MS));
    }
    Err("Timeout waiting for notification access".to_string())
}

#[cfg(not(target_os = "windows"))]
fn poll_notification_access() -> Result<(), String> {
    Err("Notifications not supported on this platform".to_string())
}

/// Helper to poll notifications list
#[cfg(target_os = "windows")]
fn poll_notifications_list(listener: &UserNotificationListener) -> Result<Vec<UserNotification>, String> {
    let op = listener.GetNotificationsAsync(windows::UI::Notifications::NotificationKinds::Toast)
        .map_err(|e| format!("Failed to get notifications: {}", e))?;

    for _ in 0..POLL_MAX_ITERS {
        let status = op.Status().map_err(|e| format!("Failed to get status: {}", e))?;
        if status == AsyncStatus::Completed {
            let notifs = op.GetResults()
                .map_err(|e| format!("Failed to get results: {}", e))?;

            let mut result = Vec::new();
            let count = notifs.Size().unwrap_or(0);
            for i in 0..count {
                if let Ok(n) = notifs.GetAt(i) {
                    result.push(n);
                }
            }
            return Ok(result);
        }
        if status == AsyncStatus::Error {
            return Err("Async operation failed".to_string());
        }
        thread::sleep(Duration::from_millis(POLL_SLEEP_MS));
    }
    Err("Timeout waiting for notifications".to_string())
}

#[cfg(not(target_os = "windows"))]
fn poll_notifications_list(_listener: &()) -> Result<Vec<()>, String> {
    Err("Notifications not supported on this platform".to_string())
}

/// Subscribe to Windows NotificationChanged with retry for transient startup races.
/// Some systems return HRESULT 0x80070490 (Element not found) even when polling works.
#[cfg(target_os = "windows")]
fn subscribe_notification_changed(
    listener: &UserNotificationListener,
    app_handle: &tauri::AppHandle,
) -> bool {
    const RETRIES: usize = 3;
    const RETRY_DELAY_MS: u64 = 500;
    const E_ELEMENT_NOT_FOUND: i32 = 0x80070490u32 as i32;

    for attempt in 1..=RETRIES {
        let handle_for_event = app_handle.clone();
        let handler = TypedEventHandler::new(
            move |_listener: &Option<UserNotificationListener>,
                  _args: &Option<UserNotificationChangedEventArgs>| {
                use tauri::Emitter;

                // Try to intercept new notifications: read content, dismiss from Windows, emit to frontend
                if let Some(args) = _args {
                    if let Ok(UserNotificationChangedKind::Added) = args.ChangeKind() {
                        if let Ok(notif_id) = args.UserNotificationId() {
                            if let Ok(listener) = UserNotificationListener::Current() {
                                if let Ok(notifications) = poll_notifications_list(&listener) {
                                    if let Some(notif) = notifications.iter().find(|n| n.Id().unwrap_or(0) == notif_id) {
                                        if let Some(sn) = extract_notification(notif, 0) {
                                            let _ = handle_for_event.emit("notification-added", &sn);
                                            // Dismiss from Windows to suppress native toast banner
                                            let _ = listener.RemoveNotification(notif_id);
                                            return Ok(());
                                        }
                                    }
                                }
                            }
                        }
                    }
                }

                // Fallback: emit generic change event (removed notifications, or failed to read)
                let _ = handle_for_event.emit("notification-changed", ());
                Ok(())
            },
        );

        match listener.NotificationChanged(&handler) {
            Ok(_) => {
                if attempt > 1 {
                    eprintln!(
                        "[WINDEYE] Subscribed to NotificationChanged after retry {}",
                        attempt
                    );
                } else {
                    eprintln!("[WINDEYE] Successfully subscribed to NotificationChanged");
                }
                return true;
            }
            Err(e) => {
                let code = e.code().0;
                let is_not_found = code == E_ELEMENT_NOT_FOUND;

                // Retry only for the common startup race case.
                if is_not_found && attempt < RETRIES {
                    thread::sleep(Duration::from_millis(RETRY_DELAY_MS));
                    continue;
                }

                if is_not_found {
                    eprintln!(
                        "[WINDEYE] NotificationChanged not available on this system; using polling fallback"
                    );
                } else {
                    eprintln!("[WINDEYE] Failed to subscribe to NotificationChanged: {:?}", e);
                    eprintln!("[WINDEYE] Notifications will still work via polling fallback");
                }
                return false;
            }
        }
    }

    false
}

/// Request notification access and check if granted.
/// Also updates the cached access flag used by get_notifications().
#[cfg(target_os = "windows")]
#[tauri::command]
fn check_notification_access() -> Result<bool, String> {
    let status = poll_notification_access()?;
    let allowed = status == UserNotificationListenerAccessStatus::Allowed;
    NOTIFICATION_ACCESS_GRANTED.store(allowed, Ordering::Relaxed);
    Ok(allowed)
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn check_notification_access() -> Result<bool, String> {
    Ok(false)
}

/// Extract a SystemNotification from a Windows UserNotification.
/// Returns None if the notification has no meaningful content.
#[cfg(target_os = "windows")]
fn extract_notification(notif: &UserNotification, idx: usize) -> Option<SystemNotification> {
    let id = notif.Id().unwrap_or(idx as u32);

    let app_name = notif
        .AppInfo()
        .ok()
        .and_then(|app_info| app_info.DisplayInfo().ok())
        .and_then(|display_info| display_info.DisplayName().ok())
        .map(|h| h.to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "Windows App".to_string());

    let aumid = notif
        .AppInfo()
        .ok()
        .and_then(|app_info| app_info.AppUserModelId().ok())
        .map(|h| h.to_string())
        .filter(|s| !s.is_empty());

    let notification = notif.Notification().ok()?;
    let visual = notification.Visual().ok()?;

    let mut title = String::new();
    let mut body = String::new();

    if let Ok(bindings) = visual.Bindings() {
        if let Ok(count) = bindings.Size() {
            for i in 0..count {
                if let Ok(binding) = bindings.GetAt(i) {
                    if let Ok(elements) = binding.GetTextElements() {
                        if let Ok(elem_count) = elements.Size() {
                            for j in 0..elem_count {
                                if let Ok(elem) = elements.GetAt(j) {
                                    if let Ok(text) = elem.Text() {
                                        let text_str = text.to_string();
                                        if title.is_empty() {
                                            title = text_str;
                                        } else if body.is_empty() {
                                            body = text_str;
                                        } else {
                                            body.push('\n');
                                            body.push_str(&text_str);
                                        }
                                    }
                                }
                            }
                        }
                    }
                    break; // Only process first binding
                }
            }
        }
    }

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);

    let timestamp = notif
        .CreationTime()
        .ok()
        .map(|dt| {
            let ticks: i64 = dt.UniversalTime;
            const EPOCH_OFFSET_100NS: i64 = 11644473600 * 10_000_000;
            let unix_ms = ((ticks - EPOCH_OFFSET_100NS) / 10_000) as u64;
            unix_ms
        })
        .filter(|&t| t > 0 && t < now + 86400_000)
        .unwrap_or_else(|| now.saturating_sub(idx as u64 * 60000));

    if title.is_empty() && body.is_empty() {
        return None;
    }

    Some(SystemNotification {
        id,
        app_name,
        title,
        body,
        timestamp,
        aumid,
    })
}

/// Get recent notifications.
/// Uses cached access status to avoid re-polling access on every call.
#[cfg(target_os = "windows")]
#[tauri::command]
fn get_notifications() -> Result<Vec<SystemNotification>, String> {
    if !NOTIFICATION_ACCESS_GRANTED.load(Ordering::Relaxed) {
        return Ok(Vec::new());
    }

    let listener = UserNotificationListener::Current()
        .map_err(|e| format!("Failed to get notification listener: {}", e))?;

    let notifications = poll_notifications_list(&listener)?;

    let result: Vec<SystemNotification> = notifications
        .iter()
        .take(10)
        .enumerate()
        .filter_map(|(idx, notif)| extract_notification(notif, idx))
        .collect();

    Ok(result)
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn get_notifications() -> Result<Vec<SystemNotification>, String> {
    Ok(Vec::new())
}

/// Activate (bring to foreground) the app that created the notification with the given ID.
/// Uses the same mechanism as Windows Action Center: the app is identified by its
/// AppUserModelId (AUMID); we launch it via the shell (explorer shell:AppsFolder\AUMID)
/// so both UWP and desktop apps (e.g. WhatsApp) are activated correctly.
#[cfg(target_os = "windows")]
#[tauri::command]
fn activate_notification(id: u32) -> Result<(), String> {
    let listener = UserNotificationListener::Current()
        .map_err(|e| format!("Failed to get notification listener: {}", e))?;

    let access = poll_notification_access()?;
    if access != UserNotificationListenerAccessStatus::Allowed {
        return Err("Notification access not granted".to_string());
    }

    let notifications = poll_notifications_list(&listener)?;
    let notif = notifications
        .iter()
        .find(|n| n.Id().unwrap_or(0) == id)
        .ok_or_else(|| format!("Notification {} not found", id))?;

    let app_info = notif
        .AppInfo()
        .map_err(|e| format!("Failed to get app info: {}", e))?;

    let aumid = app_info
        .AppUserModelId()
        .map_err(|e| format!("AppUserModelId not available: {}", e))?
        .to_string();
    if aumid.is_empty() {
        return Err("AppUserModelId is empty".to_string());
    }

    // Allow the activated app to take foreground (same as when user clicks in Action Center).
    unsafe {
        let _ = AllowSetForegroundWindow(ASFW_ANY);
    }

    // Activate via shell:AppsFolder\{AUMID}. Try two methods:
    // 1) Open the shell path directly (lpFile = "shell:AppsFolder\AUMID")
    // 2) If that fails, run explorer.exe with the path as argument (for desktop apps)
    let shell_path = HSTRING::from(format!("shell:AppsFolder\\{}", aumid));
    let result = unsafe {
        ShellExecuteW(
            None,
            &HSTRING::from("open"),
            &shell_path,
            None,
            None,
            SW_SHOWNORMAL,
        )
    };
    if result.0 as isize > 32 {
        return Ok(());
    }
    // Fallback: explorer.exe shell:AppsFolder\AUMID (some apps need this)
    let explorer = HSTRING::from("explorer.exe");
    let params = HSTRING::from(format!("shell:AppsFolder\\{}", aumid));
    let result2 = unsafe {
        ShellExecuteW(
            None,
            &HSTRING::from("open"),
            &explorer,
            &params,
            None,
            SW_SHOWNORMAL,
        )
    };
    if result2.0 as isize <= 32 {
        return Err(format!(
            "Failed to activate app (ShellExecute returned {})",
            result2.0 as isize
        ));
    }
    Ok(())
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn activate_notification(_id: u32) -> Result<(), String> {
    Err("Notification activation not supported on this platform".to_string())
}

/// Activate an app by its AUMID directly (used when notification was already dismissed from Windows).
#[cfg(target_os = "windows")]
#[tauri::command]
fn activate_app_by_aumid(aumid: String) -> Result<(), String> {
    if aumid.is_empty() {
        return Err("AUMID is empty".to_string());
    }

    unsafe {
        let _ = AllowSetForegroundWindow(ASFW_ANY);
    }

    let shell_path = HSTRING::from(format!("shell:AppsFolder\\{}", aumid));
    let result = unsafe {
        ShellExecuteW(
            None,
            &HSTRING::from("open"),
            &shell_path,
            None,
            None,
            SW_SHOWNORMAL,
        )
    };
    if result.0 as isize > 32 {
        return Ok(());
    }

    let explorer = HSTRING::from("explorer.exe");
    let params = HSTRING::from(format!("shell:AppsFolder\\{}", aumid));
    let result2 = unsafe {
        ShellExecuteW(
            None,
            &HSTRING::from("open"),
            &explorer,
            &params,
            None,
            SW_SHOWNORMAL,
        )
    };
    if result2.0 as isize <= 32 {
        return Err(format!(
            "Failed to activate app (ShellExecute returned {})",
            result2.0 as isize
        ));
    }
    Ok(())
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn activate_app_by_aumid(_aumid: String) -> Result<(), String> {
    Err("Not supported on this platform".to_string())
}

/// Dismiss a notification by ID
#[cfg(target_os = "windows")]
#[tauri::command]
fn dismiss_notification(id: u32) -> Result<(), String> {
    let listener = UserNotificationListener::Current()
        .map_err(|e| format!("Failed to get notification listener: {}", e))?;
    
    listener.RemoveNotification(id)
        .map_err(|e| format!("Failed to dismiss notification: {}", e))
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn dismiss_notification(_id: u32) -> Result<(), String> {
    Err("Notifications not supported on this platform".to_string())
}
// =============================================================================
// Auto-Start Commands
// =============================================================================

/// Check if auto-start is enabled
#[tauri::command]
fn check_autostart_enabled(app: tauri::AppHandle) -> Result<bool, String> {
    #[cfg(desktop)]
    {
        use tauri_plugin_autostart::ManagerExt;
        app.autolaunch()
            .is_enabled()
            .map_err(|e| format!("Failed to check autostart status: {}", e))
    }
    #[cfg(not(desktop))]
    {
        Ok(false)
    }
}

/// Enable or disable auto-start
#[tauri::command]
fn set_autostart_enabled(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    #[cfg(desktop)]
    {
        use tauri_plugin_autostart::ManagerExt;
        let autostart = app.autolaunch();
        if enabled {
            autostart.enable()
                .map_err(|e| format!("Failed to enable autostart: {}", e))
        } else {
            autostart.disable()
                .map_err(|e| format!("Failed to disable autostart: {}", e))
        }
    }
    #[cfg(not(desktop))]
    {
        Ok(())
    }
}

// =============================================================================
// Battery Commands
// =============================================================================

/// Get battery status using Win32 GetSystemPowerStatus (no WinRT, no apartment init needed)
#[cfg(target_os = "windows")]
#[tauri::command]
fn get_battery_info() -> Result<BatteryInfo, String> {
    use windows::Win32::System::Power::{GetSystemPowerStatus, SYSTEM_POWER_STATUS};

    unsafe {
        let mut sps = SYSTEM_POWER_STATUS::default();
        GetSystemPowerStatus(&mut sps)
            .map_err(|e| format!("Failed to get power status: {}", e))?;

        // BatteryFlag bit 128 = no system battery present
        let has_battery = (sps.BatteryFlag & 128) == 0;

        if !has_battery {
            return Ok(BatteryInfo {
                percent: 0,
                is_charging: false,
                is_plugged_in: sps.ACLineStatus == 1,
                is_battery_saver: false,
                has_battery: false,
            });
        }

        // BatteryLifePercent: 0–100, or 255 when unknown
        let percent = if sps.BatteryLifePercent == 255 {
            0
        } else {
            sps.BatteryLifePercent as u32
        };

        // BATTERY_FLAG_CHARGING (0x08) = battery is actively receiving charge.
        // Windows CLEARS this flag once the battery is full, and laptops with battery
        // conservation modes (e.g. ASUS capped at 80%) also sit plugged-in-but-not-charging.
        // So track the AC cord separately via ACLineStatus (1 = online) and let the UI
        // show a plugged-in state even when no current is actually flowing.
        let is_charging = (sps.BatteryFlag & 0x08) != 0;
        let is_plugged_in = sps.ACLineStatus == 1;

        // SystemStatusFlag bit 1 = battery saver on
        let is_battery_saver = (sps.SystemStatusFlag & 1) != 0;

        Ok(BatteryInfo {
            percent,
            is_charging,
            is_plugged_in,
            is_battery_saver,
            has_battery: true,
        })
    }
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn get_battery_info() -> Result<BatteryInfo, String> {
    Ok(BatteryInfo {
        percent: 0,
        is_charging: false,
        is_plugged_in: false,
        is_battery_saver: false,
        has_battery: false,
    })
}

#[tauri::command]
fn get_platform_capabilities() -> platform::PlatformCapabilities {
    platform::current_capabilities()
}

// =============================================================================
// Privacy Indicators (camera / microphone in use)
//
// Windows records per-app capability usage under CapabilityAccessManager's
// ConsentStore. An app currently holding the device has LastUsedTimeStop == 0
// (it has started but not stopped). This is readable without package identity.
// =============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PrivacyStatus {
    pub camera_in_use: bool,
    pub microphone_in_use: bool,
    pub camera_apps: Vec<String>,
    pub microphone_apps: Vec<String>,
}

/// Turn a ConsentStore subkey name into something human readable.
/// Packaged apps appear as their PFN; desktop apps appear with `#` in place of `\`.
#[cfg(target_os = "windows")]
fn prettify_consent_app_name(raw: &str) -> String {
    let path = raw.replace('#', "\\");
    let leaf = path.rsplit('\\').next().unwrap_or(&path);
    let leaf = leaf.strip_suffix(".exe").unwrap_or(leaf);
    if leaf.is_empty() {
        return raw.to_string();
    }
    // Title-case the first letter for display ("chrome" -> "Chrome").
    let mut chars = leaf.chars();
    match chars.next() {
        Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
        None => leaf.to_string(),
    }
}

/// Scan one ConsentStore capability ("webcam" | "microphone") for apps that are
/// currently using it. Returns the display names of in-use apps.
#[cfg(target_os = "windows")]
fn scan_consent_store(capability: &str) -> Vec<String> {
    use windows::Win32::System::Registry::{
        RegOpenKeyExW, RegCloseKey, RegEnumKeyExW, RegQueryValueExW,
        HKEY, HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_READ, REG_VALUE_TYPE,
    };
    use windows::core::HSTRING;

    // An app is "in use" when LastUsedTimeStop is 0 while LastUsedTimeStart is set.
    unsafe fn read_u64_value(key: HKEY, name: &str) -> Option<u64> {
        let mut buf = [0u8; 8];
        let mut size = buf.len() as u32;
        let mut kind = REG_VALUE_TYPE::default();
        let status = RegQueryValueExW(
            key,
            &HSTRING::from(name),
            None,
            Some(&mut kind),
            Some(buf.as_mut_ptr()),
            Some(&mut size),
        );
        if status.is_ok() && size as usize == buf.len() {
            Some(u64::from_le_bytes(buf))
        } else {
            None
        }
    }

    /// Walk the direct children of `root_path`, plus one nested level for
    /// desktop apps (which live under a `NonPackaged` subkey).
    unsafe fn collect_in_use(root: HKEY, root_path: &str, out: &mut Vec<String>, recurse: bool) {
        let mut key = HKEY::default();
        if RegOpenKeyExW(root, &HSTRING::from(root_path), 0, KEY_READ, &mut key).is_err() {
            return;
        }
        let mut index = 0u32;
        loop {
            let mut name_buf = [0u16; 512];
            let mut name_len = name_buf.len() as u32;
            let status = RegEnumKeyExW(
                key,
                index,
                windows::core::PWSTR(name_buf.as_mut_ptr()),
                &mut name_len,
                None,
                windows::core::PWSTR::null(),
                None,
                None,
            );
            if status.is_err() {
                break;
            }
            index += 1;
            let child = String::from_utf16_lossy(&name_buf[..name_len as usize]);
            if child.is_empty() {
                continue;
            }
            let child_path = format!("{}\\{}", root_path, child);

            if recurse && child.eq_ignore_ascii_case("NonPackaged") {
                collect_in_use(root, &child_path, out, false);
                continue;
            }

            let mut child_key = HKEY::default();
            if RegOpenKeyExW(root, &HSTRING::from(child_path.as_str()), 0, KEY_READ, &mut child_key).is_ok() {
                let start = read_u64_value(child_key, "LastUsedTimeStart");
                let stop = read_u64_value(child_key, "LastUsedTimeStop");
                // Started at some point and never stopped => currently in use.
                if matches!(start, Some(s) if s > 0) && matches!(stop, Some(0)) {
                    let pretty = prettify_consent_app_name(&child);
                    if !out.iter().any(|existing| existing.eq_ignore_ascii_case(&pretty)) {
                        out.push(pretty);
                    }
                }
                let _ = RegCloseKey(child_key);
            }
        }
        let _ = RegCloseKey(key);
    }

    let path = format!(
        "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\{}",
        capability
    );
    let mut apps = Vec::new();
    unsafe {
        // Per-user consent store, then machine-wide (covers services/other users' apps).
        collect_in_use(HKEY_CURRENT_USER, &path, &mut apps, true);
        collect_in_use(HKEY_LOCAL_MACHINE, &path, &mut apps, true);
    }
    apps
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn get_privacy_status() -> Result<PrivacyStatus, String> {
    let camera_apps = scan_consent_store("webcam");
    let microphone_apps = scan_consent_store("microphone");
    Ok(PrivacyStatus {
        camera_in_use: !camera_apps.is_empty(),
        microphone_in_use: !microphone_apps.is_empty(),
        camera_apps,
        microphone_apps,
    })
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn get_privacy_status() -> Result<PrivacyStatus, String> {
    Ok(PrivacyStatus::default())
}

// =============================================================================
// Lock key states (Caps / Num / Scroll) — for glance confirmations
// =============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct LockKeyStates {
    pub caps_lock: bool,
    pub num_lock: bool,
    pub scroll_lock: bool,
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn get_lock_key_states() -> Result<LockKeyStates, String> {
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        GetKeyState, VK_CAPITAL, VK_NUMLOCK, VK_SCROLL,
    };
    // Low-order bit of GetKeyState = the toggle state for lock keys.
    unsafe {
        Ok(LockKeyStates {
            caps_lock: (GetKeyState(VK_CAPITAL.0 as i32) & 1) != 0,
            num_lock: (GetKeyState(VK_NUMLOCK.0 as i32) & 1) != 0,
            scroll_lock: (GetKeyState(VK_SCROLL.0 as i32) & 1) != 0,
        })
    }
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn get_lock_key_states() -> Result<LockKeyStates, String> {
    Ok(LockKeyStates::default())
}

// =============================================================================
// Weather (Open-Meteo — free, no API key)
// =============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WeatherInfo {
    pub temperature_c: f64,
    pub apparent_c: f64,
    pub weather_code: i64,
    pub is_day: bool,
    pub wind_kph: f64,
    pub humidity: i64,
    pub location: String,
    pub high_c: f64,
    pub low_c: f64,
}

/// Approximate the user's location from their IP. Open-Meteo needs coordinates and
/// Windows exposes no location API without package identity, so this is the
/// pragmatic path; it degrades to an error the UI can show rather than panicking.
async fn resolve_location() -> Result<(f64, f64, String), String> {
    let resp = HTTP_CLIENT
        .get("http://ip-api.com/json/?fields=status,city,regionName,lat,lon")
        .send()
        .await
        .map_err(|e| format!("Location lookup failed: {}", e))?;
    let json: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Location parse failed: {}", e))?;
    if json.get("status").and_then(|s| s.as_str()) != Some("success") {
        return Err("Location lookup unavailable".to_string());
    }
    let lat = json.get("lat").and_then(|v| v.as_f64()).ok_or("No latitude")?;
    let lon = json.get("lon").and_then(|v| v.as_f64()).ok_or("No longitude")?;
    let city = json
        .get("city")
        .and_then(|v| v.as_str())
        .unwrap_or("Current location")
        .to_string();
    Ok((lat, lon, city))
}

#[tauri::command]
async fn get_weather(latitude: Option<f64>, longitude: Option<f64>) -> Result<WeatherInfo, String> {
    // Explicit coordinates win; otherwise fall back to IP geolocation.
    let (lat, lon, location) = match (latitude, longitude) {
        (Some(la), Some(lo)) => (la, lo, format!("{:.2}, {:.2}", la, lo)),
        _ => resolve_location().await?,
    };

    let url = format!(
        "https://api.open-meteo.com/v1/forecast?latitude={}&longitude={}\
&current=temperature_2m,apparent_temperature,relative_humidity_2m,is_day,weather_code,wind_speed_10m\
&daily=temperature_2m_max,temperature_2m_min&forecast_days=1&timezone=auto",
        lat, lon
    );

    let resp = HTTP_CLIENT
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Weather request failed: {}", e))?;
    let json: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Weather parse failed: {}", e))?;

    let current = json.get("current").ok_or("Weather response missing current")?;
    let daily = json.get("daily");
    let first_daily = |key: &str| -> f64 {
        daily
            .and_then(|d| d.get(key))
            .and_then(|v| v.as_array())
            .and_then(|a| a.first())
            .and_then(|v| v.as_f64())
            .unwrap_or(f64::NAN)
    };

    let num = |key: &str| current.get(key).and_then(|v| v.as_f64()).unwrap_or(0.0);

    Ok(WeatherInfo {
        temperature_c: num("temperature_2m"),
        apparent_c: num("apparent_temperature"),
        weather_code: current.get("weather_code").and_then(|v| v.as_i64()).unwrap_or(0),
        is_day: current.get("is_day").and_then(|v| v.as_i64()).unwrap_or(1) == 1,
        wind_kph: num("wind_speed_10m"),
        humidity: current
            .get("relative_humidity_2m")
            .and_then(|v| v.as_i64())
            .unwrap_or(0),
        location,
        high_c: first_daily("temperature_2m_max"),
        low_c: first_daily("temperature_2m_min"),
    })
}

// =============================================================================
// Clipboard history (Win+V store)
// =============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ClipboardHistory {
    pub is_supported: bool,
    pub is_enabled: bool,
    pub items: Vec<ClipboardEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClipboardEntry {
    pub id: String,
    pub text: String,
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn get_clipboard_history() -> Result<ClipboardHistory, String> {
    use windows::ApplicationModel::DataTransfer::{
        Clipboard, ClipboardHistoryItemsResultStatus, StandardDataFormats,
    };

    let enabled = Clipboard::IsHistoryEnabled().unwrap_or(false);
    if !enabled {
        return Ok(ClipboardHistory { is_supported: true, is_enabled: false, items: Vec::new() });
    }

    let op = Clipboard::GetHistoryItemsAsync()
        .map_err(|e| format!("Clipboard history unavailable: {}", e))?;
    let result = op.get().map_err(|e| format!("Clipboard history failed: {}", e))?;

    if result.Status().map_err(|e| e.to_string())? != ClipboardHistoryItemsResultStatus::Success {
        return Ok(ClipboardHistory { is_supported: true, is_enabled: true, items: Vec::new() });
    }

    let mut entries = Vec::new();
    if let Ok(items) = result.Items() {
        let count = items.Size().unwrap_or(0);
        for i in 0..count.min(25) {
            let Ok(item) = items.GetAt(i) else { continue };
            let Ok(content) = item.Content() else { continue };
            // Only text entries are meaningful in a compact list.
            if !content.Contains(&StandardDataFormats::Text().unwrap_or_default()).unwrap_or(false) {
                continue;
            }
            let Ok(text_op) = content.GetTextAsync() else { continue };
            let Ok(text) = text_op.get() else { continue };
            let text = text.to_string();
            if text.trim().is_empty() {
                continue;
            }
            let id = item.Id().map(|i| i.to_string()).unwrap_or_else(|_| format!("clip-{}", i));
            entries.push(ClipboardEntry { id, text });
        }
    }

    Ok(ClipboardHistory { is_supported: true, is_enabled: true, items: entries })
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn get_clipboard_history() -> Result<ClipboardHistory, String> {
    Ok(ClipboardHistory::default())
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn set_clipboard_text(text: String) -> Result<(), String> {
    use windows::ApplicationModel::DataTransfer::{Clipboard, DataPackage};
    use windows::core::HSTRING;

    let package = DataPackage::new().map_err(|e| e.to_string())?;
    package.SetText(&HSTRING::from(text)).map_err(|e| e.to_string())?;
    Clipboard::SetContent(&package).map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn set_clipboard_text(_text: String) -> Result<(), String> {
    Err("Clipboard not supported on this platform".to_string())
}

// =============================================================================
// Multi-monitor support — enumerate displays and host the pill on a chosen one
// =============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MonitorInfo {
    pub name: String,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub scale_factor: f64,
    pub is_primary: bool,
}

#[tauri::command]
fn list_monitors(window: tauri::Window) -> Result<Vec<MonitorInfo>, String> {
    let monitors = window.available_monitors().map_err(|e| e.to_string())?;
    let primary = window.primary_monitor().ok().flatten();
    let primary_pos = primary.as_ref().map(|m| *m.position());

    Ok(monitors
        .iter()
        .enumerate()
        .map(|(index, m)| {
            let pos = m.position();
            let size = m.size();
            MonitorInfo {
                name: m.name().cloned().unwrap_or_else(|| format!("Display {}", index + 1)),
                x: pos.x,
                y: pos.y,
                width: size.width,
                height: size.height,
                scale_factor: m.scale_factor(),
                is_primary: primary_pos.map(|p| p == *pos).unwrap_or(index == 0),
            }
        })
        .collect())
}

/// Center the pill horizontally on a specific monitor, flush to its top edge.
/// Falls back to the primary display when the requested one is gone (unplugged),
/// which is the failure mode users hit most often with multi-monitor setups.
#[tauri::command]
fn move_to_monitor(window: tauri::Window, monitor_name: Option<String>) -> Result<(), String> {
    let monitors = window.available_monitors().map_err(|e| e.to_string())?;
    if monitors.is_empty() {
        return Err("No monitors available".to_string());
    }

    let target = monitor_name
        .as_ref()
        .and_then(|name| monitors.iter().find(|m| m.name().map(|n| n == name).unwrap_or(false)))
        .or_else(|| window.primary_monitor().ok().flatten().and_then(|p| {
            monitors.iter().find(|m| m.position() == p.position())
        }))
        .unwrap_or(&monitors[0]);

    let scale = target.scale_factor();
    let pos = target.position();
    let size = target.size();
    let win_size = window.outer_size().map_err(|e| e.to_string())?;

    // Work in logical coordinates so mixed-DPI setups land correctly.
    let mon_x = pos.x as f64 / scale;
    let mon_y = pos.y as f64 / scale;
    let mon_w = size.width as f64 / scale;
    let win_w = win_size.width as f64 / scale;

    window
        .set_position(tauri::Position::Logical(tauri::LogicalPosition {
            x: mon_x + (mon_w / 2.0) - (win_w / 2.0),
            y: mon_y,
        }))
        .map_err(|e| e.to_string())?;
    Ok(())
}

// =============================================================================
// Window backdrop — Mica / Acrylic (DWM)
// =============================================================================

#[cfg(target_os = "windows")]
#[tauri::command]
fn set_window_backdrop(window: tauri::Window, backdrop: String) -> Result<(), String> {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::Graphics::Dwm::{
        DwmSetWindowAttribute, DWMWA_SYSTEMBACKDROP_TYPE, DWMWA_USE_IMMERSIVE_DARK_MODE,
    };

    let hwnd = HWND(window.hwnd().map_err(|e| e.to_string())?.0 as _);

    // DWM_SYSTEMBACKDROP_TYPE: 1 = Auto, 2 = Mica, 3 = Acrylic, 4 = Mica Alt.
    // 0 (None) keeps our own painted glass, which is the default look.
    let backdrop_value: u32 = match backdrop.as_str() {
        "mica" => 2,
        "acrylic" => 3,
        "mica-alt" => 4,
        _ => 0,
    };

    unsafe {
        let dark: u32 = 1;
        // Dark mode first so the backdrop tints correctly against our dark UI.
        let _ = DwmSetWindowAttribute(
            hwnd,
            DWMWA_USE_IMMERSIVE_DARK_MODE,
            &dark as *const _ as *const std::ffi::c_void,
            std::mem::size_of::<u32>() as u32,
        );
        DwmSetWindowAttribute(
            hwnd,
            DWMWA_SYSTEMBACKDROP_TYPE,
            &backdrop_value as *const _ as *const std::ffi::c_void,
            std::mem::size_of::<u32>() as u32,
        )
        .map_err(|e| format!("Backdrop not supported on this Windows build: {}", e))?;
    }
    Ok(())
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn set_window_backdrop(_window: tauri::Window, _backdrop: String) -> Result<(), String> {
    Err("Window backdrop is Windows-only".to_string())
}

// =============================================================================
// Media: enumerate all sessions so the user can pick which app the pill controls
// =============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MediaSessionSummary {
    pub source_app_id: String,
    pub title: String,
    pub artist: String,
    pub is_playing: bool,
    pub is_current: bool,
}

/// User-selected media session. When set, media commands target this app instead
/// of whatever Windows considers "current".
static PREFERRED_MEDIA_SESSION: Lazy<std::sync::Mutex<Option<String>>> =
    Lazy::new(|| std::sync::Mutex::new(None));

#[cfg(target_os = "windows")]
#[tauri::command]
fn list_media_sessions() -> Result<Vec<MediaSessionSummary>, String> {
    let manager = GlobalSystemMediaTransportControlsSessionManager::RequestAsync()
        .map_err(|e| e.to_string())?
        .get()
        .map_err(|e| e.to_string())?;

    let sessions = manager.GetSessions().map_err(|e| e.to_string())?;
    let current_id = manager
        .GetCurrentSession()
        .ok()
        .and_then(|s| s.SourceAppUserModelId().ok())
        .map(|s| s.to_string());
    let preferred = PREFERRED_MEDIA_SESSION.lock().ok().and_then(|g| g.clone());

    let mut out = Vec::new();
    for session in sessions {
        let Ok(app_id) = session.SourceAppUserModelId() else { continue };
        let app_id = app_id.to_string();

        let (title, artist) = match session.TryGetMediaPropertiesAsync().and_then(|op| op.get()) {
            Ok(props) => (
                props.Title().map(|t| t.to_string()).unwrap_or_default(),
                props.Artist().map(|a| a.to_string()).unwrap_or_default(),
            ),
            Err(_) => (String::new(), String::new()),
        };

        let is_playing = session
            .GetPlaybackInfo()
            .and_then(|info| info.PlaybackStatus())
            .map(|s| s == GlobalSystemMediaTransportControlsSessionPlaybackStatus::Playing)
            .unwrap_or(false);

        let is_current = match &preferred {
            Some(p) => *p == app_id,
            None => current_id.as_deref() == Some(app_id.as_str()),
        };

        out.push(MediaSessionSummary { source_app_id: app_id, title, artist, is_playing, is_current });
    }
    Ok(out)
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn list_media_sessions() -> Result<Vec<MediaSessionSummary>, String> {
    Ok(Vec::new())
}

#[tauri::command]
fn set_preferred_media_session(source_app_id: Option<String>) -> Result<(), String> {
    let mut guard = PREFERRED_MEDIA_SESSION
        .lock()
        .map_err(|_| "Failed to lock preferred session".to_string())?;
    *guard = source_app_id;
    Ok(())
}

// =============================================================================
// Audio spectrum visualizer — WASAPI loopback capture -> FFT -> bars
//
// A background thread captures whatever is playing on the default render device
// (loopback, so it needs no microphone permission), runs an FFT, and folds the
// result into a small number of log-spaced bands the UI polls. Capture only runs
// while the UI is actually asking for it.
// =============================================================================

pub const SPECTRUM_BANDS: usize = 16;

static SPECTRUM_BARS: Lazy<std::sync::Mutex<Vec<f32>>> =
    Lazy::new(|| std::sync::Mutex::new(vec![0.0; SPECTRUM_BANDS]));
static SPECTRUM_RUNNING: AtomicBool = AtomicBool::new(false);
/// Bumped by the UI each time it polls; the capture thread stops once the UI
/// stops asking, so we never hold the audio device open in the background.
static SPECTRUM_LAST_REQUEST_MS: std::sync::atomic::AtomicU64 =
    std::sync::atomic::AtomicU64::new(0);

fn now_unix_ms() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[cfg(target_os = "windows")]
fn spectrum_capture_loop() {
    use windows::Win32::Media::Audio::{
        IAudioCaptureClient, IAudioClient, AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_LOOPBACK,
        WAVE_FORMAT_PCM,
    };
    use windows::Win32::System::Com::{CoInitializeEx, CoTaskMemFree, COINIT_MULTITHREADED};
    use rustfft::{num_complex::Complex, FftPlanner};

    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);

        let run = || -> Result<(), String> {
            let enumerator: IMMDeviceEnumerator =
                CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL).map_err(|e| e.to_string())?;
            let device: IMMDevice = enumerator
                .GetDefaultAudioEndpoint(eRender, eConsole)
                .map_err(|e| e.to_string())?;
            let client: IAudioClient =
                device.Activate(CLSCTX_ALL, None).map_err(|e| e.to_string())?;

            let format_ptr = client.GetMixFormat().map_err(|e| e.to_string())?;
            if format_ptr.is_null() {
                return Err("No mix format".into());
            }
            let format = *format_ptr;
            let channels = format.nChannels.max(1) as usize;
            let sample_rate = format.nSamplesPerSec.max(1);
            // The mix format is normally 32-bit float; bail out rather than
            // misinterpreting bytes if a device reports plain PCM.
            let is_float = format.wFormatTag != WAVE_FORMAT_PCM as u16 || format.wBitsPerSample == 32;

            // 200ms buffer, event-free (we poll) — plenty for a visualizer.
            client
                .Initialize(
                    AUDCLNT_SHAREMODE_SHARED,
                    AUDCLNT_STREAMFLAGS_LOOPBACK,
                    2_000_000,
                    0,
                    format_ptr,
                    None,
                )
                .map_err(|e| e.to_string())?;
            CoTaskMemFree(Some(format_ptr as *const std::ffi::c_void));

            let capture: IAudioCaptureClient = client.GetService().map_err(|e| e.to_string())?;
            client.Start().map_err(|e| e.to_string())?;

            const FFT_SIZE: usize = 1024;
            let mut planner = FftPlanner::<f32>::new();
            let fft = planner.plan_fft_forward(FFT_SIZE);
            let mut mono: Vec<f32> = Vec::with_capacity(FFT_SIZE * 2);
            // Hann window reduces spectral leakage so bars don't smear.
            let window: Vec<f32> = (0..FFT_SIZE)
                .map(|i| {
                    0.5 * (1.0 - (2.0 * std::f32::consts::PI * i as f32 / FFT_SIZE as f32).cos())
                })
                .collect();
            let mut smoothed = vec![0.0f32; SPECTRUM_BANDS];

            while SPECTRUM_RUNNING.load(Ordering::Relaxed) {
                // Stop if the UI stopped polling (tab closed / pill collapsed).
                if now_unix_ms().saturating_sub(SPECTRUM_LAST_REQUEST_MS.load(Ordering::Relaxed)) > 2000 {
                    break;
                }

                let mut packet = capture.GetNextPacketSize().unwrap_or(0);
                if packet == 0 {
                    thread::sleep(Duration::from_millis(8));
                    continue;
                }

                while packet > 0 {
                    let mut data_ptr = std::ptr::null_mut();
                    let mut frames = 0u32;
                    let mut flags = 0u32;
                    if capture
                        .GetBuffer(&mut data_ptr, &mut frames, &mut flags, None, None)
                        .is_err()
                    {
                        break;
                    }
                    if !data_ptr.is_null() && frames > 0 && is_float {
                        let samples =
                            std::slice::from_raw_parts(data_ptr as *const f32, frames as usize * channels);
                        // Downmix to mono.
                        for frame in samples.chunks_exact(channels) {
                            let sum: f32 = frame.iter().copied().sum();
                            mono.push(sum / channels as f32);
                        }
                    }
                    let _ = capture.ReleaseBuffer(frames);
                    packet = capture.GetNextPacketSize().unwrap_or(0);
                }

                while mono.len() >= FFT_SIZE {
                    let mut buffer: Vec<Complex<f32>> = mono[..FFT_SIZE]
                        .iter()
                        .zip(window.iter())
                        .map(|(s, w)| Complex { re: s * w, im: 0.0 })
                        .collect();
                    fft.process(&mut buffer);

                    // Fold the usable half of the spectrum into log-spaced bands —
                    // linear bins would put almost everything in the first bar.
                    let bins = FFT_SIZE / 2;
                    let min_hz = 40.0f32;
                    let max_hz = (sample_rate as f32 / 2.0).min(16_000.0);
                    let hz_per_bin = sample_rate as f32 / FFT_SIZE as f32;

                    for band in 0..SPECTRUM_BANDS {
                        let lo_hz = min_hz * (max_hz / min_hz).powf(band as f32 / SPECTRUM_BANDS as f32);
                        let hi_hz =
                            min_hz * (max_hz / min_hz).powf((band + 1) as f32 / SPECTRUM_BANDS as f32);
                        let lo = ((lo_hz / hz_per_bin) as usize).min(bins.saturating_sub(1));
                        let hi = ((hi_hz / hz_per_bin) as usize).clamp(lo + 1, bins);

                        let mut peak = 0.0f32;
                        for bin in lo..hi {
                            peak = peak.max(buffer[bin].norm());
                        }
                        // Log scale to dB-ish, normalized into 0..1.
                        let db = 20.0 * (peak + 1e-6).log10();
                        let norm = ((db + 70.0) / 70.0).clamp(0.0, 1.0);
                        // Fast attack, slow release reads better than raw values.
                        smoothed[band] = if norm > smoothed[band] {
                            norm
                        } else {
                            smoothed[band] * 0.82 + norm * 0.18
                        };
                    }

                    if let Ok(mut bars) = SPECTRUM_BARS.lock() {
                        bars.copy_from_slice(&smoothed);
                    }
                    mono.drain(..FFT_SIZE);
                }

                // Don't let a silent stream grow the buffer without bound.
                if mono.len() > FFT_SIZE * 8 {
                    let excess = mono.len() - FFT_SIZE;
                    mono.drain(..excess);
                }
            }

            let _ = client.Stop();
            Ok(())
        };

        if let Err(e) = run() {
            eprintln!("[WINDEYE] Audio visualizer unavailable: {}", e);
        }
    }

    // Decay to zero so the UI doesn't freeze on the last frame.
    if let Ok(mut bars) = SPECTRUM_BARS.lock() {
        for b in bars.iter_mut() {
            *b = 0.0;
        }
    }
    SPECTRUM_RUNNING.store(false, Ordering::Relaxed);
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn get_audio_spectrum() -> Result<Vec<f32>, String> {
    SPECTRUM_LAST_REQUEST_MS.store(now_unix_ms(), Ordering::Relaxed);

    // Lazily start the capture thread on first poll.
    if !SPECTRUM_RUNNING.swap(true, Ordering::SeqCst) {
        thread::spawn(spectrum_capture_loop);
    }

    let bars = SPECTRUM_BARS
        .lock()
        .map_err(|_| "Spectrum unavailable".to_string())?;
    Ok(bars.clone())
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn get_audio_spectrum() -> Result<Vec<f32>, String> {
    Ok(vec![0.0; SPECTRUM_BANDS])
}

// =============================================================================
// Bluetooth device battery
//
// Windows has no single API for this. The reliable path for modern devices is the
// BLE GATT Battery Service (0x180F / characteristic 0x2A19). Devices that only
// speak Classic Bluetooth (most headsets) don't expose it, so they're reported
// without a level rather than being hidden entirely.
// =============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BluetoothDevice {
    pub id: String,
    pub name: String,
    pub is_connected: bool,
    pub battery_percent: Option<u32>,
}

#[cfg(target_os = "windows")]
#[tauri::command]
async fn get_bluetooth_devices() -> Result<Vec<BluetoothDevice>, String> {
    use windows::Devices::Bluetooth::BluetoothLEDevice;
    use windows::Devices::Bluetooth::GenericAttributeProfile::{
        GattCharacteristicUuids, GattCommunicationStatus, GattServiceUuids,
    };
    use windows::Devices::Enumeration::DeviceInformation;
    use windows::Storage::Streams::DataReader;
    use windows::core::HSTRING;

    let selector = BluetoothLEDevice::GetDeviceSelectorFromConnectionStatus(
        windows::Devices::Bluetooth::BluetoothConnectionStatus::Connected,
    )
    .map_err(|e| e.to_string())?;

    let devices = DeviceInformation::FindAllAsyncAqsFilter(&selector)
        .map_err(|e| e.to_string())?
        .get()
        .map_err(|e| e.to_string())?;

    let mut out = Vec::new();
    let count = devices.Size().unwrap_or(0);
    for i in 0..count.min(16) {
        let Ok(info) = devices.GetAt(i) else { continue };
        let Ok(id) = info.Id() else { continue };
        let id = id.to_string();
        let name = info.Name().map(|n| n.to_string()).unwrap_or_default();
        if name.trim().is_empty() {
            continue;
        }

        let mut battery_percent = None;
        if let Ok(dev_op) = BluetoothLEDevice::FromIdAsync(&HSTRING::from(id.as_str())) {
            if let Ok(device) = dev_op.get() {
                if let (Ok(battery_uuid), Ok(level_uuid)) =
                    (GattServiceUuids::Battery(), GattCharacteristicUuids::BatteryLevel())
                {
                    if let Ok(services) = device
                        .GetGattServicesForUuidAsync(battery_uuid)
                        .and_then(|op| op.get())
                    {
                        if let Ok(service_list) = services.Services() {
                            if let Ok(service) = service_list.GetAt(0) {
                                if let Ok(chars) = service
                                    .GetCharacteristicsForUuidAsync(level_uuid)
                                    .and_then(|op| op.get())
                                {
                                    if let Ok(char_list) = chars.Characteristics() {
                                        if let Ok(ch) = char_list.GetAt(0) {
                                            if let Ok(read) =
                                                ch.ReadValueAsync().and_then(|op| op.get())
                                            {
                                                let ok = read
                                                    .Status()
                                                    .map(|s| s == GattCommunicationStatus::Success)
                                                    .unwrap_or(false);
                                                if ok {
                                                    if let Ok(value) = read.Value() {
                                                        if let Ok(reader) =
                                                            DataReader::FromBuffer(&value)
                                                        {
                                                            if let Ok(level) = reader.ReadByte() {
                                                                battery_percent =
                                                                    Some(level as u32);
                                                            }
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        out.push(BluetoothDevice { id, name, is_connected: true, battery_percent });
    }

    Ok(out)
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
async fn get_bluetooth_devices() -> Result<Vec<BluetoothDevice>, String> {
    Ok(Vec::new())
}

// =============================================================================
// Live Activities: download progress
//
// Browsers write partial files (.crdownload / .part / .download / .tmp) while a
// download is in flight and remove them on completion. Watching the Downloads
// folder for those gives a live progress activity with no browser integration.
// =============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadActivity {
    pub id: String,
    pub file_name: String,
    pub bytes: u64,
    pub is_active: bool,
}

#[tauri::command]
fn get_active_downloads() -> Result<Vec<DownloadActivity>, String> {
    let Some(dir) = downloads_dir() else {
        return Ok(Vec::new());
    };
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return Ok(Vec::new());
    };

    const PARTIAL_EXTS: [&str; 5] = ["crdownload", "part", "download", "partial", "tmp"];
    let mut out = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let Some(ext) = path.extension().and_then(|e| e.to_str()) else { continue };
        if !PARTIAL_EXTS.iter().any(|p| ext.eq_ignore_ascii_case(p)) {
            continue;
        }
        let bytes = entry.metadata().map(|m| m.len()).unwrap_or(0);
        let file_name = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("Download")
            .to_string();
        out.push(DownloadActivity {
            id: path.to_string_lossy().to_string(),
            file_name,
            bytes,
            is_active: true,
        });
        if out.len() >= 5 {
            break;
        }
    }
    Ok(out)
}

// =============================================================================
// Free pill repositioning
//
// The pill normally re-centers itself at the top of a display. When the user
// drags it, we store an explicit offset and honor that instead. Offsets are kept
// in logical pixels so they survive DPI changes, and are clamped to the visible
// work area so the pill can never be dragged off-screen and become unreachable.
// =============================================================================

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct PillPosition {
    pub x: f64,
    pub y: f64,
}

static CUSTOM_PILL_POSITION: Lazy<std::sync::Mutex<Option<PillPosition>>> =
    Lazy::new(|| std::sync::Mutex::new(None));

#[tauri::command]
fn set_pill_position(
    window: tauri::Window,
    x: f64,
    y: f64,
    persist: bool,
) -> Result<PillPosition, String> {
    let monitor = window
        .current_monitor()
        .map_err(|e| e.to_string())?
        .or(window.primary_monitor().map_err(|e| e.to_string())?)
        .ok_or_else(|| "No monitor available".to_string())?;

    let scale = monitor.scale_factor();
    let mon_pos = monitor.position();
    let mon_size = monitor.size();
    let win_size = window.outer_size().map_err(|e| e.to_string())?;

    let mon_x = mon_pos.x as f64 / scale;
    let mon_y = mon_pos.y as f64 / scale;
    let mon_w = mon_size.width as f64 / scale;
    let mon_h = mon_size.height as f64 / scale;
    let win_w = win_size.width as f64 / scale;
    let win_h = win_size.height as f64 / scale;

    // Keep at least part of the pill on screen in both axes.
    let clamped_x = x.clamp(mon_x - win_w / 2.0, mon_x + mon_w - win_w / 2.0);
    let clamped_y = y.clamp(mon_y, mon_y + mon_h - win_h.min(mon_h));

    window
        .set_position(tauri::Position::Logical(tauri::LogicalPosition {
            x: clamped_x,
            y: clamped_y,
        }))
        .map_err(|e| e.to_string())?;

    let result = PillPosition { x: clamped_x, y: clamped_y };
    if persist {
        if let Ok(mut guard) = CUSTOM_PILL_POSITION.lock() {
            *guard = Some(result);
        }
    }
    Ok(result)
}

#[tauri::command]
fn clear_pill_position() -> Result<(), String> {
    if let Ok(mut guard) = CUSTOM_PILL_POSITION.lock() {
        *guard = None;
    }
    Ok(())
}

#[tauri::command]
fn get_pill_position() -> Result<Option<PillPosition>, String> {
    Ok(CUSTOM_PILL_POSITION.lock().ok().and_then(|g| *g))
}

// =============================================================================
// Native flyout suppression
//
// Windows draws its own volume/brightness OSD inside the "Windows Shell
// Experience Host" CoreWindow. Without hiding it the user sees BOTH that flyout
// and ours — the "double flyout" problem. There is no API to disable the OSD, so
// the established technique (ModernFlyouts) is to watch that window and hide it
// whenever Windows makes it visible.
//
// This is opt-in and OFF by default: it hides a shell-owned window, the class and
// title are not contractual, and a future Windows build can move the OSD
// elsewhere. Turning it off restores normal behaviour immediately — we only ever
// call ShowWindow(SW_HIDE) on transitions, never permanently destroy anything.
// =============================================================================

static FLYOUT_SUPPRESSION_ENABLED: AtomicBool = AtomicBool::new(false);
static FLYOUT_SUPPRESSION_THREAD_STARTED: AtomicBool = AtomicBool::new(false);
/// Unix-ms deadline until which hiding is armed. The ShellExperienceHost
/// CoreWindow is visible even when no flyout is on screen (it hosts other shell
/// surfaces too), so hiding it unconditionally could take out unrelated UI.
/// Instead the frontend arms a short window whenever it raises its own HUD, and
/// we only hide during that window.
static FLYOUT_SUPPRESSION_UNTIL_MS: std::sync::atomic::AtomicU64 =
    std::sync::atomic::AtomicU64::new(0);

#[cfg(target_os = "windows")]
fn find_shell_osd_window() -> Option<windows::Win32::Foundation::HWND> {
    use windows::Win32::UI::WindowsAndMessaging::FindWindowW;
    use windows::core::HSTRING;

    unsafe {
        let hwnd = FindWindowW(
            &HSTRING::from("Windows.UI.Core.CoreWindow"),
            &HSTRING::from("Windows Shell Experience Host"),
        )
        .ok()?;
        if hwnd.0.is_null() {
            None
        } else {
            Some(hwnd)
        }
    }
}

#[cfg(target_os = "windows")]
fn flyout_suppression_loop() {
    use windows::Win32::UI::WindowsAndMessaging::{IsWindowVisible, ShowWindow, SW_HIDE};

    loop {
        if !FLYOUT_SUPPRESSION_ENABLED.load(Ordering::Relaxed)
            || now_unix_ms() > FLYOUT_SUPPRESSION_UNTIL_MS.load(Ordering::Relaxed)
        {
            thread::sleep(Duration::from_millis(120));
            continue;
        }

        // Re-resolve the handle each pass: ShellExperienceHost is restarted by the
        // OS from time to time, which invalidates a cached HWND.
        if let Some(hwnd) = find_shell_osd_window() {
            unsafe {
                if IsWindowVisible(hwnd).as_bool() {
                    let _ = ShowWindow(hwnd, SW_HIDE);
                }
            }
        }
        // Fast enough that the native flyout never gets a visible frame, cheap
        // enough to be invisible on a CPU graph.
        thread::sleep(Duration::from_millis(40));
    }
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn set_flyout_suppression(enabled: bool) -> Result<bool, String> {
    // Confirm the target window exists before claiming success, so the UI can tell
    // the user when this Windows build doesn't expose the expected host window.
    let found = find_shell_osd_window().is_some();
    FLYOUT_SUPPRESSION_ENABLED.store(enabled && found, Ordering::Relaxed);

    if enabled && found && !FLYOUT_SUPPRESSION_THREAD_STARTED.swap(true, Ordering::SeqCst) {
        thread::spawn(flyout_suppression_loop);
    }
    Ok(found)
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn set_flyout_suppression(_enabled: bool) -> Result<bool, String> {
    Ok(false)
}

/// Arm hiding for a short window. Called by the frontend the moment it raises its
/// own HUD, so the native flyout is only suppressed while ours is on screen.
#[tauri::command]
fn arm_flyout_suppression(duration_ms: Option<u64>) -> Result<(), String> {
    if !FLYOUT_SUPPRESSION_ENABLED.load(Ordering::Relaxed) {
        return Ok(());
    }
    let window_ms = duration_ms.unwrap_or(1800).min(5000);
    FLYOUT_SUPPRESSION_UNTIL_MS.store(now_unix_ms() + window_ms, Ordering::Relaxed);
    Ok(())
}

// =============================================================================
// Synced lyrics (LRCLIB — free, no API key, no auth)
//
// Tries the exact-match endpoint first; it 404s for anything not in the database,
// so we fall back to a search and take the best result that actually has synced
// lyrics. Returns the raw LRC text for the frontend to parse and time.
// =============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct LyricsResult {
    pub synced: Option<String>,
    pub plain: Option<String>,
    pub track_name: String,
    pub artist_name: String,
}

#[tauri::command]
async fn get_lyrics(
    artist: String,
    title: String,
    album: Option<String>,
    duration_sec: Option<u64>,
) -> Result<Option<LyricsResult>, String> {
    if artist.trim().is_empty() && title.trim().is_empty() {
        return Ok(None);
    }

    let build = |v: &serde_json::Value| LyricsResult {
        synced: v
            .get("syncedLyrics")
            .and_then(|s| s.as_str())
            .filter(|s| !s.trim().is_empty())
            .map(|s| s.to_string()),
        plain: v
            .get("plainLyrics")
            .and_then(|s| s.as_str())
            .filter(|s| !s.trim().is_empty())
            .map(|s| s.to_string()),
        track_name: v.get("trackName").and_then(|s| s.as_str()).unwrap_or(&title).to_string(),
        artist_name: v.get("artistName").and_then(|s| s.as_str()).unwrap_or(&artist).to_string(),
    };

    // 1) Exact match, which also lets LRCLIB pick the right take by duration.
    let mut url = format!(
        "https://lrclib.net/api/get?artist_name={}&track_name={}",
        urlencode(&artist),
        urlencode(&title)
    );
    if let Some(a) = album.as_ref().filter(|a| !a.trim().is_empty()) {
        url.push_str(&format!("&album_name={}", urlencode(a)));
    }
    if let Some(d) = duration_sec {
        url.push_str(&format!("&duration={}", d));
    }

    if let Ok(resp) = HTTP_CLIENT.get(&url).send().await {
        if resp.status().is_success() {
            if let Ok(json) = resp.json::<serde_json::Value>().await {
                let result = build(&json);
                if result.synced.is_some() || result.plain.is_some() {
                    return Ok(Some(result));
                }
            }
        }
    }

    // 2) Fall back to search; prefer a hit that actually has synced lyrics.
    let search_url = format!(
        "https://lrclib.net/api/search?q={}",
        urlencode(&format!("{} {}", artist, title).trim().to_string())
    );
    let resp = HTTP_CLIENT
        .get(&search_url)
        .send()
        .await
        .map_err(|e| format!("Lyrics search failed: {}", e))?;
    if !resp.status().is_success() {
        return Ok(None);
    }
    let results: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Lyrics parse failed: {}", e))?;
    let Some(items) = results.as_array() else { return Ok(None) };

    let best = items
        .iter()
        .find(|v| {
            v.get("syncedLyrics")
                .and_then(|s| s.as_str())
                .map(|s| !s.trim().is_empty())
                .unwrap_or(false)
        })
        .or_else(|| items.first());

    Ok(best.map(build))
}

/// Minimal percent-encoding for query values (no extra dependency needed).
fn urlencode(input: &str) -> String {
    let mut out = String::with_capacity(input.len() * 3);
    for byte in input.as_bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(*byte as char)
            }
            b' ' => out.push_str("%20"),
            other => out.push_str(&format!("%{:02X}", other)),
        }
    }
    out
}

/// Open Explorer with the given file selected. Used by the file shelf.
#[cfg(target_os = "windows")]
#[tauri::command]
fn reveal_in_explorer(path: String) -> Result<(), String> {
    let p = std::path::Path::new(&path);
    if !p.exists() {
        return Err("File no longer exists".to_string());
    }
    std::process::Command::new("explorer")
        .arg("/select,")
        .arg(&path)
        .spawn()
        .map_err(|e| format!("Failed to open Explorer: {}", e))?;
    Ok(())
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn reveal_in_explorer(_path: String) -> Result<(), String> {
    Err("Reveal is Windows-only".to_string())
}

fn downloads_dir() -> Option<std::path::PathBuf> {
    // USERPROFILE\Downloads is correct for the default configuration; a relocated
    // Downloads folder simply yields no activities rather than failing.
    let profile = std::env::var("USERPROFILE").ok()?;
    let dir = std::path::Path::new(&profile).join("Downloads");
    if dir.is_dir() {
        Some(dir)
    } else {
        None
    }
}

fn productivity_backup_path() -> std::path::PathBuf {
    let app_data = std::env::var("APPDATA").unwrap_or_else(|_| ".".to_string());
    std::path::Path::new(&app_data)
        .join("WINDEYE")
        .join("productivity-backup.json")
}

fn parse_workflow_action_id(id: &str) -> Option<workflows::WorkflowActionId> {
    match id {
        "toggle_expand" => Some(workflows::WorkflowActionId::ToggleExpand),
        "open_timer_tab" => Some(workflows::WorkflowActionId::OpenTimerTab),
        "open_media_tab" => Some(workflows::WorkflowActionId::OpenMediaTab),
        "open_notifications_tab" => Some(workflows::WorkflowActionId::OpenNotificationsTab),
        "open_settings_tab" => Some(workflows::WorkflowActionId::OpenSettingsTab),
        "open_prism_tab" => Some(workflows::WorkflowActionId::OpenPrismTab),
        "open_productivity_tab" => Some(workflows::WorkflowActionId::OpenProductivityTab),
        "quick_add_task" => Some(workflows::WorkflowActionId::QuickAddTask),
        _ => None,
    }
}

fn register_global_shortcuts(app: &tauri::AppHandle) {
    let mappings = [
        ("Alt+Shift+P", workflows::WorkflowActionId::OpenProductivityTab),
        ("Alt+Shift+A", workflows::WorkflowActionId::OpenPrismTab),
        ("Alt+Shift+Space", workflows::WorkflowActionId::ToggleExpand),
    ];

    for (shortcut, action) in mappings {
        let _ = (&app, &action);
        eprintln!(
            "[WINDEYE] Global shortcut mapping reserved: {} -> {:?} (no-op baseline)",
            shortcut, action
        );
    }
}

fn validate_snapshot_internal(snapshot: &sync::ProductivitySnapshotEnvelope) -> sync::SyncValidationResult {
    let adapter = sync::StubSyncAdapter;
    sync::SyncAdapter::validate_snapshot(&adapter, snapshot)
}

#[tauri::command]
fn validate_productivity_snapshot(
    snapshot: sync::ProductivitySnapshotEnvelope,
) -> Result<sync::SyncValidationResult, String> {
    Ok(validate_snapshot_internal(&snapshot))
}

#[tauri::command]
fn export_productivity_backup(
    snapshot: sync::ProductivitySnapshotEnvelope,
) -> Result<sync::SyncValidationResult, String> {
    let validation = validate_snapshot_internal(&snapshot);
    if !validation.valid {
        return Ok(validation);
    }

    let path = productivity_backup_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(&snapshot).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| e.to_string())?;
    Ok(validation)
}

#[tauri::command]
fn import_productivity_backup(apply: bool) -> Result<sync::ImportBackupResult, String> {
    let path = productivity_backup_path();
    if !path.exists() {
        return Ok(sync::ImportBackupResult {
            validation: sync::SyncValidationResult {
                valid: false,
                conflicts: vec![sync::SyncConflictInfo {
                    reason: "validation_error".to_string(),
                    message: "No productivity backup file found.".to_string(),
                }],
            },
            snapshot: None,
        });
    }

    let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let snapshot: sync::ProductivitySnapshotEnvelope =
        serde_json::from_str(&content).map_err(|e| e.to_string())?;
    let validation = validate_snapshot_internal(&snapshot);
    if !validation.valid {
        return Ok(sync::ImportBackupResult {
            validation,
            snapshot: None,
        });
    }

    Ok(sync::ImportBackupResult {
        validation,
        snapshot: if apply { Some(snapshot) } else { None },
    })
}

#[tauri::command]
fn dispatch_workflow_action(
    app: tauri::AppHandle,
    action_id: String,
    args: Option<serde_json::Value>,
) -> Result<(), String> {
    let id = parse_workflow_action_id(&action_id)
        .ok_or_else(|| format!("Unknown workflow action: {}", action_id))?;
    workflows::emit_action(&app, id, "ui", args);
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
/// One-time migration: the app was renamed PILLAR -> WINDEYE, which moved its
/// data directory. Copy any files from the legacy %APPDATA%\PILLAR folder into
/// %APPDATA%\WINDEYE (without overwriting anything already there) so settings
/// and backups survive the rename.
fn migrate_legacy_pillar_dir() {
    let Ok(app_data) = std::env::var("APPDATA") else { return };
    let old_dir = std::path::Path::new(&app_data).join("PILLAR");
    let new_dir = std::path::Path::new(&app_data).join("WINDEYE");
    if !old_dir.is_dir() {
        return;
    }
    let _ = std::fs::create_dir_all(&new_dir);
    if let Ok(entries) = std::fs::read_dir(&old_dir) {
        for entry in entries.flatten() {
            let src = entry.path();
            if src.is_file() {
                let dst = new_dir.join(entry.file_name());
                if !dst.exists() {
                    let _ = std::fs::copy(&src, &dst);
                }
            }
        }
    }
}

pub fn run() {
    migrate_legacy_pillar_dir();
    let mut builder = tauri::Builder::default();

    #[cfg(target_os = "windows")]
    {
        builder = builder.plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ));
    }

    // Global hotkeys. Shortcuts are registered from the frontend (so they can be
    // user-configurable); each press is forwarded as a `global-hotkey` event that
    // the pill maps to an action.
    #[cfg(desktop)]
    {
        use tauri::Emitter;
        builder = builder.plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state() == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                        let _ = app.emit("global-hotkey", shortcut.to_string());
                    }
                })
                .build(),
        );
    }

    builder
        .invoke_handler(tauri::generate_handler![
            set_click_through,
            resize_window,
            position_window,
            resize_and_center,
            is_foreground_fullscreen,
            get_foreground_app,
            get_system_stats,
            get_scale_factor,
            // Media session
            get_media_session,
            media_play_pause,
            media_next,
            media_previous,
            // Volume control
            get_system_volume,
            set_system_volume,
            toggle_mute,
            // Audio devices
            list_audio_devices,
            get_default_audio_device,
            // Per-app volume
            list_audio_sessions,
            set_session_volume,
            set_session_mute,
            // Brightness control
            get_system_brightness,
            set_system_brightness,
            // Notifications
            check_notification_access,
            get_notifications,
            dismiss_notification,
            activate_notification,
            activate_app_by_aumid,
            // Auto-start
            check_autostart_enabled,
            set_autostart_enabled,
            // Battery
            get_battery_info,
            // Platform capabilities
            get_platform_capabilities,
            // Settings persistence
            load_settings,
            save_settings,
            // Productivity backup/sync skeleton
            validate_productivity_snapshot,
            export_productivity_backup,
            import_productivity_backup,
            // Workflow dispatch
            dispatch_workflow_action,
            // Album art accent color
            extract_accent_color,
            // Media timeline & controls
            get_media_timeline,
            seek_media,
            get_media_playback_info,
            media_toggle_repeat,
            media_toggle_shuffle,
            pause_other_sessions,
            // Prism AI
            prism_chat,
            // Cursor hit-testing for click-through (set_click_through is registered above)
            get_cursor_in_window,
            // Privacy indicators (camera / mic in use)
            get_privacy_status,
            // Lock key glances
            get_lock_key_states,
            // Weather
            get_weather,
            // Clipboard history
            get_clipboard_history,
            set_clipboard_text,
            // Multi-monitor
            list_monitors,
            move_to_monitor,
            // Theming
            set_window_backdrop,
            // Media session switching
            list_media_sessions,
            set_preferred_media_session,
            // Audio spectrum visualizer
            get_audio_spectrum,
            // Bluetooth device battery
            get_bluetooth_devices,
            // Live activities
            get_active_downloads,
            // File shelf
            reveal_in_explorer,
            // Synced lyrics
            get_lyrics,
            // Free pill repositioning
            set_pill_position,
            clear_pill_position,
            get_pill_position,
            // Native flyout suppression
            set_flyout_suppression,
            arm_flyout_suppression
        ])
        .setup(|app| {
            // Desktop-only UX (tray icon / window positioning). Mobile builds should skip this.
            #[cfg(desktop)]
            {
                // System tray routes through deterministic workflow IDs.
                let expand_i = MenuItem::with_id(app, "workflow_toggle_expand", "Toggle Expand", true, None::<&str>)
                    .map_err(|e| e.to_string())?;
                let open_prod_i = MenuItem::with_id(app, "workflow_open_productivity", "Open Productivity", true, None::<&str>)
                    .map_err(|e| e.to_string())?;
                let open_prism_i = MenuItem::with_id(app, "workflow_open_prism", "Open Prism", true, None::<&str>)
                    .map_err(|e| e.to_string())?;
                let quick_task_i = MenuItem::with_id(app, "workflow_quick_task", "Quick Add Task", true, None::<&str>)
                    .map_err(|e| e.to_string())?;
                let quit_i = MenuItem::with_id(app, "quit", "Quit WINDEYE", true, None::<&str>)
                    .map_err(|e| e.to_string())?;
                let menu = Menu::with_items(
                    app,
                    &[&expand_i, &open_prod_i, &open_prism_i, &quick_task_i, &quit_i],
                )
                .map_err(|e| e.to_string())?;
                let mut tray_builder = TrayIconBuilder::new()
                    .menu(&menu)
                    .show_menu_on_left_click(true)
                    .on_menu_event(move |app, event| {
                        match event.id.as_ref() {
                            "workflow_toggle_expand" => {
                                workflows::emit_action(
                                    app,
                                    workflows::WorkflowActionId::ToggleExpand,
                                    "tray",
                                    None,
                                );
                            }
                            "workflow_open_productivity" => {
                                workflows::emit_action(
                                    app,
                                    workflows::WorkflowActionId::OpenProductivityTab,
                                    "tray",
                                    None,
                                );
                            }
                            "workflow_open_prism" => {
                                workflows::emit_action(
                                    app,
                                    workflows::WorkflowActionId::OpenPrismTab,
                                    "tray",
                                    None,
                                );
                            }
                            "workflow_quick_task" => {
                                workflows::emit_action(
                                    app,
                                    workflows::WorkflowActionId::QuickAddTask,
                                    "tray",
                                    Some(serde_json::json!({ "title": "Tray quick task" })),
                                );
                            }
                            "quit" => {
                                app.exit(0);
                            }
                            _ => {}
                        }
                    });

                if let Some(icon) = app.default_window_icon() {
                    tray_builder = tray_builder.icon(icon.clone());
                }

                let _tray = tray_builder
                    .build(app)
                    .map_err(|e| e.to_string())?;

                register_global_shortcuts(&app.handle());

                // Window positioning is a desktop API; ignore failures.
                if let Some(window) = app.get_webview_window("main") {
                    if let Ok(Some(monitor)) = window.primary_monitor() {
                        let monitor_size = monitor.size();
                        let scale_factor = monitor.scale_factor();
                        let window_width = 450.0;
                        let x = (monitor_size.width as f64 / scale_factor) / 2.0 - window_width / 2.0;
                        let _ = window.set_position(tauri::Position::Logical(tauri::LogicalPosition {
                            x,
                            y: 0.0,
                        }));
                    }
                }
            }

            #[cfg(target_os = "windows")]
            {
                match UserNotificationListener::Current() {
                    Ok(listener) => {
                        match poll_notification_access() {
                            Ok(UserNotificationListenerAccessStatus::Allowed) => {
                                NOTIFICATION_ACCESS_GRANTED.store(true, Ordering::Relaxed);
                                let app_handle = app.handle().clone();
                                let _ = subscribe_notification_changed(&listener, &app_handle);
                            }
                            Ok(status) => {
                                eprintln!("[WINDEYE] Notification access not granted: {:?}", status);
                                eprintln!("[WINDEYE] Enable notification access in Windows Settings > Privacy > Notifications");
                            }
                            Err(e) => {
                                eprintln!("[WINDEYE] Failed to check notification access: {}", e);
                            }
                        }
                    }
                    Err(e) => {
                        eprintln!("[WINDEYE] Failed to get UserNotificationListener: {:?}", e);
                        eprintln!("[WINDEYE] Notifications will still work via polling fallback");
                    }
                }
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
