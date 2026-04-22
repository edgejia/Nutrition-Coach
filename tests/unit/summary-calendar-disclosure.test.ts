import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  browseSummaryCalendarMonth,
  closeSummaryCalendar,
  getSummaryCalendarReadOnlyHint,
  getSummaryCalendarStatusLabel,
  getSummaryCalendarToggleLabel,
  openSummaryCalendar,
  selectSummaryCalendarDate,
  type SummaryCalendarDisclosureState,
} from "../../client/src/lib/summary-calendar-disclosure.js";

const BASE_STATE: SummaryCalendarDisclosureState = {
  todayKey: "2026-04-21",
  selectedDateKey: "2026-04-18",
  visibleMonthKey: "2026-03",
  isCalendarOpen: false,
};

describe("summary-calendar-disclosure contract", () => {
  it("opens the calendar and snaps the visible month to the selected date", () => {
    const nextState = openSummaryCalendar(BASE_STATE);

    assert.deepEqual(nextState, {
      ...BASE_STATE,
      visibleMonthKey: "2026-04",
      isCalendarOpen: true,
    });
  });

  it("browses one month at a time without changing the selected date", () => {
    const nextState = browseSummaryCalendarMonth(
      {
        ...BASE_STATE,
        visibleMonthKey: "2026-01",
        isCalendarOpen: true,
      },
      -1,
    );

    assert.deepEqual(nextState, {
      ...BASE_STATE,
      visibleMonthKey: "2025-12",
      isCalendarOpen: true,
    });
  });

  it("closes the calendar without changing the selected date or visible month", () => {
    const nextState = closeSummaryCalendar({
      ...BASE_STATE,
      visibleMonthKey: "2026-02",
      isCalendarOpen: true,
    });

    assert.deepEqual(nextState, {
      ...BASE_STATE,
      visibleMonthKey: "2026-02",
      isCalendarOpen: false,
    });
  });

  it("ignores future dates", () => {
    const nextState = selectSummaryCalendarDate(
      {
        ...BASE_STATE,
        isCalendarOpen: true,
      },
      "2026-04-22",
    );

    assert.equal(nextState, BASE_STATE);
  });

  it("selects valid dates, syncs the month, and auto-collapses", () => {
    const nextState = selectSummaryCalendarDate(
      {
        ...BASE_STATE,
        visibleMonthKey: "2026-03",
        isCalendarOpen: true,
      },
      "2026-02-09",
    );

    assert.deepEqual(nextState, {
      ...BASE_STATE,
      selectedDateKey: "2026-02-09",
      visibleMonthKey: "2026-02",
      isCalendarOpen: false,
    });
  });

  it("returns the exact disclosure copy contract", () => {
    assert.equal(getSummaryCalendarStatusLabel(false), "今天 · 即時");
    assert.equal(getSummaryCalendarStatusLabel(true), "歷史快照");
    assert.equal(getSummaryCalendarToggleLabel(false), "展開月曆");
    assert.equal(getSummaryCalendarToggleLabel(true), "收合月曆");
    assert.equal(getSummaryCalendarReadOnlyHint(false), null);
    assert.equal(
      getSummaryCalendarReadOnlyHint(true),
      "今天的即時更新不會覆蓋這個畫面。",
    );
  });
});
