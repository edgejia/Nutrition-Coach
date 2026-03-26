import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

// Minimal localStorage shim for Node.js (must precede store import)
const storage = new Map<string, string>();
globalThis.localStorage = {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => { storage.set(key, value); },
  removeItem: (key: string) => { storage.delete(key); },
  clear: () => { storage.clear(); },
  get length() { return storage.size; },
  key: (index: number) => [...storage.keys()][index] ?? null,
} as Storage;

const { useStore } = await import("../../client/src/store.js");

describe("AppStore", () => {
  beforeEach(() => {
    storage.clear();
    useStore.setState({
      deviceId: null,
      goal: null,
      dailyTargets: null,
      messages: [],
      dailySummary: null,
      sending: false,
    });
  });

  it("setDevice persists deviceId, goal, and targets to localStorage", () => {
    useStore.getState().setDevice("d-1", "fat_loss", { calories: 1500, protein: 120, carbs: 150, fat: 50 });
    assert.equal(useStore.getState().deviceId, "d-1");
    assert.equal(storage.get("deviceId"), "d-1");
    assert.equal(storage.get("goal"), "fat_loss");
    assert.ok(storage.get("dailyTargets"));
  });

  it("clearDevice removes all localStorage entries and resets state", () => {
    useStore.getState().setDevice("d-1", "fat_loss", { calories: 1500, protein: 120, carbs: 150, fat: 50 });
    useStore.getState().clearDevice();
    assert.equal(useStore.getState().deviceId, null);
    assert.equal(storage.has("deviceId"), false);
  });

  it("addMessage appends to messages list", () => {
    useStore.getState().addMessage({ id: "1", role: "user", content: "hello", createdAt: "2026-01-01T00:00:00Z" });
    useStore.getState().addMessage({ id: "2", role: "assistant", content: "hi", createdAt: "2026-01-01T00:00:01Z" });
    assert.equal(useStore.getState().messages.length, 2);
    assert.equal(useStore.getState().messages[0].content, "hello");
  });

  it("setMessages replaces entire messages list", () => {
    useStore.getState().addMessage({ id: "1", role: "user", content: "old", createdAt: "2026-01-01T00:00:00Z" });
    useStore.getState().setMessages([{ id: "2", role: "assistant", content: "new", createdAt: "2026-01-01T00:00:00Z" }]);
    assert.equal(useStore.getState().messages.length, 1);
    assert.equal(useStore.getState().messages[0].content, "new");
  });

  it("setDailySummary updates summary state", () => {
    useStore.getState().setDailySummary({ totalCalories: 500, totalProtein: 30, totalCarbs: 60, totalFat: 15 });
    assert.equal(useStore.getState().dailySummary?.totalCalories, 500);
  });

  it("setDailyTargets persists to localStorage", () => {
    const targets = { calories: 2000, protein: 150, carbs: 200, fat: 60 };
    useStore.getState().setDailyTargets(targets);
    assert.deepEqual(useStore.getState().dailyTargets, targets);
    assert.equal(storage.get("dailyTargets"), JSON.stringify(targets));
  });
});
