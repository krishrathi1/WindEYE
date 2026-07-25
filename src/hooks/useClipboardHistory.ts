import { useState, useEffect, useRef, useCallback } from "react";
import { platformApi } from "../lib/platform";

// =============================================================================
// Clipboard history (Windows Win+V store)
//
// Reads the OS clipboard history rather than keeping a second copy of its own, so
// nothing extra is persisted to disk and the user's existing Win+V privacy
// settings (including "clear history") stay authoritative.
// =============================================================================

export interface ClipboardEntry {
  id: string;
  text: string;
}

interface UseClipboardHistoryReturn {
  items: ClipboardEntry[];
  isSupported: boolean;
  isEnabled: boolean;
  isLoading: boolean;
  refresh: () => void;
  copy: (text: string) => Promise<void>;
}

export function useClipboardHistory(enabled: boolean, pollInterval = 3000): UseClipboardHistoryReturn {
  const [items, setItems] = useState<ClipboardEntry[]>([]);
  const [isSupported, setIsSupported] = useState(true);
  const [isEnabled, setIsEnabled] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const isMountedRef = useRef(true);
  const isPendingRef = useRef(false);

  const fetchHistory = useCallback(async () => {
    if (!isMountedRef.current || isPendingRef.current) return;
    isPendingRef.current = true;
    try {
      const result = await platformApi.getClipboardHistory();
      if (result && isMountedRef.current) {
        setIsSupported(result.is_supported);
        setIsEnabled(result.is_enabled);
        setItems(result.items ?? []);
      }
    } catch {
      if (isMountedRef.current) setIsSupported(false);
    } finally {
      isPendingRef.current = false;
      if (isMountedRef.current) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    // Only poll while the clipboard view is actually open — reading the history
    // is a WinRT async round-trip and pointless when nobody is looking at it.
    if (!enabled) return () => { isMountedRef.current = false; };

    fetchHistory();
    const id = setInterval(fetchHistory, pollInterval);
    return () => {
      isMountedRef.current = false;
      clearInterval(id);
    };
  }, [enabled, fetchHistory, pollInterval]);

  const copy = useCallback(async (text: string) => {
    try {
      await platformApi.setClipboardText(text);
    } catch {
      // Non-fatal: the entry simply stays where it was.
    }
  }, []);

  return { items, isSupported, isEnabled, isLoading, refresh: fetchHistory, copy };
}
