/**
 * Where the user is — the single source of coordinates for weather, places, and the
 * "near me" web-search hint. Mirrors `places.py`'s `_USER` coords cache, but resolves
 * them itself instead of having `main.py` push them in.
 *
 * Resolution order (best first), all best-effort and non-throwing:
 *   1. a PINNED place the user set via `set_my_location` → geocoded (Nominatim),
 *   2. the device GPS (`navigator.geolocation`) — most accurate, short timeout so it
 *      never blocks if the WebView won't grant the permission,
 *   3. IP geolocation over HTTPS (ipwho.is, then ipapi.co) — the Python IP fallback
 *      (`telemetry.get_net_info`) used `http://ip-api.com`, which Android blocks as
 *      cleartext, so we use HTTPS providers instead.
 *
 * The result is cached for the brain's lifetime; pinning/clearing a location resets it.
 */

import { getJson } from "./httpClient";

export interface Coords {
  lat: number;
  lon: number;
  /** Short human label for the spoken reply / HUD ("Bandra, Mumbai"). */
  place: string;
}

interface GeoResult {
  name: string;
  lat: number;
  lon: number;
}

const NOMINATIM = "https://nominatim.openstreetmap.org";

// Leading filler that breaks geocoding ("nearest Starbucks" finds nothing; the place
// is just "Starbucks"). Stripped before handing the name to Nominatim. Port of
// places.py:_GEO_FILLER_RE (the question-phrase stripper lives in directions()).
const GEO_FILLER = /^(the\s+)?(nearest|closest|nearby|local|a|an|some|any|my\s+local)\s+/i;

export class LocationService {
  private cached: Coords | null = null;
  private pinned: string | null = null;
  private inflight: Promise<Coords | null> | null = null;

  constructor(pinnedPlace?: string) {
    this.pinned = (pinnedPlace ?? "").trim() || null;
  }

  /** Pin an explicit place (overrides auto-detect). Clears the cache to re-resolve. */
  setPinned(place: string): void {
    this.pinned = (place ?? "").trim() || null;
    this.cached = null;
  }

  /** Drop the pin and go back to auto-detect (clears cached coords). */
  clearPinned(): void {
    this.pinned = null;
    this.cached = null;
  }

  /** Remove a manual pin but keep the last GPS/IP fix. */
  unpin(): void {
    this.pinned = null;
  }

  /** Push precise device GPS from the HUD geolocation watcher. */
  setDeviceCoords(lat: number, lon: number, place = ""): void {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    if (this.pinned) return; // pinned location wins
    this.cached = { lat, lon, place };
  }

  get pinnedPlace(): string | null {
    return this.pinned;
  }

  /** Resolve (and cache) the user's coordinates, or null if every method fails. */
  async coords(): Promise<Coords | null> {
    if (this.cached) return this.cached;
    if (this.inflight) return this.inflight;
    this.inflight = this.resolve().then((c) => {
      this.cached = c;
      this.inflight = null;
      return c;
    });
    return this.inflight;
  }

  private async resolve(): Promise<Coords | null> {
    if (this.pinned) {
      const geo = await geocode(this.pinned).catch(() => null);
      if (geo) return { lat: geo.lat, lon: geo.lon, place: this.pinned };
    }
    const gps = await deviceGps().catch(() => null);
    if (gps) return gps;
    return ipLocate().catch(() => null);
  }
}

/** Best-effort device GPS with a short timeout; null if unavailable/denied. */
function deviceGps(): Promise<Coords | null> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      resolve(null);
      return;
    }
    let settled = false;
    const done = (v: Coords | null) => {
      if (!settled) {
        settled = true;
        resolve(v);
      }
    };
    // Hard cap independent of the API's own timeout, so a WebView that silently
    // swallows the permission prompt can't hang the resolver.
    const guard = setTimeout(() => done(null), 4500);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        clearTimeout(guard);
        done({ lat: pos.coords.latitude, lon: pos.coords.longitude, place: "" });
      },
      () => {
        clearTimeout(guard);
        done(null);
      },
      { enableHighAccuracy: false, timeout: 4000, maximumAge: 600000 },
    );
  });
}

export interface IpGeoResult {
  lat: number;
  lon: number;
  place: string;
  ip: string;
}

/**
 * Approximate location + public IP from ipwho.is, falling back to ipapi.co so one
 * provider being rate-limited doesn't blank out every caller. Shared by LocationService
 * (below) and the Weather/Network HUD panels (platform/ambient.ts).
 */
export async function ipGeoLookup(): Promise<IpGeoResult | null> {
  // ipwho.is — CORS "*", no key, generous limits.
  try {
    const d = await getJson<{
      success?: boolean;
      ip?: string;
      latitude?: number;
      longitude?: number;
      city?: string;
      region?: string;
    }>("https://ipwho.is/?fields=success,ip,latitude,longitude,city,region", { timeoutMs: 7000 });
    if (
      d &&
      d.success !== false &&
      typeof d.latitude === "number" &&
      typeof d.longitude === "number"
    ) {
      return { lat: d.latitude, lon: d.longitude, place: label(d.city, d.region), ip: d.ip || "" };
    }
  } catch {
    /* fall through */
  }
  // ipapi.co — reflects the request Origin (so it works from the preview too).
  try {
    const d = await getJson<{
      ip?: string;
      latitude?: number;
      longitude?: number;
      city?: string;
      region?: string;
      error?: boolean;
    }>("https://ipapi.co/json/", { timeoutMs: 7000 });
    if (d && !d.error && typeof d.latitude === "number" && typeof d.longitude === "number") {
      return { lat: d.latitude, lon: d.longitude, place: label(d.city, d.region), ip: d.ip || "" };
    }
  } catch {
    /* give up */
  }
  return null;
}

/** Approximate location from the public IP over HTTPS (keyless, CORS-friendly). */
async function ipLocate(): Promise<Coords | null> {
  const r = await ipGeoLookup();
  return r ? { lat: r.lat, lon: r.lon, place: r.place } : null;
}

function label(city?: string, region?: string): string {
  return [city, region].filter((p) => p && p.trim()).join(", ");
}

/**
 * Resolve a place name/address → coordinates via OSM Nominatim. When the user's
 * (lat, lon) is known, bias the search to their area so a brand with branches
 * everywhere (e.g. "Blue Tokai") resolves to the nearest one, not a same-named place
 * across the country. Port of `places.py:geocode` (the Nominatim path; Android has no
 * Google Places key).
 */
export async function geocode(
  query: string,
  lat?: number,
  lon?: number,
): Promise<GeoResult | null> {
  const q = (query ?? "")
    .replace(GEO_FILLER, "")
    .trim()
    .replace(/[?.]+$/, "")
    .trim();
  if (!q) return null;
  const haveLoc = typeof lat === "number" && typeof lon === "number";

  const fetchRows = async (bounded: boolean): Promise<GeoResult[]> => {
    const params = new URLSearchParams({ q, format: "json", limit: "5", addressdetails: "1" });
    if (haveLoc) {
      const d = 0.6; // ~60 km box: west,north,east,south
      params.set("viewbox", `${lon! - d},${lat! + d},${lon! + d},${lat! - d}`);
      if (bounded) params.set("bounded", "1");
    }
    let data: Array<{ display_name?: string; lat?: string; lon?: string }>;
    try {
      data = await getJson(`${NOMINATIM}/search?${params.toString()}`, { timeoutMs: 9000 });
    } catch {
      return [];
    }
    const out: GeoResult[] = [];
    for (const row of data ?? []) {
      const rlat = Number(row.lat);
      const rlon = Number(row.lon);
      if (Number.isFinite(rlat) && Number.isFinite(rlon)) {
        out.push({ name: row.display_name ?? q, lat: rlat, lon: rlon });
      }
    }
    return out;
  };

  // Prefer a match inside the user's area; only fall back to the best global match.
  let rows = haveLoc ? await fetchRows(true) : await fetchRows(false);
  if (!rows.length && haveLoc) rows = await fetchRows(false);
  if (!rows.length) return null;
  if (haveLoc && rows.length > 1) {
    rows.sort(
      (a, b) => haversineM(lat!, lon!, a.lat, a.lon) - haversineM(lat!, lon!, b.lat, b.lon),
    );
  }
  return rows[0];
}

/** Great-circle distance in metres. Port of `places.py:_haversine_m`. */
export function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = 6371000;
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dp = ((lat2 - lat1) * Math.PI) / 180;
  const dl = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(a));
}

/** "420 m" / "1.8 km". Port of `places.py:_pretty_dist`. */
export function prettyDist(m: number): string {
  if (m < 950) return `${Math.round(m / 10) * 10} m`;
  return `${(m / 1000).toFixed(1)} km`;
}
