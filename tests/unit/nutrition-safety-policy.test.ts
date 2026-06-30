process.env.TZ = "Asia/Taipei";

const policy = await import("../../server/orchestrator/nutrition-safety-policy.js");

const {
  NUTRITION_SAFETY_CALORIE_FLOOR,
  UNSAFE_CALORIE_FLOOR_REASON,
  checkNutritionSafetyTargets,
  isUnsafeCalorieFloorReason,
} = policy;

import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("nutrition safety calorie-floor policy", () => {
  it("exports the locked non-clinical calorie floor and reason", () => {
    assert.equal(NUTRITION_SAFETY_CALORIE_FLOOR, 1200);
    assert.equal(UNSAFE_CALORIE_FLOOR_REASON, "unsafe_calorie_floor");
    assert.equal(isUnsafeCalorieFloorReason("unsafe_calorie_floor"), true);
    assert.equal(isUnsafeCalorieFloorReason("goal_authority_failure"), false);
  });

  it("rejects target patches below the calorie floor", () => {
    assert.deepEqual(checkNutritionSafetyTargets({ calories: 500 }), {
      ok: false,
      reason: "unsafe_calorie_floor",
      floor: 1200,
      fields: ["calories"],
    });
    assert.deepEqual(checkNutritionSafetyTargets({ calories: 1199 }), {
      ok: false,
      reason: "unsafe_calorie_floor",
      floor: 1200,
      fields: ["calories"],
    });
  });

  it("allows target patches at or above the calorie floor", () => {
    assert.deepEqual(checkNutritionSafetyTargets({ calories: 1200 }), { ok: true });
    assert.deepEqual(checkNutritionSafetyTargets({ calories: 1500 }), { ok: true });
  });

  it("allows non-calorie target patches", () => {
    assert.deepEqual(checkNutritionSafetyTargets({ protein: 120 }), { ok: true });
    assert.deepEqual(checkNutritionSafetyTargets({ carbs: 180, fat: 55 }), { ok: true });
  });
});
