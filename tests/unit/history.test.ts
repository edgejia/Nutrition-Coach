import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createDb } from "../../server/db/client.js";
import { createDeviceService } from "../../server/services/device.js";
import { createChatService } from "../../server/services/chat.js";
import { loadHistory } from "../../server/orchestrator/history.js";
import { chatMutationOutcomes } from "../../server/db/schema.js";

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

  it("D-14/D-19 does not derive scoped mutation markers from successful tool strings", async () => {
    const db = createDb(":memory:");
    const deviceService = createDeviceService(db);
    const chatSvc = createChatService(db);
    const did = (await deviceService.createDevice("fat_loss")).deviceId;

    await chatSvc.saveMessage(did, "user", "我吃了午餐");
    await chatSvc.saveMessage(did, "tool", "成功", { toolName: "log_food" });
    await chatSvc.saveMessage(did, "tool", "成功", { toolName: "update_meal" });
    await chatSvc.saveMessage(did, "tool", "成功", { toolName: "delete_meal" });
    await chatSvc.saveMessage(did, "tool", "熱量: 500kcal", { toolName: "get_daily_summary" });
    await chatSvc.saveMessage(did, "assistant", "已記錄完成！");

    const history = await loadHistory(chatSvc, did, 10);
    const allContent = history.map((m) => String(m.content)).join("\n");
    assert.doesNotMatch(allContent, /log_food|get_daily_summary/);
    assert.doesNotMatch(allContent, /系統已完成餐點記錄/);
    assert.doesNotMatch(allContent, /系統已完成餐點修改/);
    assert.doesNotMatch(allContent, /系統已完成餐點刪除/);
    assert.match(allContent, /系統已更新今日攝取摘要/);
  });

  it("D-13/D-19 renders compressed mutation facts from valid persisted outcome rows only", async () => {
    const db = createDb(":memory:");
    const deviceService = createDeviceService(db);
    const chatSvc = createChatService(db);
    const did = (await deviceService.createDevice("fat_loss")).deviceId;

    await chatSvc.saveMessage(did, "user", "幫我記一下晚餐");
    const validAssistant = await chatSvc.saveMessage(did, "assistant", "已處理。");
    const invalidAssistant = await chatSvc.saveMessage(did, "assistant", "也處理了。");

    await db.insert(chatMutationOutcomes).values({
      id: "structured-valid-log",
      deviceId: did,
      assistantMessageId: validAssistant.id,
      toolMessageId: null,
      action: "log_food",
      affectedDate: "2026-03-25",
      foodName: "雞腿便當",
      calories: 640,
      protein: 30,
      carbs: 78,
      fat: 20,
      goalCalories: null,
      goalProtein: null,
      goalCarbs: null,
      goalFat: null,
      updatedGoalFields: null,
      createdAt: new Date().toISOString(),
    });
    await db.insert(chatMutationOutcomes).values({
      id: "structured-invalid-log",
      deviceId: did,
      assistantMessageId: invalidAssistant.id,
      toolMessageId: null,
      action: "log_food",
      affectedDate: "2026-03-25",
      foodName: null,
      calories: null,
      protein: null,
      carbs: null,
      fat: null,
      goalCalories: null,
      goalProtein: null,
      goalCarbs: null,
      goalFat: null,
      updatedGoalFields: null,
      createdAt: new Date().toISOString(),
    });

    const history = await loadHistory(chatSvc, did, 10);
    const allContent = history.map((message) => String(message.content)).join("\n");

    assert.match(allContent, /系統已記錄餐點：2026-03-25 雞腿便當/);
    assert.match(allContent, /640 kcal/);
    assert.equal((allContent.match(/系統已記錄餐點/g) ?? []).length, 1);
  });
});
