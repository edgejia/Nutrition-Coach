import type { LoggedMealReceipt, MealEditPayload, MealEntry, MealItemDetail, MealPeriod } from "./types.js";

function normalizeItemCount(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 1;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isValidMealPeriod(value: unknown): value is MealPeriod {
  return value === "breakfast" || value === "lunch" || value === "dinner" || value === "late_night";
}

function getRequiredString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function normalizeMealItems(value: unknown): MealItemDetail[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const items = value
    .map((item): MealItemDetail | null => {
      if (!isRecord(item)) {
        return null;
      }

      const name = typeof item.name === "string" ? item.name.trim() : "";
      const position = item.position;
      const calories = item.calories;
      const protein = item.protein;
      const carbs = item.carbs;
      const fat = item.fat;

      if (
        !name ||
        typeof position !== "number" ||
        !Number.isFinite(position) ||
        typeof calories !== "number" ||
        !Number.isFinite(calories) ||
        typeof protein !== "number" ||
        !Number.isFinite(protein) ||
        typeof carbs !== "number" ||
        !Number.isFinite(carbs) ||
        typeof fat !== "number" ||
        !Number.isFinite(fat)
      ) {
        return null;
      }

      return {
        name,
        position: Math.floor(position),
        calories,
        protein,
        carbs,
        fat,
      };
    })
    .filter((item): item is MealItemDetail => item !== null)
    .sort((a, b) => a.position - b.position);

  return items.length > 0 ? items : undefined;
}

export function buildHistoryMealEditPayload(meal: MealEntry, dateKey: string): MealEditPayload {
  const mealRevisionId = getRequiredString(meal.mealRevisionId);
  if (!mealRevisionId) {
    throw new Error("MEAL_REVISION_REQUIRED");
  }

  if (
    typeof meal.id !== "string" ||
    meal.id.trim().length === 0 ||
    typeof meal.foodName !== "string" ||
    meal.foodName.trim().length === 0 ||
    !isFiniteNumber(meal.calories) ||
    !isFiniteNumber(meal.protein) ||
    !isFiniteNumber(meal.carbs) ||
    !isFiniteNumber(meal.fat) ||
    !isFiniteNumber(meal.itemCount) ||
    meal.itemCount <= 0 ||
    typeof meal.loggedAt !== "string" ||
    meal.loggedAt.trim().length === 0
  ) {
    throw new Error("MEAL_AUTHORITY_REQUIRED");
  }

  const items = normalizeMealItems((meal as { items?: unknown }).items);
  const mealPeriod = isValidMealPeriod((meal as { mealPeriod?: unknown }).mealPeriod)
    ? meal.mealPeriod
    : undefined;

  return {
    mealId: meal.id,
    mealRevisionId: mealRevisionId,
    dateKey,
    foodName: meal.foodName,
    calories: meal.calories,
    protein: meal.protein,
    carbs: meal.carbs,
    fat: meal.fat,
    itemCount: normalizeItemCount(meal.itemCount),
    ...(items ? { items } : {}),
    imageAssetId: meal.imageAssetId ?? null,
    imageUrl: meal.imageUrl ?? null,
    loggedAt: meal.loggedAt,
    ...(mealPeriod ? { mealPeriod } : {}),
  };
}

export function buildMealEditPayloadIfComplete(meal: MealEntry, dateKey: string): MealEditPayload | null {
  try {
    return buildHistoryMealEditPayload(meal, dateKey);
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message === "MEAL_REVISION_REQUIRED" || error.message === "MEAL_AUTHORITY_REQUIRED")
    ) {
      return null;
    }
    throw error;
  }
}

export function buildReceiptMealEditPayload(loggedMeal: LoggedMealReceipt | undefined): MealEditPayload | null {
  if (loggedMeal?.receiptStatus === "deleted" || loggedMeal?.receiptStatus === "stale_revision") {
    return null;
  }

  const mealRevisionId = getRequiredString(loggedMeal?.mealRevisionId);
  if (
    !loggedMeal ||
    !loggedMeal.mealId ||
    !mealRevisionId ||
    !loggedMeal.dateKey ||
    loggedMeal.foodName.trim().length === 0 ||
    !Number.isFinite(loggedMeal.calories) ||
    !Number.isFinite(loggedMeal.protein) ||
    !Number.isFinite(loggedMeal.carbs) ||
    !Number.isFinite(loggedMeal.fat)
  ) {
    return null;
  }

  const items = normalizeMealItems((loggedMeal as { items?: unknown }).items);

  return {
    mealId: loggedMeal.mealId,
    mealRevisionId: mealRevisionId,
    dateKey: loggedMeal.dateKey,
    foodName: loggedMeal.foodName,
    calories: loggedMeal.calories,
    protein: loggedMeal.protein,
    carbs: loggedMeal.carbs,
    fat: loggedMeal.fat,
    itemCount: normalizeItemCount(loggedMeal.itemCount),
    ...(items ? { items } : {}),
    imageAssetId: loggedMeal.imageAssetId ?? null,
    imageUrl: loggedMeal.imageUrl ?? null,
    loggedAt: loggedMeal.loggedAt,
    ...(loggedMeal.mealPeriod ? { mealPeriod: loggedMeal.mealPeriod } : {}),
  };
}
