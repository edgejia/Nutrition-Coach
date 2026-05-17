import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { DailyTargets } from "../../server/services/device.js";
import type { DailySummary } from "../../server/services/summary.js";
import type { SummaryOutcome } from "../../server/services/summary-outcome.js";
import type { MutationEffects } from "../../server/orchestrator/mutation-effects.js";
import {
  FORBIDDEN_RECEIPT_TERMS,
  assertNoForbiddenReceiptTerms,
  renderGoalAuthorityFailureCopy,
  renderGoalCancelCopy,
  renderGoalProposalCopy,
  renderGoalValidationFailureCopy,
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

const recoveredSummary: DailySummary = {
  ...committedSummary,
  totalCalories: 521,
};

const summaryOutcomes = [
  { status: "fresh", dailySummary: committedSummary },
  { status: "recovered", reason: "recompute_failed", dailySummary: recoveredSummary },
  { status: "unavailable", reason: "recompute_failed" },
] satisfies SummaryOutcome[];

const FORBIDDEN_SUMMARY_RECEIPT_TERMS = [
  "summaryOutcome",
  "dailySummary",
  "recompute_failed",
  "publish_failed",
  "PATCH",
  "DELETE",
  "/api",
] as const;

const GOAL_INTERNAL_TERMS = [
  "proposalId",
  "turn_states",
  "update_goals",
  "propose_goals",
  "schema_validation",
  "source_text_guard",
  "API",
  "/api",
] as const;

function assertNoGoalInternalTerms(text: string) {
  const leaked = GOAL_INTERNAL_TERMS.filter((term) => text.includes(term));
  assert.deepEqual(leaked, []);
  assert.deepEqual(assertNoForbiddenReceiptTerms(text), []);
}

describe("MutationEffects contract", () => {
  it("keeps mutation families as a discriminated committed-facts union", () => {
    const effects = [
      {
        kind: "log",
        affectedDate: "2026-05-10",
        summaryOutcome: summaryOutcomes[0],
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
        summaryOutcome: summaryOutcomes[0],
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
        summaryOutcome: summaryOutcomes[0],
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

describe("goal proposal and rejection renderers", () => {
  it("renders exact proposal copy with all four target values", () => {
    const text = renderGoalProposalCopy({
      calories: 1400,
      protein: 120,
      carbs: 130,
      fat: 45,
    });

    assert.equal(
      text,
      "我可以先幫你改成這組每日目標：\n• 卡路里 1400 kcal\n• 蛋白質 120 g\n• 碳水 130 g\n• 脂肪 45 g\n如果要套用，請回覆「好」；如果要調整，請直接給新的數字。",
    );
    assert.doesNotMatch(text, /已更新每日目標/);
    assertNoGoalInternalTerms(text);
  });

  it("renders one generic authority failure copy for unavailable proposal states", () => {
    const expected = "這次沒有套用目標更新。請直接提供新的每日目標數字，或再請我產生一組建議。";

    for (const reason of ["missing", "expired", "consumed", "replaced", "mismatch", "unauthorized"]) {
      const text = renderGoalAuthorityFailureCopy();
      assert.equal(text, expected, reason);
      assertNoGoalInternalTerms(text);
    }
  });

  it("renders exact validation range copy for each target field", () => {
    assert.equal(
      renderGoalValidationFailureCopy(["calories"]),
      "這次沒有套用目標更新。卡路里需介於 500-8000 kcal，請提供範圍內的每日目標數字。",
    );
    assert.equal(
      renderGoalValidationFailureCopy(["protein"]),
      "這次沒有套用目標更新。蛋白質需介於 0-400 g，請提供範圍內的每日目標數字。",
    );
    assert.equal(
      renderGoalValidationFailureCopy(["carbs"]),
      "這次沒有套用目標更新。碳水需介於 0-1000 g，請提供範圍內的每日目標數字。",
    );
    assert.equal(
      renderGoalValidationFailureCopy(["fat"]),
      "這次沒有套用目標更新。脂肪需介於 0-300 g，請提供範圍內的每日目標數字。",
    );

    for (const field of ["calories", "protein", "carbs", "fat"] as const) {
      assertNoGoalInternalTerms(renderGoalValidationFailureCopy([field]));
    }
  });

  it("renders exact neutral cancel copy without implying success", () => {
    const text = renderGoalCancelCopy();

    assert.equal(
      text,
      "已取消這組目標提案，沒有套用任何更新。之後可以直接提供新的目標數字，或再請我產生一組建議。",
    );
    assert.doesNotMatch(text, /已更新每日目標/);
    assertNoGoalInternalTerms(text);
  });
});

describe("mutation receipt renderer", () => {
  it("renders log receipts from committed meal facts", () => {
    const text = renderMutationReceipt({
      kind: "log",
      affectedDate: "2025-12-31",
      summaryOutcome: summaryOutcomes[0],
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
      summaryOutcome: summaryOutcomes[0],
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
      summaryOutcome: summaryOutcomes[0],
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
      summaryOutcome: summaryOutcomes[0],
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

  it("renders identical log receipts for fresh recovered and unavailable summary outcomes", () => {
    const rendered = summaryOutcomes.map((summaryOutcome) =>
      renderMutationReceipt({
        kind: "log",
        affectedDate: "2025-12-31",
        summaryOutcome,
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
      }),
    );

    assert.deepEqual(rendered, [
      "已記錄2025/12/31 雞胸便當，520 kcal，蛋白質 31 g。",
      "已記錄2025/12/31 雞胸便當，520 kcal，蛋白質 31 g。",
      "已記錄2025/12/31 雞胸便當，520 kcal，蛋白質 31 g。",
    ]);
    for (const text of rendered) {
      assert.deepEqual(assertNoForbiddenReceiptTerms(text), []);
      for (const term of FORBIDDEN_SUMMARY_RECEIPT_TERMS) {
        assert.equal(text.includes(term), false, term);
      }
    }
  });

  it("renders identical update receipts for fresh recovered and unavailable summary outcomes", () => {
    const rendered = summaryOutcomes.map((summaryOutcome) =>
      renderMutationReceipt({
        kind: "update",
        affectedDate: "2025-12-31",
        summaryOutcome,
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
      }),
    );

    assert.deepEqual(rendered, [
      "已更新2025/12/31 鮭魚飯，610 kcal，蛋白質 36 g。",
      "已更新2025/12/31 鮭魚飯，610 kcal，蛋白質 36 g。",
      "已更新2025/12/31 鮭魚飯，610 kcal，蛋白質 36 g。",
    ]);
    for (const text of rendered) {
      assert.deepEqual(assertNoForbiddenReceiptTerms(text), []);
      for (const term of FORBIDDEN_SUMMARY_RECEIPT_TERMS) {
        assert.equal(text.includes(term), false, term);
      }
    }
  });

  it("renders identical delete receipts for fresh recovered and unavailable summary outcomes", () => {
    const rendered = summaryOutcomes.map((summaryOutcome) =>
      renderMutationReceipt({
        kind: "delete",
        affectedDate: "2025-12-31",
        summaryOutcome,
        committedTargets,
        deletedMeal: {
          mealId: "meal-delete",
          dateKey: "2025-12-31",
          loggedAt: "2025-12-31T06:45:00.000Z",
          foodName: "拿鐵",
          calories: 180,
          protein: 9,
        },
      }),
    );

    assert.deepEqual(rendered, [
      "已刪除2025/12/31 拿鐵，已從當日紀錄移除。",
      "已刪除2025/12/31 拿鐵，已從當日紀錄移除。",
      "已刪除2025/12/31 拿鐵，已從當日紀錄移除。",
    ]);
    for (const text of rendered) {
      assert.deepEqual(assertNoForbiddenReceiptTerms(text), []);
      for (const term of FORBIDDEN_SUMMARY_RECEIPT_TERMS) {
        assert.equal(text.includes(term), false, term);
      }
    }
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
      "保守估算",
      "log_food",
      "update_meal",
      "delete_meal",
      "update_goals",
      "revision",
      "deviceId",
      "mealMutationKind",
      "summaryOutcome",
      "dailySummary",
      "recompute_failed",
      "publish_failed",
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
