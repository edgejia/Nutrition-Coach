import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

async function readSource(relativePath: string) {
  return readFile(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

const source = await readSource("../../client/src/components/MealEditScreen.tsx");

function escapedPattern(text: string) {
  return new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
}

describe("Meal Edit source contract", () => {
  it("renders the required meal edit structure and copy", () => {
    for (const expected of [
      "編輯餐點",
      "AI 估算 · 點任一欄位調整",
      "修改會建立新 revision",
      "刪除",
      "儲存",
      "PersistedAssetImage",
    ]) {
      assert.match(source, escapedPattern(expected));
    }
  });

  it("saves and deletes through canonical meal mutation helpers", () => {
    for (const expected of [
      "updateMeal",
      "deleteMeal",
      "Delete",
      "confirm",
      "setDailySummary",
      "recordMealMutation",
      "getMeals",
      "setMeals",
    ]) {
      assert.match(source, escapedPattern(expected));
    }
  });

  it("does not introduce out-of-scope item editing or image replacement", () => {
    for (const rejected of ["新增食材", "更換照片", "OCR", "items.map"]) {
      assert.doesNotMatch(source, escapedPattern(rejected));
    }
  });
});
