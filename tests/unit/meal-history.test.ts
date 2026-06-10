process.env.TZ = "Asia/Taipei";

import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { createDb } from "../../server/db/client.js";
import { createDeviceService } from "../../server/services/device.js";
import { createFoodLoggingService } from "../../server/services/food-logging.js";
import { createMealHistoryService } from "../../server/services/meal-history.js";

describe("MealHistoryService", () => {
  let historyService: ReturnType<typeof createMealHistoryService>;
  let foodService: ReturnType<typeof createFoodLoggingService>;
  let deviceId: string;

  beforeEach(async () => {
    const db = createDb(":memory:");
    const deviceService = createDeviceService(db);
    historyService = createMealHistoryService(db);
    foodService = createFoodLoggingService(db);
    deviceId = (await deviceService.createDevice("fat_loss")).deviceId;
  });

  it("returns active single-item compatibility rows with the same totals as the old flat service", async () => {
    const first = await foodService.logGroupedMeal(deviceId, {
      loggedAt: "2026-03-24T23:30:00.000Z",
      items: [
        { foodName: "蘋果", calories: 95, protein: 0.5, carbs: 25, fat: 0.3 },
      ],
    });
    const second = await foodService.logGroupedMeal(deviceId, {
      loggedAt: "2026-03-25T07:30:00.000Z",
      items: [
        { foodName: "雞胸肉", calories: 165, protein: 31, carbs: 0, fat: 3.6 },
      ],
    });

    const meals = await historyService.getMealsByDate(deviceId, new Date("2026-03-25T12:00:00+08:00"));

    assert.deepEqual(
      meals.map((meal) => ({
        id: meal.id,
        foodName: meal.foodName,
        itemCount: meal.itemCount,
        calories: meal.calories,
        protein: meal.protein,
        carbs: meal.carbs,
        fat: meal.fat,
        loggedAt: meal.loggedAt,
      })),
      [
        {
          id: first.id,
          foodName: "蘋果",
          itemCount: 1,
          calories: 95,
          protein: 0.5,
          carbs: 25,
          fat: 0.3,
          loggedAt: "2026-03-24T23:30:00.000Z",
        },
        {
          id: second.id,
          foodName: "雞胸肉",
          itemCount: 1,
          calories: 165,
          protein: 31,
          carbs: 0,
          fat: 3.6,
          loggedAt: "2026-03-25T07:30:00.000Z",
        },
      ],
    );
  });

  it("projects a multi-item transaction into one ordered compatibility row", async () => {
    await foodService.logGroupedMeal(deviceId, {
      loggedAt: "2026-03-25T01:00:00.000Z",
      items: [
        { foodName: "黑咖啡", calories: 5, protein: 0, carbs: 1, fat: 0 },
      ],
    });
    const grouped = await foodService.logGroupedMeal(deviceId, {
      loggedAt: "2026-03-25T05:00:00.000Z",
      items: [
        {
          foodName: "蛋餅",
          calories: 320,
          protein: 12,
          carbs: 30,
          fat: 16,
        },
        {
          foodName: "豆漿",
          calories: 180,
          protein: 12,
          carbs: 14,
          fat: 8,
        },
        {
          foodName: "香蕉",
          calories: 90,
          protein: 1,
          carbs: 23,
          fat: 0.3,
        },
      ],
    });

    const meals = await historyService.getMealsByDate(deviceId, new Date("2026-03-25T12:00:00+08:00"));

    assert.equal(meals.length, 2);
    assert.equal(meals[0]!.foodName, "黑咖啡");
    assert.deepEqual(meals[1], {
      id: grouped.id,
      mealRevisionId: grouped.mealRevisionId,
      foodName: "蛋餅、豆漿、香蕉",
      itemCount: 3,
      calories: 590,
      protein: 25,
      carbs: 67,
      fat: 24.3,
      imagePath: null,
      loggedAt: "2026-03-25T05:00:00.000Z",
      mealPeriod: null,
      items: [
        {
          name: "蛋餅",
          position: 0,
          calories: 320,
          protein: 12,
          carbs: 30,
          fat: 16,
        },
        {
          name: "豆漿",
          position: 1,
          calories: 180,
          protein: 12,
          carbs: 14,
          fat: 8,
        },
        {
          name: "香蕉",
          position: 2,
          calories: 90,
          protein: 1,
          carbs: 23,
          fat: 0.3,
        },
      ],
    });
    assert.equal("currentRevisionId" in meals[1]!, false);
  });

  it("hides soft-deleted transactions from active history", async () => {
    const breakfast = await foodService.logGroupedMeal(deviceId, {
      loggedAt: "2026-03-25T02:00:00.000Z",
      items: [
        { foodName: "早餐", calories: 400, protein: 20, carbs: 40, fat: 12 },
      ],
    });
    await foodService.logGroupedMeal(deviceId, {
      loggedAt: "2026-03-25T05:30:00.000Z",
      items: [
        { foodName: "午餐", calories: 650, protein: 35, carbs: 55, fat: 28 },
      ],
    });

    await foodService.deleteMeal(deviceId, breakfast.id, breakfast.mealRevisionId);

    const meals = await historyService.getMealsByDate(deviceId, new Date("2026-03-25T12:00:00+08:00"));

    assert.deepEqual(meals.map((meal) => meal.foodName), ["午餐"]);
  });
});
