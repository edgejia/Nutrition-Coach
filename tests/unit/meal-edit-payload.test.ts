import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildHistoryMealEditPayload,
  buildReceiptMealEditPayload,
} from "../../client/src/meal-edit-payload.js";
import {
  normalizeHistoryMeal,
  normalizeLoggedMealReceipt,
} from "../../client/src/api.js";

describe("meal edit payload builders", () => {
  it("normalizeHistoryMeal preserves valid grouped item detail from history DTOs", () => {
    const meal = normalizeHistoryMeal({
      id: "meal-items-history",
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

  it("buildReceiptMealEditPayload preserves chat receipt image identity and rejects incomplete receipts", () => {
    const payload = buildReceiptMealEditPayload({
      mealId: "meal-2",
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
      foodName: "缺少 ID",
      calories: 1,
      protein: 1,
      carbs: 1,
      fat: 1,
    } as any), null);
  });

  it("defaults legacy edit payloads without itemCount to single-item semantics", () => {
    const historyPayload = buildHistoryMealEditPayload({
      id: "legacy-history",
      foodName: "蘋果",
      calories: 95,
      protein: 0,
      carbs: 25,
      fat: 0.3,
      imageAssetId: null,
      imageUrl: null,
      loggedAt: "2026-05-06T08:00:00.000+08:00",
    } as any, "2026-05-06");
    const receiptPayload = buildReceiptMealEditPayload({
      mealId: "legacy-receipt",
      dateKey: "2026-05-06",
      loggedAt: "2026-05-06T09:00:00.000+08:00",
      foodName: "香蕉",
      calories: 105,
      protein: 1,
      carbs: 27,
      fat: 0.4,
    } as any);

    assert.equal((historyPayload as any).itemCount, 1);
    assert.equal((receiptPayload as any)?.itemCount, 1);
  });
});
