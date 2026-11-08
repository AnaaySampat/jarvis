import type { NativeHealth } from "./platform";
import { taskDisplayState } from "../hooks/workflowTasks";
import { DIAGNOSTIC_METRICS } from "./toolMetrics";

export interface HealthRow {
  id: string;
  category:
    | "connection"
    | "compatibility"
    | "permission"
    | "provider"
    | "connector"
    | "background"
    | "storage";
  label: string;
  status: "ready" | "attention" | "unknown" | "unavailable";
  detail: string;
  repair?: string;
}
type SysInfo = Record<string, unknown>;
export function ecosystemHealth(
  native: NativeHealth | null,
  sys: SysInfo,
  pcState: string,
  pcVersion = "",
): HealthRow[] {
  const rows: HealthRow[] = [
    {
      id: "phone",
      category: "connection",
      label: "This phone",
      status: native?.ok ? "ready" : "unknown",
      detail: native?.ok
        ? `JARVIS ${native.appVersion} · Android API ${native.sdk}`
        : "Native health has not responded.",
      repair: "refresh",
    },
    {
      id: "pc",
      category: "connection",
      label: "Windows PC",
      status: pcState === "online" ? "ready" : "attention",
      detail:
        pcState === "online"
          ? `Authenticated connection${pcVersion ? ` · JARVIS ${pcVersion}` : " · version not advertised"}`
          : "PC is unavailable or needs pairing. Accepted PC work stays owned by the PC.",
      repair: "pair",
    },
    {
      id: "protocol",
      category: "compatibility",
      label: "Compatibility",
      status: pcState === "online" ? "ready" : "unknown",
      detail:
        pcState === "online"
          ? "Existing signed task protocol v2. New portable features remain gated."
          : "Connect the PC to check protocol compatibility.",
      repair: "pair",
    },
  ];
  const disclosures: Record<string, [string, string, string]> = {
    accessibility: [
      "App control",
      "Reads the screen and taps controls only for authorized phone tasks. Turn it off in Android Accessibility to revoke access.",
      "accessibility",
    ],
    microphone: [
      "Microphone",
      "Used for voice requests and enabled wake-word listening. Typed requests work when it is denied.",
      "app_permissions",
    ],
    calendar: [
      "Calendar",
      "Reads and saves requested calendar events. With access denied, an opened draft is never reported as saved.",
      "app_permissions",
    ],
    notificationAccess: [
      "Notification access",
      "Reads requested notifications and handles enabled commands from listed WhatsApp contacts. Disable access in Android to revoke it.",
      "notification_access",
    ],
    notifications: [
      "Progress notifications",
      "Shows task progress, reminders and cancellation controls. Android can hide these when notifications are denied.",
      "notifications",
    ],
  };
  for (const [id, [label, detail, repair]] of Object.entries(disclosures)) {
    const value = native?.ok ? native.permissions[id] : undefined;
    rows.push({
      id,
      category: "permission",
      label,
      status: value === true ? "ready" : value === false ? "attention" : "unknown",
      detail,
      repair,
    });
  }
  const configured = [
    "vertex_sa",
    "gemini_key",
    "groq_key",
    "openrouter_key",
    "nvidia_key",
    "mistral_key",
  ].some((name) => sys[`has_${name}`] === true);
  rows.push({
    id: "providers",
    category: "provider",
    label: "Model providers",
    status: configured ? "unknown" : "attention",
    detail: configured
      ? "Credentials configured. Availability depends on provider connectivity and quota; run the connection test."
      : "Add a model provider key to run assistant tasks.",
    repair: configured ? "test" : "keys",
  });
  rows.push({
    id: "google",
    category: "connector",
    label: "Google email and calendar",
    status: "unavailable",
    detail:
      "Portable Google authorization is planned after the foundation gate. Android calendar permission is separate.",
  });
  rows.push({
    id: "background",
    category: "background",
    label: "Background execution",
    status: !native?.ok
      ? "unknown"
      : native.backgroundRestricted || !native.batteryExempt
        ? "attention"
        : "ready",
    detail:
      "The native phone operator can continue independently. Android may delay background work; portable research and document jobs are not available yet.",
    repair: "background",
  });
  return rows;
}

const safeVersion = (value: unknown) =>
  typeof value === "string" && /^[0-9]{1,3}(\.[0-9]{1,3}){0,3}([+-][a-z0-9.]{1,24})?$/.test(value)
    ? value
    : "";
const count = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.min(604800000, Math.floor(value))
    : undefined;

/** Closed projection: never stringify settings, errors, goals, receipts, or provider routes. */
export function diagnosticReport(
  rows: HealthRow[],
  tasks: Array<{ status?: string; metrics?: Record<string, unknown> }>,
  androidVersion: string,
  windowsVersion: string,
) {
  return {
    version: 1,
    versions: {
      android: safeVersion(androidVersion),
      windows: safeVersion(windowsVersion),
      contract: "1.0.0",
    },
    categories: [
      ...new Set(rows.filter((row) => row.status !== "ready").map((row) => row.category)),
    ],
    tasks: tasks.slice(-100).map((task, i) => ({
      id: `task-${i + 1}`,
      status: taskDisplayState(task),
      elapsed_ms: count(task.metrics?.elapsed_ms),
      tool_calls: count(task.metrics?.tool_calls),
      model_decisions: count(task.metrics?.model_decisions),
      unverified_results: count(task.metrics?.unverified_results),
      ...(task.metrics?.instrumentation_version === 2 ? Object.fromEntries(
        DIAGNOSTIC_METRICS.map((key) => [key, count(task.metrics?.[key])]),
      ) : {}),
      provider_cost: null,
    })),
  };
}
