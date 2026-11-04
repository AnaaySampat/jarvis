import { useEffect } from "react";
import { act, create } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vitest";
import SetupProgress from "./SetupProgress";
import BootOverlay from "./BootOverlay";
import { useLocalExploration } from "../hooks/useLocalExploration";

let renderer;
afterEach(async () => {
  await act(async () => renderer?.unmount());
  vi.unstubAllGlobals();
});
it("allows continuing after an optional component fails and offers retry", async () => {
  const repair = vi.fn();
  const progress = {
    complete: true,
    order: ["voice"],
    total: 1,
    items: { voice: { status: "error", label: "Voice", error: "Unavailable" } },
  };
  await act(async () => {
    renderer = create(<SetupProgress progress={progress} onRepair={repair} />);
  });
  const buttons = renderer.root.findAllByType("button");
  expect(buttons.map((button) => button.children.join(""))).toContain(
    "Retry setup",
  );
  await act(async () => {
    buttons
      .find(
        (button) =>
          button.children.join("") === "Continue with available features",
      )
      .props.onClick();
  });
  expect(renderer.toJSON()).toBeNull();
  expect(repair).not.toHaveBeenCalled();
});
it("offers startup recovery before a backend connection exists", async () => {
  vi.stubGlobal("window", {});
  const proceed = vi.fn();
  await act(async () => {
    renderer = create(<BootOverlay connected={false} onContinue={proceed} />);
  });
  const buttons = renderer.root.findAllByType("button");
  expect(buttons.map((button) => button.children.join(""))).toContain(
    "Retry startup",
  );
  await act(async () => {
    buttons[0].props.onClick();
  });
  expect(proceed).toHaveBeenCalledOnce();
});
it("remembers an explicit key-free exploration choice across remount", async () => {
  const saved = new Map();
  let state;
  vi.stubGlobal("localStorage", {
    getItem: (key) => saved.get(key),
    setItem: (key, value) => saved.set(key, value),
  });
  function App() {
    const value = useLocalExploration();
    useEffect(() => {
      state = value;
    });
    return null;
  }
  await act(async () => {
    renderer = create(<App />);
  });
  expect(state[0]).toBe(false);
  await act(async () => {
    state[1]();
  });
  await act(async () => {
    renderer.unmount();
  });
  await act(async () => {
    renderer = create(<App />);
  });
  expect(state[0]).toBe(true);
});
