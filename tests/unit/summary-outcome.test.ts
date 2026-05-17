process.env.TZ = "Asia/Taipei";

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createDb } from "../../server/db/client.js";
import { createDeviceService } from "../../server/services/device.js";
import { createFoodLoggingService } from "../../server/services/food-logging.js";
import type { DailySummary } from "../../server/services/summary.js";
import {
  buildSummaryOutcomeAfterMealCommit,
  dailySummaryFromOutcome,
} from "../../server/services/summary-outcome.js";

function assertNoPublishFailed(outcome: { status: string; reason?: string }) {
  assert.notEqual(outcome.status, "publish_failed");
  assert.notEqual(outcome.reason, "publish_failed");
}

describe("summary outcome helper", () => {
  it("returns fresh when normal summary recompute succeeds", async () => {
    const dailySummary: DailySummary = {
      date: "2026-04-19",
      totalCalories: 320,
      totalProtein: 24,
      totalCarbs: 30,
      totalFat: 11,
      mealCount: 1,
    };

    const outcome = await buildSummaryOutcomeAfterMealCommit({
      deviceId: "device-1",
      affectedDate: "2026-04-19",
      summaryService: {
        async getDailySummary(deviceId, date) {
          assert.equal(deviceId, "device-1");
          assert.equal(date.toISOString(), "2026-04-19T04:00:00.000Z");
          return dailySummary;
        },
      },
      foodLoggingService: {
        async getMealsByDate() {
          throw new Error("recovery should not run");
        },
      },
    });

    assert.deepEqual(outcome, { status: "fresh", dailySummary });
    assert.equal(dailySummaryFromOutcome(outcome), dailySummary);
    assertNoPublishFailed(outcome);
  });

  it("returns recovered when recompute fails and persisted meals can rebuild the summary", async () => {
    const db = createDb(":memory:");
    const deviceService = createDeviceService(db);
    const foodLoggingService = createFoodLoggingService(db);
    const deviceId = (await deviceService.createDevice("fat_loss")).deviceId;

    await foodLoggingService.logFood(deviceId, {
      foodName: "meal one",
      calories: 240,
      protein: 20,
      carbs: 22,
      fat: 8,
      loggedAt: "2026-04-19T03:30:00.000Z",
    });
    await foodLoggingService.logFood(deviceId, {
      foodName: "meal two",
      calories: 160,
      protein: 10,
      carbs: 18,
      fat: 5,
      loggedAt: "2026-04-19T10:00:00.000Z",
    });

    const outcome = await buildSummaryOutcomeAfterMealCommit({
      deviceId,
      affectedDate: "2026-04-19",
      summaryService: {
        async getDailySummary() {
          throw new Error("summary recompute failed");
        },
      },
      foodLoggingService,
    });

    assert.equal(outcome.status, "recovered");
    assert.equal(outcome.reason, "recompute_failed");
    assert.deepEqual(outcome.dailySummary, {
      date: "2026-04-19",
      totalCalories: 400,
      totalProtein: 30,
      totalCarbs: 40,
      totalFat: 13,
      mealCount: 2,
    });
    assert.equal(dailySummaryFromOutcome(outcome), outcome.dailySummary);
    assertNoPublishFailed(outcome);
  });

  it("returns unavailable when recompute and persisted-meal recovery both fail", async () => {
    const outcome = await buildSummaryOutcomeAfterMealCommit({
      deviceId: "device-1",
      affectedDate: "2026-04-19",
      summaryService: {
        async getDailySummary() {
          throw new Error("summary recompute failed");
        },
      },
      foodLoggingService: {
        async getMealsByDate() {
          throw new Error("persisted meal recovery failed");
        },
      },
    });

    assert.deepEqual(outcome, { status: "unavailable", reason: "recompute_failed" });
    assert.equal(dailySummaryFromOutcome(outcome), undefined);
    assertNoPublishFailed(outcome);
  });
});
