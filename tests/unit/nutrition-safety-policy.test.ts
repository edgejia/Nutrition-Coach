process.env.TZ = "Asia/Taipei";

const policy = await import("../../server/orchestrator/nutrition-safety-policy.js");

const {
  NUTRITION_SAFETY_CALORIE_FLOOR,
  UNSAFE_CALORIE_FLOOR_REASON,
  analyzeUnsafeNutritionGuidance,
  canonicalizeNutritionSafetyText,
  checkNutritionSafetyTargets,
  decideNutritionSafetyBoundary,
  hasSafeUnsafeNutritionBoundaryReply,
  hasUnsafeNutritionGuidance,
  isUnsafeCalorieFloorReason,
  resolveBufferedNutritionReply,
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

describe("unsafe-reply scan delta, per-macro, and digit-boundary contexts (UAT-21 truth 2)", () => {
  it("does not flag adjustment-delta amounts near goal keywords as sub-floor guidance", () => {
    assert.equal(hasUnsafeNutritionGuidance("熱量目標一次調降 200 kcal，蛋白質維持不變。"), false);
    assert.equal(hasUnsafeNutritionGuidance("好，我先把每日目標調降 200 kcal，變成 2050 kcal。"), false);
    assert.equal(hasUnsafeNutritionGuidance("目標主要減少 150 kcal 的碳水熱量。"), false);
    assert.equal(
      hasUnsafeNutritionGuidance("這組是從上一組 2250 kcal 的每日目標往下調 200 kcal，主要調低碳水。"),
      false,
    );
  });

  it("does not flag per-macro kcal breakdown lines as sub-floor guidance", () => {
    assert.equal(
      hasUnsafeNutritionGuidance("這組每日目標：蛋白質140g（約560 kcal）、碳水226g、脂肪58g。"),
      false,
    );
    assert.equal(hasUnsafeNutritionGuidance("每日目標中脂肪58g約 522 kcal。"), false);
  });

  it("does not split a compliant calorie number to fabricate a sub-floor match", () => {
    assert.equal(hasUnsafeNutritionGuidance("這組每日目標 2050 kcal，蛋白質 140 g。"), false);
    assert.equal(hasUnsafeNutritionGuidance("2050 kcal 的每日目標可以維持。"), false);
  });

  it("still flags genuine sub-floor absolute daily-target guidance", () => {
    assert.equal(hasUnsafeNutritionGuidance("每天只吃 800 kcal。"), true);
    assert.equal(hasUnsafeNutritionGuidance("把每日目標設成 900 kcal。"), true);
    assert.equal(hasUnsafeNutritionGuidance("降到 1000 kcal 的每日目標。"), true);
    assert.equal(hasUnsafeNutritionGuidance("每日目標 950.5 kcal。"), true);
    assert.equal(hasUnsafeNutritionGuidance("早餐 100 kcal，午餐 200 kcal，晚餐 200 kcal。"), true);
  });

  it("still flags sub-floor macro totals marked as a combined sum", () => {
    assert.equal(hasUnsafeNutritionGuidance("目標碳水 100g，共約 900 kcal。"), true);
  });
});

describe("canonical buffered nutrition boundary", () => {
  it("normalizes fullwidth and Arabic-Indic numbers before the unsafe decision", () => {
    assert.equal(canonicalizeNutritionSafetyText("每天只吃 １，０００ kcal"), "每天只吃 1,000 kcal");
    assert.equal(hasUnsafeNutritionGuidance("每天只吃 ١٠٠٠ kcal"), true);
    assert.equal(hasUnsafeNutritionGuidance("每日目標 １２００ kcal"), false);
    assert.equal(decideNutritionSafetyBoundary("每天只吃 ١٠٠٠ kcal").safe, false);
  });

  it("preserves legitimate refusal and factual logged-intake totals", () => {
    assert.equal(hasUnsafeNutritionGuidance("我不建議每天只吃 800 kcal。"), false);
    assert.equal(
      hasUnsafeNutritionGuidance("今天已記錄早餐 100 kcal、午餐 200 kcal、晚餐 200 kcal。"),
      false,
    );
  });

  it("replaces a late unsafe frame before the buffered reply is released", () => {
    const buffered = resolveBufferedNutritionReply({
      userMessage: "你好",
      reply: ["可以先這樣做。", "每天只吃 800 kcal。"].join(""),
      fallbackText: "安全替代回覆",
    });
    assert.deepEqual(buffered, { reply: "安全替代回覆", usedFallback: true });
  });
});
