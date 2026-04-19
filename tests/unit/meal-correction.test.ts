import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createDb } from "../../server/db/client.js";
import { createDeviceService } from "../../server/services/device.js";
import { createFoodLoggingService } from "../../server/services/food-logging.js";
import { createMealCorrectionService } from "../../server/services/meal-correction.js";

describe("meal correction service", () => {
  let db: ReturnType<typeof createDb>;
  let deviceId: string;
  let foodLoggingService: ReturnType<typeof createFoodLoggingService>;
  let mealCorrectionService: ReturnType<typeof createMealCorrectionService>;

  beforeEach(async () => {
    db = createDb(":memory:");
    const deviceService = createDeviceService(db);
    foodLoggingService = createFoodLoggingService(db);
    mealCorrectionService = createMealCorrectionService(db);
    deviceId = (await deviceService.createDevice("fat_loss")).deviceId;
  });

  it("resolves recent-reference shorthand to the latest active meal", async () => {
    await foodLoggingService.logFood(deviceId, {
      foodName: "燕麥",
      calories: 220,
      protein: 10,
      carbs: 35,
      fat: 4,
      loggedAt: "2026-04-19T08:00:00.000Z",
    });
    const latest = await foodLoggingService.logFood(deviceId, {
      foodName: "雞腿飯",
      calories: 680,
      protein: 32,
      carbs: 84,
      fat: 22,
      loggedAt: "2026-04-19T12:30:00.000Z",
    });

    const result = await mealCorrectionService.findMeals(deviceId, "update", "把剛剛那筆改成 500 卡");

    assert.equal(result.status, "resolved");
    assert.equal(result.resolvedMealId, latest.id);
    assert.equal(result.candidate.foodName, "雞腿飯");
  });

  it("uses recent-reference shorthand as a recency tie-breaker instead of overriding a named food target", async () => {
    const target = await foodLoggingService.logFood(deviceId, {
      foodName: "雞腿",
      calories: 220,
      protein: 24,
      carbs: 0,
      fat: 9,
      loggedAt: "2026-04-19T12:00:00.000Z",
    });
    await foodLoggingService.logFood(deviceId, {
      foodName: "雞胸肉",
      calories: 220,
      protein: 30,
      carbs: 0,
      fat: 5,
      loggedAt: "2026-04-19T12:30:00.000Z",
    });
    await foodLoggingService.logFood(deviceId, {
      foodName: "雞胸肉",
      calories: 220,
      protein: 31,
      carbs: 0,
      fat: 5,
      loggedAt: "2026-04-19T13:00:00.000Z",
    });

    const result = await mealCorrectionService.findMeals(
      deviceId,
      "update",
      "幫我把剛剛的雞腿蛋白質降低，我覺得沒這麼高",
    );

    assert.equal(result.status, "resolved");
    assert.equal(result.resolvedMealId, target.id);
    assert.equal(result.candidate.foodName, "雞腿");
  });

  it("keeps a uniquely resolved target available for the next vague follow-up turn", async () => {
    const target = await foodLoggingService.logFood(deviceId, {
      foodName: "雞腿",
      calories: 220,
      protein: 24,
      carbs: 0,
      fat: 9,
      loggedAt: "2026-04-19T12:00:00.000Z",
    });

    const firstPass = await mealCorrectionService.findMeals(
      deviceId,
      "update",
      "幫我把剛剛的雞腿蛋白質降低，我覺得沒這麼高",
    );

    assert.equal(firstPass.status, "resolved");
    assert.equal(firstPass.resolvedMealId, target.id);

    const secondPass = await mealCorrectionService.findMeals(deviceId, "update", "正常平均幾g就幾g");

    assert.equal(secondPass.status, "resolved");
    assert.equal(secondPass.resolvedMealId, target.id);
    assert.equal(secondPass.fromPending, true);
  });

  it("supports partial single-item updates by preserving unspecified fields", async () => {
    const original = await foodLoggingService.logFood(deviceId, {
      foodName: "雞腿",
      calories: 220,
      protein: 24,
      carbs: 0,
      fat: 9,
      loggedAt: "2026-04-19T12:00:00.000Z",
    });

    const result = await mealCorrectionService.updateMeal(deviceId, original.id, {
      patch: { protein: 22 },
    });

    assert.equal(result.updatedMeal.foodName, "雞腿");
    assert.equal(result.updatedMeal.calories, 220);
    assert.equal(result.updatedMeal.protein, 22);
    assert.equal(result.updatedMeal.carbs, 0);
    assert.equal(result.updatedMeal.fat, 9);
  });

  it("supports whole-meal numeric patches for grouped meals by preserving names and distributing totals", async () => {
    const grouped = await foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-04-19T12:00:00.000Z",
      items: [
        { foodName: "雞胸肉", calories: 220, protein: 30, carbs: 0, fat: 5 },
        { foodName: "白飯", calories: 180, protein: 4, carbs: 40, fat: 0.5 },
        { foodName: "花椰菜", calories: 50, protein: 3, carbs: 8, fat: 0.5 },
      ],
    });

    const result = await mealCorrectionService.updateMeal(deviceId, grouped.id, {
      patch: { protein: 22 },
    });

    assert.equal(result.updatedMeal.foodName, "雞胸肉、白飯 等3項");
    assert.equal(result.updatedMeal.calories, 450);
    assert.equal(result.updatedMeal.protein, 22);
    assert.equal(result.updatedMeal.carbs, 48);
    assert.equal(result.updatedMeal.fat, 6);
  });

  it("creates a pending clarification state when multiple meals match and resolves the next numbered reply", async () => {
    const first = await foodLoggingService.logFood(deviceId, {
      foodName: "雞腿飯",
      calories: 650,
      protein: 30,
      carbs: 80,
      fat: 20,
      loggedAt: "2026-04-19T04:00:00.000Z",
    });
    const second = await foodLoggingService.logFood(deviceId, {
      foodName: "雞腿飯",
      calories: 620,
      protein: 29,
      carbs: 78,
      fat: 18,
      loggedAt: "2026-04-19T04:30:00.000Z",
    });

    const firstPass = await mealCorrectionService.findMeals(deviceId, "delete", "把今天午餐的雞腿飯刪掉");
    assert.equal(firstPass.status, "needs_clarification");
    assert.equal(firstPass.candidates.length, 2);
    assert.match(firstPass.prompt, /請直接回覆編號/);

    const secondPass = await mealCorrectionService.findMeals(deviceId, "delete", "第二個");
    assert.equal(secondPass.status, "resolved");
    assert.equal(secondPass.action, "delete");
    assert.equal(secondPass.resolvedMealId, first.id);
    assert.notEqual(secondPass.resolvedMealId, second.id);
    assert.equal(secondPass.fromPending, true);
  });
});
