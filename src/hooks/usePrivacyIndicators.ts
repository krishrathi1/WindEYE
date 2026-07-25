import { useState, useEffect, useRef, useCallback } from "react";
import { platformApi } from "../lib/platform";

// =============================================================================
// Camera / microphone in-use indicators
//
// Mirrors the green/orange dots Apple shows in the Dynamic Island. Windows records
// per-app capability usage in the CapabilityAccessManager ConsentStore, which the
// backend polls; an app that has started but not stopped is currently using the
// device.
// =============================================================================

export interface PrivacyStatus {
  cameraInUse: boolean;
  microphoneInUse: boolean;
  cameraApps: string[];
  microphoneApps: string[];
}

const EMPTY: PrivacyStatus = {
  cameraInUse: false,
  microphoneInUse: false,
  cameraApps: [],
  microphoneApps: [],
};

export function usePrivacyIndicators(pollInterval = 4000): PrivacyStatus {
  const [status, setStatus] = useState<PrivacyStatus>(EMPTY);
  const isMountedRef = useRef(true);
  const isPendingRef = useRef(false);

  const fetchStatus = useCallback(async () => {
    if (!isMountedRef.current || isPendingRef.current) return;
    isPendingRef.current = true;
    try {
      const result = await platformApi.getPrivacyStatus();
      if (result && isMountedRef.current) {
        setStatus({
          cameraInUse: result.camera_in_use,
          microphoneInUse: result.microphone_in_use,
          cameraApps: result.camera_apps ?? [],
          microphoneApps: result.microphone_apps ?? [],
        });
      }
    } catch {
      // Privacy status is best-effort; keep the last known value.
    } finally {
      isPendingRef.current = false;
    }
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    fetchStatus();
    const id = setInterval(fetchStatus, pollInterval);

    const onVisibility = () => {
      if (!document.hidden) fetchStatus();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      isMountedRef.current = false;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [fetchStatus, pollInterval]);

  return status;
}
