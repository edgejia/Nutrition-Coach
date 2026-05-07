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
      "載入這週紀錄中...",
      "載入這天餐點中...",
      "這天還沒有餐點",
      "選擇其他日期，或到「對話」記錄今天吃了什麼。",
      "目標同步中，暫不顯示目標比較。",
      "歷史資料暫時載入失敗。請稍後再試。",
    ]) {
      assert.match(source, escapedPattern(expected));
    }
  });

  it("opens Meal Edit from meal rows with complete History-origin payload", () => {
    for (const expected of [
      "buildHistoryMealEditPayload",
      "openMealEdit",
      "event.stopPropagation()",
      "buildHistoryMealEditPayload(meal, selectedDateKey)",
      '"history"',
    ]) {
      assert.match(source, escapedPattern(expected));
    }
  });

  it("renders History timeline thumbnails from meal-level imageUrl inside the row target", () => {
    for (const expected of [
      'import { PersistedAssetImage } from "./PersistedAssetImage.js";',
      "sp-history-meal-media",
      "sp-history-meal-image",
      "sp-history-meal-fallback",
      "meal.imageUrl",
      "無照片",
      "buildHistoryMealEditPayload(meal, selectedDateKey)",
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
    assert.match(source, /\{formatMealRowTime\(meal\.loggedAt\)\}/);
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

  it("reserves weekly loading copy for true first load only", () => {
    assert.match(source, /loadingTrends/);
    assert.match(
      source,
      /loadingTrends && !hasCurrentWeekCache|loadingTrends && !trendsCache\.get\(weekStartKey\)|const hasCurrentWeekCache = Boolean\(trendsCache\.get\(weekStartKey\)\)/,
    );
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
  });

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

  it("keeps History free of demo globals, demo labels, and inline mutation controls", () => {
    for (const rejected of [
      "AVG",
      "ON·TGT",
      "STREAK",
      "SP_WEEK",
      "SP_HIST_MEALS",
      "window.",
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
