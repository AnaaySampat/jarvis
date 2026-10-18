import { describe, expect, it, vi } from "vitest";

const getJson = vi.hoisted(() => vi.fn());
vi.mock("../tools/httpClient", () => ({ getJson }));

import { fetchPanelWeather } from "./ambient";

describe("fetchPanelWeather", () => {
  it("gives the current condition's own glyph, not the hourly forecast's", async () => {
    // Seen on the phone: the observation said overcast while this hour's forecast
    // said rain, and the card drew rain beside "Overcast".
    getJson.mockResolvedValue({
      current: { temperature_2m: 34, weather_code: 3, time: "2026-10-18T14:30" },
      hourly: {
        time: ["2026-10-18T14:00", "2026-10-18T15:00"],
        temperature_2m: [33, 33],
        weather_code: [63, 63],
      },
    });
    const w = await fetchPanelWeather({ lat: 51.5, lon: -0.1, place: "Testville", publicIp: "" });
    expect(w?.condition).toBe("overcast");
    expect(w?.icon).toBe("☁");
    expect(w?.hours[0]).toMatchObject({ t: "14:00", i: "🌧" });
  });
});
