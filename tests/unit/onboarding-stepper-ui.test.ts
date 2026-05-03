import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const storage = new Map<string, string>();
globalThis.localStorage = {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => {
    storage.set(key, value);
  },
  removeItem: (key: string) => {
    storage.delete(key);
  },
  clear: () => {
    storage.clear();
  },
  get length() {
    return storage.size;
  },
  key: (index: number) => [...storage.keys()][index] ?? null,
} as Storage;

const { OnboardingStepperPresentation } = await import("../../client/src/components/onboarding/OnboardingStepper.js");
const { StepCoachHandoff } = await import("../../client/src/components/onboarding/StepCoachHandoff.js");

describe("onboarding stepper UI", () => {
  it("renders Step 1 goal recovery with validation copy and selectable goals", () => {
    const html = renderToStaticMarkup(createElement(OnboardingStepperPresentation, {
      step: 1,
      data: {
        goal: "fat_loss",
        sex: "female",
        age: 31,
        heightCm: 165,
        weightKg: 58,
      },
      validationIssues: [
        {
          field: "goal",
          code: "INVALID_GOAL",
          step: 1,
          message: "請選擇有效的目標",
        },
      ],
      loading: false,
      transportError: null,
      result: null,
      onGoalSelect: () => undefined,
      onGoalClarificationNext: () => undefined,
      onBodyDataNext: () => undefined,
      onLifestyleNext: () => undefined,
      onAdvancedMetricsNext: () => undefined,
      onAdvancedMetricsSkip: () => undefined,
      onBack: () => undefined,
      onStart: () => undefined,
      onRetry: () => undefined,
      onFieldEdit: () => undefined,
    }));

    assert.match(html, /你的主要/);
    assert.match(html, /目標是什麼/);
    assert.match(html, /請選擇有效的目標/);
    assert.match(html, /第 01 步 \/ 共 06 步/);
    assert.match(html, /sp-screen/);
    assert.match(html, /sp-header/);
    assert.match(html, /aria-label="返回"/);
    assert.match(html, /sp-ob-brand/);
    assert.doesNotMatch(html, /sk-/);
    assert.match(html, /減脂/);
    assert.match(html, /增肌/);
    assert.match(html, /維持/);
    assert.doesNotMatch(html, /ChatInput/);
    assert.doesNotMatch(html, /ChatEntryBar/);
    assert.doesNotMatch(html, /連線失敗/);
    assert.doesNotMatch(html, /重試/);
  });

  it("renders the editable recovery surface instead of Step 6 retry copy for validation issues", () => {
    const html = renderToStaticMarkup(createElement(OnboardingStepperPresentation, {
      step: 3,
      data: {
        goal: "fat_loss",
        sex: "female",
        age: 9,
        heightCm: 165,
        weightKg: 58,
      },
      validationIssues: [
        {
          field: "age",
          code: "AGE_OUT_OF_RANGE",
          step: 3,
          message: "年齡需介於 10-120",
        },
      ],
      loading: false,
      transportError: null,
      result: null,
      onGoalSelect: () => undefined,
      onGoalClarificationNext: () => undefined,
      onBodyDataNext: () => undefined,
      onLifestyleNext: () => undefined,
      onAdvancedMetricsNext: () => undefined,
      onAdvancedMetricsSkip: () => undefined,
      onBack: () => undefined,
      onStart: () => undefined,
      onRetry: () => undefined,
      onFieldEdit: () => undefined,
    }));

    assert.match(html, /身體資料/);
    assert.match(html, /第 03 步 \/ 共 06 步/);
    assert.match(html, /aria-valuenow="9"/);
    assert.match(html, />12</);
    assert.match(html, />165</);
    assert.match(html, />58</);
    assert.match(html, /sp-num-wheel/);
    assert.doesNotMatch(html, /連線失敗/);
    assert.doesNotMatch(html, /重試/);
  });

  it("renders transport retry copy only in StepCoachHandoff transport mode", () => {
    const html = renderToStaticMarkup(createElement(StepCoachHandoff, {
      loading: false,
      transportError: "無法連線，請稍後再試。",
      result: null,
      onStart: () => undefined,
      onRetry: () => undefined,
    }));

    assert.match(html, /連線失敗/);
    assert.match(html, /重試/);
    assert.match(html, /第 06 步 \/ 共 06 步/);
    assert.match(html, /sp-onboarding/);
    assert.doesNotMatch(html, /sk-/);
  });
});
