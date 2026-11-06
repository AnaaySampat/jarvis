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
async function render(initialPage, onOpenHandsFree) {
  let view;
  await act(async () => {
    view = create(
      <Settings
        initialPage={initialPage}
        onOpenHandsFree={onOpenHandsFree}
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

it("opens the shared activity workspace from Settings and the Voice link", async () => {
  const open = vi.fn();
  const view = await render("voice", open);
  expect(view.root.findAllByProps({ "aria-label": "Gesture controls" })).toHaveLength(0);
  const nav = view.root.findByProps({ "aria-label": "Settings sections" });
  const entry = nav.findAllByType("button").find((node) => titleOf(node) === "Activities & gestures");
  await act(async () => entry.props.onClick());
  expect(open).toHaveBeenCalledOnce();
  expect(view.root.findAllByProps({ "aria-label": "Gesture controls" })).toHaveLength(0);
  const link = view.root.findAllByType("button").find((node) => node.findAll((item) => item.children.includes("Open activities")).length);
  await act(async () => link.props.onClick());
  expect(open).toHaveBeenCalledTimes(2);
  await act(async () => view.unmount());
});

it("finds the Activities entry using camera, practice and motion", async () => {
  const view = await render();
  const search = view.root.findByProps({ "aria-label": "Search settings" });
  for (const query of ["camera", "practice", "motion", "reading", "steps"]) {
    await act(async () => search.props.onChange({ target: { value: query } }));
    const nav = view.root.findByProps({ "aria-label": "Settings sections" });
    expect(nav.findAllByType("button").map(titleOf)).toContain("Activities & gestures");
  }
  await act(async () => view.unmount());
});
