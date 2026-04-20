import { formatLocalDate } from "./time.js";

export interface SummaryCalendarDay {
  dateKey: string;
  dayNumber: number;
  isCurrentMonth: boolean;
  isSelected: boolean;
  isToday: boolean;
  isFuture: boolean;
}

const MONTH_KEY_PATTERN = /^(\d{4})-(\d{2})$/;

function parseMonthKey(monthKey: string) {
  const match = MONTH_KEY_PATTERN.exec(monthKey);
  if (!match) {
    throw new Error("INVALID_MONTH_KEY");
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const monthStart = new Date(year, month - 1, 1);
  if (monthStart.getFullYear() !== year || monthStart.getMonth() !== month - 1) {
    throw new Error("INVALID_MONTH_KEY");
  }

  return { year, monthIndex: month - 1 };
}

export function getInitialSummaryDateKey(todayKey: string): string {
  return todayKey;
}

export function isHistoricalSummaryDate(selectedDateKey: string, todayKey: string): boolean {
  return selectedDateKey !== todayKey;
}

export function buildCalendarWeeks(input: {
  visibleMonthKey: string;
  selectedDateKey: string;
  todayKey: string;
}): SummaryCalendarDay[][] {
  const { visibleMonthKey, selectedDateKey, todayKey } = input;
  const { year, monthIndex } = parseMonthKey(visibleMonthKey);
  const monthStart = new Date(year, monthIndex, 1);
  const monthEnd = new Date(year, monthIndex + 1, 0);
  const gridStart = new Date(year, monthIndex, 1 - monthStart.getDay());
  const gridEnd = new Date(
    monthEnd.getFullYear(),
    monthEnd.getMonth(),
    monthEnd.getDate() + (6 - monthEnd.getDay()),
  );

  const weeks: SummaryCalendarDay[][] = [];
  const cursor = new Date(gridStart);

  while (cursor <= gridEnd) {
    const week: SummaryCalendarDay[] = [];
    for (let index = 0; index < 7; index += 1) {
      const dateKey = formatLocalDate(cursor);
      week.push({
        dateKey,
        dayNumber: cursor.getDate(),
        isCurrentMonth: cursor.getMonth() === monthIndex,
        isSelected: dateKey === selectedDateKey,
        isToday: dateKey === todayKey,
        isFuture: dateKey > todayKey,
      });
      cursor.setDate(cursor.getDate() + 1);
    }
    weeks.push(week);
  }

  return weeks;
}
