// server/services/summary.ts
import { eq, and, gte, lt, sql } from "drizzle-orm";
import { meals } from "../db/schema.js";
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
          totalCalories: sql<number>`coalesce(sum(${meals.calories}), 0)`,
          totalProtein: sql<number>`coalesce(sum(${meals.protein}), 0)`,
          totalCarbs: sql<number>`coalesce(sum(${meals.carbs}), 0)`,
          totalFat: sql<number>`coalesce(sum(${meals.fat}), 0)`,
          mealCount: sql<number>`count(*)`,
        })
        .from(meals)
        .where(
          and(
            eq(meals.deviceId, deviceId),
            gte(meals.loggedAt, startIso),
            lt(meals.loggedAt, endIso)
          )
        );
      return { ...result[0], date: dateKey };
    },
  };
}
