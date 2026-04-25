import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { IntakeData, IntakeValidationIssue } from "../../client/src/types.js";

const validation = await import("../../client/src/lib/onboarding-intake-validation.js");

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
    goalClarification: "想穩定減脂",
    bodyFatPercent: 24,
    tdee: 1900,
    advancedNotes: "喜歡簡單餐點",
    ...overrides,
  };
}

function issueCodes(issues: IntakeValidationIssue[]) {
  return issues.map((issue) => issue.code);
}

describe("onboarding-intake-validation", () => {
  it("validateOnboardingStep(3) rejects invalid body metrics", () => {
    const issues = validation.validateOnboardingStep(3, {
      sex: "female",
      age: 9,
      heightCm: Number.NaN,
      weightKg: 10,
    } as Partial<IntakeData>);

    assert.deepEqual(issueCodes(issues), ["AGE_OUT_OF_RANGE", "INVALID_HEIGHT_CM", "WEIGHT_OUT_OF_RANGE"]);
    assert.deepEqual(
      issues.map((issue) => issue.step),
      [3, 3, 3],
    );
  });

  it("validateOnboardingStep(4) rejects missing enums and trims optional allergies", () => {
    const issues = validation.validateOnboardingStep(4, {
      allergies: "x".repeat(301),
    } as Partial<IntakeData>);

    assert.deepEqual(issueCodes(issues), [
      "INVALID_ACTIVITY_LEVEL",
      "INVALID_TRAINING_FREQUENCY",
      "ALLERGIES_TOO_LONG",
    ]);

    assert.deepEqual(validation.validateOnboardingStep(4, {
      activityLevel: "moderate",
      trainingFrequency: "3_4",
      allergies: "  花生  ",
    }), []);
  });

  it("validateOnboardingStep(5) rejects out-of-range advanced metrics", () => {
    const issues = validation.validateOnboardingStep(5, {
      bodyFatPercent: 1,
      tdee: 9000,
      advancedNotes: "n".repeat(501),
    });

    assert.deepEqual(issueCodes(issues), [
      "BODY_FAT_OUT_OF_RANGE",
      "TDEE_OUT_OF_RANGE",
      "ADVANCED_NOTES_TOO_LONG",
    ]);
  });

  it("validateIntake returns combined issues and earliest failing step", () => {
    const issues = validation.validateIntake(makeIntake({
      goalClarification: "a".repeat(301),
      age: 121,
    }));

    assert.deepEqual(issueCodes(issues), ["GOAL_CLARIFICATION_TOO_LONG", "AGE_OUT_OF_RANGE"]);
    assert.equal(validation.getEarliestValidationStep(issues), 2);
  });

  it("clearValidationIssueForField removes only the targeted field issue", () => {
    const issues: IntakeValidationIssue[] = [
      { field: "age", code: "AGE_OUT_OF_RANGE", step: 3, message: "年齡需介於 10-120" },
      { field: "trainingFrequency", code: "INVALID_TRAINING_FREQUENCY", step: 4, message: "請選擇有效的訓練頻率" },
    ];

    assert.deepEqual(validation.clearValidationIssueForField(issues, "age"), [issues[1]]);
  });
});
