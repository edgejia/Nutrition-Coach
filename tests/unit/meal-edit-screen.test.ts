import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

async function readSource(relativePath: string) {
  return readFile(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

const source = await readSource("../../client/src/components/MealEditScreen.tsx");
const summaryDetailSource = await readSource("../../client/src/components/SummaryDetailScreen.tsx");

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
      "MealRevisionConflictError",
      "refreshAfterMealMutation",
      "expectedMealRevisionId: payload.mealRevisionId",
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

  it("uses origin-specific back labels for Home, Chat, and History Meal Edit entry", () => {
    assert.match(source, /origin === "home"\s*\?\s*"返回首頁"/);
    assert.match(source, /origin === "chat"\s*\?\s*"返回對話"/);
    assert.match(source, /origin === "history"\s*\?\s*"返回歷史"/);
    assert.match(source, escapedPattern("aria-label={backLabel}"));
  });

  it("handles stale revision conflicts with deterministic copy and stale-editor blocking", () => {
    for (const expected of [
      "餐點已被更新，請重新載入最新餐點後再編輯。",
      "餐點版本已失效，請重新載入最新餐點後再編輯。",
      "餐點已被更新，未刪除。請重新載入最新餐點後再決定是否刪除。",
      "重新載入餐點",
      "MEAL_REVISION_STALE",
      "MEAL_REVISION_REQUIRED",
      "staleBlocked",
      "setStaleBlocked(true)",
      "handleReloadStaleMeal",
      'getMeals({ refreshReason: "meal_mutation" })',
    ]) {
      assert.match(source, escapedPattern(expected));
    }

    assert.match(source, /if \(!payload \|\| staleBlocked/);
    assert.match(source, /disabled=\{pending \|\| staleBlocked\}/);
  });

  it("preserves committed direct mutation side effects when dailySummary is absent", () => {
    assert.match(source, /import \{ refreshAfterMealMutation \} from "\.\.\/meal-edit-refresh\.js";/);
    assert.doesNotMatch(source, /if \(!dailySummary \|\| dailySummary\.date !== formatLocalDate\(new Date\(\)\)\) \{\s*return;\s*\}/);
    assert.match(source, /await refreshAfterMealMutation\(\{\s*redactChatReceiptIdentity,\s*recordMealMutation,\s*setDailySummary,\s*getMeals,\s*setMeals,\s*todayKey: \(\) => formatLocalDate\(new Date\(\)\),\s*\}, \{\s*mealId: payload\.mealId,\s*affectedDate: response\.affectedDate,\s*dailySummary: response\.dailySummary,\s*\}\);/);
    assert.match(source, /await refreshAfterMealMutation\(\{\s*redactChatReceiptIdentity,\s*recordMealMutation,\s*setDailySummary,\s*getMeals,\s*setMeals,\s*todayKey: \(\) => formatLocalDate\(new Date\(\)\),\s*\}, \{\s*mealId: payload\.mealId,\s*affectedDate,\s*dailySummary,\s*\}\);/);

    for (const rejected of [
      "summary unavailable",
      "summaryOutcome.status",
      "摘要暫時無法更新",
      "重新整理摘要",
    ]) {
      assert.doesNotMatch(source, escapedPattern(rejected));
    }
  });

  it("keeps Summary Detail direct delete side effects on the shared committed-mutation refresh path", () => {
    assert.match(summaryDetailSource, /const \{ affectedDate, dailySummary \} = await deleteMeal\(mealId, \{\s*expectedMealRevisionId: meal\.mealRevisionId,\s*\}\);/);
    assert.match(summaryDetailSource, /import \{ refreshAfterMealMutation \} from "\.\.\/meal-edit-refresh\.js";/);
    assert.match(summaryDetailSource, /MealRevisionConflictError/);
    assert.match(summaryDetailSource, /redactChatReceiptIdentity,/);
    assert.match(summaryDetailSource, /await refreshAfterMealMutation\(\{\s*redactChatReceiptIdentity,\s*recordMealMutation,\s*setDailySummary,\s*getMeals,\s*setMeals,\s*todayKey: \(\) => formatLocalDate\(new Date\(\)\),\s*\}, \{\s*mealId,\s*affectedDate,\s*dailySummary,\s*\}\);/);
    assert.match(summaryDetailSource, /if \(err instanceof MealRevisionConflictError\) \{/);
    assert.match(summaryDetailSource, /mealId: err\.mealId,\s*affectedDate: err\.affectedDate,/);
    assert.doesNotMatch(summaryDetailSource, /if \(dailySummary\?\.date === todayKey\) \{/);

    for (const rejected of [
      "summary unavailable",
      "summaryOutcome.status",
      "摘要暫時無法更新",
      "重新整理摘要",
    ]) {
      assert.doesNotMatch(summaryDetailSource, escapedPattern(rejected));
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

  it("replaces grouped-lock editing with grouped editor rows and controls", () => {
    const groupedPayloadFixture = {
      foodName: "雞腿、白飯、青菜",
      itemCount: 3,
    };
    assert.equal(groupedPayloadFixture.itemCount, 3);

    for (const expected of [
      "GroupedMealEditor",
      "GroupedMealRow",
      "formatGroupedItemSummary",
      "sp-meal-edit-grouped-card",
      "sp-meal-edit-grouped-row",
      "sp-meal-edit-grouped-row-expanded",
      "sp-meal-edit-grouped-add",
      "sp-meal-edit-grouped-empty",
      "sp-meal-edit-grouped-final-delete-error",
      "新增項目",
      "儲存餐點",
      "找不到項目明細",
      "至少要保留一個項目；若要移除整筆餐點，請使用刪除餐點。",
    ]) {
      assert.match(source, escapedPattern(expected));
    }

    assert.match(source, /items\.map/);
    assert.match(source, /<input\b/);
    assert.match(source, /delete/i);
    assert.match(source, /edit/i);
    assert.doesNotMatch(source, escapedPattern("sp-meal-edit-grouped-lock"));
    assert.doesNotMatch(source, escapedPattern("到對話修正"));
    assert.doesNotMatch(source, escapedPattern("這筆餐點包含多個項目，請到「對話」修正，避免把多項餐點合併成單一餐點。"));
  });

  it("blocks invalid grouped saves, opens the first invalid row, and preserves stale recovery", () => {
    for (const expected of [
      "尚未儲存。請先修正標示的項目。",
      "MealRevisionConflictError",
      "refreshAfterMealMutation",
      "recoverGuestSession",
      "setStaleBlocked(true)",
      "handleReloadStaleMeal",
    ]) {
      assert.match(source, escapedPattern(expected));
    }

    assert.match(source, /firstInvalid/i);
    assert.match(source, /expanded.*firstInvalid|firstInvalid.*expanded/s);
    assert.match(source, /if \(err instanceof MealRevisionConflictError\)/);
    assert.match(source, /await refreshAfterMealMutation\(/);
    assert.match(source, /onBack\(\)/);
  });

  it("prompts once before discarding dirty grouped drafts", () => {
    for (const expected of [
      "放棄尚未儲存的變更？",
      "isGroupedMealDraftDirty",
    ]) {
      assert.match(source, escapedPattern(expected));
    }

    assert.match(source, /confirm\("放棄尚未儲存的變更？"\)/);
  });

  it("keeps grouped item rows media-free while preserving whole-meal image copy", () => {
    assert.match(source, escapedPattern("整餐照片"));
    assert.match(source, escapedPattern("這張照片代表整餐，不是單一食物裁切。"));
    assert.doesNotMatch(source, /dangerouslySetInnerHTML/);

    for (const rejected of [
      "perItemImage",
      "itemImage",
      "crop",
      "thumbnail",
      "imageAssetId",
      "照片區域",
      "圖片區域",
    ]) {
      const groupedWriteConstruction =
        source.match(/buildGroupedMealUpdateItems[\s\S]+?updateMeal\([\s\S]+?\}\);/)?.[0] ?? "";
      assert.doesNotMatch(groupedWriteConstruction, escapedPattern(rejected));
    }
  });
});
