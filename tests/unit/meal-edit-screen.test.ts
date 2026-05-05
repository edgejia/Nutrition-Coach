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
  it("renders the required sport meal edit structure and copy", () => {
    for (const expected of [
      "SportScreen",
      "SportCard",
      "SportIconButton",
      "SportChevronLeftIcon",
      "編輯餐點",
      "AI 估算 · 點任一欄位調整",
      "修改會建立新 revision",
      "刪除這筆餐點？這會建立刪除 revision。",
      "整餐照片",
      "這張照片代表整餐，不是單一食物裁切。",
      "尚未附上餐點照片",
      "這筆餐點是文字記錄，仍可編輯名稱與營養數值。",
      "圖片載入失敗，餐點資料仍可編輯。請稍後再試。",
      "取消",
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
      "confirm",
      "setDailySummary",
      "recordMealMutation",
      'getMeals({ refreshReason: "meal_mutation" })',
      "setMeals",
      "recoverGuestSession",
    ]) {
      assert.match(source, escapedPattern(expected));
    }
  });

  it("does not keep sketch primitives or introduce out-of-scope image replacement", () => {
    for (const rejected of [
      'from "./SketchPrimitives.js"',
      "SketchScreen",
      "SketchSoftBox",
      "SketchDashedBox",
      "SketchButton",
      "更換照片",
      "上傳照片",
      "OCR",
      "items.map",
    ]) {
      assert.doesNotMatch(source, escapedPattern(rejected));
    }
  });

  it("rejects blank nutrition fields before numeric conversion", () => {
    assert.match(source, /rawValues\.some\(\(value\) => value\.trim\(\) === ""\)/);
    assert.match(source, /const \[calories, protein, carbs, fat\] = rawValues\.map\(Number\)/);
  });

  it("frames persisted images as whole-meal media and preserves image identity", () => {
    assert.match(source, /alt=\{`\$\{payload\.foodName\} 整餐照片`\}/);
    assert.match(source, /imageAssetId:\s*payload\.imageAssetId \?\? null/);
  });
});
