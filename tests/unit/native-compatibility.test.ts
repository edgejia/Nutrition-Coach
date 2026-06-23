import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { asc, eq } from "drizzle-orm";
import { createDb } from "../../server/db/client.js";
import { runMigrations } from "../../server/db/migrate.js";
import {
  devices,
  mealRevisionItems,
  mealRevisions,
  mealTransactions,
} from "../../server/db/schema.js";
import { validateImageBytes } from "../../server/lib/image-validation.js";
import { createDeviceService } from "../../server/services/device.js";
import { createMealTransactionsService } from "../../server/services/meal-transactions.js";
import {
  validJpegBytes,
  validPngBytes,
  validWebpBytes,
} from "../fixtures/image-bytes.js";

type ManagedDb = ReturnType<typeof createDb> & {
  $client: {
    close(): void;
  };
};

const openDbs: ManagedDb[] = [];
const tempDirs = new Set<string>();

function fixtureBuffer(bytes: ArrayBuffer): Buffer {
  return Buffer.from(bytes);
}

function assertCheck(label: string, actual: boolean, expected: boolean): void {
  if (actual !== expected) {
    assert.fail(`native compatibility check failed: ${label}`);
  }
}

function assertValue<T>(label: string, actual: T, expected: T): void {
  if (actual !== expected) {
    assert.fail(`native compatibility check failed: ${label}`);
  }
}

function assertPresent<T>(label: string, value: T | null | undefined): T {
  if (value === null || value === undefined) {
    assert.fail(`native compatibility check failed: ${label}`);
  }
  return value;
}

function trackDb(db: ReturnType<typeof createDb>): ManagedDb {
  const managed = db as ManagedDb;
  openDbs.push(managed);
  return managed;
}

function closeTrackedDb(db: ManagedDb): void {
  const index = openDbs.indexOf(db);
  if (index >= 0) {
    openDbs.splice(index, 1);
  }
  db.$client.close();
}

async function makeTempDbPath(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "nutrition-native-db-"));
  tempDirs.add(dir);
  return path.join(dir, "nutrition.db");
}

afterEach(async () => {
  for (const db of openDbs.splice(0)) {
    db.$client.close();
  }

  for (const dir of tempDirs) {
    await rm(dir, { recursive: true, force: true });
  }
  tempDirs.clear();
});

describe("sharp native compatibility", () => {
  it("sharp accepts generated jpeg/png/webp", async () => {
    await assertCheck(
      "sharp accepts generated jpeg",
      await validateImageBytes(fixtureBuffer(validJpegBytes()), "image/jpeg"),
      true,
    );
    await assertCheck(
      "sharp accepts generated png",
      await validateImageBytes(fixtureBuffer(validPngBytes()), "image/png"),
      true,
    );
    await assertCheck(
      "sharp accepts generated webp",
      await validateImageBytes(fixtureBuffer(validWebpBytes()), "image/webp"),
      true,
    );
  });

  it("sharp rejects non-image bytes", async () => {
    await assertCheck(
      "sharp rejects non-image bytes",
      await validateImageBytes(Buffer.from("not an image", "utf8"), "image/jpeg"),
      false,
    );
  });

  it("sharp rejects jpeg-as-png", async () => {
    await assertCheck(
      "sharp rejects jpeg-as-png",
      await validateImageBytes(fixtureBuffer(validJpegBytes()), "image/png"),
      false,
    );
  });

  it("sharp rejects png-as-jpeg", async () => {
    await assertCheck(
      "sharp rejects png-as-jpeg",
      await validateImageBytes(fixtureBuffer(validPngBytes()), "image/jpeg"),
      false,
    );
  });

  it("sharp rejects webp-as-jpeg", async () => {
    await assertCheck(
      "sharp rejects webp-as-jpeg",
      await validateImageBytes(fixtureBuffer(validWebpBytes()), "image/jpeg"),
      false,
    );
  });
});

describe("better-sqlite3 native compatibility", () => {
  it("migrates, writes, closes, reopens, and reads grouped meal data", async () => {
    const dbPath = await makeTempDbPath();

    await runMigrations(dbPath);

    const db = trackDb(createDb(dbPath));
    const device = await createDeviceService(db).createDevice("fat_loss");
    const createdMeal = await createMealTransactionsService(db).createTransaction(device.deviceId, {
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
        {
          foodName: "無糖豆漿",
          calories: 180,
          protein: 12,
          carbs: 14,
          fat: 8,
        },
        {
          foodName: "燙青菜",
          calories: 90,
          protein: 4,
          carbs: 12,
          fat: 3,
        },
      ],
    });

    closeTrackedDb(db);

    const reopenedDb = trackDb(createDb(dbPath));
    const persistedDevice = assertPresent(
      "sqlite device row persisted after reopen",
      (
        await reopenedDb
          .select({
            id: devices.id,
            goal: devices.goal,
            dailyCalories: devices.dailyCalories,
            dailyProtein: devices.dailyProtein,
            dailyCarbs: devices.dailyCarbs,
            dailyFat: devices.dailyFat,
          })
          .from(devices)
          .where(eq(devices.id, device.deviceId))
      )[0],
    );
    const persistedTransaction = assertPresent(
      "sqlite transaction row persisted after reopen",
      (
        await reopenedDb
          .select({
            id: mealTransactions.id,
            deviceId: mealTransactions.deviceId,
            currentRevisionId: mealTransactions.currentRevisionId,
            currentRevisionNumber: mealTransactions.currentRevisionNumber,
            mealPeriod: mealTransactions.mealPeriod,
          })
          .from(mealTransactions)
          .where(eq(mealTransactions.id, createdMeal.transactionId))
      )[0],
    );
    const persistedRevision = assertPresent(
      "sqlite revision row persisted after reopen",
      (
        await reopenedDb
          .select({
            id: mealRevisions.id,
            transactionId: mealRevisions.transactionId,
            revisionNumber: mealRevisions.revisionNumber,
            changeType: mealRevisions.changeType,
          })
          .from(mealRevisions)
          .where(eq(mealRevisions.id, createdMeal.revisionId))
      )[0],
    );
    const persistedItems = await reopenedDb
      .select({
        position: mealRevisionItems.position,
        foodName: mealRevisionItems.foodName,
        calories: mealRevisionItems.calories,
        protein: mealRevisionItems.protein,
        carbs: mealRevisionItems.carbs,
        fat: mealRevisionItems.fat,
      })
      .from(mealRevisionItems)
      .where(eq(mealRevisionItems.revisionId, createdMeal.revisionId))
      .orderBy(asc(mealRevisionItems.position));

    assertValue("sqlite device id after reopen", persistedDevice.id, device.deviceId);
    assertValue("sqlite device goal after reopen", persistedDevice.goal, "fat_loss");
    assertValue("sqlite device calories target after reopen", persistedDevice.dailyCalories, 1500);
    assertValue("sqlite device protein target after reopen", persistedDevice.dailyProtein, 120);
    assertValue("sqlite device carbs target after reopen", persistedDevice.dailyCarbs, 150);
    assertValue("sqlite device fat target after reopen", persistedDevice.dailyFat, 50);

    assertValue(
      "sqlite transaction id after reopen",
      persistedTransaction.id,
      createdMeal.transactionId,
    );
    assertValue(
      "sqlite transaction device after reopen",
      persistedTransaction.deviceId,
      device.deviceId,
    );
    assertValue(
      "sqlite transaction current revision id after reopen",
      persistedTransaction.currentRevisionId,
      createdMeal.revisionId,
    );
    assertValue(
      "sqlite transaction current revision number after reopen",
      persistedTransaction.currentRevisionNumber,
      1,
    );
    assertValue("sqlite transaction meal period after reopen", persistedTransaction.mealPeriod, "lunch");

    assertValue("sqlite revision id after reopen", persistedRevision.id, createdMeal.revisionId);
    assertValue(
      "sqlite revision transaction id after reopen",
      persistedRevision.transactionId,
      createdMeal.transactionId,
    );
    assertValue("sqlite revision number after reopen", persistedRevision.revisionNumber, 1);
    assertValue("sqlite revision change type after reopen", persistedRevision.changeType, "create");

    assertValue("sqlite grouped item count after reopen", persistedItems.length, 3);

    const firstItem = assertPresent("sqlite grouped item 0 after reopen", persistedItems[0]);
    const secondItem = assertPresent("sqlite grouped item 1 after reopen", persistedItems[1]);
    const thirdItem = assertPresent("sqlite grouped item 2 after reopen", persistedItems[2]);

    assertValue("sqlite grouped item 0 position after reopen", firstItem.position, 0);
    assertValue("sqlite grouped item 0 food after reopen", firstItem.foodName, "雞腿便當");
    assertValue("sqlite grouped item 0 calories after reopen", firstItem.calories, 720);
    assertValue("sqlite grouped item 0 protein after reopen", firstItem.protein, 38);
    assertValue("sqlite grouped item 0 carbs after reopen", firstItem.carbs, 82);
    assertValue("sqlite grouped item 0 fat after reopen", firstItem.fat, 24);

    assertValue("sqlite grouped item 1 position after reopen", secondItem.position, 1);
    assertValue("sqlite grouped item 1 food after reopen", secondItem.foodName, "無糖豆漿");
    assertValue("sqlite grouped item 1 calories after reopen", secondItem.calories, 180);
    assertValue("sqlite grouped item 1 protein after reopen", secondItem.protein, 12);
    assertValue("sqlite grouped item 1 carbs after reopen", secondItem.carbs, 14);
    assertValue("sqlite grouped item 1 fat after reopen", secondItem.fat, 8);

    assertValue("sqlite grouped item 2 position after reopen", thirdItem.position, 2);
    assertValue("sqlite grouped item 2 food after reopen", thirdItem.foodName, "燙青菜");
    assertValue("sqlite grouped item 2 calories after reopen", thirdItem.calories, 90);
    assertValue("sqlite grouped item 2 protein after reopen", thirdItem.protein, 4);
    assertValue("sqlite grouped item 2 carbs after reopen", thirdItem.carbs, 12);
    assertValue("sqlite grouped item 2 fat after reopen", thirdItem.fat, 3);

    const totals = persistedItems.reduce(
      (sum, item) => ({
        calories: sum.calories + item.calories,
        protein: sum.protein + item.protein,
        carbs: sum.carbs + item.carbs,
        fat: sum.fat + item.fat,
      }),
      { calories: 0, protein: 0, carbs: 0, fat: 0 },
    );

    assertValue("sqlite grouped item calories total after reopen", totals.calories, 990);
    assertValue("sqlite grouped item protein total after reopen", totals.protein, 54);
    assertValue("sqlite grouped item carbs total after reopen", totals.carbs, 108);
    assertValue("sqlite grouped item fat total after reopen", totals.fat, 35);
  });
});
