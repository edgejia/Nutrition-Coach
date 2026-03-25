import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createDb } from "../../server/db/client.js";
import { createDeviceService } from "../../server/services/device.js";
import { createChatService } from "../../server/services/chat.js";
import { loadHistory } from "../../server/orchestrator/history.js";

describe("loadHistory", () => {
  let chatService: ReturnType<typeof createChatService>;
  let deviceId: string;

  beforeEach(async () => {
    const db = createDb(":memory:");
    const deviceService = createDeviceService(db);
    chatService = createChatService(db);
    deviceId = (await deviceService.createDevice("fat_loss")).deviceId;
  });

  it("returns empty array for new device", async () => {
    const history = await loadHistory(chatService, deviceId, 10);
    assert.equal(history.length, 0);
  });

  it("returns compressed history as ChatMessage array", async () => {
    const compressedHistorySource = {
      async getCompressedHistory() {
        return [
          { role: "user", content: "我吃了蘋果\n[附帶圖片]" },
          { role: "assistant", content: "[使用 analyze_food → 蘋果, 95kcal]" },
        ];
      },
    };
    const history = await loadHistory(compressedHistorySource, deviceId, 10);
    assert.equal(history.length, 2);
    assert.equal(history[0].role, "user");
    assert.match(String(history[1].content), /\[使用 analyze_food/);
  });
});
