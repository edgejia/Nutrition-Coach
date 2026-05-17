process.env.TZ = "Asia/Taipei";

import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createDb } from "../../server/db/client.js";
import { eq } from "drizzle-orm";
import { mealRevisions, mealTransactions } from "../../server/db/schema.js";
import { createDeviceService } from "../../server/services/device.js";
import { createFoodLoggingService } from "../../server/services/food-logging.js";
import { createMealCorrectionService } from "../../server/services/meal-correction.js";
import { MealRevisionPreconditionError } from "../../server/services/meal-transactions.js";

const REAL_DATE = Date;
const FIXED_NOW = new REAL_DATE("2026-04-19T12:00:00+08:00");

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
    assert.equal(result.mealRevisionId, latest.mealRevisionId);
    assert.equal(result.candidate.foodName, "雞腿飯");
    assert.equal(result.candidate.itemCount, 1);
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

  it("accepts shared historical date phrases for meal targeting", async () => {
    const marchMeal = await foodLoggingService.logFood(deviceId, {
      foodName: "雞腿飯",
      calories: 650,
      protein: 30,
      carbs: 80,
      fat: 20,
      loggedAt: "2026-03-25T04:00:00.000Z",
    });
    const lastFridayMeal = await foodLoggingService.logFood(deviceId, {
      foodName: "牛肉麵",
      calories: 520,
      protein: 24,
      carbs: 68,
      fat: 16,
      loggedAt: "2026-04-10T10:30:00.000Z",
    });
    await foodLoggingService.logFood(deviceId, {
      foodName: "雞腿飯",
      calories: 620,
      protein: 28,
      carbs: 76,
      fat: 18,
      loggedAt: "2026-04-19T04:30:00.000Z",
    });

    const slashDateResult = await mealCorrectionService.findMeals(
      deviceId,
      "update",
      "把 3/25 的雞腿飯改成 500 卡",
    );
    assert.equal(slashDateResult.status, "resolved");
    assert.equal(slashDateResult.resolvedMealId, marchMeal.id);
    assert.equal(slashDateResult.candidate.dateKey, "2026-03-25");
    await mealCorrectionService.clearPendingSelection(deviceId);

    const relativeWeekResult = await mealCorrectionService.findMeals(
      deviceId,
      "delete",
      "把上週五的牛肉麵刪掉",
    );
    assert.equal(relativeWeekResult.status, "resolved");
    assert.equal(relativeWeekResult.resolvedMealId, lastFridayMeal.id);
    assert.equal(relativeWeekResult.candidate.dateKey, "2026-04-10");
  });

  it("clarifies unsupported or multi-date mutation targets instead of defaulting to today", async () => {
    await foodLoggingService.logFood(deviceId, {
      foodName: "雞腿飯",
      calories: 650,
      protein: 30,
      carbs: 80,
      fat: 20,
      loggedAt: "2026-04-19T04:00:00.000Z",
    });

    const unsupported = await mealCorrectionService.findMeals(deviceId, "delete", "把前幾天的雞腿飯刪掉");
    assert.equal(unsupported.status, "needs_clarification");
    assert.match(unsupported.prompt, /再說一次日期|哪一天/);

    const multiDate = await mealCorrectionService.findMeals(deviceId, "delete", "把昨天和前天的雞腿飯刪掉");
    assert.equal(multiDate.status, "needs_clarification");
    assert.match(multiDate.prompt, /一個日期|哪一天/);
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
    const unrelatedLunch = await foodLoggingService.logFood(deviceId, {
      foodName: "蛋餅",
      calories: 330,
      protein: 12,
      carbs: 38,
      fat: 14,
      loggedAt: "2026-04-19T04:30:00.000Z",
    });

    const itemOnly = await mealCorrectionService.findMeals(deviceId, "update", "滷蛋改成兩顆水煮蛋");
    assert.equal(itemOnly.status, "resolved");
    assert.equal(itemOnly.resolvedMealId, grouped.id);
    assert.notEqual(itemOnly.resolvedMealId, unrelatedLunch.id);
    await mealCorrectionService.clearPendingSelection(deviceId);

    const withModelPeriodHint = await mealCorrectionService.findMeals(
      deviceId,
      "update",
      "把中午雞腿便當的滷蛋改成兩顆水煮蛋",
    );
    assert.equal(withModelPeriodHint.status, "resolved");
    assert.equal(withModelPeriodHint.resolvedMealId, grouped.id);
    assert.notEqual(withModelPeriodHint.resolvedMealId, unrelatedLunch.id);
    assert.equal(withModelPeriodHint.candidate.foodName, "雞腿、白飯、滷蛋、青菜");
  });

  it("clarifies instead of resolving a period-only candidate when named food terms are unmatched", async () => {
    await foodLoggingService.logFood(deviceId, {
      foodName: "蛋餅",
      calories: 330,
      protein: 12,
      carbs: 38,
      fat: 14,
      loggedAt: "2026-04-19T04:30:00.000Z",
    });

    const result = await mealCorrectionService.findMeals(deviceId, "update", "把中午鴨腿便當改成 500 卡");

    assert.equal(result.status, "needs_clarification");
    assert.match(result.prompt, /補充日期、餐別或食物名稱|不能確定/);
  });

  it("still allows meal-period-only targeting when the query has no named food terms", async () => {
    const lunch = await foodLoggingService.logFood(deviceId, {
      foodName: "蛋餅",
      calories: 330,
      protein: 12,
      carbs: 38,
      fat: 14,
      loggedAt: "2026-04-19T04:30:00.000Z",
    });
    await foodLoggingService.logFood(deviceId, {
      foodName: "燕麥",
      calories: 220,
      protein: 10,
      carbs: 35,
      fat: 4,
      loggedAt: "2026-04-19T00:00:00.000Z",
    });

    const result = await mealCorrectionService.findMeals(deviceId, "delete", "把今天午餐那餐刪掉");

    assert.equal(result.status, "resolved");
    assert.equal(result.resolvedMealId, lunch.id);
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
    const original = await foodLoggingService.logFood(deviceId, {
      foodName: "雞腿飯",
      calories: 650,
      protein: 30,
      carbs: 80,
      fat: 20,
      loggedAt: "2026-03-25T04:00:00.000Z",
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
    const original = await foodLoggingService.logFood(deviceId, {
      foodName: "chicken rice",
      calories: 650,
      protein: 30,
      carbs: 80,
      fat: 20,
      loggedAt: "2026-03-25T04:00:00.000Z",
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

  it("does not reuse a pending selection for a different mutation action", async () => {
    const first = await foodLoggingService.logFood(deviceId, {
      foodName: "雞腿飯",
      calories: 650,
      protein: 30,
      carbs: 80,
      fat: 20,
      loggedAt: "2026-04-19T04:00:00.000Z",
    });
    await foodLoggingService.logFood(deviceId, {
      foodName: "雞腿飯",
      calories: 620,
      protein: 29,
      carbs: 78,
      fat: 18,
      loggedAt: "2026-04-19T04:30:00.000Z",
    });

    const firstPass = await mealCorrectionService.findMeals(deviceId, "delete", "把今天午餐的雞腿飯刪掉");
    assert.equal(firstPass.status, "needs_clarification");

    const staleAction = await mealCorrectionService.findMeals(deviceId, "update", "第二個");

    assert.notEqual(staleAction.status, "resolved");
    if (staleAction.status === "resolved") {
      assert.notEqual(staleAction.resolvedMealId, first.id);
    }
  });

  it("does not reuse a uniquely resolved pending target for a new named correction", async () => {
    const target = await foodLoggingService.logFood(deviceId, {
      foodName: "雞腿",
      calories: 220,
      protein: 24,
      carbs: 0,
      fat: 9,
      loggedAt: "2026-04-19T12:00:00.000Z",
    });

    const firstPass = await mealCorrectionService.findMeals(deviceId, "update", "剛剛的雞腿蛋白質降低");
    assert.equal(firstPass.status, "resolved");
    assert.equal(firstPass.resolvedMealId, target.id);

    const staleTarget = await mealCorrectionService.findMeals(deviceId, "update", "把豆漿改成無糖");

    assert.notEqual(staleTarget.status, "resolved");
    if (staleTarget.status === "resolved") {
      assert.notEqual(staleTarget.resolvedMealId, target.id);
    }
  });

  it("returns affectedDate for historical deletes and keeps it in sync with dailySummary.date", async () => {
    const meal = await foodLoggingService.logFood(deviceId, {
      foodName: "牛肉麵",
      calories: 520,
      protein: 24,
      carbs: 68,
      fat: 16,
      loggedAt: "2026-03-25T10:30:00.000Z",
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
    const meal = await foodLoggingService.logFood(deviceId, {
      foodName: "beef noodles",
      calories: 520,
      protein: 24,
      carbs: 68,
      fat: 16,
      loggedAt: "2026-03-25T10:30:00.000Z",
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
    const updateTarget = await foodLoggingService.logFood(deviceId, {
      foodName: "雞腿",
      calories: 220,
      protein: 24,
      carbs: 0,
      fat: 9,
      loggedAt: "2026-04-19T12:00:00.000Z",
    });
    const deleteTarget = await foodLoggingService.logFood(deviceId, {
      foodName: "牛肉麵",
      calories: 520,
      protein: 24,
      carbs: 68,
      fat: 16,
      loggedAt: "2026-04-19T13:00:00.000Z",
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
    const meal = await foodLoggingService.logFood(deviceId, {
      foodName: "鮭魚飯",
      calories: 610,
      protein: 34,
      carbs: 58,
      fat: 24,
      loggedAt: "2026-04-19T12:00:00.000Z",
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
});
