import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { DailyTargets } from "../../server/services/device.js";
import type { DailySummary } from "../../server/services/summary.js";
import type { MutationEffects } from "../../server/orchestrator/mutation-effects.js";
import {
  FORBIDDEN_RECEIPT_TERMS,
  assertNoForbiddenReceiptTerms,
  renderMutationReceipt,
} from "../../server/orchestrator/mutation-receipts.js";

const committedSummary: DailySummary = {
  totalCalories: 520,
  totalProtein: 31,
  totalCarbs: 48,
  totalFat: 18,
  mealCount: 1,
  date: "2026-05-10",
};

const committedTargets: DailyTargets = {
  calories: 1800,
  protein: 130,
  carbs: 150,
  fat: 50,
};

describe("MutationEffects contract", () => {
  it("keeps mutation families as a discriminated committed-facts union", () => {
    const effects = [
      {
        kind: "log",
        affectedDate: "2026-05-10",
        committedSummary,
        committedTargets,
        meal: {
          mealId: "meal-log",
          mealRevisionId: "rev-log",
          dateKey: "2026-05-10",
          loggedAt: "2026-05-10T04:30:00.000Z",
          foodName: "雞胸便當",
          calories: 520,
          protein: 31,
          carbs: 48,
          fat: 18,
          itemCount: 1,
        },
      },
      {
        kind: "update",
        affectedDate: "2026-05-10",
        committedSummary,
        committedTargets,
        meal: {
          mealId: "meal-update",
          mealRevisionId: "rev-update",
          dateKey: "2026-05-10",
          loggedAt: "2026-05-10T05:15:00.000Z",
          foodName: "鮭魚飯",
          calories: 610,
          protein: 36,
          carbs: 54,
          fat: 22,
          itemCount: 2,
        },
      },
      {
        kind: "delete",
        affectedDate: "2026-05-10",
        committedSummary,
        committedTargets,
        deletedMeal: {
          mealId: "meal-delete",
          dateKey: "2026-05-10",
          loggedAt: "2026-05-10T06:45:00.000Z",
          foodName: "拿鐵",
          calories: 180,
          protein: 9,
        },
      },
      {
        kind: "goals",
        affectedDate: "2026-05-10",
        committedSummary,
        committedTargets,
        targets: committedTargets,
        updatedFields: ["calories", "protein"],
      },
    ] satisfies MutationEffects[];

    assert.deepEqual(effects.map((effect) => effect.kind), ["log", "update", "delete", "goals"]);
    assert.ok("meal" in effects[0]);
    assert.ok("meal" in effects[1]);
    assert.ok("deletedMeal" in effects[2]);
    assert.ok("targets" in effects[3]);
  });

  it("keeps trace ownership and forbidden renderer terms out of the effect payload", () => {
    const source = readFileSync("server/orchestrator/mutation-effects.ts", "utf8");
    assert.doesNotMatch(source, /finalReplySource|source|renderer|model|fallback|tool_receipt|mixed/);
  });
});

describe("mutation receipt renderer", () => {
  it("renders log receipts from committed meal facts", () => {
    const text = renderMutationReceipt({
      kind: "log",
      affectedDate: "2025-12-31",
      committedSummary,
      committedTargets,
      meal: {
        mealId: "meal-log",
        mealRevisionId: "rev-log",
        dateKey: "2025-12-31",
        loggedAt: "2025-12-31T04:30:00.000Z",
        foodName: "雞胸便當",
        calories: 520,
        protein: 31,
        carbs: 48,
        fat: 18,
        itemCount: 1,
      },
    });

    assert.equal(text, "已記錄2025/12/31 雞胸便當，520 kcal，蛋白質 31 g。");
    assert.deepEqual(assertNoForbiddenReceiptTerms(text), []);
  });

  it("keeps user-facing uncertainty caveats on renderer-owned log receipts", () => {
    const text = renderMutationReceipt({
      kind: "log",
      affectedDate: "2026-05-10",
      committedSummary,
      committedTargets,
      meal: {
        mealId: "meal-log",
        mealRevisionId: "rev-log",
        dateKey: "2026-05-10",
        loggedAt: "2026-05-10T04:30:00.000Z",
        foodName: "雞肉沙拉",
        calories: 420,
        protein: 32,
        carbs: 28,
        fat: 18,
        itemCount: 1,
        quantityUncertaintyReason: "missing_quantity",
      },
    });

    assert.equal(text, "已記錄5/10 雞肉沙拉，420 kcal，蛋白質 32 g。若份量不同，可以再調整。");
    assert.match(text, /份量|估算/);
    assert.deepEqual(assertNoForbiddenReceiptTerms(text), []);
  });

  it("renders update receipts from committed meal facts", () => {
    const text = renderMutationReceipt({
      kind: "update",
      affectedDate: "2025-12-31",
      committedSummary,
      committedTargets,
      meal: {
        mealId: "meal-update",
        mealRevisionId: "rev-update",
        dateKey: "2025-12-31",
        loggedAt: "2025-12-31T05:15:00.000Z",
        foodName: "鮭魚飯",
        calories: 610,
        protein: 36,
        carbs: 54,
        fat: 22,
        itemCount: 2,
      },
    });

    assert.equal(text, "已更新2025/12/31 鮭魚飯，610 kcal，蛋白質 36 g。");
    assert.deepEqual(assertNoForbiddenReceiptTerms(text), []);
  });

  it("renders delete receipts from the committed deleted meal snapshot", () => {
    const text = renderMutationReceipt({
      kind: "delete",
      affectedDate: "2025-12-31",
      committedSummary,
      committedTargets,
      deletedMeal: {
        mealId: "meal-delete",
        dateKey: "2025-12-31",
        loggedAt: "2025-12-31T06:45:00.000Z",
        foodName: "拿鐵",
        calories: 180,
        protein: 9,
      },
    });

    assert.equal(text, "已刪除2025/12/31 拿鐵，已從當日紀錄移除。");
    assert.deepEqual(assertNoForbiddenReceiptTerms(text), []);
  });

  it("renders goal receipts with all four committed target rows", () => {
    const text = renderMutationReceipt({
      kind: "goals",
      affectedDate: "2026-05-10",
      committedSummary,
      committedTargets,
      targets: committedTargets,
      updatedFields: ["calories", "protein"],
    });

    assert.equal(text, "已更新每日目標：\n• 卡路里 1800 kcal\n• 蛋白質 130 g\n• 碳水 150 g\n• 脂肪 50 g");
    assert.deepEqual(assertNoForbiddenReceiptTerms(text), []);
  });

  it("rejects implementation and API-like forbidden terms", () => {
    const rejected = [
      "headline",
      "先抓低",
      "log_food",
      "update_meal",
      "delete_meal",
      "update_goals",
      "revision",
      "deviceId",
      "mealMutationKind",
      "dailySummary",
      "dailyTargets",
      "API",
      "endpoint",
      "route",
      "payload",
      "field",
      "request",
      "response",
      "JSON",
      "PATCH",
      "POST",
      "DELETE",
      "/api",
      "body",
      "status code",
    ];

    assert.deepEqual(FORBIDDEN_RECEIPT_TERMS, rejected);
    for (const term of rejected) {
      assert.deepEqual(assertNoForbiddenReceiptTerms(`copy leaks ${term}`), [term]);
    }
  });
});
