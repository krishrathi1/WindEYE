import { motion, AnimatePresence } from "motion/react";
import type { ShelfItem } from "../../../hooks/useFileShelf";
import { microInteractions } from "../animations";

// =============================================================================
// File shelf — parked files, ready to drag back out or reveal in Explorer
// =============================================================================

function iconFor(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "avif"].includes(ext)) return "🖼️";
  if (["mp4", "mkv", "mov", "avi", "webm"].includes(ext)) return "🎬";
  if (["mp3", "wav", "flac", "m4a", "ogg"].includes(ext)) return "🎵";
  if (["pdf"].includes(ext)) return "📕";
  if (["zip", "rar", "7z", "tar", "gz"].includes(ext)) return "🗜️";
  if (["doc", "docx", "txt", "md", "rtf"].includes(ext)) return "📄";
  if (["xls", "xlsx", "csv"].includes(ext)) return "📊";
  return "📎";
}

interface ShelfExpandedProps {
  items: ShelfItem[];
  isDragging: boolean;
  onRemove: (path: string) => void;
  onClear: () => void;
  onReveal: (path: string) => void;
}

export function ShelfExpanded({ items, isDragging, onRemove, onClear, onReveal }: ShelfExpandedProps) {
  return (
    <div className="flex flex-col gap-1.5 min-h-0 flex-1">
      <div
        className={`rounded-md border border-dashed px-2 py-2 text-center transition-colors ${
          isDragging ? "border-white/60 bg-white/10" : "border-white/20"
        }`}
      >
        <span className="text-[11px] text-white/60">
          {isDragging ? "Drop to add" : "Drag files onto the pill to park them"}
        </span>
      </div>

      {items.length === 0 ? (
        <p className="text-[12px] text-white/45 text-center py-2">Shelf is empty</p>
      ) : (
        <>
          <div className="flex flex-col gap-1 overflow-y-auto min-h-0 flex-1 pr-0.5">
            <AnimatePresence initial={false}>
              {items.map((item) => (
                <motion.div
                  key={item.path}
                  className="flex items-center gap-2 rounded-md bg-white/8 hover:bg-white/12 px-2 py-1.5 group"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                >
                  <span className="text-[13px] flex-shrink-0" aria-hidden="true">
                    {iconFor(item.name)}
                  </span>
                  <button
                    type="button"
                    className="flex-1 min-w-0 text-left"
                    onClick={() => onReveal(item.path)}
                    title={item.path}
                    aria-label={`Reveal ${item.name} in Explorer`}
                  >
                    <span className="block text-[11px] text-white/90 truncate">{item.name}</span>
                  </button>
                  <button
                    type="button"
                    className="text-white/35 hover:text-white/80 text-[13px] leading-none px-1 flex-shrink-0"
                    onClick={() => onRemove(item.path)}
                    aria-label={`Remove ${item.name} from shelf`}
                  >
                    ×
                  </button>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
          <motion.button
            className="text-[10px] px-2 py-1 rounded bg-white/10 text-white/70 hover:text-white hover:bg-white/15 self-center"
            onClick={onClear}
            {...microInteractions.button}
          >
            Clear shelf
          </motion.button>
        </>
      )}
    </div>
  );
}
