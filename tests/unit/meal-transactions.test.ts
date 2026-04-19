process.env.TZ = "Asia/Taipei";

import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { createDb } from "../../server/db/client.js";
import {
  assetReferences,
  assets,
  mealRevisionItems,
  mealRevisions,
  mealTransactions,
} from "../../server/db/schema.js";
import { createDeviceService } from "../../server/services/device.js";
import { createMealTransactionsService } from "../../server/services/meal-transactions.js";

describe("MealTransactionsService", () => {
  let db: ReturnType<typeof createDb>;
  let mealTransactionsService: ReturnType<typeof createMealTransactionsService>;
  let deviceId: string;
  let foreignDeviceId: string;

  beforeEach(async () => {
    db = createDb(":memory:");
    const deviceService = createDeviceService(db);
    mealTransactionsService = createMealTransactionsService(db);
    deviceId = (await deviceService.createDevice("fat_loss")).deviceId;
    foreignDeviceId = (await deviceService.createDevice("muscle_gain")).deviceId;
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

  it("writes one transaction, revision, item, and asset reference for a single-item log", async () => {
    await createOwnedAsset("asset-apple");

    const result = await mealTransactionsService.createTransaction(deviceId, {
      loggedAt: "2026-03-25T04:30:00.000Z",
      imagePath: "asset:asset-apple",
      items: [
        {
          foodName: "蘋果",
          calories: 95,
          protein: 0.5,
          carbs: 25,
          fat: 0.3,
        },
      ],
    });

    const transactions = await db.select().from(mealTransactions);
    const revisions = await db.select().from(mealRevisions);
    const items = await db.select().from(mealRevisionItems);
    const refs = await db
      .select()
      .from(assetReferences)
      .where(eq(assetReferences.assetId, "asset-apple"));

    assert.equal(transactions.length, 1);
    assert.equal(revisions.length, 1);
    assert.equal(items.length, 1);
    assert.equal(refs.length, 1);

    assert.equal(result.transactionId, transactions[0]!.id);
    assert.equal(transactions[0]!.deviceId, deviceId);
    assert.equal(transactions[0]!.loggedAt, "2026-03-25T04:30:00.000Z");
    assert.equal(transactions[0]!.currentRevisionId, revisions[0]!.id);
    assert.equal(transactions[0]!.currentRevisionNumber, 1);
    assert.equal(transactions[0]!.deletedAt, null);

    assert.equal(revisions[0]!.transactionId, transactions[0]!.id);
    assert.equal(revisions[0]!.revisionNumber, 1);
    assert.equal(revisions[0]!.supersedesRevisionId, null);
    assert.equal(revisions[0]!.imageAssetId, "asset-apple");
    assert.equal(revisions[0]!.changeType, "create");

    assert.equal(items[0]!.revisionId, revisions[0]!.id);
    assert.equal(items[0]!.position, 0);
    assert.equal(items[0]!.foodName, "蘋果");
    assert.equal(items[0]!.calories, 95);

    assert.deepEqual(
      refs.map((ref) => ({
        ownerType: ref.ownerType,
        ownerId: ref.ownerId,
        assetId: ref.assetId,
      })),
      [
        {
          ownerType: "meal_revision",
          ownerId: revisions[0]!.id,
          assetId: "asset-apple",
        },
      ],
    );
  });

  it("keeps grouped items under one stable transaction id and rolls back the whole write on failure", async () => {
    await createOwnedAsset("asset-breakfast");

    const grouped = await mealTransactionsService.createTransaction(deviceId, {
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

    const successfulTransaction = (
      await db
        .select()
        .from(mealTransactions)
        .where(eq(mealTransactions.id, grouped.transactionId))
    )[0];
    const successfulRevision = (
      await db
        .select()
        .from(mealRevisions)
        .where(eq(mealRevisions.id, successfulTransaction!.currentRevisionId))
    )[0];
    const successfulItems = await db
      .select()
      .from(mealRevisionItems)
      .where(eq(mealRevisionItems.revisionId, successfulRevision!.id));

    assert.ok(successfulTransaction);
    assert.equal(successfulItems.length, 2);
    assert.ok(successfulItems.every((item) => item.revisionId === successfulRevision!.id));

    await assert.rejects(() =>
      mealTransactionsService.createTransaction(deviceId, {
        loggedAt: "2026-03-25T06:00:00.000Z",
        imagePath: "asset:missing-asset",
        items: [
          {
            foodName: "午餐",
            calories: 600,
            protein: 32,
            carbs: 55,
            fat: 24,
          },
          {
            foodName: "奶茶",
            calories: 280,
            protein: 4,
            carbs: 42,
            fat: 10,
          },
        ],
      }),
    );

    const transactions = await db.select().from(mealTransactions);
    const revisions = await db.select().from(mealRevisions);
    const items = await db.select().from(mealRevisionItems);
    const refs = await db.select().from(assetReferences);

    assert.equal(transactions.length, 1);
    assert.equal(revisions.length, 1);
    assert.equal(items.length, 2);
    assert.equal(refs.length, 1);
  });

  it("creates a tombstone revision on soft delete and rejects foreign ownership", async () => {
    await createOwnedAsset("asset-dinner");

    const created = await mealTransactionsService.createTransaction(deviceId, {
      loggedAt: "2026-03-25T11:00:00.000Z",
      imagePath: "asset:asset-dinner",
      items: [
        {
          foodName: "雞胸肉",
          calories: 320,
          protein: 40,
          carbs: 0,
          fat: 12,
        },
      ],
    });

    await assert.rejects(
      () => mealTransactionsService.softDeleteTransaction(foreignDeviceId, created.transactionId),
      /MEAL_NOT_FOUND/,
    );

    const deleted = await mealTransactionsService.softDeleteTransaction(deviceId, created.transactionId);

    const transaction = (
      await db
        .select()
        .from(mealTransactions)
        .where(eq(mealTransactions.id, created.transactionId))
    )[0];
    const revisions = await db
      .select()
      .from(mealRevisions)
      .where(eq(mealRevisions.transactionId, created.transactionId));
    const tombstone = revisions.find((revision) => revision.changeType === "delete");
    const tombstoneItems = tombstone
      ? await db
          .select()
          .from(mealRevisionItems)
          .where(eq(mealRevisionItems.revisionId, tombstone.id))
      : [];
    const refs = await db
      .select()
      .from(assetReferences)
      .where(eq(assetReferences.assetId, "asset-dinner"));

    assert.deepEqual(deleted, {
      transactionId: created.transactionId,
      loggedAt: "2026-03-25T11:00:00.000Z",
      affectedDateKey: "2026-03-25",
    });
    assert.ok(transaction);
    assert.equal(transaction!.currentRevisionNumber, 2);
    assert.ok(transaction!.deletedAt);
    assert.ok(tombstone, "expected a tombstone revision");
    assert.equal(tombstone!.revisionNumber, 2);
    assert.equal(tombstone!.supersedesRevisionId, `${created.transactionId}:r1`);
    assert.equal(transaction!.currentRevisionId, tombstone!.id);
    assert.equal(tombstoneItems.length, 0);
    assert.equal(refs.length, 1);
  });
});
