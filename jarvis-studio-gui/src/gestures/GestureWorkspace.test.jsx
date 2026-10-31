import { act, create } from "react-test-renderer";
import { expect, it, vi } from "vitest";
import GestureWorkspace from "./GestureWorkspace";
import { defaults } from "./engine";

it("attaches the preview when startup transitions to a real webcam stream", async () => {
  const preview = vi.fn(),
    video = {};
  const controls = {
    config: defaults(),
    status: { starting: true, running: false },
    step: 0,
    page: 0,
    cursor: null,
    camera: { preview },
    stop: vi.fn(),
  };
  let renderer;
  await act(async () => {
    renderer = create(<GestureWorkspace controls={controls} />, {
      createNodeMock: (element) => (element.type === "video" ? video : null),
    });
  });
  expect(preview).not.toHaveBeenCalled();
  await act(async () => {
    renderer.update(
      <GestureWorkspace
        controls={{
          ...controls,
          status: { starting: false, running: true },
        }}
      />,
    );
  });
  expect(preview).toHaveBeenCalledWith(video);
  await act(async () => renderer.unmount());
});
