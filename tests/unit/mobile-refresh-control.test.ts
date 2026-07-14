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

function countMatches(source: string, pattern: RegExp) {
  return source.match(pattern)?.length ?? 0;
}

function functionBody(source: string, functionName: string) {
  const startToken = `function ${functionName}`;
  const startIndex = source.indexOf(startToken);
  assert.notEqual(startIndex, -1, `${functionName} should exist`);
  const paramsEnd = source.indexOf(")", startIndex);
  assert.notEqual(paramsEnd, -1, `${functionName} should close its parameter list`);
  const bodyStart = source.indexOf("{", paramsEnd);
  assert.notEqual(bodyStart, -1, `${functionName} should have a body`);

  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    if (depth === 0) {
      return source.slice(bodyStart + 1, index);
    }
  }

  assert.fail(`${functionName} body should be closed`);
}

function assertIncludesInOrder(source: string, labels: Array<[string, string]>) {
  let previousIndex = -1;

  for (const [label, needle] of labels) {
    const nextIndex = source.indexOf(needle);
    assert.notEqual(nextIndex, -1, `${label} should exist`);
    assert.ok(nextIndex > previousIndex, `${label} should appear in source order`);
    previousIndex = nextIndex;
  }
}

const sources = {
  mainLayout: await readSource("../../client/src/components/MainLayout.tsx"),
  homeScreen: await readSource("../../client/src/components/HomeScreen.tsx"),
  onboarding: await readSource("../../client/src/components/Onboarding.tsx"),
};

describe("Home manual refresh source contract", () => {
  it("wires a Home-only manual refresh callback through the throwing meals loader", () => {
    const body = functionBody(sources.mainLayout, "MainLayout");

    assert.match(body, /const \[refreshingHomeToday,\s*setRefreshingHomeToday\] = useState\(false\)/);
    assert.match(body, /const \[homeRefreshError,\s*setHomeRefreshError\] = useState<string \| null>\(null\)/);
    assert.match(body, /const applyManualHomeRefresh = useStore\(\(s\) => s\.applyManualHomeRefresh\)/);
    assert.doesNotMatch(body, /homeRefreshCueToken|setHomeRefreshCueToken/);
    assert.match(body, /const refreshHomeManually = useCallback\(async \(\) => \{/);
    assert.match(body, /if \(!deviceId\) return/);
    assert.match(body, /setHomeRefreshError\(null\)/);
    assert.match(body, /setRefreshingHomeToday\(true\)/);
    assert.match(body, /try\s*\{[\s\S]*getMeals\(\{ refreshReason: "manual_refresh" \}\)[\s\S]*applyManualHomeRefresh\(meals\)/);
    assert.match(body, /catch \(error\)\s*\{/);
    assert.match(
      body,
      /if \(error instanceof Error && error\.message === "UNAUTHORIZED"\)\s*\{[\s\S]*void recoverGuestSession\(\);[\s\S]*setHomeRefreshError\("正在重新建立訪客狀態\.\.\."\);[\s\S]*throw error;[\s\S]*\}/,
    );
    assert.match(body, /setHomeRefreshError\("資料暫時無法更新，請稍後再試。"\)/);
    assert.match(body, /setHomeRefreshError\("資料暫時無法更新，請稍後再試。"\);[\s\S]*throw error;/);
    assert.match(body, /finally\s*\{[\s\S]*setRefreshingHomeToday\(false\)/);
    assert.match(body, /\}, \[applyManualHomeRefresh, deviceId, recoverGuestSession\]\);/);
    assert.doesNotMatch(body, /runInitialMealsLoad\(\{ refreshReason: "manual_refresh" \}\)/);
  });

  it("does not couple Home refresh to page reloads or History loaders", () => {
    assert.doesNotMatch(sources.mainLayout, /location\.reload\(/);
    assert.doesNotMatch(sources.mainLayout, /\bgetHistoryTrends\b/);
    assert.doesNotMatch(sources.mainLayout, /\bgetHistoryDaySnapshot\b/);
    assert.doesNotMatch(sources.homeScreen, /location\.reload\(/);
    assert.doesNotMatch(sources.homeScreen, /\bgetHistoryTrends\b/);
    assert.doesNotMatch(sources.homeScreen, /\bgetHistoryDaySnapshot\b/);
  });

  it("passes refresh props only to the Home screen surface", () => {
    assert.match(
      sources.mainLayout,
      /activeScreen === "home" && \(\s*<HomeScreen\s+onRefreshToday=\{refreshHomeManually\}\s+refreshingToday=\{refreshingHomeToday\}\s+refreshTodayError=\{homeRefreshError\}\s*\/>\s*\)/,
    );
    assert.doesNotMatch(sources.mainLayout, /<ChatPanel[\s\S]*onRefreshToday/);
    assert.doesNotMatch(sources.mainLayout, /<HistoryScreen[\s\S]*onRefreshToday/);
  });

  it("wraps the Home scroller in the pull refresh surface and removes the header refresh button", () => {
    const headerBody = functionBody(sources.homeScreen, "HomeHeader");
    const screenBody = functionBody(sources.homeScreen, "HomeScreen");

    assert.match(sources.homeScreen, /import \{ PullToRefreshSurface \} from "\.\/PullToRefreshSurface\.js";/);
    assert.match(sources.homeScreen, /import \{ SportFlameIcon, SportSettingsIcon \}/);
    assert.doesNotMatch(sources.homeScreen, /SportRefreshIcon/);
    assert.match(sources.homeScreen, /export interface HomeScreenProps/);
    assert.match(sources.homeScreen, /onRefreshToday: \(\) => void \| Promise<void>/);
    assert.match(sources.homeScreen, /refreshingToday: boolean/);
    assert.match(sources.homeScreen, /refreshTodayError: string \| null/);
    assert.doesNotMatch(sources.homeScreen, /refreshCueToken: number/);
    assert.doesNotMatch(sources.homeScreen, /interface HomeHeaderProps/);
    assert.equal(countMatches(headerBody, /<SportIconButton\b/g), 1);
    assert.equal(countMatches(headerBody, /<SportRefreshIcon\b/g), 0);
    assert.equal(countMatches(headerBody, /aria-label="重新整理今日資料"/g), 0);
    assert.equal(countMatches(headerBody, /title="重新整理今日資料"/g), 0);
    assert.match(headerBody, /className="home-sport-header-actions"/);
    assert.match(headerBody, /disabled=\{sending\}/);
    assertIncludesInOrder(sources.homeScreen, [
      ["Home header", "<HomeHeader />"],
      ["Refresh status copy", "{refreshTodayError ? ("],
      ["Pull refresh surface", "<PullToRefreshSurface"],
      ["Home content scroller", '<main ref={homeScrollRef} className="screen-scroll home-sport-scroll">'],
    ]);
    assertIncludesInOrder(screenBody, [
      ["Pull refresh surface", "<PullToRefreshSurface"],
      ["Refresh callback prop", "onRefresh={onRefreshToday}"],
      ["Home surface id", 'surfaceId="home"'],
      ["Home completion label", 'completionLabel="今日資料已更新"'],
      ["Home content scroller", '<main ref={homeScrollRef} className="screen-scroll home-sport-scroll">'],
    ]);
    assert.match(screenBody, /ariaLabel="下拉重新整理今日資料"/);
    assert.match(screenBody, /const secondaryScreen = useStore\(\(s\) => s\.secondaryScreen\)/);
    assert.match(screenBody, /const homeAnimationEnabled = secondaryScreen === null/);
    assert.match(screenBody, /const frame = useHomeNutritionTimeline\(homeAnimationEnabled\)/);
    assert.match(screenBody, /<CalorieHero dailySummary=\{dailySummary\} dailyTargets=\{dailyTargets\} frame=\{frame\} \/>/);
    assertIncludesInOrder(headerBody, [
      ["Settings control", 'aria-label="設定"'],
    ]);
  });

  it("routes manual refresh replay through the single Home nutrition frame", () => {
    const body = functionBody(sources.homeScreen, "CalorieHero");

    assert.match(sources.homeScreen, /function useHomeNutritionTimeline\(enabled: boolean\): HomeTimelineFrame/);
    assert.match(sources.homeScreen, /if \(!enabled\)\s*\{\s*return;\s*\}/);
    assert.doesNotMatch(sources.homeScreen, /refreshCueChanged|previousRefreshCueRef|input\.refreshCueToken/);
    assert.match(sources.homeScreen, /pendingIntent\?\.kind === "delta" && pendingIntent\.from[\s\S]*getSnapshotTimelineEndpoints\(pendingIntent\.from, dailyTargets\)[\s\S]*zeroEndpoints\(end\)/);
    assert.match(sources.homeScreen, /setFrame\(finishImmediately \? end : frameAt\(start, end, 0\)\)/);
    assert.match(sources.homeScreen, /consumeHomeAnimationIntent\(intentToken\)/);
    assert.match(sources.homeScreen, /HOME_TIMELINE_DURATION_MS/);
    assert.match(
      sources.homeScreen,
      /function CalorieHero\(\{\s*dailySummary,\s*dailyTargets,\s*frame,\s*\}: \{/,
    );
    assert.match(body, /value=\{frame\.ringValue\}/);
    assert.match(body, /drivenExternally/);
    assert.match(sources.homeScreen, /<SportProgressBar value=\{framePart\.barValue\} variant=\{macro\.variant\} drivenExternally \/>/);
    assert.match(sources.homeScreen, /const frame = useHomeNutritionTimeline\(homeAnimationEnabled\)/);
    assert.doesNotMatch(sources.homeScreen, /function useCountUpNumber/);
    assert.doesNotMatch(sources.homeScreen, /home-sport-refresh-cue/);
    assert.doesNotMatch(sources.homeScreen, /key=\{`home-hero-/);
    assert.doesNotMatch(sources.homeScreen, /replayKey=\{refreshCueToken\}/);
  });

  it("scrolls the Home container to top only for navigation-origin consumed intents", () => {
    const body = functionBody(sources.homeScreen, "HomeScreen");

    assert.match(
      sources.homeScreen,
      /import \{ isNavigationEntryTrigger, type HomeNutritionSnapshot \} from "\.\.\/lib\/home-animation-intent\.js";/,
    );
    assert.match(body, /const pendingIntent = useStore\(\(s\) => s\.homeAnimation\.pendingIntent\)/);
    assert.match(body, /const homeScrollRef = useRef<HTMLElement \| null>\(null\)/);
    assert.match(body, /const lastNavigationScrollTokenRef = useRef<number \| null>\(null\)/);
    assert.match(body, /!pendingIntent \|\| !isNavigationEntryTrigger\(pendingIntent\.origin\)/);
    assert.match(body, /lastNavigationScrollTokenRef\.current === pendingIntent\.token/);
    assert.match(body, /scrollContainer\.scrollTo\(0, 0\)/);
    assert.match(body, /scrollContainer\.scrollTop = 0/);
    assert.match(body, /<main ref=\{homeScrollRef\} className="screen-scroll home-sport-scroll">/);
    assert.doesNotMatch(body, /scrollTo\(0, 0\)[\s\S]*manual_refresh|cold_start/);
  });

  it("keeps Settings governed by sending and error copy independent from button loading state", () => {
    const headerBody = functionBody(sources.homeScreen, "HomeHeader");

    assert.doesNotMatch(headerBody, /refreshingToday|onRefreshToday|aria-busy|sp-refresh-button/);
    assert.match(
      headerBody,
      /<SportIconButton[\s\S]*disabled=\{sending\}[\s\S]*aria-label="設定"/,
      "Settings control should remain governed by sending, not refresh loading",
    );
    assert.match(
      sources.homeScreen,
      /\{refreshTodayError \? \(\s*<p className="home-sport-refresh-error" role="status">\s*\{refreshTodayError\}\s*<\/p>\s*\) : null\}/,
    );
    assert.match(sources.mainLayout, /資料暫時無法更新，請稍後再試。/);
  });

  it("wraps onboarding in a real scroll target for pre-shell pull refresh", () => {
    const body = functionBody(sources.onboarding, "Onboarding");

    assert.match(
      sources.onboarding,
      /import \{ PullToRefreshSurface \} from "\.\/PullToRefreshSurface\.js";/,
    );
    assert.match(
      sources.onboarding,
      /function refreshOnboardingShell\(\) \{[\s\S]*document\.documentElement\.dataset\.onboardingRefreshFired = "true";[\s\S]*nutrition-coach:onboarding-refresh-fired[\s\S]*window\.location\.reload\(\);[\s\S]*\}/,
    );
    assertIncludesInOrder(body, [
      ["Pull refresh surface", "<PullToRefreshSurface"],
      ["Refresh callback", "onRefresh={refreshOnboardingShell}"],
      ["Onboarding surface id", 'surfaceId="onboarding"'],
      ["Onboarding pull label", 'ariaLabel="下拉重新整理初始設定"'],
      ["Scroll target", '<div className="screen-scroll sp-onboarding-scroll">'],
      ["Stepper", "<OnboardingStepper />"],
    ]);
    assert.doesNotMatch(body, /<main className="screen-scroll sp-onboarding-scroll">/);
  });
});
