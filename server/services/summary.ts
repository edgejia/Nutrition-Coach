// server/services/summary.ts
import { and, eq, gte, isNull, lt, sql } from "drizzle-orm";
import {
  mealRevisionItems,
  mealRevisions,
  mealTransactions,
} from "../db/schema.js";
import type { AppDatabase } from "../db/client.js";
import { getLocalDayBounds } from "../lib/time.js";

export interface DailySummary {
  totalCalories: number;
  totalProtein: number;
  totalCarbs: number;
  totalFat: number;
  mealCount: number;
  date: string;
}

export function createSummaryService(db: AppDatabase) {
  return {
    async getDailySummary(deviceId: string, date: Date): Promise<DailySummary> {
      const { dateKey, startIso, endIso } = getLocalDayBounds(date);
      const result = await db
        .select({
          totalCalories: sql<number>`coalesce(sum(${mealRevisionItems.calories}), 0)`,
          totalProtein: sql<number>`coalesce(sum(${mealRevisionItems.protein}), 0)`,
          totalCarbs: sql<number>`coalesce(sum(${mealRevisionItems.carbs}), 0)`,
          totalFat: sql<number>`coalesce(sum(${mealRevisionItems.fat}), 0)`,
          mealCount: sql<number>`count(distinct ${mealTransactions.id})`,
        })
        .from(mealTransactions)
        .innerJoin(
          mealRevisions,
          eq(mealTransactions.currentRevisionId, mealRevisions.id),
        )
        .innerJoin(
          mealRevisionItems,
          eq(mealRevisionItems.revisionId, mealRevisions.id),
        )
        .where(
          and(
            eq(mealTransactions.deviceId, deviceId),
            isNull(mealTransactions.deletedAt),
            gte(mealTransactions.loggedAt, startIso),
            lt(mealTransactions.loggedAt, endIso),
          ),
        );
      return { ...result[0], date: dateKey };
    },
  };
}
