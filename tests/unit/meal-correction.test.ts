process.env.TZ = "Asia/Taipei";

import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createDb } from "../../server/db/client.js";
import { eq } from "drizzle-orm";
import { mealRevisions, mealTransactions } from "../../server/db/schema.js";
import { createDeviceService } from "../../server/services/device.js";
import { createFoodLoggingService } from "../../server/services/food-logging.js";
import {
  createMealCorrectionService,
  MAX_RECONCILIATION_STEPS,
} from "../../server/services/meal-correction.js";
import { DEFAULT_SESSION_ID } from "../../server/services/turn-state.js";
import { MealRevisionPreconditionError } from "../../server/services/meal-transactions.js";

const REAL_DATE = Date;
const FIXED_NOW = new REAL_DATE("2026-04-19T12:00:00+08:00");
const MACRO_ROUNDING_TOLERANCE = 0.001;

class FixedDate extends REAL_DATE {
  constructor(...args: any[]) {
    switch (args.length) {
      case 0:
        super(FIXED_NOW);
        break;
      case 1:
        super(args[0]);
        break;
      case 2:
        super(args[0], args[1]);
        break;
      case 3:
        super(args[0], args[1], args[2]);
        break;
      case 4:
        super(args[0], args[1], args[2], args[3]);
        break;
      case 5:
        super(args[0], args[1], args[2], args[3], args[4]);
        break;
      case 6:
        super(args[0], args[1], args[2], args[3], args[4], args[5]);
        break;
      default:
        super(args[0], args[1], args[2], args[3], args[4], args[5], args[6]);
    }
  }

  static now(): number {
    return FIXED_NOW.getTime();
  }
}

describe("meal correction service", () => {
  let db: ReturnType<typeof createDb>;
  let deviceId: string;
  let foreignDeviceId: string;
  let foodLoggingService: ReturnType<typeof createFoodLoggingService>;
  let mealCorrectionService: ReturnType<typeof createMealCorrectionService>;

  beforeEach(async () => {
    globalThis.Date = FixedDate as DateConstructor;
    db = createDb(":memory:");
    const deviceService = createDeviceService(db);
    foodLoggingService = createFoodLoggingService(db);
    mealCorrectionService = createMealCorrectionService(db);
    deviceId = (await deviceService.createDevice("fat_loss")).deviceId;
    foreignDeviceId = (await deviceService.createDevice("muscle_gain")).deviceId;
  });

  afterEach(() => {
    globalThis.Date = REAL_DATE;
  });

  it("resolves recent-reference shorthand to the latest active meal", async () => {
    await foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-04-19T08:00:00.000Z",
      items: [
        { foodName: "燕麥", calories: 220, protein: 10, carbs: 35, fat: 4 },
      ],
    });
    const latest = await foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-04-19T12:30:00.000Z",
      items: [
        { foodName: "雞腿飯", calories: 680, protein: 32, carbs: 84, fat: 22 },
      ],
    });

    const result = await mealCorrectionService.findMeals({
      deviceId,
      sessionId: DEFAULT_SESSION_ID,
      action: "update",
      query: "把剛剛那筆改成 500 卡",
    });

    assert.equal(result.status, "resolved");
    assert.equal(result.resolvedMealId, latest.id);
    assert.equal(result.mealRevisionId, latest.mealRevisionId);
    assert.equal(result.candidate.foodName, "雞腿飯");
    assert.equal(result.candidate.itemCount, 1);
  });

  it("uses recent-reference shorthand as a recency tie-breaker instead of overriding a named food target", async () => {
    const target = await foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-04-19T12:00:00.000Z",
      items: [
        { foodName: "雞腿", calories: 220, protein: 24, carbs: 0, fat: 9 },
      ],
    });
    await foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-04-19T12:30:00.000Z",
      items: [
        { foodName: "雞胸肉", calories: 220, protein: 30, carbs: 0, fat: 5 },
      ],
    });
    await foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-04-19T13:00:00.000Z",
      items: [
        { foodName: "雞胸肉", calories: 220, protein: 31, carbs: 0, fat: 5 },
      ],
    });

    const result = await mealCorrectionService.findMeals({
      deviceId,
      sessionId: DEFAULT_SESSION_ID,
      action: "update",
      query: "幫我把剛剛的雞腿蛋白質降低，我覺得沒這麼高",
    });

    assert.equal(result.status, "resolved");
    assert.equal(result.resolvedMealId, target.id);
    assert.equal(result.candidate.foodName, "雞腿");
  });

  it("keeps a uniquely resolved target available for the next vague follow-up turn", async () => {
    const target = await foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-04-19T12:00:00.000Z",
      items: [
        { foodName: "雞腿", calories: 220, protein: 24, carbs: 0, fat: 9 },
      ],
    });

    const firstPass = await mealCorrectionService.findMeals({
      deviceId,
      sessionId: DEFAULT_SESSION_ID,
      action: "update",
      query: "幫我把剛剛的雞腿蛋白質降低，我覺得沒這麼高",
    });

    assert.equal(firstPass.status, "resolved");
    assert.equal(firstPass.resolvedMealId, target.id);

    const secondPass = await mealCorrectionService.findMeals({
      deviceId,
      sessionId: DEFAULT_SESSION_ID,
      action: "update",
      query: "正常平均幾g就幾g",
    });

    assert.equal(secondPass.status, "resolved");
    assert.equal(secondPass.resolvedMealId, target.id);
    assert.equal(secondPass.fromPending, true);
  });

  it("accepts shared historical date phrases for meal targeting", async () => {
    const marchMeal = await foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-03-25T04:00:00.000Z",
      items: [
        { foodName: "雞腿飯", calories: 650, protein: 30, carbs: 80, fat: 20 },
      ],
    });
    const lastFridayMeal = await foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-04-10T10:30:00.000Z",
      items: [
        { foodName: "牛肉麵", calories: 520, protein: 24, carbs: 68, fat: 16 },
      ],
    });
    await foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-04-19T04:30:00.000Z",
      items: [
        { foodName: "雞腿飯", calories: 620, protein: 28, carbs: 76, fat: 18 },
      ],
    });

    const slashDateResult = await mealCorrectionService.findMeals({
      deviceId,
      sessionId: DEFAULT_SESSION_ID,
      action: "update",
      query: "把 3/25 的雞腿飯改成 500 卡",
    });
    assert.equal(slashDateResult.status, "resolved");
    assert.equal(slashDateResult.resolvedMealId, marchMeal.id);
    assert.equal(slashDateResult.candidate.dateKey, "2026-03-25");
    await mealCorrectionService.clearPendingSelection({
      deviceId,
      sessionId: DEFAULT_SESSION_ID,
    });

    const relativeWeekResult = await mealCorrectionService.findMeals({
      deviceId,
      sessionId: DEFAULT_SESSION_ID,
      action: "delete",
      query: "把上週五的牛肉麵刪掉",
    });
    assert.equal(relativeWeekResult.status, "resolved");
    assert.equal(relativeWeekResult.resolvedMealId, lastFridayMeal.id);
    assert.equal(relativeWeekResult.candidate.dateKey, "2026-04-10");
  });

  it("clarifies unsupported or multi-date mutation targets instead of defaulting to today", async () => {
    await foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-04-19T04:00:00.000Z",
      items: [
        { foodName: "雞腿飯", calories: 650, protein: 30, carbs: 80, fat: 20 },
      ],
    });

    const unsupported = await mealCorrectionService.findMeals({
      deviceId,
      sessionId: DEFAULT_SESSION_ID,
      action: "delete",
      query: "把前幾天的雞腿飯刪掉",
    });
    assert.equal(unsupported.status, "needs_clarification");
    assert.match(unsupported.prompt, /再說一次日期|哪一天/);

    const multiDate = await mealCorrectionService.findMeals({
      deviceId,
      sessionId: DEFAULT_SESSION_ID,
      action: "delete",
      query: "把昨天和前天的雞腿飯刪掉",
    });
    assert.equal(multiDate.status, "needs_clarification");
    assert.match(multiDate.prompt, /一個日期|哪一天/);
  });

  it("supports partial single-item updates by preserving unspecified fields", async () => {
    const original = await foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-04-19T12:00:00.000Z",
      items: [
        { foodName: "雞腿", calories: 220, protein: 24, carbs: 0, fat: 9 },
      ],
    });

    const result = await mealCorrectionService.updateMeal(deviceId, original.id, {
      patch: { protein: 22 },
    }, original.mealRevisionId);

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
    }, grouped.mealRevisionId);

    assert.equal(result.updatedMeal.foodName, "雞胸肉、白飯、花椰菜");
    assert.equal(result.updatedMeal.itemCount, 3);
    assert.equal(result.updatedMeal.calories, 450);
    assert.equal(result.updatedMeal.protein, 22);
    assert.equal(result.updatedMeal.carbs, 48);
    assert.equal(result.updatedMeal.fat, 6);
  });

  it("rejects non-finite, negative, and finite-huge numeric patches before revision writes", async () => {
    const grouped = await foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-04-19T12:00:00.000Z",
      items: [
        { foodName: "數值邊界一", calories: 220, protein: 30, carbs: 40, fat: 5 },
        { foodName: "數值邊界二", calories: 180, protein: 4, carbs: 8, fat: 1 },
      ],
    });
    const initialRevisions = await db.select().from(mealRevisions);

    for (const value of [Number.MAX_VALUE, Infinity, NaN, -1]) {
      await assert.rejects(
        () => mealCorrectionService.updateMeal(
          deviceId,
          grouped.id,
          { patch: { protein: value } },
          grouped.mealRevisionId,
        ),
        /MEAL_NUMERIC_PATCH_OUT_OF_RANGE/,
        `numeric patch ${String(value)} must fail closed`,
      );
    }

    const transaction = (await db
      .select()
      .from(mealTransactions)
      .where(eq(mealTransactions.id, grouped.id)))[0];
    const revisions = await db.select().from(mealRevisions);
    assert.equal(revisions.length, initialRevisions.length);
    assert.equal(transaction?.currentRevisionId, grouped.mealRevisionId);
  });

  it("rejects unsafe residual arithmetic before reconciliation can persist non-finite values", async () => {
    const grouped = await foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-04-19T12:00:00.000Z",
      items: [
        { foodName: "極大來源一", calories: 220, protein: Number.MAX_VALUE, carbs: 40, fat: 5 },
        { foodName: "極大來源二", calories: 180, protein: Number.MAX_VALUE, carbs: 8, fat: 1 },
      ],
    });
    const initialRevisions = await db.select().from(mealRevisions);

    await assert.rejects(
      () => mealCorrectionService.updateMeal(
        deviceId,
        grouped.id,
        { patch: { protein: 48 } },
        grouped.mealRevisionId,
      ),
      /MEAL_NUMERIC_RECONCILIATION_UNSAFE/,
    );

    const transaction = (await db
      .select()
      .from(mealTransactions)
      .where(eq(mealTransactions.id, grouped.id)))[0];
    const revisions = await db.select().from(mealRevisions);
    assert.equal(revisions.length, initialRevisions.length);
    assert.equal(transaction?.currentRevisionId, grouped.mealRevisionId);
  });

  it("fails closed when residual reconciliation would exceed the step ceiling", async () => {
    const itemCount = 200_003;
    const targetProtein = 100.001;
    const mealId = "reconciliation-ceiling-meal";
    const revisionId = `${mealId}:r1`;
    const createdAt = FIXED_NOW.toISOString();
    const loggedAt = "2026-04-19T12:00:00.000Z";
    const roundedPerItem = Math.round((targetProtein / itemCount) * 1000) / 1000;
    const expectedResidual = Math.round((targetProtein - roundedPerItem * itemCount) * 1000) / 1000;

    assert.equal(roundedPerItem, 0);
    assert.equal(expectedResidual, targetProtein);
    assert.ok(Math.round(Math.abs(expectedResidual) * 1000) > MAX_RECONCILIATION_STEPS);

    const insertFixture = db.$client.transaction(() => {
      db.$client
        .prepare(
          `INSERT INTO meal_transactions
             (id, device_id, logged_at, meal_period, current_revision_id, current_revision_number, deleted_at, created_at)
           VALUES (?, ?, ?, NULL, ?, 1, NULL, ?)`,
        )
        .run(mealId, deviceId, loggedAt, revisionId, createdAt);
      db.$client
        .prepare(
          `INSERT INTO meal_revisions
             (id, transaction_id, revision_number, supersedes_revision_id, image_asset_id, change_type, created_at)
           VALUES (?, ?, 1, NULL, NULL, 'create', ?)`,
        )
        .run(revisionId, mealId, createdAt);

      const insertItem = db.$client.prepare(
        `INSERT INTO meal_revision_items
           (revision_id, position, food_name, calories, protein, carbs, fat)
         VALUES (?, ?, ?, 0, 0, 0, 0)`,
      );
      for (let position = 0; position < itemCount; position += 1) {
        insertItem.run(revisionId, position, "ceiling fixture");
      }
    });
    insertFixture();

    const initialRevisions = await db.select().from(mealRevisions);
    const initialPersistedValues = db.$client
      .prepare(
        `SELECT position, food_name AS foodName, protein
           FROM meal_revision_items
          WHERE revision_id = ? AND position IN (0, ?)
          ORDER BY position`,
      )
      .all(revisionId, itemCount - 1);

    await assert.rejects(
      () => mealCorrectionService.updateMeal(
        deviceId,
        mealId,
        { patch: { protein: targetProtein } },
        revisionId,
      ),
      /MEAL_NUMERIC_RECONCILIATION_UNSAFE/,
    );

    const transaction = (await db
      .select()
      .from(mealTransactions)
      .where(eq(mealTransactions.id, mealId)))[0];
    const revisions = await db.select().from(mealRevisions);
    const persistedValues = db.$client
      .prepare(
        `SELECT position, food_name AS foodName, protein
           FROM meal_revision_items
          WHERE revision_id = ? AND position IN (0, ?)
          ORDER BY position`,
      )
      .all(revisionId, itemCount - 1);

    assert.equal(revisions.length, initialRevisions.length);
    assert.equal(transaction?.currentRevisionId, revisionId);
    assert.deepEqual(persistedValues, initialPersistedValues);
  });

  it("persists a tiny grouped target without negative residuals or final-slot catch-all", async () => {
    const grouped = await foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-04-19T12:00:00.000Z",
      items: [
        { foodName: "雞胸肉", calories: 100, protein: 1, carbs: 10, fat: 1 },
        { foodName: "白飯", calories: 100, protein: 1, carbs: 10, fat: 1 },
        { foodName: "花椰菜", calories: 100, protein: 1, carbs: 10, fat: 1 },
        { foodName: "滷蛋", calories: 100, protein: 1, carbs: 10, fat: 1 },
        { foodName: "豆腐", calories: 100, protein: 1, carbs: 10, fat: 1 },
        { foodName: "海帶", calories: 100, protein: 1, carbs: 10, fat: 1 },
      ],
    });

    const result = await mealCorrectionService.updateMeal(
      deviceId,
      grouped.id,
      { patch: { protein: 0.003 } },
      grouped.mealRevisionId,
    );
    const proteins = result.updatedMeal.items.map((item) => item.protein);

    assert.deepEqual(result.updatedMeal.items.map((item) => item.name), [
      "雞胸肉",
      "白飯",
      "花椰菜",
      "滷蛋",
      "豆腐",
      "海帶",
    ]);
    assert.ok(proteins.every((value) => Number.isFinite(value) && value >= 0));
    assert.ok(Math.abs(proteins.reduce((sum, value) => sum + value, 0) - 0.003) <= MACRO_ROUNDING_TOLERANCE);
    assert.ok(proteins.filter((value) => value > 0).length >= 2);
    assert.notEqual(proteins.at(-1), 0.003);
    assert.equal(result.updatedMeal.protein, 0.003);
  });

  it("keeps exact zero grouped targets finite and non-negative", async () => {
    const grouped = await foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-04-19T12:00:00.000Z",
      items: [
        { foodName: "雞腿", calories: 220, protein: 24, carbs: 0, fat: 9 },
        { foodName: "白飯", calories: 280, protein: 4, carbs: 62, fat: 0.5 },
        { foodName: "滷蛋", calories: 90, protein: 7, carbs: 2, fat: 6 },
      ],
    });

    const result = await mealCorrectionService.updateMeal(
      deviceId,
      grouped.id,
      { patch: { protein: 0 } },
      grouped.mealRevisionId,
    );

    assert.deepEqual(result.updatedMeal.items.map((item) => item.protein), [0, 0, 0]);
    assert.equal(result.updatedMeal.protein, 0);
  });

  it("keeps a mixed-zero source item at zero while reconciling positive weights", async () => {
    const grouped = await foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-04-19T12:00:00.000Z",
      items: [
        { foodName: "零蛋白菜", calories: 50, protein: 0, carbs: 8, fat: 1 },
        { foodName: "豆腐", calories: 100, protein: 1, carbs: 4, fat: 3 },
        { foodName: "雞胸肉", calories: 200, protein: 3, carbs: 0, fat: 5 },
      ],
    });

    const result = await mealCorrectionService.updateMeal(
      deviceId,
      grouped.id,
      { patch: { protein: 1.01 } },
      grouped.mealRevisionId,
    );
    const proteins = result.updatedMeal.items.map((item) => item.protein);

    assert.deepEqual(result.updatedMeal.items.map((item) => item.name), [
      "零蛋白菜",
      "豆腐",
      "雞胸肉",
    ]);
    assert.equal(proteins[0], 0);
    assert.ok(proteins.slice(1).every((value) => value >= 0));
    assert.ok(Math.abs(proteins.reduce((sum, value) => sum + value, 0) - 1.01) <= MACRO_ROUNDING_TOLERANCE);
    assert.equal(result.updatedMeal.protein, 1.01);
  });

  it("retains proportional weighting for positive source totals through persistence", async () => {
    const grouped = await foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-04-19T12:00:00.000Z",
      items: [
        { foodName: "比例一", calories: 100, protein: 1, carbs: 10, fat: 1 },
        { foodName: "比例二", calories: 100, protein: 3, carbs: 10, fat: 1 },
        { foodName: "比例三", calories: 100, protein: 6, carbs: 10, fat: 1 },
      ],
    });

    const result = await mealCorrectionService.updateMeal(
      deviceId,
      grouped.id,
      { patch: { protein: 2.001 } },
      grouped.mealRevisionId,
    );
    const proteins = result.updatedMeal.items.map((item) => item.protein);

    assert.deepEqual(result.updatedMeal.items.map((item) => item.name), ["比例一", "比例二", "比例三"]);
    assert.deepEqual(proteins, [0.2, 0.6, 1.201]);
    assert.ok(proteins.every((value) => Number.isFinite(value) && value >= 0));
    assert.ok(Math.abs(proteins.reduce((sum, value) => sum + value, 0) - 2.001) <= MACRO_ROUNDING_TOLERANCE);
    assert.ok(Math.abs(proteins[0]! - (2.001 * 1) / 10) <= MACRO_ROUNDING_TOLERANCE);
    assert.ok(Math.abs(proteins[1]! - (2.001 * 3) / 10) <= MACRO_ROUNDING_TOLERANCE);
    assert.ok(Math.abs(proteins[2]! - (2.001 * 6) / 10) <= MACRO_ROUNDING_TOLERANCE);
  });

  it("uses equal fallback only for all-zero source totals and reconciles one step stably", async () => {
    const grouped = await foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-04-19T12:00:00.000Z",
      items: [
        { foodName: "零一", calories: 100, protein: 0, carbs: 10, fat: 1 },
        { foodName: "零二", calories: 100, protein: 0, carbs: 10, fat: 1 },
        { foodName: "零三", calories: 100, protein: 0, carbs: 10, fat: 1 },
      ],
    });

    const result = await mealCorrectionService.updateMeal(
      deviceId,
      grouped.id,
      { patch: { protein: 1.001 } },
      grouped.mealRevisionId,
    );
    const proteins = result.updatedMeal.items.map((item) => item.protein);

    assert.deepEqual(result.updatedMeal.items.map((item) => item.name), ["零一", "零二", "零三"]);
    assert.deepEqual(proteins, [0.333, 0.334, 0.334]);
    assert.ok(proteins.every((value) => Number.isFinite(value) && value >= 0));
    assert.ok(Math.abs(proteins.reduce((sum, value) => sum + value, 0) - 1.001) <= MACRO_ROUNDING_TOLERANCE);
    assert.ok(Math.round((Math.max(...proteins) - Math.min(...proteins)) * 1000) / 1000 <= MACRO_ROUNDING_TOLERANCE);
  });

  it("keeps single-item targets exact and handles zero and adjacent rounding boundaries", async () => {
    const single = await foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-04-19T12:00:00.000Z",
      items: [{ foodName: "單項", calories: 100, protein: 9, carbs: 10, fat: 1 }],
    });
    const singleResult = await mealCorrectionService.updateMeal(
      deviceId,
      single.id,
      { patch: { protein: 1.234 } },
      single.mealRevisionId,
    );
    assert.deepEqual(singleResult.updatedMeal.items.map((item) => item.protein), [1.234]);
    assert.equal(singleResult.updatedMeal.protein, 1.234);

    const expectedByTarget = new Map<number, number[]>([
      [0, [0, 0, 0]],
      [0.002, [0, 0.001, 0.001]],
      [0.003, [0.001, 0.001, 0.001]],
      [0.004, [0.002, 0.001, 0.001]],
    ]);
    for (const [target, expected] of expectedByTarget) {
      const grouped = await foodLoggingService.logGroupedMeal(deviceId, {
        loggedAt: "2026-04-19T12:00:00.000Z",
        items: [
          { foodName: `邊界${target}-一`, calories: 100, protein: 1, carbs: 10, fat: 1 },
          { foodName: `邊界${target}-二`, calories: 100, protein: 1, carbs: 10, fat: 1 },
          { foodName: `邊界${target}-三`, calories: 100, protein: 1, carbs: 10, fat: 1 },
        ],
      });
      const result = await mealCorrectionService.updateMeal(
        deviceId,
        grouped.id,
        { patch: { protein: target } },
        grouped.mealRevisionId,
      );
      const proteins = result.updatedMeal.items.map((item) => item.protein);

      assert.deepEqual(proteins, expected);
      assert.ok(proteins.every((value) => Number.isFinite(value) && value >= 0));
      assert.ok(Math.abs(proteins.reduce((sum, value) => sum + value, 0) - target) <= MACRO_ROUNDING_TOLERANCE);
    }
  });

  it("adjusts equal candidates in insertion order instead of assigning the residual to the final item", async () => {
    const grouped = await foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-04-19T12:00:00.000Z",
      items: [
        { foodName: "平手一", calories: 100, protein: 1, carbs: 10, fat: 1 },
        { foodName: "平手二", calories: 100, protein: 1, carbs: 10, fat: 1 },
        { foodName: "平手三", calories: 100, protein: 1, carbs: 10, fat: 1 },
        { foodName: "平手四", calories: 100, protein: 1, carbs: 10, fat: 1 },
      ],
    });

    const result = await mealCorrectionService.updateMeal(
      deviceId,
      grouped.id,
      { patch: { protein: 0.002 } },
      grouped.mealRevisionId,
    );
    const proteins = result.updatedMeal.items.map((item) => item.protein);

    assert.deepEqual(result.updatedMeal.items.map((item) => item.name), ["平手一", "平手二", "平手三", "平手四"]);
    assert.deepEqual(proteins, [0, 0, 0.001, 0.001]);
    assert.notEqual(proteins.at(-1), 0.002);
    assert.ok(Math.abs(proteins.reduce((sum, value) => sum + value, 0) - 0.002) <= MACRO_ROUNDING_TOLERANCE);
  });

  it("executes the prior final-slot negative control against the persisted residual fixture", async () => {
    const sourceValues = [1, 1, 1, 1, 1, 1];
    const target = 0.003;
    const sourceTotal = sourceValues.reduce((sum, value) => sum + value, 0);
    const rounded = sourceValues.map((value) => Math.round(target * (value / sourceTotal) * 1000) / 1000);
    const oldFinalSlot = Math.round((target - rounded.slice(0, -1).reduce((sum, value) => sum + value, 0)) * 1000) / 1000;

    assert.equal(oldFinalSlot, -0.002);
    assert.ok(oldFinalSlot < 0, "the old final-slot-only algorithm violates non-negative values");

    const grouped = await foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-04-19T12:00:00.000Z",
      items: sourceValues.map((protein, index) => ({
        foodName: `負值控制${index + 1}`,
        calories: 100,
        protein,
        carbs: 10,
        fat: 1,
      })),
    });
    const result = await mealCorrectionService.updateMeal(
      deviceId,
      grouped.id,
      { patch: { protein: target } },
      grouped.mealRevisionId,
    );
    const proteins = result.updatedMeal.items.map((item) => item.protein);

    assert.deepEqual(proteins, [0, 0, 0, 0.001, 0.001, 0.001]);
    assert.ok(proteins.every((value) => Number.isFinite(value) && value >= 0));
    assert.ok(Math.abs(proteins.reduce((sum, value) => sum + value, 0) - target) <= MACRO_ROUNDING_TOLERANCE);
  });

  it("keeps empty grouped replacements on the existing MEAL_ITEMS_REQUIRED backstop", async () => {
    const grouped = await foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-04-19T12:00:00.000Z",
      items: [{ foodName: "保留項目", calories: 100, protein: 1, carbs: 10, fat: 1 }],
    });

    await assert.rejects(
      () => mealCorrectionService.updateMeal(deviceId, grouped.id, { items: [] }, grouped.mealRevisionId),
      /MEAL_ITEMS_REQUIRED/,
    );
  });

  it("resolves a named grouped item instead of an unrelated meal-period-only candidate", async () => {
    const grouped = await foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-04-19T09:30:00.000Z",
      items: [
        { foodName: "雞腿", calories: 260, protein: 24, carbs: 0, fat: 12 },
        { foodName: "白飯", calories: 280, protein: 4, carbs: 62, fat: 0.5 },
        { foodName: "滷蛋", calories: 90, protein: 7, carbs: 2, fat: 6 },
        { foodName: "青菜", calories: 80, protein: 2, carbs: 10, fat: 4 },
      ],
    });
    const unrelatedLunch = await foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-04-19T04:30:00.000Z",
      items: [
        { foodName: "蛋餅", calories: 330, protein: 12, carbs: 38, fat: 14 },
      ],
    });

    const itemOnly = await mealCorrectionService.findMeals({
      deviceId,
      sessionId: DEFAULT_SESSION_ID,
      action: "update",
      query: "滷蛋改成兩顆水煮蛋",
    });
    assert.equal(itemOnly.status, "resolved");
    assert.equal(itemOnly.resolvedMealId, grouped.id);
    assert.notEqual(itemOnly.resolvedMealId, unrelatedLunch.id);
    await mealCorrectionService.clearPendingSelection({
      deviceId,
      sessionId: DEFAULT_SESSION_ID,
    });

    const withModelPeriodHint = await mealCorrectionService.findMeals({
      deviceId,
      sessionId: DEFAULT_SESSION_ID,
      action: "update",
      query: "把中午雞腿便當的滷蛋改成兩顆水煮蛋",
    });
    assert.equal(withModelPeriodHint.status, "resolved");
    assert.equal(withModelPeriodHint.resolvedMealId, grouped.id);
    assert.notEqual(withModelPeriodHint.resolvedMealId, unrelatedLunch.id);
    assert.equal(withModelPeriodHint.candidate.foodName, "雞腿、白飯、滷蛋、青菜");
  });

  it("clarifies instead of resolving a period-only candidate when named food terms are unmatched", async () => {
    await foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-04-19T04:30:00.000Z",
      items: [
        { foodName: "蛋餅", calories: 330, protein: 12, carbs: 38, fat: 14 },
      ],
    });

    const result = await mealCorrectionService.findMeals({
      deviceId,
      sessionId: DEFAULT_SESSION_ID,
      action: "update",
      query: "把中午鴨腿便當改成 500 卡",
    });

    assert.equal(result.status, "needs_clarification");
    assert.match(result.prompt, /補充日期、餐別或食物名稱|不能確定/);
  });

  it("still allows meal-period-only targeting when the query has no named food terms", async () => {
    const lunch = await foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-04-19T04:30:00.000Z",
      items: [
        { foodName: "蛋餅", calories: 330, protein: 12, carbs: 38, fat: 14 },
      ],
    });
    await foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-04-19T00:00:00.000Z",
      items: [
        { foodName: "燕麥", calories: 220, protein: 10, carbs: 35, fat: 4 },
      ],
    });

    const result = await mealCorrectionService.findMeals({
      deviceId,
      sessionId: DEFAULT_SESSION_ID,
      action: "delete",
      query: "把今天午餐那餐刪掉",
    });

    assert.equal(result.status, "resolved");
    assert.equal(result.resolvedMealId, lunch.id);
  });

  it("projects explicit persisted mealPeriod and source for correction candidates", async () => {
    const lunch = await foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-04-19T00:30:00.000Z",
      mealPeriod: "lunch",
      items: [
        { foodName: "雞腿便當", calories: 680, protein: 32, carbs: 84, fat: 22 },
      ],
    });

    const result = await mealCorrectionService.findMeals({
      deviceId,
      sessionId: DEFAULT_SESSION_ID,
      action: "update",
      query: "把午餐那餐改成 600 卡",
    });

    assert.equal(result.status, "resolved");
    assert.equal(result.resolvedMealId, lunch.id);
    assert.equal(result.candidate.mealPeriod, "lunch");
    assert.equal(result.candidate.mealPeriodSource, "explicit");
  });

  it("projects inferred mealPeriod source for legacy correction candidates", async () => {
    const breakfast = await foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-04-19T00:30:00.000Z",
      items: [
        { foodName: "燕麥", calories: 220, protein: 10, carbs: 35, fat: 4 },
      ],
    });

    const result = await mealCorrectionService.findMeals({
      deviceId,
      sessionId: DEFAULT_SESSION_ID,
      action: "delete",
      query: "把早餐那餐刪掉",
    });

    assert.equal(result.status, "resolved");
    assert.equal(result.resolvedMealId, breakfast.id);
    assert.equal(result.candidate.mealPeriod, "breakfast");
    assert.equal(result.candidate.mealPeriodSource, "inferred");
  });

  it("does not coerce snack wording to a late-night correction target", async () => {
    await foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-04-19T15:30:00+08:00",
      items: [
        { foodName: "鬆餅", calories: 320, protein: 7, carbs: 48, fat: 10 },
      ],
    });
    const lateNight = await foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-04-19T23:30:00+08:00",
      items: [
        { foodName: "鹽酥雞", calories: 520, protein: 24, carbs: 38, fat: 28 },
      ],
    });

    const result = await mealCorrectionService.findMeals({
      deviceId,
      sessionId: DEFAULT_SESSION_ID,
      action: "delete",
      query: "把今天下午茶那餐刪掉",
    });

    assert.notEqual(result.status === "resolved" ? result.resolvedMealId : undefined, lateNight.id);
    assert.equal(result.status, "needs_clarification");
  });

  it("does not reuse a pending late-night target for snack wording", async () => {
    await foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-04-19T15:30:00+08:00",
      items: [
        { foodName: "鬆餅", calories: 320, protein: 7, carbs: 48, fat: 10 },
      ],
    });
    const lateNight = await foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-04-19T23:30:00+08:00",
      items: [
        { foodName: "鹽酥雞", calories: 520, protein: 24, carbs: 38, fat: 28 },
      ],
    });

    const pendingSeed = await mealCorrectionService.findMeals({
      deviceId,
      sessionId: DEFAULT_SESSION_ID,
      action: "delete",
      query: "把宵夜那餐刪掉",
    });
    assert.equal(pendingSeed.status, "resolved");
    assert.equal(pendingSeed.resolvedMealId, lateNight.id);

    const result = await mealCorrectionService.findMeals({
      deviceId,
      sessionId: DEFAULT_SESSION_ID,
      action: "delete",
      query: "把今天下午茶那餐刪掉",
    });

    assert.notEqual(result.status === "resolved" ? result.resolvedMealId : undefined, lateNight.id);
    assert.equal(result.status, "needs_clarification");
  });

  it("does not reuse a pending late-night target for snack wording with the same food label", async () => {
    await foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-04-19T15:30:00+08:00",
      items: [
        { foodName: "蛋餅", calories: 320, protein: 12, carbs: 30, fat: 16 },
      ],
    });
    const lateNight = await foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-04-19T23:30:00+08:00",
      items: [
        { foodName: "蛋餅", calories: 360, protein: 13, carbs: 34, fat: 18 },
      ],
    });

    const pendingSeed = await mealCorrectionService.findMeals({
      deviceId,
      sessionId: DEFAULT_SESSION_ID,
      action: "delete",
      query: "把宵夜那餐刪掉",
    });
    assert.equal(pendingSeed.status, "resolved");
    assert.equal(pendingSeed.resolvedMealId, lateNight.id);

    const result = await mealCorrectionService.findMeals({
      deviceId,
      sessionId: DEFAULT_SESSION_ID,
      action: "delete",
      query: "把今天下午茶蛋餅刪掉",
    });

    assert.notEqual(result.status === "resolved" ? result.resolvedMealId : undefined, lateNight.id);
    assert.equal(result.status, "needs_clarification");
  });

  it("Phase 67 D-01/D-09 hard-scopes an explicit date before considering newer matching candidates", async () => {
    const scopedMeal = await foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-04-18T04:00:00.000Z",
      items: [
        { foodName: "雞腿飯", calories: 650, protein: 30, carbs: 80, fat: 20 },
      ],
    });
    await foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-04-19T04:30:00.000Z",
      items: [
        { foodName: "雞腿飯", calories: 620, protein: 28, carbs: 76, fat: 18 },
      ],
    });

    const result = await mealCorrectionService.findMeals({
      deviceId,
      sessionId: DEFAULT_SESSION_ID,
      action: "update",
      query: "把 4/18 的雞腿飯改成 500 卡",
    });

    assert.equal(result.status, "resolved");
    assert.equal(result.resolvedMealId, scopedMeal.id);
    assert.equal(result.candidate.dateKey, "2026-04-18");
  });

  it("Phase 67 gap resolves an explicit historical-date meal before the newest candidate cap", async () => {
    const scopedMeal = await foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-04-18T04:00:00.000Z",
      items: [
        { foodName: "雞腿飯", calories: 650, protein: 30, carbs: 80, fat: 20 },
      ],
    });

    for (let index = 0; index < 21; index += 1) {
      await foodLoggingService.logGroupedMeal(deviceId, {
        loggedAt: `2026-04-19T${String(index).padStart(2, "0")}:00:00.000Z`,
        items: [
          { foodName: `新餐${index + 1}`, calories: 300 + index, protein: 10, carbs: 40, fat: 8 },
        ],
      });
    }

    const result = await mealCorrectionService.findMeals({
      deviceId,
      sessionId: DEFAULT_SESSION_ID,
      action: "update",
      query: "把 4/18 的雞腿飯改成 500 卡",
    });

    assert.equal(result.status, "resolved");
    assert.equal(result.resolvedMealId, scopedMeal.id);
    assert.equal(result.candidate.dateKey, "2026-04-18");
  });

  it("Phase 67 gap treats unmatched Latin food evidence as blocking weak period fallback", async () => {
    await foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-04-19T04:30:00.000Z",
      items: [
        { foodName: "蛋餅", calories: 330, protein: 12, carbs: 38, fat: 14 },
      ],
    });

    const result = await mealCorrectionService.findMeals({
      deviceId,
      sessionId: DEFAULT_SESSION_ID,
      action: "update",
      query: "把今天午餐 burger 改成 500 卡",
    });

    assert.notEqual(result.status, "resolved");
    assert.equal("resolvedMealId" in result, false);
  });

  it("Phase 67 D-07/D-08 explicit persisted mealPeriod outranks inferred loggedAt period", async () => {
    const explicitLunch = await foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-04-19T00:30:00.000Z",
      mealPeriod: "lunch",
      items: [
        { foodName: "雞腿便當", calories: 680, protein: 32, carbs: 84, fat: 22 },
      ],
    });
    const inferredLunch = await foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-04-19T04:30:00.000Z",
      items: [
        { foodName: "蛋餅", calories: 330, protein: 12, carbs: 38, fat: 14 },
      ],
    });

    const result = await mealCorrectionService.findMeals({
      deviceId,
      sessionId: DEFAULT_SESSION_ID,
      action: "update",
      query: "把今天午餐改成 600 卡",
    });

    assert.equal(result.status, "resolved");
    assert.equal(result.resolvedMealId, explicitLunch.id);
    assert.notEqual(result.resolvedMealId, inferredLunch.id);
    assert.equal(result.candidate.mealPeriod, "lunch");
    assert.equal(result.candidate.mealPeriodSource, "explicit");
  });

  it("Phase 67 D-16 resolves 午餐那餐 inside the lunch set instead of the newest non-matching meal", async () => {
    const lunch = await foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-04-19T04:30:00.000Z",
      items: [
        { foodName: "雞腿便當", calories: 680, protein: 32, carbs: 84, fat: 22 },
      ],
    });
    const dinner = await foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-04-19T11:30:00.000Z",
      items: [
        { foodName: "牛肉麵", calories: 520, protein: 24, carbs: 68, fat: 16 },
      ],
    });

    const result = await mealCorrectionService.findMeals({
      deviceId,
      sessionId: DEFAULT_SESSION_ID,
      action: "delete",
      query: "把今天午餐那餐刪掉",
    });

    assert.equal(result.status, "resolved");
    assert.equal(result.resolvedMealId, lunch.id);
    assert.notEqual(result.resolvedMealId, dinner.id);
  });

  it("Phase 67 D-18/D-20 narrows multiple item-label matches before period or recency and renders at most five numbered options", async () => {
    const matchedIds: string[] = [];
    for (let index = 0; index < 6; index += 1) {
      const meal = await foodLoggingService.logGroupedMeal(deviceId, {
        loggedAt: `2026-04-19T0${index}:30:00.000Z`,
        items: [
          { foodName: `主菜${index + 1}`, calories: 260, protein: 24, carbs: 0, fat: 12 },
          { foodName: "滷蛋", calories: 90, protein: 7, carbs: 2, fat: 6 },
        ],
      });
      matchedIds.push(meal.id);
    }
    const unrelatedLunch = await foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-04-19T04:45:00.000Z",
      items: [
        { foodName: "蛋餅", calories: 330, protein: 12, carbs: 38, fat: 14 },
      ],
    });

    const result = await mealCorrectionService.findMeals({
      deviceId,
      sessionId: DEFAULT_SESSION_ID,
      action: "update",
      query: "把今天午餐滷蛋改成兩顆水煮蛋",
    });

    assert.equal(result.status, "needs_clarification");
    assert.equal(result.candidates.length, 5);
    assert.ok(result.candidates.every((candidate) => matchedIds.includes(candidate.mealId)));
    assert.ok(result.candidates.every((candidate) => candidate.itemNames.includes("滷蛋")));
    assert.equal(result.candidates.some((candidate) => candidate.mealId === unrelatedLunch.id), false);
    assert.match(result.prompt, /1\./);
    assert.match(result.prompt, /5\./);
    assert.doesNotMatch(result.prompt, /6\./);
    assert.doesNotMatch(result.prompt, /蛋餅/);
  });

  it("Phase 67 D-19 does not fall back to a period-only candidate when a likely food label is unmatched", async () => {
    await foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-04-19T04:30:00.000Z",
      items: [
        { foodName: "蛋餅", calories: 330, protein: 12, carbs: 38, fat: 14 },
      ],
    });

    const result = await mealCorrectionService.findMeals({
      deviceId,
      sessionId: DEFAULT_SESSION_ID,
      action: "update",
      query: "把今天午餐鴨腿便當改成 500 卡",
    });

    assert.equal(result.status, "needs_clarification");
    assert.equal("resolvedMealId" in result, false);
    assert.match(result.prompt, /補充日期、餐別或食物名稱|不能確定/);
  });

  it("Phase 67 D-30/D-31 reuses clear single-date scope for same-date recovery choices without cross-date candidates", async () => {
    const sameDateLunch = await foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-04-18T04:30:00.000Z",
      items: [
        { foodName: "蛋餅", calories: 330, protein: 12, carbs: 38, fat: 14 },
      ],
    });
    const sameDateDinner = await foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-04-18T11:30:00.000Z",
      items: [
        { foodName: "牛肉麵", calories: 520, protein: 24, carbs: 68, fat: 16 },
      ],
    });
    await foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-04-19T04:30:00.000Z",
      items: [
        { foodName: "鴨胸飯", calories: 610, protein: 31, carbs: 72, fat: 18 },
      ],
    });

    const result = await mealCorrectionService.findMeals({
      deviceId,
      sessionId: DEFAULT_SESSION_ID,
      action: "update",
      query: "把 4/18 的鴨腿便當改成 500 卡",
    });

    assert.equal(result.status, "needs_clarification");
    assert.deepEqual(
      result.candidates.map((candidate) => candidate.mealId).sort(),
      [sameDateLunch.id, sameDateDinner.id].sort(),
    );
    assert.ok(result.candidates.every((candidate) => candidate.dateKey === "2026-04-18"));
    assert.match(result.prompt, /請直接回覆編號/);
    assert.match(result.prompt, /蛋餅/);
    assert.match(result.prompt, /牛肉麵/);
    assert.doesNotMatch(result.prompt, /鴨胸飯/);
    assert.doesNotMatch(result.prompt, /已更新|已刪除|成功/);
  });

  it("Phase 67 D-30 returns deterministic date-specific no-meals copy when a clear explicit date has no meals", async () => {
    await foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-04-19T04:00:00.000Z",
      items: [
        { foodName: "雞腿飯", calories: 650, protein: 30, carbs: 80, fat: 20 },
      ],
    });

    const result = await mealCorrectionService.findMeals({
      deviceId,
      sessionId: DEFAULT_SESSION_ID,
      action: "delete",
      query: "把 4/17 的鴨腿便當刪掉",
    });

    assert.equal(result.status, "needs_clarification");
    assert.deepEqual(result.candidates, []);
    assert.equal("resolvedMealId" in result, false);
    assert.match(result.prompt, /4\/17|2026-04-17/);
    assert.match(result.prompt, /沒有.*餐點|沒有紀錄/);
    assert.doesNotMatch(result.prompt, /雞腿飯/);
    assert.doesNotMatch(result.prompt, /已更新|已刪除|成功/);
  });

  it("rejects direct food_name patches for grouped meals", async () => {
    const grouped = await foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-04-19T12:00:00.000Z",
      items: [
        { foodName: "雞胸肉", calories: 220, protein: 30, carbs: 0, fat: 5 },
        { foodName: "白飯", calories: 180, protein: 4, carbs: 40, fat: 0.5 },
      ],
    });

    await assert.rejects(
      mealCorrectionService.updateMeal(deviceId, grouped.id, { patch: { foodName: "雞胸便當" } }, grouped.mealRevisionId),
      /MEAL_NAME_PATCH_REQUIRES_SINGLE_ITEM/,
    );
  });

  it("returns affectedDate for historical updates and keeps it in sync with dailySummary.date", async () => {
    const original = await foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-03-25T04:00:00.000Z",
      items: [
        { foodName: "雞腿飯", calories: 650, protein: 30, carbs: 80, fat: 20 },
      ],
    });

    const result = await mealCorrectionService.updateMeal(deviceId, original.id, {
      patch: { calories: 500 },
    }, original.mealRevisionId);

    assert.equal(result.affectedDate, "2026-03-25");
    assert.ok(result.dailySummary);
    assert.equal(result.dailySummary.date, result.affectedDate);
    assert.equal(result.updatedMeal.calories, 500);
  });

  it("returns committed update facts with recovered summaryOutcome when recompute fails", async () => {
    const localMealCorrectionService = createMealCorrectionService(db, {
      summaryService: {
        async getDailySummary() {
          throw new Error("summary recompute failed");
        },
      },
    });
    const original = await foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-03-25T04:00:00.000Z",
      items: [
        { foodName: "chicken rice", calories: 650, protein: 30, carbs: 80, fat: 20 },
      ],
    });

    const result = await localMealCorrectionService.updateMeal(deviceId, original.id, {
      patch: { calories: 500 },
    }, original.mealRevisionId);

    assert.equal(result.updatedMeal.id, original.id);
    assert.equal(result.updatedMeal.calories, 500);
    assert.equal(result.affectedDate, "2026-03-25");
    assert.equal(result.summaryOutcome.status, "recovered");
    assert.equal(result.summaryOutcome.reason, "recompute_failed");
    assert.equal(result.summaryOutcome.dailySummary.date, result.affectedDate);
    assert.equal(result.dailySummary, result.summaryOutcome.dailySummary);
    assert.notEqual(result.summaryOutcome.status, "publish_failed");
  });

  it("creates a pending clarification state when multiple meals match and resolves the next numbered reply", async () => {
    const first = await foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-04-19T04:00:00.000Z",
      items: [
        { foodName: "雞腿飯", calories: 650, protein: 30, carbs: 80, fat: 20 },
      ],
    });
    const second = await foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-04-19T04:30:00.000Z",
      items: [
        { foodName: "雞腿飯", calories: 620, protein: 29, carbs: 78, fat: 18 },
      ],
    });

    const firstPass = await mealCorrectionService.findMeals({
      deviceId,
      sessionId: DEFAULT_SESSION_ID,
      action: "delete",
      query: "把今天午餐的雞腿飯刪掉",
    });
    assert.equal(firstPass.status, "needs_clarification");
    assert.equal(firstPass.candidates.length, 2);
    assert.match(firstPass.prompt, /請直接回覆編號/);

    const secondPass = await mealCorrectionService.findMeals({
      deviceId,
      sessionId: DEFAULT_SESSION_ID,
      action: "delete",
      query: "第二個",
    });
    assert.equal(secondPass.status, "resolved");
    assert.equal(secondPass.action, "delete");
    assert.equal(secondPass.resolvedMealId, first.id);
    assert.notEqual(secondPass.resolvedMealId, second.id);
    assert.equal(secondPass.fromPending, true);
  });

  it("does not resolve a numbered reply from another session's pending selection", async () => {
    const older = await foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-04-19T04:00:00.000Z",
      items: [
        { foodName: "雞腿飯", calories: 650, protein: 30, carbs: 80, fat: 20 },
      ],
    });
    const newer = await foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-04-19T04:30:00.000Z",
      items: [
        { foodName: "雞腿飯", calories: 620, protein: 29, carbs: 78, fat: 18 },
      ],
    });

    const sessionAFirstPass = await mealCorrectionService.findMeals({
      deviceId,
      sessionId: "session-a",
      action: "delete",
      query: "把今天午餐的雞腿飯刪掉",
    });
    assert.equal(sessionAFirstPass.status, "needs_clarification");
    assert.deepEqual(sessionAFirstPass.candidates.map((candidate) => candidate.mealId), [newer.id, older.id]);

    const sessionBSelection = await mealCorrectionService.findMeals({
      deviceId,
      sessionId: "session-b",
      action: "delete",
      query: "1",
    });

    assert.equal(sessionBSelection.status, "not_found");
    assert.equal("fromPending" in sessionBSelection, false);
    assert.equal("resolvedMealId" in sessionBSelection, false);
  });

  it("keeps session A pending selection alive after session B numbered reply", async () => {
    const older = await foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-04-19T04:00:00.000Z",
      items: [
        { foodName: "雞腿飯", calories: 650, protein: 30, carbs: 80, fat: 20 },
      ],
    });
    const newer = await foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-04-19T04:30:00.000Z",
      items: [
        { foodName: "雞腿飯", calories: 620, protein: 29, carbs: 78, fat: 18 },
      ],
    });

    const sessionAFirstPass = await mealCorrectionService.findMeals({
      deviceId,
      sessionId: "session-a",
      action: "delete",
      query: "把今天午餐的雞腿飯刪掉",
    });
    assert.equal(sessionAFirstPass.status, "needs_clarification");
    await mealCorrectionService.findMeals({
      deviceId,
      sessionId: "session-b",
      action: "delete",
      query: "1",
    });

    const sessionASelection = await mealCorrectionService.findMeals({
      deviceId,
      sessionId: "session-a",
      action: "delete",
      query: "1",
    });

    assert.equal(sessionASelection.status, "resolved");
    assert.equal(sessionASelection.fromPending, true);
    assert.equal(sessionASelection.resolvedMealId, newer.id);
    assert.notEqual(sessionASelection.resolvedMealId, older.id);
  });

  it("does not clear session A pending selection from session B", async () => {
    const older = await foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-04-19T04:00:00.000Z",
      items: [
        { foodName: "雞腿飯", calories: 650, protein: 30, carbs: 80, fat: 20 },
      ],
    });
    const newer = await foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-04-19T04:30:00.000Z",
      items: [
        { foodName: "雞腿飯", calories: 620, protein: 29, carbs: 78, fat: 18 },
      ],
    });

    const sessionAFirstPass = await mealCorrectionService.findMeals({
      deviceId,
      sessionId: "session-a",
      action: "delete",
      query: "把今天午餐的雞腿飯刪掉",
    });
    assert.equal(sessionAFirstPass.status, "needs_clarification");

    await mealCorrectionService.clearPendingSelection({
      deviceId,
      sessionId: "session-b",
    });

    const sessionASelection = await mealCorrectionService.findMeals({
      deviceId,
      sessionId: "session-a",
      action: "delete",
      query: "1",
    });

    assert.equal(sessionASelection.status, "resolved");
    assert.equal(sessionASelection.fromPending, true);
    assert.equal(sessionASelection.resolvedMealId, newer.id);
    assert.notEqual(sessionASelection.resolvedMealId, older.id);
  });

  it("does not recover session A pending selection from session B", async () => {
    const older = await foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-04-19T04:00:00.000Z",
      items: [
        { foodName: "雞腿飯", calories: 650, protein: 30, carbs: 80, fat: 20 },
      ],
    });
    const newer = await foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-04-19T04:30:00.000Z",
      items: [
        { foodName: "雞腿飯", calories: 620, protein: 29, carbs: 78, fat: 18 },
      ],
    });

    const sessionAFirstPass = await mealCorrectionService.findMeals({
      deviceId,
      sessionId: "session-a",
      action: "delete",
      query: "把今天午餐的雞腿飯刪掉",
    });
    assert.equal(sessionAFirstPass.status, "needs_clarification");

    const sessionBRecovery = await mealCorrectionService.recoverStalePendingSelection({
      deviceId,
      sessionId: "session-b",
      action: "delete",
    });
    assert.equal(sessionBRecovery, undefined);

    const sessionASelection = await mealCorrectionService.findMeals({
      deviceId,
      sessionId: "session-a",
      action: "delete",
      query: "1",
    });

    assert.equal(sessionASelection.status, "resolved");
    assert.equal(sessionASelection.fromPending, true);
    assert.equal(sessionASelection.resolvedMealId, newer.id);
    assert.notEqual(sessionASelection.resolvedMealId, older.id);
  });

  it("Phase 67 D-22/D-23/D-24/D-38 re-shows the same rendered options with valid numbers for an invalid selection", async () => {
    const first = await foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-04-19T04:00:00.000Z",
      items: [
        { foodName: "雞腿飯", calories: 650, protein: 30, carbs: 80, fat: 20 },
      ],
    });
    const second = await foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-04-19T04:30:00.000Z",
      items: [
        { foodName: "雞腿飯", calories: 620, protein: 29, carbs: 78, fat: 18 },
      ],
    });

    const firstPass = await mealCorrectionService.findMeals({
      deviceId,
      sessionId: DEFAULT_SESSION_ID,
      action: "delete",
      query: "把今天午餐的雞腿飯刪掉",
    });
    assert.equal(firstPass.status, "needs_clarification");
    assert.deepEqual(firstPass.candidates.map((candidate) => candidate.mealId), [second.id, first.id]);

    const invalidSelection = await mealCorrectionService.findMeals({
      deviceId,
      sessionId: DEFAULT_SESSION_ID,
      action: "delete",
      query: "3",
    });

    assert.equal(invalidSelection.status, "needs_clarification");
    assert.deepEqual(invalidSelection.candidates.map((candidate) => candidate.mealId), [second.id, first.id]);
    assert.match(invalidSelection.prompt, /請直接回覆編號/);
    assert.match(invalidSelection.prompt, /1\..*雞腿飯/);
    assert.match(invalidSelection.prompt, /2\..*雞腿飯/);
    assert.match(invalidSelection.prompt, /有效編號.*1.*2|只能回覆.*1.*2|請回覆 1 或 2/);
    assert.doesNotMatch(invalidSelection.prompt, /3\./);
    assert.doesNotMatch(invalidSelection.prompt, /650|620|30\s*g|29\s*g|午餐/);
    assert.equal("resolvedMealId" in invalidSelection, false);
  });

  it("Phase 67 D-39/D-40 resolves a delayed valid option with the originally rendered revision", async () => {
    const older = await foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-04-19T04:00:00.000Z",
      items: [
        { foodName: "雞腿飯", calories: 650, protein: 30, carbs: 80, fat: 20 },
      ],
    });
    const newer = await foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-04-19T04:30:00.000Z",
      items: [
        { foodName: "雞腿飯", calories: 620, protein: 29, carbs: 78, fat: 18 },
      ],
    });

    const firstPass = await mealCorrectionService.findMeals({
      deviceId,
      sessionId: DEFAULT_SESSION_ID,
      action: "update",
      query: "把今天午餐的雞腿飯蛋白質改 28g",
    });
    assert.equal(firstPass.status, "needs_clarification");
    assert.deepEqual(firstPass.candidates.map((candidate) => candidate.mealId), [newer.id, older.id]);

    const selected = await mealCorrectionService.findMeals({
      deviceId,
      sessionId: DEFAULT_SESSION_ID,
      action: "update",
      query: "2，蛋白質改 28g",
    });

    assert.equal(selected.status, "resolved");
    assert.equal(selected.fromPending, true);
    assert.equal(selected.resolvedMealId, older.id);
    assert.equal(selected.mealRevisionId, older.mealRevisionId);
  });

  it("Phase 67 D-41/D-46a rejects stale delayed selections and re-renders current scoped options", async () => {
    const older = await foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-04-19T04:00:00.000Z",
      items: [
        { foodName: "雞腿飯", calories: 650, protein: 30, carbs: 80, fat: 20 },
      ],
    });
    const newer = await foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-04-19T04:30:00.000Z",
      items: [
        { foodName: "雞腿飯", calories: 620, protein: 29, carbs: 78, fat: 18 },
      ],
    });

    const firstPass = await mealCorrectionService.findMeals({
      deviceId,
      sessionId: DEFAULT_SESSION_ID,
      action: "update",
      query: "把今天午餐的雞腿飯蛋白質改 28g",
    });
    assert.equal(firstPass.status, "needs_clarification");
    await foodLoggingService.updateMeal(deviceId, older.id, {
      expectedMealRevisionId: older.mealRevisionId,
      items: [{
        foodName: "新版雞腿飯",
        calories: 640,
        protein: 31,
        carbs: 80,
        fat: 19,
      }],
    });

    const staleSelection = await mealCorrectionService.findMeals({
      deviceId,
      sessionId: DEFAULT_SESSION_ID,
      action: "update",
      query: "2，蛋白質改 28g",
    });

    assert.equal(staleSelection.status, "needs_clarification");
    assert.equal("resolvedMealId" in staleSelection, false);
    assert.ok(staleSelection.candidates.some((candidate) => candidate.mealId === older.id));
    assert.ok(staleSelection.candidates.some((candidate) => candidate.mealId === newer.id));
    assert.ok(staleSelection.candidates.every((candidate) => candidate.dateKey === "2026-04-19"));
    assert.notEqual(
      staleSelection.candidates.find((candidate) => candidate.mealId === older.id)?.mealRevisionId,
      older.mealRevisionId,
    );
    assert.match(staleSelection.prompt, /請直接回覆編號/);
    assert.doesNotMatch(staleSelection.prompt, /已更新|已刪除|成功/);
  });

  it("Phase 67 D-46 never auto-retargets a deleted selected option to a same-label replacement", async () => {
    const selectedTarget = await foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-04-19T04:00:00.000Z",
      items: [
        { foodName: "雞腿飯", calories: 650, protein: 30, carbs: 80, fat: 20 },
      ],
    });
    const newer = await foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-04-19T04:30:00.000Z",
      items: [
        { foodName: "雞腿飯", calories: 620, protein: 29, carbs: 78, fat: 18 },
      ],
    });

    const firstPass = await mealCorrectionService.findMeals({
      deviceId,
      sessionId: DEFAULT_SESSION_ID,
      action: "delete",
      query: "把今天午餐的雞腿飯刪掉",
    });
    assert.equal(firstPass.status, "needs_clarification");
    await foodLoggingService.deleteMeal(deviceId, selectedTarget.id, selectedTarget.mealRevisionId);
    const replacement = await foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-04-19T05:00:00.000Z",
      items: [
        { foodName: "雞腿飯", calories: 700, protein: 35, carbs: 82, fat: 24 },
      ],
    });

    const staleSelection = await mealCorrectionService.findMeals({
      deviceId,
      sessionId: DEFAULT_SESSION_ID,
      action: "delete",
      query: "2",
    });

    assert.equal(staleSelection.status, "needs_clarification");
    assert.equal("resolvedMealId" in staleSelection, false);
    assert.ok(staleSelection.candidates.some((candidate) => candidate.mealId === replacement.id));
    assert.ok(staleSelection.candidates.some((candidate) => candidate.mealId === newer.id));
    assert.ok(!staleSelection.candidates.some((candidate) => candidate.mealId === selectedTarget.id));
    assert.match(staleSelection.prompt, /請直接回覆編號/);
  });

  it("does not reuse a pending selection for a different mutation action", async () => {
    const first = await foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-04-19T04:00:00.000Z",
      items: [
        { foodName: "雞腿飯", calories: 650, protein: 30, carbs: 80, fat: 20 },
      ],
    });
    await foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-04-19T04:30:00.000Z",
      items: [
        { foodName: "雞腿飯", calories: 620, protein: 29, carbs: 78, fat: 18 },
      ],
    });

    const firstPass = await mealCorrectionService.findMeals({
      deviceId,
      sessionId: DEFAULT_SESSION_ID,
      action: "delete",
      query: "把今天午餐的雞腿飯刪掉",
    });
    assert.equal(firstPass.status, "needs_clarification");

    const staleAction = await mealCorrectionService.findMeals({
      deviceId,
      sessionId: DEFAULT_SESSION_ID,
      action: "update",
      query: "第二個",
    });

    assert.notEqual(staleAction.status, "resolved");
    if (staleAction.status === "resolved") {
      assert.notEqual(staleAction.resolvedMealId, first.id);
    }
  });

  it("does not reuse a uniquely resolved pending target for a new named correction", async () => {
    const target = await foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-04-19T12:00:00.000Z",
      items: [
        { foodName: "雞腿", calories: 220, protein: 24, carbs: 0, fat: 9 },
      ],
    });

    const firstPass = await mealCorrectionService.findMeals({
      deviceId,
      sessionId: DEFAULT_SESSION_ID,
      action: "update",
      query: "剛剛的雞腿蛋白質降低",
    });
    assert.equal(firstPass.status, "resolved");
    assert.equal(firstPass.resolvedMealId, target.id);

    const staleTarget = await mealCorrectionService.findMeals({
      deviceId,
      sessionId: DEFAULT_SESSION_ID,
      action: "update",
      query: "把豆漿改成無糖",
    });

    assert.notEqual(staleTarget.status, "resolved");
    if (staleTarget.status === "resolved") {
      assert.notEqual(staleTarget.resolvedMealId, target.id);
    }
  });

  it("returns affectedDate for historical deletes and keeps it in sync with dailySummary.date", async () => {
    const meal = await foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-03-25T10:30:00.000Z",
      items: [
        { foodName: "牛肉麵", calories: 520, protein: 24, carbs: 68, fat: 16 },
      ],
    });

    await assert.rejects(
      () => mealCorrectionService.deleteMeal(foreignDeviceId, meal.id),
      /MEAL_NOT_FOUND/,
    );

    const result = await mealCorrectionService.deleteMeal(deviceId, meal.id, meal.mealRevisionId);

    assert.equal(result.deletedMealId, meal.id);
    assert.equal(result.affectedDate, "2026-03-25");
    assert.ok(result.dailySummary);
    assert.equal(result.dailySummary.date, result.affectedDate);
    assert.equal(result.dailySummary.mealCount, 0);
    assert.deepEqual(result.deletedMeal, {
      mealId: meal.id,
      dateKey: "2026-03-25",
      loggedAt: "2026-03-25T10:30:00.000Z",
      mealPeriod: null,
      foodName: "牛肉麵",
      calories: 520,
      protein: 24,
    });
  });

  it("returns committed delete facts with unavailable summaryOutcome when recovery fails", async () => {
    const localMealCorrectionService = createMealCorrectionService(db, {
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
    const meal = await foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-03-25T10:30:00.000Z",
      items: [
        { foodName: "beef noodles", calories: 520, protein: 24, carbs: 68, fat: 16 },
      ],
    });

    const result = await localMealCorrectionService.deleteMeal(deviceId, meal.id, meal.mealRevisionId);

    assert.equal(result.deletedMealId, meal.id);
    assert.equal(result.affectedDate, "2026-03-25");
    assert.deepEqual(result.summaryOutcome, { status: "unavailable", reason: "recompute_failed" });
    assert.equal(result.dailySummary, undefined);
    assert.equal(result.deletedMeal.mealId, meal.id);
    assert.equal(result.deletedMeal.foodName, "beef noodles");
  });

  it("requires resolver-owned expected revisions for update and delete calls", async () => {
    const updateTarget = await foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-04-19T12:00:00.000Z",
      items: [
        { foodName: "雞腿", calories: 220, protein: 24, carbs: 0, fat: 9 },
      ],
    });
    const deleteTarget = await foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-04-19T13:00:00.000Z",
      items: [
        { foodName: "牛肉麵", calories: 520, protein: 24, carbs: 68, fat: 16 },
      ],
    });

    await assert.rejects(
      () => mealCorrectionService.updateMeal(deviceId, updateTarget.id, { patch: { protein: 22 } }),
      /MEAL_REVISION_REQUIRED/,
    );
    await assert.rejects(
      () => mealCorrectionService.deleteMeal(deviceId, deleteTarget.id),
      /MEAL_REVISION_REQUIRED/,
    );

    const updateTransaction = (
      await db
        .select()
        .from(mealTransactions)
        .where(eq(mealTransactions.id, updateTarget.id))
    )[0];
    const deleteTransaction = (
      await db
        .select()
        .from(mealTransactions)
        .where(eq(mealTransactions.id, deleteTarget.id))
    )[0];
    const revisions = await db.select().from(mealRevisions);

    assert.equal(updateTransaction?.currentRevisionId, updateTarget.mealRevisionId);
    assert.equal(deleteTransaction?.currentRevisionId, deleteTarget.mealRevisionId);
    assert.equal(deleteTransaction?.deletedAt, null);
    assert.equal(revisions.length, 2);
  });

  it("returns stale revision metadata when a patch update target was deleted", async () => {
    const meal = await foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-04-19T12:00:00.000Z",
      items: [
        { foodName: "鮭魚飯", calories: 610, protein: 34, carbs: 58, fat: 24 },
      ],
    });
    const deleted = await foodLoggingService.deleteMeal(deviceId, meal.id, meal.mealRevisionId);

    await assert.rejects(
      () => mealCorrectionService.updateMeal(
        deviceId,
        meal.id,
        { patch: { calories: 420 } },
        meal.mealRevisionId,
      ),
      (error) => {
        assert.ok(error instanceof MealRevisionPreconditionError);
        assert.equal(error.code, "MEAL_REVISION_STALE");
        assert.equal(error.mealId, meal.id);
        assert.equal(error.affectedDate, deleted.affectedDateKey);
        assert.equal(error.currentMealRevisionId, `${meal.id}:r2`);
        return true;
      },
    );
  });

  it("loads current persisted meal facts for the device-owned expected revision", async () => {
    const grouped = await foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-04-19T12:00:00.000Z",
      items: [
        { foodName: "雞腿", calories: 260, protein: 24, carbs: 0, fat: 12 },
        { foodName: "白飯", calories: 280, protein: 4, carbs: 62, fat: 0.5 },
        { foodName: "滷蛋", calories: 90, protein: 7, carbs: 2, fat: 6 },
      ],
    });

    const facts = await mealCorrectionService.loadCurrentMealFacts(
      deviceId,
      grouped.id,
      grouped.mealRevisionId,
    );

    assert.equal(facts.mealId, grouped.id);
    assert.equal(facts.currentMealRevisionId, grouped.mealRevisionId);
    assert.equal(facts.mealLabel, "雞腿、白飯、滷蛋");
    assert.deepEqual(facts.items, [
      { foodName: "雞腿", calories: 260, protein: 24, carbs: 0, fat: 12 },
      { foodName: "白飯", calories: 280, protein: 4, carbs: 62, fat: 0.5 },
      { foodName: "滷蛋", calories: 90, protein: 7, carbs: 2, fat: 6 },
    ]);
    assert.deepEqual(facts.totals, {
      calories: 630,
      protein: 35,
      carbs: 64,
      fat: 18.5,
    });

    await assert.rejects(
      () => mealCorrectionService.loadCurrentMealFacts(foreignDeviceId, grouped.id, grouped.mealRevisionId),
      /MEAL_NOT_FOUND/,
    );
    await assert.rejects(
      () => mealCorrectionService.loadCurrentMealFacts(deviceId, grouped.id, `${grouped.id}:stale`),
      (error) => {
        assert.ok(error instanceof MealRevisionPreconditionError);
        assert.equal(error.code, "MEAL_REVISION_STALE");
        assert.equal(error.mealId, grouped.id);
        assert.equal(error.currentMealRevisionId, grouped.mealRevisionId);
        return true;
      },
    );
  });

  it("previews locked numeric correction operators from persisted facts only", async () => {
    const grouped = await foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-04-19T12:00:00.000Z",
      items: [
        { foodName: "雞腿", calories: 260, protein: 24, carbs: 0, fat: 12 },
        { foodName: "白飯", calories: 280, protein: 4, carbs: 62, fat: 0.5 },
      ],
    });
    const facts = await mealCorrectionService.loadCurrentMealFacts(
      deviceId,
      grouped.id,
      grouped.mealRevisionId,
    );

    const proteinHalf = mealCorrectionService.previewMealNumericCorrection(facts, {
      fields: ["protein"],
      operator: "half",
    });
    assert.deepEqual(proteinHalf.updateInput, { protein: 14 });
    assert.equal(proteinHalf.items, undefined);
    assert.deepEqual(proteinHalf.affectedFields, [{ field: "protein", before: 28, after: 14 }]);
    assert.equal(proteinHalf.mealLabel, "雞腿、白飯");
    assert.equal(proteinHalf.expectedMealRevisionId, grouped.mealRevisionId);

    const caloriesLess = mealCorrectionService.previewMealNumericCorrection(facts, {
      fields: ["calories"],
      operator: "subtract_percent",
      value: 25,
    });
    assert.deepEqual(caloriesLess.updateInput, { calories: 405 });
    assert.deepEqual(caloriesLess.affectedFields, [{ field: "calories", before: 540, after: 405 }]);

    assert.throws(
      () => mealCorrectionService.previewMealNumericCorrection(facts, {
        fields: ["protein"],
        operator: "reasonable",
      } as never),
      /unsupported meal numeric correction operator/,
    );
  });
});
