import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { platformApi } from "../lib/platform";

// =============================================================================
// Synced lyrics (LRCLIB)
//
// Fetches once per track and parses the LRC timestamps locally, so scrolling the
// active line costs nothing beyond a binary search against the playback position.
// =============================================================================

export interface LyricLine {
  timeMs: number;
  text: string;
}

interface UseLyricsReturn {
  lines: LyricLine[];
  plain: string | null;
  activeIndex: number;
  isLoading: boolean;
  hasSynced: boolean;
  error: string | null;
}

/// Parse LRC text: lines look like `[mm:ss.xx] words`, and a single line may
/// carry several timestamps when a phrase repeats.
function parseLrc(lrc: string): LyricLine[] {
  const out: LyricLine[] = [];
  const stampPattern = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g;

  for (const raw of lrc.split(/\r?\n/)) {
    stampPattern.lastIndex = 0;
    const stamps: number[] = [];
    let match: RegExpExecArray | null;
    while ((match = stampPattern.exec(raw)) !== null) {
      const minutes = Number(match[1]);
      const seconds = Number(match[2]);
      // Fractions may be 1-3 digits; normalize to milliseconds.
      const fracRaw = match[3] ?? "0";
      const frac = Number(fracRaw.padEnd(3, "0").slice(0, 3));
      stamps.push(minutes * 60_000 + seconds * 1000 + frac);
    }
    if (stamps.length === 0) continue;

    const text = raw.replace(stampPattern, "").trim();
    for (const timeMs of stamps) {
      out.push({ timeMs, text });
    }
  }

  return out.sort((a, b) => a.timeMs - b.timeMs);
}

interface UseLyricsOptions {
  enabled: boolean;
  title?: string;
  artist?: string;
  album?: string;
  durationMs?: number;
  positionMs?: number;
}

export function useLyrics({
  enabled,
  title,
  artist,
  album,
  durationMs,
  positionMs = 0,
}: UseLyricsOptions): UseLyricsReturn {
  const [lrc, setLrc] = useState<string | null>(null);
  const [plain, setPlain] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isMountedRef = useRef(true);
  // Guards against re-fetching the same track on every poll tick.
  const fetchedKeyRef = useRef<string | null>(null);

  const trackKey = `${artist ?? ""}|${title ?? ""}`;

  const fetchLyrics = useCallback(async () => {
    if (!title || !artist) return;
    setIsLoading(true);
    setError(null);
    try {
      const result = await platformApi.getLyrics(
        artist,
        title,
        album,
        durationMs ? Math.round(durationMs / 1000) : undefined
      );
      if (!isMountedRef.current) return;
      if (result) {
        setLrc(result.synced ?? null);
        setPlain(result.plain ?? null);
        if (!result.synced && !result.plain) setError("No lyrics found");
      } else {
        setLrc(null);
        setPlain(null);
        setError("No lyrics found");
      }
    } catch {
      if (isMountedRef.current) setError("Lyrics unavailable");
    } finally {
      if (isMountedRef.current) setIsLoading(false);
    }
  }, [artist, title, album, durationMs]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!enabled || !title || !artist) return;
    if (fetchedKeyRef.current === trackKey) return;
    fetchedKeyRef.current = trackKey;
    setLrc(null);
    setPlain(null);
    void fetchLyrics();
  }, [enabled, trackKey, title, artist, fetchLyrics]);

  const lines = useMemo(() => (lrc ? parseLrc(lrc) : []), [lrc]);

  // Index of the last line whose timestamp has passed.
  const activeIndex = useMemo(() => {
    if (lines.length === 0) return -1;
    let lo = 0;
    let hi = lines.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (lines[mid].timeMs <= positionMs) {
        found = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return found;
  }, [lines, positionMs]);

  return {
    lines,
    plain,
    activeIndex,
    isLoading,
    hasSynced: lines.length > 0,
    error,
  };
}
