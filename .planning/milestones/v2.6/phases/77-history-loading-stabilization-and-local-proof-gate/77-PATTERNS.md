# Phase 77: History Loading Stabilization and Local Proof Gate - Pattern Map

**Mapped:** 2026-06-04
**Files analyzed:** 6
**Analogs found:** 6 / 6

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `client/src/components/HistoryScreen.tsx` | component | request-response + event-driven | `client/src/components/HistoryScreen.tsx` | exact |
| `client/src/lib/history-week.ts` | utility | transform | `client/src/lib/history-week.ts` | exact |
| `tests/unit/history-screen-contract.test.ts` | test | transform/source-contract | `tests/unit/history-screen-contract.test.ts` | exact |
| `tests/unit/history-week.test.ts` | test | transform | `tests/unit/history-week.test.ts` | exact |
| `tests/harness/scenarios/77-history-loading-visual.mjs` | test/harness script | request-response + file-I/O | `tests/harness/scenarios/49-history-dashboard-polish-visual.mjs` | role-match |
| `.planning/phases/77-history-loading-stabilization-and-local-proof-gate/77-VERIFICATION.md` or closure matrix artifact | planning/proof | batch | `74-VERIFICATION.md`, `75-VERIFICATION.md`, `76-VERIFICATION.md`, plus representative tests | role-match |

## Pattern Assignments

### `client/src/components/HistoryScreen.tsx` (component, request-response + event-driven)

**Analog:** `client/src/components/HistoryScreen.tsx`

**Imports pattern** (lines 1-20):
```tsx
import { useCallback, useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { getHistoryDaySnapshot, getHistoryTrends } from "../api.js";
import {
  buildHistoryWeek,
  buildHistoryWeekStats,
  getHistorySportStatusMeta,
  getMondayWeekStart,
  selectSameWeekdayOrClosestAvailable,
  shiftHistoryWeek,
  type HistorySportBarTone,
  type HistoryWeekDay,
} from "../lib/history-week.js";
import { formatLocalDate } from "../lib/time.js";
import { buildHistoryMealEditPayload } from "../meal-edit-payload.js";
import { useStore } from "../store.js";
import type { HistoryDaySnapshot, HistoryTrendResponse, MealEntry } from "../types.js";
import { formatMealRowTime, getDisplayMealLabel, getMealMacroSummary } from "./HomeScreen.js";
import { PersistedAssetImage } from "./PersistedAssetImage.js";
import { SportChevronLeftIcon, SportChevronRightIcon } from "./SportIcons.js";
import { SportCard, SportChip, SportIconButton, SportScreen } from "./SportPrimitives.js";
```

**Target week placeholder pattern** (lines 392-416):
```tsx
const weekEndKey = addLocalDays(weekStartKey, 6);
const targetCalories = dailyTargets?.calories ?? null;
const currentTrends = trendsCache.get(weekStartKey) ?? null;
const hasCurrentWeekCache = currentTrends !== null;
const selectedSnapshot = dayCache.get(selectedDateKey) ?? null;
const isWeekPending = loadingTrends && hasCurrentWeekCache;
const weekDays = buildHistoryWeek({
  weekStartKey,
  selectedDateKey,
  todayKey,
  trends: currentTrends?.daily ?? [],
  targets: dailyTargets,
  pending: !hasCurrentWeekCache,
});
const selectedWeekDay = weekDays.find((day) => day.dateKey === selectedDateKey);
const hasSelectedWeekDayDisplay =
  selectedWeekDay?.status !== "pending" && selectedWeekDay?.calories !== null && selectedWeekDay?.mealCount !== null;
const hasSelectedDayDisplay = selectedSnapshot !== null || hasSelectedWeekDayDisplay;
const isSelectedDayPending = loadingDay && hasSelectedDayDisplay;
const isSelectedDayCacheMiss = !hasSelectedDayDisplay;
const weekStats = buildHistoryWeekStats({
  days: weekDays,
  averageCalories: currentTrends?.averages.calories ?? null,
  pending: !hasCurrentWeekCache,
});
```

**Top-level loading anti-pattern to replace** (lines 566-571):
```tsx
{loadingTrends && !hasCurrentWeekCache ? (
  <SportCard className="sp-history-state-card" variant="flat">
    載入這週紀錄中...
  </SportCard>
) : null}
```

Planner should remove this broad branch for cold week switches and rely on the target-week shell plus inline pending slots. The source-contract test currently still accepts this branch, so update the test in the same plan.

**Hero aggregate display pattern** (lines 152-193):
```tsx
function SelectedDayHero({
  selectedDateKey,
  selectedDay,
  snapshot,
  targetCalories,
  pending,
  cacheMiss,
}: {
  selectedDateKey: string;
  selectedDay: HistoryWeekDay | undefined;
  snapshot: HistoryDaySnapshot | null;
  targetCalories: number | null;
  pending: boolean;
  cacheMiss: boolean;
}) {
  const selectedDayCalories = selectedDay?.calories ?? null;
  const displayCalories = snapshot?.summary.totalCalories ?? selectedDayCalories;
  const pendingCalories = cacheMiss || displayCalories === null;
  const consumedCalories = pendingCalories ? null : Math.max(0, Math.round(displayCalories));
```

**Snapshot-backed row/edit activation pattern** (lines 235-248 and 363-370):
```tsx
function onTimelineOpen(targetMealId?: string) {
  openDayDetail(
    {
      dateKey: selectedDateKey,
      targetMealId,
      label: selectedDateKey === todayKey ? "today-live" : "history-snapshot",
    },
    "history",
  );
}

function onMealOpen(meal: MealEntry) {
  openMealEdit(buildHistoryMealEditPayload(meal, selectedDateKey), "history");
}
```

```tsx
{!dayError && snapshot !== null && meals.length > 0 ? (
  <TimelineRows
    meals={meals}
    selectedDateKey={selectedDateKey}
    todayKey={todayKey}
    openDayDetail={openDayDetail}
    openMealEdit={openMealEdit}
  />
) : null}
```

**Pending/empty/error slot to tighten** (lines 334-361):
```tsx
const meals = snapshot?.meals ?? [];
const selectedDayMealCount = selectedDay?.mealCount ?? null;
const displayMealCount = cacheMiss ? null : (snapshot?.meals.length ?? selectedDayMealCount);
const showPendingBoundary = cacheMiss && !dayError;
const pendingCopy = cacheMiss ? "同步這天紀錄中..." : "載入這天餐點中...";
```

```tsx
{showPendingBoundary ? (
  <SportCard className="sp-history-state-card" variant="flat">
    {pendingCopy}
  </SportCard>
) : null}
{dayError ? (
  <SportCard className="sp-history-state-card sp-history-state-error" variant="flat">
    {dayError}
  </SportCard>
) : null}
{!dayError && displayMealCount === 0 && meals.length === 0 ? (
  <SportCard className="sp-history-empty" variant="flat">
    <h3>這天還沒有餐點</h3>
    <p>選擇其他日期，或到「對話」記錄今天吃了什麼。</p>
  </SportCard>
) : null}
```

Planner should make confirmed empty state require `snapshot !== null && snapshot.meals.length === 0`; trend-only `selectedDay.mealCount === 0` must not unlock empty state or Day Detail.

**Scoped mutation refresh/invalidation pattern** (lines 500-536):
```tsx
useEffect(() => {
  if (!lastMealMutation) {
    return;
  }

  const affectedDate = lastMealMutation.affectedDate;
  const affectedWeekStartKey = getMondayWeekStart(affectedDate);
  setDayCache((cache) => {
    const next = new Map(cache);
    if (affectedDate !== selectedDateKey) {
      next.delete(affectedDate);
    }
    return next;
  });
  setTrendsCache((cache) => {
    const next = new Map(cache);
    if (affectedWeekStartKey !== weekStartKey) {
      next.delete(affectedWeekStartKey);
    }
    return next;
  });

  const shouldRefreshDay = affectedDate === selectedDateKey;
  const shouldRefreshWeek = affectedWeekStartKey === weekStartKey;
  if (!shouldRefreshDay && !shouldRefreshWeek) {
    return;
  }

  const cancelledRef = { current: false };
  void Promise.all([
    shouldRefreshDay ? loadSelectedDay(cancelledRef) : Promise.resolve(),
    shouldRefreshWeek ? loadTrends(cancelledRef) : Promise.resolve(),
  ]);
  return () => {
    cancelledRef.current = true;
  };
}, [lastMealMutation, loadSelectedDay, loadTrends, selectedDateKey, weekStartKey]);
```

### `client/src/lib/history-week.ts` (utility, transform)

**Analog:** `client/src/lib/history-week.ts`

**Imports/types pattern** (lines 1-12, 23-37, 47-52):
```ts
import type { DailyTargets } from "../types.js";
import { formatLocalDate } from "./time.js";

export type HistoryCalorieStatus =
  | "empty"
  | "targetMissing"
  | "low"
  | "slightlyLow"
  | "inRange"
  | "over"
  | "highOver"
  | "pending";
```

```ts
export interface HistoryWeekDay {
  dateKey: string;
  weekday: "一" | "二" | "三" | "四" | "五" | "六" | "日";
  dayNumber: number;
  calories: number | null;
  mealCount: number | null;
  status: HistoryCalorieStatus;
  calorieRatio: number | null;
  waterLevel: number;
  hasTarget: boolean;
  isOverTolerance: boolean;
  isSelected: boolean;
  isToday: boolean;
  isFuture: boolean;
}
```

**Date helper pattern** (lines 63-100, 148-155):
```ts
const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const WEEKDAY_LABELS: HistoryWeekDay["weekday"][] = ["一", "二", "三", "四", "五", "六", "日"];

export function isRealDateKey(dateKey: string): boolean {
  const match = DATE_KEY_PATTERN.exec(dateKey);
  if (!match) {
    return false;
  }
  // real local-date validation follows
}
```

```ts
export function getMondayWeekStart(dateKey: string): string {
  const date = parseDateKey(dateKey);
  date.setDate(date.getDate() - dayOffsetFromMonday(date));
  return formatLocalDate(date);
}

export function shiftHistoryWeek(weekStartKey: string, deltaWeeks: -1 | 1): string {
  return addDays(weekStartKey, deltaWeeks * 7);
}
```

**Pending week-day transform pattern** (lines 158-213):
```ts
export function buildHistoryWeek(input: {
  weekStartKey: string;
  selectedDateKey: string;
  todayKey: string;
  trends: HistoryWeekTrend[];
  targets?: DailyTargets | null;
  pending?: boolean;
}): HistoryWeekDay[] {
  const trendsByDate = new Map(input.trends.map((trend) => [trend.date, trend]));

  return WEEKDAY_LABELS.map((weekday, index) => {
    const dateKey = addDays(input.weekStartKey, index);
    const date = parseDateKey(dateKey);
    const sharedDayState = {
      dateKey,
      weekday,
      dayNumber: date.getDate(),
      isSelected: dateKey === input.selectedDateKey,
      isToday: dateKey === input.todayKey,
      isFuture: dateKey > input.todayKey,
    };

    if (input.pending === true) {
      return {
        ...sharedDayState,
        calories: null,
        mealCount: null,
        status: "pending",
        calorieRatio: null,
        waterLevel: 0,
        hasTarget: Boolean(input.targets?.calories),
        isOverTolerance: false,
      };
    }
```

**Pending stats pattern** (lines 215-235):
```ts
export function buildHistoryWeekStats(input: {
  days: HistoryWeekDay[];
  averageCalories?: number | null;
  pending?: boolean;
}): HistoryWeekStats {
  if (input.pending === true || (input.days.length > 0 && input.days.every((day) => day.status === "pending"))) {
    return {
      averageCalories: null,
      inRangeDays: null,
      loggedDays: null,
      mealCount: null,
    };
  }

  return {
    averageCalories: Math.max(0, Math.round(input.averageCalories ?? 0)),
    inRangeDays: input.days.filter((day) => day.status === "inRange" && (day.mealCount ?? 0) > 0).length,
    loggedDays: input.days.filter((day) => (day.mealCount ?? 0) > 0 && !day.isFuture).length,
    mealCount: input.days.reduce((total, day) => total + (day.isFuture ? 0 : (day.mealCount ?? 0)), 0),
  };
}
```

### `tests/unit/history-screen-contract.test.ts` (test, transform/source-contract)

**Analog:** `tests/unit/history-screen-contract.test.ts`

**Source-contract imports/read pattern** (lines 1-13):
```ts
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const historyScreenPath = fileURLToPath(new URL("../../client/src/components/HistoryScreen.tsx", import.meta.url));
const appCssPath = fileURLToPath(new URL("../../client/src/app.css", import.meta.url));
const source = await readFile(historyScreenPath, "utf8");
const cssSource = await readFile(appCssPath, "utf8");

function escapedPattern(value: string) {
  return new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
}
```

**Existing History dependency/copy assertions** (lines 19-57):
```ts
describe("History screen source contract", () => {
  it("uses Phase 41 sport primitives and real History helpers", () => {
    for (const expected of [
      "SportScreen",
      "SportCard",
      "SportChip",
      "SportIconButton",
      "SportChevronLeftIcon",
      "SportChevronRightIcon",
      "buildHistoryWeek",
      "buildHistoryWeekStats",
      "getHistorySportStatusMeta",
      "getHistoryTrends",
      "getHistoryDaySnapshot",
      "lastMealMutation",
    ]) {
      assert.match(source, escapedPattern(expected));
    }
  });
```

Update the locked copy list at lines 39-57 so `載入這週紀錄中...` is rejected for the cold-switch render path and `同步這天紀錄中...` is explicitly required.

**Cache and stale-row contract pattern** (lines 127-141, 183-196):
```ts
it("keeps selected-day snapshots stable during routine revalidation", () => {
  for (const expected of [
    "trendsCache",
    "setTrendsCache",
    "trendsCache.get(weekStartKey)",
    "dayCache",
    "setDayCache",
    "dayCache.get(selectedDateKey)",
  ]) {
    assert.match(source, escapedPattern(expected));
  }

  assert.doesNotMatch(source, /trends\?\.daily|trends\?\.averages/);
  assert.doesNotMatch(source, /setSelectedSnapshot\(null\);\s+return getHistoryDaySnapshot\(selectedDateKey\)/);
});
```

```ts
it("preserves visible selected-day display from same-date week cache during day revalidation", () => {
  assert.match(source, /const selectedWeekDay = weekDays\.find\(\(day\) => day\.dateKey === selectedDateKey\)/);
  assert.match(
    source,
    /const hasSelectedWeekDayDisplay =[\s\S]*selectedWeekDay\?\.status !== "pending"[\s\S]*selectedWeekDay\?\.calories !== null[\s\S]*selectedWeekDay\?\.mealCount !== null/,
  );
  assert.match(source, /const hasSelectedDayDisplay = selectedSnapshot !== null \|\| hasSelectedWeekDayDisplay/);
  assert.match(source, /const isSelectedDayCacheMiss = !hasSelectedDayDisplay/);
  assert.match(source, /const displayCalories = snapshot\?\.summary\.totalCalories \?\? selectedDayCalories/);
  assert.match(source, /const displayMealCount = cacheMiss \? null : \(snapshot\?\.meals\.length \?\? selectedDayMealCount\)/);
  assert.match(source, /<span>\{displayMealCount === null \? "--" : displayMealCount\}筆<\/span>/);
  assert.match(source, /meals=\{meals\}/);
  assert.doesNotMatch(source, /snapshot === null \? previous|previousSnapshot|previousDate/);
});
```

Revise this contract to keep aggregate display, but reject empty/detail activation unless `snapshot !== null`.

**Mutation refresh contract pattern** (lines 158-180):
```ts
it("invalidates only the affected day and affected week after meal mutations", () => {
  assert.match(source, /lastMealMutation\.affectedDate/);
  assert.match(source, /const affectedDate = lastMealMutation\.affectedDate|lastMealMutation\.affectedDate/);
  assert.match(source, /dayCache/);
  assert.match(source, /affectedDate !== selectedDateKey[\s\S]*?\.delete\(affectedDate\)/);
  assert.match(source, /trendsCache/);
  assert.match(
    source,
    /affectedWeekStartKey !== weekStartKey[\s\S]*?\.delete\(affectedWeekStartKey\)/,
  );
});

it("refreshes History only when the selected day or visible week matches the mutation date", () => {
  assert.match(source, /const shouldRefreshDay = affectedDate === selectedDateKey/);
  assert.match(source, /const shouldRefreshWeek = affectedWeekStartKey === weekStartKey/);
  assert.match(source, /if \(!shouldRefreshDay && !shouldRefreshWeek\) \{\s*return;\s*\}/);
  assert.match(source, /shouldRefreshDay \? loadSelectedDay\(cancelledRef\) : Promise\.resolve\(\)/);
  assert.match(source, /shouldRefreshWeek \? loadTrends\(cancelledRef\) : Promise\.resolve\(\)/);

  assert.doesNotMatch(source, /activeScreen === "history"[\s\S]*loadSelectedDay/);
  assert.doesNotMatch(source, /activeScreen === "history"[\s\S]*loadTrends/);
  assert.doesNotMatch(source, /secondaryScreen[\s\S]*loadSelectedDay/);
  assert.doesNotMatch(source, /secondaryScreen[\s\S]*loadTrends/);
});
```

### `tests/unit/history-week.test.ts` (test, transform)

**Analog:** `tests/unit/history-week.test.ts`

**Imports pattern** (lines 1-13):
```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildHistoryWeek,
  buildHistoryWeekStats,
  getHistoryCalorieStatus,
  getHistorySportStatusMeta,
  getMondayWeekStart,
  isRealDateKey,
  selectSameWeekdayOrClosestAvailable,
  shiftHistoryWeek,
  type HistoryWeekDay,
} from "../../client/src/lib/history-week.js";
```

**Pending helper test pattern** (lines 64-88 and 184-204):
```ts
it("builds pending week days without fake nutrition values", () => {
  const days = buildHistoryWeek({
    weekStartKey: "2026-05-04",
    selectedDateKey: "2026-05-06",
    todayKey: "2026-05-06",
    trends: [],
    targets: { calories: 2000, protein: 100, carbs: 250, fat: 70 },
    pending: true,
  });

  assert.equal(days.length, 7);
  for (const day of days) {
    assert.equal(day.status, "pending");
    assert.equal(day.calories, null);
    assert.equal(day.mealCount, null);
    assert.equal(day.calorieRatio, null);
    assert.equal(day.waterLevel, 0);
  }

  const selectedDay = days.find((day) => day.dateKey === "2026-05-06");
  assert.ok(selectedDay);
  assert.equal(selectedDay.dateKey, "2026-05-06");
  assert.equal(selectedDay.isSelected, true);
  assert.equal(selectedDay.isToday, true);
});
```

```ts
it("builds pending weekly stats with neutral placeholders", () => {
  const days = buildHistoryWeek({
    weekStartKey: "2026-05-04",
    selectedDateKey: "2026-05-06",
    todayKey: "2026-05-06",
    trends: [],
    targets: { calories: 2000, protein: 100, carbs: 250, fat: 70 },
    pending: true,
  });

  assert.deepEqual(buildHistoryWeekStats({ days, averageCalories: null, pending: true }), {
    averageCalories: null,
    inRangeDays: null,
    loggedDays: null,
    mealCount: null,
  });

  const meta = getHistorySportStatusMeta({ status: "pending", targetCalories: 2000 });
  assert.equal(meta.barTone, "muted");
  assert.equal(meta.badge, null);
});
```

### `tests/harness/scenarios/77-history-loading-visual.mjs` (test/harness script, request-response + file-I/O)

**Analog:** `tests/harness/scenarios/49-history-dashboard-polish-visual.mjs`

**Script constants and artifact path pattern** (lines 1-26):
```js
#!/usr/bin/env node
import { access, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { spawn } from "node:child_process";

const SCENARIO = "49-history-dashboard-polish-visual";
const DEFAULT_OUTPUT_DIR = "tests/harness/artifacts/49-history-dashboard-polish/latest";
const ARTIFACT_ROOT = resolve("tests/harness/artifacts/49-history-dashboard-polish");
const DIST_ROOT = "dist/client";
const DIST_INDEX = "dist/client/index.html";
const MIN_SCREENSHOT_BYTES = 10000;
const CASES = [
  { id: "history-cache-miss-pending-mobile-390x844", width: 390, height: 844, stateCase: "cacheMissPending" },
  { id: "history-week-transition-mobile-390x844", width: 390, height: 844, stateCase: "weekTransition" },
  { id: "history-week-transition-narrow-360x780", width: 360, height: 780, stateCase: "weekTransition" },
];
```

Use Phase 77 names and artifact root, with the same safe output directory guard.

**Safe local server and browser pattern** (lines 46-55, 82-88, 102-140):
```js
async function findBrowser() {
  for (const candidate of BROWSER_CANDIDATES) {
    try {
      await access(candidate.path, constants.X_OK);
      return candidate;
    } catch {
      // Try the next installed browser.
    }
  }
  throw new Error("Google Chrome or Microsoft Edge executable is required for real browser screenshots.");
}
```

```js
function resolveSafeOutputDir(rawOutputDir) {
  const outputDir = resolve(rawOutputDir);
  if (outputDir === ARTIFACT_ROOT || !isPathInside(ARTIFACT_ROOT, outputDir)) {
    throw new Error(`Refusing unsafe output directory: ${rawOutputDir}`);
  }
  return outputDir;
}
```

```js
function startStaticServer() {
  const root = resolve(DIST_ROOT);
  const server = createServer(async (request, response) => {
    const requestUrl = new URL(request.url ?? "/", loopbackBase());
    const requestedPath = decodeURIComponent(requestUrl.pathname);
    const relativePath = requestedPath === "/" ? "index.html" : requestedPath.slice(1);
    const filePath = resolve(root, relativePath);

    if (!isPathInside(root, filePath) || hasDotfileSegment(relative(root, filePath))) {
      response.writeHead(403);
      response.end("forbidden");
      return;
    }
    // serve built dist/client files
  });
```

**Synthetic History fetch and delayed cold-week pattern** (lines 196-357):
```js
function phase49MockScript() {
  return `(() => {
    const fixedNow = new Date("2026-05-06T10:00:00+08:00");
    // Date override, localStorage seed, deterministic targets omitted for brevity
    const cachedWeek = {
      daily: [
        { date: "2026-05-04", calories: 1640, protein: 84, carbs: 190, fat: 48, mealCount: 3 },
        { date: "2026-05-05", calories: 1900, protein: 98, carbs: 222, fat: 54, mealCount: 3 },
        { date: "2026-05-06", calories: 820, protein: 52, carbs: 96, fat: 24, mealCount: 2 }
      ],
      averages: { calories: 1453, protein: 78, carbs: 169, fat: 42 }
    };
    const delayedWeek = {
      daily: [
        { date: "2026-04-27", calories: 1510, protein: 82, carbs: 174, fat: 46, mealCount: 2 },
        { date: "2026-04-28", calories: 1685, protein: 90, carbs: 186, fat: 50, mealCount: 3 }
      ],
      averages: { calories: 1598, protein: 86, carbs: 180, fat: 48 }
    };
```

```js
if (url.pathname === "/api/history/trends") {
  const from = url.searchParams.get("from");
  if (from === "2026-05-04") return Promise.resolve(jsonResponse(cachedWeek));
  if (from === "2026-04-27") {
    window.__phase49VisualState.cacheMissRequests += 1;
    return new Promise((resolve) => setTimeout(() => resolve(jsonResponse(delayedWeek)), 2400));
  }
}
if (url.pathname.startsWith("/api/history/days/")) {
  const dateKey = decodeURIComponent(url.pathname.split("/").at(-1));
  const snapshot = daySnapshots[dateKey] ?? { date: dateKey, summary: { date: dateKey, totalCalories: 0, totalProtein: 0, totalCarbs: 0, totalFat: 0, mealCount: 0 }, meals: [] };
  if (dateKey.startsWith("2026-04-")) {
    return new Promise((resolve) => setTimeout(() => resolve(jsonResponse(snapshot)), 2400));
  }
  return Promise.resolve(jsonResponse(snapshot));
}
```

**Interaction and inspection pattern** (lines 414-461 and 464-570):
```js
await send("Emulation.setDeviceMetricsOverride", {
  width,
  height,
  deviceScaleFactor: 1,
  mobile: width <= 500,
});
await send("Page.enable");
await send("Runtime.enable");
await send("Page.addScriptToEvaluateOnNewDocument", { source: phase49MockScript() });
await send("Page.navigate", { url });
await delay(1200);
```

```js
if (stateCase === "cacheMissPending" || stateCase === "weekTransition") {
  await send("Runtime.evaluate", {
    expression: `(() => {
      const buttons = [...document.querySelectorAll('button')];
      const previous = buttons.find((node) => node.getAttribute("aria-label") === "查看上一週");
      const next = buttons.find((node) => node.getAttribute("aria-label") === "查看下一週");
      const weekControl = previous || next;
      if (weekControl) {
        window.__phase49VisualState?.interactions?.push(
          previous ? "week-control:previous" : "week-control:next"
        );
        weekControl.click();
      }
    })()`,
  });
  await delay(stateCase === "weekTransition" ? 1000 : 160);
}
```

Add Phase 77-specific assertions inside the `Runtime.evaluate` inspection:
- `bodyText` does not include `載入這週紀錄中...`.
- `bodyText` includes `同步這天紀錄中...` during cold selected-day pending.
- header/date range reflects the target week, not the previous cached week.
- History node count is present, no horizontal overflow, screenshot is nonblank.

**Manifest/privacy pattern** (lines 639-649):
```js
const manifest = {
  scenario: SCENARIO,
  source: {
    distClient: DIST_ROOT,
    captureServer: "local loopback static HTTP server",
    deterministicMocks: ["meals", "history trends", "history days", "dailySummary.totalCalories"],
  },
  outputs,
  evidencePolicy: "real browser built UI screenshots; blank screen, low-diversity capture, undersized PNGs, empty body, and overlap risk are rejected",
  privacy: "static Phase 49 seed data only; explicit forbidden assertions block /api/chat, real /api/history calls outside mocks, external services, OPENAI_API_KEY, and raw user device IDs",
};
```

### `.planning/phases/77-history-loading-stabilization-and-local-proof-gate/77-VERIFICATION.md` or closure matrix artifact (planning/proof, batch)

**Analogs:** `tests/unit/home-dashboard-contract.test.ts`, `tests/unit/meal-edit-screen.test.ts`, `tests/integration/meals-api.test.ts`, `scripts/release-check.mjs`

**Home edit entry proof analog** (`tests/unit/home-dashboard-contract.test.ts` lines 185-208):
```ts
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
```

**Grouped Meal Edit source proof analog** (`tests/unit/meal-edit-screen.test.ts` lines 41-92, 149-203):
```ts
it("saves and deletes through canonical meal mutation helpers", () => {
  for (const expected of [
    "updateMeal",
    "deleteMeal",
    "MealRevisionConflictError",
    "refreshAfterMealMutation",
    "expectedMealRevisionId: payload.mealRevisionId",
    "confirm",
    "setDailySummary",
    "redactChatReceiptIdentity",
    "recordMealMutation",
    "redactChatReceiptIdentity(mealId)",
    'getMeals({ refreshReason: "meal_mutation" })',
    "setMeals",
    "recoverGuestSession",
  ]) {
    assert.match(source, escapedPattern(expected));
  }
});
```

```ts
it("replaces grouped-lock editing with grouped editor rows and controls", () => {
  for (const expected of [
    "GroupedMealEditor",
    "GroupedMealRow",
    "formatGroupedItemSummary",
    "sp-meal-edit-grouped-card",
    "sp-meal-edit-grouped-row",
    "sp-meal-edit-grouped-row-expanded",
    "sp-meal-edit-grouped-add",
    "sp-meal-edit-grouped-empty",
    "sp-meal-edit-grouped-final-delete-error",
    "新增項目",
    "儲存餐點",
    "找不到項目明細",
    "至少要保留一個項目；若要移除整筆餐點，請使用刪除餐點。",
  ]) {
    assert.match(source, escapedPattern(expected));
  }
});
```

**Grouped commit path analog** (`client/src/components/MealEditScreen.tsx` lines 486-508):
```tsx
const groupedItems = groupedDraft.buildGroupedMealUpdateItems(groupedDraftRows);
const response = await updateMeal(payload.mealId, {
  expectedMealRevisionId: payload.mealRevisionId,
  items: groupedItems,
});
try {
  await refreshAfterMealMutation({
    redactChatReceiptIdentity,
    recordMealMutation,
    setDailySummary,
    getMeals,
    setMeals,
    todayKey: () => formatLocalDate(new Date()),
  }, {
    mealId: payload.mealId,
    affectedDate: response.affectedDate,
    dailySummary: response.dailySummary,
  });
} catch {
  setError(GROUPED_REFRESH_FAILED_COPY);
  return;
}
onBack();
```

**Grouped CRUD integration proof analog** (`tests/integration/meals-api.test.ts` lines 120-136 and 549-699):
```ts
function assertMealMutationSummaryEnvelope(payload: unknown, affectedDate: string) {
  assert.ok(payload && typeof payload === "object");
  const envelope = payload as {
    source?: unknown;
    affectedDate?: unknown;
    summary?: { date?: unknown };
    summaryOutcome?: unknown;
    mealId?: unknown;
    mealRevisionId?: unknown;
  };
  assert.equal(envelope.source, "meal_mutation");
  assert.equal(envelope.affectedDate, affectedDate);
  assert.ok(envelope.summary && typeof envelope.summary === "object");
  assert.equal(envelope.summary.date, affectedDate);
  assert.equal(Object.prototype.hasOwnProperty.call(envelope, "summaryOutcome"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(envelope, "mealId"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(envelope, "mealRevisionId"), false);
}
```

```ts
const updateRes = await app.inject({
  method: "PATCH",
  url: `/api/meals/${meal.id}`,
  headers: { cookie: deviceCookieHeader },
  payload: {
    expectedMealRevisionId: meal.mealRevisionId,
    items: [
      { name: "蛋餅", position: 0, calories: 310, protein: 18, carbs: 32, fat: 12 },
      { name: "無糖豆漿", position: 1, calories: 120, protein: 9, carbs: 8, fat: 5 },
    ],
  },
});

assert.equal(updateRes.statusCode, 200);
assertFreshMealPatchResponse(updateRes.json(), {
  mealId: meal.id,
  previousMealRevisionId: meal.mealRevisionId,
  affectedDate,
  foodName: "蛋餅、無糖豆漿",
  itemCount: 2,
  calories: 430,
  protein: 27,
  carbs: 40,
  fat: 17,
});
assert.equal(publishedPayloads.length, 1);
assertMealMutationSummaryEnvelope(publishedPayloads[0], affectedDate);
```

**Shared refresh helper proof analog** (`client/src/meal-edit-refresh.ts` lines 18-37 and `tests/unit/meal-edit-refresh.test.ts` lines 51-115):
```ts
export async function refreshAfterMealMutation<Meal>(
  deps: RefreshAfterMealMutationDeps<Meal>,
  input: RefreshAfterMealMutationInput,
) {
  const today = deps.todayKey();

  deps.redactChatReceiptIdentity(input.mealId);
  deps.recordMealMutation(input.affectedDate);

  if (input.dailySummary?.date === today) {
    deps.setDailySummary(input.dailySummary);
  }

  if (input.affectedDate !== today) {
    return;
  }

  const { meals } = await deps.getMeals({ refreshReason: "meal_mutation" });
  deps.setMeals(meals);
}
```

```ts
it("does not set stale summaries or fetch rows for historical affected dates", async () => {
  const { calls, deps } = createDeps();

  await refreshAfterMealMutation(deps, {
    mealId: "meal-history-1",
    affectedDate: "2026-05-16",
    dailySummary: dailySummary("2026-05-16"),
  });

  assert.deepEqual(calls, [
    { name: "redact", mealId: "meal-history-1" },
    { name: "record", affectedDate: "2026-05-16" },
  ]);
});
```

## Shared Patterns

### Store Mutation Notice

**Source:** `client/src/store.ts` lines 83-96 and 177-183  
**Apply to:** `HistoryScreen`, `MealEditScreen`, Home/Meal Edit proof

```ts
lastMealMutation: MealMutationNotice | null;
openDayDetail: (payload: DayDetailPayload, origin?: PrimaryTab) => void;
openMealEdit: (payload: MealEditPayload, origin?: PrimaryTab) => void;
recordMealMutation: (affectedDate: string) => void;
```

```ts
recordMealMutation: (affectedDate) =>
  set((state) => ({
    lastMealMutation: {
      affectedDate,
      nonce: (state.lastMealMutation?.nonce ?? 0) + 1,
    },
  })),
```

### Error Handling

**Source:** `client/src/components/HistoryScreen.tsx` lines 47-50, 436-475  
**Apply to:** History trends/day requests

```ts
function historyErrorMessage(error: unknown): string {
  return error instanceof Error && error.message === "UNAUTHORIZED"
    ? "正在重新建立訪客狀態..."
    : "歷史資料暫時載入失敗。請稍後再試。";
}
```

```ts
.catch((error: unknown) => {
  if (error instanceof Error && error.message === "UNAUTHORIZED") {
    void recoverGuestSession();
  }
  if (!cancelledRef?.current) {
    setDayCache((cache) => {
      const next = new Map(cache);
      next.delete(requestDateKey);
      return next;
    });
    setDayError(historyErrorMessage(error));
  }
})
```

### Metadata-Only Evidence

**Source:** `docs/adr/0001-metadata-only-llm-failure-localization.md` lines 11-17 and Phase 49 script lines 639-649  
**Apply to:** Phase 77 visual script and closure matrix

Keep artifacts to command/status metadata, screenshot paths, viewport/assertion facts, and explicit privacy policy. Do not include raw prompts, user text, assistant final text, provider/tool payloads, image data, session material, private logs, database snapshots, or real local DB state.

### Verification Commands

**Source:** `AGENTS.md` and `77-RESEARCH.md` validation map  
**Apply to:** planner verification plan

- Any TypeScript edit: `yarn tsc --noEmit`
- Unit/source-contract edits: `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/history-screen-contract.test.ts tests/unit/history-week.test.ts tests/unit/meal-edit-refresh.test.ts`
- Representative v2.6 proof: `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/home-dashboard-contract.test.ts tests/unit/meal-edit-payload.test.ts tests/unit/meal-edit-refresh.test.ts tests/integration/meals-api.test.ts tests/unit/meal-edit-screen.test.ts tests/unit/meal-edit-grouped-draft.test.ts tests/unit/api-client.test.ts`
- Phase 77 visual script: command documented beside the new `.mjs` artifact/README; build first if using `dist/client`.
- Final local closure: `yarn release:check`

## No Analog Found

None. Every planned file or proof artifact has an exact or role-match analog. The only open planner discretion is the exact Phase 77 visual script path and closure matrix artifact filename.

## Metadata

**Analog search scope:** `client/src/components`, `client/src/lib`, `client/src/store.ts`, `client/src/meal-edit-refresh.ts`, `tests/unit`, `tests/integration`, `tests/harness/scenarios`, phase verification artifacts, project skills.  
**Files scanned:** 20+ via `rg`, targeted source reads, and phase context/research.  
**Pattern extraction date:** 2026-06-04
