import { useState, useEffect, useRef, useCallback } from "react";
import { platformApi } from "../lib/platform";

// =============================================================================
// Caps / Num / Scroll lock state — drives the HUD glance confirmations
// =============================================================================

export interface LockKeyStates {
  capsLock: boolean;
  numLock: boolean;
  scrollLock: boolean;
}

const INITIAL: LockKeyStates = { capsLock: false, numLock: false, scrollLock: false };

export function useLockKeys(enabled: boolean, pollInterval = 400): LockKeyStates {
  const [states, setStates] = useState<LockKeyStates>(INITIAL);
  const isMountedRef = useRef(true);
  const isPendingRef = useRef(false);

  const fetchStates = useCallback(async () => {
    if (!isMountedRef.current || isPendingRef.current) return;
    isPendingRef.current = true;
    try {
      const result = await platformApi.getLockKeyStates();
      if (result && isMountedRef.current) {
        setStates({
          capsLock: result.caps_lock,
          numLock: result.num_lock,
          scrollLock: result.scroll_lock,
        });
      }
    } catch {
      // Best-effort; keep the last known state.
    } finally {
      isPendingRef.current = false;
    }
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    if (!enabled) return () => { isMountedRef.current = false; };

    fetchStates();
    // GetKeyState is essentially free, so a short interval is fine and makes the
    // Caps Lock glance feel immediate.
    const id = setInterval(fetchStates, pollInterval);
    return () => {
      isMountedRef.current = false;
      clearInterval(id);
    };
  }, [enabled, fetchStates, pollInterval]);

  return states;
}
