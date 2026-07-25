import { motion, AnimatePresence } from "motion/react";
import type { LiveActivity } from "../../../hooks/useLiveActivities";
import { idleSlotAnimations } from "../animations";

// =============================================================================
// Live Activities
//
// Compact: a single glyph in the idle pill (Apple's "minimal" presentation).
// Expanded: the full list with progress.
// =============================================================================

interface LiveActivityCompactProps {
  activity: LiveActivity;
  accentColor?: string;
}

export function LiveActivityCompact({ activity, accentColor = "#3B82F6" }: LiveActivityCompactProps) {
  return (
    <motion.div
      className="flex items-center gap-1 flex-shrink-0"
      initial={idleSlotAnimations.left.initial}
      animate={idleSlotAnimations.left.animate}
      exit={idleSlotAnimations.left.exit}
      transition={idleSlotAnimations.transition}
      title={`${activity.title}${activity.subtitle ? ` · ${activity.subtitle}` : ""}`}
    >
      <span className="text-[11px] leading-none" aria-hidden="true">{activity.icon}</span>
      {typeof activity.progress === "number" ? (
        <span className="w-6 h-1 rounded-full bg-white/20 overflow-hidden">
          <motion.span
            className="block h-full rounded-full"
            style={{ backgroundColor: accentColor }}
            initial={false}
            animate={{ width: `${Math.round(activity.progress * 100)}%` }}
          />
        </span>
      ) : (
        // Indeterminate: a small shimmer so it still reads as "in progress".
        <motion.span
          className="w-6 h-1 rounded-full overflow-hidden bg-white/20"
          aria-hidden="true"
        >
          <motion.span
            className="block h-full w-1/2 rounded-full"
            style={{ backgroundColor: accentColor }}
            animate={{ x: ["-100%", "200%"] }}
            transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
          />
        </motion.span>
      )}
    </motion.div>
  );
}

interface LiveActivitiesExpandedProps {
  activities: LiveActivity[];
  accentColor?: string;
}

export function LiveActivitiesExpanded({ activities }: LiveActivitiesExpandedProps) {
  if (activities.length === 0) return null;

  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wider text-white/45">Live Activities</span>
      <AnimatePresence initial={false}>
        {activities.map((activity) => (
          <motion.div
            key={activity.id}
            className="flex items-center gap-2 rounded-md bg-white/8 px-2 py-1"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
          >
            <span className="text-[13px] flex-shrink-0" aria-hidden="true">{activity.icon}</span>
            <div className="flex flex-col min-w-0 flex-1">
              <span className="text-[11px] text-white/90 truncate">{activity.title}</span>
              {activity.subtitle && (
                <span className="text-[10px] text-white/50">{activity.subtitle}</span>
              )}
            </div>
            {typeof activity.progress === "number" && (
              <span className="text-[10px] text-white/60 tabular-nums flex-shrink-0">
                {Math.round(activity.progress * 100)}%
              </span>
            )}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
