import { tauriInvoke } from "../tauri";
import { UNKNOWN_CAPABILITIES, type PlatformCapabilities } from "./types";
import type { WorkflowActionId } from "../../types/workflows";

let cachedCapabilities: PlatformCapabilities | null = null;

function inferCapabilitiesFromUserAgent(): PlatformCapabilities {
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes("windows")) {
    return {
      platform: "windows",
      mediaSession: true,
      mediaControls: true,
      notifications: true,
      audioDevices: true,
      perAppMixer: true,
      battery: true,
      brightness: true,
    };
  }
  if (ua.includes("mac os")) {
    return {
      platform: "macos",
      mediaSession: true,
      mediaControls: true,
      notifications: false,
      audioDevices: false,
      perAppMixer: false,
      battery: true,
      brightness: false,
    };
  }
  if (ua.includes("linux")) {
    return {
      platform: "linux",
      mediaSession: true,
      mediaControls: true,
      notifications: false,
      audioDevices: false,
      perAppMixer: false,
      battery: true,
      brightness: false,
    };
  }
  return UNKNOWN_CAPABILITIES;
}

export const platformApi = {
  async getCapabilities(): Promise<PlatformCapabilities> {
    if (cachedCapabilities) return cachedCapabilities;
    try {
      const fromBackend = await tauriInvoke<PlatformCapabilities>("get_platform_capabilities");
      cachedCapabilities = fromBackend ?? inferCapabilitiesFromUserAgent();
      return cachedCapabilities;
    } catch {
      cachedCapabilities = inferCapabilitiesFromUserAgent();
      return cachedCapabilities;
    }
  },

  async getMediaSession() {
    return tauriInvoke<{
      title: string;
      artist: string;
      album?: string;
      is_playing: boolean;
      app_name?: string;
    } | null>("get_media_session");
  },
  async getMediaTimeline() {
    return tauriInvoke<{ position_ms: number; duration_ms: number; can_seek: boolean } | null>("get_media_timeline");
  },
  async getMediaPlaybackInfo() {
    return tauriInvoke<{ repeat_mode: string; is_shuffle: boolean } | null>("get_media_playback_info");
  },
  async mediaPlayPause() {
    return tauriInvoke("media_play_pause");
  },
  async mediaNext() {
    return tauriInvoke("media_next");
  },
  async mediaPrevious() {
    return tauriInvoke("media_previous");
  },
  async mediaToggleRepeat() {
    return tauriInvoke("media_toggle_repeat");
  },
  async mediaToggleShuffle() {
    return tauriInvoke("media_toggle_shuffle");
  },
  async seekMedia(positionMs: number) {
    return tauriInvoke("seek_media", { positionMs });
  },
  async pauseOtherSessions() {
    return tauriInvoke("pause_other_sessions");
  },

  async checkNotificationAccess() {
    return tauriInvoke<boolean>("check_notification_access");
  },
  async getNotifications() {
    return tauriInvoke<Array<{
      id: number;
      app_name: string;
      title: string;
      body: string;
      timestamp: number;
      aumid: string | null;
    }>>("get_notifications");
  },
  async dismissNotification(id: number) {
    return tauriInvoke("dismiss_notification", { id });
  },
  async activateNotification(id: number) {
    return tauriInvoke("activate_notification", { id });
  },
  async activateAppByAumid(aumid: string) {
    return tauriInvoke("activate_app_by_aumid", { aumid });
  },

  async listAudioDevices() {
    return tauriInvoke<Array<{ id: string; name: string; is_default: boolean }>>("list_audio_devices");
  },
  async listAudioSessions() {
    return tauriInvoke<Array<{
      session_id: string;
      app_name: string;
      process_id: number;
      volume: number;
      is_muted: boolean;
      is_active: boolean;
    }>>("list_audio_sessions");
  },
  async setSessionVolume(processId: number, level: number) {
    return tauriInvoke("set_session_volume", { processId, level });
  },
  async setSessionMute(processId: number, muted: boolean) {
    return tauriInvoke("set_session_mute", { processId, muted });
  },

  async getSystemBrightness() {
    return tauriInvoke<{ level: number; min: number; max: number; is_supported: boolean }>("get_system_brightness");
  },
  async setSystemBrightness(level: number) {
    return tauriInvoke("set_system_brightness", { level });
  },
  async getBatteryInfo() {
    return tauriInvoke<{
      percent: number;
      is_charging: boolean;
      is_plugged_in?: boolean;
      is_battery_saver: boolean;
      has_battery: boolean;
    }>("get_battery_info");
  },

  async getPrivacyStatus() {
    return tauriInvoke<{
      camera_in_use: boolean;
      microphone_in_use: boolean;
      camera_apps: string[];
      microphone_apps: string[];
    }>("get_privacy_status");
  },

  async getLockKeyStates() {
    return tauriInvoke<{
      caps_lock: boolean;
      num_lock: boolean;
      scroll_lock: boolean;
    }>("get_lock_key_states");
  },

  async getWeather(latitude?: number, longitude?: number) {
    return tauriInvoke<{
      temperature_c: number;
      apparent_c: number;
      weather_code: number;
      is_day: boolean;
      wind_kph: number;
      humidity: number;
      location: string;
      high_c: number;
      low_c: number;
    }>("get_weather", { latitude: latitude ?? null, longitude: longitude ?? null });
  },

  async getClipboardHistory() {
    return tauriInvoke<{
      is_supported: boolean;
      is_enabled: boolean;
      items: Array<{ id: string; text: string }>;
    }>("get_clipboard_history");
  },
  async setClipboardText(text: string) {
    return tauriInvoke("set_clipboard_text", { text });
  },

  async listMonitors() {
    return tauriInvoke<Array<{
      name: string;
      x: number;
      y: number;
      width: number;
      height: number;
      scale_factor: number;
      is_primary: boolean;
    }>>("list_monitors");
  },
  async moveToMonitor(monitorName: string | null) {
    return tauriInvoke("move_to_monitor", { monitorName });
  },

  async setWindowBackdrop(backdrop: string) {
    return tauriInvoke("set_window_backdrop", { backdrop });
  },

  async listMediaSessions() {
    return tauriInvoke<Array<{
      source_app_id: string;
      title: string;
      artist: string;
      is_playing: boolean;
      is_current: boolean;
    }>>("list_media_sessions");
  },
  async setPreferredMediaSession(sourceAppId: string | null) {
    return tauriInvoke("set_preferred_media_session", { sourceAppId });
  },

  async getAudioSpectrum() {
    return tauriInvoke<number[]>("get_audio_spectrum");
  },

  async getBluetoothDevices() {
    return tauriInvoke<Array<{
      id: string;
      name: string;
      is_connected: boolean;
      battery_percent: number | null;
    }>>("get_bluetooth_devices");
  },

  async setPillPosition(x: number, y: number, persist: boolean) {
    return tauriInvoke<{ x: number; y: number }>("set_pill_position", { x, y, persist });
  },
  async clearPillPosition() {
    return tauriInvoke("clear_pill_position");
  },
  async getPillPosition() {
    return tauriInvoke<{ x: number; y: number } | null>("get_pill_position");
  },

  async setFlyoutSuppression(enabled: boolean) {
    return tauriInvoke<boolean>("set_flyout_suppression", { enabled });
  },
  async armFlyoutSuppression(durationMs?: number) {
    return tauriInvoke("arm_flyout_suppression", { durationMs: durationMs ?? null });
  },

  async getLyrics(artist: string, title: string, album?: string, durationSec?: number) {
    return tauriInvoke<{
      synced: string | null;
      plain: string | null;
      track_name: string;
      artist_name: string;
    } | null>("get_lyrics", {
      artist,
      title,
      album: album ?? null,
      durationSec: durationSec ?? null,
    });
  },

  async revealInExplorer(path: string) {
    return tauriInvoke("reveal_in_explorer", { path });
  },

  async getActiveDownloads() {
    return tauriInvoke<Array<{
      id: string;
      file_name: string;
      bytes: number;
      is_active: boolean;
    }>>("get_active_downloads");
  },

  async getSystemVolume() {
    return tauriInvoke<{ level: number; is_muted: boolean }>("get_system_volume");
  },
  async setSystemVolume(level: number) {
    return tauriInvoke("set_system_volume", { level });
  },
  async toggleMute() {
    return tauriInvoke<boolean>("toggle_mute");
  },
  async dispatchWorkflowAction(actionId: WorkflowActionId, args?: Record<string, unknown>) {
    return tauriInvoke("dispatch_workflow_action", { actionId, args });
  },
};
