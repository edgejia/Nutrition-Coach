import { beforeEach, describe, it } from "node:test";
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

const { COACH_CTA_INTENTS } = await import("../../client/src/coach-advice.js");
const { CoachAdviceCard, CoachCTAControls } = await import("../../client/src/components/CoachAdviceCard.js");
const { useStore } = await import("../../client/src/store.js");
const fakeDialoguePattern = new RegExp(
  [
    `問我${"怎麼"}`,
    `問我${"現在"}`,
    `問我${"早餐"}`,
    `問我${"午餐"}`,
    `問我${"晚餐"}`,
    `問我${"宵夜"}`,
  ].join("|"),
);

describe("CoachCTAControls", () => {
  it("renders first-layer intent labels without options before selection", () => {
    const html = renderToStaticMarkup(
      createElement(CoachCTAControls, {
        intents: COACH_CTA_INTENTS,
        selectedIntentId: null,
        onIntentSelect: () => undefined,
        onTaskOptionClick: () => undefined,
      }),
    );

    assert.match(html, /補蛋白質/);
    assert.match(html, /安排下一餐/);
    assert.match(html, /控制熱量/);
    assert.match(html, /記錄飲食/);
    assert.doesNotMatch(html, /推薦三個便利商店高蛋白選擇/);
    assert.doesNotMatch(html, /先選一個需求/);
  });

  it("marks selected intent and associates it with its option group", () => {
    const html = renderToStaticMarkup(
      createElement(CoachCTAControls, {
        intents: COACH_CTA_INTENTS,
        selectedIntentId: "protein",
        onIntentSelect: () => undefined,
        onTaskOptionClick: () => undefined,
      }),
    );

    assert.match(html, /aria-pressed="true"/);
    assert.match(html, /aria-expanded="true"/);
    assert.match(html, /aria-controls="coach-cta-options-protein"/);
    assert.match(html, /id="coach-cta-options-protein"/);
    assert.match(html, /推薦三個便利商店高蛋白選擇/);
    assert.match(html, /用我今天剩餘熱量安排高蛋白晚餐/);
    assert.match(html, /幫我估算今天還差多少蛋白質/);
  });

  it("disables intent and option buttons while sending", () => {
    const html = renderToStaticMarkup(
      createElement(CoachCTAControls, {
        intents: COACH_CTA_INTENTS,
        selectedIntentId: "protein",
        onIntentSelect: () => undefined,
        onTaskOptionClick: () => undefined,
        disabled: true,
      }),
    );

    assert.match(html, /disabled=""/);
    assert.match(html, /disabled:opacity-40/);
  });

  it("does not render CTA controls in loading coach card state", () => {
    storage.clear();
    useStore.setState({
      dailySummary: null,
      dailyTargets: { calories: 1800, protein: 140, carbs: 180, fat: 60 },
      sending: false,
    });

    const html = renderToStaticMarkup(createElement(CoachAdviceCard, { advice: null, cta: COACH_CTA_INTENTS }));

    assert.doesNotMatch(html, /補蛋白質/);
    assert.doesNotMatch(html, /推薦三個便利商店高蛋白選擇/);
  });

  it("does not render fake-dialogue copy", () => {
    const html = renderToStaticMarkup(
      createElement(CoachCTAControls, {
        intents: COACH_CTA_INTENTS,
        selectedIntentId: "protein",
        onIntentSelect: () => undefined,
        onTaskOptionClick: () => undefined,
      }),
    );

    assert.doesNotMatch(html, fakeDialoguePattern);
  });
});
