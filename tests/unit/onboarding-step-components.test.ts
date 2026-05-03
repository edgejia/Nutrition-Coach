import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const { StepGoal } = await import("../../client/src/components/onboarding/StepGoal.js");
const { StepGoalClarification } = await import("../../client/src/components/onboarding/StepGoalClarification.js");
const { StepBodyData } = await import("../../client/src/components/onboarding/StepBodyData.js");
const { StepLifestyle } = await import("../../client/src/components/onboarding/StepLifestyle.js");
const { StepAdvancedMetrics } = await import("../../client/src/components/onboarding/StepAdvancedMetrics.js");

describe("onboarding step components", () => {
  it("renders StepGoal error copy", () => {
    const html = renderToStaticMarkup(createElement(StepGoal, {
      onSelect: () => undefined,
      error: "請選擇減脂或增肌目標",
    }));

    assert.match(html, /role="alert"/);
    assert.match(html, /需要重新選擇/);
    assert.match(html, /請選擇減脂或增肌目標/);
    assert.match(html, /減脂 · FAT LOSS/);
    assert.match(html, /增肌 · MUSCLE GAIN/);
    assert.match(html, /sp-onboarding/);
    assert.doesNotMatch(html, /sk-/);
  });

  it("renders StepGoalClarification with hydrated value and error on repeated renders", () => {
    const props = {
      goal: "fat_loss" as const,
      initialValue: "想慢慢減脂",
      error: "目標補充最多 300 字",
      onNext: () => undefined,
      onBack: () => undefined,
    };

    const firstRender = renderToStaticMarkup(createElement(StepGoalClarification, props));
    const secondRender = renderToStaticMarkup(createElement(StepGoalClarification, props));

    assert.match(firstRender, />想慢慢減脂</);
    assert.match(firstRender, /減脂不掉肌肉|不想影響重訓表現/);
    assert.match(firstRender, /目標補充最多 300 字/);
    assert.match(secondRender, />想慢慢減脂</);
    assert.doesNotMatch(firstRender, /sk-/);
  });

  it("renders StepBodyData hydration and field-level errors", () => {
    const html = renderToStaticMarkup(createElement(StepBodyData, {
      initialData: {
        sex: "female",
        age: 31,
        heightCm: 165,
        weightKg: 58,
      },
      errors: {
        age: "年齡需介於 10-120",
      },
      onNext: () => undefined,
      onBack: () => undefined,
    }));

    assert.match(html, /value="31"/);
    assert.match(html, /sp-onboarding/);
    assert.doesNotMatch(html, /sk-/);
    assert.match(html, /value="165"/);
    assert.match(html, /value="58"/);
    assert.match(html, /年齡需介於 10-120/);
    assert.match(html, /aria-pressed="true"/);
  });

  it("renders StepLifestyle hydration and field-level errors", () => {
    const html = renderToStaticMarkup(createElement(StepLifestyle, {
      initialData: {
        activityLevel: "moderate",
        trainingFrequency: "3_4",
        allergies: "乳糖不耐",
      },
      errors: {
        activityLevel: "請選擇有效的活動量",
        allergies: "過敏資訊最多 300 字",
      },
      onNext: () => undefined,
      onBack: () => undefined,
    }));

    assert.match(html, /value="乳糖不耐"/);
    assert.match(html, /sp-onboarding/);
    assert.doesNotMatch(html, /sk-/);
    assert.match(html, /請選擇有效的活動量/);
    assert.match(html, /過敏資訊最多 300 字/);
    assert.equal(html.match(/aria-pressed="true"/g)?.length, 2);
  });

  it("renders StepAdvancedMetrics hydration and field-level errors", () => {
    const html = renderToStaticMarkup(createElement(StepAdvancedMetrics, {
      initialData: {
        bodyFatPercent: 18,
        tdee: 2400,
        advancedNotes: "晚餐常外食",
      },
      errors: {
        tdee: "TDEE 需介於 500-8000",
      },
      onNext: () => undefined,
      onSkip: () => undefined,
      onBack: () => undefined,
    }));

    assert.match(html, /value="18"/);
    assert.match(html, /value="2400"/);
    assert.match(html, /value="晚餐常外食"/);
    assert.match(html, /TDEE 需介於 500-8000/);
    assert.match(html, /sp-onboarding/);
    assert.doesNotMatch(html, /sk-/);
  });

  it("keeps production onboarding free of demo-only globals and maintain goal", async () => {
    const sourcePaths = [
      "client/src/components/onboarding/OnboardingStepper.tsx",
      "client/src/components/onboarding/StepGoal.tsx",
      "client/src/components/onboarding/StepGoalClarification.tsx",
      "client/src/components/onboarding/StepBodyData.tsx",
      "client/src/components/onboarding/StepLifestyle.tsx",
      "client/src/components/onboarding/StepAdvancedMetrics.tsx",
      "client/src/components/onboarding/StepCoachHandoff.tsx",
    ];
    const sources = await Promise.all(sourcePaths.map((path) => readFile(path, "utf8")));
    const combinedSource = sources.join("\n");

    assert.match(combinedSource, /fat_loss/);
    assert.match(combinedSource, /muscle_gain/);
    assert.doesNotMatch(combinedSource, /maintain/);
    assert.doesNotMatch(combinedSource, /window\.Sp/);
    assert.doesNotMatch(combinedSource, /setTimeout/);
    assert.doesNotMatch(combinedSource, /Sketch(?:Screen|Box|Button|Pill|SoftBox)/);
  });
});
