import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  COACH_CTA_INTENTS,
  getCoachAdvice,
  getCoachCTA,
  getEmptyStateCopy,
  narrowGoal,
} from "../../client/src/coach-advice.js";

function assertThreeUniqueIntents(cta: ReturnType<typeof getCoachCTA>) {
  assert.equal(cta.length, 3);
  assert.equal(new Set(cta.map((intent) => intent.id)).size, cta.length);
}

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

  it("selects fat_loss restraint advice when calories are near the ceiling", () => {
    const advice = getCoachAdvice(
      { date: "2026-04-01", totalCalories: 1710, totalProtein: 112, totalCarbs: 150, totalFat: 40, mealCount: 2 },
      { calories: 1800, protein: 120, carbs: 200, fat: 60 },
      "fat_loss",
    );

    assert.equal(advice, "熱量快到上限了，晚餐吃清淡一點");
  });

  it("selects muscle_gain encouragement advice for a protein gap", () => {
    const advice = getCoachAdvice(
      { date: "2026-04-01", totalCalories: 1500, totalProtein: 70, totalCarbs: 150, totalFat: 40, mealCount: 2 },
      { calories: 2200, protein: 130, carbs: 240, fat: 70 },
      "muscle_gain",
    );

    assert.match(advice ?? "", /再補一餐/);
    assert.doesNotMatch(advice ?? "", /吃清淡一點/);
  });

  it("keeps maintain advice on the existing balanced tree", () => {
    const advice = getCoachAdvice(
      { date: "2026-04-01", totalCalories: 1400, totalProtein: 140, totalCarbs: 150, totalFat: 40, mealCount: 3 },
      { calories: 1800, protein: 120, carbs: 200, fat: 60 },
      "maintain",
    );

    assert.equal(advice, "今天攝取均衡，繼續保持！");
  });

  it("nudges muscle_gain users below calorie and protein targets to add a meal", () => {
    const advice = getCoachAdvice(
      { date: "2026-04-01", totalCalories: 1200, totalProtein: 70, totalCarbs: 120, totalFat: 35, mealCount: 2 },
      { calories: 2200, protein: 130, carbs: 240, fat: 70 },
      "muscle_gain",
    );

    assert.match(advice ?? "", /再補一餐/);
    assert.notEqual(advice, "熱量快到上限了，晚餐吃清淡一點");
  });

  it("narrows null and unknown goals to maintain behavior", () => {
    const summary = { date: "2026-04-01", totalCalories: 1400, totalProtein: 140, totalCarbs: 150, totalFat: 40, mealCount: 3 };
    const targets = { calories: 1800, protein: 120, carbs: 200, fat: 60 };
    const maintainAdvice = getCoachAdvice(summary, targets, "maintain");

    assert.equal(narrowGoal(null), "maintain");
    assert.equal(narrowGoal("garbage"), "maintain");
    assert.equal(narrowGoal("fat_loss"), "fat_loss");
    assert.equal(narrowGoal("muscle_gain"), "muscle_gain");
    assert.equal(narrowGoal("maintain"), "maintain");
    assert.equal(getCoachAdvice(summary, targets, null), maintainAdvice);
    assert.equal(getCoachAdvice(summary, targets, "garbage"), maintainAdvice);
  });

  it("returns goal-tailored empty state copy with target numbers", () => {
    const targets = { calories: 1800, protein: 120, carbs: 200, fat: 60 };

    assert.match(getEmptyStateCopy("muscle_gain", targets), /120/);
    assert.match(getEmptyStateCopy("fat_loss", targets), /1800/);
    assert.ok(getEmptyStateCopy(null, targets).length > 0);
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

  it("selects per-goal CTA leads while keeping three unique intents", () => {
    const muscleGainProtein = getCoachCTA(
      { date: "2026-04-01", totalCalories: 1200, totalProtein: 70, totalCarbs: 120, totalFat: 35, mealCount: 2 },
      { calories: 2200, protein: 130, carbs: 240, fat: 70 },
      12,
      "muscle_gain",
    );
    const fatLossCeiling = getCoachCTA(
      { date: "2026-04-01", totalCalories: 1710, totalProtein: 112, totalCarbs: 150, totalFat: 40, mealCount: 2 },
      targets,
      12,
      "fat_loss",
    );
    const muscleGainNeutral = getCoachCTA(
      { date: "2026-04-01", totalCalories: 1800, totalProtein: 110, totalCarbs: 180, totalFat: 55, mealCount: 2 },
      { calories: 2200, protein: 130, carbs: 240, fat: 70 },
      12,
      "muscle_gain",
    );
    const maintainNeutral = getCoachCTA(
      { date: "2026-04-01", totalCalories: 1200, totalProtein: 100, totalCarbs: 130, totalFat: 40, mealCount: 2 },
      targets,
      12,
      "maintain",
    );
    const nullNeutral = getCoachCTA(
      { date: "2026-04-01", totalCalories: 1200, totalProtein: 100, totalCarbs: 130, totalFat: 40, mealCount: 2 },
      targets,
      12,
      null,
    );

    assert.equal(muscleGainProtein[0]?.id, "protein");
    assert.equal(fatLossCeiling[0]?.id, "calorie_control");
    assert.equal(muscleGainNeutral[0]?.id, "protein");
    assert.deepEqual(maintainNeutral.map((intent) => intent.id), ["next_meal", "protein", "calorie_control"]);
    assert.deepEqual(nullNeutral.map((intent) => intent.id), maintainNeutral.map((intent) => intent.id));
    for (const cta of [muscleGainProtein, fatLossCeiling, muscleGainNeutral, maintainNeutral, nullNeutral]) {
      assertThreeUniqueIntents(cta);
    }
  });

  it("uses per-goal active-state precedence for dual protein and calorie signals", () => {
    const dualSignalSummary = {
      date: "2026-04-01",
      totalCalories: 1650,
      totalProtein: 50,
      totalCarbs: 180,
      totalFat: 55,
      mealCount: 2,
    };

    assert.equal(getCoachCTA(dualSignalSummary, targets, 18, "fat_loss")[0]?.id, "calorie_control");
    assert.equal(getCoachCTA(dualSignalSummary, targets, 18, "muscle_gain")[0]?.id, "protein");
    assert.equal(getCoachCTA(dualSignalSummary, targets, 18, "maintain")[0]?.id, "protein");
  });

  it("uses goal-biased empty-state ordering after the universal food logging lead", () => {
    const emptySummary = {
      date: "2026-04-01",
      totalCalories: 0,
      totalProtein: 0,
      totalCarbs: 0,
      totalFat: 0,
      mealCount: 0,
    };
    const byGoal = {
      fatLoss: getCoachCTA(emptySummary, targets, 12, "fat_loss"),
      muscleGain: getCoachCTA(emptySummary, targets, 12, "muscle_gain"),
      maintain: getCoachCTA(emptySummary, targets, 12, "maintain"),
      nullGoal: getCoachCTA(emptySummary, targets, 12, null),
    };

    for (const cta of Object.values(byGoal)) {
      assert.equal(cta[0]?.id, "food_logging");
      assertThreeUniqueIntents(cta);
    }

    const muscleGainIds = byGoal.muscleGain.map((intent) => intent.id);
    const fatLossIds = byGoal.fatLoss.map((intent) => intent.id);
    assert.ok(muscleGainIds.indexOf("protein") < muscleGainIds.indexOf("calorie_control"));
    assert.ok(fatLossIds.indexOf("calorie_control") < fatLossIds.indexOf("protein"));
    assert.deepEqual(byGoal.maintain.map((intent) => intent.id), ["food_logging", "protein", "next_meal"]);
    assert.deepEqual(byGoal.nullGoal.map((intent) => intent.id), byGoal.maintain.map((intent) => intent.id));
  });
});
