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
  it("loads and presents the sport read-only day snapshot", () => {
    for (const expected of [
      "SportScreen",
      "SportCard",
      "SportChip",
      "SportProgressBar",
      "getHistoryDaySnapshot",
      "recoverGuestSession",
      "targetMealId",
      "scrollIntoView",
      "getHistoryCalorieStatus",
      "getHistorySportStatusMeta",
      "歷史快照",
      "今天 · 即時",
      "當日餐點",
      "這是當日營養快照；點選歷史中的餐點可修改內容。",
      "今天的資料會隨記錄更新；此頁仍維持只讀檢視。",
      "protein",
      "carbs",
      "fat",
      "PersistedAssetImage",
      "sp-history-detail-screen",
      "sp-history-detail-summary",
      "sp-history-detail-macros",
      "sp-history-detail-meal",
      "目標同步中，暫不顯示水位",
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
      "新增餐點",
      "date picker",
      "openMealEdit",
      "setDailySummary",
      "setMeals",
    ]) {
      assert.doesNotMatch(detailSource, escapedPattern(rejected));
    }
  });

  it("rejects obsolete sketch-era no-edit copy", () => {
    assert.doesNotMatch(
      detailSource,
      escapedPattern("歷史日 read-only；要修改請回到對話用自然語言描述。"),
    );
  });

  it("is wired into MainLayout instead of the placeholder", () => {
    assert.match(mainLayoutSource, /HistoryDayDetailScreen/);
    assert.doesNotMatch(mainLayoutSource, /Day Detail shell/);
  });
});
