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
  const bodyStart = source.indexOf("{", startIndex);
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
};

describe("Home manual refresh source contract", () => {
  it("wires a Home-only manual refresh callback through the throwing meals loader", () => {
    const body = functionBody(sources.mainLayout, "MainLayout");

    assert.match(body, /const \[refreshingHomeToday,\s*setRefreshingHomeToday\] = useState\(false\)/);
    assert.match(body, /const \[homeRefreshError,\s*setHomeRefreshError\] = useState<string \| null>\(null\)/);
    assert.match(body, /const refreshHomeManually = useCallback\(async \(\) => \{/);
    assert.match(body, /if \(!deviceId\) return/);
    assert.match(body, /setHomeRefreshError\(null\)/);
    assert.match(body, /setRefreshingHomeToday\(true\)/);
    assert.match(body, /try\s*\{[\s\S]*getMeals\(\{ refreshReason: "manual_refresh" \}\)[\s\S]*setMeals\(meals\)/);
    assert.match(body, /catch\s*\{[\s\S]*setHomeRefreshError\("資料暫時無法更新，請稍後再試。"\)/);
    assert.match(body, /finally\s*\{[\s\S]*setRefreshingHomeToday\(false\)/);
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

  it("renders exactly one Home header refresh control beside Settings", () => {
    const headerBody = functionBody(sources.homeScreen, "HomeHeader");

    assert.match(sources.homeScreen, /import \{ SportFlameIcon, SportRefreshIcon, SportSettingsIcon \}/);
    assert.match(sources.homeScreen, /export interface HomeScreenProps/);
    assert.match(sources.homeScreen, /interface HomeHeaderProps/);
    assert.match(sources.homeScreen, /onRefreshToday: \(\) => void \| Promise<void>/);
    assert.match(sources.homeScreen, /refreshingToday: boolean/);
    assert.match(sources.homeScreen, /refreshTodayError: string \| null/);
    assert.equal(countMatches(headerBody, /<SportRefreshIcon\b/g), 1);
    assert.equal(countMatches(headerBody, /aria-label="重新整理今日資料"/g), 1);
    assert.equal(countMatches(headerBody, /title="重新整理今日資料"/g), 1);
    assert.match(headerBody, /className="home-sport-header-actions"/);
    assertIncludesInOrder(headerBody, [
      ["Refresh control", 'aria-label="重新整理今日資料"'],
      ["Settings control", 'aria-label="設定"'],
    ]);
  });

  it("keeps refresh loading and error state scoped to the refresh control", () => {
    const headerBody = functionBody(sources.homeScreen, "HomeHeader");

    assert.match(
      headerBody,
      /<SportIconButton[\s\S]*className=\{`sp-refresh-button \$\{refreshingToday \? "sp-refresh-button--loading" : ""\}`\}[\s\S]*onClick=\{onRefreshToday\}[\s\S]*disabled=\{refreshingToday\}/,
    );
    assert.match(
      headerBody,
      /aria-busy=\{refreshingToday \? "true" : undefined\}/,
    );
    assert.match(
      headerBody,
      /aria-label="設定"[\s\S]*disabled=\{sending\}/,
      "Settings control should remain governed by sending, not refresh loading",
    );
    assert.match(
      sources.homeScreen,
      /\{refreshTodayError \? \(\s*<p className="home-sport-refresh-error" role="status">\s*\{refreshTodayError\}\s*<\/p>\s*\) : null\}/,
    );
    assert.match(sources.homeScreen, /資料暫時無法更新，請稍後再試。/);
  });
});
