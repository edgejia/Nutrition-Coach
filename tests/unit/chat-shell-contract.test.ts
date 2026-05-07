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
    assert.doesNotMatch(chatPanel, /today log/);
    assert.doesNotMatch(chatPanel, /sp-chat-today-log/);
    assert.match(chatPanel, /formatMealCountSummary/);
    assert.match(chatPanel, /formatMealCountCompact/);
    assert.match(chatPanel, /今日已紀錄 \$\{mealCount\} 餐/);
    assert.match(chatPanel, /\$\{mealCount\} 餐/);
    assert.match(chatPanel, /\{consumedCalories\}\/\{targetCalories\} kcal/);
    assert.match(chatPanel, /\{todayMealCountCompact\}/);
    assert.match(chatPanel, /aria-label=\{`\$\{consumedCalories\}\/\$\{targetCalories\} kcal，\$\{todayMealCountSummary\}`\}/);
    assert.match(chatPanel, /sp-chat-separator/);
    assert.match(chatPanel, /getMeals\(\{ refreshReason: "meal_mutation" \}\)/);
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

    assert.match(chatInput, /描述你吃了什麼…/);
    assert.match(chatInput, /SportCameraIcon/);
    assert.match(chatInput, /SportSendIcon/);
    assert.match(chatInput, /SportCloseIcon/);
    assert.match(chatInput, /sp-chat-input/);
    assert.match(chatInput, /sp-chat-input-well/);
    assert.match(chatInput, /sp-chat-send/);
    assert.match(chatInput, /image\/jpeg,image\/png,image\/webp/);
    assert.doesNotMatch(chatInput, /SketchIcons\.js/);
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
