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

describe("Chat bubble source contract", () => {
  it("keeps canonical Sport bubble and receipt class signals", async () => {
    const [messageBubble, chatPanel] = await Promise.all([
      readSource("../../client/src/components/MessageBubble.tsx"),
      readSource("../../client/src/components/ChatPanel.tsx"),
    ]);

    for (const expected of [
      "sp-bubble-asst",
      "sp-bubble-user",
      "sp-status-bubble",
      "sp-message-row",
      "sp-message-row-assistant",
      "sp-stream-caret",
      "sp-message-row-user",
      "sp-receipt",
      "sp-receipt-thumbnail-frame",
      "sp-receipt-thumbnail",
      "sp-receipt-thumbnail-fallback",
      "loggedMeal",
      "onOpenMealEdit",
      "SportBoltIcon",
      "SportChevronRightIcon",
      "PersistedAssetImage",
      "整餐照片",
      "編輯",
    ]) {
      assert.match(messageBubble, new RegExp(expected));
    }

    assert.match(chatPanel, /openMealEdit\(payload, \"chat\"\)/);
  });

  it("keeps receipt thumbnails inside ReceiptCard without direct image fallbacks", async () => {
    const messageBubble = await readSource("../../client/src/components/MessageBubble.tsx");
    const receiptCard = messageBubble.slice(
      messageBubble.indexOf("function ReceiptCard"),
      messageBubble.indexOf("function AssistantTextBubble"),
    );

    assert.match(receiptCard, /loggedMeal\.imageUrl/);
    assert.match(receiptCard, /PersistedAssetImage/);
    assert.match(receiptCard, /src=\{loggedMeal\.imageUrl\}/);
    assert.match(receiptCard, /alt=\{`\$\{loggedMeal\.foodName\} 整餐照片`\}/);
    assert.match(receiptCard, /imageAssetId: loggedMeal\.imageAssetId/);
    assert.match(receiptCard, /imageUrl: loggedMeal\.imageUrl/);
    assert.match(receiptCard, /loggedAt: loggedMeal\.loggedAt/);
    assert.match(receiptCard, /aria-label=\{canEdit \? `編輯 \$\{loggedMeal\.foodName\}` : undefined\}/);
    assert.doesNotMatch(receiptCard, /<img/);
    assert.doesNotMatch(receiptCard, /backgroundImage/);
    assert.doesNotMatch(receiptCard, /dangerouslySetInnerHTML/);
  });
});
