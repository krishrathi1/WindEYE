import { motion } from "motion/react";
import { springConfig } from "./animations";

// =============================================================================
// Minimal-mode detached bubble
//
// Apple's Dynamic Island splits into a pill plus a small detached bubble when two
// activities run at once (e.g. media playing while a timer counts down). The
// leading activity stays in the pill; the secondary one lives here.
// =============================================================================

interface MinimalBubbleProps {
  icon: string;
  label: string;
  accentColor?: string;
  /** 0..1 — draws a progress ring around the bubble when provided. */
  progress?: number;
  /** Which side of the pill the bubble sits on. */
  side?: "left" | "right";
  onClick?: () => void;
}

const SIZE = 26;
const STROKE = 2;

export function MinimalBubble({
  icon,
  label,
  accentColor = "#22c55e",
  progress,
  side = "right",
  onClick,
}: MinimalBubbleProps) {
  const radius = (SIZE - STROKE) / 2;
  const circumference = radius * 2 * Math.PI;

  return (
    <motion.button
      type="button"
      className="absolute top-0 flex items-center justify-center rounded-full pointer-events-auto"
      style={{
        width: SIZE,
        height: SIZE,
        // Sit just outside the pill, vertically aligned with it.
        [side]: -(SIZE + 8),
        background: "linear-gradient(135deg, rgba(20,20,22,0.96) 0%, rgba(30,30,35,0.92) 100%)",
        border: "1px solid rgba(255,255,255,0.10)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
      }}
      initial={{ scale: 0, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      exit={{ scale: 0, opacity: 0 }}
      transition={springConfig.snappy}
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      {typeof progress === "number" && (
        <svg
          width={SIZE}
          height={SIZE}
          className="absolute inset-0"
          style={{ transform: "rotate(-90deg)" }}
          shapeRendering="geometricPrecision"
          aria-hidden="true"
        >
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={radius}
            fill="none"
            stroke="rgba(255,255,255,0.12)"
            strokeWidth={STROKE}
          />
          <motion.circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={radius}
            fill="none"
            stroke={accentColor}
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeDasharray={circumference}
            animate={{ strokeDashoffset: circumference * (1 - Math.max(0, Math.min(1, progress))) }}
            transition={{ duration: 0.3 }}
          />
        </svg>
      )}
      <span className="text-[11px] leading-none" aria-hidden="true">
        {icon}
      </span>
    </motion.button>
  );
}
