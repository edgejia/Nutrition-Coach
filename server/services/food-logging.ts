// server/services/food-logging.ts
import type { AppDatabase } from "../db/client.js";
import {
  createMealTransactionsService,
  type CreateMealTransactionInput,
  type MealTransactionItemInput,
} from "./meal-transactions.js";
import { createMealHistoryService } from "./meal-history.js";

export interface FoodData {
  foodName: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  imagePath?: string | null;
  loggedAt?: string;
}

export interface MealCompatibilityEntry {
  id: string;
  deviceId: string;
  foodName: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  imagePath: string | null;
  loggedAt: string;
}

export interface GroupedMealData extends CreateMealTransactionInput {}

export function createFoodLoggingService(db: AppDatabase) {
  const mealTransactionsService = createMealTransactionsService(db);
  const mealHistoryService = createMealHistoryService(db);

  function buildGroupedFoodName(items: MealTransactionItemInput[]) {
    if (items.length === 1) {
      return items[0]!.foodName;
    }

    if (items.length === 2) {
      return `${items[0]!.foodName}、${items[1]!.foodName}`;
    }

    return `${items[0]!.foodName}、${items[1]!.foodName} 等${items.length}項`;
  }

  function projectCompatibilityEntry(
    deviceId: string,
    transactionId: string,
    loggedAt: string,
    imagePath: string | null | undefined,
    items: MealTransactionItemInput[],
  ): MealCompatibilityEntry {
    return {
      id: transactionId,
      deviceId,
      foodName: buildGroupedFoodName(items),
      calories: items.reduce((sum, item) => sum + item.calories, 0),
      protein: items.reduce((sum, item) => sum + item.protein, 0),
      carbs: items.reduce((sum, item) => sum + item.carbs, 0),
      fat: items.reduce((sum, item) => sum + item.fat, 0),
      imagePath: imagePath ?? null,
      loggedAt,
    };
  }

  return {
    async logFood(deviceId: string, food: FoodData) {
      const created = await mealTransactionsService.createTransaction(deviceId, {
        loggedAt: food.loggedAt,
        imagePath: food.imagePath ?? null,
        items: [
          {
            foodName: food.foodName,
            calories: food.calories,
            protein: food.protein,
            carbs: food.carbs,
            fat: food.fat,
          },
        ],
      });

      return projectCompatibilityEntry(
        deviceId,
        created.transactionId,
        created.loggedAt,
        created.imagePath,
        created.items,
      );
    },

    async logGroupedMeal(deviceId: string, input: GroupedMealData) {
      const created = await mealTransactionsService.createTransaction(deviceId, input);
      return projectCompatibilityEntry(
        deviceId,
        created.transactionId,
        created.loggedAt,
        created.imagePath,
        created.items,
      );
    },

    async getMealsByDate(deviceId: string, date: Date) {
      const meals = await mealHistoryService.getMealsByDate(deviceId, date);
      return meals.map((meal) => ({
        ...meal,
        deviceId,
      }));
    },

    async deleteMeal(deviceId: string, mealId: string) {
      return mealTransactionsService.softDeleteTransaction(deviceId, mealId);
    },
  };
}
