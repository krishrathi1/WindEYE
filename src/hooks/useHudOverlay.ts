import { useState, useEffect, useRef, useCallback } from "react";
import { platformApi } from "../lib/platform";

// =============================================================================
// HUD overlay — volume / brightness / lock-key changes surface inside the pill
//
// Rather than hooking the OS flyout renderer, this watches the values we already
// poll and raises a transient HUD whenever one changes from a known previous
// value. The first reading after mount only seeds the baseline, so launching the
// app never flashes a HUD.
// =============================================================================

export type HudKind = "volume" | "brightness" | "caps" | "num" | "mute";

export interface HudState {
  kind: HudKind;
  /** 0..1 for slider kinds; undefined for on/off glances. */
  value?: number;
  label: string;
  enabled?: boolean;
  at: number;
}

interface UseHudOverlayOptions {
  volume: number;          // 0..100
  isMuted: boolean;
  brightness: number;      // 0..100
  capsLock: boolean;
  numLock: boolean;
  enabled: boolean;
  durationMs?: number;
}

export function useHudOverlay({
  volume,
  isMuted,
  brightness,
  capsLock,
  numLock,
  enabled,
  durationMs = 1600,
}: UseHudOverlayOptions): HudState | null {
  const [hud, setHud] = useState<HudState | null>(null);

  // `undefined` marks "no baseline yet" so the first poll doesn't fire a HUD.
  const prevVolume = useRef<number | undefined>(undefined);
  const prevMuted = useRef<boolean | undefined>(undefined);
  const prevBrightness = useRef<number | undefined>(undefined);
  const prevCaps = useRef<boolean | undefined>(undefined);
  const prevNum = useRef<boolean | undefined>(undefined);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const raise = useCallback(
    (next: Omit<HudState, "at">) => {
      if (!enabled) return;
      // Ask the backend to hide the native Windows flyout for as long as ours is
      // up. It's a no-op unless the user enabled suppression in settings.
      void platformApi.armFlyoutSuppression(durationMs + 200).catch(() => {});
      setHud({ ...next, at: Date.now() });
      if (hideTimer.current) clearTimeout(hideTimer.current);
      hideTimer.current = setTimeout(() => setHud(null), durationMs);
    },
    [enabled, durationMs]
  );

  useEffect(() => {
    if (prevVolume.current !== undefined && prevVolume.current !== volume) {
      raise({ kind: "volume", value: Math.max(0, Math.min(100, volume)) / 100, label: "Volume" });
    }
    prevVolume.current = volume;
  }, [volume, raise]);

  useEffect(() => {
    if (prevMuted.current !== undefined && prevMuted.current !== isMuted) {
      raise({ kind: "mute", label: isMuted ? "Muted" : "Unmuted", enabled: !isMuted });
    }
    prevMuted.current = isMuted;
  }, [isMuted, raise]);

  useEffect(() => {
    if (prevBrightness.current !== undefined && prevBrightness.current !== brightness) {
      raise({
        kind: "brightness",
        value: Math.max(0, Math.min(100, brightness)) / 100,
        label: "Brightness",
      });
    }
    prevBrightness.current = brightness;
  }, [brightness, raise]);

  useEffect(() => {
    if (prevCaps.current !== undefined && prevCaps.current !== capsLock) {
      raise({ kind: "caps", label: capsLock ? "Caps Lock On" : "Caps Lock Off", enabled: capsLock });
    }
    prevCaps.current = capsLock;
  }, [capsLock, raise]);

  useEffect(() => {
    if (prevNum.current !== undefined && prevNum.current !== numLock) {
      raise({ kind: "num", label: numLock ? "Num Lock On" : "Num Lock Off", enabled: numLock });
    }
    prevNum.current = numLock;
  }, [numLock, raise]);

  useEffect(() => {
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, []);

  return enabled ? hud : null;
}
