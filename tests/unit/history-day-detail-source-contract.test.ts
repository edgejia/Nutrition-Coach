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
      "sp-history-detail-summary-copy",
      "sp-history-detail-progress",
      "sp-history-detail-note",
      "sp-history-detail-empty",
      "sp-history-detail-error",
      "isToday",
      "setHighlightedMealId",
      "targetMealId",
      "歷史快照",
      "今天 · 即時",
    ]) {
      assert.match(dayDetail, escapedPattern(expected));
    }
  });
});
