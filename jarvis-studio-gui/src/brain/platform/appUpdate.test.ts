import { describe, expect, it, vi } from "vitest";
const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
import { appUpdate, featureSummary, formatUpdateBytes, shouldOfferUpdate, type AppUpdateState } from "./appUpdate";
const available: AppUpdateState = { eligible: true, release: { id: "v3.0.0", versionName: "3.0.0", url: "https://github.com/AnaaySampat/jarvis/releases/tag/v3.0.0", features: [], fixes: [] } };
describe("Android update presentation", () => {
  it("uses the supplied feature count, including fix-only and single-feature releases", () => {
    expect(featureSummary([])).toBe("Improvements and fixes");
    expect(featureSummary([{ id: "a", title: "A" }])).toBe("1 new feature");
    expect(featureSummary([{ id: "a", title: "A" }, { id: "b", title: "B" }])).toBe("2 new features");
    expect(formatUpdateBytes(10485760)).toBe("10.0 MB");
  });
  it("defers notices during tasks, in the background, and for skipped or incompatible releases", () => {
    expect(shouldOfferUpdate(available, false, true)).toBe(true);
    expect(shouldOfferUpdate(available, true, true)).toBe(false);
    expect(shouldOfferUpdate(available, false, false)).toBe(false);
    expect(shouldOfferUpdate({ ...available, eligible: false }, false, true)).toBe(false);
    expect(shouldOfferUpdate({ ...available, release: { ...available.release!, incompatible: true } }, false, true)).toBe(false);
  });
  it("passes a release identity to the native service rather than an install URL", async () => {
    invoke.mockResolvedValue(available);
    await appUpdate("download", { releaseId: "v3.0.0" });
    expect(invoke).toHaveBeenCalledWith("plugin:phone|app_update", { action: "download", options: '{"releaseId":"v3.0.0"}' });
  });
});
