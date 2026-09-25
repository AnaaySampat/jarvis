/* Ambient context — ANDROID FORK: live data for the Weather + Network HUD panels.
 *
 * On desktop these come from the Python backend (weather.py / telemetry.get_net_info).
 * On the phone we resolve them ourselves through the Tauri HTTP plugin (httpClient):
 *   - location + public IP  ← ipwho.is  (keyless, one call gives coords + city + IP)
 *   - weather               ← Open-Meteo (keyless)
 *
 * Both feed the SAME panel shapes the desktop hook produces, so HudPanels renders them
 * unchanged. Everything is best-effort and non-throwing — a failure just leaves the
 * panel on its idle placeholder.
 */

import { getJson } from "../tools/httpClient";
import { ipGeoLookup } from "../tools/location";
import { wmo } from "../wmoCodes";

export interface NetInfo {
  publicIp: string;
  location: string;
}

export interface AmbientLocation {
  lat: number;
  lon: number;
  place: string;
  publicIp: string;
}

export interface PanelWeather {
  temp: number | null;
  condition: string;
  location: string;
  humidity: number | null;
  wind: string;
  aqi: number | null;
  hours: Array<{ t: string; i: string; c: number | null }>;
}

/** Coarse location + public IP from IP geolocation. Tries two providers (via
 * tools/location.ts's shared lookup) so one being rate-limited doesn't blank the panels. */
export async function resolveAmbientLocation(): Promise<AmbientLocation | null> {
  const r = await ipGeoLookup();
  return r ? { lat: r.lat, lon: r.lon, place: r.place, publicIp: r.ip } : null;
}

/** The Network panel's data (public IP + resolved city). */
export function netInfoFrom(loc: AmbientLocation | null): NetInfo {
  return {
    publicIp: loc?.publicIp || "",
    location: loc?.place || "",
  };
}

interface OpenMeteo {
  current?: {
    temperature_2m?: number;
    relative_humidity_2m?: number;
    weather_code?: number;
    wind_speed_10m?: number;
    time?: string;
  };
  hourly?: { time?: string[]; temperature_2m?: number[]; weather_code?: number[] };
}

/** Current conditions + next-hours strip for the Weather panel. */
export async function fetchPanelWeather(loc: AmbientLocation): Promise<PanelWeather | null> {
  const url =
    "https://api.open-meteo.com/v1/forecast?" +
    new URLSearchParams({
      latitude: String(loc.lat),
      longitude: String(loc.lon),
      current: "temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m",
      hourly: "temperature_2m,weather_code",
      forecast_days: "2",
      timezone: "auto",
      wind_speed_unit: "mph",
    }).toString();

  let d: OpenMeteo;
  try {
    d = await getJson<OpenMeteo>(url, { timeoutMs: 8000 });
  } catch {
    return null;
  }
  const cur = d.current ?? {};
  const [cond] = wmo(cur.weather_code);

  // Next 6 hours starting at the current hour.
  const hours: PanelWeather["hours"] = [];
  const times = d.hourly?.time ?? [];
  const temps = d.hourly?.temperature_2m ?? [];
  const codes = d.hourly?.weather_code ?? [];
  const nowIso = (cur.time ?? "").slice(0, 13); // "YYYY-MM-DDTHH"
  let start = times.findIndex((t) => t.slice(0, 13) === nowIso);
  if (start < 0) start = 0;
  for (let i = start; i < times.length && hours.length < 6; i += 1) {
    const hh = times[i].slice(11, 16); // "HH:MM"
    const [, icon] = wmo(codes[i]);
    hours.push({ t: hh, i: icon, c: typeof temps[i] === "number" ? temps[i] : null });
  }

  return {
    temp: typeof cur.temperature_2m === "number" ? cur.temperature_2m : null,
    condition: cond,
    location: loc.place || "—",
    humidity: typeof cur.relative_humidity_2m === "number" ? cur.relative_humidity_2m : null,
    wind: typeof cur.wind_speed_10m === "number" ? `${Math.round(cur.wind_speed_10m)} mph` : "—",
    aqi: null,
    hours,
  };
}
