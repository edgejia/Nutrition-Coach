import { and, eq, isNull } from "drizzle-orm";
import type { AppDatabase } from "../db/client.js";
import {
  assetReferences,
  mealRevisionItems,
  mealRevisions,
  mealTransactions,
} from "../db/schema.js";
import { parseAssetRef } from "./assets.js";
import { formatLocalDate } from "../lib/time.js";

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
}

type AssetReferenceWriter = Pick<AppDatabase, "insert">;

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

  return {
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
    ): Promise<MealTransactionDeleteResult> {
      const existing = (
        await db
          .select()
          .from(mealTransactions)
          .where(
            and(
              eq(mealTransactions.id, transactionId),
              eq(mealTransactions.deviceId, deviceId),
              isNull(mealTransactions.deletedAt),
            ),
          )
          .limit(1)
      )[0];

      if (!existing) {
        throw new Error("MEAL_NOT_FOUND");
      }

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
          affectedDateKey: formatLocalDate(new Date(existing.loggedAt)),
        };
      });
    },
  };
}
