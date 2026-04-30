import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const historyScreenPath = fileURLToPath(new URL("../../client/src/components/HistoryScreen.tsx", import.meta.url));
const source = await readFile(historyScreenPath, "utf8");

function countPrimaryScrollHelpers(value: string) {
  return value.match(/\bscreen-scroll(?:-with-input|-safe)?\b/g)?.length ?? 0;
}

describe("History screen source contract", () => {
  it("uses trend-backed History data and Day Detail routing", () => {
    for (const expected of [
      "getHistoryTrends",
      "getHistoryDaySnapshot",
      "buildHistoryWeek",
      "openDayDetail",
      "查看上一週",
      "查看下一週",
      "歷史快照",
      "今天 · 即時",
      "這天還沒有餐點",
      "到「對話」描述你吃了什麼，AI 會幫你記錄。",
      "waterLevel",
      "calorieStatus",
      "目標同步中，暫不顯示水位",
      "history-week-water-box",
      "history-week-water-fill",
      "history-timeline",
      "history-timeline-node",
      "history-timeline-rail",
      "history-timeline-meal",
      "history-timeline-panel",
      "history-timeline-panel-header",
      "onTimelineOpen",
      "role=\"button\"",
      "tabIndex={0}",
      "event.target !== event.currentTarget",
      "targetMealId",
      "onTimelineOpen(meal.id)",
      "event.stopPropagation()",
    ]) {
      assert.match(source, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
  });

  it("keeps History read-only and Chat-only for logging", () => {
    for (const rejected of [
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
    ]) {
      assert.doesNotMatch(source, new RegExp(rejected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
  });

  it("keeps one primary scroller", () => {
    assert.equal(countPrimaryScrollHelpers(source), 1);
  });
});
