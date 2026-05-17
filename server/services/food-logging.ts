// server/services/food-logging.ts
import { and, eq, isNull } from "drizzle-orm";
import type { AppDatabase } from "../db/client.js";
import {
  mealRevisionItems,
  mealTransactions,
} from "../db/schema.js";
import {
  createMealTransactionsService,
  type CreateMealTransactionInput,
  type MealTransactionItemInput,
} from "./meal-transactions.js";
import { createMealHistoryService } from "./meal-history.js";
import { projectMealDisplay } from "./meal-display.js";

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
  mealRevisionId: string;
  deviceId: string;
  foodName: string;
  itemCount: number;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  imagePath: string | null;
  loggedAt: string;
}

export interface GroupedMealData extends CreateMealTransactionInput {}

export interface GroupedMealUpdateData extends GroupedMealData {
  expectedMealRevisionId?: string | null;
}

export function createFoodLoggingService(db: AppDatabase) {
  const mealTransactionsService = createMealTransactionsService(db);
  const mealHistoryService = createMealHistoryService(db);

  function projectCompatibilityEntry(
    deviceId: string,
    transactionId: string,
    revisionId: string,
    loggedAt: string,
    imagePath: string | null | undefined,
    items: MealTransactionItemInput[],
  ): MealCompatibilityEntry {
    const display = projectMealDisplay(items);

    return {
      id: transactionId,
      mealRevisionId: revisionId,
      deviceId,
      foodName: display.foodName,
      itemCount: display.itemCount,
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
        created.revisionId,
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
        created.revisionId,
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

    async deleteMeal(deviceId: string, mealId: string, expectedMealRevisionId?: string | null) {
      return mealTransactionsService.softDeleteTransaction(deviceId, mealId, expectedMealRevisionId);
    },

    async assertExpectedMealRevision(deviceId: string, mealId: string, expectedMealRevisionId?: string | null) {
      return mealTransactionsService.assertExpectedMealRevision(deviceId, mealId, expectedMealRevisionId);
    },

    async getMealItemCount(deviceId: string, mealId: string): Promise<number | null> {
      const transaction = await db
        .select({ currentRevisionId: mealTransactions.currentRevisionId })
        .from(mealTransactions)
        .where(and(
          eq(mealTransactions.deviceId, deviceId),
          eq(mealTransactions.id, mealId),
          isNull(mealTransactions.deletedAt),
        ))
        .limit(1);

      const currentRevisionId = transaction[0]?.currentRevisionId;
      if (!currentRevisionId) {
        return null;
      }

      const items = await db
        .select({ position: mealRevisionItems.position })
        .from(mealRevisionItems)
        .where(eq(mealRevisionItems.revisionId, currentRevisionId));

      return items.length;
    },

    async updateMeal(deviceId: string, mealId: string, input: GroupedMealUpdateData) {
      const updated = await mealTransactionsService.updateTransaction(deviceId, mealId, input);
      return projectCompatibilityEntry(
        deviceId,
        updated.transactionId,
        updated.revisionId,
        updated.loggedAt,
        updated.imageAssetId ? `asset:${updated.imageAssetId}` : null,
        updated.items,
      );
    },
  };
}
