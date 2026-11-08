import { describe, expect, it } from "vitest";
import { PersistentStore, keywordRank } from "./store";
import { makeKV } from "./store";

describe("UI-bound conversation history", () => {
  it("keeps UI IDs/pending placeholders out of inference and patches an archived request in place", async () => {
    const store = new PersistentStore(makeKV());
    await store.appendTurn({ role: "assistant", content: "Earlier answer" });
    await store.beginChatTurn(
      { role: "user", content: "Current request", uiId: "user-current" },
      { role: "assistant", content: "", uiId: "reply-current", uiPending: true },
    );
    expect(await store.recentTurns(12, ["user-current", "reply-current"])).toEqual([
      { role: "assistant", content: "Earlier answer" },
    ]);
    await store.archiveConversation();
    expect(
      await store.updateChatTurn({
        role: "assistant",
        content: "Late answer",
        uiId: "reply-current",
      }),
    ).toBe(true);
    expect(await store.recentChatTurns()).toEqual([]);
    const archive = (await store.listRecents())[0];
    expect(archive.turns[2]).toMatchObject({
      uiId: "reply-current",
      content: "Late answer",
      uiPending: false,
    });
    await store.restoreRecent(archive.id);
    expect(JSON.stringify(await store.recentTurns())).not.toMatch(/uiId|uiPending/);
    expect((await store.recentChatTurns())[2].uiId).toBe("reply-current");
    await store.clearConversation();
    await store.deleteRecent(archive.id);
    expect(
      await store.updateChatTurn({
        role: "assistant",
        content: "Must not return",
        uiId: "reply-current",
      }),
    ).toBe(false);
    expect(await store.recentTurns()).toEqual([]);
  });
});

describe("keywordRank", () => {
  const facts = [
    "User's favorite coffee is a flat white",
    "User works as a software engineer",
    "User has a dog named Biscuit",
    "User lives in Mumbai",
    "User prefers dark mode everywhere",
  ];

  it("ranks facts sharing keywords with the query above unrelated ones", () => {
    const top = keywordRank("what coffee do I like", facts, 2);
    expect(top[0]).toBe(facts[0]);
  });

  it("returns all facts unranked when nothing overlaps at all", () => {
    const top = keywordRank("xyzzy quux plugh", facts, 2);
    expect(top).toEqual(facts);
  });

  it("returns all facts unranked when the query has no non-stopword tokens", () => {
    const top = keywordRank("what is the", facts, 2);
    expect(top).toEqual(facts);
  });

  it("respects the k limit", () => {
    const top = keywordRank("user", facts, 2);
    expect(top.length).toBe(2);
  });
});

describe("PersistentStore facts()", () => {
  it("remembers and returns facts unranked below the ranking threshold", async () => {
    const store = new PersistentStore();
    await store.remember("User likes tea");
    await store.remember("User owns a bicycle");
    const facts = await store.facts("tea");
    // Below the 5-fact threshold — always returns everything, unranked.
    expect(facts).toEqual(["User likes tea", "User owns a bicycle"]);
  });

  it("keyword-ranks once there are enough facts and no Vertex creds are given", async () => {
    const store = new PersistentStore();
    await store.remember("User's favorite coffee is a flat white");
    await store.remember("User works as a software engineer");
    await store.remember("User has a dog named Biscuit");
    await store.remember("User lives in Mumbai");
    await store.remember("User prefers dark mode everywhere");
    const facts = await store.facts("what coffee do I like");
    expect(facts[0]).toBe("User's favorite coffee is a flat white");
  });

  it("forget('everything') clears all facts", async () => {
    const store = new PersistentStore();
    await store.remember("fact one");
    await store.remember("fact two");
    await store.forget("everything");
    expect(await store.facts()).toEqual([]);
  });

  it("forget matches case-insensitively by substring", async () => {
    const store = new PersistentStore();
    await store.remember("User's favorite coffee is a flat white");
    await store.remember("User owns a bicycle");
    await store.forget("COFFEE");
    expect(await store.facts()).toEqual(["User owns a bicycle"]);
  });
});
