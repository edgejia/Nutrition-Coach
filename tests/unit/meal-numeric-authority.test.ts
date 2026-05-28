import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  authorizeMealNumericUpdate,
  classifyMealNumericAdjustment,
  extractMealNumericEvidence,
} from "../../server/orchestrator/meal-numeric-authority.js";

const currentMeal = {
  calories: 650,
  protein: 32,
  carbs: 84,
  fat: 22,
  items: [
    { foodName: "雞腿", calories: 260, protein: 24, carbs: 0, fat: 12 },
    { foodName: "白飯", calories: 280, protein: 4, carbs: 62, fat: 0.5 },
    { foodName: "滷蛋", calories: 90, protein: 7, carbs: 2, fat: 6 },
    { foodName: "青菜", calories: 20, protein: 1, carbs: 20, fat: 3.5 },
  ],
};

describe("extractMealNumericEvidence", () => {
  it("extracts final target evidence from Arabic integers, decimals, Chinese numerals, bare Chinese digits, and unit variants", () => {
    const evidence = extractMealNumericEvidence("熱量改成 500 kcal，蛋白質改成 28g，碳水二十五克，脂肪五");

    assert.deepEqual(evidence.calories, [500]);
    assert.deepEqual(evidence.protein, [28]);
    assert.deepEqual(evidence.carbs, [25]);
    assert.deepEqual(evidence.fat, [5]);

    const decimalEvidence = extractMealNumericEvidence("脂肪改成 9.5g，熱量 500 卡");
    assert.deepEqual(decimalEvidence.fat, [9.5]);
    assert.deepEqual(decimalEvidence.calories, [500]);
  });

  it("does not treat prior assistant numbers as current-turn meal numeric authority", () => {
    const result = authorizeMealNumericUpdate({
      currentUserMessage: "好",
      previousAssistantMessage: "我建議蛋白質改成 28g，要套用嗎?",
      currentMeal,
      update: { patch: { protein: 28 } },
    });

    assert.equal(result.ok, false);
    assert.equal(result.reason, "unauthorized_numeric_values");
    assert.deepEqual(result.unauthorizedFields, ["protein"]);
  });
});

describe("classifyMealNumericAdjustment", () => {
  it("classifies vague and direction-only correction text as clarification needed", () => {
    assert.deepEqual(classifyMealNumericAdjustment("蛋白質怪怪的，幫我改合理一點"), {
      kind: "clarification_needed",
      reason: "vague",
    });
    assert.deepEqual(classifyMealNumericAdjustment("蛋白質偏高"), {
      kind: "clarification_needed",
      reason: "direction_only",
    });
  });

  it("classifies locked relative operators as proposal candidates, not direct authorization", () => {
    assert.deepEqual(classifyMealNumericAdjustment("蛋白質減半"), {
      kind: "proposal_candidate",
      operator: "half",
    });
    assert.deepEqual(classifyMealNumericAdjustment("熱量少 20%"), {
      kind: "proposal_candidate",
      operator: "subtract_percent",
      value: 20,
    });
    assert.deepEqual(classifyMealNumericAdjustment("蛋白質加 10g"), {
      kind: "proposal_candidate",
      operator: "add_amount",
      value: 10,
    });
    assert.deepEqual(classifyMealNumericAdjustment("脂肪少 10g"), {
      kind: "proposal_candidate",
      operator: "subtract_amount",
      value: 10,
    });
  });
});

describe("authorizeMealNumericUpdate", () => {
  it("authorizes only current-turn explicit matching top-level patch fields", () => {
    const allowed = authorizeMealNumericUpdate({
      currentUserMessage: "蛋白質改成 28g",
      previousAssistantMessage: "我建議蛋白質改成 30g",
      currentMeal,
      update: { patch: { protein: 28 } },
    });
    assert.deepEqual(allowed, { ok: true, authorizedFields: ["protein"] });

    const blocked = authorizeMealNumericUpdate({
      currentUserMessage: "蛋白質改成 28g",
      currentMeal,
      update: { patch: { protein: 28, calories: 500 } },
    });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.reason, "unauthorized_numeric_values");
    assert.deepEqual(blocked.unauthorizedFields, ["calories"]);
  });

  it("rejects vague, direction-only, and relative text as direct write authority", () => {
    for (const currentUserMessage of ["合理一點", "蛋白質怪怪的", "偏高", "蛋白質減半", "少 20%"]) {
      const result = authorizeMealNumericUpdate({
        currentUserMessage,
        currentMeal,
        update: { patch: { protein: 28 } },
      });

      assert.equal(result.ok, false, currentUserMessage);
      assert.notEqual(result.reason, "authorized", currentUserMessage);
    }
  });

  it("requires current-turn evidence for each changed items[] numeric replacement value", () => {
    const authorized = authorizeMealNumericUpdate({
      currentUserMessage: "雞腿蛋白質 28g，白飯碳水 60g",
      currentMeal,
      update: {
        items: [
          { foodName: "雞腿", calories: 260, protein: 28, carbs: 0, fat: 12 },
          { foodName: "白飯", calories: 280, protein: 4, carbs: 60, fat: 0.5 },
          { foodName: "滷蛋", calories: 90, protein: 7, carbs: 2, fat: 6 },
          { foodName: "青菜", calories: 20, protein: 1, carbs: 20, fat: 3.5 },
        ],
      },
    });
    assert.deepEqual(authorized, { ok: true, authorizedFields: ["items[0].protein", "items[1].carbs"] });

    const blocked = authorizeMealNumericUpdate({
      currentUserMessage: "雞腿蛋白質 28g",
      currentMeal,
      update: {
        items: [
          { foodName: "雞腿", calories: 260, protein: 28, carbs: 0, fat: 12 },
          { foodName: "白飯", calories: 250, protein: 4, carbs: 62, fat: 0.5 },
          { foodName: "滷蛋", calories: 90, protein: 7, carbs: 2, fat: 6 },
          { foodName: "青菜", calories: 20, protein: 1, carbs: 20, fat: 3.5 },
        ],
      },
    });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.reason, "unauthorized_numeric_values");
    assert.deepEqual(blocked.unauthorizedFields, ["items[1].calories"]);
  });
});
