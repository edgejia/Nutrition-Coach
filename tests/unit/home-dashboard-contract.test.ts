import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

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

// Runtime semantic authority: history-home-semantic-owner-contract.test.ts.
// The assertions below are bounded source/structure guards, not behavioral authority.
describe("Home dashboard display contracts", () => {
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

  it("Home meal rows split eligible edit buttons from silent read-only fallbacks", async () => {
    const homeSource = await readSource("../../client/src/components/HomeScreen.tsx");
    const cssSource = await readSource("../../client/src/app.css");

    assert.match(homeSource, /buildMealEditPayloadIfComplete/);
    assert.match(homeSource, /import \{ buildMealEditPayloadIfComplete \} from "\.\.\/meal-edit-payload\.js"/);
    assert.match(homeSource, /const openMealEdit = useStore\(\(s\) => s\.openMealEdit\)/);
    assert.match(homeSource, /const todayDateKey = dailySummary\?\.date \?\? formatLocalDate\(new Date\(\)\)/);
    assert.match(homeSource, /<MealRows meals=\{meals\} todayDateKey=\{todayDateKey\}/);
    assert.match(homeSource, /buildMealEditPayloadIfComplete\(meal, todayDateKey\)/);
    assert.match(homeSource, /openMealEdit\(editPayload, "home"\)/);
    assert.match(homeSource, /<button\s+type="button"\s+className="home-sport-meal-row"/);
    assert.match(homeSource, /aria-label=\{`編輯 \$\{getDisplayMealLabel\(meal\.mealPeriod, meal\.loggedAt\)\} \$\{meal\.foodName\}`\}/);
    assert.match(homeSource, /<article key=\{meal\.id\} className="home-sport-meal-row">/);
    assert.match(homeSource, /getMealBadge\(meal\.mealPeriod, meal\.loggedAt\)/);
    assert.match(homeSource, /formatMealRowTime\(meal\.loggedAt\)/);
    assert.match(homeSource, /getDisplayMealLabel\(meal\.mealPeriod, meal\.loggedAt\)/);
    assert.match(homeSource, /getMealMacroSummary\(meal\)/);
    assert.match(homeSource, /Math\.max\(0, Math\.round\(meal\.calories\)\)/);
    assert.match(homeSource, /stageHomeTaskOptionPrompt\(prompt, setPendingHomeChatDraft, setActiveScreen\)/);
    assert.match(homeSource, /<button type="button" className="home-sport-empty-action" onClick=\{onEmptyChatClick\}>/);
    assert.match(cssSource, /\.home-sport-meal-row\[type="button"\][\s\S]*cursor:\s*pointer/);
    assert.match(cssSource, /\.home-sport-meal-row\[type="button"\]:hover[\s\S]*background:\s*var\(--sp-surface-2\)/);
    assert.match(cssSource, /\.home-sport-meal-row\[type="button"\]:focus-visible[\s\S]*outline:\s*2px solid var\(--sp-lime\)/);
    assert.doesNotMatch(homeSource, /SportPlusIcon/);
    assert.doesNotMatch(homeSource, /SportChevronRightIcon|SportEditIcon|EditIcon/);
    assert.doesNotMatch(homeSource, /openSecondaryScreen\("mealEdit"/);
    assert.doesNotMatch(homeSource, /homeMealEdit|HomeMealEdit|openHomeMealEdit/);
    assert.doesNotMatch(homeSource, /disabled[^=]|暫不可編輯|不可編輯|無法編輯|tooltip|title=\{`編輯/);
  });

  it("drives hero and macro replay from one Home nutrition timeline frame", async () => {
    const homeSource = await readSource("../../client/src/components/HomeScreen.tsx");
    const lifecycleSource = await readSource("../../client/src/lib/home-animation-lifecycle.ts");
    const sportSource = await readSource("../../client/src/components/SportPrimitives.tsx");
    const cssSource = await readSource("../../client/src/app.css");

    assert.match(homeSource, /function useHomeNutritionTimeline\(enabled: boolean\): HomeNutritionTimeline/);
    assert.match(homeSource, /if \(!enabled \|\| pendingIntent === null \|\| intentToken === null\) return;/);
    assert.match(homeSource, /const secondaryScreen = useStore\(\(s\) => s\.secondaryScreen\)/);
    assert.match(homeSource, /const homeAnimationEnabled = secondaryScreen === null/);
    assert.match(homeSource, /const nutritionTimeline = useHomeNutritionTimeline\(homeAnimationEnabled\)/);
    assert.match(homeSource, /const frame = nutritionTimeline\.frame/);
    assert.match(homeSource, /data-home-animation-state=\{animationRunning \? "running" : "complete"\}/);
    assert.doesNotMatch(homeSource, /refreshCueToken/);
    assert.match(lifecycleSource, /frameAt\(start, end, easeShared\(progress\)\)/);
    assert.match(lifecycleSource, /HOME_TIMELINE_DURATION_MS/);
    assert.match(homeSource, /matchMedia\("\(prefers-reduced-motion: reduce\)"\)/);
    assert.match(homeSource, /requestAnimationFrame\.bind\(window\)/);
    assert.match(homeSource, /cancelAnimationFrame\.bind\(window\)/);
    assert.match(homeSource, /runHomeAnimationEffect\(/);
    assert.match(homeSource, /consumeHomeAnimationIntent\(intentToken\)/);

    assert.match(homeSource, /\{frame\.kcal\.toLocaleString\("en-US"\)\}/);
    assert.match(homeSource, /<SportRing[\s\S]*value=\{frame\.ringValue\}[\s\S]*drivenExternally/);
    assert.match(homeSource, /<strong className="sp-display">\{frame\.percent\}<\/strong>/);

    assert.match(homeSource, /<span>\{framePart\.grams\}<\/span>/);
    assert.match(homeSource, /<SportProgressBar value=\{framePart\.barValue\} variant=\{macro\.variant\} drivenExternally \/>/);
    assert.match(homeSource, /<div className="home-sport-macro-percent">\{framePart\.percent\}%<\/div>/);
    assert.match(homeSource, /framePart=\{frame\.macros\[index\]/);
    assert.match(sportSource, /replayKey\??: ?number/);
    assert.match(sportSource, /drivenExternally\?: boolean/);
    assert.match(sportSource, /sp-bar-fill/);

    assert.match(cssSource, /\.sp-bar-fill \{[^}]*transition: width 360ms/);
    assert.match(cssSource, /\.sp-bar-fill--driven\s*\{\s*transition: none;\s*\}/);
    assert.match(cssSource, /\.sp-ring-progress--driven\s*\{\s*transition: none;\s*\}/);
    assert.match(cssSource, /@media \(prefers-reduced-motion: reduce\) \{ \.sp-bar-fill/);

    assert.doesNotMatch(homeSource, /function useCountUpNumber|const useCountUpNumber/);
    assert.doesNotMatch(homeSource, /animatedRingValue/);
    assert.doesNotMatch(homeSource, /home-sport-refresh-cue/);
    assert.doesNotMatch(homeSource, /key=\{`home-hero-/);
    assert.doesNotMatch(homeSource, /sessionStorage/);
    assert.doesNotMatch(homeSource, /macroAnimation/);
    assert.doesNotMatch(homeSource, /animatedMacro/);
    assert.doesNotMatch(homeSource, /coachFade/);
    assert.doesNotMatch(homeSource, /CoachAdviceCard[\s\S]{0,160}transition/);
    assert.doesNotMatch(homeSource, /targetAnimation/);
    assert.doesNotMatch(sportSource, /@keyframes/);
  });

  it("MOB-02 keeps Home CTA inside the primary scroller with bottom-nav reserve", async () => {
    const homeSource = await readSource("../../client/src/components/HomeScreen.tsx");
    const cssSource = await readSource("../../client/src/app.css");
    const homeScrollBlock = cssBlock(cssSource, ".home-sport-scroll");

    assert.match(homeSource, /<main ref=\{homeScrollRef\} className="screen-scroll home-sport-scroll">/);
    assert.match(homeSource, /<CoachAdviceCard advice=\{coachAdvice\} cta=\{cta\}/);
    assert.match(homeSource, /sendHomeCtaTaskOption\(option, intent, setPendingHomeChatDraft, setActiveScreen\)/);
    assert.match(homeScrollBlock, /display:\s*flex/);
    assert.match(homeScrollBlock, /flex-direction:\s*column/);
    assert.match(homeScrollBlock, /gap:\s*16px/);
    assert.match(
      homeScrollBlock,
      /calc\(128px \+ var\(--app-bottom-occlusion,\s*0px\) \+ env\(safe-area-inset-bottom\)\)/,
      "MOB-02 Home scroller must reserve enough bottom space above the fixed nav for expanded CTA options",
    );
    assert.doesNotMatch(homeSource, /new mobile action strip|collapse choices|sp-home-action-strip/i);
  });
});
