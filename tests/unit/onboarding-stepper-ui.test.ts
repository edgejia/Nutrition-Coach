import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
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

const onboardingStepperModule = await import("../../client/src/components/onboarding/OnboardingStepper.js");
const { OnboardingStepperPresentation, SpStepGoalClarification } = onboardingStepperModule;
const { StepCoachHandoff } = await import("../../client/src/components/onboarding/StepCoachHandoff.js");
const onboardingStepperSource = await readFile(
  fileURLToPath(new URL("../../client/src/components/onboarding/OnboardingStepper.tsx", import.meta.url)),
  "utf8",
);

function renderStepSix(props: {
  loading?: boolean;
  transportError?: string | null;
  result?: {
    deviceId: string;
    dailyTargets: { calories: number; protein: number; carbs: number; fat: number };
    coachExplanation: string | null;
    usedFallback: boolean;
  } | null;
}) {
  return renderToStaticMarkup(createElement(OnboardingStepperPresentation, {
    step: 6,
    data: {
      goal: "fat_loss",
      sex: "female",
      age: 31,
      heightCm: 165,
      weightKg: 58,
      activityLevel: "moderate",
      trainingFrequency: "3_4",
    },
    validationIssues: [],
    loading: props.loading ?? false,
    transportError: props.transportError ?? null,
    result: props.result ?? null,
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
}

describe("onboarding stepper UI", () => {
  it("renders Step 2 quick-note selected state from selectedNotes without changing visible text", () => {
    assert.equal(typeof SpStepGoalClarification, "function");

    const html = renderToStaticMarkup(createElement(SpStepGoalClarification, {
      goal: "fat_loss",
      value: "不想影響重訓表現",
      selectedNotes: ["不想影響重訓表現"],
      onChange: () => undefined,
      onQuickNoteClick: () => undefined,
      onNext: () => undefined,
      onBack: () => undefined,
    }));

    assert.match(html, /aria-pressed="true"/);
    assert.match(html, /aria-label="不想影響重訓表現，已套用"/);
    assert.match(html, />不想影響重訓表現</);
    const selectedButton = html.match(/<button[^>]+aria-pressed="true"[^>]*>[\s\S]*?不想影響重訓表現[\s\S]*?<\/button>/)?.[0] ?? "";
    const unselectedButtons = html.match(/<button[^>]+aria-pressed="false"[^>]*>[\s\S]*?<\/button>/g) ?? [];

    assert.match(selectedButton, /sp-chip-applied/);
    assert.doesNotMatch(selectedButton, /sp-chip-on/);
    assert.doesNotMatch(selectedButton, /disabled/);
    assert.equal(unselectedButtons.length, 2);
    for (const button of unselectedButtons) {
      assert.doesNotMatch(button, /sp-chip-applied/);
      assert.doesNotMatch(button, /sp-chip-on/);
    }
  });

  it("wires Step 2 quick-note taps through the selectedNotes draft helper", () => {
    for (const contract of [
      "applyGoalClarificationQuickNote",
      "GoalClarificationQuickNoteState",
      "goalClarificationDraft",
      "selectedNotes",
      "onQuickNoteClick",
      "setGoalClarificationDraft",
    ]) {
      assert.match(onboardingStepperSource, new RegExp(contract));
    }

    assert.ok(onboardingStepperSource.includes("onGoalClarificationNext(goalClarificationDraft.goalClarification)"));
    assert.doesNotMatch(onboardingStepperSource, /selectedNotes:\s*parse/);
    assert.doesNotMatch(onboardingStepperSource, /goalClarification\.split/);
  });

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
    assert.doesNotMatch(html, /aria-label="返回"/);
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

  it("renders Step 6 loading as progress copy without target cards or success copy", () => {
    const html = renderStepSix({ loading: true, result: null });

    assert.match(html, /正在建立每日目標/);
    assert.match(html, /完成前不會顯示數字/);
    assert.doesNotMatch(html, /你的計畫已準備好/);
    assert.doesNotMatch(html, /2,150|2150|145|240|65/);
    assert.doesNotMatch(html, /每日熱量|蛋白質|碳水|脂肪/);
  });

  it("renders Step 6 transport failure without target cards or success copy", () => {
    const html = renderStepSix({
      transportError: "建立每日目標失敗，請重新送出。",
      result: null,
    });

    assert.match(html, /建立每日目標失敗，請重新送出。/);
    assert.match(html, /重新送出/);
    assert.doesNotMatch(html, /你的計畫已準備好/);
    assert.doesNotMatch(html, /2,150|2150|145|240|65/);
    assert.doesNotMatch(html, /每日熱量|蛋白質|碳水|脂肪/);
  });

  it("renders Step 6 success with server targets and server coach explanation", () => {
    const html = renderStepSix({
      result: {
        deviceId: "device-step-six-success",
        dailyTargets: { calories: 1900, protein: 132, carbs: 210, fat: 58 },
        coachExplanation: "SERVER_COACH_NOTE",
        usedFallback: false,
      },
    });

    assert.match(html, /你的計畫已準備好/);
    assert.match(html, /1,900/);
    assert.match(html, /132/);
    assert.match(html, /210/);
    assert.match(html, /58/);
    assert.match(html, /SERVER_COACH_NOTE/);
    assert.doesNotMatch(html, /根據減脂目標|TDEE −400/);
  });

  it("renders Step 6 deterministic generic coach copy only after a null-explanation result exists", () => {
    const html = renderStepSix({
      result: {
        deviceId: "device-step-six-null-note",
        dailyTargets: { calories: 1880, protein: 125, carbs: 206, fat: 57 },
        coachExplanation: null,
        usedFallback: false,
      },
    });

    assert.match(html, /已依照你的資料建立每日目標。先照這個節奏記錄，之後可依實際變化調整。/);
    assert.match(html, /1,880/);
  });

  it("renders Step 6 target fallback as conservative defaults without red failure treatment", () => {
    const html = renderStepSix({
      result: {
        deviceId: "device-step-six-fallback",
        dailyTargets: { calories: 2050, protein: 120, carbs: 230, fat: 70 },
        coachExplanation: "先使用保守預設，完成幾餐記錄後再調整。",
        usedFallback: true,
      },
    });

    assert.match(html, /這次先使用保守預設目標。你可以重新產生，或之後到設定調整。/);
    assert.match(html, /2,050/);
    assert.match(html, /120/);
    assert.match(html, /230/);
    assert.match(html, /70/);
    assert.match(html, /開始記錄飲食/);
    assert.match(html, /重新產生/);
    assert.doesNotMatch(html, /送出失敗|建立每日目標失敗|#ffb3b3/);
  });
});
