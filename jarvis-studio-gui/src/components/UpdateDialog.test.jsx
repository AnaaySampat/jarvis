import { act, create } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("react-dom", () => ({ createPortal: (children) => children }));
vi.mock("../hooks/useAndroidBack", () => ({ useAndroidBack: vi.fn() }));
import UpdateDialog from "./UpdateDialog";
let view;
const release = { id: "v3.0.0", versionName: "3.0.0", channel: "stable", asset: { size: 10485760 }, features: Array.from({ length: 5 }, (_, i) => ({ id: String(i), title: `Feature ${i}`, description: "Release detail" })), fixes: [{ id: "fix", title: "Reconnect reliably" }] };
beforeEach(() => vi.stubGlobal("document", { body: {}, activeElement: null, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
afterEach(async () => { await act(async () => view?.unmount()); vi.unstubAllGlobals(); });
const updater = (phase = "available") => ({ state: { release, phase, currentVersion: "2.9.0" }, close: vi.fn(), skip: vi.fn(), act: vi.fn(), busy: false });
it("renders authored feature counts and expands all changes", async () => {
  await act(async () => { view = create(<UpdateDialog updater={updater()} />); });
  expect(JSON.stringify(view.toJSON())).toContain("5 new features");
  expect(JSON.stringify(view.toJSON())).not.toContain("Feature 4");
  const expand = view.root.findAllByType("button").find((item) => item.children.includes("See all changes"));
  await act(async () => expand.props.onClick());
  expect(JSON.stringify(view.toJSON())).toContain("Feature 4");
  expect(JSON.stringify(view.toJSON())).toContain("Reconnect reliably");
});
it("offers installation only after verification and shows download progress", async () => {
  const current = updater("ready");
  await act(async () => { view = create(<UpdateDialog updater={current} />); });
  const install = view.root.findAllByType("button").find((item) => item.children.includes("Install update"));
  await act(async () => install.props.onClick());
  expect(current.act).toHaveBeenCalledWith("install");
  await act(async () => view.update(<UpdateDialog updater={{ ...current, state: { ...current.state, phase: "downloading", downloaded: 50, total: 100 } }} />));
  expect(view.root.findByProps({ role: "progressbar" }).props["aria-valuenow"]).toBe(50);
  expect(JSON.stringify(view.toJSON())).not.toContain("Install update");
});
it("uses fix-only wording without inventing new features", async () => {
  const current = updater(); current.state.release = { ...release, features: [] };
  await act(async () => { view = create(<UpdateDialog updater={current} />); });
  expect(JSON.stringify(view.toJSON())).toContain("Improvements and fixes");
  expect(view.root.findByProps({ role: "dialog" }).props["aria-modal"]).toBe("true");
});
