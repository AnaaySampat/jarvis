/* Device telemetry — ANDROID FORK.
 *
 * Merges WebView signals (Network Information API) with native Android stats from
 * tauri-plugin-phone (CPU/RAM/storage/battery). The HUD gauges update ~every 1.5s.
 */

import { invoke } from "@tauri-apps/api/core";
import { inTauri } from "../tools/httpClient";

export interface Telemetry {
  cpu: number;
  ram: number;
  disk: number;
  diskActivity: number;
  gpu: number;
  net: number;
  down: number;
  up: number;
  ping: number;
  temp: number | null;
  batteryPct: number | null;
  charging: boolean;
  remaining: string;
  ramTotalGb: number;
  diskUsedGb: number;
  diskTotalGb: number;
  gpuName: string;
  /** Human-readable network link label (WiFi / 4G / offline). */
  linkLabel: string;
}

const BATTERY_EVENTS = [
  "levelchange",
  "chargingchange",
  "chargingtimechange",
  "dischargingtimechange",
] as const;

function fmtRemaining(secs: unknown, charging: boolean): string {
  const s = Number(secs);
  if (!Number.isFinite(s) || s <= 0) return "";
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  const t = h > 0 ? `${h}h ${m}m` : `${m}m`;
  return charging ? `${t} to full` : `${t} left`;
}

type NativeStats = Partial<Telemetry> & {
  batteryPct?: number | null;
  ramTotalGb?: number;
  diskUsedGb?: number;
  diskTotalGb?: number;
};

let warnedOnce = false;

async function fetchNativeStats(): Promise<NativeStats | null> {
  if (!inTauri()) return null;
  try {
    return (await invoke("plugin:phone|get_device_stats")) as NativeStats;
  } catch (e) {
    // A permanently-failing native call is exactly what makes every HUD gauge
    // look "dead" (frozen at 0/NO DATA forever) with zero visible signal why —
    // log it once so this is diagnosable from the WebView console / logcat
    // instead of silently swallowed on every 1.5s poll.
    if (!warnedOnce) {
      warnedOnce = true;
      console.warn("Device telemetry native call failed:", e);
    }
    return null;
  }
}

/** The Network Information API (non-standard; Chromium WebViews have it). */
interface NetConnection extends EventTarget {
  downlink?: number;
  rtt?: number;
  type?: string;
  effectiveType?: string;
}

/** The Battery Status API's BatteryManager. */
interface BatteryInfo extends EventTarget {
  level?: number;
  charging?: boolean;
  chargingTime?: number;
  dischargingTime?: number;
}

function linkLabelFromConnection(conn: NetConnection | null, online: boolean): string {
  if (!online) return "OFFLINE";
  if (!conn) return "CONNECTED";
  const type = String(conn.type || conn.effectiveType || "").toLowerCase();
  if (type.includes("wifi") || type === "4g" || type === "3g" || type === "2g" || type === "5g") {
    return type.toUpperCase();
  }
  if (conn.effectiveType) return String(conn.effectiveType).toUpperCase();
  return "ONLINE";
}

/**
 * Subscribe to live device telemetry. Calls `cb` immediately, on battery/network
 * events, and on a ~1.5s poll (native CPU needs consecutive /proc/stat samples).
 */
export function subscribeTelemetry(cb: (t: Telemetry) => void): () => void {
  if (typeof navigator === "undefined") return () => {};
  const nav = navigator as Navigator & {
    connection?: NetConnection;
    webkitConnection?: NetConnection;
    mozConnection?: NetConnection;
    deviceMemory?: number;
    getBattery?: () => Promise<BatteryInfo>;
    onLine?: boolean;
  };
  const conn = nav.connection || nav.webkitConnection || nav.mozConnection || null;
  let battery: BatteryInfo | null = null;
  let stopped = false;
  let nativeCache: NativeStats | null = null;

  const snapshot = (): Telemetry => {
    const online = nav.onLine !== false;
    const ramTotal =
      nativeCache?.ramTotalGb ?? (Number(nav.deviceMemory) > 0 ? Number(nav.deviceMemory) : 0);
    const t: Telemetry = {
      cpu: nativeCache?.cpu ?? 0,
      ram: nativeCache?.ram ?? 0,
      disk: nativeCache?.disk ?? 0,
      diskActivity: nativeCache?.disk ?? 0,
      gpu: 0,
      net: 0,
      down: 0,
      up: 0,
      ping: 0,
      temp: nativeCache?.temp ?? null,
      batteryPct: nativeCache?.batteryPct ?? null,
      charging: nativeCache?.charging ?? false,
      remaining: nativeCache?.remaining ?? "",
      ramTotalGb: ramTotal,
      diskUsedGb: nativeCache?.diskUsedGb ?? 0,
      diskTotalGb: nativeCache?.diskTotalGb ?? 0,
      gpuName: "",
      linkLabel: linkLabelFromConnection(conn, online),
    };
    if (battery && t.batteryPct == null) {
      t.batteryPct = Math.round((battery.level ?? 0) * 100);
      t.charging = !!battery.charging;
      t.remaining = fmtRemaining(
        battery.charging ? battery.chargingTime : battery.dischargingTime,
        t.charging,
      );
    }
    if (conn) {
      const dl = Number(conn.downlink);
      if (Number.isFinite(dl) && dl > 0) {
        t.down = dl;
        t.net = Math.min(100, Math.round(dl * 8));
      }
      const rtt = Number(conn.rtt);
      if (Number.isFinite(rtt) && rtt > 0) t.ping = Math.round(rtt);
    }
    if (t.net === 0 && online) {
      t.net = t.ping > 0 ? Math.max(8, Math.min(100, 100 - Math.round(t.ping / 5))) : 24;
    }
    return t;
  };

  const emit = () => {
    if (!stopped) cb(snapshot());
  };

  const pollNative = async () => {
    const n = await fetchNativeStats();
    if (stopped) return;
    if (n) nativeCache = { ...nativeCache, ...n };
    emit();
  };

  if (typeof nav.getBattery === "function") {
    nav
      .getBattery()
      .then((b) => {
        if (stopped) return;
        battery = b;
        BATTERY_EVENTS.forEach((ev) => b.addEventListener?.(ev, emit));
        emit();
      })
      .catch(() => {});
  }
  conn?.addEventListener?.("change", emit);
  if (typeof window !== "undefined") {
    window.addEventListener("online", emit);
    window.addEventListener("offline", emit);
  }
  void pollNative();
  const iv = setInterval(() => {
    void pollNative();
  }, 1500);
  emit();

  return () => {
    stopped = true;
    clearInterval(iv);
    conn?.removeEventListener?.("change", emit);
    if (typeof window !== "undefined") {
      window.removeEventListener("online", emit);
      window.removeEventListener("offline", emit);
    }
    const b = battery;
    if (b) BATTERY_EVENTS.forEach((ev) => b.removeEventListener(ev, emit));
  };
}
