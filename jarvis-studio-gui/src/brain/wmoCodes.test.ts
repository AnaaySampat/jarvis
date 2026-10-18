import { describe, expect, it } from "vitest";
import { windUnit } from "./wmoCodes";

describe("windUnit", () => {
  it("uses mph only where roads do", () => {
    expect(windUnit("en-US")).toEqual({ param: "mph", label: "mph" });
    expect(windUnit("en-GB")).toEqual({ param: "mph", label: "mph" });
    expect(windUnit("es-US").param).toBe("mph");
  });

  it("uses km/h everywhere else, including the phone's en-IN", () => {
    expect(windUnit("en-IN")).toEqual({ param: "kmh", label: "km/h" });
    expect(windUnit("hi-IN").param).toBe("kmh");
    expect(windUnit("en-AU").param).toBe("kmh");
    expect(windUnit("de-DE").param).toBe("kmh");
  });

  it("falls back to km/h without a region or a valid locale", () => {
    expect(windUnit("en").param).toBe("kmh");
    expect(windUnit("").param).toBe("kmh");
    expect(windUnit("not a locale!").param).toBe("kmh");
  });
});
