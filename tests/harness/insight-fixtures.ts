import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ScenarioAppServices } from "./app-fixture.js";

export type InsightFixtureName =
  | "weekly-basic"
  | "insufficient-data"
  | "prompt-injection"
  | "medical-boundary";

export interface InsightFixtureNutrition {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

export interface InsightFixtureMeal {
  name: string;
  loggedAt: string;
  nutrition: InsightFixtureNutrition;
}

export interface InsightFixture {
  name: InsightFixtureName;
  dateRange: { from: string; to: string };
  meals: InsightFixtureMeal[];
  safetyPrompt?: string;
  allowedInsightNumbers?: number[];
}

export interface InsightMetrics {
  from: string;
  to: string;
  completeness: "empty" | "sparse" | "complete";
  daily: Array<{ date: string; calories: number; protein: number; carbs: number; fat: number; mealCount: number }>;
  totals: { calories: number; protein: number; carbs: number; fat: number; mealCount: number };
  averages: { calories: number; protein: number; carbs: number; fat: number; mealsPerDay: number };
  mealNames: string[];
  allowedNumbers: number[];
}

const FIXTURE_NAMES = [
  "weekly-basic",
  "insufficient-data",
  "prompt-injection",
  "medical-boundary",
] as const satisfies readonly InsightFixtureName[];

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const FIXTURE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "insights");

function isFixtureName(value: string): value is InsightFixtureName {
  return (FIXTURE_NAMES as readonly string[]).includes(value);
}

function assertDateKey(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || !DATE_KEY_PATTERN.test(value)) {
    throw new Error(`Invalid insight fixture ${field}: expected YYYY-MM-DD`);
  }
}

function assertNumber(value: unknown, field: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Invalid insight fixture ${field}: expected numeric nutrition`);
  }
}

function assertNutrition(value: unknown, field: string): asserts value is InsightFixtureNutrition {
  if (value === null || typeof value !== "object") {
    throw new Error(`Invalid insight fixture ${field}: nutrition is required`);
  }
  const nutrition = value as Record<string, unknown>;
  for (const key of ["calories", "protein", "carbs", "fat"] as const) {
    assertNumber(nutrition[key], `${field}.${key}`);
  }
}

function validateFixture(value: unknown, expectedName: InsightFixtureName): InsightFixture {
  if (value === null || typeof value !== "object") {
    throw new Error(`Invalid insight fixture ${expectedName}: expected object`);
  }

  const raw = value as Record<string, unknown>;
  if (raw.name !== expectedName) {
    throw new Error(`Invalid insight fixture ${expectedName}: name mismatch`);
  }
  if (raw.dateRange === null || typeof raw.dateRange !== "object") {
    throw new Error(`Invalid insight fixture ${expectedName}: dateRange is required`);
  }

  const dateRange = raw.dateRange as Record<string, unknown>;
  assertDateKey(dateRange.from, "dateRange.from");
  assertDateKey(dateRange.to, "dateRange.to");

  if (!Array.isArray(raw.meals)) {
    throw new Error(`Invalid insight fixture ${expectedName}: meals must be an array`);
  }

  const meals = raw.meals.map((entry, index): InsightFixtureMeal => {
    if (entry === null || typeof entry !== "object") {
      throw new Error(`Invalid insight fixture ${expectedName}: meals[${index}] must be an object`);
    }
    const meal = entry as Record<string, unknown>;
    if (typeof meal.name !== "string" || meal.name.trim().length === 0) {
      throw new Error(`Invalid insight fixture ${expectedName}: meals[${index}].name must be non-empty`);
    }
    if (typeof meal.loggedAt !== "string" || Number.isNaN(Date.parse(meal.loggedAt))) {
      throw new Error(`Invalid insight fixture ${expectedName}: meals[${index}].loggedAt must be ISO time`);
    }
    assertNutrition(meal.nutrition, `meals[${index}].nutrition`);
    return {
      name: meal.name,
      loggedAt: meal.loggedAt,
      nutrition: meal.nutrition,
    };
  });

  const fixture: InsightFixture = {
    name: expectedName,
    dateRange: { from: dateRange.from, to: dateRange.to },
    meals,
  };
  if (typeof raw.safetyPrompt === "string") {
    fixture.safetyPrompt = raw.safetyPrompt;
  }
  if (Array.isArray(raw.allowedInsightNumbers)) {
    fixture.allowedInsightNumbers = raw.allowedInsightNumbers.map((value, index) => {
      assertNumber(value, `allowedInsightNumbers[${index}]`);
      return value;
    });
  }
  return fixture;
}

function dateKeys(from: string, to: string): string[] {
  const keys: string[] = [];
  const cursor = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${to}T00:00:00.000Z`);
  while (cursor.getTime() <= end.getTime()) {
    keys.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return keys;
}

function dateKeyFromLoggedAt(loggedAt: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(loggedAt));
}

function roundMetric(value: number): number {
  return Number.isInteger(value) ? value : Number(value.toFixed(1));
}

function pushAllowedNumber(values: Set<number>, value: number) {
  values.add(roundMetric(value));
  values.add(Math.round(value));
}

export function loadInsightFixture(name: InsightFixtureName): InsightFixture {
  if (!isFixtureName(name)) {
    throw new Error(`Unknown insight fixture: ${name}`);
  }
  const raw = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, `${name}.json`), "utf-8")) as unknown;
  return validateFixture(raw, name);
}

export async function seedInsightFixture(
  services: ScenarioAppServices,
  deviceId: string,
  fixture: InsightFixture,
): Promise<void> {
  for (const meal of fixture.meals) {
    await services.foodLoggingService.logFood(deviceId, {
      foodName: meal.name,
      loggedAt: meal.loggedAt,
      ...meal.nutrition,
    });
  }
}

export function buildInsightMetrics(fixture: InsightFixture): InsightMetrics {
  const daily = dateKeys(fixture.dateRange.from, fixture.dateRange.to).map((date) => ({
    date,
    calories: 0,
    protein: 0,
    carbs: 0,
    fat: 0,
    mealCount: 0,
  }));
  const byDate = new Map(daily.map((bucket) => [bucket.date, bucket]));

  for (const meal of fixture.meals) {
    const bucket = byDate.get(dateKeyFromLoggedAt(meal.loggedAt));
    if (!bucket) {
      continue;
    }
    bucket.calories += meal.nutrition.calories;
    bucket.protein += meal.nutrition.protein;
    bucket.carbs += meal.nutrition.carbs;
    bucket.fat += meal.nutrition.fat;
    bucket.mealCount += 1;
  }

  const totals = daily.reduce(
    (sum, bucket) => ({
      calories: sum.calories + bucket.calories,
      protein: sum.protein + bucket.protein,
      carbs: sum.carbs + bucket.carbs,
      fat: sum.fat + bucket.fat,
      mealCount: sum.mealCount + bucket.mealCount,
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0, mealCount: 0 },
  );
  const dayCount = daily.length;
  const averages = {
    calories: totals.calories / dayCount,
    protein: totals.protein / dayCount,
    carbs: totals.carbs / dayCount,
    fat: totals.fat / dayCount,
    mealsPerDay: totals.mealCount / dayCount,
  };
  const allowed = new Set<number>();
  for (const bucket of daily) {
    for (const value of [bucket.calories, bucket.protein, bucket.carbs, bucket.fat, bucket.mealCount]) {
      pushAllowedNumber(allowed, value);
    }
  }
  for (const value of [
    totals.calories,
    totals.protein,
    totals.carbs,
    totals.fat,
    totals.mealCount,
    averages.calories,
    averages.protein,
    averages.carbs,
    averages.fat,
    averages.mealsPerDay,
    ...(fixture.allowedInsightNumbers ?? []),
  ]) {
    pushAllowedNumber(allowed, value);
  }

  return {
    from: fixture.dateRange.from,
    to: fixture.dateRange.to,
    completeness: totals.mealCount === 0 ? "empty" : totals.mealCount < 3 ? "sparse" : "complete",
    daily,
    totals,
    averages,
    mealNames: fixture.meals.map((meal) => meal.name),
    allowedNumbers: [...allowed].sort((left, right) => left - right),
  };
}
