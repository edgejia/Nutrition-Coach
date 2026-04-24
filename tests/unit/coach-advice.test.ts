import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { COACH_CTA_INTENTS, getCoachAdvice, getCoachCTA } from "../../client/src/coach-advice.js";

describe("getCoachAdvice", () => {
  it("returns the empty state advice when no meals are logged", () => {
    const advice = getCoachAdvice(
      { date: "2026-04-01", totalCalories: 0, totalProtein: 0, totalCarbs: 0, totalFat: 0, mealCount: 0 },
      { calories: 1800, protein: 120, carbs: 200, fat: 60 }
    );

    assert.equal(advice, "還沒記錄任何餐點，開始記錄你的第一餐吧");
  });

  it("prioritizes protein deficit before low remaining calories", () => {
    const advice = getCoachAdvice(
      { date: "2026-04-01", totalCalories: 1710, totalProtein: 80, totalCarbs: 150, totalFat: 40, mealCount: 2 },
      { calories: 1800, protein: 120, carbs: 200, fat: 60 }
    );

    assert.equal(advice, "蛋白質還差 40g，晚餐建議高蛋白食物");
  });

  it("does not recommend extra protein when protein is already above target", () => {
    const advice = getCoachAdvice(
      { date: "2026-04-01", totalCalories: 1400, totalProtein: 140, totalCarbs: 150, totalFat: 40, mealCount: 3 },
      { calories: 1800, protein: 120, carbs: 200, fat: 60 }
    );

    assert.equal(advice, "今天攝取均衡，繼續保持！");
  });
});

describe("getCoachCTA", () => {
  const targets = { calories: 1800, protein: 120, carbs: 200, fat: 60 };

  it("defines stable canonical intents and task options", () => {
    assert.deepEqual(COACH_CTA_INTENTS.map((intent) => intent.id), [
      "protein",
      "next_meal",
      "calorie_control",
      "food_logging",
    ]);
    assert.deepEqual(COACH_CTA_INTENTS.map((intent) => intent.label), [
      "補蛋白質",
      "安排下一餐",
      "控制熱量",
      "記錄飲食",
    ]);
    assert.ok(COACH_CTA_INTENTS.every((intent) => intent.options.length === 3));
    assert.ok(COACH_CTA_INTENTS.every((intent) => intent.options.every((option) => option.label === option.prompt)));
    const allOptions: Array<{ id: string; prompt: string }> = COACH_CTA_INTENTS.flatMap((intent) =>
      intent.options.map((option) => ({ id: option.id, prompt: option.prompt })),
    );
    assert.ok(
      allOptions.some(
        (option) => option.id === "protein-convenience-store" && option.prompt === "推薦三個便利商店高蛋白選擇",
      ),
    );
    assert.ok(
      allOptions.some(
        (option) => option.id === "food-logging-today-review" && option.prompt === "幫我整理今天已記錄的飲食",
      ),
    );
  });

  it("returns the top three short intent CTAs when summary is null", () => {
    const cta = getCoachCTA(null, targets, 12);
    assert.equal(cta.length, 3);
    assert.deepEqual(cta.map((intent) => intent.label), ["安排下一餐", "補蛋白質", "控制熱量"]);
  });

  it("returns default intent ordering when targets is null", () => {
    const cta = getCoachCTA(
      { date: "2026-04-01", totalCalories: 500, totalProtein: 30, totalCarbs: 60, totalFat: 20, mealCount: 1 },
      null,
      12,
    );
    assert.equal(cta[0]?.id, "next_meal");
    assert.equal(cta.at(-1)?.id, "calorie_control");
  });

  it("prioritizes protein intent when protein gap > 30g", () => {
    const cta = getCoachCTA(
      { date: "2026-04-01", totalCalories: 800, totalProtein: 40, totalCarbs: 100, totalFat: 20, mealCount: 2 },
      targets,
      18,
    );
    assert.equal(cta[0]?.id, "protein");
    assert.equal(cta[0]?.options[0]?.id, "protein-convenience-store");
  });

  it("prioritizes calorie-control intent when calorie remaining <= 200", () => {
    const cta = getCoachCTA(
      { date: "2026-04-01", totalCalories: 1700, totalProtein: 110, totalCarbs: 180, totalFat: 50, mealCount: 3 },
      targets,
      19,
    );
    assert.equal(cta[0]?.id, "calorie_control");
  });

  it("prioritizes calorie-control intent when calories exceed target", () => {
    const cta = getCoachCTA(
      { date: "2026-04-01", totalCalories: 1900, totalProtein: 130, totalCarbs: 200, totalFat: 55, mealCount: 3 },
      targets,
      20,
    );
    assert.equal(cta[0]?.id, "calorie_control");
  });

  it("prioritizes food logging when no meals are logged", () => {
    const cta = getCoachCTA(
      { date: "2026-04-01", totalCalories: 0, totalProtein: 0, totalCarbs: 0, totalFat: 0, mealCount: 0 },
      targets,
      12,
    );
    assert.equal(cta[0]?.id, "food_logging");
    assert.ok(cta.some((intent) => intent.id === "protein"));
    assert.equal(cta.length, 3);
  });

  it("keeps food logging available when it is the strongest signal", () => {
    const cta = getCoachCTA(
      { date: "2026-04-01", totalCalories: 0, totalProtein: 0, totalCarbs: 0, totalFat: 0, mealCount: 0 },
      targets,
      18,
    );
    assert.ok(cta.some((intent) => intent.id === "food_logging"));
  });

  it("prioritizes next meal when no stronger signal applies", () => {
    const cta = getCoachCTA(
      { date: "2026-04-01", totalCalories: 1200, totalProtein: 100, totalCarbs: 130, totalFat: 40, mealCount: 2 },
      targets,
      12,
    );
    assert.equal(cta[0]?.id, "next_meal");
  });

  it("keeps each visible intent exactly once", () => {
    const cta = getCoachCTA(
      { date: "2026-04-01", totalCalories: 1200, totalProtein: 100, totalCarbs: 130, totalFat: 40, mealCount: 2 },
      targets,
      18,
    );
    assert.equal(new Set(cta.map((intent) => intent.id)).size, cta.length);
    assert.equal(cta.length, 3);
  });

  it("prioritizes protein gap over calorie-remaining when both apply", () => {
    const cta = getCoachCTA(
      { date: "2026-04-01", totalCalories: 1650, totalProtein: 50, totalCarbs: 180, totalFat: 55, mealCount: 2 },
      targets,
      18,
    );
    assert.equal(cta[0]?.id, "protein");
  });

  it("does not return fake-dialogue copy in intent labels or prompts", () => {
    const text = COACH_CTA_INTENTS.flatMap((intent) => [
      intent.label,
      ...intent.options.flatMap((option) => [option.label, option.prompt]),
    ]).join("\n");

    assert.doesNotMatch(text, /問我怎麼|問我現在|問我早餐|問我午餐|問我晚餐|問我宵夜/);
  });
});
