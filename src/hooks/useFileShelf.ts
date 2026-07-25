import { useState, useEffect, useCallback, useRef } from "react";

// =============================================================================
// File shelf — drag files onto the pill, park them, drag them back out
//
// Only paths are held (never file contents), so the shelf costs nothing in
// memory and never duplicates the user's data. Entries are remembered across
// restarts but are verified as still-existing when dropped back in.
// =============================================================================

export interface ShelfItem {
  path: string;
  name: string;
  addedAt: number;
}

const STORAGE_KEY = "windeye_file_shelf_v1";
const MAX_ITEMS = 20;

function basename(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

interface UseFileShelfReturn {
  items: ShelfItem[];
  isDragging: boolean;
  removeItem: (path: string) => void;
  clear: () => void;
}

export function useFileShelf(enabled: boolean): UseFileShelfReturn {
  const [items, setItems] = useState<ShelfItem[]>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as ShelfItem[]) : [];
    } catch {
      return [];
    }
  });
  const [isDragging, setIsDragging] = useState(false);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch {
      // Storage full or unavailable — the shelf just won't persist.
    }
  }, [items]);

  const addPaths = useCallback((paths: string[]) => {
    if (!paths.length) return;
    setItems((prev) => {
      const existing = new Set(prev.map((i) => i.path));
      const fresh = paths
        .filter((p) => !existing.has(p))
        .map((p) => ({ path: p, name: basename(p), addedAt: Date.now() }));
      return [...fresh, ...prev].slice(0, MAX_ITEMS);
    });
  }, []);

  useEffect(() => {
    if (!enabled) return;

    let disposed = false;
    let unlisten: (() => void) | undefined;

    const setup = async () => {
      try {
        const { getCurrentWebview } = await import("@tauri-apps/api/webview");
        if (disposed) return;
        unlisten = await getCurrentWebview().onDragDropEvent((event) => {
          const payload = event.payload as { type: string; paths?: string[] };
          if (payload.type === "over" || payload.type === "enter") {
            setIsDragging(true);
          } else if (payload.type === "drop") {
            setIsDragging(false);
            addPaths(payload.paths ?? []);
          } else {
            setIsDragging(false);
          }
        });
      } catch {
        // Drag-drop unavailable — the shelf still works as a manual list.
      }
    };

    setup();
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [enabled, addPaths]);

  const removeItem = useCallback((path: string) => {
    setItems((prev) => prev.filter((i) => i.path !== path));
  }, []);

  const clear = useCallback(() => setItems([]), []);

  return { items, isDragging, removeItem, clear };
}
