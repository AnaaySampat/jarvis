import { invoke } from "@tauri-apps/api/core";

export interface UpdateHighlight { id: string; title: string; description?: string }
export interface AppRelease {
  id: string;
  versionName: string;
  title?: string;
  channel?: "stable" | "beta";
  url: string;
  features: UpdateHighlight[];
  fixes: UpdateHighlight[];
  asset?: { size: number };
  legacy?: boolean;
  incompatible?: boolean;
}
export interface AppUpdateState {
  phase?: string;
  release?: AppRelease;
  currentVersion?: string;
  currentCode?: number;
  channel?: "stable" | "beta";
  automatic?: boolean;
  autoDownload?: boolean;
  checkedAt?: number;
  retryAt?: number;
  downloaded?: number;
  total?: number;
  error?: string;
  eligible?: boolean;
  openRequested?: boolean;
}

export function appUpdate(action = "status", options: Record<string, unknown> = {}): Promise<AppUpdateState> {
  return invoke("plugin:phone|app_update", { action, options: JSON.stringify(options) });
}

export function featureSummary(features: UpdateHighlight[]): string {
  return features.length ? `${features.length} new ${features.length === 1 ? "feature" : "features"}` : "Improvements and fixes";
}

export function formatUpdateBytes(bytes = 0): string {
  return `${(Math.max(0, bytes) / (1024 * 1024)).toFixed(1)} MB`;
}

export function shouldOfferUpdate(state: AppUpdateState, blocked: boolean, visible: boolean): boolean {
  return visible && !blocked && Boolean(state.release) && state.eligible === true && !state.release?.incompatible;
}
