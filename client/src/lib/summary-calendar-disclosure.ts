export interface SummaryCalendarDisclosureState {
  todayKey: string;
  selectedDateKey: string;
  visibleMonthKey: string;
  isCalendarOpen: boolean;
}

const MONTH_KEY_PATTERN = /^(\d{4})-(\d{2})$/;

function getSelectedMonthKey(dateKey: string): string {
  return dateKey.slice(0, 7);
}

function shiftMonthKey(monthKey: string, delta: -1 | 1): string {
  const match = MONTH_KEY_PATTERN.exec(monthKey);
  if (!match) {
    throw new Error("INVALID_MONTH_KEY");
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const shiftedMonth = new Date(year, month - 1 + delta, 1);

  return [
    shiftedMonth.getFullYear(),
    String(shiftedMonth.getMonth() + 1).padStart(2, "0"),
  ].join("-");
}

export function openSummaryCalendar(
  state: SummaryCalendarDisclosureState,
): SummaryCalendarDisclosureState {
  return {
    ...state,
    visibleMonthKey: getSelectedMonthKey(state.selectedDateKey),
    isCalendarOpen: true,
  };
}

export function closeSummaryCalendar(
  state: SummaryCalendarDisclosureState,
): SummaryCalendarDisclosureState {
  return {
    ...state,
    isCalendarOpen: false,
  };
}

export function browseSummaryCalendarMonth(
  state: SummaryCalendarDisclosureState,
  delta: -1 | 1,
): SummaryCalendarDisclosureState {
  return {
    ...state,
    visibleMonthKey: shiftMonthKey(state.visibleMonthKey, delta),
  };
}

export function selectSummaryCalendarDate(
  state: SummaryCalendarDisclosureState,
  dateKey: string,
): SummaryCalendarDisclosureState {
  if (dateKey > state.todayKey) {
    return state;
  }

  return {
    ...state,
    selectedDateKey: dateKey,
    visibleMonthKey: getSelectedMonthKey(dateKey),
    isCalendarOpen: false,
  };
}

export function getSummaryCalendarStatusLabel(
  isReadOnly: boolean,
): "今天 · 即時" | "歷史快照" {
  return isReadOnly ? "歷史快照" : "今天 · 即時";
}

export function getSummaryCalendarToggleLabel(
  isCalendarOpen: boolean,
): "展開月曆" | "收合月曆" {
  return isCalendarOpen ? "收合月曆" : "展開月曆";
}

export function getSummaryCalendarReadOnlyHint(
  isReadOnly: boolean,
): string | null {
  return isReadOnly ? "今天的即時更新不會覆蓋這個畫面。" : null;
}
