import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildHistoryWeek,
  getHistoryCalorieStatus,
  getMondayWeekStart,
  selectSameWeekdayOrClosestAvailable,
  shiftHistoryWeek,
} from "../../client/src/lib/history-week.js";

describe("history week helpers", () => {
  it("returns the Monday start for a date key", () => {
    assert.equal(getMondayWeekStart("2026-04-30"), "2026-04-27");
  });

  it("shifts week starts by whole weeks", () => {
    assert.equal(shiftHistoryWeek("2026-04-27", -1), "2026-04-20");
    assert.equal(shiftHistoryWeek("2026-04-27", 1), "2026-05-04");
  });

  it("builds seven Monday-first days with selected, today, future, and trend status", () => {
    const days = buildHistoryWeek({
      weekStartKey: "2026-04-27",
      selectedDateKey: "2026-04-30",
      todayKey: "2026-04-30",
      trends: [
        { date: "2026-04-27", calories: 0, protein: 0, carbs: 0, fat: 0, mealCount: 0 },
        { date: "2026-04-28", calories: 1600, protein: 80, carbs: 180, fat: 40, mealCount: 3 },
        { date: "2026-04-29", calories: 2300, protein: 120, carbs: 260, fat: 70, mealCount: 4 },
      ],
      targets: { calories: 2000, protein: 100, carbs: 250, fat: 70 },
    });

    assert.equal(days.length, 7);
    assert.equal(days[0]?.dateKey, "2026-04-27");
    assert.equal(days[0]?.status, "empty");
    assert.equal(days[1]?.status, "slightlyLow");
    assert.equal(days[1]?.waterLevel, 0.8);
    assert.equal(days[2]?.status, "over");
    assert.equal(days[2]?.waterLevel, 1);
    assert.equal(days[2]?.isOverTolerance, true);
    assert.equal(days[3]?.isSelected, true);
    assert.equal(days[3]?.isToday, true);
    assert.equal(days[4]?.isFuture, true);
    assert.equal(days[5]?.isFuture, true);
    assert.equal(days[6]?.isFuture, true);
  });

  it("classifies calorie ratios with the locked 90%-110% target range", () => {
    assert.equal(getHistoryCalorieStatus({ calories: 1300, mealCount: 3, targetCalories: 2000 }).status, "low");
    assert.equal(
      getHistoryCalorieStatus({ calories: 1600, mealCount: 3, targetCalories: 2000 }).status,
      "slightlyLow",
    );
    assert.equal(getHistoryCalorieStatus({ calories: 2000, mealCount: 3, targetCalories: 2000 }).status, "inRange");
    assert.equal(getHistoryCalorieStatus({ calories: 2000, targetCalories: 2000 }).status, "inRange");
    assert.equal(getHistoryCalorieStatus({ calories: 2200, mealCount: 3, targetCalories: 2000 }).status, "inRange");
    assert.equal(getHistoryCalorieStatus({ calories: 2201, mealCount: 3, targetCalories: 2000 }).status, "over");
    assert.equal(getHistoryCalorieStatus({ calories: 2600, mealCount: 3, targetCalories: 2000 }).status, "highOver");
  });

  it("does not produce fake water levels for empty or targetMissing days", () => {
    const empty = getHistoryCalorieStatus({ calories: 0, mealCount: 0, targetCalories: 2000 });
    assert.equal(empty.status, "empty");
    assert.equal(empty.calorieRatio, null);
    assert.equal(empty.waterLevel, 0);

    const targetMissing = getHistoryCalorieStatus({ calories: 600, mealCount: 1, targetCalories: null });
    assert.equal(targetMissing.status, "targetMissing");
    assert.equal(targetMissing.calorieRatio, null);
    assert.equal(targetMissing.waterLevel, 0);
    assert.equal(targetMissing.hasTarget, false);
  });

  it("clamps a same-weekday selection to today when the target weekday is future", () => {
    assert.equal(
      selectSameWeekdayOrClosestAvailable({
        nextWeekStartKey: "2026-05-04",
        previousSelectedDateKey: "2026-04-30",
        todayKey: "2026-04-30",
      }),
      "2026-04-30",
    );
  });
});
