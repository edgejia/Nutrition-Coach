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
  });
});
