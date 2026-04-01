// tests/unit/food-logging.test.ts
process.env.TZ = "Asia/Taipei";

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createDb } from "../../server/db/client.js";
import { createDeviceService } from "../../server/services/device.js";
import { createFoodLoggingService } from "../../server/services/food-logging.js";

describe("FoodLoggingService", () => {
  let foodService: ReturnType<typeof createFoodLoggingService>;
  let deviceId: string;
  let foreignDeviceId: string;

  beforeEach(async () => {
    const db = createDb(":memory:");
    const deviceService = createDeviceService(db);
    foodService = createFoodLoggingService(db);
    const result = await deviceService.createDevice("fat_loss");
    const foreignResult = await deviceService.createDevice("muscle_gain");
    deviceId = result.deviceId;
    foreignDeviceId = foreignResult.deviceId;
  });

  it("logs a food entry and returns it", async () => {
    const meal = await foodService.logFood(deviceId, {
      foodName: "蘋果",
      calories: 95,
      protein: 0.5,
      carbs: 25,
      fat: 0.3,
      imagePath: "server/uploads/apple.png",
      loggedAt: "2026-03-25T04:30:00.000Z",
    });
    assert.ok(meal.id);
    assert.equal(meal.foodName, "蘋果");
    assert.equal(meal.calories, 95);
    assert.equal(meal.deviceId, deviceId);
    assert.equal(meal.imagePath, "server/uploads/apple.png");
    assert.equal(meal.loggedAt, "2026-03-25T04:30:00.000Z");
  });

  it("retrieves meals by date", async () => {
    await foodService.logFood(deviceId, {
      foodName: "隔天早餐",
      calories: 400,
      protein: 20,
      carbs: 30,
      fat: 15,
      loggedAt: "2026-03-25T07:30:00.000Z",
    });
    await foodService.logFood(deviceId, {
      foodName: "蘋果",
      calories: 95,
      protein: 0.5,
      carbs: 25,
      fat: 0.3,
      loggedAt: "2026-03-24T23:30:00.000Z",
    });
    const meals = await foodService.getMealsByDate(deviceId, new Date("2026-03-25T12:00:00+08:00"));
    assert.equal(meals.length, 2);
    assert.equal(meals[0].foodName, "蘋果");
    assert.equal(meals[1].foodName, "隔天早餐");
  });

  it("rejects foreign ownership before deleting the owner's meal", async () => {
    const meal = await foodService.logFood(deviceId, {
      foodName: "蘋果",
      calories: 95,
      protein: 0.5,
      carbs: 25,
      fat: 0.3,
      loggedAt: "2026-03-25T04:30:00.000Z",
    });

    await assert.rejects(
      () => foodService.deleteMeal(foreignDeviceId, meal.id),
      (error: unknown) => {
        assert.equal((error as Error).message, "MEAL_NOT_FOUND");
        return true;
      }
    );

    await foodService.deleteMeal(deviceId, meal.id);

    const meals = await foodService.getMealsByDate(deviceId, new Date("2026-03-25T12:00:00+08:00"));
    assert.equal(meals.length, 0);
  });

  it("rejects deleting the same meal concurrently", async () => {
    const meal = await foodService.logFood(deviceId, {
      foodName: "蘋果",
      calories: 95,
      protein: 0.5,
      carbs: 25,
      fat: 0.3,
      loggedAt: "2026-03-25T04:30:00.000Z",
    });

    const results = await Promise.allSettled([
      foodService.deleteMeal(deviceId, meal.id),
      foodService.deleteMeal(deviceId, meal.id),
    ]);

    assert.equal(results.filter((result) => result.status === "rejected").length, 1);
    const rejection = results.find((result) => result.status === "rejected");
    assert.ok(rejection);
    if (rejection.status === "rejected") {
      assert.equal((rejection.reason as Error).message, "MEAL_NOT_FOUND");
    }
  });

  it("rejects deleting a nonexistent meal", async () => {
    await assert.rejects(
      () => foodService.deleteMeal(deviceId, "missing-meal-id"),
      (error: unknown) => {
        assert.equal((error as Error).message, "MEAL_NOT_FOUND");
        return true;
      }
    );
  });
});
