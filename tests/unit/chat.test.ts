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
    assert.match(compressed[1].content, /\[使用 analyze_food → 分析完成\]/);
  });

  it("persists user image metadata", async () => {
    await chatService.saveMessage(deviceId, "user", "這是我的午餐", { imagePath: "server/uploads/lunch.png" });
    const history = await chatService.getHistory(deviceId, 50);
    assert.equal(history.length, 1);
    assert.equal(history[0].imagePath, "server/uploads/lunch.png");
  });

  it("marks assistant history items with didLogMeal when preceded by log_food", async () => {
    await chatService.saveMessage(deviceId, "user", "我吃了蘋果");
    await chatService.saveMessage(deviceId, "tool", "成功", { toolName: "log_food" });
    await chatService.saveMessage(deviceId, "assistant", "已記錄蘋果！");

    const history = await chatService.getHistory(deviceId, 50);
    assert.equal(history[1].didLogMeal, true);
  });

  it("preserves the requested visible-message limit even when a turn has many tool rows", async () => {
    await chatService.saveMessage(deviceId, "user", "幫我記錄晚餐");
    for (let i = 1; i <= 10; i++) {
      await chatService.saveMessage(deviceId, "tool", `工具結果${i}`, { toolName: `tool_${i}` });
    }
    await chatService.saveMessage(deviceId, "assistant", "已記錄晚餐！");

    const history = await chatService.getHistory(deviceId, 2);
    assert.equal(history.length, 2);
    assert.deepEqual(history.map((message) => message.role), ["user", "assistant"]);
  });

  it("keeps didLogMeal=true for the returned assistant even when log_food is outside a naive raw-row window", async () => {
    await chatService.saveMessage(deviceId, "user", "幫我記錄午餐");
    await chatService.saveMessage(deviceId, "tool", "成功", { toolName: "log_food" });
    for (let i = 1; i <= 5; i++) {
      await chatService.saveMessage(deviceId, "tool", `後續工具${i}`, { toolName: `tool_${i}` });
    }
    await chatService.saveMessage(deviceId, "assistant", "已記錄午餐！");

    const history = await chatService.getHistory(deviceId, 1);
    assert.equal(history.length, 1);
    assert.equal(history[0].role, "assistant");
    assert.equal(history[0].didLogMeal, true);
  });

  it("loads compressed history for LLM context", async () => {
    await chatService.saveMessage(deviceId, "user", "我吃了蘋果", { imagePath: "server/uploads/apple.png" });
    await chatService.saveMessage(deviceId, "tool", "蘋果, 95kcal", { toolName: "analyze_food" });
    await chatService.saveMessage(deviceId, "tool", "成功", { toolName: "log_food" });
    await chatService.saveMessage(deviceId, "assistant", "已記錄蘋果！");
    const compressed = await chatService.getCompressedHistory(deviceId, 10);
    assert.ok(compressed.length > 0);
    assert.match(compressed[0].content, /\[附帶圖片\]/);
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
