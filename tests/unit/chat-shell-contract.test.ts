import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));

async function readSource(path: string) {
  return readFile(`${root}/${path}`, "utf8");
}

describe("chat shell source contract", () => {
  it("keeps the chat panel as a full-screen shell with compact context", async () => {
    const chatPanel = await readSource("client/src/components/ChatPanel.tsx");

    assert.match(chatPanel, /對話/);
    assert.match(chatPanel, /sp-chat-header/);
    assert.match(chatPanel, /today log/);
    assert.match(chatPanel, /screen-scroll-with-input/);
    assert.match(chatPanel, /sp-chat-scroll/);
    assert.match(chatPanel, /sp-chat-composer-bar/);
    assert.match(chatPanel, /scrollContainerRef/);
    assert.match(chatPanel, /scheduleLatestAlignment/);
    assert.doesNotMatch(chatPanel, /DashboardMiniBar/);
    assert.doesNotMatch(chatPanel, /同一個輸入框同時處理提問與記錄/);
  });

  it("uses icon-based camera and send controls with the agreed placeholder", async () => {
    const chatInput = await readSource("client/src/components/ChatInput.tsx");

    assert.match(chatInput, /記錄 ／ 提問 ／ 修改…/);
    assert.match(chatInput, /CameraIcon/);
    assert.match(chatInput, /SendIcon/);
    assert.match(chatInput, /image\/jpeg,image\/png,image\/webp/);
    assert.doesNotMatch(chatInput, /📷/);
    assert.doesNotMatch(chatInput, /↑/);
  });

  it("shows stable calorie and macro context labels", async () => {
    const miniBar = await readSource("client/src/components/DashboardMiniBar.tsx");

    assert.match(miniBar, /還能吃/);
    assert.match(miniBar, /蛋白/);
    assert.match(miniBar, /碳水/);
    assert.match(miniBar, /脂肪/);
  });
});
