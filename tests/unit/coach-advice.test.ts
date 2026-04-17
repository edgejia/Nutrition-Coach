import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { getCoachAdvice } from "../../client/src/coach-advice.js";
import { getCoachCTA } from "../../client/src/coach-advice.js";

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

  it("returns first-meal CTA when no meals logged", () => {
    const cta = getCoachCTA(
      { date: "2026-04-01", totalCalories: 0, totalProtein: 0, totalCarbs: 0, totalFat: 0, mealCount: 0 },
      targets,
      12,
    );
    assert.deepEqual(cta, { primary: "開始記錄今天第一餐", secondary: "記錄飲食" });
  });

  it("returns first-meal CTA when summary is null", () => {
    const cta = getCoachCTA(null, targets, 12);
    assert.deepEqual(cta, { primary: "開始記錄今天第一餐", secondary: "記錄飲食" });
  });

  it("returns first-meal CTA when targets is null", () => {
    const cta = getCoachCTA(
      { date: "2026-04-01", totalCalories: 500, totalProtein: 30, totalCarbs: 60, totalFat: 20, mealCount: 1 },
      null,
      12,
    );
    assert.deepEqual(cta, { primary: "開始記錄今天第一餐", secondary: "記錄飲食" });
  });

  it("returns protein CTA when protein gap > 30g", () => {
    const cta = getCoachCTA(
      { date: "2026-04-01", totalCalories: 800, totalProtein: 40, totalCarbs: 100, totalFat: 20, mealCount: 2 },
      targets,
      18,
    );
    assert.deepEqual(cta, { primary: "問我怎麼補蛋白質", secondary: "記錄飲食" });
  });

  it("returns closing-meal CTA when calorie remaining < 200", () => {
    const cta = getCoachCTA(
      { date: "2026-04-01", totalCalories: 1700, totalProtein: 110, totalCarbs: 180, totalFat: 50, mealCount: 3 },
      targets,
      19,
    );
    assert.deepEqual(cta, { primary: "問我怎麼收今天這餐", secondary: "記錄飲食" });
  });

  it("returns over-limit CTA when calories exceed target", () => {
    const cta = getCoachCTA(
      { date: "2026-04-01", totalCalories: 1900, totalProtein: 130, totalCarbs: 200, totalFat: 55, mealCount: 3 },
      targets,
      20,
    );
    assert.deepEqual(cta, { primary: "問我現在還能不能吃", secondary: "記錄飲食" });
  });

  it("uses meal-period label matching the hour — morning", () => {
    const cta = getCoachCTA(
      { date: "2026-04-01", totalCalories: 1200, totalProtein: 100, totalCarbs: 130, totalFat: 40, mealCount: 2 },
      targets,
      8,
    );
    assert.deepEqual(cta, { primary: "問我早餐怎麼吃", secondary: "記錄飲食" });
  });

  it("uses meal-period label matching the hour — noon", () => {
    const cta = getCoachCTA(
      { date: "2026-04-01", totalCalories: 1200, totalProtein: 100, totalCarbs: 130, totalFat: 40, mealCount: 2 },
      targets,
      12,
    );
    assert.deepEqual(cta, { primary: "問我午餐怎麼吃", secondary: "記錄飲食" });
  });

  it("uses meal-period label matching the hour — evening", () => {
    const cta = getCoachCTA(
      { date: "2026-04-01", totalCalories: 1200, totalProtein: 100, totalCarbs: 130, totalFat: 40, mealCount: 2 },
      targets,
      18,
    );
    assert.deepEqual(cta, { primary: "問我晚餐怎麼吃", secondary: "記錄飲食" });
  });

  it("uses meal-period label matching the hour — late night", () => {
    const cta = getCoachCTA(
      { date: "2026-04-01", totalCalories: 1200, totalProtein: 100, totalCarbs: 130, totalFat: 40, mealCount: 2 },
      targets,
      23,
    );
    assert.deepEqual(cta, { primary: "問我宵夜怎麼吃", secondary: "記錄飲食" });
  });

  it("prioritizes protein gap over calorie-remaining when both apply", () => {
    const cta = getCoachCTA(
      { date: "2026-04-01", totalCalories: 1650, totalProtein: 50, totalCarbs: 180, totalFat: 55, mealCount: 2 },
      targets,
      18,
    );
    assert.deepEqual(cta, { primary: "問我怎麼補蛋白質", secondary: "記錄飲食" });
  });
});
