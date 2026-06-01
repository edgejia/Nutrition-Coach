import { isRealDateKey } from "./lib/history-week.js";
import type {
  DailySummary,
  DailySummarySSEPayload,
  DailySummarySSESource,
  DailyTargets,
  GoalsUpdatePayload,
  MealEntry,
  MealItemDetail,
  MealPeriod,
  SummaryOutcome,
} from "./types.js";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function isValidMealPeriod(value: unknown): value is MealPeriod {
  return value === "breakfast" || value === "lunch" || value === "dinner" || value === "late_night";
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isOptionalNullableString(value: unknown): value is string | null | undefined {
  return value === undefined || isNullableString(value);
}

function isDailySummarySSESource(value: unknown): value is DailySummarySSESource {
  return value === "initial" || value === "meal_mutation";
}

function isMealItemDetailDto(value: unknown): value is MealItemDetail {
  return (
    isRecord(value) &&
    typeof value.name === "string" &&
    value.name.trim().length > 0 &&
    isFiniteNumber(value.position) &&
    isFiniteNumber(value.calories) &&
    isFiniteNumber(value.protein) &&
    isFiniteNumber(value.carbs) &&
    isFiniteNumber(value.fat)
  );
}

export function isDailyTargetsDto(value: unknown): value is DailyTargets {
  return (
    isRecord(value) &&
    isFiniteNumber(value.calories) &&
    isFiniteNumber(value.protein) &&
    isFiniteNumber(value.carbs) &&
    isFiniteNumber(value.fat)
  );
}

export function isDailySummaryDto(value: unknown): value is DailySummary {
  return (
    isRecord(value) &&
    typeof value.date === "string" &&
    isRealDateKey(value.date) &&
    isFiniteNumber(value.totalCalories) &&
    isFiniteNumber(value.totalProtein) &&
    isFiniteNumber(value.totalCarbs) &&
    isFiniteNumber(value.totalFat) &&
    isFiniteNumber(value.mealCount)
  );
}

export function isSummaryOutcomeDto(value: unknown): value is SummaryOutcome {
  if (!isRecord(value) || typeof value.status !== "string") {
    return false;
  }

  if (value.status === "fresh") {
    return isDailySummaryDto(value.dailySummary) && value.reason === undefined;
  }

  if (value.status === "recovered") {
    return value.reason === "recompute_failed" && isDailySummaryDto(value.dailySummary);
  }

  if (value.status === "unavailable") {
    return value.reason === "recompute_failed" && value.dailySummary === undefined;
  }

  return false;
}

export function isAuthoritativeMealEntryDto(value: unknown): value is MealEntry {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === "string" &&
    value.id.trim().length > 0 &&
    (value.mealRevisionId === undefined || typeof value.mealRevisionId === "string") &&
    typeof value.foodName === "string" &&
    value.foodName.trim().length > 0 &&
    isFiniteNumber(value.calories) &&
    isFiniteNumber(value.protein) &&
    isFiniteNumber(value.carbs) &&
    isFiniteNumber(value.fat) &&
    isFiniteNumber(value.itemCount) &&
    value.itemCount > 0 &&
    (value.items === undefined ||
      (Array.isArray(value.items) && value.items.every(isMealItemDetailDto))) &&
    isOptionalNullableString(value.imageAssetId) &&
    isOptionalNullableString(value.imageUrl) &&
    typeof value.loggedAt === "string" &&
    value.loggedAt.trim().length > 0 &&
    (value.mealPeriod === undefined || isValidMealPeriod(value.mealPeriod))
  );
}

export function isAuthoritativeMealEntryArray(value: unknown): value is MealEntry[] {
  return Array.isArray(value) && value.every(isAuthoritativeMealEntryDto);
}

export function isDailySummarySSEPayloadDto(value: unknown): value is DailySummarySSEPayload {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isDailySummaryDto(value.summary) &&
    typeof value.affectedDate === "string" &&
    isRealDateKey(value.affectedDate) &&
    isDailySummarySSESource(value.source) &&
    value.summary.date === value.affectedDate
  );
}

export function isGoalsUpdatePayloadDto(value: unknown): value is GoalsUpdatePayload {
  return isRecord(value) && isDailyTargetsDto(value.targets);
}
