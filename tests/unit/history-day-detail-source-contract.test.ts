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

function escapedPattern(value: string) {
  return new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
}

describe("History Day Detail source contract", () => {
  it("refreshes an open detail view only for matching historical meal mutations", async () => {
    const dayDetail = await readSource("../../client/src/components/HistoryDayDetailScreen.tsx");

    assert.match(dayDetail, /const lastMealMutation = useStore\(\(s\) => s\.lastMealMutation\)/);
    assert.match(dayDetail, /lastMealMutation\?\.affectedDate !== dateKey/);
    assert.match(dayDetail, /lastMealMutation\?\.nonce/);
    assert.match(dayDetail, /getHistoryDaySnapshot\(requestDateKey\)/);
    assert.match(dayDetail, /const requestDateKey = dateKey/);
    assert.match(dayDetail, /cancelledRef\?\.current/);
    assert.match(dayDetail, /return \(\) => \{\s*cancelledRef\.current = true;\s*\}/);

    assert.doesNotMatch(dayDetail, /setDailySummary/);
    assert.doesNotMatch(dayDetail, /setMeals/);
    assert.doesNotMatch(dayDetail, /\bgetMeals\(/);
    assert.doesNotMatch(dayDetail, /summaryOutcome|onDailySummaryEnvelope|runInitialMealsLoad/);
  });

  it("does not add stale or freshness indicators to the read-only detail UI", async () => {
    const dayDetail = await readSource("../../client/src/components/HistoryDayDetailScreen.tsx");

    for (const rejected of [
      "stale",
      "freshness",
      "fresh",
      "過期",
      "不同步",
      "重新整理中",
      "即時同步",
      "資料已更新",
      "資料可能不是最新",
    ]) {
      assert.doesNotMatch(dayDetail, escapedPattern(rejected));
    }
  });

  it("keeps sport detail structure while retaining read-only snapshot behavior", async () => {
    const [dayDetail] = await Promise.all([readSource("../../client/src/components/HistoryDayDetailScreen.tsx")]);

    for (const expected of [
      "sp-history-detail-screen",
      "sp-history-detail-summary",
      "sp-history-detail-header",
      "sp-history-detail-calories",
      "sp-history-detail-meal",
      "sp-history-detail-meal-image",
      "sp-history-detail-summary-copy",
      "sp-history-detail-progress",
      "sp-history-detail-note",
      "sp-history-detail-empty",
      "sp-history-detail-error",
      "PersistedAssetImage",
      "src={meal.imageUrl}",
      "isToday",
      "setHighlightedMealId",
      "targetMealId",
      "歷史快照",
      "今天 · 即時",
      "<span>蛋白質</span>",
      "<span>碳水</span>",
      "<span>脂肪</span>",
      "totalProtein",
      "meal.protein",
      "summary?.totalCarbs",
      "summary?.totalFat",
    ]) {
      assert.match(dayDetail, escapedPattern(expected));
    }

    for (const rejected of [
      "<span>protein</span>",
      "<span>carbs</span>",
      "<span>fat</span>",
      "<strong>P {",
      "<strong>C {",
      "<strong>F {",
    ]) {
      assert.doesNotMatch(dayDetail, escapedPattern(rejected));
    }

    assert.match(
      dayDetail,
      /<PersistedAssetImage[\s\S]*src=\{meal\.imageUrl\}[\s\S]*imgClassName="sp-history-detail-meal-image"[\s\S]*fallbackClassName="sp-history-detail-meal-image sp-history-detail-meal-fallback"/,
    );
  });
});
