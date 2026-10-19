import { beforeEach, describe, expect, it, vi } from "vitest";

// The native scheduler (RoutineAlarms.kt): null = off-device.
const schedule = vi.hoisted(() => vi.fn(async (_list: unknown[]): Promise<unknown> => null));
vi.mock("../platform", () => ({ scheduleRoutineAlarms: schedule }));

import { applyRemote, localChanges } from "./sync";
import { createStore, factTombstones } from "./store";
import {
  addRoutine,
  dueRoutines,
  listRoutines,
  removeRoutine,
  routineAlarms,
  routineChanges,
  routineWhen,
} from "../schedule/routines";

const memory = createStore();

beforeEach(async () => {
  await memory.forget("everything");
  for (const r of listRoutines()) removeRoutine(r.name);
});

describe("one memory with the PC — facts", () => {
  it("sends what changed since the cursor, deletions included", async () => {
    await memory.remember("My sister is Priya");
    const cursor = Date.now();
    await memory.remember("I like dosa");
    await memory.deleteFact("My sister is Priya");
    const out = await localChanges(memory, cursor);
    expect(out.facts.find((f) => f.text === "I like dosa")).toMatchObject({ key: "i like dosa" });
    expect(out.facts.find((f) => f.key === "my sister is priya")).toMatchObject({ deleted: true });
  });

  it("merges the PC's facts without duplicates, and a deletion sticks", async () => {
    await memory.remember("My sister is Priya");
    const changed = await applyRemote(
      {
        facts: [
          { key: "my sister is priya.", text: "My sister is Priya.", ts: 5 },
          { key: "i drive a honda", text: "I drive a Honda", ts: 6 },
        ],
      },
      memory,
    );
    expect(changed).toBe(true);
    expect((await memory.listFacts()).map((f) => f.text)).toEqual([
      "My sister is Priya",
      "I drive a Honda",
    ]);
    const learned = (await memory.listFacts()).find((f) => f.text === "I drive a Honda")!.ts!;
    await applyRemote(
      { facts: [{ key: "i drive a honda", ts: learned + 1, deleted: true }] },
      memory,
    );
    expect((await memory.listFacts()).map((f) => f.text)).toEqual(["My sister is Priya"]);
    // An older copy from before the deletion stays out.
    await applyRemote(
      { facts: [{ key: "i drive a honda", text: "I drive a Honda", ts: learned }] },
      memory,
    );
    expect((await memory.listFacts()).map((f) => f.text)).toEqual(["My sister is Priya"]);
    expect(factTombstones()["i drive a honda"]).toBeGreaterThan(learned);
  });
});

describe("one memory with the PC — routines", () => {
  it("a PC routine is listed here but its alarm is the PC's", async () => {
    await applyRemote(
      {
        routines: [
          {
            key: "morning brief",
            name: "Morning brief",
            prompt: "weather and agenda",
            time: "07:00",
            days: "mon,tue,wed,thu,fri",
            origin: "pc",
            ts: 10,
          },
        ],
      },
      memory,
    );
    const [r] = listRoutines().filter((x) => x.name === "Morning brief");
    expect(routineWhen(r!)).toBe("Mon, Tue, Wed, Thu, Fri at 07:00 (on your PC)");
    expect(routineAlarms(listRoutines())).toEqual([]);
    expect(dueRoutines(new Date(2026, 8, 30, 7, 5))).toEqual([]); // a Wednesday
  });

  it("newest wins and deletions travel", async () => {
    addRoutine({
      name: "Bedtime story",
      prompt: "read me a story",
      time: "21:00",
      days: "weekdays",
    });
    const mine = routineChanges(0).find((r) => r.key === "bedtime story")!;
    expect(mine).toMatchObject({ days: "mon,tue,wed,thu,fri", origin: "phone", time: "21:00" });

    await applyRemote(
      {
        routines: [
          { key: "bedtime story", name: "Bedtime story", prompt: "old", ts: 5, days: "daily" },
        ],
      },
      memory,
    );
    expect(listRoutines().find((r) => r.name === "Bedtime story")!.prompt).toBe("read me a story");
    await applyRemote(
      { routines: [{ key: "bedtime story", deleted: true, ts: mine.ts + 1 }] },
      memory,
    );
    expect(listRoutines().some((r) => r.name === "Bedtime story")).toBe(false);

    removeRoutine("bedtime"); // already gone: no-op
    addRoutine({ name: "Gym", prompt: "play my gym playlist" });
    removeRoutine("Gym");
    expect(routineChanges(0).find((r) => r.key === "gym")).toMatchObject({ deleted: true });
  });
});
