import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { IntakeData, IntakeValidationIssue } from "../../client/src/types.js";

const api = await import("../../client/src/api.js");
const stepperFlow = await import("../../client/src/lib/onboarding-stepper-flow.js");
const { StepCoachHandoff } = await import("../../client/src/components/onboarding/StepCoachHandoff.js");

function makeIntake(overrides: Partial<IntakeData> = {}): IntakeData {
  return {
    goal: "fat_loss",
    sex: "female",
    age: 31,
    heightCm: 165,
    weightKg: 58,
    activityLevel: "moderate",
    trainingFrequency: "3_4",
    allergies: "花生",
    goalClarification: "想慢慢減脂",
    bodyFatPercent: 24,
    tdee: 1900,
    advancedNotes: "喜歡簡單餐點",
    ...overrides,
  };
}

describe("onboarding-stepper-flow", () => {
  it("inserts a goal clarification quick note on first tap", () => {
    const outcome = stepperFlow.applyGoalClarificationQuickNote({
      goalClarification: "",
      selectedNotes: [],
    }, "不想影響重訓表現");

    assert.equal(outcome.goalClarification, "不想影響重訓表現");
    assert.deepEqual(outcome.selectedNotes, ["不想影響重訓表現"]);
    assert.equal(outcome.inserted, true);
  });

  it("ignores repeated selected goal clarification quick-note taps", () => {
    const firstOutcome = stepperFlow.applyGoalClarificationQuickNote({
      goalClarification: "",
      selectedNotes: [],
    }, "不想影響重訓表現");

    const repeatedOutcome = stepperFlow.applyGoalClarificationQuickNote(firstOutcome, "不想影響重訓表現");

    assert.equal(repeatedOutcome.goalClarification, "不想影響重訓表現");
    assert.deepEqual(repeatedOutcome.selectedNotes, ["不想影響重訓表現"]);
    assert.equal(repeatedOutcome.inserted, false);
  });

  it("preserves manual goal clarification edits after quick-note insertion", () => {
    const insertedOutcome = stepperFlow.applyGoalClarificationQuickNote({
      goalClarification: "",
      selectedNotes: [],
    }, "不想影響重訓表現");

    const manuallyEditedState = {
      ...insertedOutcome,
      goalClarification: "我想維持肌力，但晚餐常外食",
    };
    const repeatedOutcome = stepperFlow.applyGoalClarificationQuickNote(manuallyEditedState, "不想影響重訓表現");

    assert.equal(repeatedOutcome.goalClarification, "我想維持肌力，但晚餐常外食");
    assert.deepEqual(repeatedOutcome.selectedNotes, ["不想影響重訓表現"]);
    assert.equal(repeatedOutcome.inserted, false);
  });

  it("treats matching freeform text as unselected when selectedNotes is empty", () => {
    const outcome = stepperFlow.applyGoalClarificationQuickNote({
      goalClarification: "不想影響重訓表現",
      selectedNotes: [],
    }, "不想影響重訓表現");

    assert.equal(outcome.goalClarification, "不想影響重訓表現、不想影響重訓表現");
    assert.deepEqual(outcome.selectedNotes, ["不想影響重訓表現"]);
    assert.equal(outcome.inserted, true);
  });

  it("does not reject or rewrite repeated freeform goal clarification text during validation", () => {
    const repeatedFreeformText = "不想影響重訓表現、不想影響重訓表現";
    const stepDraft = {
      goal: "fat_loss" as const,
      goalClarification: repeatedFreeformText,
    };
    const stepOutcome = stepperFlow.getStepAdvanceOutcome(2, stepDraft);

    assert.equal(stepOutcome.nextStep, 3);
    assert.deepEqual(stepOutcome.issues, []);
    assert.equal(stepDraft.goalClarification, repeatedFreeformText);

    const submitDraft = makeIntake({ goalClarification: repeatedFreeformText });
    const submitOutcome = stepperFlow.getSubmitGateOutcome(submitDraft);

    assert.equal(submitOutcome.nextStep, 6);
    assert.deepEqual(submitOutcome.issues, []);
    assert.equal(submitDraft.goalClarification, repeatedFreeformText);
  });

  it("returns same-step issues when step validation fails", () => {
    const outcome = stepperFlow.getStepAdvanceOutcome(3, {
      sex: "female",
      age: 9,
      heightCm: 165,
      weightKg: 58,
    });

    assert.equal(outcome.nextStep, 3);
    assert.deepEqual(outcome.issues.map((issue: IntakeValidationIssue) => issue.code), ["AGE_OUT_OF_RANGE"]);
  });

  it("blocks Step 2 progression when clarification text exceeds the step limit", () => {
    const outcome = stepperFlow.getStepAdvanceOutcome(2, {
      goal: "fat_loss",
      goalClarification: "a".repeat(301),
    });

    assert.equal(outcome.nextStep, 2);
    assert.deepEqual(outcome.issues.map((issue: IntakeValidationIssue) => issue.code), [
      "GOAL_CLARIFICATION_TOO_LONG",
    ]);
  });

  it("runSubmitAttempt short-circuits invalid client payloads before Step 6 or submit()", async () => {
    let submitCalls = 0;
    const outcome = await stepperFlow.runSubmitAttempt(
      makeIntake({
        goalClarification: "a".repeat(301),
        age: 9,
      }),
      async () => {
        submitCalls += 1;
        throw new Error("should not be called");
      },
    );

    assert.equal(submitCalls, 0);
    assert.equal(outcome.nextStep, 2);
    assert.equal(outcome.transportError, null);
    assert.deepEqual(outcome.issues.map((issue: IntakeValidationIssue) => issue.step), [2, 3]);
  });

  it("clears stale optional Step 5 values when advanced metrics are skipped", () => {
    const merged = {
      ...makeIntake({
        bodyFatPercent: 99,
        tdee: 9000,
        advancedNotes: "舊的備註",
      }),
      ...stepperFlow.getAdvancedMetricsSkipData(),
    };

    assert.equal(merged.bodyFatPercent, undefined);
    assert.equal(merged.tdee, undefined);
    assert.equal(merged.advancedNotes, undefined);
    assert.deepEqual(stepperFlow.getStepAdvanceOutcome(5, merged).issues, []);
    assert.equal(stepperFlow.getSubmitGateOutcome(merged).nextStep, 6);
  });

  it("runSubmitAttempt preserves backend validation issues and routes to earliest step", async () => {
    const errors: IntakeValidationIssue[] = [
      { field: "age", code: "AGE_OUT_OF_RANGE", step: 3, message: "年齡需介於 10-120" },
      { field: "trainingFrequency", code: "INVALID_TRAINING_FREQUENCY", step: 4, message: "請選擇有效的訓練頻率" },
    ];

    const outcome = await stepperFlow.runSubmitAttempt(
      makeIntake(),
      async () => {
        throw new api.IntakeValidationError(errors, 3);
      },
      () => undefined,
    );

    assert.equal(outcome.nextStep, 3);
    assert.equal(outcome.transportError, null);
    assert.deepEqual(outcome.issues, errors);
  });

  it("applyFieldEditRecovery clears only the targeted field issue", () => {
    const errors: IntakeValidationIssue[] = [
      { field: "age", code: "AGE_OUT_OF_RANGE", step: 3, message: "年齡需介於 10-120" },
      { field: "trainingFrequency", code: "INVALID_TRAINING_FREQUENCY", step: 4, message: "請選擇有效的訓練頻率" },
    ];

    assert.deepEqual(stepperFlow.applyFieldEditRecovery(errors, "age"), [errors[1]]);
  });

  it("applyFieldEditRecovery clears sex and allergies validation issues", () => {
    const errors: IntakeValidationIssue[] = [
      { field: "sex", code: "INVALID_SEX", step: 3, message: "請選擇有效的性別" },
      { field: "allergies", code: "ALLERGIES_TOO_LONG", step: 4, message: "飲食限制請控制在 300 字內" },
      { field: "age", code: "AGE_OUT_OF_RANGE", step: 3, message: "年齡需介於 10-120" },
    ];

    assert.deepEqual(stepperFlow.applyFieldEditRecovery(errors, "sex"), [errors[1], errors[2]]);
    assert.deepEqual(stepperFlow.applyFieldEditRecovery(errors, "allergies"), [errors[0], errors[2]]);
  });

  it("keeps Step 6 transport failure UI separate from validation recovery", async () => {
    const outcome = await stepperFlow.runSubmitAttempt(
      makeIntake(),
      async () => {
        throw new Error("timeout");
      },
      () => undefined,
    );

    assert.equal(outcome.nextStep, 6);
    assert.equal(outcome.transportError, "無法連線，請稍後再試。");

    const html = renderToStaticMarkup(createElement(StepCoachHandoff, {
      loading: false,
      transportError: outcome.transportError,
      result: null,
      onStart: () => undefined,
      onRetry: () => undefined,
    }));

    assert.match(html, /連線失敗/);
    assert.match(html, /重試/);
  });
});
