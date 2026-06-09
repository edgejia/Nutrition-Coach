import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  buildHistoryMealEditPayload,
  buildMealEditPayloadIfComplete,
  buildReceiptMealEditPayload,
} from "../../client/src/meal-edit-payload.js";
import {
  normalizeHistoryMeal,
  normalizeLoggedMealReceipt,
} from "../../client/src/api.js";

async function readSource(relativePath: string) {
  return readFile(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

const typesSource = await readSource("../../client/src/types.ts");

describe("meal edit payload builders", () => {
  it("normalizeHistoryMeal preserves valid grouped item detail from history DTOs", () => {
    const meal = normalizeHistoryMeal({
      id: "meal-items-history",
      mealRevisionId: "meal-items-history:r1",
      loggedAt: "2026-05-06T12:00:00.000+08:00",
      display: { title: "雞腿、白飯、青菜" },
      nutrition: { calories: 720, protein: 42, carbs: 88, fat: 24 },
      itemCount: 3,
      items: [
        {
          name: "青菜",
          position: 2,
          nutrition: { calories: 80, protein: 4, carbs: 10, fat: 2 },
        },
        {
          name: "雞腿",
          position: 0,
          nutrition: { calories: 340, protein: 32, carbs: 2, fat: 18 },
        },
        {
          name: "白飯",
          position: 1,
          nutrition: { calories: 300, protein: 6, carbs: 76, fat: 4 },
        },
        {
          name: "壞資料",
          position: 3,
          nutrition: { calories: Number.NaN, protein: 1, carbs: 1, fat: 1 },
        },
      ],
    } as any);

    assert.deepEqual(meal.items, [
      { name: "雞腿", position: 0, calories: 340, protein: 32, carbs: 2, fat: 18 },
      { name: "白飯", position: 1, calories: 300, protein: 6, carbs: 76, fat: 4 },
      { name: "青菜", position: 2, calories: 80, protein: 4, carbs: 10, fat: 2 },
    ]);
  });

  it("normalizeLoggedMealReceipt preserves valid chat receipt grouped item detail", () => {
    const receipt = normalizeLoggedMealReceipt({
      mealId: "meal-items-receipt",
      dateKey: "2026-05-06",
      loggedAt: "2026-05-06T13:00:00.000+08:00",
      foodName: "豆漿、茶葉蛋",
      calories: 260,
      protein: 18,
      carbs: 18,
      fat: 12,
      itemCount: 2,
      items: [
        { name: "豆漿", position: 1, calories: 160, protein: 10, carbs: 14, fat: 6 },
        { name: "茶葉蛋", position: 0, calories: 100, protein: 8, carbs: 4, fat: 6 },
      ],
    } as any);

    assert.deepEqual(receipt.items, [
      { name: "茶葉蛋", position: 0, calories: 100, protein: 8, carbs: 4, fat: 6 },
      { name: "豆漿", position: 1, calories: 160, protein: 10, carbs: 14, fat: 6 },
    ]);
  });

  it("buildHistoryMealEditPayload preserves persisted image identity for History-origin edits", () => {
    const payload = buildHistoryMealEditPayload({
      id: "meal-1",
      mealRevisionId: "meal-1:r1",
      foodName: "雞腿便當",
      calories: 720,
      protein: 42,
      carbs: 88,
      fat: 24,
      itemCount: 3,
      items: [
        { name: "雞腿", position: 0, calories: 340, protein: 32, carbs: 2, fat: 18 },
        { name: "白飯", position: 1, calories: 300, protein: 6, carbs: 76, fat: 4 },
        { name: "青菜", position: 2, calories: 80, protein: 4, carbs: 10, fat: 2 },
      ],
      imageAssetId: "asset-history",
      imageUrl: "/api/assets/asset-history",
      loggedAt: "2026-05-06T12:00:00.000+08:00",
    } as any, "2026-05-06");

    assert.deepEqual(payload, {
      mealId: "meal-1",
      mealRevisionId: "meal-1:r1",
      dateKey: "2026-05-06",
      foodName: "雞腿便當",
      calories: 720,
      protein: 42,
      carbs: 88,
      fat: 24,
      itemCount: 3,
      items: [
        { name: "雞腿", position: 0, calories: 340, protein: 32, carbs: 2, fat: 18 },
        { name: "白飯", position: 1, calories: 300, protein: 6, carbs: 76, fat: 4 },
        { name: "青菜", position: 2, calories: 80, protein: 4, carbs: 10, fat: 2 },
      ],
      imageAssetId: "asset-history",
      imageUrl: "/api/assets/asset-history",
      loggedAt: "2026-05-06T12:00:00.000+08:00",
    });
  });

  it("buildMealEditPayloadIfComplete returns the complete History payload shape", () => {
    const meal = {
      id: "home-meal-1",
      mealRevisionId: "home-meal-1:r1",
      foodName: "雞腿便當",
      calories: 720,
      protein: 42,
      carbs: 88,
      fat: 24,
      itemCount: 1,
      imageAssetId: "asset-home",
      imageUrl: "/api/assets/asset-home",
      loggedAt: "2026-05-06T12:00:00.000+08:00",
      mealPeriod: "lunch" as const,
    };

    assert.deepEqual(
      buildMealEditPayloadIfComplete(meal, "2026-05-06"),
      buildHistoryMealEditPayload(meal, "2026-05-06"),
    );
  });

  it("buildMealEditPayloadIfComplete returns null for missing revision and core authority", () => {
    const baseMeal = {
      id: "home-meal-incomplete",
      mealRevisionId: "home-meal-incomplete:r1",
      foodName: "完整餐點",
      calories: 450,
      protein: 30,
      carbs: 42,
      fat: 12,
      itemCount: 1,
      imageAssetId: null,
      imageUrl: null,
      loggedAt: "2026-05-06T08:00:00.000+08:00",
    };

    for (const meal of [
      { ...baseMeal, mealRevisionId: undefined },
      { ...baseMeal, mealRevisionId: "" },
      { ...baseMeal, id: "" },
      { ...baseMeal, foodName: "" },
      { ...baseMeal, calories: Number.NaN },
      { ...baseMeal, protein: undefined },
      { ...baseMeal, carbs: undefined },
      { ...baseMeal, fat: undefined },
      { ...baseMeal, itemCount: 0 },
      { ...baseMeal, loggedAt: "" },
    ]) {
      assert.equal(buildMealEditPayloadIfComplete(meal as any, "2026-05-06"), null);
    }

    assert.throws(() => buildHistoryMealEditPayload({ ...baseMeal, mealRevisionId: "" } as any, "2026-05-06"), {
      message: "MEAL_REVISION_REQUIRED",
    });
  });

  it("buildMealEditPayloadIfComplete preserves grouped item and image authority", () => {
    const payload = buildMealEditPayloadIfComplete({
      id: "home-grouped-meal",
      mealRevisionId: "home-grouped-meal:r1",
      foodName: "雞腿、白飯、青菜",
      calories: 720,
      protein: 42,
      carbs: 88,
      fat: 24,
      itemCount: 3,
      items: [
        { name: "青菜", position: 2, calories: 80, protein: 4, carbs: 10, fat: 2 },
        { name: "雞腿", position: 0, calories: 340, protein: 32, carbs: 2, fat: 18 },
        { name: "白飯", position: 1, calories: 300, protein: 6, carbs: 76, fat: 4 },
      ],
      imageAssetId: "asset-grouped",
      imageUrl: "/api/assets/asset-grouped",
      loggedAt: "2026-05-06T12:00:00.000+08:00",
      mealPeriod: "lunch",
    } as any, "2026-05-06");

    assert.deepEqual(payload?.items, [
      { name: "雞腿", position: 0, calories: 340, protein: 32, carbs: 2, fat: 18 },
      { name: "白飯", position: 1, calories: 300, protein: 6, carbs: 76, fat: 4 },
      { name: "青菜", position: 2, calories: 80, protein: 4, carbs: 10, fat: 2 },
    ]);
    assert.equal(payload?.itemCount, 3);
    assert.equal(payload?.imageAssetId, "asset-grouped");
    assert.equal(payload?.imageUrl, "/api/assets/asset-grouped");
    assert.equal(payload?.loggedAt, "2026-05-06T12:00:00.000+08:00");
    assert.equal(payload?.mealPeriod, "lunch");
  });

  it("NAV-02 grouped History-origin rows without authoritative item details fail closed", () => {
    const groupedWithoutItems = {
      id: "history-grouped-missing-items",
      mealRevisionId: "history-grouped-missing-items:r1",
      foodName: "雞腿、白飯",
      calories: 640,
      protein: 36,
      carbs: 72,
      fat: 18,
      itemCount: 2,
      imageAssetId: null,
      imageUrl: null,
      loggedAt: "2026-05-06T12:00:00.000+08:00",
    };

    assert.equal(
      buildMealEditPayloadIfComplete(groupedWithoutItems, "2026-05-06"),
      null,
      "NAV-02 grouped History-origin rows with itemCount > 1 and no items must not open 找不到項目明細",
    );
    assert.equal(
      buildMealEditPayloadIfComplete(
        {
          ...groupedWithoutItems,
          id: "history-grouped-invalid-items",
          mealRevisionId: "history-grouped-invalid-items:r1",
          items: [{ name: "", position: 0, calories: 100, protein: 10, carbs: 10, fat: 4 }],
        } as any,
        "2026-05-06",
      ),
      null,
      "NAV-02 grouped History-origin rows with invalid items must fail closed",
    );
  });

  it("keeps MealItemDetail media-free as the grouped item DTO boundary", () => {
    const mealItemDetailBody = typesSource.match(/export interface MealItemDetail \{(?<body>[\s\S]+?)\n\}/)?.groups?.body ?? "";
    assert.ok(mealItemDetailBody, "MealItemDetail interface must be present");

    const fields = [...mealItemDetailBody.matchAll(/^\s*(\w+)\??:/gm)].map((match) => match[1]);
    assert.deepEqual(fields, ["name", "position", "calories", "protein", "carbs", "fat"]);

    for (const rejected of ["image", "imageAssetId", "asset", "crop", "thumbnail", "evidence"]) {
      assert.doesNotMatch(mealItemDetailBody, new RegExp(`\\b${rejected}\\b`, "i"));
    }
  });

  it("buildHistoryMealEditPayload preserves explicit mealPeriod from history rows", () => {
    const payload = buildHistoryMealEditPayload({
      id: "meal-period-history",
      mealRevisionId: "meal-period-history:r1",
      foodName: "午餐便當",
      calories: 520,
      protein: 32,
      carbs: 64,
      fat: 18,
      itemCount: 1,
      imageAssetId: null,
      imageUrl: null,
      loggedAt: "2026-05-06T07:00:00.000+08:00",
      mealPeriod: "lunch",
    }, "2026-05-06");

    assert.equal(payload.mealPeriod, "lunch");
  });

  it("buildHistoryMealEditPayload omits mealPeriod when history rows lack explicit authority", () => {
    const payload = buildHistoryMealEditPayload({
      id: "legacy-history",
      mealRevisionId: "legacy-history:r1",
      foodName: "早餐時間的餐點",
      calories: 320,
      protein: 18,
      carbs: 42,
      fat: 8,
      itemCount: 1,
      imageAssetId: null,
      imageUrl: null,
      loggedAt: "2026-05-06T07:00:00.000+08:00",
    }, "2026-05-06");

    assert.equal(payload.mealPeriod, undefined);
  });

  it("buildReceiptMealEditPayload preserves chat receipt image identity and rejects incomplete receipts", () => {
    const payload = buildReceiptMealEditPayload({
      mealId: "meal-2",
      mealRevisionId: "meal-2:r1",
      dateKey: "2026-05-06",
      loggedAt: "2026-05-06T13:00:00.000+08:00",
      foodName: "鮭魚飯糰",
      calories: 280,
      protein: 14,
      carbs: 36,
      fat: 8,
      itemCount: 3,
      items: [
        { name: "鮭魚", position: 0, calories: 160, protein: 12, carbs: 0, fat: 8 },
        { name: "飯糰", position: 1, calories: 120, protein: 2, carbs: 36, fat: 0 },
      ],
      imageAssetId: "asset-chat",
      imageUrl: "/api/assets/asset-chat",
    } as any);

    assert.deepEqual(payload, {
      mealId: "meal-2",
      mealRevisionId: "meal-2:r1",
      dateKey: "2026-05-06",
      foodName: "鮭魚飯糰",
      calories: 280,
      protein: 14,
      carbs: 36,
      fat: 8,
      itemCount: 3,
      items: [
        { name: "鮭魚", position: 0, calories: 160, protein: 12, carbs: 0, fat: 8 },
        { name: "飯糰", position: 1, calories: 120, protein: 2, carbs: 36, fat: 0 },
      ],
      imageAssetId: "asset-chat",
      imageUrl: "/api/assets/asset-chat",
      loggedAt: "2026-05-06T13:00:00.000+08:00",
    });
    assert.equal(buildReceiptMealEditPayload({
      mealId: "meal-missing-revision",
      dateKey: "2026-05-06",
      foodName: "缺少版本",
      calories: 1,
      protein: 1,
      carbs: 1,
      fat: 1,
    } as any), null);
    assert.equal(buildReceiptMealEditPayload({
      foodName: "缺少 ID",
      calories: 1,
      protein: 1,
      carbs: 1,
      fat: 1,
    } as any), null);
  });

  it("buildReceiptMealEditPayload preserves explicit mealPeriod from chat receipts", () => {
    const payload = buildReceiptMealEditPayload({
      mealId: "meal-period-receipt",
      mealRevisionId: "meal-period-receipt:r1",
      dateKey: "2026-05-06",
      loggedAt: "2026-05-06T07:00:00.000+08:00",
      foodName: "宵夜飯糰",
      calories: 280,
      protein: 14,
      carbs: 36,
      fat: 8,
      itemCount: 1,
      mealPeriod: "late_night",
    });

    assert.equal(payload?.mealPeriod, "late_night");
  });

  it("buildReceiptMealEditPayload omits mealPeriod when receipts lack explicit authority", () => {
    const payload = buildReceiptMealEditPayload({
      mealId: "legacy-receipt-period",
      mealRevisionId: "legacy-receipt-period:r1",
      dateKey: "2026-05-06",
      loggedAt: "2026-05-06T22:30:00.000+08:00",
      foodName: "深夜餐點",
      calories: 280,
      protein: 14,
      carbs: 36,
      fat: 8,
      itemCount: 1,
    });

    assert.equal(payload?.mealPeriod, undefined);
  });

  it("rejects history edit payloads missing itemCount authority", () => {
    assert.throws(() => buildHistoryMealEditPayload({
      id: "legacy-history",
      mealRevisionId: "legacy-history:r1",
      foodName: "蘋果",
      calories: 95,
      protein: 0,
      carbs: 25,
      fat: 0.3,
      imageAssetId: null,
      imageUrl: null,
      loggedAt: "2026-05-06T08:00:00.000+08:00",
    } as any, "2026-05-06"), { message: "MEAL_AUTHORITY_REQUIRED" });

    const receiptPayload = buildReceiptMealEditPayload({
      mealId: "legacy-receipt",
      mealRevisionId: "legacy-receipt:r1",
      dateKey: "2026-05-06",
      loggedAt: "2026-05-06T09:00:00.000+08:00",
      foodName: "香蕉",
      calories: 105,
      protein: 1,
      carbs: 27,
      fat: 0.4,
    } as any);

    assert.equal((receiptPayload as any)?.itemCount, 1);
    assert.equal((receiptPayload as any)?.mealRevisionId, "legacy-receipt:r1");
  });

  it("rejects history edit payloads missing complete core meal authority", () => {
    const base = {
      id: "history-incomplete",
      mealRevisionId: "history-incomplete:r1",
      foodName: "完整餐點",
      calories: 450,
      protein: 30,
      carbs: 42,
      fat: 12,
      itemCount: 1,
      imageAssetId: null,
      imageUrl: null,
      loggedAt: "2026-05-06T08:00:00.000+08:00",
    };

    for (const meal of [
      { ...base, foodName: "" },
      { ...base, calories: Number.NaN },
      { ...base, protein: undefined },
      { ...base, carbs: undefined },
      { ...base, fat: undefined },
      { ...base, loggedAt: "" },
    ]) {
      assert.throws(() => buildHistoryMealEditPayload(meal as any, "2026-05-06"), {
        message: "MEAL_AUTHORITY_REQUIRED",
      });
    }
  });

  it("rejects blank mealRevisionId before building editable payloads", () => {
    const baseHistoryMeal = {
      id: "history-blank-revision",
      mealRevisionId: "history-blank-revision:r1",
      foodName: "完整餐點",
      calories: 450,
      protein: 30,
      carbs: 42,
      fat: 12,
      itemCount: 1,
      imageAssetId: null,
      imageUrl: null,
      loggedAt: "2026-05-06T08:00:00.000+08:00",
    };

    for (const mealRevisionId of ["", "   "]) {
      assert.throws(
        () => buildHistoryMealEditPayload({ ...baseHistoryMeal, mealRevisionId } as any, "2026-05-06"),
        { message: "MEAL_REVISION_REQUIRED" },
      );
    }

    const baseReceipt = {
      mealId: "receipt-blank-revision",
      mealRevisionId: "receipt-blank-revision:r1",
      dateKey: "2026-05-06",
      foodName: "豆漿",
      calories: 160,
      protein: 10,
      carbs: 14,
      fat: 6,
      itemCount: 1,
    };

    for (const mealRevisionId of ["", "   "]) {
      assert.equal(buildReceiptMealEditPayload({ ...baseReceipt, mealRevisionId } as any), null);
    }
  });

  it("normalizeHistoryMeal and normalizeLoggedMealReceipt preserve mealRevisionId", () => {
    const historyMeal = normalizeHistoryMeal({
      id: "meal-history-revision",
      mealRevisionId: "meal-history-revision:r1",
      loggedAt: "2026-05-06T12:00:00.000+08:00",
      display: { title: "雞腿便當" },
      nutrition: { calories: 720, protein: 42, carbs: 88, fat: 24 },
      itemCount: 1,
    } as any);
    const receipt = normalizeLoggedMealReceipt({
      mealId: "meal-receipt-revision",
      mealRevisionId: "meal-receipt-revision:r1",
      dateKey: "2026-05-06",
      foodName: "豆漿",
      calories: 160,
      protein: 10,
      carbs: 14,
      fat: 6,
      itemCount: 1,
    } as any);

    assert.equal(historyMeal.mealRevisionId, "meal-history-revision:r1");
    assert.equal(receipt.mealRevisionId, "meal-receipt-revision:r1");
  });
});
