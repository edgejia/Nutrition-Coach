import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

async function readSource(relativePath: string) {
  return readFile(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

const detailSource = await readSource("../../client/src/components/HistoryDayDetailScreen.tsx");
const mainLayoutSource = await readSource("../../client/src/components/MainLayout.tsx");

function escapedPattern(text: string) {
  return new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
}

describe("History Day Detail source contract", () => {
  it("loads and presents read-only day detail data", () => {
    for (const expected of [
      "getHistoryDaySnapshot",
      "targetMealId",
      "scrollIntoView",
      "歷史快照",
      "今天 · 即時",
      "當日餐點",
      "這是歷史快照，不會覆蓋今天的即時狀態。",
      "protein",
      "carbs",
      "fat",
      "PersistedAssetImage",
      "getHistoryCalorieStatus",
      "history-day-summary",
      "history-day-status-badge",
      "history-day-progress",
      "history-day-macros",
      "偏低",
      "略低",
      "達標範圍",
      "超標",
      "明顯超標",
      "目標同步中，暫不顯示水位",
      "歷史日 read-only；要修改請回到對話用自然語言描述。",
      "今天 · 即時；此頁仍維持只讀。",
    ]) {
      assert.match(detailSource, escapedPattern(expected));
    }
  });

  it("does not expose edit, delete, save, correction, or live-summary mutation controls", () => {
    for (const rejected of [
      "deleteMeal",
      "onDelete",
      "調整",
      "刪除",
      "儲存",
      "不對",
      "新增餐點",
      "跳到",
      "date picker",
      'openSecondaryScreen("mealEdit"',
      "setDailySummary",
      "setMeals",
    ]) {
      assert.doesNotMatch(detailSource, escapedPattern(rejected));
    }
  });

  it("is wired into MainLayout instead of the placeholder", () => {
    assert.match(mainLayoutSource, /HistoryDayDetailScreen/);
    assert.doesNotMatch(mainLayoutSource, /Day Detail shell/);
  });
});
