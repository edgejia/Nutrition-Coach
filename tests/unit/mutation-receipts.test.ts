import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { DailyTargets } from "../../server/services/device.js";
import type { DailySummary } from "../../server/services/summary.js";
import type { SummaryOutcome } from "../../server/services/summary-outcome.js";
import type { MealCorrectionCandidate } from "../../server/services/meal-correction.js";
import type { MutationEffects } from "../../server/orchestrator/mutation-effects.js";
import {
  FORBIDDEN_RECEIPT_TERMS,
  assertNoForbiddenReceiptTerms,
  renderGoalAuthorityFailureCopy,
  renderGoalCancelCopy,
  renderGoalProposalCopy,
  renderUnsafeCalorieFloorCopy,
  renderGoalValidationFailureCopy,
  renderMealDeleteAuthorityFailureCopy,
  renderMealDeleteCancelCopy,
  renderMealDeleteProposalCopy,
  renderMealDeleteStaleCopy,
  renderMealNumericAuthorityFailureCopy,
  renderMealNumericCancelCopy,
  renderMealNumericClarificationCopy,
  renderMealNumericProposalCopy,
  renderRecentCorrectionEstimateProposalCopy,
  renderCorrectionTargetClarificationCopy,
  renderCorrectionTargetNoMealsForDateCopy,
  renderCorrectionTargetSameDateRecoveryCopy,
  renderProposalKindAmbiguityCopy,
  getProposalActionLabels,
  getProposalInlineEditHint,
  renderProposalActionEventCopy,
  renderProposalAlreadyProcessedCopy,
  renderProposalCardIntro,
  renderProposalExpiredCopy,
  renderProposalInactiveCopy,
  renderProposalSupersededCopy,
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

const MEAL_NUMERIC_INTERNAL_TERMS = [
  "proposalId",
  "mealId",
  "expectedMealRevisionId",
  "turn_states",
  "update_meal",
  "revision",
  "summaryOutcome",
  "dailySummary",
  "API",
  "tool",
  "payload",
] as const;

const MEAL_DELETE_INTERNAL_TERMS = [
  "proposalId",
  "mealId",
  "expectedMealRevisionId",
  "turn_states",
  "delete_meal",
  "revision",
  "payload",
  "summaryOutcome",
  "dailySummary",
  "API",
  "tool",
  "DELETE",
] as const;

const CORRECTION_TARGET_INTERNAL_TERMS = [
  "find_meals",
  "update_meal",
  "delete_meal",
  "tool",
  "revision",
  "mealRevisionId",
  "summaryOutcome",
  "dailySummary",
  "已更新",
  "已刪除",
] as const;

const correctionCandidates = [
  {
    mealId: "meal-lunch",
    mealRevisionId: "rev-lunch",
    foodName: "滷蛋、雞腿便當",
    itemCount: 2,
    itemNames: ["滷蛋", "雞腿便當"],
    calories: 720,
    protein: 42,
    carbs: 80,
    fat: 24,
    loggedAt: "2026-05-10T04:30:00.000Z",
    dateKey: "2026-05-10",
    mealPeriod: "lunch",
    mealPeriodSource: "explicit",
  },
  {
    mealId: "meal-dinner",
    mealRevisionId: "rev-dinner",
    foodName: "雞胸沙拉",
    itemCount: 1,
    itemNames: ["雞胸沙拉"],
    calories: 430,
    protein: 38,
    carbs: 22,
    fat: 18,
    loggedAt: "2026-05-10T10:45:00.000Z",
    dateKey: "2026-05-10",
    mealPeriod: "dinner",
    mealPeriodSource: "inferred",
  },
] satisfies MealCorrectionCandidate[];

function assertNoGoalInternalTerms(text: string) {
  const leaked = GOAL_INTERNAL_TERMS.filter((term) => text.includes(term));
  assert.deepEqual(leaked, []);
  assert.deepEqual(assertNoForbiddenReceiptTerms(text), []);
}

function assertNoMealNumericInternalTerms(text: string) {
  const leaked = MEAL_NUMERIC_INTERNAL_TERMS.filter((term) => text.includes(term));
  assert.deepEqual(leaked, []);
  assert.deepEqual(assertNoForbiddenReceiptTerms(text), []);
}

function assertNoMealDeleteInternalTerms(text: string) {
  const leaked = MEAL_DELETE_INTERNAL_TERMS.filter((term) => text.includes(term));
  assert.deepEqual(leaked, []);
  assert.deepEqual(assertNoForbiddenReceiptTerms(text), []);
}

function assertNoCorrectionTargetInternalTerms(text: string) {
  const leaked = CORRECTION_TARGET_INTERNAL_TERMS.filter((term) => text.includes(term));
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
  it("renders natural proposal copy with all four target values and a concise rationale", () => {
    const text = renderGoalProposalCopy({
      calories: 2200,
      protein: 165,
      carbs: 240,
      fat: 70,
    });

    assert.equal(
      text,
      "依你想調整目標的方向，我先整理一組比較完整、可執行的每日目標：\n• 卡路里 2200 kcal\n• 蛋白質 165 g\n• 碳水 240 g\n• 脂肪 70 g\n這組數字讓熱量、蛋白質、碳水和脂肪一起對齊，比只改單一數字更穩定。\n如果要套用，請回覆「好」；如果要調整，請直接給新的數字。",
    );
    assert.doesNotMatch(text, /已更新每日目標/);
    assert.doesNotMatch(text, /kcal\/day/);
    assert.doesNotMatch(text, /proposalId|targetSignature|SAFE-|propose_goals|update_goals|nutritionSafety/);
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

  it("renders exact unsafe calorie floor copy without diagnosis or internal policy ids", () => {
    const text = renderUnsafeCalorieFloorCopy();

    assert.equal(
      text,
      "這次沒有套用目標更新。這個每日熱量目標太低，我不能幫你設定或提案這樣的限制。請改成較安全、可持續的每日目標；如果你正在強烈限制飲食或覺得失控，建議和醫師或合格專業人員討論。",
    );
    assert.match(text, /^這次沒有套用目標更新。/);
    assert.match(text, /每日熱量目標太低/);
    assert.match(text, /不能幫你設定或提案/);
    assert.match(text, /較安全、可持續/);
    assert.match(text, /醫師或合格專業人員/);
    assert.doesNotMatch(text, /unsafe_calorie_floor|1200|500|SAFE-02|nutritionSafety|update_goals|propose_goals/);
    assert.doesNotMatch(text, /診斷|病症|疾病|飲食失調|厭食|暴食/);
    assertNoGoalInternalTerms(text);
  });
});

describe("recoverable proposal failure renderer", () => {
  it("returns the locked CFI-01 recovery copy and stays guard-clean", async () => {
    const receipts = await import("../../server/orchestrator/mutation-receipts.js") as {
      renderProposalRecoverableFailureCopy?: () => string;
    };
    const copy = receipts.renderProposalRecoverableFailureCopy?.();

    assert.equal(typeof receipts.renderProposalRecoverableFailureCopy, "function");
    assert.equal(copy, "這次沒有完成套用，資料沒有變更。請再試一次，或取消這個提案。");
    assert.deepEqual(assertNoForbiddenReceiptTerms(copy), []);
  });
});

describe("meal numeric proposal and rejection renderers", () => {
  it("renders proposal copy with meal label, every field, before and after values", () => {
    const text = renderMealNumericProposalCopy({
      mealLabel: "雞腿、白飯",
      affectedFields: [
        { field: "calories", before: 700, after: 520 },
        { field: "protein", before: 40, after: 20 },
        { field: "carbs", before: 80, after: 60 },
        { field: "fat", before: 22, after: 18 },
      ],
      sourceOperator: "half",
    });

    assert.equal(
      text,
      "我可以幫你把雞腿、白飯這樣調整（減半）：\n• 卡路里：700 kcal 改為 520 kcal\n• 蛋白質：40 g 改為 20 g\n• 碳水：80 g 改為 60 g\n• 脂肪：22 g 改為 18 g\n如果要套用，請回覆「好」；如果要調整，請直接給新的目標數字。",
    );
    assert.doesNotMatch(text, /40\s*[x×*]\s*0\.5|公式|計算式/);
    assertNoMealNumericInternalTerms(text);
  });

  it("uses item names when an explicit meal label is unavailable", () => {
    const text = renderMealNumericProposalCopy({
      items: [{ foodName: "鮭魚" }, { foodName: "地瓜" }],
      affectedFields: [{ field: "protein", before: 36, after: 30 }],
    });

    assert.match(text, /鮭魚、地瓜/);
    assert.match(text, /蛋白質：36 g 改為 30 g/);
    assertNoMealNumericInternalTerms(text);
  });

  it("discloses another active proposal kind without allowing bare approval ambiguity", () => {
    const text = renderMealNumericProposalCopy({
      mealLabel: "雞胸便當",
      affectedFields: [{ field: "calories", before: 620, after: 500 }],
      otherProposalKindActive: true,
    });

    assert.match(text, /雞胸便當/);
    assert.match(text, /卡路里：620 kcal 改為 500 kcal/);
    assert.match(text, /套用餐點修正/);
    assertNoMealNumericInternalTerms(text);
  });

  it("renders blocked and clarification copy as no-update Traditional Chinese guidance", () => {
    const blocked = renderMealNumericAuthorityFailureCopy({ field: "protein" });
    const clarification = renderMealNumericClarificationCopy({ field: "calories" });

    assert.match(blocked, /^這次沒有更新/);
    assert.match(blocked, /蛋白質/);
    assert.match(blocked, /減半|少 20%/);
    assert.match(blocked, /加 10g/);
    assert.match(blocked, /少 10g/);
    assert.match(clarification, /^這次沒有更新/);
    assert.match(clarification, /卡路里/);
    assert.match(clarification, /偏高/);
    assertNoMealNumericInternalTerms(blocked);
    assertNoMealNumericInternalTerms(clarification);
  });

  it("renders estimate-compatible proposal copy from affected fields only without internal provenance terms", () => {
    const text = renderMealNumericProposalCopy({
      mealLabel: "雞腿飯",
      affectedFields: [
        { field: "protein", before: 30, after: 28 },
      ],
    });

    assert.equal(
      text,
      "我可以幫你把雞腿飯這樣調整：\n• 蛋白質：30 g 改為 28 g\n如果要套用，請回覆「好」；如果要調整，請直接給新的目標數字。",
    );
    assert.doesNotMatch(text, /卡路里|碳水|脂肪/);
    assert.doesNotMatch(text, /model_estimate|provenance|propose_meal_estimate|AI 估計/);
    assertNoMealNumericInternalTerms(text);
  });

  it("adds a deterministic estimate hint to vague numeric clarification without implying mutation", () => {
    const text = renderMealNumericClarificationCopy();

    assert.match(text, /^這次沒有更新餐點紀錄。/);
    assert.match(text, /也可以請我幫你估合理/);
    assert.doesNotMatch(text, /已更新|已套用|model_estimate|propose_meal_estimate/);
    assertNoMealNumericInternalTerms(text);
  });

  it("renders recent correction estimate proposal copy with genuine-new-meal escape hatch", () => {
    const text = renderRecentCorrectionEstimateProposalCopy({
      mealLabel: "雞腿、白飯",
      affectedFields: [
        { field: "calories", before: 540, after: 480 },
        { field: "protein", before: 28, after: 30 },
      ],
    });

    assert.match(text, /先幫你重估/);
    assert.match(text, /請先確認/);
    assert.match(text, /其實是新的一餐 -> 照常記錄/);
    assert.doesNotMatch(text, /已更新|已記錄|model_estimate|propose_meal_estimate/);
    assertNoMealNumericInternalTerms(text);
  });

  it("renders cancel and cross-kind ambiguity copy without success wording", () => {
    const cancel = renderMealNumericCancelCopy();
    const ambiguity = renderProposalKindAmbiguityCopy();

    assert.equal(cancel, "已取消這組餐點修正提案，沒有更新任何餐點紀錄。");
    assert.equal(
      ambiguity,
      "這次沒有更新任何內容。你同時有餐點修正和每日目標提案，請回覆「套用餐點修正」或「套用每日目標」。",
    );
    assert.doesNotMatch(cancel, /已更新餐點|已更新每日目標/);
    assert.doesNotMatch(ambiguity, /已更新餐點|已更新每日目標/);
    assertNoMealNumericInternalTerms(cancel);
    assertNoMealNumericInternalTerms(ambiguity);
  });
});

describe("meal delete proposal and rejection renderers", () => {
  const snapshot = {
    mealId: "meal-internal",
    expectedMealRevisionId: "revision-internal",
    mealLabel: "牛肉麵、滷蛋",
    calories: 600,
    protein: 31,
    carbs: 69,
    fat: 21,
    dateKey: "2026-03-25",
    loggedAt: "2026-03-25T10:30:00.000Z",
    mealPeriod: "dinner" as const,
    items: [
      { foodName: "牛肉麵", calories: 520, protein: 24, carbs: 68, fat: 16 },
      { foodName: "滷蛋", calories: 80, protein: 7, carbs: 1, fat: 5 },
    ],
  };

  it("renders proposal copy with persisted user-visible meal facts only", () => {
    const text = renderMealDeleteProposalCopy({ snapshot });

    assert.match(text, /即將刪除：牛肉麵、滷蛋/);
    assert.doesNotMatch(text, /已刪除|成功刪除|完成刪除/);
    assert.match(text, /日期：2026-03-25 晚餐/);
    assert.match(text, /營養：600 kcal，P31g \/ C69g \/ F21g/);
    assert.match(text, /牛肉麵 520 kcal/);
    assert.match(text, /滷蛋 80 kcal/);
    assert.match(text, /確認.*刪除/);
    assert.match(text, /取消.*不會變更/);
    assert.doesNotMatch(text, /照片|圖片|image/);
    assertNoMealDeleteInternalTerms(text);
  });

  it("adds the explicit delete confirmation hint only when another proposal kind is active", () => {
    const withoutOtherProposal = renderMealDeleteProposalCopy({ snapshot });
    const withOtherProposal = renderMealDeleteProposalCopy({
      snapshot,
      otherProposalKindActive: true,
    });

    assert.doesNotMatch(withoutOtherProposal, /明確回覆「刪除這筆餐點」/);
    assert.match(withOtherProposal, /明確回覆「刪除這筆餐點」/);
    assertNoMealDeleteInternalTerms(withoutOtherProposal);
    assertNoMealDeleteInternalTerms(withOtherProposal);
  });

  it("renders no-delete cancel, authority failure, and stale copy", () => {
    const cancel = renderMealDeleteCancelCopy();
    const authorityFailure = renderMealDeleteAuthorityFailureCopy();
    const stale = renderMealDeleteStaleCopy();

    assert.equal(cancel, "已取消刪除這筆餐點，餐點紀錄沒有變更。");
    assert.match(authorityFailure, /^這次沒有刪除餐點紀錄。/);
    assert.match(stale, /^這次沒有刪除餐點紀錄。/);
    assert.match(stale, /餐點內容已經變更/);
    for (const text of [cancel, authorityFailure, stale]) {
      assert.doesNotMatch(text, /已刪除|成功刪除/);
      assertNoMealDeleteInternalTerms(text);
    }
  });
});

describe("proposal card labels, action events, and inactive copy", () => {
  it("renders proposal-kind-specific action labels including edit-close copy", () => {
    assert.deepEqual(getProposalActionLabels("goal"), {
      approveLabel: "套用目標",
      editLabel: "調整目標",
      rejectLabel: "取消提案",
      closeEditLabel: "關閉編輯",
    });
    assert.deepEqual(getProposalActionLabels("meal_numeric"), {
      approveLabel: "套用修改",
      editLabel: "改成其他數字",
      rejectLabel: "取消提案",
      closeEditLabel: "關閉編輯",
    });
    assert.deepEqual(getProposalActionLabels("meal_estimate"), {
      approveLabel: "套用修改",
      editLabel: "改成其他數字",
      rejectLabel: "取消提案",
      closeEditLabel: "關閉編輯",
    });
    assert.deepEqual(getProposalActionLabels("meal_delete"), {
      approveLabel: "確認刪除",
      editLabel: "先不要刪，改問別的",
      rejectLabel: "取消刪除",
      closeEditLabel: "關閉編輯",
      destructiveConfirmationLabel: "確認刪除這筆餐點",
    });
  });

  it("renders empty-input inline edit hints and short card intros", () => {
    assert.equal(getProposalInlineEditHint("goal"), "輸入新的每日目標，例如：蛋白質改 120g");
    assert.equal(getProposalInlineEditHint("meal_numeric"), "輸入你想改成的數字，例如：蛋白質改 30g");
    assert.equal(getProposalInlineEditHint("meal_estimate"), "輸入你想怎麼調整，例如：熱量再低一點");
    assert.equal(getProposalInlineEditHint("meal_delete"), "輸入新的需求；這不會直接刪除餐點");

    assert.equal(renderProposalCardIntro("goal"), "請確認這組每日目標提案。");
    assert.equal(renderProposalCardIntro("meal_numeric"), "請確認這組餐點修改提案。");
    assert.equal(renderProposalCardIntro("meal_estimate"), "請確認這組估值修改提案。");
    assert.equal(renderProposalCardIntro("meal_delete"), "請確認是否刪除這筆餐點。");
  });

  it("renders structured action-event copy separately from typed user text", () => {
    assert.equal(
      renderProposalActionEventCopy({ proposalKind: "goal", action: "approve" }),
      "已選擇套用目標",
    );
    assert.equal(
      renderProposalActionEventCopy({ proposalKind: "meal_numeric", action: "approve" }),
      "已選擇套用餐點修改",
    );
    assert.equal(
      renderProposalActionEventCopy({ proposalKind: "meal_estimate", action: "approve" }),
      "已選擇套用餐點修改",
    );
    assert.equal(
      renderProposalActionEventCopy({ proposalKind: "meal_delete", action: "approve" }),
      "已選擇確認刪除",
    );
    assert.equal(
      renderProposalActionEventCopy({ proposalKind: "goal", action: "reject" }),
      "已取消目標提案",
    );
    assert.equal(
      renderProposalActionEventCopy({ proposalKind: "meal_numeric", action: "reject" }),
      "已取消餐點修改提案",
    );
    assert.equal(
      renderProposalActionEventCopy({ proposalKind: "meal_estimate", action: "reject" }),
      "已取消餐點修改提案",
    );
    assert.equal(
      renderProposalActionEventCopy({ proposalKind: "meal_delete", action: "reject" }),
      "已取消刪除提案",
    );
  });

  it("renders exact expired, superseded, and stale inactive copy", () => {
    assert.equal(renderProposalExpiredCopy("goal"), "這個目標提案已超過 30 分鐘，請重新提出目標調整。");
    assert.equal(renderProposalExpiredCopy("meal_numeric"), "這個餐點修改提案已超過 30 分鐘，請重新提出修改。");
    assert.equal(renderProposalExpiredCopy("meal_estimate"), "這個估值修改提案已超過 30 分鐘，請重新提出修改。");
    assert.equal(renderProposalExpiredCopy("meal_delete"), "這個刪除確認已超過 30 分鐘，請重新選擇要刪除的餐點。");

    assert.equal(
      renderProposalSupersededCopy({ proposalKind: "meal_numeric", supersededByKind: "meal_numeric" }),
      "這個提案已被新的餐點修改取代。",
    );
    assert.equal(
      renderProposalSupersededCopy({ proposalKind: "meal_numeric", supersededByKind: "meal_estimate" }),
      "這個提案已被新的估值修改取代。",
    );
    assert.equal(
      renderProposalSupersededCopy({ proposalKind: "meal_estimate", supersededByKind: "meal_delete" }),
      "這個提案已被新的刪除確認取代。",
    );
    assert.equal(
      renderProposalSupersededCopy({ proposalKind: "goal", supersededByKind: "goal" }),
      "這個目標提案已被新的目標提案取代。",
    );
    assert.equal(
      renderProposalInactiveCopy({ proposalKind: "meal_delete", status: "stale" }),
      "這個提案已不是目前有效狀態，沒有更新任何資料。請重新提出需求。",
    );
  });

  it("renders exact already-processed proposal copy without forbidden receipt terms", () => {
    const text = renderProposalAlreadyProcessedCopy();

    assert.equal(text, "這個提案已經處理過，不需要再確認一次。");
    assert.deepEqual(assertNoForbiddenReceiptTerms(text), []);
  });

  it("keeps delete approve and reject copy scoped to a pending proposal", () => {
    const labels = getProposalActionLabels("meal_delete");

    assert.equal(labels.approveLabel, "確認刪除");
    assert.equal(labels.destructiveConfirmationLabel, "確認刪除這筆餐點");
    assert.equal(labels.rejectLabel, "取消刪除");
    assert.equal(renderProposalActionEventCopy({ proposalKind: "meal_delete", action: "reject" }), "已取消刪除提案");
    assert.doesNotMatch(labels.rejectLabel, /復原|還原|已刪除/);
  });
});

describe("correction target clarification renderers", () => {
  it("Phase 67 D-22/D-23/D-24/D-25/D-26/D-28 renders stable backend-owned numbered options", () => {
    const text = renderCorrectionTargetClarificationCopy({
      action: "update",
      matchedLabel: "滷蛋",
      candidates: correctionCandidates,
    });

    assert.equal(
      text,
      "我找到多筆可能符合「滷蛋」的餐點，請直接回覆編號：\n1. 2026-05-10 12:30 午餐 滷蛋、雞腿便當\n2. 2026-05-10 18:45 雞胸沙拉",
    );
    assert.match(text, /^我找到多筆/);
    assert.match(text, /請直接回覆編號/);
    assert.match(text, /^1\. 2026-05-10 12:30 午餐 滷蛋、雞腿便當/m);
    assert.match(text, /^2\. 2026-05-10 18:45 雞胸沙拉/m);
    assert.doesNotMatch(text, /晚餐 雞胸沙拉/);
    assert.doesNotMatch(text, /720|430|42|38|kcal|蛋白質|碳水|脂肪/);
    assert.doesNotMatch(text, /中午雞腿便當/);
    assertNoCorrectionTargetInternalTerms(text);
  });

  it("Phase 67 D-27/D-29/D-31 falls back to generic meal copy and limits options to five", () => {
    const text = renderCorrectionTargetClarificationCopy({
      action: "delete",
      matchedLabel: "  ",
      candidates: [
        ...correctionCandidates,
        { ...correctionCandidates[0], mealId: "meal-3", mealRevisionId: "rev-3", foodName: "第三筆" },
        { ...correctionCandidates[0], mealId: "meal-4", mealRevisionId: "rev-4", foodName: "第四筆" },
        { ...correctionCandidates[0], mealId: "meal-5", mealRevisionId: "rev-5", foodName: "第五筆" },
        { ...correctionCandidates[0], mealId: "meal-6", mealRevisionId: "rev-6", foodName: "第六筆" },
      ],
    });

    assert.match(text, /^我找到多筆可能要刪除的餐點，請直接回覆編號：/);
    assert.match(text, /^5\. /m);
    assert.doesNotMatch(text, /^6\. /m);
    assertNoCorrectionTargetInternalTerms(text);
  });

  it("Phase 67 D-30 renders same-date recovery as same-date numbered confirmation only", () => {
    const text = renderCorrectionTargetSameDateRecoveryCopy({
      action: "update",
      dateKey: "2026-05-10",
      candidates: [
        correctionCandidates[0],
        { ...correctionCandidates[1], dateKey: "2026-05-09" },
      ],
    });

    assert.equal(
      text,
      "2026-05-10 有幾筆餐點，請直接回覆編號：\n1. 2026-05-10 12:30 午餐 滷蛋、雞腿便當",
    );
    assert.match(text, /請直接回覆編號/);
    assert.doesNotMatch(text, /2026-05-09/);
    assert.doesNotMatch(text, /已更新|已刪除/);
    assertNoCorrectionTargetInternalTerms(text);
  });

  it("Phase 67 D-30 renders explicit single-date no-meals copy without off-date options", () => {
    const text = renderCorrectionTargetNoMealsForDateCopy({
      action: "delete",
      dateKey: "2026-05-08",
    });

    assert.equal(
      text,
      "2026-05-08 沒有記錄餐點，所以我還不能刪除那一天的餐點。請提供另一個日期或食物名稱。",
    );
    assert.doesNotMatch(text, /^1\. /m);
    assert.doesNotMatch(text, /2026-05-09|2026-05-10|已刪除/);
    assertNoCorrectionTargetInternalTerms(text);
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

  it("keeps delete success copy unreachable without the committed deletedMeal fact", () => {
    assert.throws(
      () => renderMutationReceipt({
        kind: "delete",
        affectedDate: "2025-12-31",
        summaryOutcome: summaryOutcomes[0],
        committedTargets,
      } as unknown as MutationEffects),
      /deletedMeal/,
    );
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

  it("D-14 keeps visible receipt copy renderer-owned and separate from structured history facts", () => {
    const visibleReceipt = renderMutationReceipt({
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

    assert.equal(visibleReceipt, "已記錄2025/12/31 雞胸便當，520 kcal，蛋白質 31 g。");
    assert.deepEqual(assertNoForbiddenReceiptTerms(visibleReceipt), []);
    assert.doesNotMatch(visibleReceipt, /mutationOutcomeFact|compressed history|structured outcome/i);
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
      "contractResult",
      "daily_summary",
      "provider",
      "debug",
      "tool",
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
