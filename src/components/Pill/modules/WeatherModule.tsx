import { motion } from "motion/react";
import { describeWeather, type WeatherInfo } from "../../../hooks/useWeather";
import { microInteractions } from "../animations";

// =============================================================================
// Weather (Open-Meteo)
// =============================================================================

function round(n: number): string {
  return Number.isFinite(n) ? `${Math.round(n)}°` : "--°";
}

interface WeatherCompactProps {
  weather: WeatherInfo;
}

/// Small inline readout for the expanded panel header area.
export function WeatherCompact({ weather }: WeatherCompactProps) {
  const { icon, label } = describeWeather(weather.weatherCode, weather.isDay);
  return (
    <span
      className="flex items-center gap-1 text-[11px] text-white/80 whitespace-nowrap"
      title={`${label} · feels like ${round(weather.apparentC)} · ${weather.location}`}
    >
      <span aria-hidden="true">{icon}</span>
      <span className="tabular-nums">{round(weather.temperatureC)}</span>
    </span>
  );
}

interface WeatherExpandedProps {
  weather: WeatherInfo | null;
  isLoading: boolean;
  error: string | null;
  onRefresh: () => void;
}

export function WeatherExpanded({ weather, isLoading, error, onRefresh }: WeatherExpandedProps) {
  if (isLoading && !weather) {
    return <p className="text-[12px] text-white/50 text-center py-2">Loading weather…</p>;
  }

  if (error && !weather) {
    return (
      <div className="flex flex-col items-center gap-1.5 py-2">
        <p className="text-[12px] text-white/60 text-center">{error}</p>
        <motion.button
          className="px-2.5 py-1 rounded-md bg-white/10 text-white/80 text-[11px] hover:bg-white/15"
          onClick={onRefresh}
          {...microInteractions.button}
        >
          Retry
        </motion.button>
      </div>
    );
  }

  if (!weather) return null;

  const { icon, label } = describeWeather(weather.weatherCode, weather.isDay);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2.5">
        <span className="text-2xl leading-none" aria-hidden="true">{icon}</span>
        <div className="flex flex-col min-w-0">
          <span className="text-white text-lg font-semibold tabular-nums leading-tight">
            {round(weather.temperatureC)}
          </span>
          <span className="text-[11px] text-white/70 truncate">{label}</span>
        </div>
        <div className="ml-auto flex flex-col items-end text-[11px] text-white/65">
          <span className="tabular-nums">
            H {round(weather.highC)} · L {round(weather.lowC)}
          </span>
          <span className="truncate max-w-[130px]" title={weather.location}>
            {weather.location}
          </span>
        </div>
      </div>
      <div className="flex gap-3 text-[10px] text-white/55">
        <span>Feels {round(weather.apparentC)}</span>
        <span>Humidity {weather.humidity}%</span>
        <span>Wind {Math.round(weather.windKph)} km/h</span>
      </div>
    </div>
  );
}
