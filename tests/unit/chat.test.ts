// tests/unit/chat.test.ts
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createDb } from "../../server/db/client.js";
import { createDeviceService } from "../../server/services/device.js";
import { createChatService } from "../../server/services/chat.js";
import { createFoodLoggingService } from "../../server/services/food-logging.js";
import { formatLocalDate } from "../../server/lib/time.js";

describe("ChatService", () => {
  let chatService: ReturnType<typeof createChatService>;
  let foodLoggingService: ReturnType<typeof createFoodLoggingService>;
  let deviceId: string;

  beforeEach(async () => {
    const db = createDb(":memory:");
    const deviceService = createDeviceService(db);
    chatService = createChatService(db);
    foodLoggingService = createFoodLoggingService(db);
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

  it("projects loggedMeal receipt for persisted meal-logging assistant replies", async () => {
    await chatService.saveMessage(deviceId, "user", "(圖片)", { imagePath: "asset:lunch-image" });
    await foodLoggingService.logGroupedMeal(deviceId, {
      items: [
        { foodName: "煎肉餅", calories: 420, protein: 24, carbs: 6, fat: 32 },
        { foodName: "漢堡排", calories: 100, protein: 8, carbs: 2, fat: 6 },
      ],
      imagePath: "asset:lunch-image",
    });
    await chatService.saveMessage(deviceId, "tool", "成功", { toolName: "log_food" });
    await chatService.saveMessage(deviceId, "assistant", "已先依照片做保守估算並完成記錄。");

    const history = await chatService.getHistory(deviceId, 50);
    const assistant = history.find((message) => message.role === "assistant");

    assert.equal(assistant?.didLogMeal, true);
    assert.ok(assistant?.loggedMeal);
    assert.match(assistant.loggedMeal.mealId ?? "", /^[0-9a-f-]{36}$/);
    assert.equal(assistant.loggedMeal.dateKey, formatLocalDate(new Date(assistant.loggedMeal.loggedAt ?? "")));
    assert.deepEqual(assistant.loggedMeal, {
      mealId: assistant.loggedMeal.mealId,
      dateKey: assistant.loggedMeal.dateKey,
      loggedAt: assistant.loggedMeal.loggedAt,
      imageAssetId: "lunch-image",
      imageUrl: "/api/assets/lunch-image",
      foodName: "煎肉餅、漢堡排",
      calories: 520,
      protein: 32,
      carbs: 8,
      fat: 38,
    });
    assert.equal("countedSources" in assistant.loggedMeal, false);
    assert.equal("excludedSources" in assistant.loggedMeal, false);
    assert.equal("usedConservativeAssumption" in assistant.loggedMeal, false);
    assert.equal("confidence" in assistant.loggedMeal, false);
    assert.equal("estimate" in assistant.loggedMeal, false);
  });

  it("projects loggedMeal receipt for persisted update_meal assistant replies", async () => {
    const loggedMeal = await foodLoggingService.logFood(deviceId, {
      foodName: "牛肉麵",
      calories: 520,
      protein: 24,
      carbs: 68,
      fat: 16,
      loggedAt: "2026-03-25T12:00:00.000Z",
    });
    await chatService.saveMessage(deviceId, "user", "把 2026-03-25 的牛肉麵改成半碗");
    const updatedMeal = await foodLoggingService.updateMeal(deviceId, loggedMeal.id, {
      items: [
        { foodName: "半碗牛肉麵", calories: 360, protein: 20, carbs: 45, fat: 10 },
      ],
    });
    await chatService.saveMessage(deviceId, "tool", "成功", { toolName: "update_meal" });
    await chatService.saveMessage(deviceId, "assistant", "已幫你更新 3/25 的牛肉麵。");

    const history = await chatService.getHistory(deviceId, 50);
    const assistant = history.find((message) => message.role === "assistant");

    assert.equal(assistant?.didLogMeal, true);
    assert.ok(assistant?.loggedMeal);
    assert.deepEqual(assistant.loggedMeal, {
      mealId: updatedMeal.id,
      dateKey: "2026-03-25",
      loggedAt: updatedMeal.loggedAt,
      imageAssetId: null,
      imageUrl: null,
      foodName: "半碗牛肉麵",
      calories: 360,
      protein: 20,
      carbs: 45,
      fat: 10,
    });
    assert.equal("countedSources" in assistant.loggedMeal, false);
    assert.equal("excludedSources" in assistant.loggedMeal, false);
    assert.equal("usedConservativeAssumption" in assistant.loggedMeal, false);
    assert.equal("confidence" in assistant.loggedMeal, false);
    assert.equal("estimate" in assistant.loggedMeal, false);
  });

  it("does not project failed log_food tool attempts as editable receipts", async () => {
    await foodLoggingService.logFood(deviceId, {
      foodName: "雞胸便當",
      calories: 620,
      protein: 42,
      carbs: 72,
      fat: 18,
    });
    await chatService.saveMessage(deviceId, "user", "我吃了不確定的東西");
    await chatService.saveMessage(deviceId, "tool", "需要更多資訊", { toolName: "log_food" });
    await chatService.saveMessage(deviceId, "assistant", "我需要份量或照片才能幫你記錄。");

    const history = await chatService.getHistory(deviceId, 50);
    const assistant = history.find((message) => message.role === "assistant");

    assert.equal(assistant?.didLogMeal, undefined);
    assert.equal(assistant?.loggedMeal, undefined);
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
