import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MessageBubble } from "../../client/src/components/MessageBubble.js";
import type { Message } from "../../client/src/types.js";

const root = fileURLToPath(new URL("../..", import.meta.url));

async function readSource(path: string) {
  return readFile(`${root}/${path}`, "utf8");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function renderMessageBubble(message: Message, options?: { isProvisional?: boolean; isStatusLabel?: boolean }) {
  return renderToStaticMarkup(createElement(MessageBubble, { message, ...options }));
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
      "已記錄",
      "蛋白質",
      "碳水",
      "脂肪",
      "SportBoltIcon",
      "SportChevronRightIcon",
      "AssistantMarkdown",
      "PersistedAssetImage",
      "onImageSettle",
      "onOpenMealEdit",
    ]) {
      assert.match(bubble, new RegExp(required));
    }

    assert.doesNotMatch(bubble, /sp-receipt-label">logged</);
    assert.doesNotMatch(bubble, /<span>protein<\/span>/);
    assert.doesNotMatch(bubble, /<span>carbs<\/span>/);
    assert.doesNotMatch(bubble, /<span>fat<\/span>/);
    assert.match(bubble, /loggedMeal\.protein/);
    assert.match(bubble, /loggedMeal\.carbs/);
    assert.match(bubble, /loggedMeal\.fat/);
  });

  it("renders localized receipt labels without changing logged meal payload fields", () => {
    const message: Message = {
      id: "receipt-1",
      role: "assistant",
      content: "",
      createdAt: "2026-05-11T10:00:00.000Z",
      loggedMeal: {
        foodName: "雞胸便當",
        calories: 640,
        protein: 42,
        carbs: 68,
        fat: 18,
        itemCount: 1,
      },
    };

    const html = renderToStaticMarkup(createElement(MessageBubble, { message }));

    assert.match(html, />已記錄</);
    assert.match(html, />蛋白質</);
    assert.match(html, />碳水</);
    assert.match(html, />脂肪</);
    assert.match(html, />42 g</);
    assert.match(html, />68 g</);
    assert.match(html, />18 g</);
    assert.doesNotMatch(html, />logged</);
    assert.doesNotMatch(html, />protein</);
    assert.doesNotMatch(html, />carbs</);
    assert.doesNotMatch(html, />fat</);
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
    assert.match(payloadBuilder, /mealRevisionId/);
    assert.match(chatPanel, /PHASE40_INCOMPLETE_RECEIPT_FLAG/);
    assert.match(chatPanel, /phase40IncompleteReceipt/);
    assert.match(chatPanel, /createPhase40IncompleteReceiptMock/);
    assert.match(chatPanel, /foodName: "鮭魚飯糰"/);
    assert.match(chatPanel, /content: ""/);
    assert.doesNotMatch(chatPanel, /缺少可編輯/);
    assert.doesNotMatch(chatPanel, /Incomplete receipt mock/);
  });

  it("keeps receipts without mealRevisionId display-only", () => {
    const message: Message = {
      id: "receipt-stale-1",
      role: "assistant",
      content: "",
      createdAt: "2026-05-11T10:00:00.000Z",
      loggedMeal: {
        mealId: "meal-1",
        dateKey: "2026-05-11",
        foodName: "雞胸便當",
        calories: 640,
        protein: 42,
        carbs: 68,
        fat: 18,
        itemCount: 1,
      },
    };

    const html = renderToStaticMarkup(
      createElement(MessageBubble, {
        message,
        onOpenMealEdit: () => {
          throw new Error("stale receipt should not open Meal Edit");
        },
      }),
    );

    assert.doesNotMatch(html, /role="button"/);
    assert.doesNotMatch(html, /tabindex="0"/i);
    assert.doesNotMatch(html, /sp-receipt-chevron/);
    assert.doesNotMatch(html, /aria-label="編輯 雞胸便當"/);
  });

  it("renders deleted receipt snapshots with preserved evidence and no action affordance", () => {
    let openMealEditCalls = 0;
    const message: Message = {
      id: "receipt-deleted-1",
      role: "assistant",
      content: "",
      createdAt: "2026-05-11T10:00:00.000Z",
      loggedMeal: {
        mealId: "meal-deleted-1",
        mealRevisionId: "meal-deleted-1:r1",
        dateKey: "2026-05-11",
        receiptStatus: "deleted",
        loggedAt: "2026-05-11T10:00:00.000Z",
        foodName: "雞腿便當",
        calories: 720,
        protein: 34,
        carbs: 88,
        fat: 24,
        itemCount: 2,
        imageAssetId: "asset-deleted-lunch",
        imageUrl: "/api/assets/asset-deleted-lunch",
      },
    };

    const html = renderToStaticMarkup(
      createElement(MessageBubble, {
        message,
        onOpenMealEdit: () => {
          openMealEditCalls += 1;
        },
      }),
    );

    assert.match(html, />已刪除</);
    assert.match(html, /sp-receipt-deleted/);
    assert.match(html, />雞腿便當</);
    assert.match(html, />720</);
    assert.match(html, />34 g</);
    assert.match(html, />88 g</);
    assert.match(html, />24 g</);
    assert.match(html, /\/api\/assets\/asset-deleted-lunch/);
    assert.match(html, /雞腿便當 整餐照片/);
    assert.doesNotMatch(html, />已記錄</);
    assert.doesNotMatch(html, /role="button"/);
    assert.doesNotMatch(html, /tabindex="0"/i);
    assert.doesNotMatch(html, /sp-receipt-button/);
    assert.doesNotMatch(html, /sp-receipt-chevron/);
    assert.doesNotMatch(html, /aria-label="編輯 雞腿便當"/);
    assert.equal(openMealEditCalls, 0);
  });

  it("keeps stale revision receipts display-only without the deleted label", () => {
    let openMealEditCalls = 0;
    const message: Message = {
      id: "receipt-stale-revision-1",
      role: "assistant",
      content: "",
      createdAt: "2026-05-11T10:00:00.000Z",
      loggedMeal: {
        mealId: "meal-stale-1",
        mealRevisionId: "meal-stale-1:r1",
        dateKey: "2026-05-11",
        receiptStatus: "stale_revision",
        loggedAt: "2026-05-11T10:00:00.000Z",
        foodName: "舊版鮭魚飯糰",
        calories: 330,
        protein: 18,
        carbs: 40,
        fat: 10,
        itemCount: 1,
      },
    };

    const html = renderToStaticMarkup(
      createElement(MessageBubble, {
        message,
        onOpenMealEdit: () => {
          openMealEditCalls += 1;
        },
      }),
    );

    assert.match(html, />已記錄</);
    assert.match(html, />舊版鮭魚飯糰</);
    assert.doesNotMatch(html, />已刪除</);
    assert.doesNotMatch(html, /sp-receipt-deleted/);
    assert.doesNotMatch(html, /role="button"/);
    assert.doesNotMatch(html, /tabindex="0"/i);
    assert.doesNotMatch(html, /sp-receipt-button/);
    assert.doesNotMatch(html, /sp-receipt-chevron/);
    assert.doesNotMatch(html, /aria-label="編輯 舊版鮭魚飯糰"/);
    assert.equal(openMealEditCalls, 0);
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
    assert.match(bubble, /aria-label=\{/);
    assert.match(bubble, /canEdit\s*\?\s*`編輯 \$\{loggedMeal\.foodName\}`/);
    assert.match(bubble, /isDeletedReceipt\s*\?\s*`\$\{loggedMeal\.foodName\}，已刪除，歷史餐點快照`/);

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
    assert.doesNotMatch(bubble, /deletedMeal/);
    assert.doesNotMatch(bubble, /delete_meal/);
  });

  it("renders a short reference code for finalized assistant errors without exposing the full turn id", () => {
    const turnId = "a1b2c3d4-1111-4222-8333-0123456789ab";
    const message: Message = {
      id: "error-reference-1",
      role: "assistant",
      content: "抱歉，發生錯誤，請再試一次。",
      createdAt: "2026-05-14T09:30:00.000Z",
      status: "error",
      turnId,
    };

    const html = renderMessageBubble(message);

    assert.match(html, /引用碼/);
    assert.match(html, /t-a1b2c3d4/);
    assert.doesNotMatch(html, new RegExp(escapeRegExp(turnId)));
  });

  it("does not render reference codes for happy assistant messages with turn ids", () => {
    const message: Message = {
      id: "happy-reference-free-1",
      role: "assistant",
      content: "已幫你記錄早餐。",
      createdAt: "2026-05-14T09:31:00.000Z",
      status: "complete",
      turnId: "a1b2c3d4-1111-4222-8333-0123456789ab",
    };

    const html = renderMessageBubble(message);

    assert.doesNotMatch(html, /引用碼/);
    assert.doesNotMatch(html, /t-a1b2c3d4/);
  });

  it("does not render reference codes for normal stopped assistant messages", () => {
    const message: Message = {
      id: "stopped-reference-free-1",
      role: "assistant",
      content: "已停止產生回覆。",
      createdAt: "2026-05-14T09:32:00.000Z",
      status: "stopped",
      turnId: "a1b2c3d4-1111-4222-8333-0123456789ab",
    };

    const html = renderMessageBubble(message);

    assert.doesNotMatch(html, /引用碼/);
    assert.doesNotMatch(html, /t-a1b2c3d4/);
  });

  it("renders partial stopped assistant text with a separate neutral stopped label", () => {
    const message: Message = {
      id: "partial-stopped-1",
      role: "assistant",
      content: "這是一段已串流的回覆",
      createdAt: "2026-05-14T09:32:00.000Z",
      status: "stopped",
    };

    const html = renderMessageBubble(message);

    assert.match(html, />這是一段已串流的回覆</);
    assert.match(html, /sp-bubble-stopped/);
    assert.match(html, /sp-stopped-status/);
    assert.match(html, />已停止</);
    assert.doesNotMatch(html, /這是一段已串流的回覆\s*已停止/);
    assert.doesNotMatch(html, /sp-bubble-error/);
  });

  it("renders empty stopped assistant messages with canonical stopped copy", () => {
    const message: Message = {
      id: "empty-stopped-1",
      role: "assistant",
      content: "",
      createdAt: "2026-05-14T09:32:00.000Z",
      status: "stopped",
    };

    const html = renderMessageBubble(message);

    assert.match(html, />已停止生成。</);
    assert.match(html, /sp-bubble-stopped/);
    assert.doesNotMatch(html, /sp-stopped-status/);
    assert.doesNotMatch(html, /sp-bubble-error/);
  });

  it("normalizes history-loaded raw stopped placeholder text", () => {
    const message: Message = {
      id: "raw-stopped-1",
      role: "assistant",
      content: "（已停止）",
      createdAt: "2026-05-14T09:32:00.000Z",
      status: "stopped",
    };

    const html = renderMessageBubble(message);

    assert.match(html, />已停止生成。</);
    assert.doesNotMatch(html, /（已停止）/);
    assert.doesNotMatch(html, /sp-stopped-status/);
    assert.doesNotMatch(html, /sp-bubble-error/);
  });

  it("keeps stopped messages with turn ids out of error reference rendering", () => {
    const message: Message = {
      id: "turn-stopped-1",
      role: "assistant",
      content: "部分回覆內容",
      createdAt: "2026-05-14T09:32:00.000Z",
      status: "stopped",
      turnId: "a1b2c3d4-1111-4222-8333-0123456789ab",
    };

    const html = renderMessageBubble(message);

    assert.match(html, /sp-bubble-stopped/);
    assert.doesNotMatch(html, /引用碼/);
    assert.doesNotMatch(html, /t-a1b2c3d4/);
    assert.doesNotMatch(html, /sp-bubble-error/);
    assert.doesNotMatch(html, /抱歉，發生錯誤/);
  });

  it("keeps true assistant errors on failure styling and reference behavior", () => {
    const message: Message = {
      id: "error-control-1",
      role: "assistant",
      content: "抱歉，發生錯誤，請再試一次。",
      createdAt: "2026-05-14T09:32:00.000Z",
      status: "error",
      turnId: "a1b2c3d4-1111-4222-8333-0123456789ab",
    };

    const html = renderMessageBubble(message);

    assert.match(html, /sp-bubble-error/);
    assert.match(html, /引用碼/);
    assert.match(html, /t-a1b2c3d4/);
    assert.doesNotMatch(html, /sp-bubble-stopped/);
    assert.doesNotMatch(html, /sp-stopped-status/);
  });

  it("does not render reference codes for provisional status labels", () => {
    const message: Message = {
      id: "status-reference-free-1",
      role: "assistant",
      content: "思考中...",
      createdAt: "2026-05-14T09:33:00.000Z",
      turnId: "a1b2c3d4-1111-4222-8333-0123456789ab",
    };

    const html = renderMessageBubble(message, { isProvisional: true, isStatusLabel: true });

    assert.match(html, /sp-status-bubble/);
    assert.doesNotMatch(html, /引用碼/);
    assert.doesNotMatch(html, /t-a1b2c3d4/);
  });

  it("omits the reference line for assistant errors without a turn id", () => {
    const message: Message = {
      id: "missing-turn-reference-free-1",
      role: "assistant",
      content: "抱歉，發生錯誤，請再試一次。",
      createdAt: "2026-05-14T09:34:00.000Z",
      status: "error",
    };

    const html = renderMessageBubble(message);

    assert.doesNotMatch(html, /引用碼/);
    assert.doesNotMatch(html, /t-a1b2c3d4/);
    assert.doesNotMatch(html, /placeholder/i);
  });

  it("centralizes assistant reference rendering through formatTurnReference", async () => {
    const bubble = await readSource("client/src/components/MessageBubble.tsx");

    assert.match(bubble, /formatTurnReference/);
    assert.match(bubble, /formatTurnReference\(message\.turnId\)/);
  });

  it("passes Meal Edit callbacks from ChatPanel with chat origin", async () => {
    const chatPanel = await readSource("client/src/components/ChatPanel.tsx");
    const bubble = await readSource("client/src/components/MessageBubble.tsx");
    const payloadBuilder = await readSource("client/src/meal-edit-payload.ts");

    assert.match(chatPanel, /onOpenMealEdit=\{\(payload\) => openMealEdit\(payload, "chat"\)\}/);
    assert.doesNotMatch(chatPanel, /sp-chat-today-log/);
    for (const field of [
      "mealId",
      "mealRevisionId",
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
