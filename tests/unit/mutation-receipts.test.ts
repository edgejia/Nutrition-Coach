import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { DailyTargets } from "../../server/services/device.js";
import type { DailySummary } from "../../server/services/summary.js";
import type { MutationEffects } from "../../server/orchestrator/mutation-effects.js";

const committedSummary: DailySummary = {
  totalCalories: 520,
  totalProtein: 31,
  totalCarbs: 48,
  totalFat: 18,
  mealCount: 1,
  date: "2026-05-10",
};

const committedTargets: DailyTargets = {
  calories: 1800,
  protein: 130,
  carbs: 150,
  fat: 50,
};

describe("MutationEffects contract", () => {
  it("keeps mutation families as a discriminated committed-facts union", () => {
    const effects = [
      {
        kind: "log",
        affectedDate: "2026-05-10",
        committedSummary,
        committedTargets,
        meal: {
          mealId: "meal-log",
          mealRevisionId: "rev-log",
          dateKey: "2026-05-10",
          loggedAt: "2026-05-10T04:30:00.000Z",
          foodName: "雞胸便當",
          calories: 520,
          protein: 31,
          carbs: 48,
          fat: 18,
          itemCount: 1,
        },
      },
      {
        kind: "update",
        affectedDate: "2026-05-10",
        committedSummary,
        committedTargets,
        meal: {
          mealId: "meal-update",
          mealRevisionId: "rev-update",
          dateKey: "2026-05-10",
          loggedAt: "2026-05-10T05:15:00.000Z",
          foodName: "鮭魚飯",
          calories: 610,
          protein: 36,
          carbs: 54,
          fat: 22,
          itemCount: 2,
        },
      },
      {
        kind: "delete",
        affectedDate: "2026-05-10",
        committedSummary,
        committedTargets,
        deletedMeal: {
          mealId: "meal-delete",
          dateKey: "2026-05-10",
          loggedAt: "2026-05-10T06:45:00.000Z",
          foodName: "拿鐵",
          calories: 180,
          protein: 9,
        },
      },
      {
        kind: "goals",
        affectedDate: "2026-05-10",
        committedSummary,
        committedTargets,
        targets: committedTargets,
        updatedFields: ["calories", "protein"],
      },
    ] satisfies MutationEffects[];

    assert.deepEqual(effects.map((effect) => effect.kind), ["log", "update", "delete", "goals"]);
    assert.ok("meal" in effects[0]);
    assert.ok("meal" in effects[1]);
    assert.ok("deletedMeal" in effects[2]);
    assert.ok("targets" in effects[3]);
  });

  it("keeps trace ownership and forbidden renderer terms out of the effect payload", () => {
    const source = readFileSync("server/orchestrator/mutation-effects.ts", "utf8");
    assert.doesNotMatch(source, /finalReplySource|source|renderer|model|fallback|tool_receipt|mixed/);
  });
});
