import { useState, useEffect, useRef, useCallback } from "react";
import { platformApi } from "../lib/platform";

// =============================================================================
// Weather (Open-Meteo via the Rust backend — free, no API key)
// =============================================================================

export interface WeatherInfo {
  temperatureC: number;
  apparentC: number;
  weatherCode: number;
  isDay: boolean;
  windKph: number;
  humidity: number;
  location: string;
  highC: number;
  lowC: number;
}

interface UseWeatherReturn {
  weather: WeatherInfo | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => void;
}

/// WMO weather interpretation codes -> a short label and a glyph.
/// https://open-meteo.com/en/docs (weather_code table)
export function describeWeather(code: number, isDay: boolean): { label: string; icon: string } {
  if (code === 0) return { label: "Clear", icon: isDay ? "☀️" : "🌙" };
  if (code === 1) return { label: "Mostly clear", icon: isDay ? "🌤️" : "🌙" };
  if (code === 2) return { label: "Partly cloudy", icon: isDay ? "⛅" : "☁️" };
  if (code === 3) return { label: "Overcast", icon: "☁️" };
  if (code === 45 || code === 48) return { label: "Fog", icon: "🌫️" };
  if (code >= 51 && code <= 57) return { label: "Drizzle", icon: "🌦️" };
  if (code >= 61 && code <= 67) return { label: "Rain", icon: "🌧️" };
  if (code >= 71 && code <= 77) return { label: "Snow", icon: "🌨️" };
  if (code >= 80 && code <= 82) return { label: "Showers", icon: "🌧️" };
  if (code === 85 || code === 86) return { label: "Snow showers", icon: "🌨️" };
  if (code >= 95) return { label: "Thunderstorm", icon: "⛈️" };
  return { label: "Unknown", icon: "🌡️" };
}

export function useWeather(pollInterval = 900_000): UseWeatherReturn {
  const [weather, setWeather] = useState<WeatherInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isMountedRef = useRef(true);
  const isPendingRef = useRef(false);

  const fetchWeather = useCallback(async () => {
    if (!isMountedRef.current || isPendingRef.current) return;
    isPendingRef.current = true;
    try {
      const result = await platformApi.getWeather();
      if (!isMountedRef.current) return;
      if (result) {
        setWeather({
          temperatureC: result.temperature_c,
          apparentC: result.apparent_c,
          weatherCode: result.weather_code,
          isDay: result.is_day,
          windKph: result.wind_kph,
          humidity: result.humidity,
          location: result.location,
          highC: result.high_c,
          lowC: result.low_c,
        });
        setError(null);
      } else {
        setError("Weather unavailable");
      }
    } catch (e) {
      if (isMountedRef.current) {
        setError(e instanceof Error ? e.message : "Weather unavailable");
      }
    } finally {
      isPendingRef.current = false;
      if (isMountedRef.current) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    fetchWeather();
    // Weather changes slowly and the request leaves the machine, so poll gently.
    const id = setInterval(fetchWeather, pollInterval);
    return () => {
      isMountedRef.current = false;
      clearInterval(id);
    };
  }, [fetchWeather, pollInterval]);

  return { weather, isLoading, error, refresh: fetchWeather };
}
