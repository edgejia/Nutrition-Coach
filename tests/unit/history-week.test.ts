import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as historyWeek from "../../client/src/lib/history-week.js";
import {
  buildHistoryWeek,
  buildHistoryWeekStats,
  getHistoryCalorieStatus,
  getHistorySportStatusMeta,
  getMondayWeekStart,
  isRealDateKey,
  selectSameWeekdayOrClosestAvailable,
  shiftHistoryWeek,
  type HistoryWeekDay,
} from "../../client/src/lib/history-week.js";

const getHistoryWeekHeaderLabel = (
  historyWeek as typeof historyWeek & {
    getHistoryWeekHeaderLabel?: (weekStartKey: string, todayKey: string) => string;
  }
).getHistoryWeekHeaderLabel;

describe("history week helpers", () => {
  it("returns the Monday start for a date key", () => {
    assert.equal(getMondayWeekStart("2026-04-30"), "2026-04-27");
  });

  it("shifts week starts by whole weeks", () => {
    assert.equal(shiftHistoryWeek("2026-04-27", -1), "2026-04-20");
    assert.equal(shiftHistoryWeek("2026-04-27", 1), "2026-05-04");
  });

  it("NAV-03 labels visible History weeks relative to today without future copy", () => {
    assert.equal(
      typeof getHistoryWeekHeaderLabel,
      "function",
      "NAV-03 expected getHistoryWeekHeaderLabel helper to preserve 本週 / 上週 / 歷史紀錄 semantics",
    );
    assert.equal(getHistoryWeekHeaderLabel?.("2026-05-04", "2026-05-06"), "本週", "NAV-03 current week label");
    assert.equal(getHistoryWeekHeaderLabel?.("2026-04-27", "2026-05-06"), "上週", "NAV-03 previous week label");
    assert.equal(getHistoryWeekHeaderLabel?.("2026-04-20", "2026-05-06"), "歷史紀錄", "NAV-03 older week label");
    assert.notEqual(
      getHistoryWeekHeaderLabel?.("2026-05-11", "2026-05-06"),
      "下週",
      "NAV-03 Phase 82 preserves the future-week guard and has no 下週 support",
    );
  });

  it("validates real local date keys without throwing", () => {
    assert.equal(isRealDateKey("2026-04-30"), true);
    assert.equal(isRealDateKey("2026-02-28"), true);
    assert.equal(isRealDateKey("2026-12-31"), true);

    assert.equal(isRealDateKey("2026-4-30"), false);
    assert.equal(isRealDateKey("not-a-date"), false);
    assert.equal(isRealDateKey("2026-02-31"), false);
    assert.equal(isRealDateKey("2026-13-01"), false);
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

  it("builds pending week days without fake nutrition values", () => {
    const days = buildHistoryWeek({
      weekStartKey: "2026-05-04",
      selectedDateKey: "2026-05-06",
      todayKey: "2026-05-06",
      trends: [],
      targets: { calories: 2000, protein: 100, carbs: 250, fat: 70 },
      pending: true,
    });

    assert.equal(days.length, 7);
    for (const day of days) {
      assert.equal(day.status, "pending");
      assert.equal(day.calories, null);
      assert.equal(day.mealCount, null);
      assert.equal(day.calorieRatio, null);
      assert.equal(day.waterLevel, 0);
    }

    const selectedDay = days.find((day) => day.dateKey === "2026-05-06");
    assert.ok(selectedDay);
    assert.equal(selectedDay.dateKey, "2026-05-06");
    assert.equal(selectedDay.isSelected, true);
    assert.equal(selectedDay.isToday, true);
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

  it("does not produce synthetic water levels for empty or targetMissing days", () => {
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

  it("builds Phase 41 weekly stats from real week days without demo metric labels", () => {
    const baseDay: HistoryWeekDay = {
      dateKey: "2026-04-27",
      weekday: "一",
      dayNumber: 27,
      calories: 0,
      mealCount: 0,
      status: "empty",
      calorieRatio: null,
      waterLevel: 0,
      hasTarget: true,
      isOverTolerance: false,
      isSelected: false,
      isToday: false,
      isFuture: false,
    };

    const stats = buildHistoryWeekStats({
      averageCalories: 1666.5,
      days: [
        { ...baseDay, dateKey: "2026-04-27", weekday: "一", mealCount: 2, status: "inRange" },
        { ...baseDay, dateKey: "2026-04-28", weekday: "二", mealCount: 1, status: "low" },
        { ...baseDay, dateKey: "2026-04-29", weekday: "三", mealCount: 3, status: "inRange" },
        { ...baseDay, dateKey: "2026-04-30", weekday: "四", mealCount: 4, status: "inRange", isFuture: true },
      ],
    });

    assert.deepEqual(stats, {
      averageCalories: 1667,
      inRangeDays: 3,
      loggedDays: 3,
      mealCount: 6,
    });

    assert.deepEqual(buildHistoryWeekStats({ averageCalories: null, days: [] }), {
      averageCalories: 0,
      inRangeDays: 0,
      loggedDays: 0,
      mealCount: 0,
    });

    assert.deepEqual(
      buildHistoryWeekStats({
        averageCalories: -24,
        days: [
          { ...baseDay, dateKey: "2026-05-01", weekday: "五", mealCount: 2, status: "inRange", isFuture: true },
        ],
      }),
      {
        averageCalories: 0,
        inRangeDays: 1,
        loggedDays: 0,
        mealCount: 0,
      },
    );
  });

  it("builds pending weekly stats with neutral placeholders", () => {
    const days = buildHistoryWeek({
      weekStartKey: "2026-05-04",
      selectedDateKey: "2026-05-06",
      todayKey: "2026-05-06",
      trends: [],
      targets: { calories: 2000, protein: 100, carbs: 250, fat: 70 },
      pending: true,
    });

    assert.deepEqual(buildHistoryWeekStats({ days, averageCalories: null, pending: true }), {
      averageCalories: null,
      inRangeDays: null,
      loggedDays: null,
      mealCount: null,
    });

    const meta = getHistorySportStatusMeta({ status: "pending", targetCalories: 2000 });
    assert.equal(meta.barTone, "muted");
    assert.equal(meta.badge, null);
  });

  it("maps Phase 41 sport calorie statuses to badge copy and bar tones", () => {
    assert.deepEqual(getHistorySportStatusMeta({ status: "empty", targetCalories: 2000 }), {
      badge: null,
      barTone: "muted",
      chipVariant: "neutral",
    });
    assert.deepEqual(getHistorySportStatusMeta({ status: "empty", targetCalories: null }), {
      badge: "目標同步中",
      barTone: "muted",
      chipVariant: "neutral",
    });
    assert.deepEqual(getHistorySportStatusMeta({ status: "targetMissing", targetCalories: null }), {
      badge: "目標同步中",
      barTone: "muted",
      chipVariant: "neutral",
    });
    assert.deepEqual(getHistorySportStatusMeta({ status: "low", targetCalories: 2000 }), {
      badge: "偏低",
      barTone: "amber",
      chipVariant: "warn",
    });
    assert.deepEqual(getHistorySportStatusMeta({ status: "slightlyLow", targetCalories: 2000 }), {
      badge: "略低",
      barTone: "amber",
      chipVariant: "warn",
    });
    assert.deepEqual(getHistorySportStatusMeta({ status: "inRange", targetCalories: 2000 }), {
      badge: "達標範圍",
      barTone: "lime",
      chipVariant: "good",
    });
    assert.deepEqual(getHistorySportStatusMeta({ status: "over", targetCalories: 2000 }), {
      badge: "超標",
      barTone: "red",
      chipVariant: "danger",
    });
    assert.deepEqual(getHistorySportStatusMeta({ status: "highOver", targetCalories: 2000 }), {
      badge: "明顯超標",
      barTone: "red",
      chipVariant: "danger",
    });
  });
});
