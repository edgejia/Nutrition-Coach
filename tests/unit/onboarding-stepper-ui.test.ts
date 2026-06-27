import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { IntakeData } from "../../client/src/types.js";

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
const { OnboardingStepperPresentation, SpStepGoalClarification, getPreviousOnboardingBrowserBackStep } = onboardingStepperModule;
const { StepCoachHandoff } = await import("../../client/src/components/onboarding/StepCoachHandoff.js");
const onboardingStepperSource = await readFile(
  fileURLToPath(new URL("../../client/src/components/onboarding/OnboardingStepper.tsx", import.meta.url)),
  "utf8",
);
const onboardingSource = await readFile(
  fileURLToPath(new URL("../../client/src/components/Onboarding.tsx", import.meta.url)),
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

function renderStepThree(data: Partial<IntakeData>) {
  return renderToStaticMarkup(createElement(OnboardingStepperPresentation, {
    step: 3,
    data: {
      goal: "fat_loss",
      sex: "female",
      age: 31,
      heightCm: 165,
      weightKg: 58,
      ...data,
    },
    validationIssues: [],
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
}

function wheelButtonValues(html: string, ariaLabel: string) {
  const track = html.match(new RegExp(`<div class="sp-num-wheel-track"[^>]*aria-label="${ariaLabel}"[\\s\\S]*?</div>`))?.[0] ?? "";
  assert.ok(track, `expected ${ariaLabel} wheel track`);
  const buttonMatches = track.match(/<button\b[^>]*class="[^"]*\bsp-num-wheel-item\b[^"]*"[^>]*>[\s\S]*?<\/button>/g) ?? [];
  return buttonMatches.map((button) => {
    const value = button.match(/>(-?\d+)</)?.[1];
    assert.ok(value, `expected numeric wheel button value in ${button}`);
    return Number(value);
  });
}

function assertUnique(values: readonly number[]) {
  assert.deepEqual([...new Set(values)], values);
}

describe("onboarding stepper UI", () => {
  it("wraps onboarding in a pre-shell pull refresh surface that reloads only from Onboarding", () => {
    assert.match(onboardingSource, /import \{ PullToRefreshSurface \} from "\.\/PullToRefreshSurface\.js";/);
    assert.match(onboardingSource, /import \{ recordOnboardingDebugEvent \} from "\.\.\/api\.js";/);
    assert.match(onboardingSource, /function refreshOnboardingShell\(\)/);
    assert.match(onboardingSource, /document\.documentElement\.dataset\.onboardingRefreshFired = "true"/);
    assert.match(onboardingSource, /nutrition-coach:onboarding-refresh-fired/);
    assert.match(onboardingSource, /nutrition-coach:onboarding-back-diagnostic/);
    assert.match(onboardingSource, /recordOnboardingDebugEvent\(\{\s*event: "onboarding_back_diagnostic"/);
    assert.match(onboardingSource, /recordOnboardingDebugEvent\(\{ event: "onboarding_refresh_fired" \}\)/);
    assert.match(onboardingSource, /window\.location\.reload\(\)/);
    assert.match(onboardingSource, /<PullToRefreshSurface[\s\S]*onRefresh=\{refreshOnboardingShell\}[\s\S]*surfaceId="onboarding"[\s\S]*ariaLabel="下拉重新整理初始設定"[\s\S]*<OnboardingStepper \/>[\s\S]*<\/PullToRefreshSurface>/);
    assert.doesNotMatch(onboardingSource, /useBrowserBackSentinel|goBack/);
  });

  it("uses Android Back to move to the previous onboarding step after step one", () => {
    assert.equal(getPreviousOnboardingBrowserBackStep(6), 5);
    assert.equal(getPreviousOnboardingBrowserBackStep(5), 4);
    assert.equal(getPreviousOnboardingBrowserBackStep(4), 3);
    assert.equal(getPreviousOnboardingBrowserBackStep(3), 2);
    assert.equal(getPreviousOnboardingBrowserBackStep(2), 1);
    assert.equal(getPreviousOnboardingBrowserBackStep(1), null);
    assert.doesNotMatch(onboardingStepperSource, /useBrowserBackSentinel/);
    assert.match(onboardingStepperSource, /export function getPreviousOnboardingBrowserBackStep\(currentStep: StepState\): OnboardingStep \| null \{/);
    assert.match(onboardingStepperSource, /const ONBOARDING_HISTORY_STATE_KEY = "nutritionCoachOnboardingStep";/);
    assert.match(onboardingStepperSource, /function getOnboardingHistoryStep\(state: unknown\): StepState \| null \{/);
    assert.match(onboardingStepperSource, /function writeOnboardingHistoryStep\(step: StepState, mode: "push" \| "replace"\)/);
    assert.match(onboardingStepperSource, /window\.history\.pushState\(state, "", window\.location\.href\)/);
    assert.match(onboardingStepperSource, /window\.history\.replaceState\(state, "", window\.location\.href\)/);
    assert.match(onboardingStepperSource, /const handleBack = useCallback\(\(nextStep: OnboardingStep\) => \{/);
    assert.match(onboardingStepperSource, /const stepRef = useRef<StepState>\(1\)/);
    assert.match(onboardingStepperSource, /const setOnboardingStep = useCallback\(\(\s*nextStep: StepState,\s*historyMode: "auto" \| "push" \| "replace" \| "none" = "auto",\s*\) => \{/);
    assert.match(onboardingStepperSource, /stepRef\.current = nextStep;[\s\S]*setStepState\(nextStep\)/);
    assert.match(onboardingStepperSource, /writeOnboardingHistoryStep\(stepRef\.current, "replace"\)/);
    assert.match(onboardingStepperSource, /window\.addEventListener\("popstate", handleStepPopState\)/);
    assert.match(onboardingStepperSource, /const historyStep = getOnboardingHistoryStep\(event\.state\)/);
    assert.match(onboardingStepperSource, /setOnboardingStep\(historyStep, "none"\)/);
    assert.match(onboardingStepperSource, /window\.history\.back\(\)/);
    assert.match(onboardingStepperSource, /nutrition-coach:onboarding-back-diagnostic/);
    assert.doesNotMatch(onboardingStepperSource, /goBack = useStore|state\.goBack/);
  });

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

  it("renders goal-aware Step 2 quick notes and placeholders", () => {
    const fatLossHtml = renderToStaticMarkup(createElement(SpStepGoalClarification, {
      goal: "fat_loss",
      value: "",
      selectedNotes: [],
      onChange: () => undefined,
      onQuickNoteClick: () => undefined,
      onNext: () => undefined,
      onBack: () => undefined,
    }));
    const muscleGainHtml = renderToStaticMarkup(createElement(SpStepGoalClarification, {
      goal: "muscle_gain",
      value: "",
      selectedNotes: [],
      onChange: () => undefined,
      onQuickNoteClick: () => undefined,
      onNext: () => undefined,
      onBack: () => undefined,
    }));

    assert.match(fatLossHtml, /你選了「減脂」/);
    assert.match(fatLossHtml, /想慢慢減，不要太激進/);
    assert.match(fatLossHtml, /想慢慢減不要太激進/);

    assert.match(muscleGainHtml, /你選了「增肌」/);
    assert.match(muscleGainHtml, /想增加肌肉量/);
    assert.match(muscleGainHtml, /怕吃太多變胖/);
    assert.match(muscleGainHtml, /訓練日需要多一點碳水/);
    assert.doesNotMatch(muscleGainHtml, /想慢慢減/);
    assert.doesNotMatch(muscleGainHtml, /不要太激進/);
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
    assert.match(html, /aria-valuenow="10"/);
    assert.match(html, />10</);
    assert.match(html, />165</);
    assert.match(html, />58</);
    assert.match(html, /sp-num-wheel/);
    assert.doesNotMatch(html, /連線失敗/);
    assert.doesNotMatch(html, /重試/);
  });

  it("renders tappable duplicate-free Sport UI number wheel values", () => {
    const lowerHtml = renderStepThree({ age: 10 });
    const upperHtml = renderStepThree({ age: 120 });

    const lowerAgeValues = wheelButtonValues(lowerHtml, "年齡");
    const upperAgeValues = wheelButtonValues(upperHtml, "年齡");

    assert.deepEqual(lowerAgeValues, [10, 11, 12, 13, 14]);
    assert.deepEqual(upperAgeValues, [116, 117, 118, 119, 120]);
    assertUnique(lowerAgeValues);
    assertUnique(upperAgeValues);
    assert.equal(lowerAgeValues.filter((value) => value === 10).length, 1);
    assert.equal(upperAgeValues.filter((value) => value === 120).length, 1);

    assert.match(lowerHtml, /<button type="button" class="sp-num-wheel-item active" aria-current="true">10<\/button>/);
    assert.match(lowerHtml, /<button type="button" class="sp-num-wheel-item near">11<\/button>/);
    assert.doesNotMatch(lowerHtml, /<span[^>]*class="sp-num-wheel-item/);

    const defaultHtml = renderStepThree({ age: 31, heightCm: 165, weightKg: 58 });
    assert.deepEqual(wheelButtonValues(defaultHtml, "年齡"), [29, 30, 31, 32, 33]);
    assert.deepEqual(wheelButtonValues(defaultHtml, "身高"), [163, 164, 165, 166, 167]);
    assert.deepEqual(wheelButtonValues(defaultHtml, "體重"), [56, 57, 58, 59, 60]);
  });

  it("keeps shared wheel source contracts for tap, compact/minimal variants, and TDEE steps", () => {
    assert.match(onboardingStepperSource, /function buildVisibleWheelValues/);
    assert.match(onboardingStepperSource, /function clampNumericValue/);
    assert.match(onboardingStepperSource, /function WheelValueItem/);
    assert.match(onboardingStepperSource, /ONBOARDING_NUMERIC_BOUNDS/);
    assert.match(onboardingStepperSource, /age: \{ min: 10, max: 120 \}/);
    assert.match(onboardingStepperSource, /heightCm: \{ min: 50, max: 300 \}/);
    assert.match(onboardingStepperSource, /weightKg: \{ min: 20, max: 500 \}/);
    assert.match(onboardingStepperSource, /bodyFatPercent: \{ min: 2, max: 70 \}/);
    assert.match(onboardingStepperSource, /tdee: \{ min: 500, max: 8000, step: 50 \}/);
    assert.match(onboardingStepperSource, /type="button"/);
    assert.match(onboardingStepperSource, /aria-current=\{active \? "true" : undefined\}/);
    assert.match(onboardingStepperSource, /currentValue=\{current\}/);
    assert.match(onboardingStepperSource, /aria-valuenow=\{activeValue\}/);
    assert.match(onboardingStepperSource, /if \(item\.value === currentValue\) return;/);
    assert.match(onboardingStepperSource, /activeDragCleanupRef\.current\?\.\(\)/);
    assert.match(onboardingStepperSource, /window\.addEventListener\("pointermove", move\)/);
    assert.match(onboardingStepperSource, /window\.addEventListener\("pointerup", stop, \{ once: true \}\)/);
    assert.match(onboardingStepperSource, /window\.addEventListener\("pointercancel", stop, \{ once: true \}\)/);
    assert.match(onboardingStepperSource, /window\.addEventListener\("blur", stop, \{ once: true \}\)/);
    assert.match(onboardingStepperSource, /window\.removeEventListener\("pointermove", move\)/);
    assert.match(onboardingStepperSource, /window\.removeEventListener\("pointerup", stop\)/);
    assert.match(onboardingStepperSource, /window\.removeEventListener\("pointercancel", stop\)/);
    assert.match(onboardingStepperSource, /window\.removeEventListener\("blur", stop\)/);
    assert.match(onboardingStepperSource, /age: clampNumericValue\(bodyData\.age, ONBOARDING_NUMERIC_BOUNDS\.age\.min, ONBOARDING_NUMERIC_BOUNDS\.age\.max, 28\)/);
    assert.match(onboardingStepperSource, /heightCm: clampNumericValue\(\s*bodyData\.heightCm,\s*ONBOARDING_NUMERIC_BOUNDS\.heightCm\.min,\s*ONBOARDING_NUMERIC_BOUNDS\.heightCm\.max,\s*175,\s*\)/);
    assert.match(onboardingStepperSource, /weightKg: clampNumericValue\(\s*bodyData\.weightKg,\s*ONBOARDING_NUMERIC_BOUNDS\.weightKg\.min,\s*ONBOARDING_NUMERIC_BOUNDS\.weightKg\.max,\s*70,\s*\)/);
    assert.match(onboardingStepperSource, /bodyFatPercent: advanced\.bodyFatPercent === ""\s*\?\s*undefined\s*:\s*clampNumericValue\(\s*advanced\.bodyFatPercent,\s*ONBOARDING_NUMERIC_BOUNDS\.bodyFatPercent\.min,\s*ONBOARDING_NUMERIC_BOUNDS\.bodyFatPercent\.max,\s*20,\s*\)/);
    assert.match(onboardingStepperSource, /tdee: advanced\.tdee === ""\s*\?\s*undefined\s*:\s*clampNumericValue\(\s*advanced\.tdee,\s*ONBOARDING_NUMERIC_BOUNDS\.tdee\.min,\s*ONBOARDING_NUMERIC_BOUNDS\.tdee\.max,\s*2200,\s*\)/);
    assert.doesNotMatch(onboardingStepperSource, /onPointerDown=\{\(event\) => event\.stopPropagation\(\)\}/);
    assert.match(onboardingStepperSource, /visibleCount = minimal \? 3 : 5/);
    assert.match(onboardingStepperSource, /label="體脂率"[\s\S]*compact=\{true\}/);
    assert.match(onboardingStepperSource, /label="每日消耗"[\s\S]*step=\{ONBOARDING_NUMERIC_BOUNDS\.tdee\.step\}[\s\S]*compact=\{true\}[\s\S]*minimal=\{true\}/);
    assert.doesNotMatch(onboardingStepperSource, /label\s*===\s*["']年齡["']/);
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
