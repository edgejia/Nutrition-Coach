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

  it("validates unsupported uploads before image chip state and renders composer-local copy", async () => {
    const chatInput = await readSource("client/src/components/ChatInput.tsx");
    const css = await readSource("client/src/app.css");
    const warningCopy = "目前只支援 JPG、PNG、WebP 照片。iPhone HEIC 請先轉成 JPG 後再上傳。";

    assert.match(chatInput, /getSupportedImageMimeType/);
    assert.match(chatInput, /from "\.\.\/api\.js"/);
    assert.match(chatInput, /function handleImageChange/);
    assert.match(chatInput, /setUploadError/);
    assert.ok(chatInput.includes(warningCopy));
    assert.match(chatInput, /role="alert"/);
    assert.match(chatInput, /sp-chat-upload-error/);
    assert.match(css, /\.sp-chat-upload-error/);
    assert.match(css, /var\(--sp-amber\)/);

    const handlerStart = chatInput.indexOf("function handleImageChange");
    assert.ok(handlerStart >= 0, "ChatInput should use a named file-change handler");
    const handlerEnd = chatInput.indexOf("function ", handlerStart + "function ".length);
    const handler = chatInput.slice(handlerStart, handlerEnd >= 0 ? handlerEnd : undefined);
    const supportCheckIndex = handler.indexOf("getSupportedImageMimeType");
    const setImageIndex = handler.indexOf("setImage");

    assert.ok(supportCheckIndex >= 0, "file-change handler should call the shared support helper");
    assert.ok(setImageIndex >= 0, "file-change handler should still accept supported images");
    assert.ok(supportCheckIndex < setImageIndex, "support validation must run before accepted image state");
    assert.match(handler, /setImage\(null\)/);
    assert.match(handler, /fileRef\.current\.value = ""/);
    assert.match(handler, /setUploadError\(UPLOAD_ERROR_COPY\)/);
    assert.match(handler, /setUploadError\(""\)/);

    const removeButtonStart = chatInput.indexOf('aria-label="移除照片"');
    assert.ok(removeButtonStart >= 0, "remove-photo button should exist");
    const removeButton = chatInput.slice(Math.max(0, removeButtonStart - 500), removeButtonStart + 300);
    assert.match(removeButton, /setUploadError\(""\)/);

    assert.match(chatInput, /onChange=\{handleImageChange\}/);
    assert.doesNotMatch(chatInput, /onChange=\{\(e\) => setImage/);
  });

  it("shows stable calorie and macro context labels", async () => {
    const miniBar = await readSource("client/src/components/DashboardMiniBar.tsx");

    assert.match(miniBar, /還能吃/);
    assert.match(miniBar, /蛋白/);
    assert.match(miniBar, /碳水/);
    assert.match(miniBar, /脂肪/);
  });
});
