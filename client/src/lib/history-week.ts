import type { DailyTargets } from "../types.js";
import { formatLocalDate } from "./time.js";

export type HistoryWeekStatus = "empty" | "normal" | "overTarget";

export interface HistoryWeekTrend {
  date: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  mealCount: number;
}

export interface HistoryWeekDay {
  dateKey: string;
  weekday: "一" | "二" | "三" | "四" | "五" | "六" | "日";
  dayNumber: number;
  calories: number;
  mealCount: number;
  status: "empty" | "normal" | "overTarget";
  isSelected: boolean;
  isToday: boolean;
  isFuture: boolean;
}

const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const WEEKDAY_LABELS: HistoryWeekDay["weekday"][] = ["一", "二", "三", "四", "五", "六", "日"];

function parseDateKey(dateKey: string): Date {
  const match = DATE_KEY_PATTERN.exec(dateKey);
  if (!match) {
    throw new Error("INVALID_DATE_KEY");
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    throw new Error("INVALID_DATE_KEY");
  }

  return date;
}

function addDays(dateKey: string, deltaDays: number): string {
  const date = parseDateKey(dateKey);
  date.setDate(date.getDate() + deltaDays);
  return formatLocalDate(date);
}

function dayOffsetFromMonday(date: Date): number {
  return (date.getDay() + 6) % 7;
}

function classifyStatus(trend: HistoryWeekTrend | undefined, targets?: DailyTargets | null): HistoryWeekStatus {
  if (!trend || trend.mealCount === 0 || trend.calories <= 0) {
    return "empty";
  }

  if (targets && trend.calories > targets.calories) {
    return "overTarget";
  }

  return "normal";
}

export function getMondayWeekStart(dateKey: string): string {
  const date = parseDateKey(dateKey);
  date.setDate(date.getDate() - dayOffsetFromMonday(date));
  return formatLocalDate(date);
}

export function shiftHistoryWeek(weekStartKey: string, deltaWeeks: -1 | 1): string {
  return addDays(weekStartKey, deltaWeeks * 7);
}

export function buildHistoryWeek(input: {
  weekStartKey: string;
  selectedDateKey: string;
  todayKey: string;
  trends: HistoryWeekTrend[];
  targets?: DailyTargets | null;
}): HistoryWeekDay[] {
  const trendsByDate = new Map(input.trends.map((trend) => [trend.date, trend]));

  return WEEKDAY_LABELS.map((weekday, index) => {
    const dateKey = addDays(input.weekStartKey, index);
    const date = parseDateKey(dateKey);
    const trend = trendsByDate.get(dateKey);

    return {
      dateKey,
      weekday,
      dayNumber: date.getDate(),
      calories: trend?.calories ?? 0,
      mealCount: trend?.mealCount ?? 0,
      status: classifyStatus(trend, input.targets),
      isSelected: dateKey === input.selectedDateKey,
      isToday: dateKey === input.todayKey,
      isFuture: dateKey > input.todayKey,
    };
  });
}

export function selectSameWeekdayOrClosestAvailable(input: {
  nextWeekStartKey: string;
  previousSelectedDateKey: string;
  todayKey: string;
}): string {
  const previousSelectedDate = parseDateKey(input.previousSelectedDateKey);
  const weekdayOffset = dayOffsetFromMonday(previousSelectedDate);
  const sameWeekday = addDays(input.nextWeekStartKey, weekdayOffset);

  if (sameWeekday <= input.todayKey) {
    return sameWeekday;
  }

  const weekStart = input.nextWeekStartKey;
  const weekEnd = addDays(input.nextWeekStartKey, 6);
  if (input.todayKey >= weekStart && input.todayKey <= weekEnd) {
    return input.todayKey;
  }

  return weekStart > input.todayKey ? input.todayKey : weekEnd;
}
