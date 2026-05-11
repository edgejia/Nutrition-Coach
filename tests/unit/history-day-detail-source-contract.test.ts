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
