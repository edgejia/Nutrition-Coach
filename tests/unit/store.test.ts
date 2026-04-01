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
const storeModuleUrl = new URL("../../client/src/store.ts", import.meta.url);

async function loadFreshStore(suffix: string) {
  return import(`${storeModuleUrl.href}?${suffix}`);
}

const sampleMeals = [
  {
    id: "meal-1",
    foodName: "雞胸肉便當",
    calories: 520,
    protein: 42,
    carbs: 48,
    fat: 18,
    loggedAt: "2026-04-01T04:30:00.000Z",
  },
  {
    id: "meal-2",
    foodName: "優格",
    calories: 180,
    protein: 12,
    carbs: 20,
    fat: 6,
    loggedAt: "2026-04-01T08:00:00.000Z",
  },
];

describe("AppStore", () => {
  beforeEach(() => {
    storage.clear();
    useStore.setState({
      deviceId: null,
      goal: null,
      activeScreen: "onboarding",
      dailyTargets: null,
      messages: [],
      dailySummary: null,
      coachAdvice: null,
      meals: [],
      pendingHomeChatDraft: null,
      sending: false,
    });
  });

  it("defaults activeScreen to onboarding without a stored device", async () => {
    const freshStore = await loadFreshStore(`store-no-device-${Date.now()}`);
    assert.equal(freshStore.useStore.getState().activeScreen, "onboarding");
  });

  it("defaults activeScreen to home when a device is already stored", async () => {
    storage.set("deviceId", "existing-device");
    storage.set("goal", "fat_loss");
    storage.set("dailyTargets", JSON.stringify({ calories: 1500, protein: 120, carbs: 150, fat: 50 }));

    const freshStore = await loadFreshStore(`store-with-device-${Date.now()}`);
    assert.equal(freshStore.useStore.getState().activeScreen, "home");
  });

  it("setDevice persists deviceId, goal, and targets to localStorage and enters home", () => {
    useStore.getState().setDevice("d-1", "fat_loss", { calories: 1500, protein: 120, carbs: 150, fat: 50 });
    assert.equal(useStore.getState().deviceId, "d-1");
    assert.equal(useStore.getState().activeScreen, "home");
    assert.equal(storage.get("deviceId"), "d-1");
    assert.equal(storage.get("goal"), "fat_loss");
    assert.ok(storage.get("dailyTargets"));
  });

  it("clearDevice removes all localStorage entries and resets dashboard-first state", () => {
    useStore.getState().setDevice("d-1", "fat_loss", { calories: 1500, protein: 120, carbs: 150, fat: 50 });
    useStore.getState().setActiveScreen("chat");
    useStore.getState().setCoachAdvice("今天攝取均衡，繼續保持！");
    useStore.getState().setMeals(sampleMeals);
    useStore.getState().setPendingHomeChatDraft({ id: "draft-1", text: "午餐吃了沙拉", status: "failed" });
    useStore.getState().clearDevice();

    assert.equal(useStore.getState().deviceId, null);
    assert.equal(useStore.getState().activeScreen, "onboarding");
    assert.equal(useStore.getState().coachAdvice, null);
    assert.deepEqual(useStore.getState().meals, []);
    assert.equal(useStore.getState().pendingHomeChatDraft, null);
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
    useStore.getState().setDailySummary({ totalCalories: 500, totalProtein: 30, totalCarbs: 60, totalFat: 15, mealCount: 1 });
    assert.equal(useStore.getState().dailySummary?.totalCalories, 500);
  });

  it("setDailyTargets persists to localStorage", () => {
    const targets = { calories: 2000, protein: 150, carbs: 200, fat: 60 };
    useStore.getState().setDailyTargets(targets);
    assert.deepEqual(useStore.getState().dailyTargets, targets);
    assert.equal(storage.get("dailyTargets"), JSON.stringify(targets));
  });

  it("tracks activeScreen changes and meal collection helpers", () => {
    useStore.getState().setActiveScreen("summary");
    useStore.getState().setMeals(sampleMeals);
    useStore.getState().removeMeal("meal-1");

    assert.equal(useStore.getState().activeScreen, "summary");
    assert.deepEqual(useStore.getState().meals, [sampleMeals[1]]);
  });

  it("stores and clears the pending home chat draft", () => {
    useStore.getState().setPendingHomeChatDraft({ id: "draft-1", text: "晚餐吃了鮭魚", status: "staged" });
    assert.deepEqual(useStore.getState().pendingHomeChatDraft, {
      id: "draft-1",
      text: "晚餐吃了鮭魚",
      status: "staged",
    });

    useStore.getState().clearPendingHomeChatDraft();
    assert.equal(useStore.getState().pendingHomeChatDraft, null);
  });
});
