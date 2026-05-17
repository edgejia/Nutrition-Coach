// tests/unit/summary.test.ts
process.env.TZ = "Asia/Taipei";

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createDb } from "../../server/db/client.js";
import { createDeviceService } from "../../server/services/device.js";
import { createFoodLoggingService } from "../../server/services/food-logging.js";
import { createSummaryService } from "../../server/services/summary.js";

describe("SummaryService", () => {
  let summaryService: ReturnType<typeof createSummaryService>;
  let foodService: ReturnType<typeof createFoodLoggingService>;
  let deviceId: string;

  beforeEach(async () => {
    const db = createDb(":memory:");
    const deviceService = createDeviceService(db);
    foodService = createFoodLoggingService(db);
    summaryService = createSummaryService(db);
    const result = await deviceService.createDevice("fat_loss");
    deviceId = result.deviceId;
  });

  it("returns zeros when no meals logged", async () => {
    const summary = await summaryService.getDailySummary(deviceId, new Date("2026-03-25T12:00:00+08:00"));
    assert.equal(summary.totalCalories, 0);
    assert.equal(summary.totalProtein, 0);
    assert.equal(summary.totalCarbs, 0);
    assert.equal(summary.totalFat, 0);
    assert.equal(summary.mealCount, 0);
    assert.equal(summary.date, "2026-03-25");
  });

  it("sums nutrients from multiple meals", async () => {
    await foodService.logFood(deviceId, { foodName: "蘋果", calories: 95, protein: 0.5, carbs: 25, fat: 0.3, loggedAt: "2026-03-24T16:30:00.000Z" });
    await foodService.logFood(deviceId, { foodName: "雞胸肉", calories: 165, protein: 31, carbs: 0, fat: 3.6, loggedAt: "2026-03-25T15:00:00.000Z" });
    await foodService.logFood(deviceId, { foodName: "隔天早餐", calories: 400, protein: 20, carbs: 30, fat: 15, loggedAt: "2026-03-25T16:30:00.000Z" });
    const summary = await summaryService.getDailySummary(deviceId, new Date("2026-03-25T12:00:00+08:00"));
    assert.ok(Math.abs(summary.totalCalories - 260) < 0.01);
    assert.ok(Math.abs(summary.totalProtein - 31.5) < 0.01);
    assert.ok(Math.abs(summary.totalCarbs - 25) < 0.01);
    assert.ok(Math.abs(summary.totalFat - 3.9) < 0.01);
    assert.equal(summary.date, "2026-03-25");
  });

  it("counts meals in the daily summary", async () => {
    await foodService.logFood(deviceId, {
      foodName: "蘋果",
      calories: 95,
      protein: 0.5,
      carbs: 25,
      fat: 0.3,
      loggedAt: "2026-03-25T04:30:00.000Z",
    });

    const summary = await summaryService.getDailySummary(deviceId, new Date("2026-03-25T12:00:00+08:00"));

    assert.equal(summary.mealCount, 1);
    assert.equal(summary.date, "2026-03-25");
  });

  it("excludes deleted transactions from the daily summary", async () => {
    const deletedMeal = await foodService.logFood(deviceId, {
      foodName: "早餐",
      calories: 420,
      protein: 18,
      carbs: 44,
      fat: 16,
      loggedAt: "2026-03-25T02:30:00.000Z",
    });
    await foodService.logGroupedMeal(deviceId, {
      loggedAt: "2026-03-25T06:00:00.000Z",
      items: [
        {
          foodName: "雞腿便當",
          calories: 720,
          protein: 32,
          carbs: 68,
          fat: 28,
        },
        {
          foodName: "無糖茶",
          calories: 0,
          protein: 0,
          carbs: 0,
          fat: 0,
        },
      ],
    });

    await foodService.deleteMeal(deviceId, deletedMeal.id, deletedMeal.mealRevisionId);

    const summary = await summaryService.getDailySummary(deviceId, new Date("2026-03-25T12:00:00+08:00"));

    assert.equal(summary.mealCount, 1);
    assert.ok(Math.abs(summary.totalCalories - 720) < 0.01);
    assert.ok(Math.abs(summary.totalProtein - 32) < 0.01);
    assert.ok(Math.abs(summary.totalCarbs - 68) < 0.01);
    assert.ok(Math.abs(summary.totalFat - 28) < 0.01);
  });

  it("isolates meals logged across the Asia/Taipei midnight boundary (D-17)", async () => {
    // TPE 23:59 on 2026-03-25 (pre-midnight, belongs to 2026-03-25 local day)
    await foodService.logFood(deviceId, {
      foodName: "宵夜",
      calories: 200,
      protein: 10,
      carbs: 20,
      fat: 8,
      loggedAt: "2026-03-25T15:59:00.000Z",
    });
    // TPE 00:01 on 2026-03-26 (post-midnight, belongs to 2026-03-26 local day)
    await foodService.logFood(deviceId, {
      foodName: "早餐",
      calories: 350,
      protein: 15,
      carbs: 45,
      fat: 10,
      loggedAt: "2026-03-25T16:01:00.000Z",
    });

    const march25 = await summaryService.getDailySummary(deviceId, new Date("2026-03-25T12:00:00+08:00"));
    const march26 = await summaryService.getDailySummary(deviceId, new Date("2026-03-26T12:00:00+08:00"));

    // March 25 summary should only contain the pre-midnight meal
    assert.equal(march25.mealCount, 1);
    assert.equal(march25.date, "2026-03-25");
    assert.ok(Math.abs(march25.totalCalories - 200) < 0.01);

    // March 26 summary should only contain the post-midnight meal
    assert.equal(march26.mealCount, 1);
    assert.equal(march26.date, "2026-03-26");
    assert.ok(Math.abs(march26.totalCalories - 350) < 0.01);
  });
});
