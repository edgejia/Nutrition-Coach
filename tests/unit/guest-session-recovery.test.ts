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
  it("keeps the sport recovery gate copied from the demo recovery screen", async () => {
    const source = await readSource("../../client/src/components/GuestSessionRecoveryGate.tsx");

    assert.match(source, /background: "var\(--sp-surface\)"/);
    assert.match(source, /className="sp-screen"/);
    assert.match(source, /工作階段已失效/);
    assert.match(source, /訪客日記/);
    assert.match(source, /暫時離線/);
    assert.match(source, /工作階段/);
    assert.match(source, /gs_4c81/);
    assert.match(source, /最後同步/);
    assert.match(source, /自動恢復/);
    assert.match(source, /失敗 · 1\/1/);
    assert.match(source, /瀏覽器 · cookie/);
    assert.match(source, /重新建立訪客日記/);
    assert.match(source, /正在重建…/);
    assert.match(source, /先匯出原始紀錄/);
    assert.match(source, /disabled aria-disabled="true"/);
    assert.match(source, /cursor: "not-allowed"/);
    assert.match(source, /目前不支援從這個畫面匯出原始紀錄/);
    assert.match(source, /rebuildGuestSession/);
    assert.ok(source.includes("await rebuildGuestSession()"));

    assert.doesNotMatch(source, /\blogin\b/i);
    assert.doesNotMatch(source, /\baccount\b/i);
    assert.doesNotMatch(source, /cross-device/i);
    assert.doesNotMatch(source, /跨裝置/);
    assert.doesNotMatch(source, /\bdeviceId\b/);
    assert.doesNotMatch(source, /\bsessionId\b/);
    assert.doesNotMatch(source, /\btoken\b/i);
    assert.doesNotMatch(source, /document\.cookie/);
    assert.doesNotMatch(source, /cookie(Value|Raw|Token|Session)/);
  });
});
