import { useState, useRef, useCallback, useEffect } from "react";
import { platformApi } from "../lib/platform";

// =============================================================================
// Free pill repositioning
//
// Drag the collapsed pill anywhere on screen. The window itself moves, so this
// works even though the pill is an always-on-top overlay. A drag only starts
// after the pointer moves past a small threshold, which keeps normal clicks
// (expand the pill) working unchanged.
// =============================================================================

const DRAG_THRESHOLD_PX = 4;
const STORAGE_KEY = "windeye_pill_position";

interface UsePillDragReturn {
  isDragging: boolean;
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
  resetPosition: () => void;
  hasCustomPosition: boolean;
}

export function usePillDrag(enabled: boolean): UsePillDragReturn {
  const [isDragging, setIsDragging] = useState(false);
  const [hasCustomPosition, setHasCustomPosition] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) !== null;
    } catch {
      return false;
    }
  });

  // Screen coords at pointer-down, plus the window origin at that moment.
  const originRef = useRef<{ screenX: number; screenY: number; winX: number; winY: number } | null>(null);
  const activeRef = useRef(false);

  // Restore a saved position on mount so the pill stays where the user put it.
  useEffect(() => {
    let cancelled = false;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { x: number; y: number };
      if (typeof parsed?.x !== "number" || typeof parsed?.y !== "number") return;
      // Defer so the window has its real size before we clamp against the monitor.
      const id = setTimeout(() => {
        if (!cancelled) {
          void platformApi.setPillPosition(parsed.x, parsed.y, true).catch(() => {});
        }
      }, 400);
      return () => {
        cancelled = true;
        clearTimeout(id);
      };
    } catch {
      // Corrupt entry — ignore and use the default position.
    }
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!enabled) return;
      // Only a primary-button drag moves the pill.
      if (e.button !== 0) return;
      originRef.current = {
        screenX: e.screenX,
        screenY: e.screenY,
        winX: window.screenX,
        winY: window.screenY,
      };
      activeRef.current = false;
    },
    [enabled]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const origin = originRef.current;
      if (!enabled || !origin) return;

      const dx = e.screenX - origin.screenX;
      const dy = e.screenY - origin.screenY;

      if (!activeRef.current) {
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
        activeRef.current = true;
        setIsDragging(true);
        // Capture so the drag continues even if the cursor leaves the pill.
        try {
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        } catch {
          // Capture is best-effort.
        }
      }

      void platformApi
        .setPillPosition(origin.winX + dx, origin.winY + dy, false)
        .catch(() => {});
    },
    [enabled]
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      const origin = originRef.current;
      originRef.current = null;
      if (!activeRef.current || !origin) {
        activeRef.current = false;
        return;
      }
      activeRef.current = false;
      setIsDragging(false);

      const finalX = origin.winX + (e.screenX - origin.screenX);
      const finalY = origin.winY + (e.screenY - origin.screenY);

      void platformApi
        .setPillPosition(finalX, finalY, true)
        .then((result) => {
          const saved = result ?? { x: finalX, y: finalY };
          try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
            setHasCustomPosition(true);
          } catch {
            // Non-fatal: position holds for this session only.
          }
        })
        .catch(() => {});
    },
    []
  );

  const resetPosition = useCallback(() => {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Non-fatal.
    }
    setHasCustomPosition(false);
    void platformApi.clearPillPosition().catch(() => {});
  }, []);

  return { isDragging, onPointerDown, onPointerMove, onPointerUp, resetPosition, hasCustomPosition };
}
