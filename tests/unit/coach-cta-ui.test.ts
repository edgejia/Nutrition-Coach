import { beforeEach, describe, it } from "node:test";
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

const { COACH_CTA_INTENTS } = await import("../../client/src/coach-advice.js");
const { CoachAdviceCard, CoachCTAControls, recordAndSelectHomeCtaIntent } = await import(
  "../../client/src/components/CoachAdviceCard.js"
);
const { useStore } = await import("../../client/src/store.js");
function sourcePath(relativePath: string) {
  return fileURLToPath(new URL(relativePath, import.meta.url));
}

async function readSource(relativePath: string) {
  return readFile(sourcePath(relativePath), "utf8");
}

function cssBlock(source: string, selector: string) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`${escapedSelector}\\s*\\{([^}]+)\\}`).exec(source);
  assert.ok(match, `${selector} should be defined`);
  return match[1] ?? "";
}

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

  it("disables intent and option buttons while sending", async () => {
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
    assert.match(await readSource("../../client/src/app.css"), /\.sp-coach-cta-option:disabled[\s\S]*opacity:\s*0\.4/);
  });

  it("renders the Phase 39 sport CTA markup while preserving the two-step flow", async () => {
    const componentSource = await readSource("../../client/src/components/CoachAdviceCard.tsx");
    const loadingCardHtml = renderToStaticMarkup(createElement(CoachAdviceCard, { advice: null, cta: COACH_CTA_INTENTS }));
    const controlsHtml = renderToStaticMarkup(
      createElement(CoachCTAControls, {
        intents: COACH_CTA_INTENTS,
        selectedIntentId: "protein",
        onIntentSelect: () => undefined,
        onTaskOptionClick: () => undefined,
      }),
    );

    assert.match(componentSource, /教練建議 · 即時/);
    assert.match(loadingCardHtml, /sp-coach-cta/);
    assert.match(controlsHtml, /補蛋白質/);
    assert.match(controlsHtml, /sp-coach-cta-intent/);
    assert.match(controlsHtml, /sp-coach-cta-option/);
    assert.match(controlsHtml, /data-selected="true"/);
    assert.match(controlsHtml, /推薦三個便利商店高蛋白選擇/);
  });

  it("keeps the sport CTA source contracts and blocked Home logging boundaries", async () => {
    const componentSource = await readSource("../../client/src/components/CoachAdviceCard.tsx");
    const cssSource = await readSource("../../client/src/app.css");

    assert.match(componentSource, /SportBoltIcon/);
    assert.match(componentSource, /sp-coach-cta/);
    assert.match(componentSource, /sp-coach-cta-intent/);
    assert.match(componentSource, /sp-coach-cta-option/);
    assert.match(componentSource, /recordAndSelectHomeCtaIntent/);
    assert.doesNotMatch(componentSource, /SketchButton/);
    assert.doesNotMatch(componentSource, /SketchPill/);
    assert.doesNotMatch(componentSource, /openSecondaryScreen\("mealEdit"/);
    assert.doesNotMatch(componentSource, /ChatEntryBar/);
    assert.match(cssSource, /\.sp-coach-cta\s*\{[\s\S]*display:\s*flex;[\s\S]*flex:\s*0 0 auto;[\s\S]*flex-direction:\s*column/);
    assert.match(cssSource, /\.sp-coach-cta\s*\{[\s\S]*background:\s*var\(--sp-surface\)/);
    assert.match(cssSource, /\.sp-coach-cta\s*\{[\s\S]*border:\s*1px solid var\(--sp-lime-line\)/);
    assert.match(cssSource, /\.sp-coach-cta-label\s*\{[\s\S]*color:\s*var\(--sp-lime\)/);
    assert.doesNotMatch(cssSource, /\.sp-coach-cta\s*\{[^}]*background:\s*var\(--sp-lime\)/);
    assert.match(cssSource, /\.sp-coach-cta-option:disabled[\s\S]*opacity:\s*0\.4/);

    for (const selector of [
      ".sp-coach-cta",
      ".sp-coach-cta-label",
      ".sp-coach-cta-headline",
      ".sp-coach-cta-body",
      ".sp-coach-cta-tags",
      ".sp-coach-cta-tag",
      ".sp-coach-cta-controls",
      ".sp-coach-cta-intents",
      ".sp-coach-cta-intent",
      '.sp-coach-cta-intent[data-selected="true"]',
      ".sp-coach-cta-options",
      ".sp-coach-cta-option",
      ".sp-coach-cta-option:disabled",
    ]) {
      assert.match(cssSource, new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
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

  it("renders visible loading copy while waiting for daily summary", () => {
    storage.clear();
    useStore.setState({
      dailySummary: null,
      dailyTargets: { calories: 1800, protein: 140, carbs: 180, fat: 60 },
      sending: false,
    });

    const html = renderToStaticMarkup(createElement(CoachAdviceCard, { advice: null, cta: COACH_CTA_INTENTS }));

    assert.match(html, /aria-busy="true"/);
    assert.match(html, /教練建議 · 載入中/);
    assert.match(html, /正在整理今天的營養進度/);
    assert.match(html, /sp-coach-cta-loading-copy/);
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

  it("records intent selection without blocking selected intent state", () => {
    const selected: string[] = [];
    const previousFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      throw new Error("observability unavailable");
    };

    try {
      recordAndSelectHomeCtaIntent("protein", (intentId) => selected.push(intentId));
    } finally {
      globalThis.fetch = previousFetch;
    }

    assert.deepEqual(selected, ["protein"]);
  });

  it("MOB-02 preserves Coach CTA two-step flow with 44px options and 8px option gaps", async () => {
    const componentSource = await readSource("../../client/src/components/CoachAdviceCard.tsx");
    const cssSource = await readSource("../../client/src/app.css");
    const controlsBlock = cssBlock(cssSource, ".sp-coach-cta-controls");
    const optionsBlock = cssBlock(cssSource, ".sp-coach-cta-options");
    const optionBlock = cssBlock(cssSource, ".sp-coach-cta-option");

    assert.match(componentSource, /selectedIntentId/);
    assert.match(componentSource, /aria-expanded=\{selected\}/);
    assert.match(componentSource, /id=\{`coach-cta-options-\$\{selectedIntent\.id\}`\}/);
    assert.match(componentSource, /onTaskOptionClick\(option, selectedIntent\)/);
    assert.match(controlsBlock, /gap:\s*8px/);
    assert.match(optionsBlock, /gap:\s*8px/);
    assert.match(optionBlock, /min-height:\s*44px/, "MOB-02 Home CTA options must preserve 44px tap targets");
    assert.doesNotMatch(componentSource, /mobile action strip|collapsed mobile options|bottom action strip/i);
  });
});
