import { describe, expect, it } from "vitest";
import { mapPointToScreen } from "./webrtcScreen";

// The element is the phone's video box; the PC screen (videoW×videoH) is drawn
// inside it with object-fit: contain (centered + letterboxed). mapPointToScreen
// must invert that to a 0–1000 point over the ACTUAL picture.
describe("mapPointToScreen", () => {
  it("maps the center of a perfectly-fitting video to (500,500)", () => {
    // 400×300 element, 800×600 screen → same aspect, no letterbox.
    const rect = { left: 0, top: 0, width: 400, height: 300 };
    expect(mapPointToScreen(rect, 800, 600, 200, 150)).toEqual({ x: 500, y: 500 });
  });

  it("maps the top-left corner of the picture to (0,0)", () => {
    const rect = { left: 0, top: 0, width: 400, height: 300 };
    expect(mapPointToScreen(rect, 800, 600, 0, 0)).toEqual({ x: 0, y: 0 });
  });

  it("accounts for the element's page offset", () => {
    const rect = { left: 100, top: 50, width: 400, height: 300 };
    expect(mapPointToScreen(rect, 800, 600, 300, 200)).toEqual({ x: 500, y: 500 });
  });

  it("handles horizontal letterboxing (wide element, 16:9 screen)", () => {
    // Element 400×300 (4:3), screen 1920×1080 (16:9): fits to width 400, rendered
    // height 225, so 37.5px black bars top & bottom. Center of the ELEMENT is still
    // the center of the PICTURE → (500,500).
    const rect = { left: 0, top: 0, width: 400, height: 300 };
    expect(mapPointToScreen(rect, 1920, 1080, 200, 150)).toEqual({ x: 500, y: 500 });
    // The picture spans y ∈ [37.5, 262.5]; its top edge maps to y=0.
    expect(mapPointToScreen(rect, 1920, 1080, 200, 37.5)).toEqual({ x: 500, y: 0 });
  });

  it("returns null for a tap in the letterbox margin (outside the picture)", () => {
    const rect = { left: 0, top: 0, width: 400, height: 300 };
    // y=10 is inside the 37.5px top black bar → not a real screen point.
    expect(mapPointToScreen(rect, 1920, 1080, 200, 10)).toBeNull();
  });

  it("returns null when dimensions are degenerate", () => {
    expect(mapPointToScreen({ left: 0, top: 0, width: 0, height: 0 }, 800, 600, 0, 0)).toBeNull();
    expect(mapPointToScreen({ left: 0, top: 0, width: 400, height: 300 }, 0, 0, 10, 10)).toBeNull();
  });

  it("clamps to the 0–1000 range at the far corner", () => {
    const rect = { left: 0, top: 0, width: 400, height: 300 };
    expect(mapPointToScreen(rect, 800, 600, 400, 300)).toEqual({ x: 1000, y: 1000 });
  });
});
