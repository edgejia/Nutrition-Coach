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

describe("Guest session recovery source contract", () => {
  it("keeps the sport recovery gate safe and rebuild-only", async () => {
    const source = await readSource("../../client/src/components/GuestSessionRecoveryGate.tsx");

    assert.match(source, /SportScreen/);
    assert.ok(source.includes("SportCard") || source.includes("sp-card"));
    assert.match(source, /SportChip/);
    assert.match(source, /工作階段已失效/);
    assert.match(source, /訪客日記/);
    assert.match(source, /暫時離線/);
    assert.match(source, /自動恢復/);
    assert.match(source, /失敗 · 1\/1/);
    assert.match(source, /瀏覽器 · cookie/);
    assert.match(source, /重新建立訪客日記/);
    assert.match(source, /重新建立中\.\.\./);
    assert.match(source, /rebuildGuestSession/);
    assert.ok(source.includes("await rebuildGuestSession()"));

    assert.doesNotMatch(source, /匯出原始紀錄/);
    assert.doesNotMatch(source, /EXPORT FIRST/);
    assert.doesNotMatch(source, /先匯出/);
    assert.doesNotMatch(source, /\blogin\b/i);
    assert.doesNotMatch(source, /\baccount\b/i);
    assert.doesNotMatch(source, /cross-device/i);
    assert.doesNotMatch(source, /跨裝置/);
    assert.doesNotMatch(source, /\bdeviceId\b/);
    assert.doesNotMatch(source, /\bsessionId\b/);
    assert.doesNotMatch(source, /\btoken\b/i);
    assert.doesNotMatch(source, /document\.cookie/);
    assert.doesNotMatch(source, /cookie(Value|Raw|Token|Session)/);
    assert.doesNotMatch(source, /window\.Sp/);
  });
});
