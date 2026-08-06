/**
 * Forecast source: Open-Meteo.
 *
 * Chosen because it needs no API key, returns dew point directly (the number the
 * heat protocol actually keys on, which most consumer APIs bury or omit), and
 * serves hourly data far enough out to cover a full training week.
 */

import { HOME, TZ } from "./dates";
import type { Conditions } from "./heat";

export interface DayForecast {
  date: string;
  highF: number;
  lowF: number;
  /** Highest hourly precipitation probability across the day. */
  precipProbMax: number;
  /** Hourly points, ascending by hour. */
  hours: Conditions[];
}

export interface Forecast {
  days: DayForecast[];
  source: string;
  fetchedAt: string;
}

const ENDPOINT = "https://api.open-meteo.com/v1/forecast";

/** Open-Meteo's maximum horizon; comfortably covers the current training week. */
const FORECAST_DAYS = 16;

interface OpenMeteoResponse {
  daily?: {
    time: string[];
    temperature_2m_max: number[];
    temperature_2m_min: number[];
    precipitation_probability_max: (number | null)[];
  };
  hourly?: {
    time: string[];
    temperature_2m: number[];
    dew_point_2m: number[];
    precipitation_probability: (number | null)[];
    wind_speed_10m: (number | null)[];
  };
}

export async function fetchForecast(): Promise<Forecast> {
  const url = new URL(ENDPOINT);
  url.search = new URLSearchParams({
    latitude: String(HOME.latitude),
    longitude: String(HOME.longitude),
    daily: "temperature_2m_max,temperature_2m_min,precipitation_probability_max",
    hourly: "temperature_2m,dew_point_2m,precipitation_probability,wind_speed_10m",
    temperature_unit: "fahrenheit",
    wind_speed_unit: "mph",
    precipitation_unit: "inch",
    timezone: TZ,
    forecast_days: String(FORECAST_DAYS),
  }).toString();

  const res = await fetch(url, {
    // Half-hourly is plenty; the forecast does not meaningfully move faster.
    // Tagged so the board's refresh button can drop it on demand.
    next: { revalidate: 1800, tags: ["weather"] },
  });
  if (!res.ok) throw new Error(`Open-Meteo returned ${res.status}`);

  const json: OpenMeteoResponse = await res.json();
  if (!json.daily?.time?.length || !json.hourly?.time?.length) {
    throw new Error("Open-Meteo response was missing daily or hourly data");
  }

  // Bucket hourly points by calendar day. Times arrive as local "YYYY-MM-DDTHH:MM".
  const hoursByDate = new Map<string, Conditions[]>();
  json.hourly.time.forEach((stamp, i) => {
    const [date, clock] = stamp.split("T");
    const hour = Number(clock.slice(0, 2));
    const point: Conditions = {
      hour,
      tempF: Math.round(json.hourly!.temperature_2m[i]),
      dewPointF: Math.round(json.hourly!.dew_point_2m[i]),
      precipProb: json.hourly!.precipitation_probability[i] ?? 0,
      windMph: Math.round(json.hourly!.wind_speed_10m[i] ?? 0),
    };
    const list = hoursByDate.get(date) ?? [];
    list.push(point);
    hoursByDate.set(date, list);
  });

  const days: DayForecast[] = json.daily.time.map((date, i) => ({
    date,
    highF: Math.round(json.daily!.temperature_2m_max[i]),
    lowF: Math.round(json.daily!.temperature_2m_min[i]),
    precipProbMax: json.daily!.precipitation_probability_max[i] ?? 0,
    hours: (hoursByDate.get(date) ?? []).sort((a, b) => a.hour - b.hour),
  }));

  return { days, source: "Open-Meteo", fetchedAt: new Date().toISOString() };
}
