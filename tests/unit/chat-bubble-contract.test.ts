import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));

async function readSource(path: string) {
  return readFile(`${root}/${path}`, "utf8");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

describe("chat bubble source contract", () => {
  it("uses the sport composer controls while preserving upload and send behavior", async () => {
    const chatInput = await readSource("client/src/components/ChatInput.tsx");

    assert.match(chatInput, /SportCameraIcon/);
    assert.match(chatInput, /SportSendIcon/);
    assert.match(chatInput, /SportCloseIcon/);
    assert.match(chatInput, /from "\.\/SportIcons\.js"/);
    assert.ok(chatInput.includes('accept="image/jpeg,image/png,image/webp"'));
    assert.ok(chatInput.includes("onBeforeSend?.({"));
    assert.match(chatInput, /onSend\(trimmedText, image \?\? undefined\)/);
    assert.match(chatInput, /fileRef\.current\.value = ""/);
    assert.match(chatInput, /disabled \|\| !canSend/);
    assert.match(chatInput, /metaKey \|\| e\.ctrlKey/);
    assert.match(chatInput, /aria-label="附加照片"/);
    assert.match(chatInput, /aria-label="移除照片"/);
    assert.match(chatInput, /aria-label="送出"/);
    assert.match(chatInput, /placeholder="描述你吃了什麼…"/);

    for (const className of [
      "sp-chat-input",
      "sp-chat-camera",
      "sp-chat-input-well",
      "sp-chat-textarea",
      "sp-chat-image-chip",
      "sp-chat-send",
    ]) {
      assert.match(chatInput, new RegExp(className));
    }

    assert.match(chatInput, /data-ready=\{canSend\}/);

    assert.doesNotMatch(chatInput, /from "\.\/SketchIcons\.js"/);
    assert.doesNotMatch(chatInput, /<CameraIcon\b/);
    assert.doesNotMatch(chatInput, /<SendIcon\b/);
  });

  it("renders sport bubbles, status, streaming caret, and safe receipt fields", async () => {
    const bubble = await readSource("client/src/components/MessageBubble.tsx");

    for (const required of [
      "sp-bubble-user",
      "sp-bubble-asst",
      "sp-status-bubble",
      "sp-stream-caret",
      "sp-receipt",
      "logged",
      "protein",
      "carbs",
      "fat",
      "SportBoltIcon",
      "SportChevronRightIcon",
      "AssistantMarkdown",
      "PersistedAssetImage",
      "onImageSettle",
      "onOpenMealEdit",
    ]) {
      assert.match(bubble, new RegExp(required));
    }
  });

  it("renders image-only user messages without the green text bubble", async () => {
    const bubble = await readSource("client/src/components/MessageBubble.tsx");
    const css = await readSource("client/src/app.css");

    assert.match(bubble, /isImageOnly \? \(/);
    assert.match(bubble, /sp-message-image sp-message-image-only/);
    assert.match(css, /\.sp-message-image-only/);

    const imageOnlyBranch = bubble.slice(
      bubble.indexOf("{isImageOnly ? ("),
      bubble.indexOf(") : (", bubble.indexOf("{isImageOnly ? (")),
    );
    assert.doesNotMatch(imageOnlyBranch, /sp-bubble-user/);
  });

  it("renders receipt-first from message.loggedMeal for log and update receipts", async () => {
    const bubble = await readSource("client/src/components/MessageBubble.tsx");

    assert.match(bubble, /message\.loggedMeal/);
    assert.doesNotMatch(bubble, /message\.didLogMeal === true/);
    assert.doesNotMatch(bubble, /toolName/);
    assert.doesNotMatch(bubble, /mutationKind/);

    const receiptIndex = bubble.indexOf("sp-receipt");
    const assistantIndex = bubble.indexOf("sp-bubble-asst", receiptIndex);
    assert.ok(receiptIndex >= 0, "receipt markup should be present");
    assert.ok(assistantIndex > receiptIndex, "assistant text bubble should render after receipt");
  });

  it("complete receipts open Meal Edit and incomplete receipts stay read-only", async () => {
    const bubble = await readSource("client/src/components/MessageBubble.tsx");
    const chatPanel = await readSource("client/src/components/ChatPanel.tsx");
    const payloadBuilder = await readSource("client/src/meal-edit-payload.ts");

    assert.match(bubble, /getCompleteReceiptEditPayload/);
    assert.match(bubble, /buildReceiptMealEditPayload\(message\.loggedMeal\)/);

    assert.match(bubble, /MealEditPayload/);
    assert.match(bubble, /onOpenMealEdit\?\.\(editPayload\)/);
    assert.match(bubble, /SportChevronRightIcon/);
    assert.match(payloadBuilder, /Number\.isFinite/);
    assert.match(chatPanel, /PHASE40_INCOMPLETE_RECEIPT_FLAG/);
    assert.match(chatPanel, /phase40IncompleteReceipt/);
    assert.match(chatPanel, /createPhase40IncompleteReceiptMock/);
    assert.match(chatPanel, /foodName: "鮭魚飯糰"/);
    assert.match(chatPanel, /content: ""/);
    assert.doesNotMatch(chatPanel, /缺少可編輯/);
    assert.doesNotMatch(chatPanel, /Incomplete receipt mock/);
  });

  it("renders logged meal receipt thumbnails through the shared persisted asset primitive", async () => {
    const bubble = await readSource("client/src/components/MessageBubble.tsx");
    const css = await readSource("client/src/app.css");

    assert.match(bubble, /<PersistedAssetImage/);
    assert.match(bubble, /src=\{loggedMeal\.imageUrl\}/);
    assert.match(bubble, /alt=\{`\$\{loggedMeal\.foodName\} 整餐照片`\}/);
    assert.match(bubble, /imgClassName="sp-receipt-thumbnail"/);
    assert.match(
      bubble,
      /fallbackClassName="sp-receipt-thumbnail sp-receipt-thumbnail-fallback"/,
    );
    assert.match(bubble, /className="sp-receipt-thumbnail-frame"/);
    assert.match(bubble, /aria-label=\{canEdit \? `編輯 \$\{loggedMeal\.foodName\}` : undefined\}/);

    assert.match(css, /\.sp-receipt-thumbnail-frame/);
    assert.match(css, /width:\s*56px/);
    assert.match(css, /height:\s*56px/);
    assert.match(css, /\.sp-receipt-thumbnail/);
    assert.match(css, /\.sp-receipt-thumbnail-fallback/);
  });

  it("delete mutation confirmations stay assistant text only without receipt affordances", async () => {
    const bubble = await readSource("client/src/components/MessageBubble.tsx");

    assert.match(bubble, /message\.loggedMeal/);
    assert.match(bubble, /sp-bubble-asst/);
    assert.doesNotMatch(bubble, /deleted/);
    assert.doesNotMatch(bubble, /deletedMeal/);
    assert.doesNotMatch(bubble, /delete_meal/);
  });

  it("passes Meal Edit callbacks from ChatPanel with chat origin", async () => {
    const chatPanel = await readSource("client/src/components/ChatPanel.tsx");
    const bubble = await readSource("client/src/components/MessageBubble.tsx");
    const payloadBuilder = await readSource("client/src/meal-edit-payload.ts");

    assert.match(chatPanel, /onOpenMealEdit=\{\(payload\) => openMealEdit\(payload, "chat"\)\}/);
    assert.doesNotMatch(chatPanel, /sp-chat-today-log/);
    for (const field of [
      "mealId",
      "dateKey",
      "foodName",
      "calories",
      "protein",
      "carbs",
      "fat",
      "imageAssetId",
      "imageUrl",
      "loggedAt",
    ]) {
      assert.match(payloadBuilder, new RegExp(`${field}:`));
    }
  });

  it("blocks unsafe markdown, fuzzy edit handoffs, and hidden receipt fields", async () => {
    const bubble = await readSource("client/src/components/MessageBubble.tsx");
    const chatPanel = await readSource("client/src/components/ChatPanel.tsx");
    const combined = `${bubble}\n${chatPanel}`;

    for (const forbidden of [
      "dangerouslySetInnerHTML",
      "confidence",
      "estimate",
      "調整",
      "刪除",
      "查看今日餐點",
      'openSecondaryScreen("mealEdit"',
    ]) {
      assert.doesNotMatch(combined, new RegExp(escapeRegExp(forbidden)));
    }

    assert.doesNotMatch(bubble, /find\([^)]*foodName/);
    assert.doesNotMatch(bubble, /find\([^)]*calories/);
    assert.doesNotMatch(bubble, /foodName[^;\n]+calories/);
    assert.doesNotMatch(bubble, /<img/);
    assert.doesNotMatch(bubble, /backgroundImage/);
  });
});
