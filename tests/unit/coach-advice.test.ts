import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { getCoachAdvice } from "../../client/src/coach-advice.js";

describe("getCoachAdvice", () => {
  it("returns the empty state advice when no meals are logged", () => {
    const advice = getCoachAdvice(
      { totalCalories: 0, totalProtein: 0, totalCarbs: 0, totalFat: 0, mealCount: 0 },
      { calories: 1800, protein: 120, carbs: 200, fat: 60 }
    );

    assert.equal(advice, "還沒記錄任何餐點，開始記錄你的第一餐吧");
  });

  it("prioritizes protein deficit before low remaining calories", () => {
    const advice = getCoachAdvice(
      { totalCalories: 1710, totalProtein: 80, totalCarbs: 150, totalFat: 40, mealCount: 2 },
      { calories: 1800, protein: 120, carbs: 200, fat: 60 }
    );

    assert.equal(advice, "蛋白質還差 40g，晚餐建議高蛋白食物");
  });

  it("does not recommend extra protein when protein is already above target", () => {
    const advice = getCoachAdvice(
      { totalCalories: 1400, totalProtein: 140, totalCarbs: 150, totalFat: 40, mealCount: 3 },
      { calories: 1800, protein: 120, carbs: 200, fat: 60 }
    );

    assert.equal(advice, "今天攝取均衡，繼續保持！");
  });
});
