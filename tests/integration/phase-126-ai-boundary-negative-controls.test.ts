import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  checkSourceFields,
  extractNumericSourceEvidence,
} from "../../server/orchestrator/source-text-guard.js";
import {
  hasUnsafeNutritionGuidance,
  resolveBufferedNutritionReply,
} from "../../server/orchestrator/nutrition-safety-policy.js";
import {
  bufferPlanningAdvice,
  type PlanningFacts,
} from "../../server/orchestrator/planning-reply-renderer.js";

const SAFE_FALLBACK = "安全替代回覆";

const planningFacts: PlanningFacts = {
  date: "2026-07-18",
  consumed: { calories: 500, protein: 30, carbs: 60, fat: 15 },
  target: { calories: 1500, protein: 120, carbs: 180, fat: 50 },
  remaining: { calories: 1000, protein: 90, carbs: 120, fat: 35 },
  macroGap: { protein: 90, carbs: 120, fat: 35 },
  mealCount: 1,
  hasLoggedMeals: true,
  isOverBudget: false,
};

function releaseBufferedFrames(frames: readonly string[], userMessage = "你好") {
  return resolveBufferedNutritionReply({
    userMessage,
    reply: frames.join(""),
    fallbackText: SAFE_FALLBACK,
  });
}

describe("Phase 126 AI-boundary negative controls", () => {
  it("rejects cross-field swaps while accepting field-scoped current-turn evidence", () => {
    const evidence = extractNumericSourceEvidence("蛋白質 100g，碳水 200g");
    assert.equal(evidence.length, 2);
    assert.equal(evidence[0]?.field, "protein");
    assert.equal(evidence[1]?.field, "carbs");
    assert.equal(
      checkSourceFields(
        { protein: 200, carbs: 100 },
        ["protein", "carbs"],
        { currentUserMessage: "蛋白質 100g，碳水 200g" },
      ).ok,
      false,
    );
    assert.equal(
      checkSourceFields(
        { protein: 100, carbs: 200 },
        ["protein", "carbs"],
        { currentUserMessage: "蛋白質 100g，碳水 200g" },
      ).ok,
      true,
    );
  });

  it("rejects incompatible units and negated mutation intent without an authorized field", () => {
    assert.equal(
      checkSourceFields(
        { protein: 100 },
        ["protein"],
        { currentUserMessage: "蛋白質 100 kcal" },
      ).ok,
      false,
    );
    assert.equal(
      checkSourceFields(
        { calories: 1800 },
        ["calories"],
        { currentUserMessage: "不要把每日目標改成 1800 kcal" },
      ).ok,
      false,
    );
  });

  it("keeps prior confirmation scoped and requires an affirmative current turn", () => {
    const previousAssistant = "建議蛋白質改成 100g，要套用嗎？";
    assert.equal(
      checkSourceFields(
        { protein: 100 },
        ["protein"],
        { currentUserMessage: "好", previousAssistantMessage: previousAssistant },
      ).ok,
      true,
    );
    assert.equal(
      checkSourceFields(
        { protein: 100 },
        ["protein"],
        { currentUserMessage: "不用", previousAssistantMessage: previousAssistant },
      ).ok,
      false,
    );
  });

  it("buffers JSON-like output and rejects a late unsafe frame before release", () => {
    const result = releaseBufferedFrames(["可以先這樣做。", "每天只吃 ８００ kcal。"]);
    assert.equal(result.usedFallback, true);
    assert.equal(result.reply, SAFE_FALLBACK);
    assert.equal(hasUnsafeNutritionGuidance(result.reply), false);
  });

  it("buffers SSE-like chunks and keeps factual totals plus the exact floor valid", () => {
    const factual = releaseBufferedFrames([
      "今天已記錄早餐 100 kcal、午餐 200 kcal、晚餐 200 kcal。",
    ]);
    const floor = releaseBufferedFrames(["每日目標 １２００ kcal，可以維持。"]);
    assert.equal(factual.usedFallback, false);
    assert.equal(factual.reply.includes("100 kcal"), true);
    assert.equal(floor.usedFallback, false);
    assert.equal(floor.reply.includes("1200 kcal"), true);
  });

  it("routes planning advice through the same buffered decision", () => {
    const unsafePlan = bufferPlanningAdvice("晚餐每天只吃 800 kcal。", planningFacts);
    const safePlan = bufferPlanningAdvice("晚餐抓 800-1000 kcal，補足蛋白質。", planningFacts);
    assert.equal(unsafePlan.usedFallback, true);
    assert.equal(hasUnsafeNutritionGuidance(unsafePlan.reply), false);
    assert.equal(safePlan.usedFallback, false);
    assert.equal(safePlan.reply.includes("900-1000 kcal") || safePlan.reply.includes("800-1000 kcal"), true);
  });
});
