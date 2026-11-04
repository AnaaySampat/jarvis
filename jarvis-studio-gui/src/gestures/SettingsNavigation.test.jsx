import { act, create } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import Settings from "../components/Settings";
import { defaults } from "./engine";

vi.mock("../hooks/useAssistant", () => ({ IS_MOBILE: true }));
vi.mock("../hooks/useAndroidBack", () => ({ useAndroidBack: vi.fn() }));
vi.mock("../brain/platform", () => ({
  getGrantedFolder: () => null,
  pickGrantedFolder: vi.fn(),
  requestCalendarPermission: vi.fn(),
  requestNotificationAccess: vi.fn(),
}));
vi.mock("../brain/quota", () => ({ snapshot: () => ({ benched: [] }) }));
vi.mock("../brain/schedule/routines", () => ({ listRoutines: () => [] }));

beforeEach(() => {
  vi.stubGlobal("window", {
    matchMedia: () => ({ matches: true }),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
});
afterEach(() => vi.unstubAllGlobals());

const controls = () => ({
  config: defaults(),
  status: { running: false, starting: false },
  camera: {},
  supported: true,
  bookmarks: [],
  start: vi.fn(),
  stop: vi.fn(),
  changeConfig: vi.fn(),
  setPractice: vi.fn(),
});
async function render(initialPage) {
  let view;
  await act(async () => {
    view = create(
      <Settings
        initialPage={initialPage}
        sysInfo={{}}
        onClose={vi.fn()}
        onSave={vi.fn()}
        gestureControls={controls()}
      />,
    );
  });
  return view;
}
const titleOf = (node) =>
  node
    .findAll((item) => item.type === "span" && item.props.className === "sp-nav-title")
    .map((item) => item.children.join(""))[0];

it("opens a single gesture panel from its dedicated Settings entry and Voice link", async () => {
  const view = await render("voice");
  expect(view.root.findAllByProps({ "aria-label": "Gesture controls" })).toHaveLength(0);
  const nav = view.root.findByProps({ "aria-label": "Settings sections" });
  const entry = nav.findAllByType("button").find((node) => titleOf(node) === "Gestures");
  expect(entry).toBeDefined();
  await act(async () => entry.props.onClick());
  expect(view.root.findAllByProps({ "aria-label": "Gesture controls" })).toHaveLength(1);
  await act(async () =>
    nav
      .findAllByType("button")
      .find((node) => titleOf(node) === "Voice")
      .props.onClick(),
  );
  expect(view.root.findAllByProps({ "aria-label": "Gesture controls" })).toHaveLength(0);
  const link = view.root
    .findAllByType("button")
    .find((node) => node.findAll((item) => item.children.includes("Open gesture controls")).length);
  await act(async () => link.props.onClick());
  expect(view.root.findAllByProps({ "aria-label": "Gesture controls" })).toHaveLength(1);
  await act(async () => view.unmount());
});

it("finds the dedicated Gestures entry using camera, practice and motion", async () => {
  const view = await render();
  const search = view.root.findByProps({ "aria-label": "Search settings" });
  for (const query of ["camera", "practice", "motion"]) {
    await act(async () => search.props.onChange({ target: { value: query } }));
    const nav = view.root.findByProps({ "aria-label": "Settings sections" });
    expect(nav.findAllByType("button").map(titleOf)).toContain("Gestures");
  }
  await act(async () => view.unmount());
});
