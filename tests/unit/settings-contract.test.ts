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

describe("Settings source contract", () => {
  it("keeps the sport Settings shell daily-target-only and unsupported rows inert", async () => {
    const source = await readSource("../../client/src/components/GoalSettings.tsx");

    assert.match(source, /SportScreen/);
    assert.match(source, /SportCard/);
    assert.match(source, /SportChip/);
    assert.match(source, /SportIconButton/);
    assert.match(source, /sp-/);

    assert.match(source, /偏好與目標/);
    assert.match(source, /設定/);
    assert.match(source, /訪客模式/);
    assert.match(source, /使用中/);
    assert.match(source, /每日目標/);
    assert.match(source, /偏好/);
    assert.match(source, /資料/);
    assert.match(source, /尚未開放/);
    assert.match(source, /營養教練/);
    assert.match(source, /sport/);
    assert.match(source, /儲存中\.\.\./);
    assert.match(source, /儲存/);
    assert.match(source, /取消/);

    assert.ok(source.includes("updateGoals(form)"));
    assert.ok(source.includes("setDailyTargets(updated)"));
    assert.match(source, /recoverGuestSession/);
    assert.ok(source.includes("setEditing(true)"));
    assert.ok(source.includes("setEditing(false)"));

    assert.doesNotMatch(source, /from "\.\/SketchPrimitives\.js"/);
    assert.doesNotMatch(source, /exportData/);
    assert.doesNotMatch(source, /clearAllRecords/);
    assert.doesNotMatch(source, /updateReminder/);
    assert.doesNotMatch(source, /updateTimezone/);
    assert.doesNotMatch(source, /updateLanguage/);
    assert.doesNotMatch(source, /wipe/i);
    assert.doesNotMatch(source, /deviceId\}/);
    assert.doesNotMatch(source, /deviceId:/);
  });
});
