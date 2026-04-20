import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildCalendarWeeks,
  getInitialSummaryDateKey,
  isHistoricalSummaryDate,
} from "../../client/src/lib/summary-calendar.js";

describe("summary-calendar helpers", () => {
  it("always initializes Summary to today", () => {
    assert.equal(getInitialSummaryDateKey("2026-04-21"), "2026-04-21");
  });

  it("detects historical dates relative to today", () => {
    assert.equal(isHistoricalSummaryDate("2026-04-21", "2026-04-21"), false);
    assert.equal(isHistoricalSummaryDate("2026-04-18", "2026-04-21"), true);
  });

  it("builds a stable month grid with selected-day and today markers", () => {
    const weeks = buildCalendarWeeks({
      visibleMonthKey: "2026-03",
      selectedDateKey: "2026-03-25",
      todayKey: "2026-03-28",
    });

    assert.equal(weeks.length, 5);
    assert.deepEqual(
      weeks[0]!.map((day) => day.dateKey),
      ["2026-03-01", "2026-03-02", "2026-03-03", "2026-03-04", "2026-03-05", "2026-03-06", "2026-03-07"],
    );
    assert.deepEqual(
      weeks[4]!.map((day) => day.dateKey),
      ["2026-03-29", "2026-03-30", "2026-03-31", "2026-04-01", "2026-04-02", "2026-04-03", "2026-04-04"],
    );

    const selectedDay = weeks.flat().find((day) => day.isSelected);
    assert.deepEqual(selectedDay, {
      dateKey: "2026-03-25",
      dayNumber: 25,
      isCurrentMonth: true,
      isSelected: true,
      isToday: false,
      isFuture: false,
    });

    const todayDay = weeks.flat().find((day) => day.isToday);
    assert.equal(todayDay?.dateKey, "2026-03-28");
    assert.equal(todayDay?.isCurrentMonth, true);
  });
});
