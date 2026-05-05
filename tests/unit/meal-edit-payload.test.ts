import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildHistoryMealEditPayload,
  buildReceiptMealEditPayload,
} from "../../client/src/meal-edit-payload.js";

describe("meal edit payload builders", () => {
  it("buildHistoryMealEditPayload preserves persisted image identity for History-origin edits", () => {
    const payload = buildHistoryMealEditPayload({
      id: "meal-1",
      foodName: "雞腿便當",
      calories: 720,
      protein: 42,
      carbs: 88,
      fat: 24,
      imageAssetId: "asset-history",
      imageUrl: "/api/assets/asset-history",
      loggedAt: "2026-05-06T12:00:00.000+08:00",
    }, "2026-05-06");

    assert.deepEqual(payload, {
      mealId: "meal-1",
      dateKey: "2026-05-06",
      foodName: "雞腿便當",
      calories: 720,
      protein: 42,
      carbs: 88,
      fat: 24,
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
      imageAssetId: "asset-chat",
      imageUrl: "/api/assets/asset-chat",
    });

    assert.deepEqual(payload, {
      mealId: "meal-2",
      dateKey: "2026-05-06",
      foodName: "鮭魚飯糰",
      calories: 280,
      protein: 14,
      carbs: 36,
      fat: 8,
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
    }), null);
  });
});
