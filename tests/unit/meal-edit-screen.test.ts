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
      "修改後會保留原始紀錄。",
      "刪除這筆餐點？系統會保留歷史紀錄。",
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
      "redactChatReceiptIdentity",
      "recordMealMutation",
      "redactChatReceiptIdentity(mealId)",
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

  it("locks direct editing for grouped Meal Edit payloads and points users to chat correction", () => {
    const groupedPayloadFixture = {
      foodName: "雞腿、白飯、青菜",
      itemCount: 3,
    };
    assert.equal(groupedPayloadFixture.itemCount, 3);

    assert.match(source, /payload\.itemCount\s*>\s*1/);
    assert.match(source, escapedPattern("組合餐點"));
    assert.match(source, escapedPattern("這筆是組合餐點"));
    assert.match(source, /包含 \{payload\.itemCount\} 項：\{payload\.foodName\}/);
    assert.match(source, /payload\.items/);
    assert.match(source, escapedPattern("sp-meal-edit-grouped-items"));
    assert.match(source, escapedPattern("sp-meal-edit-grouped-item-name"));
    assert.match(source, escapedPattern("sp-meal-edit-grouped-item-macros"));
    assert.match(source, escapedPattern("熱量"));
    assert.match(source, escapedPattern("蛋白質"));
    assert.match(source, escapedPattern("碳水"));
    assert.match(source, escapedPattern("脂肪"));
    assert.match(source, escapedPattern("避免把多項餐點合併成一項"));
    assert.match(source, escapedPattern("到對話修正"));
    assert.match(source, escapedPattern("MULTI_ITEM_UPDATE_ERROR_CODE"));
    assert.match(source, escapedPattern("這筆餐點包含多個項目，請到「對話」修正，避免把多項餐點合併成單一餐點。"));
    assert.match(source, escapedPattern("closeSecondaryScreen"));
    assert.match(source, escapedPattern('setActiveScreen("chat")'));
    assert.match(source, /if \(!payload\) \{[\s\S]+?if \(payload\.itemCount\s*>\s*1\) \{[\s\S]+?if \(!draft\) \{/);

    const groupedBranch = source.match(/if \(payload\.itemCount\s*>\s*1\) \{[\s\S]+?sp-meal-edit-grouped-primary[\s\S]+?\n\s*\);\n\s*\}/)?.[0] ?? "";
    assert.match(groupedBranch, escapedPattern("sp-meal-edit-grouped-lock"));
    assert.match(groupedBranch, /payload\.items\.map/);
    assert.doesNotMatch(groupedBranch, escapedPattern("儲存"));
    assert.doesNotMatch(groupedBranch, /<input\b/);
    assert.doesNotMatch(groupedBranch, /sp-meal-edit-macro-field/);
    assert.doesNotMatch(groupedBranch, escapedPattern("刪除"));
  });
});
