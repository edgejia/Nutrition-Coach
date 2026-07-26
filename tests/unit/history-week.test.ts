import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildHistoryWeek,
  buildHistoryWeekStats,
  getMondayWeekStart,
  getHistorySportStatusMeta,
  isRealDateKey,
  selectSameWeekdayOrClosestAvailable,
  shiftHistoryWeek,
  type HistoryWeekDay,
} from "../../client/src/lib/history-week.js";

// Runtime semantic authority: history-home-semantic-owner-contract.test.ts.
// These remaining tests are bounded History algorithm guards for weekly aggregation and sport metadata.
describe("history week structural and algorithm guards", () => {
  it("keeps strict date validity and Monday arithmetic across calendar boundaries", () => {
    assert.equal(isRealDateKey("2024-02-29"), true);
    assert.equal(isRealDateKey("2025-02-29"), false);
    assert.throws(
      () => getMondayWeekStart("2025-02-29"),
      { message: "INVALID_DATE_KEY" },
    );

    assert.equal(getMondayWeekStart("2026-04-27"), "2026-04-27");
    assert.equal(getMondayWeekStart("2026-04-29"), "2026-04-27");
    assert.equal(getMondayWeekStart("2026-05-03"), "2026-04-27");
    assert.equal(shiftHistoryWeek("2026-04-27", 1), "2026-05-04");
    assert.equal(shiftHistoryWeek("2026-01-05", -1), "2025-12-29");
    assert.equal(shiftHistoryWeek("2025-12-29", 1), "2026-01-05");
  });

  it("builds a Monday-through-Sunday leap week with stable day numbers", () => {
    const days = buildHistoryWeek({
      weekStartKey: "2024-02-26",
      selectedDateKey: "2024-02-29",
      todayKey: "2024-03-03",
      trends: [],
      targets: { calories: 2000, protein: 100, carbs: 250, fat: 70 },
    });

    assert.deepEqual(
      days.map((day) => day.dateKey),
      [
        "2024-02-26",
        "2024-02-27",
        "2024-02-28",
        "2024-02-29",
        "2024-03-01",
        "2024-03-02",
        "2024-03-03",
      ],
    );
    assert.deepEqual(days.map((day) => day.dayNumber), [26, 27, 28, 29, 1, 2, 3]);
    assert.deepEqual(days.map((day) => day.weekday), ["一", "二", "三", "四", "五", "六", "日"]);
  });

  it("preserves exact-weekday selection and the closest available fallback", () => {
    assert.equal(
      selectSameWeekdayOrClosestAvailable({
        nextWeekStartKey: "2026-04-20",
        previousSelectedDateKey: "2026-04-30",
        todayKey: "2026-04-30",
      }),
      "2026-04-23",
    );
    assert.equal(
      selectSameWeekdayOrClosestAvailable({
        nextWeekStartKey: "2026-05-04",
        previousSelectedDateKey: "2026-04-30",
        todayKey: "2026-05-06",
      }),
      "2026-05-06",
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
