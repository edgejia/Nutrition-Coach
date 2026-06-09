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

function countPrimaryScrollHelpers(value: string) {
  return value.match(/\bscreen-scroll(?:-with-input|-safe)?\b/g)?.length ?? 0;
}

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

  it("renders locked Traditional Chinese sport History copy", () => {
    for (const expected of [
      "本週",
      "查看上一週",
      "查看下一週",
      "平均熱量",
      "達標天數",
      "紀錄餐數",
      "當日餐點",
      "開啟當日詳情",
      "同步這天紀錄中...",
      "這天還沒有餐點",
      "選擇其他日期，或到「對話」記錄今天吃了什麼。",
      "目標同步中，暫不顯示目標比較。",
      "歷史資料暫時載入失敗。請稍後再試。",
    ]) {
      assert.match(source, escapedPattern(expected));
    }
  });

  it("NAV-01 opens History meal rows as read-only Day Detail targets", () => {
    for (const expected of [
      "openDayDetail",
      "event.stopPropagation()",
      "targetMealId: meal.id",
      "openDayDetail({ dateKey: selectedDateKey, targetMealId: meal.id, label }, \"history\")",
      "開啟餐點詳情",
      '"history"',
    ]) {
      assert.match(source, escapedPattern(expected), `NAV-01 History row entry must include ${expected}`);
    }

    assert.doesNotMatch(
      source,
      /function onMealOpen[\s\S]*openMealEdit/,
      "NAV-01 History row tap must not call openMealEdit directly",
    );
    assert.doesNotMatch(
      source,
      escapedPattern("buildHistoryMealEditPayload(meal, selectedDateKey)"),
      "NAV-01 History row tap must reject buildHistoryMealEditPayload(meal, selectedDateKey)",
    );
    assert.doesNotMatch(
      source,
      /aria-label=\{`編輯/,
      "NAV-01 History row aria-label must not begin with 編輯",
    );
  });

  it("renders History timeline thumbnails from meal-level imageUrl inside the row target", () => {
    for (const expected of [
      'import { PersistedAssetImage } from "./PersistedAssetImage.js";',
      "sp-history-meal-media",
      "sp-history-meal-image",
      "sp-history-meal-fallback",
      "meal.imageUrl",
      "無照片",
      "開啟餐點詳情",
    ]) {
      assert.match(source, escapedPattern(expected));
    }

    assert.match(
      source,
      /<button[\s\S]*className="sp-history-meal-row"[\s\S]*<span className="sp-history-meal-media">[\s\S]*<PersistedAssetImage[\s\S]*src=\{meal\.imageUrl\}[\s\S]*imgClassName="sp-history-meal-image"[\s\S]*fallbackClassName="sp-history-meal-fallback"[\s\S]*<\/button>/,
    );
    assert.doesNotMatch(source, /<button[^>]*sp-history-meal-media|<a[^>]*sp-history-meal-media/);
  });

  it("keeps History timeline media and fallback slots at fixed 32px dimensions", () => {
    assert.match(
      cssSource,
      /\.sp-history-meal-media\s*\{[\s\S]*?width:\s*32px;[\s\S]*?height:\s*32px;[\s\S]*?flex:\s*0 0 32px;[\s\S]*?\}/,
    );

    for (const expected of [".sp-history-meal-image", ".sp-history-meal-fallback"]) {
      assert.match(cssSource, escapedPattern(expected));
    }
  });

  it("sorts timeline meals from morning to night and hides meal-period tags", () => {
    assert.match(source, /\[\.\.\.meals\]\.sort\(\s*\(\s*left,\s*right\s*\) => new Date\(left\.loggedAt\)\.getTime\(\) - new Date\(right\.loggedAt\)\.getTime\(\)/);
    assert.match(source, /sortedMeals\.map\(\(meal\) =>/);
    assert.match(source, /import \{ formatMealRowTime, getDisplayMealLabel, getMealMacroSummary \} from "\.\/HomeScreen\.js";/);
    assert.match(source, /\{formatMealRowTime\(meal\.loggedAt\)\} · \{getDisplayMealLabel\(meal\.mealPeriod, meal\.loggedAt\)\}/);
    assert.match(
      source,
      /aria-label=\{`開啟餐點詳情：\$\{meal\.foodName\}`\}/,
      "NAV-01 History row accessible label must describe detail browsing",
    );
    assert.doesNotMatch(source, /getDisplayMealLabel\(meal\.loggedAt\)/);
    assert.match(source, /\{displayMealCount === null \? "--" : displayMealCount\}筆/);
    assert.doesNotMatch(source, /\{meals\.length\} entries/);
  });

  it("keeps day-level History activation routed to Day Detail", () => {
    for (const expected of [
      "openDayDetail",
      'aria-label="開啟當日詳情"',
      "role=\"button\"",
      "tabIndex={0}",
      "event.target !== event.currentTarget",
      '"history"',
    ]) {
      assert.match(source, escapedPattern(expected));
    }
  });

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

  it("keeps cold week switches in target context with inline pending placeholders", () => {
    assert.match(source, /loadingTrends/);
    assert.match(
      source,
      /buildHistoryWeek\(\{\s*weekStartKey,[\s\S]*?selectedDateKey,[\s\S]*?pending: !hasCurrentWeekCache,[\s\S]*?\}\)/,
    );
    assert.match(
      source,
      /buildHistoryWeekStats\(\{\s*days: weekDays,[\s\S]*?pending: !hasCurrentWeekCache,[\s\S]*?\}\)/,
    );
    assert.doesNotMatch(source, /loadingTrends && !hasCurrentWeekCache[\s\S]{0,240}載入這週紀錄中\.\.\./);
    assert.doesNotMatch(source, /載入這週紀錄中\.\.\./);
    assert.doesNotMatch(source, /previousSnapshot|previousDate/);
    assert.doesNotMatch(source, /previous(?:Rows|Meals|WeekRows|DayRows|MealRows|SnapshotRows|DateRows)/);
    assert.doesNotMatch(source, /skeleton|placeholderMeal|pendingMealRows|disabledMealRows/i);
  });

  it("wires cache-hit weekly revalidation to neutral pending treatment", () => {
    assert.match(source, /const isWeekPending = loadingTrends && hasCurrentWeekCache/);
    assert.match(source, /className=\{isWeekPending \? "sp-history-weekly sp-history-pending" : "sp-history-weekly"\}/);
    assert.match(cssSource, /\.sp-history-pending::before\s*\{[\s\S]*?height:\s*1px;[\s\S]*?background:\s*var\(--sp-line-strong\)/);
    assert.doesNotMatch(cssSource, /\.sp-history-pending[\s\S]*animation:/);
  });

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
    assert.doesNotMatch(source, /setDayCache\(\(\) => new Map\(\)\)/);
    assert.doesNotMatch(source, /setDayCache\(new Map\(\)\)/);
    assert.doesNotMatch(source, /setTrendsCache\(\(\) => new Map\(\)\)/);
    assert.doesNotMatch(source, /setTrendsCache\(new Map\(\)\)/);
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

  it("keeps selected-day pending, empty, and detail activation snapshot-backed", () => {
    for (const expected of [
      "hasSelectedDaySnapshot",
      "selectedDaySnapshotPending",
      "confirmedEmptyDay",
      "showInlineDayPending",
      "openConfirmedEmptyDayDetail",
      "同步這天紀錄中...",
    ]) {
      assert.match(source, escapedPattern(expected));
    }

    assert.match(source, /const hasSelectedDaySnapshot = selectedSnapshot !== null/);
    assert.match(source, /const selectedDaySnapshotPending = selectedSnapshot === null && !dayError/);
    assert.match(source, /const confirmedEmptyDay = selectedSnapshot !== null && selectedSnapshot\.meals\.length === 0/);
    assert.match(
      source,
      /const showInlineDayPending =[\s\S]*selectedDaySnapshotPending[\s\S]*loadingDay[\s\S]*!dayError[\s\S]*delayedInlineDayPending/,
    );
    assert.match(source, /openConfirmedEmptyDayDetail[\s\S]*confirmedEmptyDay[\s\S]*openDayDetail/);
    assert.doesNotMatch(source, /selectedWeekDay\.mealCount === 0[\s\S]*這天還沒有餐點/);
    assert.doesNotMatch(source, /displayMealCount === 0 && meals\.length === 0/);
    assert.doesNotMatch(source, /selectedDayMealCount === 0[\s\S]*openDayDetail/);
  });

  it("suppresses fast selected-day pending copy while preserving longer cold-load copy", () => {
    for (const expected of [
      "DAY_PENDING_COPY_DELAY_MS",
      "delayedInlineDayPending",
      "setDelayedInlineDayPending",
      "inlineDayPendingTimerRef",
      "window.setTimeout",
      "window.clearTimeout",
      "同步這天紀錄中...",
    ]) {
      assert.match(source, escapedPattern(expected));
    }

    assert.match(source, /const DAY_PENDING_COPY_DELAY_MS = (18\d|19\d|2[0-4]\d|250)/);
    assert.match(source, /useState\(false\)/);
    assert.match(source, /useRef<number \| null>\(null\)/);
    assert.match(source, /window\.setTimeout\(\(\) => \{[\s\S]*setDelayedInlineDayPending\(true\)/);
    assert.match(source, /DAY_PENDING_COPY_DELAY_MS/);
    assert.match(source, /window\.clearTimeout\(inlineDayPendingTimerRef\.current\)/);
    assert.match(source, /setDelayedInlineDayPending\(false\)/);
    assert.match(
      source,
      /const showInlineDayPending =[\s\S]*selectedDaySnapshotPending[\s\S]*loadingDay[\s\S]*!dayError[\s\S]*delayedInlineDayPending/,
    );
    assert.match(
      source,
      /if \(!selectedDaySnapshotPending \|\| !loadingDay \|\| dayError\) \{[\s\S]*setDelayedInlineDayPending\(false\)/,
    );
    assert.match(source, /selectedDateKey/);

    assert.doesNotMatch(source, /const showInlineDayPending = selectedDaySnapshotPending && !dayError/);
    assert.doesNotMatch(source, /const showInlineDayPending = selectedSnapshot === null && !dayError/);
    assert.doesNotMatch(source, /const showInlineDayPending = !hasSelectedDaySnapshot && !dayError/);
  });

  it("uses day snapshots as the only timeline row and Meal Edit authority", () => {
    assert.match(source, /const meals = snapshot\?\.meals \?\? \[\]/);
    assert.match(source, /snapshot !== null && meals\.length > 0[\s\S]*<TimelineRows[\s\S]*meals=\{meals\}/);
    assert.match(source, /openDayDetail[\s\S]*targetMealId: meal\.id/);
    assert.doesNotMatch(source, /function TimelinePanel[\s\S]*selectedWeekDay[\s\S]*<TimelineRows/);
    assert.doesNotMatch(source, /function TimelinePanel[\s\S]*selectedDayMealCount[\s\S]*<TimelineRows/);
    assert.doesNotMatch(source, /trends(?:Cache|\.daily|\.averages)[\s\S]*buildHistoryMealEditPayload/);
  });

  it("preserves selected-day hero display from same-date week cache while timeline facts stay snapshot-backed", () => {
    assert.match(source, /const selectedWeekDay = weekDays\.find\(\(day\) => day\.dateKey === selectedDateKey\)/);
    assert.match(
      source,
      /const hasSelectedWeekDayDisplay =[\s\S]*selectedWeekDay\?\.status !== "pending"[\s\S]*selectedWeekDay\?\.calories !== null[\s\S]*selectedWeekDay\?\.mealCount !== null/,
    );
    assert.match(source, /const hasSelectedDayDisplay = hasSelectedDaySnapshot \|\| hasSelectedWeekDayDisplay/);
    assert.match(source, /const isSelectedDayCacheMiss = !hasSelectedDayDisplay/);
    assert.match(source, /const displayCalories = snapshot\?\.summary\.totalCalories \?\? selectedDayCalories/);
    assert.match(source, /const displayMealCount = snapshot === null \? null : meals\.length/);
    assert.match(source, /<span>\{displayMealCount === null \? "--" : displayMealCount\}筆<\/span>/);
    assert.match(source, /meals=\{meals\}/);
    assert.doesNotMatch(source, /snapshot === null \? previous|previousSnapshot|previousDate/);
  });

  it("keeps History free of demo globals, demo labels, and inline mutation controls", () => {
    for (const rejected of [
      "AVG",
      "ON·TGT",
      "STREAK",
      "SP_WEEK",
      "SP_HIST_MEALS",
      "ui_kits/sport",
      "ChatEntryBar",
      "screen-scroll-with-input",
      "新增餐點",
      "補記",
      "記錄餐點",
      "調整",
      "刪除",
      "儲存",
      "不對",
      "蛋白/碳水/脂肪",
      "deleteMeal",
      "onDelete",
      "跳到",
      "date picker",
      "setDailySummary",
      "setMeals",
      "recordMealMutation(",
    ]) {
      assert.doesNotMatch(source, escapedPattern(rejected));
    }
  });

  it("defines Phase 41 History sport CSS classes", () => {
    for (const expected of [
      "sp-history-screen",
      "sp-history-week-strip",
      "sp-history-stat-grid",
      "sp-history-hero",
      "sp-history-timeline",
      "sp-history-meal-row",
      "@media (max-width: 360px)",
    ]) {
      assert.match(cssSource, escapedPattern(expected));
    }
  });

  it("highlights today without rendering a 今天 label in the week strip", () => {
    assert.doesNotMatch(source, /sp-history-week-today|>今天<\/span>/);
    assert.match(cssSource, /\.sp-history-week-day\[data-selected="false"\]\[data-today="true"\] \.sp-history-week-track/);
    assert.doesNotMatch(cssSource, /\.sp-history-week-today/);
  });

  it("keeps one primary scroller", () => {
    assert.equal(countPrimaryScrollHelpers(source), 1);
  });
});
