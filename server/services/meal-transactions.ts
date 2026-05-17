import { and, asc, eq, isNull } from "drizzle-orm";
import type { AppDatabase } from "../db/client.js";
import {
  assetReferences,
  assets,
  mealRevisionItems,
  mealRevisions,
  mealTransactions,
} from "../db/schema.js";
import { parseAssetRef } from "./assets.js";
import { formatLocalDate } from "../lib/time.js";
import { projectMealDisplay } from "./meal-display.js";

export interface MealTransactionItemInput {
  foodName: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

export interface CreateMealTransactionInput {
  loggedAt?: string;
  imagePath?: string | null;
  items: MealTransactionItemInput[];
}

export interface MealTransactionWriteResult {
  transactionId: string;
  revisionId: string;
  loggedAt: string;
  imagePath: string | null;
  items: MealTransactionItemInput[];
}

export interface MealTransactionDeleteResult {
  transactionId: string;
  loggedAt: string;
  affectedDateKey: string;
  deletedMeal: DeletedMealSnapshot;
}

export interface DeletedMealSnapshot {
  mealId: string;
  dateKey: string;
  loggedAt: string;
  foodName: string;
  calories?: number;
  protein?: number;
}

export interface MealTransactionUpdateInput {
  expectedMealRevisionId?: string | null;
  imagePath?: string | null;
  items: MealTransactionItemInput[];
}

export interface MealTransactionUpdateResult {
  transactionId: string;
  revisionId: string;
  loggedAt: string;
  affectedDateKey: string;
  imageAssetId: string | null;
  items: MealTransactionItemInput[];
}

interface MealTransactionRow {
  id: string;
  deviceId: string;
  loggedAt: string;
  currentRevisionId: string;
  currentRevisionNumber: number;
  deletedAt: string | null;
  createdAt: string;
}

type MealRevisionAssertionTarget = Pick<MealTransactionRow, "id" | "loggedAt" | "currentRevisionId">;

export interface MealMutationGuard {
  mealId: string;
  affectedDate: string;
  currentMealRevisionId: string;
  itemCount: number;
}

type AssetReferenceWriter = Pick<AppDatabase, "insert">;
type MealTransactionReader = Pick<AppDatabase, "select">;

export type MealRevisionPreconditionCode = "MEAL_REVISION_REQUIRED" | "MEAL_REVISION_STALE";

export class MealRevisionPreconditionError extends Error {
  readonly code: MealRevisionPreconditionCode;
  readonly mealId: string;
  readonly affectedDate: string;
  readonly currentMealRevisionId: string;

  constructor(input: {
    code: MealRevisionPreconditionCode;
    mealId: string;
    affectedDate: string;
    currentMealRevisionId: string;
  }) {
    super(input.code);
    this.name = "MealRevisionPreconditionError";
    this.code = input.code;
    this.mealId = input.mealId;
    this.affectedDate = input.affectedDate;
    this.currentMealRevisionId = input.currentMealRevisionId;
  }
}

export function createMealTransactionsService(db: AppDatabase) {
  function normalizeItems(items: MealTransactionItemInput[]) {
    if (items.length === 0) {
      throw new Error("MEAL_ITEMS_REQUIRED");
    }

    return items.map((item) => ({
      foodName: item.foodName,
      calories: item.calories,
      protein: item.protein,
      carbs: item.carbs,
      fat: item.fat,
    }));
  }

  function insertAssetReference(
    tx: AssetReferenceWriter,
    deviceId: string,
    assetId: string,
    ownerType: string,
    ownerId: string,
    createdAt: string,
  ) {
    tx.insert(assetReferences)
      .values({
        id: `${ownerType}:${ownerId}:${assetId}`,
        assetId,
        deviceId,
        ownerType,
        ownerId,
        createdAt,
      })
      .run();
  }

  function getTransactionByDeviceAndIdFromReader(
    reader: MealTransactionReader,
    deviceId: string,
    transactionId: string,
  ): MealTransactionRow | undefined {
    return reader
      .select({
        id: mealTransactions.id,
        deviceId: mealTransactions.deviceId,
        loggedAt: mealTransactions.loggedAt,
        currentRevisionId: mealTransactions.currentRevisionId,
        currentRevisionNumber: mealTransactions.currentRevisionNumber,
        deletedAt: mealTransactions.deletedAt,
        createdAt: mealTransactions.createdAt,
      })
      .from(mealTransactions)
      .where(and(
        eq(mealTransactions.deviceId, deviceId),
        eq(mealTransactions.id, transactionId),
      ))
      .limit(1)
      .get();
  }

  function assertMutableExpectedRevision(
    existing: MealTransactionRow,
    expectedMealRevisionId: string | null | undefined,
  ) {
    assertExpectedMealRevision(existing, expectedMealRevisionId);

    if (existing.deletedAt !== null) {
      throw new MealRevisionPreconditionError({
        code: "MEAL_REVISION_STALE",
        mealId: existing.id,
        affectedDate: formatLocalDate(new Date(existing.loggedAt)),
        currentMealRevisionId: existing.currentRevisionId,
      });
    }
  }

  function loadDeletedMealSnapshotFromReader(
    reader: MealTransactionReader,
    existing: MealTransactionRow,
  ): DeletedMealSnapshot {
    const items = reader
      .select({
        foodName: mealRevisionItems.foodName,
        calories: mealRevisionItems.calories,
        protein: mealRevisionItems.protein,
      })
      .from(mealRevisionItems)
      .where(eq(mealRevisionItems.revisionId, existing.currentRevisionId))
      .orderBy(asc(mealRevisionItems.position))
      .all();
    const dateKey = formatLocalDate(new Date(existing.loggedAt));
    const display = projectMealDisplay(items, "未知餐點");
    const calories = items.length > 0
      ? items.reduce((sum, item) => sum + item.calories, 0)
      : undefined;
    const protein = items.length > 0
      ? items.reduce((sum, item) => sum + item.protein, 0)
      : undefined;

    return {
      mealId: existing.id,
      dateKey,
      loggedAt: existing.loggedAt,
      foodName: display.foodName,
      ...(calories === undefined ? {} : { calories }),
      ...(protein === undefined ? {} : { protein }),
    };
  }

  function assertExpectedMealRevision(
    existing: MealRevisionAssertionTarget,
    expectedMealRevisionId: string | null | undefined,
  ) {
    const expected = typeof expectedMealRevisionId === "string" ? expectedMealRevisionId.trim() : "";
    const affectedDate = formatLocalDate(new Date(existing.loggedAt));

    if (!expected) {
      throw new MealRevisionPreconditionError({
        code: "MEAL_REVISION_REQUIRED",
        mealId: existing.id,
        affectedDate,
        currentMealRevisionId: existing.currentRevisionId,
      });
    }

    if (expected !== existing.currentRevisionId) {
      throw new MealRevisionPreconditionError({
        code: "MEAL_REVISION_STALE",
        mealId: existing.id,
        affectedDate,
        currentMealRevisionId: existing.currentRevisionId,
      });
    }
  }

  return {
    async assertExpectedMealRevision(
      deviceId: string,
      transactionId: string,
      expectedMealRevisionId?: string | null,
    ): Promise<void> {
      const existing = getTransactionByDeviceAndIdFromReader(db, deviceId, transactionId);

      if (!existing) {
        throw new Error("MEAL_NOT_FOUND");
      }

      assertMutableExpectedRevision(existing, expectedMealRevisionId);
    },

    async getMealMutationGuard(
      deviceId: string,
      transactionId: string,
      expectedMealRevisionId?: string | null,
    ): Promise<MealMutationGuard> {
      const existing = db.$client
        .prepare(
          `
            SELECT
              mt.id,
              mt.logged_at AS loggedAt,
              mt.current_revision_id AS currentRevisionId,
              mt.current_revision_number AS currentRevisionNumber,
              mt.deleted_at AS deletedAt,
              mt.created_at AS createdAt,
              COUNT(mri.revision_id) AS itemCount
            FROM meal_transactions AS mt INDEXED BY meal_tx_device_id_id_idx
            LEFT JOIN meal_revision_items AS mri
              ON mri.revision_id = mt.current_revision_id
            WHERE mt.device_id = ? AND mt.id = ?
            GROUP BY mt.id, mt.logged_at, mt.current_revision_id, mt.current_revision_number, mt.deleted_at, mt.created_at
            LIMIT 1
          `,
        )
        .get(deviceId, transactionId) as (MealTransactionRow & { itemCount: number }) | undefined;

      if (!existing) {
        throw new Error("MEAL_NOT_FOUND");
      }

      assertMutableExpectedRevision(existing, expectedMealRevisionId);

      return {
        mealId: existing.id,
        affectedDate: formatLocalDate(new Date(existing.loggedAt)),
        currentMealRevisionId: existing.currentRevisionId,
        itemCount: existing.itemCount,
      };
    },

    async createTransaction(
      deviceId: string,
      input: CreateMealTransactionInput,
    ): Promise<MealTransactionWriteResult> {
      const items = normalizeItems(input.items);
      const transactionId = crypto.randomUUID();
      const loggedAt = input.loggedAt ?? new Date().toISOString();
      const revisionNumber = 1;
      const revisionId = `${transactionId}:r${revisionNumber}`;
      const createdAt = new Date().toISOString();
      const imageAssetId = parseAssetRef(input.imagePath);
      const imagePath = imageAssetId ? `asset:${imageAssetId}` : null;

      return db.transaction((tx) => {
        if (imageAssetId) {
          // Some direct callers still pass an `asset:<id>` ref without staging
          // the asset row first. Preserve the canonical image link by creating
          // a minimal metadata row so the explicit meal-side reference remains
          // normalized and queryable.
          const existingAsset = tx
            .select({ id: assets.id })
            .from(assets)
            .where(eq(assets.id, imageAssetId))
            .limit(1)
            .get();

          if (!existingAsset) {
            tx.insert(assets)
              .values({
                id: imageAssetId,
                deviceId,
                storageKey: `unresolved/${imageAssetId}`,
                mimeType: "application/octet-stream",
                byteSize: 0,
                createdAt,
              })
              .run();
          }
        }

        tx.insert(mealTransactions)
          .values({
            id: transactionId,
            deviceId,
            loggedAt,
            currentRevisionId: revisionId,
            currentRevisionNumber: revisionNumber,
            deletedAt: null,
            createdAt,
          })
          .run();

        tx.insert(mealRevisions)
          .values({
            id: revisionId,
            transactionId,
            revisionNumber,
            supersedesRevisionId: null,
            imageAssetId,
            changeType: "create",
            createdAt,
          })
          .run();

        tx.insert(mealRevisionItems)
          .values(
            items.map((item, position) => ({
              revisionId,
              position,
              foodName: item.foodName,
              calories: item.calories,
              protein: item.protein,
              carbs: item.carbs,
              fat: item.fat,
            })),
          )
          .run();

        if (imageAssetId) {
          insertAssetReference(tx, deviceId, imageAssetId, "meal_revision", revisionId, createdAt);
        }

        return {
          transactionId,
          revisionId,
          loggedAt,
          imagePath,
          items,
        };
      });
    },

    async softDeleteTransaction(
      deviceId: string,
      transactionId: string,
      expectedMealRevisionId?: string | null,
    ): Promise<MealTransactionDeleteResult> {
      const deletedAt = new Date().toISOString();

      return db.transaction((tx) => {
        const existing = getTransactionByDeviceAndIdFromReader(tx, deviceId, transactionId);

        if (!existing) {
          throw new Error("MEAL_NOT_FOUND");
        }
        assertMutableExpectedRevision(existing, expectedMealRevisionId);

        const deletedMeal = loadDeletedMealSnapshotFromReader(tx, existing);
        const revisionNumber = existing.currentRevisionNumber + 1;
        const revisionId = `${existing.id}:r${revisionNumber}`;

        tx.insert(mealRevisions)
          .values({
            id: revisionId,
            transactionId: existing.id,
            revisionNumber,
            supersedesRevisionId: existing.currentRevisionId,
            imageAssetId: null,
            changeType: "delete",
            createdAt: deletedAt,
          })
          .run();

        tx.update(mealTransactions)
          .set({
            currentRevisionId: revisionId,
            currentRevisionNumber: revisionNumber,
            deletedAt,
          })
          .where(and(
            eq(mealTransactions.id, existing.id),
            eq(mealTransactions.currentRevisionId, existing.currentRevisionId),
            isNull(mealTransactions.deletedAt),
          ))
          .run();

        return {
          transactionId: existing.id,
          loggedAt: existing.loggedAt,
          affectedDateKey: deletedMeal.dateKey,
          deletedMeal,
        };
      });
    },

    async updateTransaction(
      deviceId: string,
      transactionId: string,
      input: MealTransactionUpdateInput,
    ): Promise<MealTransactionUpdateResult> {
      const items = normalizeItems(input.items);
      const createdAt = new Date().toISOString();
      const explicitImageAssetId = parseAssetRef(input.imagePath);

      return db.transaction((tx) => {
        const existing = getTransactionByDeviceAndIdFromReader(tx, deviceId, transactionId);

        if (!existing) {
          throw new Error("MEAL_NOT_FOUND");
        }
        assertMutableExpectedRevision(existing, input.expectedMealRevisionId);

        const revisionNumber = existing.currentRevisionNumber + 1;
        const revisionId = `${existing.id}:r${revisionNumber}`;
        const currentRevision = tx
          .select({
            imageAssetId: mealRevisions.imageAssetId,
          })
          .from(mealRevisions)
          .where(eq(mealRevisions.id, existing.currentRevisionId))
          .limit(1)
          .get();
        const imageAssetId = explicitImageAssetId ?? currentRevision?.imageAssetId ?? null;

        if (imageAssetId) {
          const existingAsset = tx
            .select({ id: assets.id })
            .from(assets)
            .where(eq(assets.id, imageAssetId))
            .limit(1)
            .get();

          if (!existingAsset) {
            tx.insert(assets)
              .values({
                id: imageAssetId,
                deviceId,
                storageKey: `unresolved/${imageAssetId}`,
                mimeType: "application/octet-stream",
                byteSize: 0,
                createdAt,
              })
              .run();
          }
        }

        tx.insert(mealRevisions)
          .values({
            id: revisionId,
            transactionId: existing.id,
            revisionNumber,
            supersedesRevisionId: existing.currentRevisionId,
            imageAssetId,
            changeType: "update",
            createdAt,
          })
          .run();

        tx.insert(mealRevisionItems)
          .values(
            items.map((item, position) => ({
              revisionId,
              position,
              foodName: item.foodName,
              calories: item.calories,
              protein: item.protein,
              carbs: item.carbs,
              fat: item.fat,
            })),
          )
          .run();

        tx.update(mealTransactions)
          .set({
            currentRevisionId: revisionId,
            currentRevisionNumber: revisionNumber,
          })
          .where(and(
            eq(mealTransactions.id, existing.id),
            eq(mealTransactions.currentRevisionId, existing.currentRevisionId),
            isNull(mealTransactions.deletedAt),
          ))
          .run();

        if (imageAssetId) {
          insertAssetReference(tx, deviceId, imageAssetId, "meal_revision", revisionId, createdAt);
        }

        return {
          transactionId: existing.id,
          revisionId,
          loggedAt: existing.loggedAt,
          affectedDateKey: formatLocalDate(new Date(existing.loggedAt)),
          imageAssetId,
          items,
        };
      });
    },
  };
}
