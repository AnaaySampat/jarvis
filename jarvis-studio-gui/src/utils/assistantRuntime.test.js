import { expect, it } from "vitest";
import { usesLocalAssistant } from "./assistantRuntime";
it("uses the in-app brain for browser previews at any size and for native Android", () => {
  expect(usesLocalAssistant(false, "Desktop Chrome")).toBe(true);
  expect(usesLocalAssistant(true, "Android WebView")).toBe(true);
  expect(usesLocalAssistant(true, "Windows WebView2")).toBe(false);
});
