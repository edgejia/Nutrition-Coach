import { asc, eq } from "drizzle-orm";
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

type AssetReferenceWriter = Pick<AppDatabase, "insert">;

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

  function getActiveTransactionByDeviceAndId(
    deviceId: string,
    transactionId: string,
  ): MealTransactionRow | undefined {
    // Keep the shared delete/correction lookup pinned to the composite
    // device_id + id index so the hot path remains regression-testable.
    return db.$client
      .prepare(
        `
          SELECT
            id,
            device_id AS deviceId,
            logged_at AS loggedAt,
            current_revision_id AS currentRevisionId,
            current_revision_number AS currentRevisionNumber,
            deleted_at AS deletedAt,
            created_at AS createdAt
          FROM meal_transactions INDEXED BY meal_tx_device_id_id_idx
          WHERE device_id = ? AND id = ? AND deleted_at IS NULL
          LIMIT 1
        `,
      )
      .get(deviceId, transactionId) as MealTransactionRow | undefined;
  }

  async function loadDeletedMealSnapshot(existing: MealTransactionRow): Promise<DeletedMealSnapshot> {
    const items = await db
      .select({
        foodName: mealRevisionItems.foodName,
        calories: mealRevisionItems.calories,
        protein: mealRevisionItems.protein,
      })
      .from(mealRevisionItems)
      .where(eq(mealRevisionItems.revisionId, existing.currentRevisionId))
      .orderBy(asc(mealRevisionItems.position));
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
    existing: MealTransactionRow,
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
      const existing = getActiveTransactionByDeviceAndId(deviceId, transactionId);

      if (!existing) {
        throw new Error("MEAL_NOT_FOUND");
      }

      assertExpectedMealRevision(existing, expectedMealRevisionId);
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
      const existing = getActiveTransactionByDeviceAndId(deviceId, transactionId);

      if (!existing) {
        throw new Error("MEAL_NOT_FOUND");
      }
      assertExpectedMealRevision(existing, expectedMealRevisionId);

      const deletedMeal = await loadDeletedMealSnapshot(existing);
      const deletedAt = new Date().toISOString();
      const revisionNumber = existing.currentRevisionNumber + 1;
      const revisionId = `${existing.id}:r${revisionNumber}`;

      return db.transaction((tx) => {
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
          .where(eq(mealTransactions.id, existing.id))
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
      const existing = getActiveTransactionByDeviceAndId(deviceId, transactionId);

      if (!existing) {
        throw new Error("MEAL_NOT_FOUND");
      }
      assertExpectedMealRevision(existing, input.expectedMealRevisionId);

      const items = normalizeItems(input.items);
      const createdAt = new Date().toISOString();
      const revisionNumber = existing.currentRevisionNumber + 1;
      const revisionId = `${existing.id}:r${revisionNumber}`;
      const explicitImageAssetId = parseAssetRef(input.imagePath);
      const currentRevision = db
        .select({
          imageAssetId: mealRevisions.imageAssetId,
        })
        .from(mealRevisions)
        .where(eq(mealRevisions.id, existing.currentRevisionId))
        .limit(1)
        .get();
      const imageAssetId = explicitImageAssetId ?? currentRevision?.imageAssetId ?? null;

      return db.transaction((tx) => {
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
          .where(eq(mealTransactions.id, existing.id))
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
