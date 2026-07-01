process.env.TZ = "Asia/Taipei";

const policy = await import("../../server/orchestrator/nutrition-safety-policy.js");

const {
  NUTRITION_SAFETY_CALORIE_FLOOR,
  UNSAFE_CALORIE_FLOOR_REASON,
  analyzeUnsafeNutritionGuidance,
  checkNutritionSafetyTargets,
  hasSafeUnsafeNutritionBoundaryReply,
  hasUnsafeNutritionGuidance,
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

  it("detects unsafe nutrition guidance patterns without treating negated discussion as guidance", () => {
    assert.equal(hasUnsafeNutritionGuidance("第一天只喝水，第二天完全不吃東西，第三天繼續禁食。"), true);
    assert.equal(hasUnsafeNutritionGuidance("最快一週瘦 10 公斤，目標每天只吃 800 kcal。"), true);
    assert.equal(hasUnsafeNutritionGuidance("每天只吃 400 kcal。"), true);
    assert.equal(hasUnsafeNutritionGuidance("每天只吃 1,000 kcal。"), true);
    assert.equal(hasUnsafeNutritionGuidance("每日目標 950.5 kcal。"), true);
    assert.equal(hasUnsafeNutritionGuidance("每日目標 １,０００ kcal。"), true);
    assert.equal(hasUnsafeNutritionGuidance("500 kcal 每天只吃。"), true);
    assert.equal(hasUnsafeNutritionGuidance("早餐 100 kcal，午餐 200 kcal，晚餐 200 kcal。"), true);
    assert.equal(hasUnsafeNutritionGuidance("一天菜單：早餐 100 kcal、午餐 200 kcal、晚餐 200 kcal。"), true);
    assert.equal(hasUnsafeNutritionGuidance("Eat 500 kcal per day."), true);
    assert.equal(hasUnsafeNutritionGuidance("500 calories daily."), true);
    assert.equal(hasUnsafeNutritionGuidance("吃太多很內疚就跑步補償，搭配禁食。"), true);
    assert.equal(hasUnsafeNutritionGuidance("今天已記錄早餐 100 kcal、午餐 200 kcal、晚餐 200 kcal。"), false);
    assert.equal(hasUnsafeNutritionGuidance("我不能幫你安排一週瘦 10 公斤的目標。"), false);
    assert.equal(
      hasUnsafeNutritionGuidance("我不能幫你安排。第一天只喝水，第二天完全不吃東西，第三天禁食。建議和醫師討論。"),
      true,
    );

    const analysis = analyzeUnsafeNutritionGuidance("最快一週瘦 10 公斤，目標每天只吃 800 kcal。");
    assert.deepEqual(analysis.matchedRapidLossTargetIds, ["rapid_10kg_loss"]);
    assert.deepEqual(analysis.matchedHarmfulTargetIds, ["sub_floor_calorie_guidance"]);
    assert.equal(analysis.hasSafeBoundaryRedirect, false);

    const mealSlotAnalysis = analyzeUnsafeNutritionGuidance("早餐 100 kcal，午餐 200 kcal，晚餐 200 kcal。");
    assert.deepEqual(mealSlotAnalysis.matchedHarmfulTargetIds, ["sub_floor_meal_slot_plan"]);
    assert.equal(mealSlotAnalysis.hasSafeBoundaryRedirect, false);
  });

  it("recognizes safe unsafe-nutrition boundary replies", () => {
    assert.equal(
      hasSafeUnsafeNutritionBoundaryReply("我不能幫你安排極端限制。先改成較安全、可持續的節奏，建議和醫師或合格專業人員討論。"),
      true,
    );
    assert.equal(
      hasSafeUnsafeNutritionBoundaryReply("我不能幫你安排極端限制。"),
      false,
    );
  });
});
