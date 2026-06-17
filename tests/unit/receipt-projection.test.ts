import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { MutationEffects } from "../../server/orchestrator/mutation-effects.js";
import {
  renderGuardedMutationReceipt,
  renderMutationReceipt,
} from "../../server/orchestrator/mutation-receipts.js";
import { projectPublicMealItems } from "../../server/lib/public-meal-items.js";
import { buildReceiptMealEditPayload } from "../../client/src/meal-edit-payload.js";

const committedTargets = {
  calories: 1800,
  protein: 130,
  carbs: 190,
  fat: 55,
};

const summaryOutcome = { status: "unavailable", reason: "recompute_failed" } as const;

function mealEffects(foodName: string, kind: "log" | "update" = "log"): MutationEffects {
  return {
    kind,
    affectedDate: "2026-03-25",
    committedTargets,
    summaryOutcome,
    meal: {
      mealId: `meal-${kind}`,
      mealRevisionId: `rev-${kind}`,
      dateKey: "2026-03-25",
      loggedAt: "2026-03-25T04:30:00.000Z",
      foodName,
      calories: 520,
      protein: 31,
      carbs: 48,
      fat: 18,
      itemCount: 1,
    },
  };
}

function deleteEffects(foodName: string): MutationEffects {
  return {
    kind: "delete",
    affectedDate: "2026-03-25",
    committedTargets,
    summaryOutcome,
    deletedMeal: {
      mealId: "meal-delete",
      dateKey: "2026-03-25",
      loggedAt: "2026-03-25T04:30:00.000Z",
      foodName,
      calories: 520,
      protein: 31,
    },
  };
}

function goalEffects(): MutationEffects {
  return {
    kind: "goals",
    affectedDate: "2026-03-25",
    committedTargets,
    targets: committedTargets,
    updatedFields: ["calories", "protein"],
  };
}

describe("renderGuardedMutationReceipt", () => {
  it("falls back to canonical committed-fact copy when authored candidate prose leaks internal terms", () => {
    const effects = mealEffects("雞腿便當", "log");
    const canonical = renderMutationReceipt(effects);

    assert.equal(
      renderGuardedMutationReceipt(effects, {
        operation: "orchestrator_receipt",
        verb: "log",
        turnId: "turn-guard-red-log",
        candidateReceipt: "已完成 log_food，請看 dailySummary 和 payload。",
      }),
      canonical,
    );
  });

  it("does not false-positive on structured food-name fields that contain forbidden substrings", () => {
    const cases = [
      mealEffects("body armor", "log"),
      mealEffects("field roast", "update"),
      deleteEffects("body armor field roast"),
    ];

    for (const effects of cases) {
      assert.equal(
        renderGuardedMutationReceipt(effects, {
          operation: "orchestrator_receipt",
          verb: effects.kind,
          turnId: `turn-food-name-${effects.kind}`,
        }),
        renderMutationReceipt(effects),
      );
    }
  });

  it("scans authored template segments while excluding every structured delete item food name", () => {
    const effects = deleteEffects("body armor、field roast");
    const cleanCandidate = "已刪除 body armor、field roast，已從當日紀錄移除。";
    const leakingCandidate = "已刪除 body armor、field roast，delete_meal 已完成。";

    assert.equal(
      renderGuardedMutationReceipt(effects, {
        operation: "orchestrator_receipt",
        verb: "delete",
        turnId: "turn-delete-clean",
        candidateReceipt: cleanCandidate,
        structuredFoodNames: ["body armor", "field roast"],
      }),
      cleanCandidate,
    );
    assert.equal(
      renderGuardedMutationReceipt(effects, {
        operation: "orchestrator_receipt",
        verb: "delete",
        turnId: "turn-delete-leak",
        candidateReceipt: leakingCandidate,
        structuredFoodNames: ["body armor", "field roast"],
      }),
      renderMutationReceipt(effects),
    );
  });

  it("covers direct log, update, delete, and goals receipt fallback without throwing after commit", () => {
    const cases: Array<{ effects: MutationEffects; verb: "log" | "update" | "delete" | "goals"; leak: string }> = [
      { effects: mealEffects("雞腿便當", "log"), verb: "log", leak: "log_food" },
      { effects: mealEffects("鮭魚飯", "update"), verb: "update", leak: "update_meal" },
      { effects: deleteEffects("拿鐵"), verb: "delete", leak: "delete_meal" },
      { effects: goalEffects(), verb: "goals", leak: "update_goals" },
    ];

    for (const { effects, verb, leak } of cases) {
      assert.doesNotThrow(() =>
        renderGuardedMutationReceipt(effects, {
          operation: "orchestrator_receipt",
          verb,
          turnId: `turn-direct-${verb}`,
          candidateReceipt: `已完成 ${leak}。`,
        }),
      );
      assert.equal(
        renderGuardedMutationReceipt(effects, {
          operation: "orchestrator_receipt",
          verb,
          turnId: `turn-direct-${verb}`,
          candidateReceipt: `已完成 ${leak}。`,
        }),
        renderMutationReceipt(effects),
      );
    }
  });
});

describe("public meal item projection", () => {
  it("preserves persisted 0-based grouped item positions", () => {
    const items = projectPublicMealItems([
      { foodName: "雞腿", position: 0, calories: 260, protein: 24, carbs: 0, fat: 15 },
      { foodName: "白飯", position: 1, calories: 280, protein: 5, carbs: 62, fat: 1 },
    ]);

    assert.deepEqual(items, [
      { name: "雞腿", position: 0, calories: 260, protein: 24, carbs: 0, fat: 15 },
      { name: "白飯", position: 1, calories: 280, protein: 5, carbs: 62, fat: 1 },
    ]);
  });

  it("keeps receipt edit payloads strict 0-based and rejects one-based contiguous items", () => {
    const baseReceipt = {
      receiptStatus: "active" as const,
      mealId: "receipt-grouped",
      mealRevisionId: "receipt-grouped:r1",
      dateKey: "2026-06-17",
      loggedAt: "2026-06-17T04:00:00.000Z",
      foodName: "雞腿、白飯",
      calories: 540,
      protein: 29,
      carbs: 62,
      fat: 16,
      itemCount: 2,
      imageAssetId: null,
      imageUrl: null,
    };

    assert.deepEqual(
      buildReceiptMealEditPayload({
        ...baseReceipt,
        items: [
          { name: "雞腿", position: 0, calories: 260, protein: 24, carbs: 0, fat: 15 },
          { name: "白飯", position: 1, calories: 280, protein: 5, carbs: 62, fat: 1 },
        ],
      })?.items,
      [
        { name: "雞腿", position: 0, calories: 260, protein: 24, carbs: 0, fat: 15 },
        { name: "白飯", position: 1, calories: 280, protein: 5, carbs: 62, fat: 1 },
      ],
    );

    assert.equal(
      buildReceiptMealEditPayload({
        ...baseReceipt,
        items: [
          { name: "雞腿", position: 1, calories: 260, protein: 24, carbs: 0, fat: 15 },
          { name: "白飯", position: 2, calories: 280, protein: 5, carbs: 62, fat: 1 },
        ],
      }),
      null,
    );
  });
});
