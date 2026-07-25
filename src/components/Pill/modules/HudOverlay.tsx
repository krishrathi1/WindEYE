import { motion } from "motion/react";
import type { HudState } from "../../../hooks/useHudOverlay";
import { springConfig } from "../animations";

// =============================================================================
// HUD overlay — the pill's replacement for the OS volume/brightness flyout
// =============================================================================

function iconFor(hud: HudState): string {
  switch (hud.kind) {
    case "volume":
      if ((hud.value ?? 0) === 0) return "🔇";
      if ((hud.value ?? 0) < 0.5) return "🔉";
      return "🔊";
    case "mute":
      return hud.enabled ? "🔊" : "🔇";
    case "brightness":
      return (hud.value ?? 0) < 0.4 ? "🔅" : "🔆";
    case "caps":
      return hud.enabled ? "🔒" : "🔓";
    case "num":
      return "🔢";
    default:
      return "•";
  }
}

interface HudOverlayProps {
  hud: HudState;
  accentColor?: string;
}

export function HudOverlay({ hud, accentColor = "#ffffff" }: HudOverlayProps) {
  const hasSlider = typeof hud.value === "number";

  return (
    <motion.div
      className="flex items-center gap-2 w-full px-1 min-w-0"
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={springConfig.snappy}
      role="status"
      aria-live="polite"
      aria-label={
        hasSlider ? `${hud.label} ${Math.round((hud.value ?? 0) * 100)} percent` : hud.label
      }
    >
      <span className="text-[14px] leading-none flex-shrink-0" aria-hidden="true">
        {iconFor(hud)}
      </span>

      {hasSlider ? (
        <>
          <div className="flex-1 h-1.5 rounded-full bg-white/20 overflow-hidden min-w-0">
            <motion.div
              className="h-full rounded-full"
              style={{ backgroundColor: accentColor }}
              initial={false}
              animate={{ width: `${Math.round((hud.value ?? 0) * 100)}%` }}
              transition={springConfig.snappy}
            />
          </div>
          <span className="text-[11px] text-white/85 tabular-nums flex-shrink-0 w-8 text-right">
            {Math.round((hud.value ?? 0) * 100)}
          </span>
        </>
      ) : (
        <span className="text-[12px] text-white/90 truncate">{hud.label}</span>
      )}
    </motion.div>
  );
}
