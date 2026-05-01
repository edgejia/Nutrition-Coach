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

    assert.match(bubble, /getCompleteReceiptEditPayload/);
    for (const field of [
      "mealId",
      "dateKey",
      "foodName",
      "calories",
      "protein",
      "carbs",
      "fat",
    ]) {
      assert.match(bubble, new RegExp(`loggedMeal\\.${field}`));
    }

    assert.match(bubble, /MealEditPayload/);
    assert.match(bubble, /onOpenMealEdit\?\.\(editPayload\)/);
    assert.match(bubble, /SportChevronRightIcon/);
    assert.match(bubble, /Number\.isFinite/);
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

    assert.match(chatPanel, /onOpenMealEdit=\{\(payload\) => openMealEdit\(payload, "chat"\)\}/);
    assert.match(chatPanel, /openMealEdit\(\s*\{/);
    assert.match(chatPanel, /}\s*,\s*"chat"\s*\)/);
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
      assert.match(chatPanel, new RegExp(`${field}:`));
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
  });
});
