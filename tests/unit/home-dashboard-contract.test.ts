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

const {
  formatMealRowTime,
  getDisplayMealLabel,
  getHomeCalorieDisplay,
  getHomeEmptyCoachCopy,
  getHomeMacroDisplays,
  getMealBadge,
  getMealMacroSummary,
} = await import("../../client/src/components/HomeScreen.js");

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
      target: 2000,
      remaining: 760,
      ringValue: 0.62,
      percent: 62,
    });
    assert.deepEqual(getHomeCalorieDisplay({ totalCalories: 1240 }, { calories: 0 }), {
      consumed: 1240,
      target: 0,
      remaining: 0,
      ringValue: 0,
      percent: 0,
    });
  });

  it("derives sport macro blocks and meal row helper values", () => {
    assert.deepEqual(
      getHomeMacroDisplays(
        { totalProtein: 88, totalCarbs: 168, totalFat: 52 },
        { protein: 120, carbs: 280, fat: 72 },
      ),
      [
        {
          id: "protein",
          label: "蛋白",
          metric: "PROTEIN",
          current: 88,
          target: 120,
          progress: 0.7333333333333333,
          percent: 73,
          variant: "default",
        },
        {
          id: "carbs",
          label: "碳水",
          metric: "CARBS",
          current: 168,
          target: 280,
          progress: 0.6,
          percent: 60,
          variant: "cyan",
        },
        {
          id: "fat",
          label: "脂肪",
          metric: "FAT",
          current: 52,
          target: 72,
          progress: 0.7222222222222222,
          percent: 72,
          variant: "amber",
        },
      ],
    );

    for (const macro of getHomeMacroDisplays({ totalProtein: 1, totalCarbs: 2, totalFat: 3 }, null)) {
      assert.equal(Number.isNaN(macro.progress), false);
      assert.equal(macro.progress, 0);
      assert.equal(macro.percent, 0);
    }

    assert.equal(getMealMacroSummary({ protein: 18, carbs: 42, fat: 8 }), "P 18 · C 42 · F 8");
    assert.equal(getMealBadge("2026-04-29T07:30:00+08:00"), "B");
    assert.equal(getMealBadge("2026-04-29T12:30:00+08:00"), "L");
    assert.equal(getMealBadge("2026-04-29T15:00:00+08:00"), "S");
    assert.equal(getMealBadge("2026-04-29T19:00:00+08:00"), "D");
    assert.equal(getMealBadge("not-a-date"), "M");
  });

  it("provides empty coach handoff copy", () => {
    const copy = getHomeEmptyCoachCopy();

    assert.equal(copy.headline, "還沒有紀錄");
    assert.equal(copy.body, "到「對話」描述你吃了什麼，AI 會幫你整理今天第一餐。");
    assert.equal(copy.actions[0]?.label, "去對話記錄");
    assert.equal(copy.actions[0]?.prompt, "我想記錄今天第一餐，請一步步引導我。");
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

  it("Home uses the Phase 39 sport dashboard surface", async () => {
    const homeSource = await readSource("../../client/src/components/HomeScreen.tsx");
    const cssSource = await readSource("../../client/src/app.css");

    assert.match(homeSource, /SportScreen/);
    assert.match(homeSource, /SportCard/);
    assert.match(homeSource, /SportRing/);
    assert.match(homeSource, /SportProgressBar/);
    assert.match(homeSource, /SportSettingsIcon/);
    assert.match(homeSource, /今日熱量 · kcal/);
    assert.match(homeSource, /完成率/);
    assert.match(homeSource, /accentTick/);
    assert.match(homeSource, /getHomeGreeting/);
    assert.doesNotMatch(homeSource, /<h1>嗨，早安<\/h1>/);
    assert.match(homeSource, /今日紀錄/);
    assert.match(homeSource, /\{meals\.length\}筆/);
    assert.doesNotMatch(homeSource, /\{meals\.length\} entries/);
    assert.match(homeSource, /home-sport-meal-row/);
    assert.match(homeSource, /到「對話」描述你吃了什麼，AI 會幫你整理今天第一餐。/);
    assert.match(homeSource, /去對話記錄/);
    assert.match(homeSource, /setPendingHomeChatDraft/);
    assert.match(homeSource, /setActiveScreen\("chat"\)/);
    assert.match(cssSource, /@media \(max-width:\s*360px\)[\s\S]*\.home-sport-calorie-number[\s\S]*font-size:\s*52px/);
    assert.match(cssSource, /@media \(max-width:\s*360px\)[\s\S]*\.home-sport-calorie-copy[\s\S]*min-width:\s*0/);

    assert.doesNotMatch(homeSource, /SketchRing/);
    assert.doesNotMatch(homeSource, /SketchProgressBar/);
    assert.doesNotMatch(homeSource, /SketchSoftBox/);
    assert.doesNotMatch(homeSource, /SettingsIcon } from "\.\/SketchIcons\.js"/);
    assert.doesNotMatch(homeSource, /SP_SUMMARY/);
    assert.doesNotMatch(homeSource, /SP_TARGETS/);
    assert.doesNotMatch(homeSource, /SP_MEALS/);
    assert.doesNotMatch(homeSource, /window\./);
    assert.doesNotMatch(homeSource, /log next meal/);
    assert.doesNotMatch(homeSource, /ChatEntryBar/);
    assert.doesNotMatch(homeSource, /openSecondaryScreen\("mealEdit"/);
  });

  it("Home meal rows stay read-only and empty state routes through Chat", async () => {
    const homeSource = await readSource("../../client/src/components/HomeScreen.tsx");

    assert.match(homeSource, /<article key=\{meal\.id\} className="home-sport-meal-row">/);
    assert.match(homeSource, /getMealBadge\(meal\.loggedAt\)/);
    assert.match(homeSource, /formatMealRowTime\(meal\.loggedAt\)/);
    assert.match(homeSource, /getDisplayMealLabel\(meal\.loggedAt\)/);
    assert.match(homeSource, /getMealMacroSummary\(meal\)/);
    assert.match(homeSource, /Math\.max\(0, Math\.round\(meal\.calories\)\)/);
    assert.match(homeSource, /stageHomeTaskOptionPrompt\(prompt, setPendingHomeChatDraft, setActiveScreen\)/);
    assert.match(homeSource, /<button type="button" className="home-sport-empty-action" onClick=\{onEmptyChatClick\}>/);
    assert.doesNotMatch(homeSource, /<button[^>]+home-sport-meal-row/);
    assert.doesNotMatch(homeSource, /SportPlusIcon/);
  });

  it("scopes count-up animation to consumed calories and ring percent", async () => {
    const homeSource = await readSource("../../client/src/components/HomeScreen.tsx");
    const countUpHelperMatches = homeSource.match(/useCountUpNumber/g) ?? [];

    if (countUpHelperMatches.length > 0) {
      assert.equal(countUpHelperMatches.length, 3);
      assert.match(homeSource, /function useCountUpNumber|const useCountUpNumber/);
      assert.match(homeSource, /useCountUpNumber\([^)]*display\.consumed[^)]*shouldAnimateConsumedChange/);
      assert.match(homeSource, /useCountUpNumber\([^)]*display\.percent[^)]*shouldAnimateConsumedChange/);
    } else {
      assert.match(homeSource, /requestAnimationFrame/);
      assert.match(homeSource, /cancelAnimationFrame/);
      assert.match(homeSource, /matchMedia\("\(prefers-reduced-motion: reduce\)"\)/);
      assert.match(homeSource, /previousConsumedRef/);
      assert.match(homeSource, /shouldAnimateConsumedChange/);
      assert.match(
        homeSource,
        /previousConsumedRef\.current !== null && previousConsumedRef\.current !== display\.consumed/,
      );
      assert.doesNotMatch(
        homeSource,
        /previousPercentRef\.current !== null && previousPercentRef\.current !== display\.percent/,
        "target-only percent changes snap through the consumed-change gate",
      );
      assert.match(homeSource, /display\.consumed[\s\S]*shouldAnimateConsumedChange/);
      assert.match(homeSource, /display\.percent[\s\S]*shouldAnimateConsumedChange/);
    }

    assert.doesNotMatch(homeSource, /sessionStorage/);
    assert.doesNotMatch(homeSource, /macroAnimation/);
    assert.doesNotMatch(homeSource, /animatedMacro/);
    assert.doesNotMatch(homeSource, /coachFade/);
    assert.doesNotMatch(homeSource, /CoachAdviceCard[\s\S]{0,160}transition/);
    assert.doesNotMatch(homeSource, /targetAnimation/);
  });
});
