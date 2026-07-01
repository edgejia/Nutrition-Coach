import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MessageBubble } from "../../client/src/components/MessageBubble.js";
import { ProposalCard } from "../../client/src/components/ProposalCard.js";
import type { Message } from "../../client/src/types.js";

const root = fileURLToPath(new URL("../..", import.meta.url));

async function readSource(path: string) {
  return readFile(`${root}/${path}`, "utf8");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getCssRule(css: string, selector: string) {
  const selectorMatch = new RegExp(`(^|\\n)${escapeRegExp(selector)}(?:,|\\s*\\{)`).exec(css);
  assert.ok(selectorMatch?.index !== undefined, `Missing CSS selector: ${selector}`);
  const selectorIndex = selectorMatch.index + selectorMatch[1].length;
  const openIndex = css.indexOf("{", selectorIndex);
  const closeIndex = css.indexOf("}", openIndex);
  assert.ok(openIndex > selectorIndex && closeIndex > openIndex, `Malformed CSS selector: ${selector}`);
  return css.slice(openIndex + 1, closeIndex);
}

function getCssAtRuleBlock(css: string, atRule: string) {
  const startIndex = css.indexOf(atRule);
  assert.notEqual(startIndex, -1, `Missing CSS at-rule: ${atRule}`);
  const openIndex = css.indexOf("{", startIndex);
  assert.ok(openIndex > startIndex, `Malformed CSS at-rule: ${atRule}`);

  let depth = 0;
  for (let index = openIndex; index < css.length; index += 1) {
    const char = css[index];
    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    if (depth === 0) {
      return css.slice(openIndex + 1, index);
    }
  }

  assert.fail(`CSS at-rule should be closed: ${atRule}`);
}

function renderMessageBubble(message: Message, options?: { isProvisional?: boolean; isStatusLabel?: boolean }) {
  return renderToStaticMarkup(createElement(MessageBubble, { message, ...options }));
}

function renderProposalCard(props: Parameters<typeof ProposalCard>[0]) {
  return renderToStaticMarkup(createElement(ProposalCard, props));
}

const activeMealEstimateProposal = {
  proposalId: "proposal-meal-estimate-1",
  proposalKind: "meal_estimate" as const,
  proposalLane: "meal_mutation" as const,
  status: "active" as const,
  isActionable: true,
  title: "確認這個估值修改",
  details: {
    rows: [
      { label: "熱量", before: "520 kcal", after: "460 kcal" },
      { label: "蛋白質", value: "32 g" },
    ],
  },
  actions: {
    approveLabel: "套用修改",
    editLabel: "改成其他數字",
    rejectLabel: "取消提案",
  },
  expiresAt: "2026-04-29T08:00:00.000Z",
  lapseCopy: null,
  supersededByKind: null,
};

function proposalMessage(message: Partial<Message> = {}): Message {
  return {
    id: "proposal-message-1",
    role: "assistant",
    content: "我先把這次修改整理成提案。",
    createdAt: "2026-04-29T07:30:00.000Z",
    proposalCard: activeMealEstimateProposal,
    ...message,
  };
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
    assert.match(chatPanel, /foodName: "本機測試餐點"/);
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

  it("renders active proposal cards before assistant intro text with approve, edit, and reject controls", () => {
    const html = renderMessageBubble(proposalMessage());
    const cardIndex = html.indexOf("sp-proposal-card");
    const textIndex = html.indexOf("我先把這次修改整理成提案");

    assert.ok(cardIndex >= 0, "proposal card should render");
    assert.ok(textIndex > cardIndex, "assistant intro text should render after proposal card");
    assert.match(html, /確認這個估值修改/);
    assert.match(html, /熱量/);
    assert.match(html, /520 kcal/);
    assert.match(html, /460 kcal/);
    assert.match(html, /蛋白質/);
    assert.match(html, /32 g/);
    assert.match(html, /套用修改/);
    assert.match(html, /改成其他數字/);
    assert.match(html, /取消提案/);
    assert.match(html, /button/);
  });

  it("renders each proposal kind from backend labels and inactive lapse copy without parsing assistant text", () => {
    const cases = [
      {
        kind: "goal" as const,
        title: "確認每日目標",
        approveLabel: "套用目標",
        lapseCopy: "這個目標提案已超過 30 分鐘，請重新提出目標調整。",
      },
      {
        kind: "meal_numeric" as const,
        title: "確認餐點修改",
        approveLabel: "套用修改",
        lapseCopy: "這個餐點修改提案已超過 30 分鐘，請重新提出修改。",
      },
      {
        kind: "meal_estimate" as const,
        title: "確認估值修改",
        approveLabel: "套用修改",
        lapseCopy: "這個估值修改提案已超過 30 分鐘，請重新提出修改。",
      },
      {
        kind: "meal_delete" as const,
        title: "確認刪除餐點",
        approveLabel: "確認刪除",
        lapseCopy: "這個刪除確認已超過 30 分鐘，請重新選擇要刪除的餐點。",
      },
    ];

    for (const item of cases) {
      const html = renderMessageBubble(
        proposalMessage({
          content: "這段文字不含任何可解析的提案種類",
          proposalCard: {
            ...activeMealEstimateProposal,
            proposalId: `proposal-${item.kind}`,
            proposalKind: item.kind,
            proposalLane: item.kind === "goal" ? "goal" : "meal_mutation",
            status: "expired",
            isActionable: false,
            title: item.title,
            actions: {
              ...activeMealEstimateProposal.actions,
              approveLabel: item.approveLabel,
            },
            lapseCopy: item.lapseCopy,
          },
        }),
      );

      assert.match(html, new RegExp(escapeRegExp(item.title)));
      assert.match(html, new RegExp(escapeRegExp(item.lapseCopy)));
      assert.doesNotMatch(html, /<button/);
    }
  });

  it("renders approved and rejected proposal cards without inactive lapse paragraphs", () => {
    const terminalCases = [
      {
        status: "approved" as const,
        expectedStatusCopy: "已套用",
        staleCopy: "這個目標提案已超過 30 分鐘，請重新提出目標調整。",
      },
      {
        status: "rejected" as const,
        expectedStatusCopy: "已取消",
        staleCopy: "這個目標提案已被新的目標提案取代。",
      },
    ];

    for (const item of terminalCases) {
      const html = renderProposalCard({
        proposalCard: {
          ...activeMealEstimateProposal,
          proposalId: `goal-${item.status}`,
          proposalKind: "goal",
          proposalLane: "goal",
          status: item.status,
          isActionable: false,
          title: "每日目標提案",
          lapseCopy: item.staleCopy,
        },
      });

      assert.match(html, new RegExp(item.expectedStatusCopy));
      assert.doesNotMatch(html, /sp-proposal-lapse/);
      assert.doesNotMatch(html, new RegExp(escapeRegExp(item.staleCopy)));
      assert.doesNotMatch(html, /<button/);
    }
  });

  it("keeps stale and superseded cards inactive with explanatory lapse copy", () => {
    const cases = [
      { status: "stale" as const, lapseCopy: "這個提案已不是目前有效狀態，沒有更新任何資料。請重新提出需求。" },
      { status: "superseded" as const, lapseCopy: "這個目標提案已被新的目標提案取代。" },
    ];

    for (const item of cases) {
      const html = renderProposalCard({
        proposalCard: {
          ...activeMealEstimateProposal,
          proposalId: `goal-${item.status}`,
          proposalKind: "goal",
          proposalLane: "goal",
          status: item.status,
          isActionable: false,
          title: "每日目標提案",
          lapseCopy: item.lapseCopy,
        },
      });

      assert.match(html, /sp-proposal-lapse/);
      assert.match(html, new RegExp(escapeRegExp(item.lapseCopy)));
      assert.doesNotMatch(html, /<button/);
    }
  });

  it("renders structured proposal action events as user-side events distinct from typed bubbles", () => {
    const message: Message = {
      id: "proposal-action-event-1",
      role: "user",
      content: "這段文字不應該成為普通使用者泡泡",
      createdAt: "2026-04-29T07:35:00.000Z",
      proposalActionEvent: {
        proposalId: "proposal-meal-estimate-1",
        proposalKind: "meal_estimate",
        proposalLane: "meal_mutation",
        action: "approve",
        transcriptCopy: "已選擇套用餐點修改",
        createdAt: "2026-04-29T07:35:00.000Z",
      },
    };

    const html = renderMessageBubble(message);

    assert.match(html, /sp-proposal-action-event/);
    assert.match(html, /已選擇套用餐點修改/);
    assert.doesNotMatch(html, /sp-bubble-user/);
    assert.doesNotMatch(html, /這段文字不應該成為普通使用者泡泡/);
  });

  it("renders proposal action completion replies through the normal assistant bubble path", () => {
    const message: Message = {
      id: "proposal-action-reply-1",
      role: "assistant",
      content: "已完成這次餐點修改。",
      createdAt: "2026-04-29T07:35:01.000Z",
    };

    const html = renderMessageBubble(message);

    assert.match(html, /sp-bubble-asst/);
    assert.match(html, /已完成這次餐點修改。/);
    assert.doesNotMatch(html, /sp-proposal-action-event/);
    assert.doesNotMatch(html, /提案動作/);
  });

  it("renders delete proposal approval as destructive confirmation while reject stays non-destructive", () => {
    const html = renderMessageBubble(
      proposalMessage({
        proposalCard: {
          ...activeMealEstimateProposal,
          proposalId: "proposal-delete-1",
          proposalKind: "meal_delete",
          title: "確認刪除這筆餐點",
          actions: {
            approveLabel: "確認刪除",
            editLabel: "先不要刪，改問別的",
            rejectLabel: "取消刪除",
          },
        },
      }),
    );

    assert.match(html, /確認刪除/);
    assert.match(html, /sp-proposal-danger/);
    assert.match(html, /取消刪除/);
    assert.doesNotMatch(html, /sp-proposal-reject[^"]*sp-proposal-danger/);
  });

  it("keeps proposal rendering sourced from metadata and styled with Sport-safe card controls", async () => {
    const card = await readSource("client/src/components/ProposalCard.tsx");
    const bubble = await readSource("client/src/components/MessageBubble.tsx");
    const css = await readSource("client/src/app.css");

    assert.match(card, /proposalCard/);
    assert.match(card, /details\.rows/);
    assert.doesNotMatch(card, /message\.content/);
    assert.doesNotMatch(card, /includes\(/);
    assert.doesNotMatch(card, /確認刪除[\s\S]*proposalKind/);

    assert.match(bubble, /message\.proposalCard/);
    assert.match(bubble, /message\.proposalActionEvent/);
    assert.match(bubble, /ReceiptCard/);

    assert.match(css, /\.sp-proposal-card/);
    assert.match(css, /width:\s*min\(92%, 320px\)/);
    assert.match(css, /max-width:\s*92%/);
    assert.match(css, /min-height:\s*44px/);
    assert.match(css, /var\(--sp-lime\)/);
    assert.match(css, /var\(--sp-red\)/);
    assert.match(css, /var\(--sp-font-zh\)/);
    assert.match(css, /var\(--sp-font-mono\)/);
  });

  it("keeps proposal CSS on the Phase 90 spacing scale and reserves lime for controls", async () => {
    const css = await readSource("client/src/app.css");
    const proposalSelectors = [
      ".sp-proposal-head",
      ".sp-proposal-row",
      ".sp-proposal-actions",
      ".sp-proposal-action",
      ".sp-proposal-lapse",
      ".sp-proposal-inline-edit",
      ".sp-proposal-inline-input",
    ];

    for (const selector of proposalSelectors) {
      const rule = getCssRule(css, selector);
      assert.doesNotMatch(rule, /padding:\s*12px 14px(?: 14px)?/);
      assert.doesNotMatch(rule, /padding:\s*10px 12px/);
    }

    assert.doesNotMatch(getCssRule(css, ".sp-proposal-row strong"), /var\(--sp-lime\)/);
    assert.match(getCssRule(css, ".sp-proposal-action"), /min-height:\s*44px/);
    assert.match(getCssRule(css, ".sp-proposal-inactive .sp-proposal-head h3"), /var\(--sp-ink-2\)/);
  });

  it("keeps browser-preview proposal row stacking scoped to proposal selectors", async () => {
    const css = await readSource("client/src/app.css");
    const previewBlock = getCssAtRuleBlock(css, "@media (max-width: 430px)");

    assert.match(previewBlock, /\.sp-proposal-row\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s);
    assert.match(previewBlock, /\.sp-proposal-row\s*\{[^}]*align-items:\s*start/s);
    assert.match(previewBlock, /\.sp-proposal-row span:last-child\s*\{[^}]*justify-content:\s*flex-start/s);
    assert.match(previewBlock, /\.sp-proposal-row span:last-child\s*\{[^}]*text-align:\s*left/s);
    assert.doesNotMatch(previewBlock, /\.sp-chat-textarea|\.sp-chat-input|\.screen-scroll|\.sp-receipt-row/);
  });

  it("renders an empty focused inline edit input with backend numeric hint and distinct close control", () => {
    const html = renderProposalCard({
      proposalCard: activeMealEstimateProposal,
      activeEdit: {
        messageId: "proposal-message-1",
        proposalId: activeMealEstimateProposal.proposalId,
        value: "",
      },
      onInlineEditChange: () => {},
      onInlineEditSubmit: () => {},
      onCancelEdit: () => {},
    });

    assert.match(html, /sp-proposal-inline-edit/);
    assert.match(html, /autoFocus|autofocus/);
    assert.match(html, /輸入明確數字，例如：熱量改 460 kcal 或蛋白質改 30g/);
    assert.doesNotMatch(html, /熱量再低一點/);
    assert.match(html, /關閉編輯/);
    assert.match(html, /送出/);
    assert.doesNotMatch(html, /sp-proposal-inline-cancel[^>]*>取消提案/);
  });

  it("disables active proposal actions and exposes pending copy for the matching request", () => {
    const html = renderProposalCard({
      proposalCard: activeMealEstimateProposal,
      isActionPending: true,
      onApprove: () => {},
      onEdit: () => {},
      onReject: () => {},
    } as Parameters<typeof ProposalCard>[0] & { isActionPending: boolean });

    assert.match(html, /aria-busy="true"/);
    assert.match(html, /處理中\.\.\./);
    assert.match(html, /disabled="">套用修改/);
    assert.match(html, /disabled="">改成其他數字/);
    assert.match(html, /disabled="">取消提案/);
  });

  it("renders deterministic proposal action error copy without retiring the active card", () => {
    const html = renderProposalCard({
      proposalCard: activeMealEstimateProposal,
      actionError: "這個提案目前無法處理，可能已過期或被新的提案取代。請重新提出需求。",
      onApprove: () => {},
      onEdit: () => {},
      onReject: () => {},
    } as Parameters<typeof ProposalCard>[0] & { actionError: string });

    assert.match(html, /這個提案目前無法處理，可能已過期或被新的提案取代。請重新提出需求。/);
    assert.match(html, /套用修改/);
    assert.match(html, /改成其他數字/);
    assert.match(html, /取消提案/);
  });

  it("disables inline edit submit while the trimmed edit value is empty", () => {
    const html = renderProposalCard({
      proposalCard: activeMealEstimateProposal,
      activeEdit: {
        messageId: "proposal-message-1",
        proposalId: activeMealEstimateProposal.proposalId,
        value: "   ",
      },
      onInlineEditChange: () => {},
      onInlineEditSubmit: () => {},
      onCancelEdit: () => {},
    });

    assert.match(html, /class="sp-proposal-action sp-proposal-inline-send" type="submit" disabled=""[^>]*>送出/);
    assert.match(html, /aria-disabled="true"/);
  });

  it("enables inline edit submit when the edit value contains text", () => {
    const html = renderProposalCard({
      proposalCard: activeMealEstimateProposal,
      activeEdit: {
        messageId: "proposal-message-1",
        proposalId: activeMealEstimateProposal.proposalId,
        value: "熱量改 480 kcal",
      },
      onInlineEditChange: () => {},
      onInlineEditSubmit: () => {},
      onCancelEdit: () => {},
    });

    assert.doesNotMatch(html, /sp-proposal-inline-send" type="submit" disabled/);
  });

  it("wires ChatPanel inline edit through one active state, composer lock, and proposal context send", async () => {
    const chatPanel = await readSource("client/src/components/ChatPanel.tsx");
    const bubble = await readSource("client/src/components/MessageBubble.tsx");
    const proposalCard = await readSource("client/src/components/ProposalCard.tsx");

    assert.match(chatPanel, /activeProposalEdit/);
    assert.match(chatPanel, /setActiveProposalEdit/);
    assert.match(chatPanel, /pendingProposalActionById/);
    assert.match(chatPanel, /setPendingProposalActionById/);
    assert.match(chatPanel, /proposalActionErrorById/);
    assert.match(chatPanel, /setProposalActionErrorById/);
    assert.match(chatPanel, /messageId/);
    assert.match(chatPanel, /proposalId/);
    assert.match(chatPanel, /setActiveProposalEdit\(null\)/);
    assert.match(chatPanel, /sendProposalAction\(\{/);
    assert.match(chatPanel, /action: "approve"/);
    assert.match(chatPanel, /action: "reject"/);
    assert.match(chatPanel, /proposalContext:\s*\{/);
    assert.match(chatPanel, /action: "edit"/);
    assert.match(chatPanel, /handleSend\([^,\n]+,\s*undefined,/);
    assert.match(chatPanel, /activeProposalEdit\s*\?\s*true\s*:\s*isChatLocked/);
    assert.match(chatPanel, /onProposalApprove=/);
    assert.match(chatPanel, /onProposalEdit=/);
    assert.match(chatPanel, /onProposalReject=/);
    assert.match(chatPanel, /activeEdit=/);
    assert.match(chatPanel, /pendingAction=/);
    assert.match(chatPanel, /actionError=/);
    assert.match(chatPanel, /finally/);
    assert.match(chatPanel, /這個提案目前無法處理，可能已過期或被新的提案取代。請重新提出需求。/);
    assert.doesNotMatch(chatPanel, /關閉編輯[\s\S]{0,240}sendProposalAction/);

    assert.match(bubble, /pendingAction/);
    assert.match(bubble, /actionError/);
    assert.match(proposalCard, /autoFocus/);
    assert.match(proposalCard, /sp-proposal-inline-edit/);
    assert.match(proposalCard, /關閉編輯/);
  });

  it("keeps inline proposal edit keyboard handling IME-safe and submit guarded", async () => {
    const proposalCard = await readSource("client/src/components/ProposalCard.tsx");
    const chatInput = await readSource("client/src/components/ChatInput.tsx");

    assert.match(chatInput, /e\.nativeEvent\.isComposing/);
    assert.match(proposalCard, /isComposingRef/);
    assert.match(proposalCard, /event\.nativeEvent\.isComposing/);
    assert.match(proposalCard, /onCompositionStart=\{\(\) => \{/);
    assert.match(proposalCard, /onCompositionEnd=\{\(\) => \{/);
    assert.match(proposalCard, /if \(event\.key !== "Enter"\) return;/);
    assert.match(proposalCard, /if \(event\.shiftKey\) return;/);
    assert.match(proposalCard, /event\.preventDefault\(\);/);
    assert.match(proposalCard, /canSubmitInlineEdit/);
    assert.match(proposalCard, /if \(!canSubmitInlineEdit\) \{/);
    assert.match(proposalCard, /onInlineEditSubmit\?\.\(\)/);
  });

  it("appends proposal action replies as assistant messages after the user action event", async () => {
    const chatPanel = await readSource("client/src/components/ChatPanel.tsx");

    assert.match(chatPanel, /function appendProposalActionReply\(reply: string\)/);
    assert.match(chatPanel, /createClientId\("ast-action"\)/);
    assert.match(chatPanel, /role: "assistant"/);
    assert.match(chatPanel, /content: trimmedReply/);
    assert.match(chatPanel, /result\.reply/);

    const okBranch = chatPanel.match(/if \(result\.ok\) \{[\s\S]*?\n\s*\}/)?.[0] ?? "";
    const actionEventIndex = okBranch.indexOf("appendProposalActionEvent(result.proposalActionEvent)");
    const replyIndex = okBranch.indexOf("appendProposalActionReply(result.reply)");
    assert.ok(actionEventIndex >= 0, "ChatPanel should append the structured proposal action event");
    assert.ok(replyIndex > actionEventIndex, "assistant completion reply should be appended after the action event");
  });

  it("appends retryable and idempotent non-ok proposal replies without success events", async () => {
    const chatPanel = await readSource("client/src/components/ChatPanel.tsx");
    const nonOkBranch = chatPanel.match(/if \(!result\.ok\) \{[\s\S]*?return;\s*\n\s*\}/)?.[0] ?? "";

    assert.match(
      nonOkBranch,
      /result\.status === "retryable" \|\| result\.status === "idempotent"/,
      "source-only proof: residual risk is runtime wiring, covered by transport and typed /api/chat tests",
    );
    assert.match(nonOkBranch, /appendProposalActionReply\(result\.reply\)/);
    assert.doesNotMatch(nonOkBranch, /appendProposalActionEvent/);
    assert.doesNotMatch(nonOkBranch, /proposalActionEvent/);
    assert.doesNotMatch(nonOkBranch, /setDailyTargets/);
    assert.doesNotMatch(nonOkBranch, /setDailySummary/);
    assert.doesNotMatch(nonOkBranch, /refreshTodayMeals/);

    const nonOkIndex = chatPanel.indexOf("if (!result.ok)");
    const okIndex = chatPanel.indexOf("if (result.ok)");
    assert.ok(nonOkIndex >= 0, "ChatPanel should contain a distinct non-ok branch");
    assert.ok(okIndex > nonOkIndex, "success side effects should remain in the later ok branch");
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

  it("does not render pre-send unsupported upload validation through assistant bubbles", async () => {
    const bubble = await readSource("client/src/components/MessageBubble.tsx");
    const uploadCopy = "目前只支援 JPG、PNG、WebP 照片。iPhone HEIC 請先轉成 JPG 後再上傳。";

    assert.doesNotMatch(bubble, new RegExp(escapeRegExp(uploadCopy)));
    assert.doesNotMatch(bubble, /sp-chat-upload-error/);
    assert.doesNotMatch(bubble, /meal\.heic/);
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
