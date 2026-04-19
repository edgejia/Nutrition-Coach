// tests/unit/chat.test.ts
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createDb } from "../../server/db/client.js";
import { createDeviceService } from "../../server/services/device.js";
import { createChatService } from "../../server/services/chat.js";

describe("ChatService", () => {
  let chatService: ReturnType<typeof createChatService>;
  let deviceId: string;

  beforeEach(async () => {
    const db = createDb(":memory:");
    const deviceService = createDeviceService(db);
    chatService = createChatService(db);
    deviceId = (await deviceService.createDevice("fat_loss")).deviceId;
  });

  it("saves and retrieves messages", async () => {
    await chatService.saveMessage(deviceId, "user", "我吃了一顆蘋果");
    await chatService.saveMessage(deviceId, "assistant", "已記錄！");
    const history = await chatService.getHistory(deviceId, 50);
    assert.equal(history.length, 2);
    assert.equal(history[0].role, "user");
    assert.equal(history[1].role, "assistant");
  });

  it("saves tool messages with tool name", async () => {
    await chatService.saveMessage(deviceId, "user", "我吃了蘋果");
    await chatService.saveMessage(deviceId, "tool", "分析完成", { toolName: "analyze_food" });
    const history = await chatService.getHistory(deviceId, 50);
    assert.equal(history.length, 1); // getHistory only returns user + assistant
    const compressed = await chatService.getCompressedHistory(deviceId, 10);
    // analyze_food uses generic fallback (not log_food or get_daily_summary)
    assert.doesNotMatch(compressed[1].content, /log_food|get_daily_summary/);
    assert.match(compressed[1].content, /系統工具已完成/);
  });

  it("persists user image metadata", async () => {
    await chatService.saveMessage(deviceId, "user", "這是我的午餐", { imagePath: "asset:lunch-image" });
    const history = await chatService.getHistory(deviceId, 50);
    assert.equal(history.length, 1);
    assert.equal(history[0].imagePath, "asset:lunch-image");
  });

  it("loads compressed history for LLM context", async () => {
    await chatService.saveMessage(deviceId, "user", "我吃了蘋果", { imagePath: "asset:apple-image" });
    await chatService.saveMessage(deviceId, "tool", "蘋果, 95kcal", { toolName: "analyze_food" });
    await chatService.saveMessage(deviceId, "tool", "成功", { toolName: "log_food" });
    await chatService.saveMessage(deviceId, "assistant", "已記錄蘋果！");
    const compressed = await chatService.getCompressedHistory(deviceId, 10);
    assert.ok(compressed.length > 0);
    assert.match(compressed[0].content, /\[附帶圖片\]/);
    // log_food tool should use human-safe summary, not raw identifier
    const allContent = compressed.map((m) => m.content).join("\n");
    assert.match(allContent, /系統已完成餐點記錄/);
    assert.doesNotMatch(allContent, /log_food|get_daily_summary/);
  });

  it("loads the most recent turns instead of stale oldest history", async () => {
    for (let i = 1; i <= 12; i++) {
      await chatService.saveMessage(deviceId, "user", `第${i}次`);
      await chatService.saveMessage(deviceId, "assistant", `回覆${i}`);
    }
    const compressed = await chatService.getCompressedHistory(deviceId, 10);
    const text = compressed.map((msg) => msg.content).join("\n");
    assert.match(text, /第12次/);
    assert.doesNotMatch(text, /第1次/);
  });
});
