import { motion } from "motion/react";
import { useState, useMemo } from "react";
import type { ClipboardEntry } from "../../../hooks/useClipboardHistory";
import { microInteractions } from "../animations";

// =============================================================================
// Clipboard history (reads the Windows Win+V store)
// =============================================================================

interface ClipboardExpandedProps {
  items: ClipboardEntry[];
  isSupported: boolean;
  isEnabled: boolean;
  isLoading: boolean;
  onCopy: (text: string) => void;
}

export function ClipboardExpanded({
  items,
  isSupported,
  isEnabled,
  isLoading,
  onCopy,
}: ClipboardExpandedProps) {
  const [query, setQuery] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((item) => item.text.toLowerCase().includes(q));
  }, [items, query]);

  const handleCopy = (item: ClipboardEntry) => {
    onCopy(item.text);
    setCopiedId(item.id);
    setTimeout(() => setCopiedId((current) => (current === item.id ? null : current)), 1200);
  };

  if (!isSupported) {
    return (
      <p className="text-[12px] text-white/55 text-center py-3">
        Clipboard history isn’t available on this system.
      </p>
    );
  }

  if (!isEnabled) {
    return (
      <div className="flex flex-col items-center gap-1 py-3 px-2 text-center">
        <p className="text-[12px] text-white/70">Clipboard history is turned off</p>
        <p className="text-[11px] text-white/45">
          Enable it in Windows Settings › System › Clipboard, or press Win+V.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5 min-h-0 flex-1">
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search clipboard…"
        aria-label="Search clipboard history"
        className="rounded-md bg-white/10 border border-white/15 px-2 py-1 text-[12px] text-white placeholder:text-white/35 focus:outline-none focus:ring-1 focus:ring-white/30"
      />

      {isLoading && items.length === 0 ? (
        <p className="text-[12px] text-white/50 text-center py-2">Loading…</p>
      ) : filtered.length === 0 ? (
        <p className="text-[12px] text-white/50 text-center py-2">
          {items.length === 0 ? "Clipboard is empty" : "No matches"}
        </p>
      ) : (
        <div className="flex flex-col gap-1 overflow-y-auto min-h-0 flex-1 pr-0.5">
          {filtered.map((item) => (
            <motion.button
              key={item.id}
              className="text-left rounded-md bg-white/8 hover:bg-white/14 px-2 py-1.5 transition-colors group"
              aria-label={`Copy: ${item.text.slice(0, 60)}`}
              onClick={() => handleCopy(item)}
              {...microInteractions.button}
            >
              <span className="block text-[11px] text-white/85 line-clamp-2 break-words">
                {item.text}
              </span>
              <span className="text-[10px] text-white/40 group-hover:text-white/60">
                {copiedId === item.id ? "Copied ✓" : "Click to copy"}
              </span>
            </motion.button>
          ))}
        </div>
      )}
    </div>
  );
}
