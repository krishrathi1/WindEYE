import { useState, useEffect, useCallback } from "react";
import { platformApi } from "../../../lib/platform";
import { SUPPORTED_LOCALES, resolveLocale, setLocale, type Locale } from "../../../lib/i18n";

// =============================================================================
// Display / backdrop / language settings
//
// Multi-monitor placement is the most-reported bug across this whole app
// category, so the display picker is deliberately explicit rather than automatic.
// =============================================================================

interface MonitorOption {
  name: string;
  width: number;
  height: number;
  isPrimary: boolean;
}

const BACKDROPS: Array<{ id: string; label: string }> = [
  { id: "none", label: "Glass" },
  { id: "mica", label: "Mica" },
  { id: "mica-alt", label: "Mica Alt" },
  { id: "acrylic", label: "Acrylic" },
];

const BACKDROP_KEY = "windeye_backdrop";
const MONITOR_KEY = "windeye_monitor";
const SUPPRESS_KEY = "windeye_suppress_flyout";

export function DisplaySettings() {
  const [monitors, setMonitors] = useState<MonitorOption[]>([]);
  const [selectedMonitor, setSelectedMonitor] = useState<string | null>(() => {
    try {
      return localStorage.getItem(MONITOR_KEY);
    } catch {
      return null;
    }
  });
  const [backdrop, setBackdrop] = useState<string>(() => {
    try {
      return localStorage.getItem(BACKDROP_KEY) ?? "none";
    } catch {
      return "none";
    }
  });
  const [locale, setLocaleState] = useState<Locale>(() => resolveLocale());
  const [backdropError, setBackdropError] = useState<string | null>(null);
  const [suppressFlyout, setSuppressFlyout] = useState<boolean>(() => {
    try {
      return localStorage.getItem(SUPPRESS_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [suppressUnavailable, setSuppressUnavailable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    platformApi
      .listMonitors()
      .then((result) => {
        if (cancelled || !Array.isArray(result)) return;
        setMonitors(
          result.map((m) => ({
            name: m.name,
            width: m.width,
            height: m.height,
            isPrimary: m.is_primary,
          }))
        );
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const applyMonitor = useCallback(async (name: string | null) => {
    setSelectedMonitor(name);
    try {
      localStorage.setItem(MONITOR_KEY, name ?? "");
    } catch {
      // Non-fatal.
    }
    await platformApi.moveToMonitor(name).catch(() => {});
  }, []);

  const applyBackdrop = useCallback(async (id: string) => {
    setBackdrop(id);
    setBackdropError(null);
    try {
      localStorage.setItem(BACKDROP_KEY, id);
    } catch {
      // Non-fatal.
    }
    try {
      await platformApi.setWindowBackdrop(id);
    } catch {
      // Mica/Acrylic need Windows 11 build 22000+.
      setBackdropError("Not supported on this Windows version");
    }
  }, []);

  // Re-apply suppression on mount so the setting survives a restart.
  useEffect(() => {
    if (!suppressFlyout) return;
    platformApi
      .setFlyoutSuppression(true)
      .then((found) => setSuppressUnavailable(found === false))
      .catch(() => setSuppressUnavailable(true));
    // Only on mount: the toggle handler covers later changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applySuppression = useCallback(async (next: boolean) => {
    setSuppressFlyout(next);
    try {
      localStorage.setItem(SUPPRESS_KEY, next ? "1" : "0");
    } catch {
      // Non-fatal.
    }
    try {
      const found = await platformApi.setFlyoutSuppression(next);
      setSuppressUnavailable(next && found === false);
    } catch {
      setSuppressUnavailable(true);
    }
  }, []);

  const applyLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    setLocale(next);
  }, []);

  return (
    <div className="flex flex-col gap-2 mt-2">
      {monitors.length > 1 && (
        <div className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wider text-white/45">Display</span>
          <div className="flex flex-wrap gap-1">
            {monitors.map((monitor) => (
              <button
                key={monitor.name}
                type="button"
                className={`px-2 py-0.5 rounded text-[10px] transition-colors ${
                  selectedMonitor === monitor.name
                    ? "bg-white/20 text-white"
                    : "bg-white/8 text-white/70 hover:text-white hover:bg-white/12"
                }`}
                aria-pressed={selectedMonitor === monitor.name}
                onClick={() => applyMonitor(monitor.name)}
                title={`${monitor.width}×${monitor.height}`}
              >
                {monitor.isPrimary ? "Primary" : monitor.name.replace(/^\\\\[.\\]*DISPLAY/i, "Display ")}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-col gap-1">
        <span className="text-[10px] uppercase tracking-wider text-white/45">Backdrop</span>
        <div className="flex flex-wrap gap-1">
          {BACKDROPS.map((option) => (
            <button
              key={option.id}
              type="button"
              className={`px-2 py-0.5 rounded text-[10px] transition-colors ${
                backdrop === option.id
                  ? "bg-white/20 text-white"
                  : "bg-white/8 text-white/70 hover:text-white hover:bg-white/12"
              }`}
              aria-pressed={backdrop === option.id}
              onClick={() => applyBackdrop(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>
        {backdropError && <span className="text-[10px] text-white/45">{backdropError}</span>}
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-[10px] uppercase tracking-wider text-white/45">System HUD</span>
        <button
          type="button"
          className={`px-2 py-0.5 rounded text-[10px] self-start transition-colors ${
            suppressFlyout
              ? "bg-white/20 text-white"
              : "bg-white/8 text-white/70 hover:text-white hover:bg-white/12"
          }`}
          aria-pressed={suppressFlyout}
          onClick={() => applySuppression(!suppressFlyout)}
        >
          {suppressFlyout ? "Hiding Windows flyout" : "Hide Windows flyout"}
        </button>
        <span className="text-[10px] text-white/40 leading-snug">
          {suppressUnavailable
            ? "Not available on this Windows build."
            : "Stops Windows drawing its own volume/brightness popup so only the pill shows."}
        </span>
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-[10px] uppercase tracking-wider text-white/45">Language</span>
        <div className="flex flex-wrap gap-1">
          {SUPPORTED_LOCALES.map((option) => (
            <button
              key={option.code}
              type="button"
              className={`px-2 py-0.5 rounded text-[10px] transition-colors ${
                locale === option.code
                  ? "bg-white/20 text-white"
                  : "bg-white/8 text-white/70 hover:text-white hover:bg-white/12"
              }`}
              aria-pressed={locale === option.code}
              onClick={() => applyLocale(option.code)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
