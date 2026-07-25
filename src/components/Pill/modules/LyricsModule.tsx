import { motion } from "motion/react";
import { useEffect, useRef } from "react";
import type { LyricLine } from "../../../hooks/useLyrics";

// =============================================================================
// Synced lyrics view — the active line is highlighted and auto-scrolled
// =============================================================================

interface LyricsExpandedProps {
  lines: LyricLine[];
  plain: string | null;
  activeIndex: number;
  isLoading: boolean;
  error: string | null;
  accentColor?: string;
}

export function LyricsExpanded({
  lines,
  plain,
  activeIndex,
  isLoading,
  error,
  accentColor = "#ffffff",
}: LyricsExpandedProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLParagraphElement>(null);

  // Keep the current line centered as playback advances.
  useEffect(() => {
    const el = activeRef.current;
    const container = containerRef.current;
    if (!el || !container) return;
    const target = el.offsetTop - container.clientHeight / 2 + el.clientHeight / 2;
    container.scrollTo({ top: Math.max(0, target), behavior: "smooth" });
  }, [activeIndex]);

  if (isLoading) {
    return <p className="text-[12px] text-white/50 text-center py-3">Looking up lyrics…</p>;
  }

  if (lines.length === 0 && !plain) {
    return (
      <p className="text-[12px] text-white/45 text-center py-3">
        {error ?? "No lyrics for this track"}
      </p>
    );
  }

  // Unsynced fallback: show the plain text without highlighting.
  if (lines.length === 0 && plain) {
    return (
      <div className="overflow-y-auto flex-1 min-h-0 pr-1">
        <p className="text-[12px] text-white/70 whitespace-pre-wrap leading-relaxed">{plain}</p>
        <p className="text-[10px] text-white/35 mt-2">Unsynced lyrics</p>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="overflow-y-auto flex-1 min-h-0 pr-1 scroll-smooth">
      {lines.map((line, index) => {
        const isActive = index === activeIndex;
        // Blank LRC lines are instrumental gaps; keep the spacing, drop the text.
        if (!line.text) return <div key={`${line.timeMs}-${index}`} className="h-3" />;
        return (
          <motion.p
            key={`${line.timeMs}-${index}`}
            ref={isActive ? activeRef : undefined}
            className="text-[13px] leading-relaxed py-0.5 transition-colors"
            animate={{
              opacity: isActive ? 1 : 0.42,
              scale: isActive ? 1.02 : 1,
            }}
            transition={{ duration: 0.2 }}
            style={{
              color: isActive ? accentColor : "#ffffff",
              fontWeight: isActive ? 600 : 400,
              transformOrigin: "left center",
            }}
          >
            {line.text}
          </motion.p>
        );
      })}
    </div>
  );
}
