process.env.TZ = "Asia/Taipei";

import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { asc, eq } from "drizzle-orm";
import { createDb } from "../../server/db/client.js";
import {
  assetReferences,
  assets,
  mealRevisionItems,
  mealRevisions,
  mealTransactions,
} from "../../server/db/schema.js";
import {
  MEAL_PERIODS,
  extractExplicitMealPeriodFromSourceText,
  normalizeMealPeriod,
} from "../../server/lib/meal-period.js";
import { createDeviceService } from "../../server/services/device.js";
import {
  MealRevisionPreconditionError,
  createMealTransactionsService,
} from "../../server/services/meal-transactions.js";

describe("meal period authority helper", () => {
  it("normalizes only supported explicit meal period enum values", () => {
    assert.deepEqual(MEAL_PERIODS, ["breakfast", "lunch", "dinner", "late_night"]);

    assert.equal(normalizeMealPeriod("breakfast"), "breakfast");
    assert.equal(normalizeMealPeriod("lunch"), "lunch");
    assert.equal(normalizeMealPeriod("dinner"), "dinner");
    assert.equal(normalizeMealPeriod("late_night"), "late_night");

    assert.equal(normalizeMealPeriod("snack"), undefined);
    assert.equal(normalizeMealPeriod("晚上"), undefined);
    assert.equal(normalizeMealPeriod(null), undefined);
  });

  it("extracts explicit meal category words while ignoring time-of-day phrases", () => {
    assert.equal(extractExplicitMealPeriodFromSourceText("早餐我吃蛋餅"), "breakfast");
    assert.equal(extractExplicitMealPeriodFromSourceText("早飯是飯糰"), "breakfast");
    assert.equal(extractExplicitMealPeriodFromSourceText("午餐是雞腿便當"), "lunch");
    assert.equal(extractExplicitMealPeriodFromSourceText("午飯吃牛肉麵"), "lunch");
    assert.equal(extractExplicitMealPeriodFromSourceText("晚餐吃沙拉"), "dinner");
    assert.equal(extractExplicitMealPeriodFromSourceText("晚飯是水餃"), "dinner");
    assert.equal(extractExplicitMealPeriodFromSourceText("宵夜吃茶葉蛋"), "late_night");

    assert.equal(extractExplicitMealPeriodFromSourceText("早上吃蛋餅"), undefined);
    assert.equal(extractExplicitMealPeriodFromSourceText("中午吃雞腿便當"), undefined);
    assert.equal(extractExplicitMealPeriodFromSourceText("晚上吃沙拉"), undefined);
  });

  it("does not manufacture one authority from source text with multiple distinct meal periods", () => {
    assert.equal(
      extractExplicitMealPeriodFromSourceText("午餐是雞腿便當，晚餐是沙拉"),
      undefined,
    );
  });
});

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

  async function getTransactionState(transactionId: string) {
    const transaction = (
      await db
        .select()
        .from(mealTransactions)
        .where(eq(mealTransactions.id, transactionId))
    )[0];
    const revisions = await db
      .select()
      .from(mealRevisions)
      .where(eq(mealRevisions.transactionId, transactionId));

    assert.ok(transaction);
    return {
      currentRevisionId: transaction.currentRevisionId,
      currentRevisionNumber: transaction.currentRevisionNumber,
      deletedAt: transaction.deletedAt,
      revisionCount: revisions.length,
    };
  }

  async function getRevisionProof(revisionId: string) {
    const revision = (
      await db
        .select()
        .from(mealRevisions)
        .where(eq(mealRevisions.id, revisionId))
    )[0];
    const items = await db
      .select({
        position: mealRevisionItems.position,
        foodName: mealRevisionItems.foodName,
        calories: mealRevisionItems.calories,
        protein: mealRevisionItems.protein,
        carbs: mealRevisionItems.carbs,
        fat: mealRevisionItems.fat,
      })
      .from(mealRevisionItems)
      .where(eq(mealRevisionItems.revisionId, revisionId))
      .orderBy(asc(mealRevisionItems.position));

    assert.ok(revision);
    return { revision, items };
  }

  function assertMealRevisionPrecondition(
    code: "MEAL_REVISION_REQUIRED" | "MEAL_REVISION_STALE",
    mealId: string,
    currentMealRevisionId: string,
  ) {
    return (error: unknown) => {
      assert.ok(error instanceof MealRevisionPreconditionError);
      assert.equal(error.code, code);
      assert.equal(error.mealId, mealId);
      assert.equal(error.currentMealRevisionId, currentMealRevisionId);
      return true;
    };
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
    assert.equal(result.revisionId, revisions[0]!.id);
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

  it("stores and returns explicit mealPeriod without changing loggedAt", async () => {
    const result = await mealTransactionsService.createTransaction(deviceId, {
      loggedAt: "2026-03-25T04:30:00.000Z",
      mealPeriod: "lunch",
      items: [
        {
          foodName: "雞腿便當",
          calories: 720,
          protein: 38,
          carbs: 82,
          fat: 24,
        },
      ],
    });

    const transaction = (
      await db
        .select()
        .from(mealTransactions)
        .where(eq(mealTransactions.id, result.transactionId))
    )[0];

    assert.equal(result.loggedAt, "2026-03-25T04:30:00.000Z");
    assert.equal(result.mealPeriod, "lunch");
    assert.equal(transaction?.loggedAt, "2026-03-25T04:30:00.000Z");
    assert.equal(transaction?.mealPeriod, "lunch");
  });

  it("keeps mealPeriod null when create input has no explicit authority", async () => {
    const result = await mealTransactionsService.createTransaction(deviceId, {
      loggedAt: "2026-03-25T04:30:00.000Z",
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

    const transaction = (
      await db
        .select()
        .from(mealTransactions)
        .where(eq(mealTransactions.id, result.transactionId))
    )[0];

    assert.equal(result.mealPeriod, null);
    assert.equal(transaction?.mealPeriod, null);
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

    await db.insert(assetReferences).values({
      id: "meal_revision:tx-conflict:r1:asset-breakfast",
      assetId: "asset-breakfast",
      deviceId,
      ownerType: "meal_revision",
      ownerId: "tx-conflict:r1",
      createdAt: "2026-03-25T05:30:00.000Z",
    });

    const originalRandomUUID = crypto.randomUUID;
    (crypto as { randomUUID: () => string }).randomUUID = () => "tx-conflict";
    try {
      await assert.rejects(() =>
        mealTransactionsService.createTransaction(deviceId, {
          loggedAt: "2026-03-25T06:00:00.000Z",
          imagePath: "asset:asset-breakfast",
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
    } finally {
      (crypto as { randomUUID: () => string }).randomUUID = originalRandomUUID;
    }

    const transactions = await db.select().from(mealTransactions);
    const revisions = await db.select().from(mealRevisions);
    const items = await db.select().from(mealRevisionItems);
    const refs = await db.select().from(assetReferences);

    assert.equal(transactions.length, 1);
    assert.equal(revisions.length, 1);
    assert.equal(items.length, 2);
    assert.equal(refs.length, 2);
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

    const deleted = await mealTransactionsService.softDeleteTransaction(
      deviceId,
      created.transactionId,
      created.revisionId,
    );

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
      mealPeriod: null,
      affectedDateKey: "2026-03-25",
      deletedMeal: {
        mealId: created.transactionId,
        dateKey: "2026-03-25",
        loggedAt: "2026-03-25T11:00:00.000Z",
        mealPeriod: null,
        foodName: "雞胸肉",
        calories: 320,
        protein: 40,
      },
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

  it("returns the new current revision identity when updating a transaction", async () => {
    const created = await mealTransactionsService.createTransaction(deviceId, {
      loggedAt: "2026-03-25T04:30:00.000Z",
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

    const updated = await mealTransactionsService.updateTransaction(deviceId, created.transactionId, {
      expectedMealRevisionId: created.revisionId,
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
        .where(eq(mealTransactions.id, created.transactionId))
    )[0];
    const revisions = await db
      .select()
      .from(mealRevisions)
      .where(eq(mealRevisions.transactionId, created.transactionId));

    assert.ok(transaction);
    assert.equal(revisions.length, 2);
    assert.equal(updated.transactionId, created.transactionId);
    assert.equal(updated.revisionId, transaction!.currentRevisionId);
    assert.notEqual(updated.revisionId, created.revisionId);
  });

  it("persists full-list updates as ordered revision items while preserving image identity", async () => {
    await createOwnedAsset("asset-breakfast");

    const singleItem = await mealTransactionsService.createTransaction(deviceId, {
      loggedAt: "2026-03-25T04:30:00.000Z",
      imagePath: "asset:asset-breakfast",
      items: [
        {
          foodName: "早餐盤",
          calories: 410,
          protein: 22,
          carbs: 38,
          fat: 18,
        },
      ],
    });
    const singleToGroupedItems = [
      { foodName: "蛋餅", calories: 310, protein: 18, carbs: 32, fat: 12 },
      { foodName: "無糖豆漿", calories: 120, protein: 9, carbs: 8, fat: 5 },
    ];

    const singleToGrouped = await mealTransactionsService.updateTransaction(deviceId, singleItem.transactionId, {
      expectedMealRevisionId: singleItem.revisionId,
      items: singleToGroupedItems,
    });
    const singleToGroupedProof = await getRevisionProof(singleToGrouped.revisionId);
    assert.equal(singleToGrouped.transactionId, singleItem.transactionId);
    assert.notEqual(singleToGrouped.revisionId, singleItem.revisionId);
    assert.equal(singleToGroupedProof.revision.supersedesRevisionId, singleItem.revisionId);
    assert.equal(singleToGroupedProof.revision.imageAssetId, "asset-breakfast");
    assert.equal(singleToGrouped.imageAssetId, "asset-breakfast");
    assert.deepEqual(singleToGrouped.items, singleToGroupedItems);
    assert.deepEqual(singleToGroupedProof.items, [
      { position: 0, ...singleToGroupedItems[0] },
      { position: 1, ...singleToGroupedItems[1] },
    ]);
    assert.deepEqual(await getTransactionState(singleItem.transactionId), {
      currentRevisionId: singleToGrouped.revisionId,
      currentRevisionNumber: 2,
      deletedAt: null,
      revisionCount: 2,
    });

    const reorderedDuplicateItems = [
      { foodName: "無糖豆漿", calories: 130, protein: 10, carbs: 9, fat: 5 },
      { foodName: "蛋餅", calories: 300, protein: 17, carbs: 31, fat: 11 },
      { foodName: "無糖豆漿", calories: 90, protein: 7, carbs: 5, fat: 3 },
    ];
    const reorderedDuplicate = await mealTransactionsService.updateTransaction(deviceId, singleItem.transactionId, {
      expectedMealRevisionId: singleToGrouped.revisionId,
      items: reorderedDuplicateItems,
    });
    const reorderedDuplicateProof = await getRevisionProof(reorderedDuplicate.revisionId);
    assert.notEqual(reorderedDuplicate.revisionId, singleToGrouped.revisionId);
    assert.equal(reorderedDuplicateProof.revision.supersedesRevisionId, singleToGrouped.revisionId);
    assert.equal(reorderedDuplicateProof.revision.imageAssetId, "asset-breakfast");
    assert.equal(reorderedDuplicate.imageAssetId, "asset-breakfast");
    assert.deepEqual(reorderedDuplicate.items, reorderedDuplicateItems);
    assert.deepEqual(reorderedDuplicateProof.items, [
      { position: 0, ...reorderedDuplicateItems[0] },
      { position: 1, ...reorderedDuplicateItems[1] },
      { position: 2, ...reorderedDuplicateItems[2] },
    ]);

    const groupedItem = await mealTransactionsService.createTransaction(deviceId, {
      loggedAt: "2026-03-25T12:00:00.000Z",
      items: [
        { foodName: "雞腿", calories: 260, protein: 24, carbs: 0, fat: 12 },
        { foodName: "白飯", calories: 280, protein: 4, carbs: 62, fat: 0.5 },
        { foodName: "青菜", calories: 40, protein: 2, carbs: 8, fat: 1 },
      ],
    });
    const groupedToSingleItems = [
      { foodName: "雞腿", calories: 260, protein: 24, carbs: 0, fat: 12 },
    ];
    const groupedToSingle = await mealTransactionsService.updateTransaction(deviceId, groupedItem.transactionId, {
      expectedMealRevisionId: groupedItem.revisionId,
      items: groupedToSingleItems,
    });
    const groupedToSingleProof = await getRevisionProof(groupedToSingle.revisionId);
    assert.equal(groupedToSingle.transactionId, groupedItem.transactionId);
    assert.notEqual(groupedToSingle.revisionId, groupedItem.revisionId);
    assert.equal(groupedToSingleProof.revision.supersedesRevisionId, groupedItem.revisionId);
    assert.equal(groupedToSingleProof.revision.imageAssetId, null);
    assert.equal(groupedToSingle.imageAssetId, null);
    assert.deepEqual(groupedToSingle.items, groupedToSingleItems);
    assert.deepEqual(groupedToSingleProof.items, [
      { position: 0, ...groupedToSingleItems[0] },
    ]);
  });

  it("preserves existing mealPeriod when ordinary updates omit period changes", async () => {
    const created = await mealTransactionsService.createTransaction(deviceId, {
      loggedAt: "2026-03-25T04:30:00.000Z",
      mealPeriod: "dinner",
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

    const updated = await mealTransactionsService.updateTransaction(deviceId, created.transactionId, {
      expectedMealRevisionId: created.revisionId,
      items: [
        {
          foodName: "雞胸肉半份",
          calories: 160,
          protein: 20,
          carbs: 0,
          fat: 6,
        },
      ],
    });

    const transaction = (
      await db
        .select()
        .from(mealTransactions)
        .where(eq(mealTransactions.id, created.transactionId))
    )[0];

    assert.equal(updated.mealPeriod, "dinner");
    assert.equal(transaction?.mealPeriod, "dinner");
  });

  it("rejects missing and stale expected revisions before update writes", async () => {
    const created = await mealTransactionsService.createTransaction(deviceId, {
      loggedAt: "2026-03-25T04:30:00.000Z",
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
    const updateInput = {
      items: [
        {
          foodName: "蘋果半顆",
          calories: 48,
          protein: 0.2,
          carbs: 12,
          fat: 0.1,
        },
      ],
    };

    const beforeMissing = await getTransactionState(created.transactionId);
    await assert.rejects(
      () => mealTransactionsService.updateTransaction(deviceId, created.transactionId, updateInput),
      assertMealRevisionPrecondition("MEAL_REVISION_REQUIRED", created.transactionId, created.revisionId),
    );
    assert.deepEqual(await getTransactionState(created.transactionId), beforeMissing);

    const updated = await mealTransactionsService.updateTransaction(deviceId, created.transactionId, {
      ...updateInput,
      expectedMealRevisionId: created.revisionId,
    });

    const beforeStale = await getTransactionState(created.transactionId);
    await assert.rejects(
      () =>
        mealTransactionsService.updateTransaction(deviceId, created.transactionId, {
          ...updateInput,
          expectedMealRevisionId: created.revisionId,
        }),
      assertMealRevisionPrecondition("MEAL_REVISION_STALE", created.transactionId, updated.revisionId),
    );
    assert.deepEqual(await getTransactionState(created.transactionId), beforeStale);
  });

  it("rejects missing and stale expected revisions before delete writes", async () => {
    const created = await mealTransactionsService.createTransaction(deviceId, {
      loggedAt: "2026-03-25T11:00:00.000Z",
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

    const beforeMissing = await getTransactionState(created.transactionId);
    await assert.rejects(
      () => mealTransactionsService.softDeleteTransaction(deviceId, created.transactionId),
      assertMealRevisionPrecondition("MEAL_REVISION_REQUIRED", created.transactionId, created.revisionId),
    );
    assert.deepEqual(await getTransactionState(created.transactionId), beforeMissing);

    const updated = await mealTransactionsService.updateTransaction(deviceId, created.transactionId, {
      expectedMealRevisionId: created.revisionId,
      items: [
        {
          foodName: "雞胸肉半份",
          calories: 160,
          protein: 20,
          carbs: 0,
          fat: 6,
        },
      ],
    });

    const beforeStale = await getTransactionState(created.transactionId);
    await assert.rejects(
      () => mealTransactionsService.softDeleteTransaction(deviceId, created.transactionId, created.revisionId),
      assertMealRevisionPrecondition("MEAL_REVISION_STALE", created.transactionId, updated.revisionId),
    );
    assert.deepEqual(await getTransactionState(created.transactionId), beforeStale);
  });
});
