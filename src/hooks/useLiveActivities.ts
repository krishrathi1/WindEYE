import { useState, useEffect, useRef, useCallback } from "react";
import { platformApi } from "../lib/platform";

// =============================================================================
// Live Activities — ongoing tasks with live progress
//
// Generalizes the timer's "ongoing activity" idea. Downloads are the first
// non-timer producer: browsers write partial files while a transfer is in
// flight, so watching the Downloads folder yields real progress with no browser
// integration. `registerActivity` lets any other part of the app push one too.
// =============================================================================

export interface LiveActivity {
  id: string;
  kind: "download" | "custom";
  title: string;
  subtitle?: string;
  /** 0..1 when known; omitted for indeterminate work. */
  progress?: number;
  icon: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

interface UseLiveActivitiesReturn {
  activities: LiveActivity[];
  registerActivity: (activity: LiveActivity) => void;
  removeActivity: (id: string) => void;
}

export function useLiveActivities(enabled: boolean, pollInterval = 1500): UseLiveActivitiesReturn {
  const [downloads, setDownloads] = useState<LiveActivity[]>([]);
  const [custom, setCustom] = useState<LiveActivity[]>([]);
  const isMountedRef = useRef(true);
  const isPendingRef = useRef(false);
  // Remember the largest size seen per file so partial downloads can show a
  // sensible growing progress bar even though the total size is unknown.
  const peakBytesRef = useRef<Map<string, number>>(new Map());

  const fetchDownloads = useCallback(async () => {
    if (!isMountedRef.current || isPendingRef.current) return;
    isPendingRef.current = true;
    try {
      const result = await platformApi.getActiveDownloads();
      if (!Array.isArray(result) || !isMountedRef.current) return;

      const seen = new Set<string>();
      const mapped: LiveActivity[] = result.map((d) => {
        seen.add(d.id);
        const peak = Math.max(peakBytesRef.current.get(d.id) ?? 0, d.bytes);
        peakBytesRef.current.set(d.id, peak);
        return {
          id: d.id,
          kind: "download" as const,
          title: d.file_name,
          subtitle: formatBytes(d.bytes),
          icon: "⬇️",
        };
      });

      // Drop bookkeeping for files that finished so the map can't grow forever.
      for (const key of Array.from(peakBytesRef.current.keys())) {
        if (!seen.has(key)) peakBytesRef.current.delete(key);
      }
      setDownloads(mapped);
    } catch {
      // Non-fatal.
    } finally {
      isPendingRef.current = false;
    }
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    if (!enabled) {
      setDownloads([]);
      return () => { isMountedRef.current = false; };
    }
    fetchDownloads();
    const id = setInterval(fetchDownloads, pollInterval);
    return () => {
      isMountedRef.current = false;
      clearInterval(id);
    };
  }, [enabled, fetchDownloads, pollInterval]);

  const registerActivity = useCallback((activity: LiveActivity) => {
    setCustom((prev) => {
      const without = prev.filter((a) => a.id !== activity.id);
      return [...without, activity];
    });
  }, []);

  const removeActivity = useCallback((id: string) => {
    setCustom((prev) => prev.filter((a) => a.id !== id));
  }, []);

  return { activities: [...downloads, ...custom], registerActivity, removeActivity };
}
