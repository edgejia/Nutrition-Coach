import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { normalizeTargetInputValue } from "../../client/src/lib/target-input.js";

function sourcePath(relativePath: string) {
  return fileURLToPath(new URL(relativePath, import.meta.url));
}

async function readSource(relativePath: string) {
  return readFile(sourcePath(relativePath), "utf8");
}

describe("Settings source contract", () => {
  it("keeps the sport Settings shell daily-target-only and unsupported rows inert", async () => {
    const source = await readSource("../../client/src/components/GoalSettings.tsx");

    assert.match(source, /SportScreen/);
    assert.match(source, /SportIconButton/);
    assert.match(source, /SportChevronRightIcon/);
    assert.match(source, /className="sp-card"/);
    assert.match(source, /className="sp-chip sp-chip-good"/);
    assert.match(source, /sp-/);

    assert.match(source, /偏好與目標/);
    assert.match(source, /設定/);
    assert.match(source, /訪客模式/);
    assert.match(source, /使用中/);
    assert.match(source, /JC/);
    assert.match(source, /訪客 · 這個瀏覽器/);
    assert.doesNotMatch(source, /瀏覽器保存 · 12 天/);
    assert.match(source, /每日目標/);
    assert.match(source, /偏好設定/);
    assert.match(source, /偏好/);
    assert.match(source, /Asia\/Taipei/);
    assert.match(source, /繁體中文/);
    assert.match(source, /資料管理/);
    assert.match(source, /資料/);
    assert.match(source, /尚未開放/);
    assert.match(source, /aria-disabled="true"/);
    assert.match(source, /cursor: "default"/);
    assert.match(source, /營養教練/);
    assert.match(source, /sport/);
    assert.match(source, /儲存中\.\.\./);
    assert.match(source, /儲存目標/);
    assert.match(source, /取消/);

    assert.ok(source.includes("updateGoals(form)"));
    assert.ok(source.includes("setDailyTargets(updated)"));
    assert.match(source, /isGoalSafetyError/);
    assert.match(source, /這個目標太低，暫時不會更新。請改成較安全的每日目標。/);
    assert.match(source, /role="alert"/);
    assert.match(source, /setGoalSafetyError/);
    assert.doesNotMatch(source, /alert\("更新目標失敗，請稍後再試。"\)/);
    assert.match(source, /recoverGuestSession/);
    assert.match(source, /function createTargetForm/);
    assert.match(source, /normalizeTargetInputValue/);
    assert.match(source, /inputMode="numeric"/);
    assert.match(source, /pattern="\[0-9\]\*"/);
    assert.match(source, /useEffect\(\(\) => \{/);
    assert.match(source, /if \(!editing\) \{/);
    assert.match(source, /setForm\(createTargetForm\(dailyTargets\)\)/);
    assert.match(source, /function startEditing\(\)/);
    assert.match(source, /onClick=\{startEditing\}/);
    assert.doesNotMatch(source, /onClick=\{\(\) => setEditing\(true\)\}/);
    assert.ok(source.includes("setEditing(false)"));

    assert.doesNotMatch(source, /from "\.\/SketchPrimitives\.js"/);
    assert.doesNotMatch(source, /exportData/);
    assert.doesNotMatch(source, /clearAllRecords/);
    assert.doesNotMatch(source, /updateReminder/);
    assert.doesNotMatch(source, /updateTimezone/);
    assert.doesNotMatch(source, /updateLanguage/);
    assert.doesNotMatch(source, /cursor: muted \? "default" : "pointer"/);
    assert.doesNotMatch(source, /wipe/i);
    assert.doesNotMatch(source, /deviceId\}/);
    assert.doesNotMatch(source, /deviceId:/);
    assert.doesNotMatch(source, /unsafe_calorie_floor/);
    assert.doesNotMatch(source, /GOAL_SAFETY_ERROR_REASON/);
    assert.doesNotMatch(source, /SAFE-02/);
    assert.doesNotMatch(source, /nutritionSafety/);
  });

  it("normalizes daily target numeric input without preserving prefix zeros", () => {
    assert.equal(normalizeTargetInputValue("0300"), 300);
    assert.equal(normalizeTargetInputValue("000"), 0);
    assert.equal(normalizeTargetInputValue("001850"), 1850);
    assert.equal(normalizeTargetInputValue("12kcal"), 12);
    assert.equal(normalizeTargetInputValue(""), 0);
  });
});
