import { useState, useEffect, useCallback, useRef } from "react";
import { platformApi } from "../lib/platform";
import { useAdaptivePolling } from "./useAdaptivePolling";

// =============================================================================
// Types
// =============================================================================

export interface BatteryInfo {
  percent: number;       // 0-100
  isCharging: boolean;
  isPluggedIn: boolean;
  isBatterySaver: boolean;
  hasBattery: boolean;
}

interface UseBatteryReturn {
  battery: BatteryInfo;
  isLow: boolean;        // true when <= 15%
  isCritical: boolean;   // true when <= 5%
}

// =============================================================================
// Hook
// =============================================================================

export function useBattery(pollInterval = 5000): UseBatteryReturn {
  const [battery, setBattery] = useState<BatteryInfo>({
    percent: 100,
    isCharging: false,
    isPluggedIn: false,
    isBatterySaver: false,
    hasBattery: false,
  });

  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isPendingRef = useRef(false);
  const isMountedRef = useRef(true);

  // Adaptive polling for reduced CPU usage
  // Plugging/unplugging the charger is an instant, user-visible event, so this polls
  // on a short cycle even when idle — GetSystemPowerStatus is a trivial syscall.
  // (It previously idled at 60s and slept to 180s, so unplugging took a minute or
  // more to show up in the pill.)
  const { activityLevel, isDeepSleep, getCurrentInterval, resetIdleTimer } = useAdaptivePolling({
    baseInterval: pollInterval,
    activeInterval: Math.max(2000, Math.floor(pollInterval / 2)),
    idleThreshold: 30000,
    deepSleepInterval: Math.max(pollInterval, 10000),
    deepSleepThreshold: 300000,
  });

  const fetchBattery = useCallback(async () => {
    if (!isMountedRef.current) return;
    if (isPendingRef.current) return;
    isPendingRef.current = true;
    try {
      const caps = await platformApi.getCapabilities();
      if (!caps.battery) {
        setBattery({
          percent: 0,
          isCharging: false,
          isPluggedIn: false,
          isBatterySaver: false,
          hasBattery: false,
        });
        return;
      }
      const result = await platformApi.getBatteryInfo();
      if (result) {
        setBattery({
          percent: result.percent,
          isCharging: result.is_charging,
          isPluggedIn: result.is_plugged_in ?? false,
          isBatterySaver: result.is_battery_saver,
          hasBattery: result.has_battery,
        });
      }
    } catch {
      // Silently handle errors
    } finally {
      isPendingRef.current = false;
    }
  }, []);

  // Start polling function
  const startPolling = useCallback(() => {
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    // Use adaptive polling interval
    const interval = getCurrentInterval();
    pollIntervalRef.current = setInterval(() => {
      if (isMountedRef.current) fetchBattery();
    }, interval);
  }, [getCurrentInterval, fetchBattery]);

  // Stop polling function
  const stopPolling = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  }, []);

  useEffect(() => {
    // Re-arm on every effect setup so a previous cleanup (from a dep change OR
    // React 18 StrictMode double-invoke) doesn't permanently disable the hook.
    isMountedRef.current = true;

    const handleVisibilityChange = () => {
      if (!isMountedRef.current) return;
      if (document.hidden) {
        stopPolling();
      } else {
        resetIdleTimer();
        fetchBattery();
        startPolling();
      }
    };

    fetchBattery();
    startPolling();
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      isMountedRef.current = false;
      stopPolling();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [fetchBattery, startPolling, stopPolling, resetIdleTimer]);

  // Restart polling when activity level or deep sleep state changes
  useEffect(() => {
    if (!document.hidden) {
      startPolling();
    }
  }, [activityLevel, isDeepSleep, startPolling]);

  return {
    battery,
    isLow: battery.hasBattery && !battery.isCharging && !battery.isPluggedIn && battery.percent <= 15,
    isCritical: battery.hasBattery && !battery.isCharging && !battery.isPluggedIn && battery.percent <= 5,
  };
}
