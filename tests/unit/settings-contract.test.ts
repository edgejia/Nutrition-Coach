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
  it("keeps only daily targets editable and status rows read-only", async () => {
    const source = await readSource("../../client/src/components/GoalSettings.tsx");

    assert.match(source, /每日目標/);
    assert.match(source, /偏好/);
    assert.match(source, /資料/);
    assert.match(source, /Asia\/Taipei/);
    assert.match(source, /繁體中文/);
    assert.match(source, /訪客模式 · cookie-backed session/);
    assert.match(source, /updateGoals\(form\)/);
    assert.match(source, /setEditing\(true\)/);
    assert.match(source, /setEditing\(false\)/);
    assert.match(source, /儲存/);
    assert.match(source, /取消/);

    assert.doesNotMatch(source, /exportData/);
    assert.doesNotMatch(source, /clearAllRecords/);
    assert.doesNotMatch(source, /updateReminder/);
    assert.doesNotMatch(source, /updateTimezone/);
    assert.doesNotMatch(source, /updateLanguage/);
    assert.doesNotMatch(source, /deviceId\}/);
    assert.doesNotMatch(source, /deviceId:/);
  });
});
