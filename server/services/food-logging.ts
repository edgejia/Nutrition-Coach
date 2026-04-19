// server/services/food-logging.ts
import { and, asc, eq, gte, inArray, isNull, lt } from "drizzle-orm";
import type { AppDatabase } from "../db/client.js";
import {
  mealRevisionItems,
  mealRevisions,
  mealTransactions,
} from "../db/schema.js";
import { getLocalDayBounds } from "../lib/time.js";
import {
  createMealTransactionsService,
  type CreateMealTransactionInput,
  type MealTransactionItemInput,
} from "./meal-transactions.js";
import { makeAssetRef } from "./assets.js";

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
      const { startIso, endIso } = getLocalDayBounds(date);
      const headers = await db
        .select({
          id: mealTransactions.id,
          loggedAt: mealTransactions.loggedAt,
          currentRevisionId: mealTransactions.currentRevisionId,
        })
        .from(mealTransactions)
        .where(
          and(
            eq(mealTransactions.deviceId, deviceId),
            isNull(mealTransactions.deletedAt),
            gte(mealTransactions.loggedAt, startIso),
            lt(mealTransactions.loggedAt, endIso),
          ),
        )
        .orderBy(asc(mealTransactions.loggedAt));

      if (headers.length === 0) {
        return [];
      }

      const revisionIds = headers.map((header) => header.currentRevisionId);
      const revisions = await db
        .select()
        .from(mealRevisions)
        .where(inArray(mealRevisions.id, revisionIds));
      const items = await db
        .select()
        .from(mealRevisionItems)
        .where(inArray(mealRevisionItems.revisionId, revisionIds))
        .orderBy(asc(mealRevisionItems.position));

      const revisionById = new Map(revisions.map((revision) => [revision.id, revision]));
      const itemsByRevisionId = new Map<string, MealTransactionItemInput[]>();

      for (const item of items) {
        const revisionItems = itemsByRevisionId.get(item.revisionId) ?? [];
        revisionItems.push({
          foodName: item.foodName,
          calories: item.calories,
          protein: item.protein,
          carbs: item.carbs,
          fat: item.fat,
        });
        itemsByRevisionId.set(item.revisionId, revisionItems);
      }

      return headers.map((header) => {
        const revision = revisionById.get(header.currentRevisionId);
        const revisionItems = itemsByRevisionId.get(header.currentRevisionId) ?? [];
        const imagePath = revision?.imageAssetId ? makeAssetRef(revision.imageAssetId) : null;

        return projectCompatibilityEntry(
          deviceId,
          header.id,
          header.loggedAt,
          imagePath,
          revisionItems,
        );
      });
    },

    async deleteMeal(deviceId: string, mealId: string) {
      return mealTransactionsService.softDeleteTransaction(deviceId, mealId);
    },
  };
}
