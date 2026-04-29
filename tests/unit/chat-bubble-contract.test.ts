import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));

async function readSource(path: string) {
  return readFile(`${root}/${path}`, "utf8");
}

describe("chat bubble source contract", () => {
  it("renders recorded meal cards only from structured data and no action buttons", async () => {
    const bubble = await readSource("client/src/components/MessageBubble.tsx");

    assert.match(bubble, /已記錄 ✓/);
    assert.match(bubble, /message\.didLogMeal === true/);
    assert.match(bubble, /loggedMeal/);
    assert.match(bubble, /熱量/);
    assert.match(bubble, /蛋白/);
    assert.match(bubble, /碳水/);
    assert.match(bubble, /脂肪/);
    assert.match(bubble, /Number\.isFinite/);
    assert.match(bubble, /sk-box-soft/);
    assert.match(bubble, /sk-caret/);
    assert.match(bubble, /AssistantMarkdown/);
    assert.match(bubble, /PersistedAssetImage/);
    assert.match(bubble, /onImageSettle/);
    assert.doesNotMatch(bubble, /調整/);
    assert.doesNotMatch(bubble, /不對/);
    assert.doesNotMatch(bubble, /刪除/);
    assert.doesNotMatch(bubble, /查看今日餐點/);
  });

  it("does not wire logged meal bubbles to the Meal Edit secondary screen", async () => {
    const chatPanel = await readSource("client/src/components/ChatPanel.tsx");
    const legacyActionTarget = 'openSecondaryScreen("mealEdit", "chat")';

    assert.doesNotMatch(chatPanel, /onOpenSummary=\{m\.didLogMeal/);
    assert.doesNotMatch(chatPanel, new RegExp(legacyActionTarget.replace(/[()"]/g, "\\$&")));
  });
});
