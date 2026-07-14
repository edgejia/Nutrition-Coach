import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { refreshAfterMealMutation } from "../../client/src/meal-edit-refresh.js";

type Call =
  | { name: "redact"; mealId: string }
  | { name: "record"; affectedDate: string }
  | { name: "setDailySummary"; date: string }
  | { name: "getMeals"; refreshReason: string }
  | { name: "applyMealMutationRefresh"; meals: string[] };

function createDeps(todayKey = "2026-05-17") {
  const calls: Call[] = [];
  const meals = ["fresh-breakfast", "fresh-lunch"];

  return {
    calls,
    deps: {
      redactChatReceiptIdentity: (mealId: string) => {
        calls.push({ name: "redact", mealId });
      },
      recordMealMutation: (affectedDate: string) => {
        calls.push({ name: "record", affectedDate });
      },
      setDailySummary: (dailySummary: { date: string }) => {
        calls.push({ name: "setDailySummary", date: dailySummary.date });
      },
      getMeals: async ({ refreshReason }: { refreshReason: "meal_mutation" }) => {
        calls.push({ name: "getMeals", refreshReason });
        return { meals };
      },
      applyMealMutationRefresh: (nextMeals: string[]) => {
        calls.push({ name: "applyMealMutationRefresh", meals: nextMeals });
      },
      todayKey: () => todayKey,
    },
  };
}

function dailySummary(date: string) {
  return {
    date,
    totalCalories: 100,
    totalProtein: 20,
    totalCarbs: 10,
    totalFat: 5,
    mealCount: 1,
  };
}

describe("refreshAfterMealMutation", () => {
  it("refreshes today's meal rows after a same-day edit response without dailySummary", async () => {
    const { calls, deps } = createDeps();

    await refreshAfterMealMutation(deps, {
      mealId: "meal-edit-1",
      affectedDate: "2026-05-17",
    });

    assert.deepEqual(calls, [
      { name: "redact", mealId: "meal-edit-1" },
      { name: "record", affectedDate: "2026-05-17" },
      { name: "getMeals", refreshReason: "meal_mutation" },
      { name: "applyMealMutationRefresh", meals: ["fresh-breakfast", "fresh-lunch"] },
    ]);
  });

  it("refreshes today's meal rows after a same-day delete response without dailySummary", async () => {
    const { calls, deps } = createDeps();

    await refreshAfterMealMutation(deps, {
      mealId: "meal-delete-1",
      affectedDate: "2026-05-17",
    });

    assert.deepEqual(calls, [
      { name: "redact", mealId: "meal-delete-1" },
      { name: "record", affectedDate: "2026-05-17" },
      { name: "getMeals", refreshReason: "meal_mutation" },
      { name: "applyMealMutationRefresh", meals: ["fresh-breakfast", "fresh-lunch"] },
    ]);
  });

  it("sets a usable same-day dailySummary and still refreshes today's meal rows", async () => {
    const { calls, deps } = createDeps();

    await refreshAfterMealMutation(deps, {
      mealId: "meal-edit-2",
      affectedDate: "2026-05-17",
      dailySummary: dailySummary("2026-05-17"),
    });

    assert.deepEqual(calls, [
      { name: "redact", mealId: "meal-edit-2" },
      { name: "record", affectedDate: "2026-05-17" },
      { name: "setDailySummary", date: "2026-05-17" },
      { name: "getMeals", refreshReason: "meal_mutation" },
      { name: "applyMealMutationRefresh", meals: ["fresh-breakfast", "fresh-lunch"] },
    ]);
  });

  it("does not set stale summaries or fetch rows for historical affected dates", async () => {
    const { calls, deps } = createDeps();

    await refreshAfterMealMutation(deps, {
      mealId: "meal-history-1",
      affectedDate: "2026-05-16",
      dailySummary: dailySummary("2026-05-16"),
    });

    assert.deepEqual(calls, [
      { name: "redact", mealId: "meal-history-1" },
      { name: "record", affectedDate: "2026-05-16" },
    ]);
  });
});
