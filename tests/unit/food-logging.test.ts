// tests/unit/food-logging.test.ts
process.env.TZ = "Asia/Taipei";

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { createDb } from "../../server/db/client.js";
import {
  assetReferences,
  assets,
  mealRevisionItems,
  mealRevisions,
  mealTransactions,
  meals,
} from "../../server/db/schema.js";
import { createDeviceService } from "../../server/services/device.js";
import { createFoodLoggingService } from "../../server/services/food-logging.js";

describe("FoodLoggingService", () => {
  let db: ReturnType<typeof createDb>;
  let foodService: ReturnType<typeof createFoodLoggingService>;
  let deviceId: string;
  let foreignDeviceId: string;

  beforeEach(async () => {
    db = createDb(":memory:");
    const deviceService = createDeviceService(db);
    foodService = createFoodLoggingService(db);
    const result = await deviceService.createDevice("fat_loss");
    const foreignResult = await deviceService.createDevice("muscle_gain");
    deviceId = result.deviceId;
    foreignDeviceId = foreignResult.deviceId;
  });

  async function createOwnedAsset(assetId: string) {
    await db.insert(assets).values({
      id: assetId,
      deviceId,
      storageKey: `meal-images/${assetId}.jpg`,
      mimeType: "image/jpeg",
      byteSize: 1234,
      createdAt: "2026-03-25T04:29:00.000Z",
    });
  }

  it("logs a compatibility meal entry while writing only canonical transaction rows", async () => {
    await createOwnedAsset("asset-apple");

    const meal = await foodService.logFood(deviceId, {
      foodName: "蘋果",
      calories: 95,
      protein: 0.5,
      carbs: 25,
      fat: 0.3,
      imagePath: "asset:asset-apple",
      loggedAt: "2026-03-25T04:30:00.000Z",
    });

    const transactions = await db.select().from(mealTransactions);
    const revisions = await db.select().from(mealRevisions);
    const items = await db.select().from(mealRevisionItems);
    const refs = await db
      .select()
      .from(assetReferences)
      .where(eq(assetReferences.assetId, "asset-apple"));
    const legacyMeals = await db.select().from(meals);

    assert.ok(meal.id);
    assert.equal(meal.foodName, "蘋果");
    assert.equal(meal.itemCount, 1);
    assert.equal(meal.calories, 95);
    assert.equal(meal.deviceId, deviceId);
    assert.equal(meal.mealRevisionId, revisions[0]!.id);
    assert.equal(meal.imagePath, "asset:asset-apple");
    assert.equal(meal.loggedAt, "2026-03-25T04:30:00.000Z");
    assert.equal(transactions.length, 1);
    assert.equal(transactions[0]!.id, meal.id);
    assert.equal(revisions.length, 1);
    assert.equal(items.length, 1);
    assert.equal(refs.length, 1);
    assert.equal(legacyMeals.length, 0);
  });

  it("forwards grouped items without flattening them into separate transactions", async () => {
    await createOwnedAsset("asset-breakfast");

    const meal = await foodService.logGroupedMeal(deviceId, {
      loggedAt: "2026-03-25T05:00:00.000Z",
      imagePath: "asset:asset-breakfast",
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
      ],
    });

    const transactions = await db.select().from(mealTransactions);
    const revisions = await db.select().from(mealRevisions);
    const items = await db.select().from(mealRevisionItems);
    const legacyMeals = await db.select().from(meals);

    assert.equal(transactions.length, 1, "grouped input should stay one transaction");
    assert.equal(revisions.length, 1);
    assert.equal(items.length, 2, "grouped input should stay grouped under one revision");
    assert.equal(meal.id, transactions[0]!.id);
    assert.equal(meal.mealRevisionId, revisions[0]!.id);
    assert.equal(meal.foodName, "蛋餅、豆漿");
    assert.equal(meal.itemCount, 2);
    assert.equal(legacyMeals.length, 0);
  });

  it("returns the current revision identity when updating a compatibility meal entry", async () => {
    const created = await foodService.logFood(deviceId, {
      foodName: "蘋果",
      calories: 95,
      protein: 0.5,
      carbs: 25,
      fat: 0.3,
      loggedAt: "2026-03-25T04:30:00.000Z",
    });

    const updated = await foodService.updateMeal(deviceId, created.id, {
      items: [
        {
          foodName: "蘋果半顆",
          calories: 48,
          protein: 0.2,
          carbs: 12,
          fat: 0.1,
        },
      ],
    });

    const transaction = (
      await db
        .select()
        .from(mealTransactions)
        .where(eq(mealTransactions.id, created.id))
    )[0];
    const revisions = await db
      .select()
      .from(mealRevisions)
      .where(eq(mealRevisions.transactionId, created.id));

    assert.ok(transaction);
    assert.equal(revisions.length, 2);
    assert.equal(updated.id, created.id);
    assert.equal(updated.mealRevisionId, transaction!.currentRevisionId);
    assert.notEqual(updated.mealRevisionId, created.mealRevisionId);
    assert.equal(updated.itemCount, 1);
  });

  it("returns current revision item counts only for owned active meals", async () => {
    const grouped = await foodService.logGroupedMeal(deviceId, {
      loggedAt: "2026-03-25T05:00:00.000Z",
      items: [
        { foodName: "蛋餅", calories: 320, protein: 12, carbs: 30, fat: 16 },
        { foodName: "豆漿", calories: 180, protein: 12, carbs: 14, fat: 8 },
        { foodName: "香蕉", calories: 90, protein: 1, carbs: 23, fat: 0.3 },
      ],
    });

    assert.equal(await foodService.getMealItemCount(deviceId, grouped.id), 3);
    assert.equal(await foodService.getMealItemCount(foreignDeviceId, grouped.id), null);
    assert.equal(await foodService.getMealItemCount(deviceId, "missing-meal-id"), null);

    await foodService.updateMeal(deviceId, grouped.id, {
      items: [
        { foodName: "蛋餅", calories: 320, protein: 12, carbs: 30, fat: 16 },
        { foodName: "豆漿", calories: 180, protein: 12, carbs: 14, fat: 8 },
      ],
    });
    assert.equal(await foodService.getMealItemCount(deviceId, grouped.id), 2);

    await foodService.deleteMeal(deviceId, grouped.id);
    assert.equal(await foodService.getMealItemCount(deviceId, grouped.id), null);
  });

  it("preserves the MEAL_NOT_FOUND contract for foreign deletes while soft-deleting the owner row", async () => {
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

    const transaction = (
      await db
        .select()
        .from(mealTransactions)
        .where(eq(mealTransactions.id, meal.id))
    )[0];

    assert.ok(transaction);
    assert.ok(transaction!.deletedAt);
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
