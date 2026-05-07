import { and, asc, eq, gte, inArray, isNull, lt } from "drizzle-orm";
import type { AppDatabase } from "../db/client.js";
import {
  mealRevisionItems,
  mealRevisions,
  mealTransactions,
} from "../db/schema.js";
import { getLocalDayBounds } from "../lib/time.js";
import { makeAssetRef } from "./assets.js";
import { projectMealDisplay } from "./meal-display.js";

export interface MealHistoryEntry {
  id: string;
  foodName: string;
  itemCount: number;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  imagePath: string | null;
  loggedAt: string;
}

export function createMealHistoryService(db: AppDatabase) {
  return {
    async getMealsByDate(deviceId: string, date: Date): Promise<MealHistoryEntry[]> {
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
      const itemsByRevisionId = new Map<
        string,
        Array<{
          foodName: string;
          calories: number;
          protein: number;
          carbs: number;
          fat: number;
        }>
      >();

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
        const display = projectMealDisplay(revisionItems);

        return {
          id: header.id,
          foodName: display.foodName,
          itemCount: display.itemCount,
          calories: revisionItems.reduce((sum, item) => sum + item.calories, 0),
          protein: revisionItems.reduce((sum, item) => sum + item.protein, 0),
          carbs: revisionItems.reduce((sum, item) => sum + item.carbs, 0),
          fat: revisionItems.reduce((sum, item) => sum + item.fat, 0),
          imagePath: revision?.imageAssetId ? makeAssetRef(revision.imageAssetId) : null,
          loggedAt: header.loggedAt,
        };
      });
    },
  };
}
