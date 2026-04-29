import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildHistoryWeek,
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
    assert.equal(days[1]?.status, "normal");
    assert.equal(days[2]?.status, "overTarget");
    assert.equal(days[3]?.isSelected, true);
    assert.equal(days[3]?.isToday, true);
    assert.equal(days[4]?.isFuture, true);
    assert.equal(days[5]?.isFuture, true);
    assert.equal(days[6]?.isFuture, true);
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
