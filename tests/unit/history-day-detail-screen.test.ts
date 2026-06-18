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
      "這是當日營養快照。",
      "今天的資料會隨記錄更新。",
      "<span>蛋白質</span>",
      "<span>碳水</span>",
      "<span>脂肪</span>",
      "totalProtein",
      "meal.protein",
      "summary?.totalCarbs",
      "summary?.totalFat",
      "PersistedAssetImage",
      "sp-history-detail-screen",
      "sp-history-detail-summary",
      "sp-history-detail-macros",
      "sp-history-detail-meal",
      "目標同步中，暫不顯示水位",
    ]) {
      assert.match(detailSource, escapedPattern(expected));
    }

    for (const rejected of [
      "<span>protein</span>",
      "<span>carbs</span>",
      "<span>fat</span>",
      "<strong>P {",
      "<strong>C {",
      "<strong>F {",
    ]) {
      assert.doesNotMatch(detailSource, escapedPattern(rejected));
    }
  });

  it("keeps Day Detail meal thumbnails on the 48px meal.imageUrl source pattern", () => {
    assert.match(
      detailSource,
      /<PersistedAssetImage[\s\S]*src=\{meal\.imageUrl\}[\s\S]*imgClassName="sp-history-detail-meal-image"[\s\S]*fallbackClassName="sp-history-detail-meal-image sp-history-detail-meal-fallback"/,
    );
    assert.match(detailSource, /alt=\{`\$\{meal\.foodName\} 縮圖`\}/);
  });

  it("renders Day Detail meal metadata with resolved meal-period labels", () => {
    assert.match(detailSource, /import \{ formatMealRowTime, getDisplayMealLabel \} from "\.\/HomeScreen\.js";/);
    assert.match(detailSource, /\{formatMealRowTime\(meal\.loggedAt\)\} · \{getDisplayMealLabel\(meal\.mealPeriod, meal\.loggedAt\)\}/);
    assert.doesNotMatch(detailSource, /new Intl\.DateTimeFormat\("zh-TW", \{ hour: "2-digit", minute: "2-digit", hour12: false \}\)\.format\(\s*new Date\(meal\.loggedAt\),\s*\)/);
  });

  it("NAV-02 exposes one focused eligible Day Detail edit handoff", () => {
    for (const expected of [
      "buildMealEditPayloadIfComplete",
      "openMealEdit(editPayload, \"history\"",
      "returnToDayDetail",
      "targetMealId === meal.id",
      "sp-history-detail-edit",
      "編輯餐點：",
      "SportIconButton",
      "SportEditIcon",
    ]) {
      assert.match(detailSource, escapedPattern(expected), `NAV-02 focused Day Detail edit must include ${expected}`);
    }

    assert.doesNotMatch(
      detailSource,
      /highlightedMealId === meal\.id[\s\S]{0,240}(?:openMealEdit|sp-history-detail-edit|編輯餐點)/,
      "NAV-02 edit visibility must use targetMealId, not highlightedMealId",
    );
  });

  it("NAV-02 keeps Day Detail destructive controls confined to Meal Edit", () => {
    for (const rejected of [
      "deleteMeal",
      "handleDelete",
      "window.confirm",
      "onDelete",
      "調整",
      "刪除",
      "儲存",
      "新增餐點",
      "date picker",
      "setDailySummary",
      "setMeals",
    ]) {
      assert.doesNotMatch(detailSource, escapedPattern(rejected), `NAV-02 Day Detail must not expose ${rejected}`);
    }
  });

  it("NAV-02 does not add disabled edit guidance for valid read-only snapshots", () => {
    for (const rejected of ["找不到項目明細", "無法編輯", "暫時不能編輯", "請重新整理後再編輯", "disabled"]) {
      assert.doesNotMatch(detailSource, escapedPattern(rejected), `NAV-02 read-only snapshot should not show ${rejected}`);
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
