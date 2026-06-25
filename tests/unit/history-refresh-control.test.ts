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
  historyScreen: await readSource("../../client/src/components/HistoryScreen.tsx"),
  mainLayout: await readSource("../../client/src/components/MainLayout.tsx"),
  homeScreen: await readSource("../../client/src/components/HomeScreen.tsx"),
};

describe("History manual refresh source contract", () => {
  it("runs both History loaders with one cancellation ref", () => {
    const body = functionBody(sources.historyScreen, "HistoryScreen");

    assert.match(body, /const \[refreshingHistory,\s*setRefreshingHistory\] = useState\(false\)/);
    assert.match(
      body,
      /const manualRefreshCancelRef = useRef<\{ current: boolean \} \| null>\(null\)/,
    );
    assert.match(body, /const handleManualHistoryRefresh = useCallback\(async \(\) => \{/);
    assert.match(
      body,
      /if \(manualRefreshCancelRef\.current\) \{[\s\S]*manualRefreshCancelRef\.current\.current = true;/,
    );
    assert.match(body, /const cancelledRef = \{ current: false \}/);
    assert.match(body, /manualRefreshCancelRef\.current = cancelledRef/);
    assert.match(body, /setRefreshingHistory\(true\)/);
    assert.match(
      body,
      /await Promise\.all\(\[\s*loadTrends\(cancelledRef\),\s*loadSelectedDay\(cancelledRef\),\s*\]\)/,
    );
    assert.match(
      body,
      /finally\s*\{[\s\S]*if \(!cancelledRef\.current\) \{[\s\S]*setRefreshingHistory\(false\);[\s\S]*manualRefreshCancelRef\.current = null;/,
    );
    assert.match(
      body,
      /useEffect\(\(\) => \{[\s\S]*manualRefreshCancelRef\.current\.current = true;[\s\S]*manualRefreshCancelRef\.current = null;[\s\S]*setRefreshingHistory\(false\);[\s\S]*\}, \[selectedDateKey, weekStartKey\]\)/,
    );
  });

  it("renders History refresh through the shared pull surface without an explicit row button", () => {
    assert.match(
      sources.historyScreen,
      /import \{ PullToRefreshSurface \} from "\.\/PullToRefreshSurface\.js";/,
    );
    assert.match(
      sources.historyScreen,
      /import \{ SportChevronLeftIcon, SportChevronRightIcon \} from "\.\/SportIcons\.js";/,
    );
    assert.doesNotMatch(sources.historyScreen, /SportRefreshIcon/);

    const scrollIndex = sources.historyScreen.indexOf('<main className="screen-scroll-safe sp-history-scroll">');
    assert.notEqual(scrollIndex, -1, "History scroll container should exist");
    const pullSurfaceIndex = sources.historyScreen.indexOf("<PullToRefreshSurface");
    assert.notEqual(pullSurfaceIndex, -1, "History pull refresh surface should exist");
    assert.ok(pullSurfaceIndex < scrollIndex, "History pull surface should wrap the scroll container");
    const scrollSource = sources.historyScreen.slice(pullSurfaceIndex);

    assertIncludesInOrder(scrollSource, [
      ["Pull refresh surface", "<PullToRefreshSurface"],
      ["Refresh callback", "onRefresh={handleManualHistoryRefresh}"],
      ["Refresh in-flight state", "refreshing={refreshingHistory}"],
      ["History pull label", 'ariaLabel="下拉重新整理歷史資料"'],
      ["History scroll container", '<main className="screen-scroll-safe sp-history-scroll">'],
      ["Trend error card", "trendError ? ("],
      ["Weekly content", "sp-history-weekly"],
    ]);

    assert.equal(countMatches(sources.historyScreen, /aria-label="重新整理歷史資料"/g), 0);
    assert.equal(countMatches(sources.historyScreen, /title="重新整理歷史資料"/g), 0);
    assert.equal(countMatches(sources.historyScreen, /sp-history-refresh-row/g), 0);
    assert.equal(countMatches(sources.historyScreen, /onClick=\{handleManualHistoryRefresh\}/g), 0);
  });

  it("keeps History loader errors as the existing error-card path", () => {
    const body = functionBody(sources.historyScreen, "HistoryScreen");

    assert.match(sources.historyScreen, /function historyErrorMessage\(error: unknown\): string/);
    assert.match(body, /setTrendError\(historyErrorMessage\(error\)\)/);
    assert.match(body, /setDayError\(historyErrorMessage\(error\)\)/);
    assert.doesNotMatch(body, /setHistoryRefreshError/);
    assert.doesNotMatch(body, /資料暫時無法更新，請稍後再試。/);
  });

  it("does not call Home refresh paths or reload the page", () => {
    const body = functionBody(sources.historyScreen, "HistoryScreen");

    assert.doesNotMatch(body, /\bgetMeals\b/);
    assert.doesNotMatch(body, /\brunInitialMealsLoad\b/);
    assert.doesNotMatch(body, /location\.reload\(/);
    assert.doesNotMatch(sources.mainLayout, /<HistoryScreen[\s\S]*onRefreshToday/);
    assert.doesNotMatch(sources.homeScreen, /aria-label="重新整理歷史資料"/);
  });

  it("limits in-flight state to the History refresh control and leaves navigation untouched", () => {
    const body = functionBody(sources.historyScreen, "HistoryScreen");

    assert.match(body, /refreshing=\{refreshingHistory\}/);
    assert.match(body, /onRefresh=\{handleManualHistoryRefresh\}/);
    assert.doesNotMatch(body, /sp-refresh-button/);
    assert.doesNotMatch(body, /aria-busy=\{refreshingHistory \? "true" : undefined\}/);
    assert.match(body, /<div className=\{isWeekPending \? "sp-history-weekly sp-history-pending" : "sp-history-weekly"\}>/);
    assert.match(body, /<SelectedDayHero[\s\S]*pending=\{isSelectedDayPending\}/);
    assert.match(body, /<TimelinePanel[\s\S]*pending=\{isSelectedDayPending \|\| showInlineDayPending\}/);
    assert.doesNotMatch(body, /setActiveScreen/);
    assert.doesNotMatch(body, /activeScreen/);
    assert.doesNotMatch(body, /secondaryScreen/);
  });
});
