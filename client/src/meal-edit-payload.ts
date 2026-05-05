import type { LoggedMealReceipt, MealEditPayload, MealEntry } from "./types.js";

export function buildHistoryMealEditPayload(meal: MealEntry, dateKey: string): MealEditPayload {
  return {
    mealId: meal.id,
    dateKey,
    foodName: meal.foodName,
    calories: meal.calories,
    protein: meal.protein,
    carbs: meal.carbs,
    fat: meal.fat,
    imageAssetId: meal.imageAssetId ?? null,
    imageUrl: meal.imageUrl ?? null,
    loggedAt: meal.loggedAt,
  };
}

export function buildReceiptMealEditPayload(loggedMeal: LoggedMealReceipt | undefined): MealEditPayload | null {
  if (
    !loggedMeal ||
    !loggedMeal.mealId ||
    !loggedMeal.dateKey ||
    loggedMeal.foodName.trim().length === 0 ||
    !Number.isFinite(loggedMeal.calories) ||
    !Number.isFinite(loggedMeal.protein) ||
    !Number.isFinite(loggedMeal.carbs) ||
    !Number.isFinite(loggedMeal.fat)
  ) {
    return null;
  }

  return {
    mealId: loggedMeal.mealId,
    dateKey: loggedMeal.dateKey,
    foodName: loggedMeal.foodName,
    calories: loggedMeal.calories,
    protein: loggedMeal.protein,
    carbs: loggedMeal.carbs,
    fat: loggedMeal.fat,
    imageAssetId: loggedMeal.imageAssetId ?? null,
    imageUrl: loggedMeal.imageUrl ?? null,
    loggedAt: loggedMeal.loggedAt,
  };
}
