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
      "loggedMeal",
      "onOpenMealEdit",
      "SportBoltIcon",
      "SportChevronRightIcon",
      "PersistedAssetImage",
    ]) {
      assert.match(messageBubble, new RegExp(expected));
    }

    assert.match(chatPanel, /openMealEdit\(payload, \"chat\"\)/);
  });
});
