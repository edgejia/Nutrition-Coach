// server/services/food-logging.ts
import { eq, and, gte, lt } from "drizzle-orm";
import { meals } from "../db/schema.js";
import type { AppDatabase } from "../db/client.js";
import { getLocalDayBounds } from "../lib/time.js";

export interface FoodData {
  foodName: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  imagePath?: string;
  loggedAt?: string;
}

export function createFoodLoggingService(db: AppDatabase) {
  return {
    async logFood(deviceId: string, food: FoodData) {
      const id = crypto.randomUUID();
      const loggedAt = food.loggedAt ?? new Date().toISOString();
      const row = {
        id,
        deviceId,
        foodName: food.foodName,
        calories: food.calories,
        protein: food.protein,
        carbs: food.carbs,
        fat: food.fat,
        imagePath: food.imagePath ?? null,
        loggedAt,
      };
      await db.insert(meals).values(row);
      return row;
    },

    async getMealsByDate(deviceId: string, date: Date) {
      const { startIso, endIso } = getLocalDayBounds(date);
      return db
        .select()
        .from(meals)
        .where(
          and(
            eq(meals.deviceId, deviceId),
            gte(meals.loggedAt, startIso),
            lt(meals.loggedAt, endIso)
          )
        );
    },
  };
}
