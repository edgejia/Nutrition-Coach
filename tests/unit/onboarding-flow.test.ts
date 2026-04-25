import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { IntakeValidationIssue } from "../../client/src/types.js";

const flow = await import("../../client/src/lib/onboarding-flow.js");

describe("onboarding-flow", () => {
  const issues: IntakeValidationIssue[] = [
    {
      field: "goalClarification",
      code: "GOAL_CLARIFICATION_TOO_LONG",
      step: 2,
      message: "目標補充最多 300 字",
    },
    {
      field: "age",
      code: "AGE_OUT_OF_RANGE",
      step: 3,
      message: "年齡需介於 10-120",
    },
    {
      field: "trainingFrequency",
      code: "INVALID_TRAINING_FREQUENCY",
      step: 4,
      message: "請選擇有效的訓練頻率",
    },
  ];

  it("groups issues by step without dropping later-step errors", () => {
    const grouped = flow.groupValidationIssuesByStep(issues);

    assert.deepEqual(grouped[2], [issues[0]]);
    assert.deepEqual(grouped[3], [issues[1]]);
    assert.deepEqual(grouped[4], [issues[2]]);
  });

  it("returns one step's field-error map", () => {
    assert.deepEqual(flow.getStepFieldErrors(issues, 3), {
      age: "年齡需介於 10-120",
    });
  });

  it("clears only the requested field via the canonical helper wrapper", () => {
    assert.deepEqual(flow.clearStepFieldError(issues, "age"), [issues[0], issues[2]]);
  });

  it("returns the original set when the field has no issue", () => {
    assert.deepEqual(flow.clearStepFieldError(issues, "bodyFatPercent"), issues);
  });
});
