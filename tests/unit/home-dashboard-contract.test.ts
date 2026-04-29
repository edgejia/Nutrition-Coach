import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const storage = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
    clear: () => storage.clear(),
  },
});

const { formatMealRowTime, getDisplayMealLabel, getHomeCalorieDisplay, getHomeEmptyCoachCopy } = await import(
  "../../client/src/components/HomeScreen.js"
);

function sourcePath(relativePath: string) {
  return fileURLToPath(new URL(relativePath, import.meta.url));
}

async function readSource(relativePath: string) {
  return readFile(sourcePath(relativePath), "utf8");
}

describe("Home dashboard display contracts", () => {
  it("derives display-only meal labels from loggedAt", () => {
    assert.equal(getDisplayMealLabel("2026-04-29T07:30:00+08:00"), "早餐");
    assert.equal(getDisplayMealLabel("2026-04-29T12:30:00+08:00"), "午餐");
    assert.equal(getDisplayMealLabel("2026-04-29T15:00:00+08:00"), "點心");
    assert.equal(getDisplayMealLabel("2026-04-29T19:00:00+08:00"), "晚餐");
    assert.equal(getDisplayMealLabel("not-a-date"), "餐點");
    assert.equal(getDisplayMealLabel(), "餐點");
  });

  it("formats meal row time and calorie hero values", () => {
    assert.equal(formatMealRowTime("2026-04-29T07:30:00+08:00"), "07:30");
    assert.deepEqual(getHomeCalorieDisplay({ totalCalories: 1240 }, { calories: 2000 }), {
      consumed: 1240,
      remaining: 760,
      ringValue: 0.62,
    });
  });

  it("provides empty coach handoff copy", () => {
    const copy = getHomeEmptyCoachCopy();

    assert.match(copy.headline, /先用對話記下第一餐/);
    assert(copy.actions.some((action) => action.label.includes("記錄早餐")));
    assert(copy.actions.some((action) => action.label.includes("估算剛吃的")));
    assert(copy.actions.some((action) => action.label.includes("問晚餐建議")));
  });

  it("Home keeps logging anchored in Chat", async () => {
    const source = await readSource("../../client/src/components/HomeScreen.tsx");

    assert.doesNotMatch(source, /ChatEntryBar/);
    assert.doesNotMatch(source, /screen-scroll-with-input/);
    assert.doesNotMatch(source, />聊天</);
    assert.doesNotMatch(source, /openSecondaryScreen\("mealEdit"/);
    assert.doesNotMatch(source, /openSecondaryScreen\("dayDetail"/);

    assert.match(source, /setPendingHomeChatDraft/);
    assert.match(source, /setActiveScreen\("chat"\)/);
    assert.match(source, /recordHomeCtaOptionSent/);
    assert.match(source, /getHomeEmptyCoachCopy/);
    assert.match(source, /getDisplayMealLabel/);
  });

  it("Home source keeps the Phase 32 dashboard surface", async () => {
    const homeSource = await readSource("../../client/src/components/HomeScreen.tsx");
    const coachSource = await readSource("../../client/src/components/CoachAdviceCard.tsx");

    assert.match(homeSource, /SketchRing/);
    assert.match(homeSource, /SketchProgressBar/);
    assert.match(homeSource, /今日餐點/);
    assert.match(coachSource, /var\(--sk-accent-soft\)/);
    assert.match(homeSource, /今天還沒有紀錄。到「對話」描述你吃了什麼。/);
    assert.match(homeSource, /setPendingHomeChatDraft/);
    assert.match(homeSource, /setActiveScreen\("chat"\)/);
  });
});
