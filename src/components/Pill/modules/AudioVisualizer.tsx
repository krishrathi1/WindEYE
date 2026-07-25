import { motion } from "motion/react";

// =============================================================================
// Audio spectrum bars (fed by WASAPI loopback + FFT in the backend)
// =============================================================================

interface AudioVisualizerProps {
  bars: number[];
  accentColor?: string;
  height?: number;
  barWidth?: number;
  gap?: number;
  className?: string;
}

export function AudioVisualizer({
  bars,
  accentColor = "#3B82F6",
  height = 22,
  barWidth = 3,
  gap = 2,
  className = "",
}: AudioVisualizerProps) {
  if (!bars.length) return null;

  return (
    <div
      className={`flex items-end justify-center ${className}`}
      style={{ height, gap }}
      aria-hidden="true"
    >
      {bars.map((value, index) => {
        // Always leave a sliver visible so the row reads as a visualizer at rest.
        const pct = Math.max(0.08, Math.min(1, value));
        return (
          <motion.span
            key={index}
            className="rounded-full flex-shrink-0"
            style={{
              width: barWidth,
              backgroundColor: accentColor,
              // Lower bands are usually loudest; fade the highs slightly so the
              // row looks balanced rather than left-heavy.
              opacity: 0.55 + 0.45 * pct,
            }}
            initial={false}
            animate={{ height: Math.max(2, pct * height) }}
            transition={{ duration: 0.08, ease: "easeOut" }}
          />
        );
      })}
    </div>
  );
}

/// Tiny 5-bar variant for the collapsed pill.
export function AudioVisualizerMini({ bars, accentColor }: { bars: number[]; accentColor?: string }) {
  // Sample a few bands across the spectrum rather than showing the first five,
  // which would all be bass and move together.
  const picks = [1, 4, 7, 10, 13].map((i) => bars[i] ?? 0);
  return (
    <AudioVisualizer
      bars={picks}
      accentColor={accentColor}
      height={12}
      barWidth={2}
      gap={1.5}
    />
  );
}
