import { motion, AnimatePresence } from "motion/react";
import type { PrivacyStatus } from "../../../hooks/usePrivacyIndicators";
import { idleSlotAnimations } from "../animations";

// =============================================================================
// Camera / microphone in-use dots
//
// Apple shows a green dot for the camera and an orange dot for the microphone.
// The same convention is used here so the meaning is immediately familiar.
// =============================================================================

const CAMERA_COLOR = "#22c55e";  // green
const MIC_COLOR = "#f97316";     // orange

interface PrivacyIndicatorsProps {
  privacy: PrivacyStatus;
}

function Dot({ color, label }: { color: string; label: string }) {
  return (
    <motion.span
      className="relative inline-flex w-[7px] h-[7px] rounded-full flex-shrink-0"
      style={{ backgroundColor: color }}
      role="img"
      aria-label={label}
      title={label}
      initial={{ scale: 0, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      exit={{ scale: 0, opacity: 0 }}
      transition={idleSlotAnimations.transition}
    >
      {/* Soft halo so the dot reads clearly against the dark pill */}
      <span
        className="absolute inset-0 rounded-full"
        style={{ boxShadow: `0 0 6px ${color}` }}
        aria-hidden="true"
      />
    </motion.span>
  );
}

export function PrivacyIndicators({ privacy }: PrivacyIndicatorsProps) {
  const { cameraInUse, microphoneInUse, cameraApps, microphoneApps } = privacy;
  if (!cameraInUse && !microphoneInUse) return null;

  const cameraLabel = cameraApps.length
    ? `Camera in use by ${cameraApps.join(", ")}`
    : "Camera in use";
  const micLabel = microphoneApps.length
    ? `Microphone in use by ${microphoneApps.join(", ")}`
    : "Microphone in use";

  return (
    <div className="flex items-center gap-1">
      <AnimatePresence initial={false}>
        {cameraInUse && <Dot key="camera" color={CAMERA_COLOR} label={cameraLabel} />}
        {microphoneInUse && <Dot key="mic" color={MIC_COLOR} label={micLabel} />}
      </AnimatePresence>
    </div>
  );
}

// =============================================================================
// Expanded detail row — which apps are using what
// =============================================================================

export function PrivacyDetail({ privacy }: PrivacyIndicatorsProps) {
  const { cameraInUse, microphoneInUse, cameraApps, microphoneApps } = privacy;
  if (!cameraInUse && !microphoneInUse) return null;

  return (
    <div className="flex flex-col gap-1">
      {cameraInUse && (
        <div className="flex items-center gap-1.5 text-[11px]">
          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: CAMERA_COLOR }} />
          <span className="text-white/85">Camera</span>
          <span className="text-white/55 truncate">
            {cameraApps.length ? cameraApps.join(", ") : "in use"}
          </span>
        </div>
      )}
      {microphoneInUse && (
        <div className="flex items-center gap-1.5 text-[11px]">
          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: MIC_COLOR }} />
          <span className="text-white/85">Microphone</span>
          <span className="text-white/55 truncate">
            {microphoneApps.length ? microphoneApps.join(", ") : "in use"}
          </span>
        </div>
      )}
    </div>
  );
}
