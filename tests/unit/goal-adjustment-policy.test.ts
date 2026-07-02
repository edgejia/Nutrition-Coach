import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { DailyTargets } from "../../server/services/device.js";
import {
  hasReasonableGoalMacroCalories,
  isExplicitGoalApplyIntent,
  isGoalConfirmationQuestion,
  isGoalExplanationQuestion,
  isGoalMacroCaloriesOverAllocated,
  isRelativeLowerGoalAdjustmentIntent,
  validateRelativeLowerGoalProposal,
} from "../../server/orchestrator/goal-adjustment-policy.js";
import { NUTRITION_SAFETY_CALORIE_FLOOR } from "../../server/orchestrator/nutrition-safety-policy.js";

const ACTIVE_TARGETS: DailyTargets = {
  calories: 1500,
  protein: 150,
  carbs: 140,
  fat: 45,
};

const VALID_LOWER_TARGETS: DailyTargets = {
  calories: 1350,
  protein: 130,
  carbs: 120,
  fat: 40,
};

function validate(proposedTargets: DailyTargets, activeProposalTargets: DailyTargets = ACTIVE_TARGETS) {
  return validateRelativeLowerGoalProposal({
    userMessage: "再低一點",
    previousAssistantMessage: "我先提案每日目標 1500 kcal。",
    activeProposalTargets,
    proposedTargets,
  });
}

describe("goal-adjustment policy", () => {
  it("detects relative-lower goal intent from active proposal context even when assistant copy changes", () => {
    assert.equal(
      isRelativeLowerGoalAdjustmentIntent({
        userMessage: "還是太高，再低一點",
        previousAssistantMessage: "這組建議比較保守。",
        activeProposalTargets: ACTIVE_TARGETS,
      }),
      true,
    );
  });

  it("ignores macro-only lower text", () => {
    assert.equal(
      isRelativeLowerGoalAdjustmentIntent({
        userMessage: "蛋白質再低一點",
        previousAssistantMessage: "我先提案每日目標 1500 kcal。",
        activeProposalTargets: ACTIVE_TARGETS,
      }),
      false,
    );
  });

  it("returns active_at_floor when the visible proposal is already at the product floor", () => {
    const result = validateRelativeLowerGoalProposal({
      userMessage: "再低一點",
      previousAssistantMessage: "我先提案每日目標 1200 kcal。",
      activeProposalTargets: {
        calories: NUTRITION_SAFETY_CALORIE_FLOOR,
        protein: 130,
        carbs: 105,
        fat: 35,
      },
      proposedTargets: VALID_LOWER_TARGETS,
    });

    assert.deepEqual(result, { ok: false, reason: "active_at_floor" });
  });

  it("rejects below-floor proposed targets", () => {
    assert.deepEqual(
      validate({
        calories: 1000,
        protein: 110,
        carbs: 95,
        fat: 35,
      }),
      { ok: false, reason: "below_floor" },
    );
  });

  it("rejects higher or equal rebound targets when a legal lower target exists", () => {
    assert.deepEqual(
      validate({
        calories: 2700,
        protein: 150,
        carbs: 390,
        fat: 75,
      }),
      { ok: false, reason: "rebound_or_not_lower" },
    );
    assert.deepEqual(validate(ACTIVE_TARGETS), { ok: false, reason: "rebound_or_not_lower" });
  });

  it("rejects macro/calorie diff over 10%", () => {
    const proposedTargets = {
      calories: 1300,
      protein: 150,
      carbs: 200,
      fat: 80,
    };

    assert.equal(hasReasonableGoalMacroCalories(proposedTargets), false);
    assert.deepEqual(validate(proposedTargets), { ok: false, reason: "macro_calorie_inconsistent" });
  });

  it("accepts a valid lower target", () => {
    assert.equal(hasReasonableGoalMacroCalories(VALID_LOWER_TARGETS), true);
    assert.deepEqual(validate(VALID_LOWER_TARGETS), { ok: true, reason: "ok" });
  });

  it("does not direction-validate non-relative goal proposals", () => {
    const result = validateRelativeLowerGoalProposal({
      userMessage: "請幫我建議一組目標",
      previousAssistantMessage: "你可以調整每日目標。",
      activeProposalTargets: ACTIVE_TARGETS,
      proposedTargets: {
        calories: 1800,
        protein: 140,
        carbs: 180,
        fat: 55,
      },
    });

    assert.deepEqual(result, { ok: true, reason: "not_relative_lower" });
  });
});

describe("goal-turn question intent (UAT-21 truth 2)", () => {
  it("classifies explanation questions about the visible goal target", () => {
    assert.equal(isGoalExplanationQuestion("為什麼是這個數值"), true);
    assert.equal(isGoalExplanationQuestion("為何是2050"), true);
    assert.equal(isGoalExplanationQuestion("這個數字怎麼來的"), true);
    assert.equal(isGoalExplanationQuestion("這組目標的依據是什麼？"), true);
  });

  it("does not classify consent, apply, or adjustment turns as explanation questions", () => {
    assert.equal(isGoalExplanationQuestion("好吧那就這樣"), false);
    assert.equal(isGoalExplanationQuestion("套用1200"), false);
    assert.equal(isGoalExplanationQuestion("再低一點"), false);
    assert.equal(isGoalExplanationQuestion("好"), false);
  });

  it("classifies target-acceptability confirmation questions", () => {
    assert.equal(isGoalConfirmationQuestion("1200可以嗎"), true);
    assert.equal(isGoalConfirmationQuestion("這樣可以嗎"), true);
    assert.equal(isGoalConfirmationQuestion("再低一點1200可以嗎"), true);
    assert.equal(isGoalConfirmationQuestion("1200行嗎"), true);
    assert.equal(isGoalConfirmationQuestion("改成1200？"), true);
  });

  it("does not classify consent, apply, or cancel turns as confirmation questions", () => {
    assert.equal(isGoalConfirmationQuestion("好吧那就這樣"), false);
    assert.equal(isGoalConfirmationQuestion("就用1200吧"), false);
    assert.equal(isGoalConfirmationQuestion("套用1200"), false);
    assert.equal(isGoalConfirmationQuestion("取消"), false);
    assert.equal(isGoalConfirmationQuestion("好"), false);
  });

  it("classifies explicit apply intent and keeps questions out of it", () => {
    assert.equal(isExplicitGoalApplyIntent("套用1200"), true);
    assert.equal(isExplicitGoalApplyIntent("請把每日目標改成1200"), true);
    assert.equal(isExplicitGoalApplyIntent("1200可以嗎"), false);
    assert.equal(isExplicitGoalApplyIntent("為什麼是這個數值"), false);
  });
});

describe("goal target integrity helpers (UAT-21 truth 3)", () => {
  it("detects merged targets whose macro calories over-allocate the calorie target", () => {
    assert.equal(
      isGoalMacroCaloriesOverAllocated({ calories: 1200, protein: 140, carbs: 226, fat: 58 }),
      true,
    );
    assert.equal(
      isGoalMacroCaloriesOverAllocated({ calories: 1500, protein: 200, carbs: 150, fat: 50 }),
      true,
    );
  });

  it("allows consistent and under-allocated merged targets", () => {
    assert.equal(
      isGoalMacroCaloriesOverAllocated({ calories: 2050, protein: 140, carbs: 226, fat: 58 }),
      false,
    );
    assert.equal(
      isGoalMacroCaloriesOverAllocated({ calories: 1800, protein: 130, carbs: 150, fat: 50 }),
      false,
    );
  });
});
