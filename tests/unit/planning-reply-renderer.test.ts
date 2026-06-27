import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { DailyTargets } from "../../server/services/device.js";
import type { DailySummary } from "../../server/services/summary.js";
import {
  MAX_COACH_REPLY_BULLETS,
  composePlanningReply,
  derivePlanningFacts,
  guardPlanningAdvice,
  normalizeCoachAdvice,
  renderPlanningFacts,
  renderPlanningFallbackReply,
} from "../../server/orchestrator/planning-reply-renderer.js";

const dailyTargets: DailyTargets = {
  calories: 2000,
  protein: 150,
  carbs: 220,
  fat: 60,
};

const loggedSummary: DailySummary = {
  totalCalories: 1000,
  totalProtein: 72,
  totalCarbs: 135,
  totalFat: 28,
  mealCount: 2,
  date: "2026-05-17",
};

const emptySummary: DailySummary = {
  totalCalories: 0,
  totalProtein: 0,
  totalCarbs: 0,
  totalFat: 0,
  mealCount: 0,
  date: "2026-05-17",
};

const overBudgetSummary: DailySummary = {
  totalCalories: 2250,
  totalProtein: 120,
  totalCarbs: 260,
  totalFat: 78,
  mealCount: 4,
  date: "2026-05-17",
};

describe("planning reply renderer contract", () => {
  it("derives backend-owned consumed, target, remaining, and macro-gap facts", () => {
    const facts = derivePlanningFacts(loggedSummary, dailyTargets);

    assert.deepEqual(facts.consumed, {
      calories: 1000,
      protein: 72,
      carbs: 135,
      fat: 28,
    });
    assert.deepEqual(facts.target, dailyTargets);
    assert.deepEqual(facts.remaining, {
      calories: 1000,
      protein: 78,
      carbs: 85,
      fat: 32,
    });
    assert.deepEqual(facts.macroGap, {
      protein: 78,
      carbs: 85,
      fat: 32,
    });
    assert.equal(facts.mealCount, 2);
    assert.equal(facts.hasLoggedMeals, true);
    assert.equal(facts.isOverBudget, false);
    assert.equal(facts.date, "2026-05-17");
  });

  it("treats no-meal and over-budget states deterministically", () => {
    const noMealFacts = derivePlanningFacts(emptySummary, dailyTargets);
    assert.equal(noMealFacts.hasLoggedMeals, false);
    assert.equal(noMealFacts.remaining.calories, dailyTargets.calories);
    assert.deepEqual(noMealFacts.macroGap, {
      protein: dailyTargets.protein,
      carbs: dailyTargets.carbs,
      fat: dailyTargets.fat,
    });

    const overBudgetFacts = derivePlanningFacts(overBudgetSummary, dailyTargets);
    assert.equal(overBudgetFacts.hasLoggedMeals, true);
    assert.equal(overBudgetFacts.remaining.calories, 0);
    assert.equal(overBudgetFacts.isOverBudget, true);
    assert.equal(overBudgetFacts.macroGap.fat, 0);
  });

  it("renders deterministic planning facts without mutation-success phrases", () => {
    const factsText = renderPlanningFacts(
      derivePlanningFacts(loggedSummary, dailyTargets),
    );

    assert.match(factsText, /今日攝取/);
    assert.match(factsText, /目標/);
    assert.match(factsText, /還剩/);
    assert.match(factsText, /營養缺口/);
    assert.doesNotMatch(
      factsText,
      /已記錄|完成記錄|已更新|完成更新|已刪除|完成刪除|已更新每日目標/,
    );
  });

  it("clamps overflowing advice ranges without treating format cleanup as fallback", () => {
    const facts = derivePlanningFacts(loggedSummary, dailyTargets);
    const result = guardPlanningAdvice(
      "下一餐可以抓 900-1100 kcal，蛋白質 35-45 g。",
      facts,
    );

    assert.equal(result.status, "clamped");
    assert.match(result.advice, /900-1000 kcal/);
    assert.doesNotMatch(result.advice, /900-1100 kcal/);
  });

  it("clamps ranges that are entirely above the remaining planning budget", () => {
    const facts = derivePlanningFacts(overBudgetSummary, dailyTargets);
    const result = guardPlanningAdvice(
      "下一餐可以抓 100-200 kcal，蛋白質 35-45 g，脂肪 5-10 g。",
      facts,
    );

    assert.equal(result.status, "clamped");
    assert.match(result.advice, /0 kcal/);
    assert.match(result.advice, /蛋白質 30 g/);
    assert.match(result.advice, /脂肪 0 g/);
    assert.doesNotMatch(result.advice, /100-200 kcal/);
    assert.doesNotMatch(result.advice, /35-45 g/);
    assert.doesNotMatch(result.advice, /5-10 g/);
  });

  it("classifies contradicted current-state facts for repair and supports deterministic fallback", () => {
    const facts = derivePlanningFacts(loggedSummary, dailyTargets);
    const contradictions = [
      "你今天已經吃了 1200 kcal，下一餐吃清淡一點。",
      "你今天還剩 800 kcal 可以安排下一餐。",
      "你今天目標是 1800 kcal。",
      "你的蛋白質缺口剩 40 g。",
    ];

    for (const advice of contradictions) {
      const result = guardPlanningAdvice(advice, facts);
      assert.equal(result.status, "needs_repair");
      assert.equal(result.advice, "");
    }

    const repeated = guardPlanningAdvice(contradictions[0], facts, {
      repairAttempted: true,
    });
    assert.equal(repeated.status, "fallback");
    assert.equal(repeated.advice, "");

    const fallback = renderPlanningFallbackReply(facts);
    assert.match(fallback, /今日攝取/);
    assert.match(fallback, /先依照後端計算的剩餘量調整/);
  });

  it("composes backend planning facts before accepted or clamped model advice", () => {
    const facts = derivePlanningFacts(loggedSummary, dailyTargets);
    const reply = composePlanningReply(
      facts,
      "下一餐可以抓 900-1100 kcal，搭配豆腐、青菜和半碗飯。",
    );

    assert.match(reply, /^今日攝取/);
    assert.match(reply, /900-1000 kcal/);
    assert.ok(
      reply.indexOf("今日攝取") < reply.indexOf("900-1000 kcal"),
      "deterministic facts must render before model advice",
    );
  });

  it("normalizes planning and general compact advice for mobile-readable structure", () => {
    const rawAdvice = [
      "| plan_next_meal | remainingCalories | macroGap |",
      "|---|---|---|",
      "| planningFacts | 1000 | protein |",
      "- 結論：下一餐要以高蛋白、適量澱粉為主。",
      "- 原因：今天還有足夠熱量，但蛋白質仍有缺口。",
      "- 選項 A：雞胸飯加青菜。",
      "- 選項 B：豆腐蛋花湯加地瓜。",
      "- 選項 C：鮭魚沙拉加半碗飯。",
      "- 選項 D：希臘優格加水果。",
      "- 下一步：選一個你最方便買到的組合。",
    ].join("\n");

    for (const mode of ["coach_planning", "coach_compact"] as const) {
      const normalized = normalizeCoachAdvice(rawAdvice, { mode });
      const bullets = normalized
        .split("\n")
        .filter((line) => line.trim().startsWith("- "));

      assert.ok(bullets.length <= MAX_COACH_REPLY_BULLETS);
      assert.doesNotMatch(normalized, /\|---\|/);
      assert.doesNotMatch(
        normalized,
        /plan_next_meal|planningFacts|remainingCalories|macroGap/,
      );
      assert.match(normalized, /結論/);
      assert.match(normalized, /原因/);
      assert.match(normalized, /選項/);
      assert.equal((normalized.match(/下一步/g) ?? []).length, 1);

      const guarded = guardPlanningAdvice(normalized, derivePlanningFacts(loggedSummary, dailyTargets));
      assert.notEqual(guarded.status, "fallback");
    }
  });
});
