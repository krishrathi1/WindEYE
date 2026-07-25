import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, useSpring, useTransform, AnimatePresence } from "motion/react";
import { usePillState } from "../../hooks/usePillState";
import { useTimer } from "../../hooks/useTimer";
import { useMediaSession } from "../../hooks/useMediaSession";
import { useVolume } from "../../hooks/useVolume";
import { useAutoStart } from "../../hooks/useAutoStart";
import { useBrightness } from "../../hooks/useBrightness";
import { useAudioDevices } from "../../hooks/useAudioDevices";
import { usePerAppMixer } from "../../hooks/usePerAppMixer";
import { useNotifications } from "../../hooks/useNotifications";
import { useBattery } from "../../hooks/useBattery";
import { usePrismAI } from "../../hooks/usePrismAI";
import { useProductivity } from "../../hooks/useProductivity";
import { useAppearance, hexToRgba } from "../../hooks/useAppearance";
import { useSettings } from "../../hooks/useSettings";
import { useAdaptivePolling } from "../../hooks/useAdaptivePolling";
import { useScreenReader, useAnnounceListChange, ScreenReaderLiveRegions } from "../../hooks/useScreenReader";
import { useDesktopGestures } from "../../hooks/useDesktopGestures";
import { useWorkflowEvents } from "../../hooks/useWorkflowEvents";
import { NotificationToast, NotificationsList, NotificationIndicator } from "./modules/NotificationModule";
import { BatteryIndicator } from "./modules/BatteryModule";
import { springConfig, pillDimensions, bootAnimationDuration, idleSlotAnimations, getPillTargetStyle, type PillVisualState, PILL_DURATION_FAST, microInteractions } from "./animations";
import { TimerExpanded } from "./modules/TimerModule";
import { MediaExpanded, MediaIndicator } from "./modules/MediaModule";
import { QuickSettings } from "./modules/VolumeModule";
import { PrismModule } from "./modules/PrismModule";
import { ProductivityModule } from "./modules/ProductivityModule";
import { SystemMonitor } from "./modules/SystemMonitor";
import { StateIndicators, TimerMiniProgress } from "./indicators/StateIndicators";
import { PrivacyIndicators, PrivacyDetail } from "./modules/PrivacyIndicators";
import { WeatherCompact, WeatherExpanded } from "./modules/WeatherModule";
import { ClipboardExpanded } from "./modules/ClipboardModule";
import { HudOverlay } from "./modules/HudOverlay";
import { AudioVisualizer, AudioVisualizerMini } from "./modules/AudioVisualizer";
import { LiveActivityCompact, LiveActivitiesExpanded } from "./modules/LiveActivities";
import { ShelfExpanded } from "./modules/ShelfModule";
import { DisplaySettings } from "./modules/DisplaySettings";
import { MinimalBubble } from "./MinimalBubble";
import { LyricsExpanded } from "./modules/LyricsModule";
import { useLyrics } from "../../hooks/useLyrics";
import { usePillDrag } from "../../hooks/usePillDrag";
import { usePrivacyIndicators } from "../../hooks/usePrivacyIndicators";
import { useHudOverlay } from "../../hooks/useHudOverlay";
import { useLockKeys } from "../../hooks/useLockKeys";
import { useAudioSpectrum } from "../../hooks/useAudioSpectrum";
import { useLiveActivities } from "../../hooks/useLiveActivities";
import { useBluetoothDevices } from "../../hooks/useBluetoothDevices";
import { useFileShelf } from "../../hooks/useFileShelf";
import { useGlobalHotkeys } from "../../hooks/useGlobalHotkeys";
import { useWeather } from "../../hooks/useWeather";
import { useClipboardHistory } from "../../hooks/useClipboardHistory";
import { createFocusTrap } from "../../utils/focusTrap";
import { tauriInvoke } from "../../lib/tauri";
import { platformApi } from "../../lib/platform";
import type { PrismAction } from "../../types/prism";
import type { WorkflowActionEnvelope } from "../../types/workflows";
import { createPillThemeTokens, resolveReducedMotion } from "./themeTokens";

const TIMER_NOTIFICATION_TITLE = "WINDEYE Timer Complete";

// Tab type for expanded view
type ExpandedTab = "timer" | "media" | "notifications" | "settings" | "prism" | "productivity" | "clipboard" | "shelf" | "lyrics";
const EXPANDED_TAB_CONFIG: Array<{ id: ExpandedTab; label: string; icon: string; ariaLabel: string; hasBadge?: boolean }> = [
  { id: "timer", label: "Timer", icon: "⏱", ariaLabel: "Timer module" },
  { id: "media", label: "Media", icon: "🎵", ariaLabel: "Media controls" },
  { id: "notifications", label: "Notifs", icon: "🔔", ariaLabel: "Notifications", hasBadge: true },
  { id: "settings", label: "Settings", icon: "⚙", ariaLabel: "Settings" },
  { id: "productivity", label: "Focus", icon: "✓", ariaLabel: "Productivity module" },
  { id: "clipboard", label: "Clips", icon: "📋", ariaLabel: "Clipboard history" },
  { id: "lyrics", label: "Lyrics", icon: "🎤", ariaLabel: "Synced lyrics" },
  { id: "shelf", label: "Shelf", icon: "📎", ariaLabel: "File shelf" },
  { id: "prism", label: "Prism", icon: "AI", ariaLabel: "Prism AI assistant" },
];

// Helper to get current time string
const getTimeString = () => {
  const now = new Date();
  return now.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });
};

const getDateString = () => {
  return new Date().toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
};

const getSecondsString = () => {
  return new Date().getSeconds().toString().padStart(2, "0");
};

// Summarize backup/import conflicts into an actionable sentence (count + first
// human-readable reason) instead of a dead-end "needs attention" message.
function describeBackupConflicts(
  result: { conflicts?: Array<{ message?: string }> } | null | undefined
): string {
  const conflicts = result?.conflicts ?? [];
  if (conflicts.length === 0) return " Check your network or storage and try again.";
  const first = conflicts[0]?.message;
  return ` ${conflicts.length} conflict${conflicts.length === 1 ? "" : "s"}.${first ? ` ${first}` : ""} Review before applying.`;
}

// True when focus is on an editable field inside the panel that holds unsaved
// (non-empty) text. Used to avoid collapsing the panel mid-edit, which would
// unmount the module and silently discard the user's typed task/note/event.
function panelHasUnsavedDraft(container: HTMLElement | null): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el || !container || !container.contains(el)) return false;
  const editable =
    el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable;
  if (!editable) return false;
  const value = (el as HTMLInputElement).value ?? el.textContent ?? "";
  return value.trim().length > 0;
}

export function Pill() {
  const {
    isBooting,
    isIdle,
    isHovering,
    isExpanded,
    handleMouseEnter,
    handleMouseLeave,
    handleClick,
    handleClickOutside,
    expand: expandPill,
    completeBootAnimation,
    // Content state API
    backgroundStates,
    setTimerState,
    setTimerAlert,
  } = usePillState();
  
  // Adaptive polling for reduced CPU usage
  const { triggerActivity } = useAdaptivePolling({
    baseInterval: 5000,
    activeInterval: 1000,
    idleThreshold: 30000,
    deepSleepInterval: 15000,
    deepSleepThreshold: 300000,
  });

  // Screen reader support. The live regions are rendered by THIS component (see
  // the top of the return) so they reflect the same instance that announce() drives.
  // (Previously App.tsx rendered the regions against a separate, never-announced instance.)
  const { announce, politeAnnouncement, assertiveAnnouncement } = useScreenReader({
    defaultPriority: "polite",
    announcementDelay: 100,
    deduplicate: true,
    deduplicationWindow: 5000,
  });
  const announceListChange = useAnnounceListChange(announce);

  // Timer hook
  const {
    timer,
    stats: timerStats,
    categories: timerCategories,
    selectedCategory: selectedTimerCategory,
    setSelectedCategory: setSelectedTimerCategory,
    presets,
    startTimer,
    pauseTimer,
    resumeTimer,
    stopTimer,
    dismissAlert,
    formatTime,
    progress: timerProgress,
  } = useTimer(
    // On timer update - sync to content state
    (timerState) => {
      if (timerState.isActive) {
        setTimerState({
          label: timerState.label,
          totalSeconds: timerState.totalSeconds,
          remainingSeconds: timerState.remainingSeconds,
          isPaused: timerState.isPaused,
        });
      } else if (!timerState.isComplete) {
        setTimerState(null);
      }
    },
    // On timer complete - show alert
    (label) => {
      setTimerState(null);
      setTimerAlert({ label, completedAt: Date.now() });
      void sendTimerCompletionNotification(label);
    }
  );

  const ensureTimerNotificationPermission = useCallback(async (): Promise<NotificationPermission | "unsupported"> => {
    if (typeof window === "undefined" || typeof Notification === "undefined") {
      return "unsupported";
    }
    if (Notification.permission === "granted" || Notification.permission === "denied") {
      return Notification.permission;
    }
    try {
      return await Notification.requestPermission();
    } catch {
      return "denied";
    }
  }, []);

  const sendTimerCompletionNotification = useCallback(
    async (label: string) => {
      const permission = await ensureTimerNotificationPermission();
      if (permission !== "granted") return;

      const desktopNotification = new Notification(TIMER_NOTIFICATION_TITLE, {
        body: `${label} finished. Time's up.`,
        tag: `windeye-timer-${label.toLowerCase().replace(/\s+/g, "-")}`,
        requireInteraction: true,
      });

      desktopNotification.onclick = () => {
        window.focus();
        desktopNotification.close();
      };

      window.setTimeout(() => {
        desktopNotification.close();
      }, 15000);
    },
    [ensureTimerNotificationPermission]
  );

  const startTimerWithNotification = useCallback(
    (preset: Parameters<typeof startTimer>[0]) => {
      // Don't request OS notification permission here — popping the permission
      // dialog the instant a timer starts is intrusive. It's requested lazily on
      // first completion (sendTimerCompletionNotification). The in-app "Done!"
      // alert fires regardless, so denying notifications never loses the signal.
      startTimer(preset);
    },
    [startTimer]
  );

  // Dismiss timer alert
  const handleDismissAlert = () => {
    dismissAlert();
    setTimerAlert(null);
  };

  // Media session hook
  const {
    media,
    recentSources,
    timeline,
    playbackInfo,
    playPause,
    next: mediaNext,
    previous: mediaPrevious,
    toggleRepeat,
    toggleShuffle,
    seekTo,
    pauseOtherSessions,
  } = useMediaSession(1500); // Poll every 1.5s (reduced from 600ms to avoid saturating backend)

  // Volume hook
  const {
    volume,
    setVolume,
    toggleMute,
  } = useVolume(5000); // Poll every 5 seconds

  // Auto-start hook
  const {
    isEnabled: autoStartEnabled,
    setEnabled: setAutoStartEnabled,
  } = useAutoStart();

  // Brightness hook
  const {
    brightness,
    setBrightness,
  } = useBrightness(10000); // Poll every 10 seconds

  // Audio devices hook
  const {
    devices: audioDevices,
    defaultDevice: defaultAudioDevice,
  } = useAudioDevices(15000); // Poll every 15s (devices rarely change; reduced from 5s)

  // Per-app mixer hook
  const {
    sessions: audioSessions,
    setSessionVolume,
    setSessionMute,
  } = usePerAppMixer(8000); // Poll every 8s (heavy COM operation; reduced from 3s)

  // Notifications hook
  const {
    notifications,
    history: notificationHistory,
    hasAccess: hasNotificationAccess,
    latestNotification,
    notificationPhase,
    isNewNotification,
    dismissNotification,
    clearLatest: clearLatestNotification,
    clearHistory: clearNotificationHistory,
  } = useNotifications(); // Real-time via Windows NotificationChanged event; fallback poll every 30s

  // Battery hook
  const {
    battery,
    isLow: isBatteryLow,
    isCritical: isBatteryCritical,
  } = useBattery(5000); // Poll every 5s so plug/unplug shows up promptly

  // Camera / microphone in-use dots (Apple-style privacy indicators)
  const privacy = usePrivacyIndicators(4000);
  // Each dot is 7px wide plus the 4px flex gap that precedes it.
  const privacyIndicatorWidth =
    (privacy.cameraInUse ? 11 : 0) + (privacy.microphoneInUse ? 11 : 0);

  // Weather (Open-Meteo, refreshed every 15 minutes)
  const { weather, isLoading: isWeatherLoading, error: weatherError, refresh: refreshWeather } = useWeather();

  const {
    state: productivity,
    addTask,
    toggleTask,
    removeTask,
    addNote,
    updateNote,
    removeNote,
    addAgendaEvent,
    clearCompletedTasks,
    exportBackup,
    importBackup,
  } = useProductivity();

  // Appearance settings (mode, opacity, accent color)
  const appearance = useAppearance();
  const isNotch = appearance.active.mode === "notch";

  // Centralized settings (motion, behavior, timer persistence)
  const { settings: appSettings, update: updateSettings } = useSettings();

  // Album art accent color polling
  const [albumAccentColor, setAlbumAccentColor] = useState<string | null>(null);
  useEffect(() => {
    if (!appearance.active.useAlbumAccent || !media) {
      setAlbumAccentColor(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const result = await tauriInvoke<{ r: number; g: number; b: number }>("extract_accent_color");
        if (!cancelled && result) {
          const hex = `#${result.r.toString(16).padStart(2, "0")}${result.g.toString(16).padStart(2, "0")}${result.b.toString(16).padStart(2, "0")}`;
          setAlbumAccentColor(hex);
        }
      } catch {
        // extract_accent_color not available or failed — ignore
      }
    })();
    return () => { cancelled = true; };
  }, [appearance.active.useAlbumAccent, media?.title, media?.artist]);

  // Effective accent color: album art override or user setting
  const effectiveAccentColor = (appearance.active.useAlbumAccent && albumAccentColor) ? albumAccentColor : appearance.active.accentColor;

  // Auto-pause other sessions when a new session starts playing
  const prevMediaTitleRef = useRef<string | null>(null);
  useEffect(() => {
    if (!appSettings.behavior.pause_other_sessions || !media?.isPlaying) return;
    const currentTitle = media.title;
    if (prevMediaTitleRef.current !== null && prevMediaTitleRef.current !== currentTitle) {
      platformApi.pauseOtherSessions().catch(() => {});
    }
    prevMediaTitleRef.current = currentTitle;
  }, [media?.title, media?.isPlaying, appSettings.behavior.pause_other_sessions]);

  // Active-app awareness for Prism — Pilly-style "knows what you're working on",
  // done privately: active window title + exe name only, opt-in, persisted locally.
  // Default on; resolved on demand at send time (no background polling).
  const [activeAppContext, setActiveAppContext] = useState<boolean>(() => {
    try {
      return localStorage.getItem("windeye_prism_active_app") !== "off";
    } catch {
      return true;
    }
  });
  const toggleActiveAppContext = useCallback((enabled: boolean) => {
    setActiveAppContext(enabled);
    try {
      localStorage.setItem("windeye_prism_active_app", enabled ? "on" : "off");
    } catch {
      /* ignore storage errors */
    }
  }, []);

  const {
    messages: prismMessages,
    actions: prismActions,
    actionMode: prismActionMode,
    usage: prismUsage,
    isLoading: prismLoading,
    error: prismError,
    setActionMode: setPrismActionMode,
    setActions: setPrismActions,
    clearChat: clearPrismChat,
    sendMessage: sendPrismMessage,
  } = usePrismAI({
    timer,
    media,
    volume,
    brightness,
    notifications,
    audioSessions,
    autoStartEnabled,
    battery,
    productivitySummary: {
      taskCount: productivity.tasks.length,
      completedTaskCount: productivity.tasks.filter((task) => task.completed).length,
      noteCount: productivity.notes.length,
      upcomingEventCount: productivity.calendarEvents.filter((event) => event.startsAt >= Date.now()).length,
    },
    includeActiveApp: activeAppContext,
    activeApp: null,
  });

  // Whether to show notification badge in the pill
  const hasNotificationBadge = appSettings.layout.idle_indicators.notifications && notifications.length > 0 &&
    (notificationPhase === "showing" || notificationPhase === "idle");
  const themeTokens = createPillThemeTokens({ ...appearance.active, accentColor: effectiveAccentColor });
  const reducedMotion = resolveReducedMotion(appSettings.motion.reduced_motion_override);
  // The Settings tab is always kept accessible: the only control to toggle tab
  // visibility lives inside Settings itself, so hiding it would lock the user out
  // of ever re-enabling any tab. All other tabs honor the visible_tabs prefs.
  const visibleTabs = EXPANDED_TAB_CONFIG.filter(
    (tab) => tab.id === "settings" || appSettings.layout.visible_tabs[tab.id]
  );
  const safeTabs = visibleTabs.length > 0 ? visibleTabs : EXPANDED_TAB_CONFIG;

  const containerRef = useRef<HTMLDivElement>(null);
  const expandedContentRef = useRef<HTMLDivElement>(null);
  const pillToggleRef = useRef<HTMLDivElement>(null);
  const [bootPhase, setBootPhase] = useState<"dot" | "morph" | "complete">("dot");
  const [activeTab, setActiveTab] = useState<ExpandedTab>("timer");

  // Clipboard history only polls while its tab is open (WinRT async round-trip).
  const clipboard = useClipboardHistory(isExpanded && activeTab === "clipboard");

  // Synced lyrics — fetched once per track, timed against the media position.
  const lyrics = useLyrics({
    enabled: isExpanded && activeTab === "lyrics",
    title: media?.title,
    artist: media?.artist,
    album: media?.album,
    durationMs: timeline?.durationMs,
    positionMs: timeline?.positionMs ?? 0,
  });

  // File shelf — drag files onto the pill to park them.
  const shelf = useFileShelf(true);

  // Free repositioning: drag the collapsed pill anywhere on screen.
  const pillDrag = usePillDrag(!isExpanded);



  // Live Activities (downloads today; the hook accepts custom producers too).
  const { activities } = useLiveActivities(true);
  const primaryActivity = activities[0] ?? null;

  // Lock keys drive the Caps/Num Lock HUD glances.
  const lockKeys = useLockKeys(true);

  // Audio spectrum: only capture while something is playing and the pill is visible.
  const spectrumEnabled = Boolean(media?.isPlaying);
  const spectrumBars = useAudioSpectrum(spectrumEnabled);

  // Bluetooth device battery (polled gently; GATT reads wake the radio).
  const bluetoothDevices = useBluetoothDevices(isExpanded && activeTab === "settings");

  // Global hotkeys — work even when the pill isn't focused.
  useGlobalHotkeys(true, {
    toggle_expand: () => (isExpanded ? handleClickOutside() : expandPill()),
    media_play_pause: () => { void playPause(); },
    media_next: () => { void mediaNext(); },
    media_previous: () => { void mediaPrevious(); },
    open_clipboard: () => {
      expandPill();
      setActiveTab("clipboard");
    },
    start_timer: () => {
      expandPill();
      setActiveTab("timer");
    },
  });

  // HUD: volume / brightness / lock-key changes surface inside the pill instead of
  // relying on the OS flyout. Suppressed while expanded so it can't cover content.
  const hud = useHudOverlay({
    volume: volume.level,
    isMuted: volume.isMuted,
    brightness: brightness.level,
    capsLock: lockKeys.capsLock,
    numLock: lockKeys.numLock,
    enabled: !isExpanded,
  });
  const [notificationsView, setNotificationsView] = useState<"live" | "history">("live");
  const [time, setTime] = useState(getTimeString);
  const [dateStr, setDateStr] = useState(getDateString);
  const [seconds, setSeconds] = useState(getSecondsString);
  const panelTransitionDuration = reducedMotion ? 0.08 : PILL_DURATION_FAST;

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--windeye-surface-primary", themeTokens.surfacePrimary);
    root.style.setProperty("--windeye-surface-secondary", themeTokens.surfaceSecondary);
    root.style.setProperty("--windeye-border", themeTokens.borderColor);
    root.style.setProperty("--windeye-text", themeTokens.textPrimary);
    root.style.setProperty("--windeye-text-muted", themeTokens.textMuted);
    root.style.setProperty("--windeye-accent", themeTokens.accent);
    root.style.setProperty("--windeye-shadow", themeTokens.shadow);
  }, [themeTokens]);

  // Clock ticks whenever pill is shown (after boot) so time is always correct
  // Pause only when document is hidden (window minimized) to save CPU
  const shouldTickClock = !isBooting;

  useEffect(() => {
    if (!shouldTickClock) return;

    const tick = () => {
      // setTime/setDateStr are no-ops via React's same-value bailout when the
      // minute/day hasn't changed, so collapsed ticks don't re-render. Seconds,
      // however, change every tick AND are only shown in the expanded header — so
      // only update them while expanded. This stops a full per-second re-render of
      // the whole Pill while it sits collapsed (the common state).
      setTime(getTimeString());
      setDateStr(getDateString());
      if (isExpanded) setSeconds(getSecondsString());
    };

    // Initial sync
    tick();

    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [shouldTickClock, isExpanded]);

  // When app becomes visible again, sync time immediately
  useEffect(() => {
    if (!shouldTickClock) return;
    const onVisibilityChange = () => {
      if (!document.hidden) {
        setTime(getTimeString());
        setDateStr(getDateString());
        setSeconds(getSecondsString());
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [shouldTickClock]);

  // Determine what to show based on active content state
  const hasTimerActive = timer.isActive || timer.isComplete;
  const hasTimerAlert = timer.isComplete;
  const hasMediaPlaying = media?.isPlaying ?? false;
  const showTimerInIdle = hasTimerActive && !isExpanded;


  const showMediaInIdle = hasMediaPlaying && !isExpanded && appSettings.layout.idle_indicators.media;

  // Minimal (two-activity) presentation. The pill shows the leading activity
  // inline; a SECOND concurrent activity detaches into a bubble beside it. Only
  // one bubble is shown — beyond two activities the rest stay in the expanded
  // list, matching how Apple caps the collapsed presentation.
  const secondaryActivity = useMemo<
    { key: string; icon: string; label: string; progress?: number; tab: ExpandedTab } | null
  >(() => {
    // The pill's inline slot is taken by media when playing, otherwise by the
    // leading live activity. Whatever is NOT inline becomes the bubble.
    const mediaInline = showMediaInIdle;

    if (mediaInline && hasTimerActive) {
      return {
        key: "timer",
        icon: timer.isPaused ? "⏸" : "⏱",
        label: `Timer: ${formatTime(timer.remainingSeconds)}`,
        progress: timerProgress,
        tab: "timer",
      };
    }
    if (mediaInline && primaryActivity) {
      return {
        key: primaryActivity.id,
        icon: primaryActivity.icon,
        label: `${primaryActivity.title}${primaryActivity.subtitle ? ` · ${primaryActivity.subtitle}` : ""}`,
        progress: primaryActivity.progress,
        tab: "settings",
      };
    }
    // No media inline: a timer and a download can still co-exist.
    if (hasTimerActive && primaryActivity) {
      return {
        key: primaryActivity.id,
        icon: primaryActivity.icon,
        label: `${primaryActivity.title}${primaryActivity.subtitle ? ` · ${primaryActivity.subtitle}` : ""}`,
        progress: primaryActivity.progress,
        tab: "settings",
      };
    }
    return null;
  }, [
    showMediaInIdle,
    hasTimerActive,
    timer.isPaused,
    timer.remainingSeconds,
    timerProgress,
    primaryActivity,
    formatTime,
  ]);

  // Whether to show battery indicator in the idle pill
  const showBatteryInIdle = battery.hasBattery && appSettings.layout.idle_indicators.battery;

  // Accessible name for the COLLAPSED pill. The visual idle content (clock, timer
  // countdown, "Done!", battery, notification count) is otherwise invisible to AT,
  // which would only hear a static "WINDEYE Dynamic Island, button". Composed on
  // focus via aria-label (not a live region) so the clock doesn't spam SR every second.
  const collapsedAriaLabel = useMemo(() => {
    const parts = [`WINDEYE. ${time}.`];
    if (timer.isComplete) parts.push("Timer finished.");
    else if (timer.isActive) parts.push(`Timer ${formatTime(timer.remainingSeconds)} remaining.`);
    if (notifications.length > 0) parts.push(`${notifications.length} notification${notifications.length === 1 ? "" : "s"}.`);
    if (battery.hasBattery) {
      const power = battery.isCharging ? ", charging" : battery.isPluggedIn ? ", plugged in" : "";
      parts.push(`Battery ${battery.percent}%${power}.`);
    }
    return parts.join(" ");
  }, [time, timer.isComplete, timer.isActive, timer.remainingSeconds, formatTime, notifications.length, battery.hasBattery, battery.percent, battery.isCharging, battery.isPluggedIn]);

  useEffect(() => {
    if (!safeTabs.some((t) => t.id === activeTab)) {
      setActiveTab(safeTabs[0].id);
    }
  }, [activeTab, safeTabs]);

  const goToTab = useCallback((direction: -1 | 1) => {
    const ids = safeTabs.map((tab) => tab.id);
    const currentIndex = ids.indexOf(activeTab);
    const startIndex = currentIndex >= 0 ? currentIndex : 0;
    const nextIndex = direction === 1
      ? (startIndex + 1) % ids.length
      : (startIndex - 1 + ids.length) % ids.length;
    setActiveTab(ids[nextIndex]);
  }, [activeTab, safeTabs]);

  const { handlers: gestureHandlers, contextMenu, closeContextMenu } = useDesktopGestures({
    enabled: true,
    reducedMotion,
    onSwipeLeft: () => {
      if (isExpanded) goToTab(1);
    },
    onSwipeRight: () => {
      if (isExpanded) goToTab(-1);
    },
    onLongPress: () => {
      if (!isExpanded && (isHovering || isIdle)) {
        handleClick();
      }
    },
  });

  // Snappy spring so hover-in and unhover-out feel the same. When reduced motion is
  // requested, use a near-instant spring so the pill resize snaps without a bouncy morph.
  const pillSpring = reducedMotion ? { stiffness: 1000, damping: 100, mass: 0.1 } : springConfig.snappy;
  const width = useSpring(pillDimensions.boot.width, pillSpring);
  const height = useSpring(pillDimensions.boot.height, pillSpring);
  const borderRadiusTop = useSpring(pillDimensions.boot.borderRadius, pillSpring);
  const borderRadiusBottom = useSpring(pillDimensions.boot.borderRadius, pillSpring);
  const shadowOpacity = useSpring(0.2, pillSpring);

  // Combined borderRadius: top-left top-right bottom-right bottom-left.
  //
  // The radius is derived from the LIVE height so the collapsed pill is always a
  // mathematically perfect stadium (semicircular ends = height / 2) at every size
  // and mid-morph — not just when the separate radius spring happens to have
  // settled. It's capped at the expanded panel's corner (28px) so the tall
  // expanded state stays a rounded rectangle instead of a giant lozenge.
  // The top/bottom springs are still consulted for notch mode: when the top
  // radius is driven to 0 the top corners stay square (flush to the screen edge).
  const EXPANDED_MAX_RADIUS = pillDimensions.expanded.borderRadius;
  const borderRadius = useTransform(
    [height, borderRadiusTop, borderRadiusBottom],
    ([h, t, b]: number[]) => {
      const perfect = Math.min(h / 2, EXPANDED_MAX_RADIUS);
      const top = t <= 0.5 ? 0 : perfect; // notch keeps square top corners
      const bottom = b <= 0.5 ? 0 : perfect;
      return `${top}px ${top}px ${bottom}px ${bottom}px`;
    }
  );

  // Static blur: animating the backdrop-filter radius forced a full-rect Gaussian
  // blur recompute every spring frame on the always-on-top layered window. The
  // idle↔hover delta (10↔14px) is imperceptible, so a constant blur is used.
  const backdropFilter = "blur(12px)";
  // No outer shadow at all: any drop shadow painted a dark halo onto whatever sat
  // behind the transparent window. Only the subtle inset top highlight remains for
  // a hint of depth; the 1px border already separates the pill from the background.
  const boxShadow = useTransform(
    shadowOpacity,
    () => `inset 0 1px 1px rgba(255, 255, 255, 0.1)`
  );

  // Boot animation sequence
  useEffect(() => {
    if (!isBooting) return;

    // Reduced motion: skip the ~1.15s dot→morph→zoom flourish that gates all
    // interaction at launch. Snap straight to idle so the pill is usable immediately.
    if (reducedMotion) {
      width.set(pillDimensions.idle.width);
      height.set(pillDimensions.idle.height);
      borderRadiusBottom.set(pillDimensions.idle.borderRadius);
      borderRadiusTop.set(isNotch ? 0 : pillDimensions.idle.borderRadius);
      setBootPhase("complete");
      completeBootAnimation();
      return;
    }

    const sequence = async () => {
      // Phase 1: Dot appears
      await new Promise((r) => setTimeout(r, bootAnimationDuration.dotAppear));

      // Phase 2: Morph to pill (idle size)
      setBootPhase("morph");
      width.set(pillDimensions.idle.width);
      height.set(pillDimensions.idle.height);
      borderRadiusBottom.set(pillDimensions.idle.borderRadius);
      borderRadiusTop.set(isNotch ? 0 : pillDimensions.idle.borderRadius);

      await new Promise((r) => setTimeout(r, bootAnimationDuration.morphToPill));

      // Phase 3: Zoom in like hover, then back out
      width.set(pillDimensions.hover.width);
      height.set(pillDimensions.hover.height);
      borderRadiusBottom.set(pillDimensions.hover.borderRadius);
      borderRadiusTop.set(isNotch ? 0 : pillDimensions.hover.borderRadius);
      shadowOpacity.set(0.25);

      await new Promise((r) => setTimeout(r, 350));

      // Complete → settles back to idle size
      setBootPhase("complete");
      completeBootAnimation();
    };

    sequence();
  }, [isBooting, width, height, borderRadiusTop, borderRadiusBottom, isNotch, shadowOpacity, completeBootAnimation, reducedMotion]);

  // Single place for hover/expanded/unhover: one visual state → one target style
  const visualState: PillVisualState = isExpanded ? "expanded" : isHovering ? "hover" : "idle";

  // Update dimensions from current visual state (keeps animations smooth, logic simple)
  useEffect(() => {
    if (isBooting) return;
    const target = getPillTargetStyle(visualState, {
      hasMedia: showMediaInIdle,
      hasBattery: showBatteryInIdle,
      hasNotifications: hasNotificationBadge,
    });
    width.set(target.width);
    height.set(target.height);
    borderRadiusBottom.set(target.borderRadius);
    borderRadiusTop.set(isNotch ? 0 : target.borderRadius);
    shadowOpacity.set(target.shadow);
  }, [isBooting, visualState, isNotch, showMediaInIdle, showBatteryInIdle, hasNotificationBadge, width, height, borderRadiusTop, borderRadiusBottom, shadowOpacity]);

  // Keep window always receiving clicks so the pill is clickable.
  // (Enabling click-through when idle would block mouseenter, so we'd never get hover/click.)
  useEffect(() => {
    const setClickThrough = async (ignore: boolean) => {
      const ok = await tauriInvoke("set_click_through", { ignore });
      if (ok === null) {
        console.error("Failed to set click through");
      }
    };
    setClickThrough(false);
  }, []);

  // Resize and re-center window when expanded or when notification toast is showing (so toast isn't clipped)
  const showNotificationToast = !isExpanded && (notificationPhase === "incoming" || notificationPhase === "absorbing") && !!latestNotification;
  // Compute actual idle pill width based on active indicators (matches getPillTargetStyle logic)
  const idlePillWidth = isExpanded
    ? pillDimensions.expanded.width
    : getPillTargetStyle("idle", {
        hasMedia: showMediaInIdle,
        hasBattery: showBatteryInIdle,
        hasNotifications: hasNotificationBadge,
      }).width;
  useEffect(() => {
    const resizeAndCenter = async () => {
      const pillWidth = isExpanded ? pillDimensions.expanded.width : idlePillWidth;
      const pillHeight = isExpanded ? pillDimensions.expanded.height : pillDimensions.idle.height;
      // Toast is 300-380px wide, so the window must be wide enough to contain it
      const w = showNotificationToast
        ? Math.max(pillWidth + 60, 420)
        : pillWidth + 60;
      // Toast needs: 10px gap + ~120px toast height + 20px breathing room = ~150px below pill
      // When collapsed, leave a small margin below the pill so its (subtle) shadow
      // isn't clipped flat. This area doesn't block clicks: the click-through effect
      // passes events outside the pill straight through to the window behind.
      const extraHeight = isExpanded ? 100 : (showNotificationToast ? 160 : 8);
      const h = pillHeight + extraHeight;
      const ok = await tauriInvoke("resize_and_center", { width: w, height: h });
      if (ok === null) {
        console.error("Failed to resize/position window");
      }
    };

    resizeAndCenter();
  }, [isExpanded, showNotificationToast, idlePillWidth]);

  // Click-through: the window is wider/taller than the visible pill (margins for
  // hover growth + shadow), and those transparent margins were swallowing clicks
  // meant for apps behind. Keep the window interactive only while the cursor is
  // actually over the pill; otherwise let the OS pass events through. While
  // click-through is on the webview gets no mouse events, so we poll the cursor
  // position from the backend and hit-test the pill bounds ourselves.
  const clickThroughRef = useRef<boolean | null>(null);
  useEffect(() => {
    const setClickThrough = (ignore: boolean) => {
      if (clickThroughRef.current === ignore) return;
      clickThroughRef.current = ignore;
      void tauriInvoke("set_click_through", { ignore });
    };

    // Any state where the pill needs guaranteed interaction: stay interactive.
    if (isExpanded || showNotificationToast || isBooting) {
      setClickThrough(false);
      return;
    }

    const PAD = 10; // grace margin so hover engages just before the edge
    const id = setInterval(async () => {
      const pos = await tauriInvoke<[number, number] | null>("get_cursor_in_window");
      const el = containerRef.current;
      if (!pos || !el) {
        // Hit-testing unavailable — fail safe to interactive so the pill always works.
        setClickThrough(false);
        return;
      }
      const r = el.getBoundingClientRect();
      const [x, y] = pos;
      const overPill =
        x >= r.left - PAD && x <= r.right + PAD && y >= r.top - PAD && y <= r.bottom + PAD;
      setClickThrough(!overPill);
    }, 120);

    return () => {
      clearInterval(id);
      setClickThrough(false);
    };
  }, [isExpanded, showNotificationToast, isBooting]);

  // Focus trap for expanded state
  useEffect(() => {
    if (!isExpanded || !expandedContentRef.current) return;

    const cleanup = createFocusTrap({
      container: expandedContentRef.current,
      restoreFocus: pillToggleRef.current,
      initialFocus: true,
    });

    return cleanup;
  }, [isExpanded]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Escape: close expanded view — but if the user is mid-edit with unsaved
      // text, first blur the field (which would lose nothing) instead of collapsing
      // and discarding their draft. A second Escape then closes.
      if (e.key === "Escape" && isExpanded) {
        if (panelHasUnsavedDraft(containerRef.current)) {
          (document.activeElement as HTMLElement | null)?.blur();
        } else {
          handleClickOutside();
        }
        return;
      }

      // Ctrl+Shift+Space: toggle expand/collapse. Use force-expand (expandPill),
      // NOT handleClick — handleClick only expands from the mouse-set "hover" state
      // and no-ops from idle, so the shortcut was previously dead from a resting pill.
      if (e.key === " " && e.ctrlKey && e.shiftKey) {
        e.preventDefault();
        if (isExpanded) {
          handleClickOutside();
        } else {
          expandPill();
        }
        triggerActivity(); // Mark user as active
        return;
      }

      // Tab-strip navigation keys must NOT hijack caret movement inside text fields
      // (Prism chat, productivity inputs). If focus is in an editable element, let
      // the browser handle Arrow/Home/End natively.
      const target = e.target as HTMLElement | null;
      const isEditingText = !!target?.closest("input, textarea, [contenteditable]");

      // Arrow keys: navigate the tab strip (only when expanded, not while editing text)
      if (isExpanded && !isEditingText && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
        e.preventDefault();
        const tabs = safeTabs.map((tab) => tab.id);
        const currentIndex = tabs.indexOf(activeTab);
        const nextIndex =
          e.key === "ArrowLeft"
            ? (currentIndex > 0 ? currentIndex - 1 : tabs.length - 1)
            : (currentIndex < tabs.length - 1 ? currentIndex + 1 : 0);
        setActiveTab(tabs[nextIndex]);
        triggerActivity();
        return;
      }

      // Home/End: jump to first/last tab (only when expanded, not while editing text)
      if (isExpanded && !isEditingText && (e.key === "Home" || e.key === "End")) {
        e.preventDefault();
        const tabs = safeTabs.map((tab) => tab.id);
        setActiveTab(e.key === "Home" ? tabs[0] : tabs[tabs.length - 1]);
        triggerActivity();
        return;
      }

      // NOTE: Tab / Shift+Tab is intentionally NOT handled here. It must perform
      // normal DOM focus traversal so keyboard users can reach the controls inside
      // the active panel (Start/Pause/Stop, sliders, Prism input, productivity
      // fields). The tab STRIP is reachable via Arrow + Home/End above plus its
      // roving tabindex, per the WAI-ARIA tabs pattern. A previous Tab branch here
      // preventDefault'd every Tab and trapped focus on the tab strip.
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isExpanded, activeTab, handleClickOutside, expandPill, safeTabs, triggerActivity]);

  // Screen reader announcements for key state changes
  const prevTimerStateRef = useRef(timer);
  const prevMediaStateRef = useRef(media);
  const prevNotificationsRef = useRef(notifications);
  const prevActiveTabRef = useRef(activeTab);
  const prevVolumeRef = useRef(volume);

  // Announce timer state changes
  useEffect(() => {
    const prev = prevTimerStateRef.current;
    if (prev.isActive !== timer.isActive) {
      if (timer.isActive) {
        announce(`Timer started: ${timer.label}`);
      } else if (timer.isComplete) {
        announce(`Timer completed: ${timer.label}`, "assertive");
      } else if (prev.isActive && !timer.isActive && !timer.isPaused) {
        announce("Timer stopped");
      }
    }
    if (prev.isPaused !== timer.isPaused && timer.isPaused) {
      announce("Timer paused");
    }
    if (prev.isPaused !== timer.isPaused && !timer.isPaused && timer.isActive) {
      announce("Timer resumed");
    }
    prevTimerStateRef.current = timer;
  }, [timer, announce]);

  // Announce media state changes
  useEffect(() => {
    const prev = prevMediaStateRef.current;
    if (prev?.title !== media?.title && media?.title) {
      announce(`Now playing: ${media.title} by ${media.artist || "Unknown Artist"}`);
    }
    if (prev?.isPlaying !== media?.isPlaying) {
      if (media?.isPlaying) {
        announce("Media playing");
      } else {
        announce("Media paused");
      }
    }
    prevMediaStateRef.current = media;
  }, [media, announce]);

  // Announce notification changes
  useEffect(() => {
    const prev = prevNotificationsRef.current;
    announceListChange(notifications, prev, "notification", "notifications", "notifications");
    prevNotificationsRef.current = notifications;
  }, [notifications, announceListChange]);

  // Announce tab changes
  useEffect(() => {
    const prev = prevActiveTabRef.current;
    if (prev !== activeTab) {
      const tabNames: Record<ExpandedTab, string> = {
        timer: "Timer",
        media: "Media",
        notifications: "Notifications",
        settings: "Settings",
        clipboard: "Clipboard",
        shelf: "Shelf",
        lyrics: "Lyrics",
        productivity: "Productivity",
        prism: "Prism AI",
      };
      announce(`Switched to ${tabNames[activeTab]} tab`);
    }
    prevActiveTabRef.current = activeTab;
  }, [activeTab, announce]);

  // Announce volume changes
  useEffect(() => {
    const prev = prevVolumeRef.current;
    if (prev?.level !== volume?.level && volume?.level !== undefined) {
      announce(`Volume: ${Math.round(volume.level * 100)}%`);
    }
    if (prev?.isMuted !== volume?.isMuted) {
      announce(volume?.isMuted ? "Muted" : "Unmuted");
    }
    prevVolumeRef.current = volume;
  }, [volume, announce]);

  const runPrismAction = useCallback(
    async (action: PrismAction): Promise<string> => {
      const args = action.args ?? {};

      switch (action.type) {
        case "start_timer": {
          const minutesValue = Number(args.minutes);
          if (!Number.isFinite(minutesValue) || minutesValue <= 0) {
            throw new Error("Invalid minutes for start_timer.");
          }
          const minutes = Math.max(1, Math.min(720, Math.round(minutesValue)));
          const label =
            typeof args.label === "string" && args.label.trim()
              ? args.label.trim().slice(0, 40)
              : `Prism ${minutes}m`;
          startTimerWithNotification({ label, minutes });
          return `Timer started: ${label} (${minutes}m).`;
        }
        case "pause_timer":
          pauseTimer();
          return "Timer paused.";
        case "resume_timer":
          resumeTimer();
          return "Timer resumed.";
        case "stop_timer":
          stopTimer();
          return "Timer stopped.";
        case "set_volume": {
          const levelValue = Number(args.level);
          if (!Number.isFinite(levelValue)) {
            throw new Error("Invalid level for set_volume.");
          }
          const level = Math.max(0, Math.min(100, Math.round(levelValue)));
          await setVolume(level);
          return `Volume set to ${level}%.`;
        }
        case "toggle_mute":
          await toggleMute();
          return "Mute toggled.";
        case "set_brightness": {
          const levelValue = Number(args.level);
          if (!Number.isFinite(levelValue)) {
            throw new Error("Invalid level for set_brightness.");
          }
          const level = Math.max(0, Math.min(100, Math.round(levelValue)));
          await setBrightness(level);
          return `Brightness set to ${level}%.`;
        }
        case "media_play_pause":
          await playPause();
          return "Media play/pause sent.";
        case "media_next":
          await mediaNext();
          return "Media next sent.";
        case "media_previous":
          await mediaPrevious();
          return "Media previous sent.";
        case "add_task": {
          const title =
            typeof args.title === "string" && args.title.trim()
              ? args.title.trim().slice(0, 120)
              : "";
          if (!title) {
            throw new Error("Invalid title for add_task.");
          }
          addTask(title);
          return `Task added: ${title}`;
        }
        case "add_note": {
          const title =
            typeof args.title === "string" && args.title.trim()
              ? args.title.trim().slice(0, 120)
              : "Quick note";
          const content = typeof args.content === "string" ? args.content.slice(0, 2000) : "";
          addNote(title, content);
          return `Note added: ${title}`;
        }
        default:
          throw new Error(`Unsupported action type: ${action.type}`);
      }
    },
    [
      mediaNext,
      mediaPrevious,
      addNote,
      addTask,
      pauseTimer,
      playPause,
      resumeTimer,
      setBrightness,
      setVolume,
      startTimer,
      stopTimer,
      toggleMute,
    ]
  );

  // When Actions mode is on and Prism returns actions, run them directly (no extra buttons)
  useEffect(() => {
    if (!prismActionMode || prismActions.length === 0) return;
    const toRun = [...prismActions];
    setPrismActions([]);
    toRun.forEach((action) => {
      runPrismAction(action).catch(() => {});
    });
  }, [prismActionMode, prismActions, setPrismActions, runPrismAction]);

  const executeWorkflowAction = useCallback((action: WorkflowActionEnvelope) => {
    const tabActionMap: Record<string, ExpandedTab> = {
      open_timer_tab: "timer",
      open_media_tab: "media",
      open_notifications_tab: "notifications",
      open_settings_tab: "settings",
      open_prism_tab: "prism",
      open_productivity_tab: "productivity",
    };

    // Tray / global-shortcut / workflow callers don't pass through hover, so we
    // must use expandPill() (force expand) instead of handleClick() which is
    // hover-gated and would silently no-op from idle.
    if (action.id === "toggle_expand") {
      if (isExpanded) {
        handleClickOutside();
      } else {
        expandPill();
      }
      return;
    }

    if (action.id === "quick_add_task") {
      const rawTitle = typeof action.args?.title === "string" ? action.args.title : "Quick task";
      const title = rawTitle.trim().slice(0, 120);
      if (title) addTask(title);
      expandPill();
      setActiveTab("productivity");
      return;
    }

    const targetTab = tabActionMap[action.id];
    if (!targetTab) return;
    expandPill();
    setActiveTab(targetTab);
  }, [addTask, expandPill, handleClickOutside, isExpanded]);

  useWorkflowEvents(executeWorkflowAction);

  const triggerWorkflowAction = useCallback(async (id: WorkflowActionEnvelope["id"], args?: Record<string, unknown>) => {
    const envelope: WorkflowActionEnvelope = {
      id,
      args,
      source: "ui",
      timestamp: Date.now(),
    };
    try {
      const dispatched = await platformApi.dispatchWorkflowAction(id, args);
      if (dispatched === null) {
        executeWorkflowAction(envelope);
      }
    } catch {
      executeWorkflowAction(envelope);
    }
  }, [executeWorkflowAction]);

  // Handle click outside
  useEffect(() => {
    if (!isExpanded) return;

    const handleGlobalClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        // Don't collapse (and unmount the module, losing the draft) while the user
        // is mid-edit with unsaved text in a panel field.
        if (panelHasUnsavedDraft(containerRef.current)) return;
        handleClickOutside();
      }
    };

    // Add slight delay to prevent immediate close
    const timeoutId = setTimeout(() => {
      document.addEventListener("click", handleGlobalClick);
    }, 100);

    return () => {
      clearTimeout(timeoutId);
      document.removeEventListener("click", handleGlobalClick);
    };
  }, [isExpanded, handleClickOutside]);

  return (
    <>
      {/* Live regions render here (Pill's own useScreenReader instance) so every
          announce() call below is actually spoken. Kept outside the pill body so
          they stay mounted whether collapsed or expanded. */}
      <ScreenReaderLiveRegions polite={politeAnnouncement} assertive={assertiveAnnouncement} />
    <motion.div
      ref={containerRef}
      className="relative cursor-pointer"
      role={isExpanded ? "dialog" : "button"}
      aria-label={isExpanded ? "WINDEYE Dynamic Island - Expanded" : collapsedAriaLabel}
      aria-modal={isExpanded ? "true" : undefined}
      aria-expanded={isExpanded ? "true" : "false"}
      tabIndex={isExpanded ? -1 : 0}
      style={{
        width,
        height,
        borderRadius,
        backdropFilter,
        WebkitBackdropFilter: backdropFilter,
        boxShadow,
        overflow: "visible",
        background: isBooting && bootPhase === "dot"
          ? "radial-gradient(circle, rgba(255,255,255,0.8) 0%, rgba(200,200,200,0.6) 100%)"
          : `linear-gradient(135deg, var(--windeye-surface-primary) 0%, var(--windeye-surface-secondary) 60%, rgba(15, 15, 18, 0.95) 100%)`,
        border: `1px solid ${themeTokens.borderColor}`,
      }}
      initial={{ opacity: 0, scale: 0 }}
      animate={{ 
        opacity: 1, 
        scale: 1,
      }}
      transition={reducedMotion ? { duration: 0.1, ease: "easeOut" } : springConfig.bouncy}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onPointerDown={(e) => {
        pillDrag.onPointerDown(e);
        gestureHandlers.onPointerDown(e);
      }}
      onPointerMove={(e) => {
        pillDrag.onPointerMove(e);
        gestureHandlers.onPointerMove(e);
      }}
      onPointerUp={(e) => {
        pillDrag.onPointerUp(e);
        gestureHandlers.onPointerUp(e);
      }}
      onContextMenu={gestureHandlers.onContextMenu}
      onClick={() => {
        // A drag that moved the window shouldn't also expand the pill.
        if (pillDrag.isDragging) return;
        handleClick();
        triggerActivity(); // Mark user as active
      }}
      onKeyDown={(e) => {
        if (!isExpanded && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          // Force-expand: handleClick only expands from the mouse-set "hover" state,
          // so a keyboard user who Tab-focuses the idle pill could not open it.
          expandPill();
          triggerActivity(); // Mark user as active
        }
      }}
    >
      {/* Glass overlay for depth */}
      <motion.div
        className="absolute inset-0 rounded-[inherit] pointer-events-none"
        style={{
          background: "linear-gradient(180deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0) 50%)",
          borderRadius,
        }}
      />

      {/* Subtle border */}
      <motion.div
        className="absolute inset-0 rounded-[inherit] pointer-events-none"
        style={{
          border: "1px solid rgba(255, 255, 255, 0.08)",
          borderRadius,
        }}
      />

      {/* Inner glow on top edge */}
      <motion.div
        className="absolute inset-x-0 top-0 h-[1px] rounded-t-[inherit] pointer-events-none"
        style={{
          background: "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.15) 50%, transparent 100%)",
          borderRadius,
        }}
      />

      {/* Timer progress ring around pill (when timer active in idle/hover) */}
      {showTimerInIdle && (
        <TimerMiniProgress 
          progress={timerProgress} 
          width={width}
          height={height}
        />
      )}

      {/* Background state indicators */}
      {backgroundStates.length > 0 && !isExpanded && (
        <StateIndicators states={backgroundStates} position="right" />
      )}

      {/* Minimal presentation: when a second activity is live alongside the one
          shown inside the pill, it detaches into its own bubble — Apple's
          two-activity layout. Timer wins the bubble over a download because it's
          time-critical; the pill itself keeps the leading activity. */}
      <AnimatePresence>
        {!isBooting && !isExpanded && !hud && secondaryActivity && (
          <MinimalBubble
            key={secondaryActivity.key}
            icon={secondaryActivity.icon}
            label={secondaryActivity.label}
            progress={secondaryActivity.progress}
            accentColor={effectiveAccentColor}
            side="right"
            onClick={() => {
              expandPill();
              setActiveTab(secondaryActivity.tab);
            }}
          />
        )}
      </AnimatePresence>

      {/* Notification toast (appears BELOW pill, then animates into badge).
          Body click → activate via NotificationToast's internal onActivate;
          X button → dismiss only. Do NOT add an onClick(Capture) on this wrapper:
          a capture-phase handler swallows the X button's stopPropagation and
          ends up activating the app every time the user tries to dismiss. */}
      {!isExpanded && (notificationPhase === "incoming" || notificationPhase === "absorbing") && latestNotification && (
        <div
          className="absolute left-1/2 -translate-x-1/2 z-[100]"
          style={{ top: "calc(100% + 10px)" }}
        >
          <NotificationToast
            notification={latestNotification}
            onDismiss={clearLatestNotification}
            onActivate={async (id) => {
              try {
                const caps = await platformApi.getCapabilities();
                if (!caps.notifications) return;
                const notif = notifications.find(n => n.id === id);
                if (notif?.aumid) {
                  await platformApi.activateAppByAumid(notif.aumid);
                } else {
                  await platformApi.activateNotification(id);
                }
              } catch {
                // Best-effort activation; ignore failures so the toast still dismisses cleanly.
              }
            }}
            phase={notificationPhase}
          />
        </div>
      )}

      {/* HUD overlay — takes over the collapsed pill when the user changes volume,
          brightness or a lock key, replacing the OS flyout. */}
      <AnimatePresence>
        {!isBooting && !isExpanded && hud && (
          <motion.div
            key="hud"
            className="absolute inset-0 flex items-center px-3 z-[60] pointer-events-none"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <HudOverlay hud={hud} accentColor={effectiveAccentColor} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Idle/Hover Content */}
      {!isBooting && !isExpanded && !hud && (
        <div
          ref={pillToggleRef}
          className="absolute inset-0 flex items-center pointer-events-none select-none px-4"
          style={{
            fontVariantNumeric: "tabular-nums",
            fontSize: "18px",
            fontWeight: 600,
            letterSpacing: "0.02em",
          }}
        >
          {/* Left side: live activity / media indicator — animate width so the center
              slides left when nothing is present. Uses the pill's own spring so the
              content never outruns the container. */}
          <motion.div
            className="flex items-center flex-shrink-0 min-w-0 overflow-hidden gap-1"
            animate={{ width: (showMediaInIdle ? 32 : 0) + (primaryActivity ? 34 : 0) }}
            transition={pillSpring}
          >
            <AnimatePresence mode="wait">
              {primaryActivity && (
                <LiveActivityCompact
                  key={primaryActivity.id}
                  activity={primaryActivity}
                  accentColor={effectiveAccentColor}
                />
              )}
            </AnimatePresence>
            <AnimatePresence mode="wait">
              {showMediaInIdle && (
                <motion.div
                  key="media"
                  className="flex items-center flex-shrink-0"
                  initial={idleSlotAnimations.left.initial}
                  animate={idleSlotAnimations.left.animate}
                  exit={idleSlotAnimations.left.exit}
                  transition={idleSlotAnimations.transition}
                >
                  {/* Real spectrum bars while audio is playing; the static glyph otherwise. */}
                  {spectrumEnabled ? (
                    <AudioVisualizerMini bars={spectrumBars} accentColor={effectiveAccentColor} />
                  ) : (
                    <MediaIndicator isPlaying={true} />
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>

          {/* Center: Time and timer — layout so position animates when left/right slots appear or disappear */}
          <motion.div
            layout
            className="flex items-center justify-center gap-2 flex-1 min-w-0 overflow-hidden"
            transition={idleSlotAnimations.transition}
          >
            <AnimatePresence mode="wait">
              {hasTimerActive && !hasTimerAlert && (
                <motion.span
                  key="timer"
                  className="text-green-400"
                  style={{ textShadow: "0 0 8px rgba(34, 197, 94, 0.4)" }}
                  initial={idleSlotAnimations.center.initial}
                  animate={idleSlotAnimations.center.animate}
                  exit={idleSlotAnimations.center.exit}
                  transition={idleSlotAnimations.transition}
                >
                  {formatTime(timer.remainingSeconds)}
                </motion.span>
              )}
              {hasTimerAlert && (
                <motion.span
                  key="alert"
                  className="text-red-400"
                  style={{ textShadow: "0 0 8px rgba(239, 68, 68, 0.5)" }}
                  initial={idleSlotAnimations.center.initial}
                  animate={{
                    ...idleSlotAnimations.center.animate,
                    // Steady opacity under reduced motion — no perpetual blink.
                    opacity: reducedMotion ? 1 : [1, 0.5, 1],
                  }}
                  exit={idleSlotAnimations.center.exit}
                  transition={{
                    ...idleSlotAnimations.transition,
                    ...(reducedMotion ? {} : { opacity: { duration: 1, repeat: Infinity } }),
                  }}
                >
                  Done!
                </motion.span>
              )}
              {!hasTimerActive && !hasTimerAlert && (
                <motion.span
                  key="time"
                  className="inline-flex items-baseline"
                  style={{ fontVariantNumeric: "tabular-nums" }}
                  initial={idleSlotAnimations.center.initial}
                  animate={idleSlotAnimations.center.animate}
                  exit={idleSlotAnimations.center.exit}
                  transition={idleSlotAnimations.transition}
                >
                  {time.length > 0 ? (
                    <>
                      <span style={{ color: effectiveAccentColor, textShadow: `0 0 10px ${hexToRgba(effectiveAccentColor, 0.5)}` }}>
                        {time[0]}
                      </span>
                      <span style={{ color: "#ffffff", textShadow: "0 1px 2px rgba(0,0,0,0.3)" }}>
                        {time.slice(1)}
                      </span>
                    </>
                  ) : (
                    <span style={{ color: "#ffffff" }}>{time}</span>
                  )}
                </motion.span>
              )}
            </AnimatePresence>
          </motion.div>

          {/* Right side: privacy dots + Battery + Notification badge — fixed animated
              width so the center clock stays centered. The width uses the SAME spring
              as the pill's own width; with a stiffer spring here the inner content
              reached full size before the pill did and visibly jumped. */}
          <motion.div
            className="flex items-center justify-end flex-shrink-0 overflow-hidden gap-1"
            animate={{
              width:
                (showBatteryInIdle && hasNotificationBadge ? (isHovering ? 74 : 48) :
                 showBatteryInIdle ? (isHovering ? 48 : 22) :
                 hasNotificationBadge ? 28 :
                 0) + privacyIndicatorWidth,
            }}
            transition={pillSpring}
          >
            <PrivacyIndicators privacy={privacy} />
            <AnimatePresence mode="wait">
              {showBatteryInIdle && (
                <BatteryIndicator
                  key="battery"
                  battery={battery}
                  isLow={isBatteryLow}
                  isCritical={isBatteryCritical}
                  showPercent={isHovering}
                />
              )}
            </AnimatePresence>
            <AnimatePresence mode="wait">
              {hasNotificationBadge && notifications.length > 0 && (
                <NotificationIndicator
                  key="notification-badge"
                  count={notifications.length}
                  appName={notifications[0]?.appName || "App"}
                  isNew={isNewNotification}
                  layoutId={undefined}
                />
              )}
            </AnimatePresence>
          </motion.div>
        </div>
      )}

      {/* Content area - only show when expanded */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            ref={expandedContentRef}
            className="absolute inset-0 flex flex-col p-2.5"
            role="region"
            aria-label="WINDEYE expanded content"
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: panelTransitionDuration }}
          >
            {/* Header row with time - time as single unit */}
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-pill-md">
                <div
                  className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0"
                  style={{ background: `linear-gradient(to bottom right, ${hexToRgba(effectiveAccentColor, 0.4)}, ${hexToRgba(effectiveAccentColor, 0.2)})` }}
                >
                  <span className="text-white text-pill-xs font-bold">W</span>
                </div>
                <span className="text-white text-pill-md font-semibold tracking-wide">WINDEYE</span>
              </div>

              <span
                className="text-pill-md font-medium text-white tabular-nums"
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                {time}:{seconds}
              </span>
            </div>

            {/* Tab Navigation */}
            <div 
              className="flex gap-pill-xs mb-1.5 p-pill-xs bg-pill-muted-lightest rounded-pill-md"
              role="tablist"
              aria-label="WINDEYE modules"
            >
              {safeTabs.map(tab => (
                <motion.button
                  key={tab.id}
                  id={`tab-${tab.id}`}
                  role="tab"
                  aria-selected={activeTab === tab.id}
                  aria-controls={`panel-${tab.id}`}
                  aria-label={tab.id === "notifications" && notifications.length > 0 ? `Notifications (${notifications.length} unread)` : tab.ariaLabel}
                  tabIndex={activeTab === tab.id ? 0 : -1}
                  className={`relative flex-1 py-1 px-0.5 rounded-md text-[12px] font-medium transition-colors ${
                    activeTab === tab.id 
                      ? "bg-white/15 text-white" 
                      : "text-white/80 hover:text-white"
                  }`}
                  onClick={() => setActiveTab(tab.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setActiveTab(tab.id);
                    }
                  }}
                  {...microInteractions.button}
                >
                  <span className="mr-0.5" aria-hidden="true">{tab.icon}</span>
                  {tab.label}
                  {tab.hasBadge && notifications.length > 0 && (
                    <span 
                      className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-red-500 rounded-full text-[10px] text-white font-medium flex items-center justify-center"
                      aria-label={`${notifications.length} notifications`}
                    >
                      {notifications.length > 9 ? "9+" : notifications.length}
                    </span>
                  )}
                </motion.button>
              ))}
            </div>

            {/* Main content area - Tabbed modules */}
            <div className="flex-1 flex flex-col min-h-0 overflow-hidden w-full">
              <AnimatePresence mode="wait">
                {activeTab === "timer" && (
                  <motion.div
                    key="timer"
                    id="panel-timer"
                    role="tabpanel"
                    aria-labelledby="tab-timer"
                    className="overflow-y-auto flex-1 min-h-0"
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 20 }}
                    transition={{ duration: panelTransitionDuration }}
                  >
                    <TimerExpanded
                      timer={timer}
                      stats={timerStats}
                      categories={timerCategories}
                      selectedCategory={selectedTimerCategory}
                      onSelectCategory={setSelectedTimerCategory}
                      presets={presets}
                      formatTime={formatTime}
                      progress={timerProgress}
                      onStart={startTimerWithNotification}
                      onPause={pauseTimer}
                      onResume={resumeTimer}
                      onStop={stopTimer}
                      onDismiss={handleDismissAlert}
                    />
                  </motion.div>
                )}

                {activeTab === "media" && (
                  <motion.div
                    key="media"
                    id="panel-media"
                    role="tabpanel"
                    aria-labelledby="tab-media"
                    className="overflow-y-auto flex-1 min-h-0"
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 20 }}
                    transition={{ duration: panelTransitionDuration }}
                  >
                    {/* Live spectrum across the top of the media panel */}
                    {spectrumEnabled && (
                      <div className="mb-1.5">
                        <AudioVisualizer bars={spectrumBars} accentColor={effectiveAccentColor} height={26} />
                      </div>
                    )}
                    <MediaExpanded
                      media={media}
                      recentSources={recentSources}
                      timeline={timeline}
                      playbackInfo={playbackInfo}
                      accentColor={effectiveAccentColor}
                      onPlayPause={playPause}
                      onNext={mediaNext}
                      onPrevious={mediaPrevious}
                      onToggleRepeat={toggleRepeat}
                      onToggleShuffle={toggleShuffle}
                      onPauseOthers={pauseOtherSessions}
                      onSeek={seekTo}
                    />
                  </motion.div>
                )}

                {activeTab === "notifications" && (
                  <motion.div
                    key="notifications"
                    id="panel-notifications"
                    role="tabpanel"
                    aria-labelledby="tab-notifications"
                    className="overflow-y-auto flex-1 min-h-0"
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 20 }}
                    transition={{ duration: panelTransitionDuration }}
                  >
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <h2 className="text-white/90 text-[13px] font-medium uppercase tracking-wider">
                          {notificationsView === "live" ? "Recent Notifications" : "Notification History"}
                        </h2>
                        <div className="flex items-center gap-1.5">
                          <div className="rounded bg-white/10 p-[2px] flex items-center">
                            <button
                              type="button"
                              className={`px-1.5 py-0.5 text-[10px] rounded ${notificationsView === "live" ? "bg-white/20 text-white" : "text-white/70"}`}
                              aria-label="Show live notifications"
                              aria-pressed={notificationsView === "live"}
                              onClick={() => setNotificationsView("live")}
                            >
                              Live
                            </button>
                            <button
                              type="button"
                              className={`px-1.5 py-0.5 text-[10px] rounded ${notificationsView === "history" ? "bg-white/20 text-white" : "text-white/70"}`}
                              aria-label="Show notification history"
                              aria-pressed={notificationsView === "history"}
                              onClick={() => setNotificationsView("history")}
                            >
                              History
                            </button>
                          </div>
                          {(notificationsView === "live" ? notifications.length : notificationHistory.length) > 0 && (
                          <motion.button
                            type="button"
                            className="px-2 py-0.5 rounded text-[10px] bg-white/10 text-white/70 hover:text-white/90 hover:bg-white/15 transition-colors"
                            onClick={() => {
                              if (notificationsView === "live") {
                                notifications.slice(0, 30).forEach((n) => dismissNotification(n.id));
                              } else {
                                clearNotificationHistory();
                              }
                            }}
                            {...microInteractions.button}
                          >
                            {notificationsView === "live" ? "Clear all" : "Clear history"}
                          </motion.button>
                        )}
                        </div>
                      </div>
                      <NotificationsList
                        notifications={notificationsView === "live" ? notifications : notificationHistory}
                        hasAccess={hasNotificationAccess}
                        onDismiss={dismissNotification}
                        onActivate={async (id) => {
                          try {
                            const caps = await platformApi.getCapabilities();
                            if (!caps.notifications) return;
                            const notif = notifications.find(n => n.id === id);
                            if (notif?.aumid) {
                              await platformApi.activateAppByAumid(notif.aumid);
                            } else {
                              await platformApi.activateNotification(id);
                            }
                            dismissNotification(id);
                            handleClickOutside();
                          } catch (_) { /* ignore */ }
                        }}
                      />
                    </div>
                  </motion.div>
                )}

                {activeTab === "settings" && (
                  <motion.div
                    key="settings"
                    id="panel-settings"
                    role="tabpanel"
                    aria-labelledby="tab-settings"
                    className="overflow-y-auto flex-1 min-h-0"
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 20 }}
                    transition={{ duration: panelTransitionDuration }}
                  >
                    {/* Weather glance + live CPU/RAM monitor — both only while this tab is open. */}
                    <div className="mb-2">
                      <WeatherExpanded
                        weather={weather}
                        isLoading={isWeatherLoading}
                        error={weatherError}
                        onRefresh={refreshWeather}
                      />
                    </div>
                    <PrivacyDetail privacy={privacy} />

                    {/* Live Activities (downloads and any registered producers) */}
                    <div className="my-2">
                      <LiveActivitiesExpanded activities={activities} accentColor={effectiveAccentColor} />
                    </div>

                    {/* Connected Bluetooth devices + battery where the device reports it */}
                    {bluetoothDevices.length > 0 && (
                      <div className="flex flex-col gap-1 my-2">
                        <span className="text-[10px] uppercase tracking-wider text-white/45">Bluetooth</span>
                        {bluetoothDevices.map((device) => (
                          <div key={device.id} className="flex items-center gap-2 text-[11px]">
                            <span aria-hidden="true">🎧</span>
                            <span className="text-white/85 truncate flex-1">{device.name}</span>
                            <span className="text-white/55 tabular-nums flex-shrink-0">
                              {device.batteryPercent !== null ? `${device.batteryPercent}%` : "—"}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

                    <SystemMonitor enabled={activeTab === "settings"} accentColor={effectiveAccentColor} />
                    <DisplaySettings />
                    <QuickSettings
                      volume={volume}
                      onVolumeChange={setVolume}
                      onMuteToggle={toggleMute}
                      brightness={brightness}
                      onBrightnessChange={setBrightness}
                      audioDevices={audioDevices}
                      defaultAudioDevice={defaultAudioDevice}
                      audioSessions={audioSessions}
                      onSessionVolumeChange={setSessionVolume}
                      onSessionMuteToggle={setSessionMute}
                      autoStartEnabled={autoStartEnabled}
                      onAutoStartToggle={() => setAutoStartEnabled(!autoStartEnabled)}
                      layoutSettings={appSettings.layout}
                      onLayoutChange={(layoutPatch) => updateSettings({ layout: layoutPatch })}
                      appearance={appearance}
                      motionSettings={{
                        animationSpeed: appSettings.motion.animation_speed,
                        onAnimationSpeedChange: (speed) => updateSettings({ motion: { animation_speed: speed } }),
                      }}
                    />
                  </motion.div>
                )}

                {activeTab === "clipboard" && (
                  <motion.div
                    key="clipboard"
                    id="panel-clipboard"
                    role="tabpanel"
                    aria-labelledby="tab-clipboard"
                    className="flex flex-col flex-1 min-h-0"
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 20 }}
                    transition={{ duration: panelTransitionDuration }}
                  >
                    <ClipboardExpanded
                      items={clipboard.items}
                      isSupported={clipboard.isSupported}
                      isEnabled={clipboard.isEnabled}
                      isLoading={clipboard.isLoading}
                      onCopy={clipboard.copy}
                    />
                  </motion.div>
                )}

                {activeTab === "lyrics" && (
                  <motion.div
                    key="lyrics"
                    id="panel-lyrics"
                    role="tabpanel"
                    aria-labelledby="tab-lyrics"
                    className="flex flex-col flex-1 min-h-0"
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 20 }}
                    transition={{ duration: panelTransitionDuration }}
                  >
                    {media ? (
                      <LyricsExpanded
                        lines={lyrics.lines}
                        plain={lyrics.plain}
                        activeIndex={lyrics.activeIndex}
                        isLoading={lyrics.isLoading}
                        error={lyrics.error}
                        accentColor={effectiveAccentColor}
                      />
                    ) : (
                      <p className="text-[12px] text-white/45 text-center py-3">
                        Play something to see lyrics
                      </p>
                    )}
                  </motion.div>
                )}

                {activeTab === "shelf" && (
                  <motion.div
                    key="shelf"
                    id="panel-shelf"
                    role="tabpanel"
                    aria-labelledby="tab-shelf"
                    className="flex flex-col flex-1 min-h-0"
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 20 }}
                    transition={{ duration: panelTransitionDuration }}
                  >
                    <ShelfExpanded
                      items={shelf.items}
                      isDragging={shelf.isDragging}
                      onRemove={shelf.removeItem}
                      onClear={shelf.clear}
                      onReveal={(path) => { void platformApi.revealInExplorer(path); }}
                    />
                  </motion.div>
                )}

                {activeTab === "prism" && (
                  <motion.div
                    key="prism"
                    id="panel-prism"
                    role="tabpanel"
                    aria-labelledby="tab-prism"
                    className="w-full h-full min-h-0 flex flex-col overflow-y-auto"
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 20 }}
                    transition={{ duration: panelTransitionDuration }}
                  >
                    <PrismModule
                      messages={prismMessages}
                      actionMode={prismActionMode}
                      usage={prismUsage}
                      isLoading={prismLoading}
                      error={prismError}
                      onSendMessage={sendPrismMessage}
                      onToggleActionMode={setPrismActionMode}
                      onClearChat={clearPrismChat}
                      activeAppContext={activeAppContext}
                      onToggleActiveAppContext={toggleActiveAppContext}
                    />
                  </motion.div>
                )}

                {activeTab === "productivity" && (
                  <motion.div
                    key="productivity"
                    id="panel-productivity"
                    role="tabpanel"
                    aria-labelledby="tab-productivity"
                    className="w-full h-full min-h-0 flex flex-col overflow-y-auto"
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 20 }}
                    transition={{ duration: panelTransitionDuration }}
                  >
                    <ProductivityModule
                      state={productivity}
                      onAddTask={addTask}
                      onToggleTask={toggleTask}
                      onRemoveTask={removeTask}
                      onClearCompleted={clearCompletedTasks}
                      onAddNote={addNote}
                      onUpdateNote={updateNote}
                      onRemoveNote={removeNote}
                      onAddEvent={addAgendaEvent}
                      onExportBackup={async () => {
                        const result = await exportBackup();
                        announce(result?.valid ? "Productivity backup exported." : `Backup export failed.${describeBackupConflicts(result)}`);
                      }}
                      onPreviewImport={async () => {
                        const result = await importBackup("preview");
                        announce(result?.valid ? "Backup preview valid, ready to apply." : `Backup preview has conflicts.${describeBackupConflicts(result)}`);
                      }}
                      onApplyImport={async () => {
                        const result = await importBackup("apply");
                        announce(result?.valid ? "Backup applied." : `Backup not applied.${describeBackupConflicts(result)}`);
                      }}
                    />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Footer with date */}
            <div className="flex items-center justify-center gap-2 pt-pill-md mt-pill-xs border-t border-pill-border flex-shrink-0">
              <span className="text-pill-muted text-pill-base">{dateStr}</span>
              {weather && (
                <>
                  <span className="text-white/25" aria-hidden="true">·</span>
                  <WeatherCompact weather={weather} />
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {contextMenu.isOpen && (
        <div
          className="fixed inset-0 z-[120]"
          onClick={closeContextMenu}
          onContextMenu={(e) => {
            e.preventDefault();
            closeContextMenu();
          }}
        >
          <div
            className="absolute min-w-[150px] rounded-md border border-white/15 bg-black/85 backdrop-blur-md p-1.5"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            <button
              type="button"
              className="w-full text-left text-[11px] text-white/85 px-2 py-1 rounded hover:bg-white/10"
              onClick={() => {
                void triggerWorkflowAction("toggle_expand");
                closeContextMenu();
              }}
            >
              {isExpanded ? "Collapse" : "Expand"}
            </button>
            <button
              type="button"
              className="w-full text-left text-[11px] text-white/85 px-2 py-1 rounded hover:bg-white/10"
              onClick={() => {
                void triggerWorkflowAction("open_productivity_tab");
                closeContextMenu();
              }}
            >
              Open productivity
            </button>
            {isExpanded && (
              <>
                <button
                  type="button"
                  className="w-full text-left text-[11px] text-white/85 px-2 py-1 rounded hover:bg-white/10"
                  onClick={() => {
                    goToTab(-1);
                    closeContextMenu();
                  }}
                >
                  Previous tab
                </button>
                <button
                  type="button"
                  className="w-full text-left text-[11px] text-white/85 px-2 py-1 rounded hover:bg-white/10"
                  onClick={() => {
                    goToTab(1);
                    closeContextMenu();
                  }}
                >
                  Next tab
                </button>
              </>
            )}
          </div>
        </div>
      )}

    </motion.div>
    </>
  );
}
