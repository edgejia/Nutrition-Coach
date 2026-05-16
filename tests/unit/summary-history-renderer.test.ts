import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { DailySummary } from "../../server/services/summary.js";
import {
  composeSummaryHistoryReply,
  guardSummaryHistoryAdvice,
  renderSummaryHistoryFacts,
  type SummaryHistoryFacts,
} from "../../server/orchestrator/summary-history-renderer.js";

const emptyDaySummary: DailySummary = {
  totalCalories: 0,
  totalProtein: 0,
  totalCarbs: 0,
  totalFat: 0,
  mealCount: 0,
  date: "2026-05-17",
};

const mismatchedSummary: DailySummary = {
  totalCalories: 1200,
  totalProtein: 80,
  totalCarbs: 160,
  totalFat: 30,
  mealCount: 1,
  date: "2026-05-17",
};

const twoMealFacts: SummaryHistoryFacts = {
  dailySummary: mismatchedSummary,
  meals: [
    { foodName: "豆腐飯", calories: 520 },
    { foodName: "鮭魚飯", calories: 380 },
  ],
};

describe("summary/history deterministic fact renderer", () => {
  it("renders the canonical current-day persisted meal facts exactly", () => {
    assert.equal(
      renderSummaryHistoryFacts(twoMealFacts),
      "今天已記錄 2 餐，共 900 kcal：豆腐飯 520 kcal、鮭魚飯 380 kcal。",
    );
  });

  it("preserves empty-day summary semantics without mutation-failure copy", () => {
    const text = renderSummaryHistoryFacts({
      dailySummary: emptyDaySummary,
      meals: [],
    });

    assert.match(text, /0 餐/);
    assert.match(text, /0 kcal/);
    assert.doesNotMatch(text, /我還沒有把這餐寫入紀錄/);
  });

  it("drops advice containing fake concrete meal names", () => {
    assert.equal(guardSummaryHistoryAdvice("今天分別是牛肉飯和滷肉飯，蛋白質可以再補。", twoMealFacts), "");
  });

  it("drops advice assigning the day total to a persisted meal", () => {
    assert.equal(guardSummaryHistoryAdvice("豆腐飯 900 kcal，晚點可以清淡一點。", twoMealFacts), "");
  });

  it("drops advice with meal count, day kcal, macro attribution, or concrete per-meal kcal", () => {
    const rejectedAdvice = [
      "今天已記錄 2 餐。",
      "今天總共 900 kcal。",
      "豆腐飯蛋白質 35 g。",
      "鮭魚飯 380 kcal。",
    ];

    for (const advice of rejectedAdvice) {
      assert.equal(guardSummaryHistoryAdvice(advice, twoMealFacts), "");
    }
  });

  it("appends generic advice after the deterministic fact segment", () => {
    assert.equal(
      composeSummaryHistoryReply(twoMealFacts, "晚點可以補充蔬菜和水分。"),
      "今天已記錄 2 餐，共 900 kcal：豆腐飯 520 kcal、鮭魚飯 380 kcal。\n\n晚點可以補充蔬菜和水分。",
    );
  });

  it("uses persisted meal row count when aggregate meal count disagrees", () => {
    const text = renderSummaryHistoryFacts(twoMealFacts);

    assert.match(text, /2 餐/);
    assert.doesNotMatch(text, /1 餐/);
  });

  it("uses persisted meal kcal sum when aggregate day total disagrees", () => {
    const text = renderSummaryHistoryFacts(twoMealFacts);

    assert.match(text, /900 kcal/);
    assert.doesNotMatch(text, /1200 kcal/);
  });
});
