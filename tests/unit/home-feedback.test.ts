import { describe, it } from "node:test";
import assert from "node:assert/strict";
const storage = new Map<string, string>();
globalThis.localStorage = {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => {
    storage.set(key, value);
  },
  removeItem: (key: string) => {
    storage.delete(key);
  },
  clear: () => {
    storage.clear();
  },
  get length() {
    return storage.size;
  },
  key: (index: number) => [...storage.keys()][index] ?? null,
} as Storage;

const { getDisplayedCoachAdvice, formatHomeHeaderDate } = await import("../../client/src/components/HomeScreen.js");

describe("Home screen helpers", () => {
  it("prefers freshly derived coach advice over stale stored advice", () => {
    const advice = getDisplayedCoachAdvice(
      "昨天的舊建議",
      {
        date: "2026-04-01",
        totalCalories: 900,
        totalProtein: 40,
        totalCarbs: 80,
        totalFat: 20,
        mealCount: 2,
      },
      { calories: 1800, protein: 140, carbs: 180, fat: 60 },
    );

    assert.equal(advice, "蛋白質還差 100g，晚餐建議高蛋白食物");
  });

  it("formats HomeHeader date keys with the existing zh-TW month/day/weekday style", () => {
    const expected = new Date(2026, 2, 25).toLocaleDateString("zh-TW", {
      month: "long",
      day: "numeric",
      weekday: "short",
    });

    assert.equal(formatHomeHeaderDate("2026-03-25"), expected);
  });

  it("falls back to today's local date when HomeHeader date key is malformed", () => {
    const today = new Date();
    const expected = today.toLocaleDateString("zh-TW", {
      month: "long",
      day: "numeric",
      weekday: "short",
    });

    assert.equal(formatHomeHeaderDate("not-a-date"), expected);
  });
});
