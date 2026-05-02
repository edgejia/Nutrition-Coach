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
      "openMealEdit",
      "event.stopPropagation()",
      "mealId: meal.id",
      "dateKey: selectedDateKey",
      "foodName: meal.foodName",
      "calories: meal.calories",
      "protein: meal.protein",
      "carbs: meal.carbs",
      "fat: meal.fat",
      "imageAssetId: meal.imageAssetId",
      "imageUrl: meal.imageUrl",
      "loggedAt: meal.loggedAt",
      '"history"',
    ]) {
      assert.match(source, escapedPattern(expected));
    }
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

  it("keeps one primary scroller", () => {
    assert.equal(countPrimaryScrollHelpers(source), 1);
  });
});
