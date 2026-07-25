import { useState, useEffect, useRef, useCallback } from "react";
import { platformApi } from "../lib/platform";

// =============================================================================
// Audio spectrum bars (WASAPI loopback -> FFT in the Rust backend)
//
// The backend only keeps its capture thread alive while this hook is polling, so
// disabling it releases the audio device.
// =============================================================================

const BAND_COUNT = 16;
const SILENT = new Array<number>(BAND_COUNT).fill(0);

export function useAudioSpectrum(enabled: boolean, fps = 20): number[] {
  const [bars, setBars] = useState<number[]>(SILENT);
  const isMountedRef = useRef(true);
  const isPendingRef = useRef(false);

  const fetchBars = useCallback(async () => {
    if (!isMountedRef.current || isPendingRef.current) return;
    isPendingRef.current = true;
    try {
      const result = await platformApi.getAudioSpectrum();
      if (Array.isArray(result) && isMountedRef.current) {
        setBars(result);
      }
    } catch {
      // Visualizer is decorative; ignore failures (e.g. no render device).
    } finally {
      isPendingRef.current = false;
    }
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    if (!enabled) {
      setBars(SILENT);
      return () => { isMountedRef.current = false; };
    }

    fetchBars();
    const id = setInterval(fetchBars, Math.max(33, Math.floor(1000 / fps)));
    return () => {
      isMountedRef.current = false;
      clearInterval(id);
    };
  }, [enabled, fetchBars, fps]);

  return bars;
}
