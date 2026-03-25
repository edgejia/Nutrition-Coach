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

  beforeEach(async () => {
    const db = createDb(":memory:");
    const deviceService = createDeviceService(db);
    foodService = createFoodLoggingService(db);
    const result = await deviceService.createDevice("fat_loss");
    deviceId = result.deviceId;
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
      foodName: "蘋果",
      calories: 95,
      protein: 0.5,
      carbs: 25,
      fat: 0.3,
      loggedAt: "2026-03-24T16:30:00.000Z",
    });
    await foodService.logFood(deviceId, {
      foodName: "雞胸肉",
      calories: 165,
      protein: 31,
      carbs: 0,
      fat: 3.6,
      loggedAt: "2026-03-25T15:00:00.000Z",
    });
    await foodService.logFood(deviceId, {
      foodName: "隔天早餐",
      calories: 400,
      protein: 20,
      carbs: 30,
      fat: 15,
      loggedAt: "2026-03-25T16:30:00.000Z",
    });
    const meals = await foodService.getMealsByDate(deviceId, new Date("2026-03-25T12:00:00+08:00"));
    assert.equal(meals.length, 2);
  });
});
