// tests/unit/chat.test.ts
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createDb } from "../../server/db/client.js";
import { createDeviceService } from "../../server/services/device.js";
import { createChatService } from "../../server/services/chat.js";
import { createFoodLoggingService } from "../../server/services/food-logging.js";
import { formatLocalDate } from "../../server/lib/time.js";
import {
  chatMealReceipts,
  chatMessages,
  chatMutationOutcomes,
  mealRevisions,
  mealTransactions,
} from "../../server/db/schema.js";
import { eq } from "drizzle-orm";

describe("ChatService", () => {
  let db: ReturnType<typeof createDb>;
  let chatService: ReturnType<typeof createChatService>;
  let foodLoggingService: ReturnType<typeof createFoodLoggingService>;
  let deviceId: string;

  beforeEach(async () => {
    db = createDb(":memory:");
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

  it("restores loggedMeal receipt from explicit assistant mealRevisionId identity", async () => {
    await chatService.saveMessage(deviceId, "user", "(圖片)", { imagePath: "asset:lunch-image" });
    const loggedMeal = await foodLoggingService.logGroupedMeal(deviceId, {
      items: [
        { foodName: "煎肉餅", calories: 420, protein: 24, carbs: 6, fat: 32 },
        { foodName: "漢堡排", calories: 100, protein: 8, carbs: 2, fat: 6 },
      ],
      imagePath: "asset:lunch-image",
    });
    const tool = await chatService.saveMessage(deviceId, "tool", "成功", { toolName: "log_food" });
    const assistantMessage = await chatService.saveMessage(deviceId, "assistant", "已先依照片做保守估算並完成記錄。");
    await chatService.saveMealReceiptReference({
      deviceId,
      assistantMessageId: assistantMessage.id,
      toolMessageId: tool.id,
      mealTransactionId: loggedMeal.id,
      mealRevisionId: loggedMeal.mealRevisionId,
    });

    const history = await chatService.getHistory(deviceId, 50);
    const assistant = history.find((message) => message.role === "assistant");

    assert.equal(assistant?.didLogMeal, true);
    assert.ok(assistant?.loggedMeal);
    assert.equal((assistant.loggedMeal as unknown as Record<string, unknown>).receiptStatus, "active");
    assert.match(assistant.loggedMeal.mealId ?? "", /^[0-9a-f-]{36}$/);
    assert.equal(assistant.loggedMeal.dateKey, formatLocalDate(new Date(assistant.loggedMeal.loggedAt ?? "")));
    assert.deepEqual(assistant.loggedMeal, {
      receiptStatus: "active",
      mealId: assistant.loggedMeal.mealId,
      dateKey: assistant.loggedMeal.dateKey,
      mealRevisionId: loggedMeal.mealRevisionId,
      loggedAt: assistant.loggedMeal.loggedAt,
      imageAssetId: "lunch-image",
      imageUrl: "/api/assets/lunch-image",
      foodName: "煎肉餅、漢堡排",
      itemCount: 2,
      calories: 520,
      protein: 32,
      carbs: 8,
      fat: 38,
      items: [
        { name: "煎肉餅", position: 1, calories: 420, protein: 24, carbs: 6, fat: 32 },
        { name: "漢堡排", position: 2, calories: 100, protein: 8, carbs: 2, fat: 6 },
      ],
    });
    assert.equal("countedSources" in assistant.loggedMeal, false);
    assert.equal("excludedSources" in assistant.loggedMeal, false);
    assert.equal("usedConservativeAssumption" in assistant.loggedMeal, false);
    assert.equal("confidence" in assistant.loggedMeal, false);
    assert.equal("estimate" in assistant.loggedMeal, false);
    assert.equal("currentRevisionId" in assistant.loggedMeal, false);
  });

  it("uses stored mealRevisionId despite rapid log and edit collision", async () => {
    const olderMeal = await foodLoggingService.logFood(deviceId, {
      foodName: "早餐蛋餅",
      calories: 390,
      protein: 14,
      carbs: 42,
      fat: 18,
      loggedAt: "2026-03-25T00:30:00.000Z",
    });
    await chatService.saveMessage(deviceId, "user", "(圖片)", { imagePath: "asset:collision-target" });
    const loggedMeal = await foodLoggingService.logFood(deviceId, {
      foodName: "雞腿便當",
      calories: 640,
      protein: 30,
      carbs: 78,
      fat: 20,
      imagePath: "asset:collision-target",
    });
    const tool = await chatService.saveMessage(deviceId, "tool", "成功", { toolName: "log_food" });
    const assistant = await chatService.saveMessage(deviceId, "assistant", "已先依照片做保守估算並完成記錄。");
    await chatService.saveMealReceiptReference({
      deviceId,
      assistantMessageId: assistant.id,
      toolMessageId: tool.id,
      mealTransactionId: loggedMeal.id,
      mealRevisionId: loggedMeal.mealRevisionId,
    });
    await foodLoggingService.logFood(deviceId, {
      foodName: "最新一餐",
      calories: 900,
      protein: 50,
      carbs: 90,
      fat: 36,
      imagePath: "asset:newest-collision",
    });
    await foodLoggingService.updateMeal(deviceId, olderMeal.id, {
      expectedMealRevisionId: olderMeal.mealRevisionId,
      items: [
        { foodName: "早餐蛋餅半份", calories: 210, protein: 8, carbs: 21, fat: 10 },
      ],
    });

    const [olderTransaction] = await db
      .select({ currentRevisionId: mealTransactions.currentRevisionId })
      .from(mealTransactions)
      .where(eq(mealTransactions.id, olderMeal.id))
      .limit(1);
    assert.ok(olderTransaction?.currentRevisionId);

    const revisionCreatedAt = new Date(new Date(assistant.createdAt).getTime() + 60_000).toISOString();
    await db
      .update(mealRevisions)
      .set({ createdAt: revisionCreatedAt })
      .where(eq(mealRevisions.id, olderTransaction.currentRevisionId))
      .run();

    const history = await chatService.getHistory(deviceId, 50);
    const restoredAssistant = history.find((message) => message.id === assistant.id);

    assert.equal(restoredAssistant?.didLogMeal, true);
    assert.equal(restoredAssistant?.loggedMeal?.mealId, loggedMeal.id);
    assert.equal(restoredAssistant?.loggedMeal?.mealRevisionId, loggedMeal.mealRevisionId);
    assert.equal(restoredAssistant?.loggedMeal?.imageAssetId, "collision-target");
    assert.equal(restoredAssistant?.loggedMeal?.foodName, "雞腿便當");
    assert.equal(restoredAssistant?.loggedMeal?.itemCount, 1);
    assert.equal(restoredAssistant?.loggedMeal?.calories, 640);
  });

  it("keeps stale historical receipts display-only after a later meal update", async () => {
    const loggedMeal = await foodLoggingService.logFood(deviceId, {
      foodName: "雞腿便當",
      calories: 640,
      protein: 30,
      carbs: 78,
      fat: 20,
      imagePath: "asset:original-lunch",
      loggedAt: "2026-03-25T04:30:00.000Z",
    });
    const tool = await chatService.saveMessage(deviceId, "tool", "成功", { toolName: "log_food" });
    const assistant = await chatService.saveMessage(deviceId, "assistant", "已幫你記錄雞腿便當。");
    await chatService.saveMealReceiptReference({
      deviceId,
      assistantMessageId: assistant.id,
      toolMessageId: tool.id,
      mealTransactionId: loggedMeal.id,
      mealRevisionId: loggedMeal.mealRevisionId,
    });

    await foodLoggingService.updateMeal(deviceId, loggedMeal.id, {
      expectedMealRevisionId: loggedMeal.mealRevisionId,
      items: [
        { foodName: "雞腿便當半份", calories: 360, protein: 20, carbs: 45, fat: 10 },
      ],
      imagePath: "asset:corrected-lunch",
    });

    const history = await chatService.getHistory(deviceId, 50);
    const restoredAssistant = history.find((message) => message.id === assistant.id);

    assert.equal(restoredAssistant?.didLogMeal, true);
    assert.ok(restoredAssistant?.loggedMeal);
    assert.equal((restoredAssistant.loggedMeal as unknown as Record<string, unknown>).receiptStatus, "stale_revision");
    assert.equal(restoredAssistant.loggedMeal.mealId, undefined);
    assert.equal(restoredAssistant.loggedMeal.dateKey, undefined);
    assert.equal(restoredAssistant.loggedMeal.mealRevisionId, undefined);
    assert.equal(restoredAssistant.loggedMeal.foodName, "雞腿便當");
    assert.equal(restoredAssistant.loggedMeal.itemCount, 1);
    assert.equal(restoredAssistant.loggedMeal.calories, 640);
    assert.equal(restoredAssistant.loggedMeal.imageAssetId, "original-lunch");
    assert.equal(restoredAssistant.loggedMeal.imageUrl, "/api/assets/original-lunch");
  });

  it("keeps historical receipts display-only after the meal is deleted", async () => {
    const loggedMeal = await foodLoggingService.logFood(deviceId, {
      foodName: "鮭魚飯糰",
      calories: 280,
      protein: 14,
      carbs: 36,
      fat: 8,
      imagePath: "asset:deleted-receipt",
      loggedAt: "2026-03-25T08:30:00.000Z",
    });
    const tool = await chatService.saveMessage(deviceId, "tool", "成功", { toolName: "log_food" });
    const assistant = await chatService.saveMessage(deviceId, "assistant", "已幫你記錄鮭魚飯糰。");
    await chatService.saveMealReceiptReference({
      deviceId,
      assistantMessageId: assistant.id,
      toolMessageId: tool.id,
      mealTransactionId: loggedMeal.id,
      mealRevisionId: loggedMeal.mealRevisionId,
    });

    await foodLoggingService.deleteMeal(deviceId, loggedMeal.id, loggedMeal.mealRevisionId);

    const history = await chatService.getHistory(deviceId, 50);
    const restoredAssistant = history.find((message) => message.id === assistant.id);

    assert.equal(restoredAssistant?.didLogMeal, true);
    assert.ok(restoredAssistant?.loggedMeal);
    assert.equal((restoredAssistant.loggedMeal as unknown as Record<string, unknown>).receiptStatus, "deleted");
    assert.equal(restoredAssistant.loggedMeal.mealId, undefined);
    assert.equal(restoredAssistant.loggedMeal.dateKey, undefined);
    assert.equal(restoredAssistant.loggedMeal.mealRevisionId, undefined);
    assert.equal(restoredAssistant.loggedMeal.foodName, "鮭魚飯糰");
    assert.equal(restoredAssistant.loggedMeal.itemCount, 1);
    assert.equal(restoredAssistant.loggedMeal.calories, 280);
    assert.equal(restoredAssistant.loggedMeal.protein, 14);
    assert.equal(restoredAssistant.loggedMeal.carbs, 36);
    assert.equal(restoredAssistant.loggedMeal.fat, 8);
    assert.equal(restoredAssistant.loggedMeal.imageAssetId, "deleted-receipt");
    assert.equal(restoredAssistant.loggedMeal.imageUrl, "/api/assets/deleted-receipt");
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
      expectedMealRevisionId: loggedMeal.mealRevisionId,
      items: [
        { foodName: "半碗牛肉麵", calories: 360, protein: 20, carbs: 45, fat: 10 },
      ],
    });
    const tool = await chatService.saveMessage(deviceId, "tool", "成功", { toolName: "update_meal" });
    const assistantMessage = await chatService.saveMessage(deviceId, "assistant", "已幫你更新 3/25 的牛肉麵。");
    await chatService.saveMealReceiptReference({
      deviceId,
      assistantMessageId: assistantMessage.id,
      toolMessageId: tool.id,
      mealTransactionId: updatedMeal.id,
      mealRevisionId: updatedMeal.mealRevisionId,
    });

    const history = await chatService.getHistory(deviceId, 50);
    const assistant = history.find((message) => message.role === "assistant");

    assert.equal(assistant?.didLogMeal, true);
    assert.ok(assistant?.loggedMeal);
    assert.deepEqual(assistant.loggedMeal, {
      receiptStatus: "active",
      mealId: updatedMeal.id,
      dateKey: "2026-03-25",
      mealRevisionId: updatedMeal.mealRevisionId,
      loggedAt: updatedMeal.loggedAt,
      imageAssetId: null,
      imageUrl: null,
      foodName: "半碗牛肉麵",
      itemCount: 1,
      calories: 360,
      protein: 20,
      carbs: 45,
      fat: 10,
      items: [
        { name: "半碗牛肉麵", position: 1, calories: 360, protein: 20, carbs: 45, fat: 10 },
      ],
    });
    assert.equal("countedSources" in assistant.loggedMeal, false);
    assert.equal("excludedSources" in assistant.loggedMeal, false);
    assert.equal("usedConservativeAssumption" in assistant.loggedMeal, false);
    assert.equal("confidence" in assistant.loggedMeal, false);
    assert.equal("estimate" in assistant.loggedMeal, false);
    assert.equal("currentRevisionId" in assistant.loggedMeal, false);
  });

  it("projects explicit loggedMeal receipts even when the tool row is outside the fetched history window", async () => {
    const loggedMeal = await foodLoggingService.logFood(deviceId, {
      foodName: "鮭魚飯糰",
      calories: 280,
      protein: 14,
      carbs: 36,
      fat: 8,
      loggedAt: "2026-03-25T08:30:00.000Z",
      imagePath: "asset:salmon-rice",
    });
    await chatService.saveMessage(deviceId, "tool", "成功", { toolName: "log_food" });

    for (let index = 0; index < 10; index += 1) {
      await chatService.saveMessage(deviceId, "user", `填充訊息 ${index}`);
      await chatService.saveMessage(deviceId, "assistant", `填充回覆 ${index}`);
    }

    const assistantMessage = await chatService.saveMessage(deviceId, "assistant", "已幫你記錄鮭魚飯糰。");
    await chatService.saveMealReceiptReference({
      deviceId,
      assistantMessageId: assistantMessage.id,
      mealTransactionId: loggedMeal.id,
      mealRevisionId: loggedMeal.mealRevisionId,
    });

    const history = await chatService.getHistory(deviceId, 4);
    const assistant = history.find((message) => message.id === assistantMessage.id);

    assert.equal(assistant?.didLogMeal, true);
    assert.deepEqual(assistant?.loggedMeal, {
      receiptStatus: "active",
      mealId: loggedMeal.id,
      dateKey: "2026-03-25",
      mealRevisionId: loggedMeal.mealRevisionId,
      loggedAt: loggedMeal.loggedAt,
      imageAssetId: "salmon-rice",
      imageUrl: "/api/assets/salmon-rice",
      foodName: "鮭魚飯糰",
      itemCount: 1,
      calories: 280,
      protein: 14,
      carbs: 36,
      fat: 8,
      items: [
        { name: "鮭魚飯糰", position: 1, calories: 280, protein: 14, carbs: 36, fat: 8 },
      ],
    });
  });

  it("does not rehydrate receipts without explicit identity for legacy successful tools", async () => {
    await foodLoggingService.logFood(deviceId, {
      foodName: "雞胸便當",
      calories: 620,
      protein: 42,
      carbs: 72,
      fat: 18,
      imagePath: "asset:legacy-log",
    });
    await chatService.saveMessage(deviceId, "user", "我剛剛傳了照片");
    await chatService.saveMessage(deviceId, "tool", "成功", { toolName: "log_food" });
    await chatService.saveMessage(deviceId, "assistant", "已幫你記錄。");

    const mealToEdit = await foodLoggingService.logFood(deviceId, {
      foodName: "牛肉飯",
      calories: 700,
      protein: 32,
      carbs: 88,
      fat: 22,
    });
    await foodLoggingService.updateMeal(deviceId, mealToEdit.id, {
      expectedMealRevisionId: mealToEdit.mealRevisionId,
      items: [{ foodName: "半份牛肉飯", calories: 380, protein: 18, carbs: 44, fat: 11 }],
    });
    await chatService.saveMessage(deviceId, "user", "把牛肉飯改成半份");
    await chatService.saveMessage(deviceId, "tool", "成功", { toolName: "update_meal" });
    await chatService.saveMessage(deviceId, "assistant", "已幫你更新。");

    const history = await chatService.getHistory(deviceId, 50);
    const assistants = history.filter((message) => message.role === "assistant");

    assert.equal(assistants.length, 2);
    for (const assistant of assistants) {
      assert.equal(assistant.didLogMeal, undefined);
      assert.equal(assistant.loggedMeal, undefined);
    }
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
    // log_food committed mutation authority now requires structured outcome rows.
    const allContent = compressed.map((m) => m.content).join("\n");
    assert.doesNotMatch(allContent, /系統已完成餐點記錄/);
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

  it("D-01/D-04/D-28 commits assistant reply, receipt, and structured outcome together", async () => {
    const loggedMeal = await foodLoggingService.logFood(deviceId, {
      foodName: "雞胸便當",
      calories: 620,
      protein: 42,
      carbs: 72,
      fat: 18,
      loggedAt: "2026-03-25T04:30:00.000Z",
    });
    await chatService.saveMessage(deviceId, "user", "幫我記雞胸便當");
    const tool = await chatService.saveMessage(deviceId, "tool", "成功", { toolName: "log_food" });
    const saveAssistantReplyWithReceipt = (
      chatService as unknown as {
        saveAssistantReplyWithReceipt?: (input: {
          deviceId: string;
          content: string;
          status?: "complete" | "stopped" | "error";
          receipt: {
            toolMessageId: string;
            mealTransactionId: string;
            mealRevisionId: string;
          };
          mutationOutcomeFact: {
            action: "log_food";
            affectedDate: string;
            foodName: string;
            calories: number;
          };
        }) => Promise<{ id: string; createdAt: string }>;
      }
    ).saveAssistantReplyWithReceipt;

    assert.equal(
      typeof saveAssistantReplyWithReceipt,
      "function",
      "missing saveAssistantReplyWithReceipt structured atomic helper",
    );
    const saveWithReceipt =
      saveAssistantReplyWithReceipt as NonNullable<typeof saveAssistantReplyWithReceipt>;

    const assistant = await saveWithReceipt({
      deviceId,
      content: "已幫你記錄雞胸便當。",
      receipt: {
        toolMessageId: tool.id,
        mealTransactionId: loggedMeal.id,
        mealRevisionId: loggedMeal.mealRevisionId,
      },
      mutationOutcomeFact: {
        action: "log_food",
        affectedDate: "2026-03-25",
        foodName: "雞胸便當",
        calories: 620,
      },
    });

    const [assistantRow] = await db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.id, assistant.id))
      .limit(1);
    const [receiptRow] = await db
      .select()
      .from(chatMealReceipts)
      .where(eq(chatMealReceipts.assistantMessageId, assistant.id))
      .limit(1);
    const [outcomeRow] = await db
      .select()
      .from(chatMutationOutcomes)
      .where(eq(chatMutationOutcomes.assistantMessageId, assistant.id))
      .limit(1);
    const compressed = await chatService.getCompressedHistory(deviceId, 10);
    const allContent = compressed.map((message) => message.content).join("\n");

    assert.equal(assistantRow?.role, "assistant");
    assert.equal(receiptRow?.mealTransactionId, loggedMeal.id);
    assert.equal(outcomeRow?.action, "log_food");
    assert.equal(outcomeRow?.affectedDate, "2026-03-25");
    assert.equal(outcomeRow?.foodName, "雞胸便當");
    assert.equal(outcomeRow?.calories, 620);
    assert.match(allContent, /雞胸便當/);
    assert.match(allContent, /2026-03-25/);
    assert.doesNotMatch(allContent, new RegExp(loggedMeal.id));
    assert.doesNotMatch(allContent, new RegExp(loggedMeal.mealRevisionId));
  });

  it("D-04 rolls back assistant and receipt rows when structured outcome persistence fails", async () => {
    const loggedMeal = await foodLoggingService.logFood(deviceId, {
      foodName: "牛肉飯",
      calories: 700,
      protein: 32,
      carbs: 88,
      fat: 22,
    });
    const tool = await chatService.saveMessage(deviceId, "tool", "成功", { toolName: "log_food" });
    const beforeAssistants = await db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.role, "assistant"));
    const saveAssistantReplyWithReceipt = (
      chatService as unknown as {
        saveAssistantReplyWithReceipt?: (input: unknown) => Promise<unknown>;
      }
    ).saveAssistantReplyWithReceipt;

    assert.equal(
      typeof saveAssistantReplyWithReceipt,
      "function",
      "missing saveAssistantReplyWithReceipt structured atomic helper",
    );
    const saveWithReceipt =
      saveAssistantReplyWithReceipt as NonNullable<typeof saveAssistantReplyWithReceipt>;

    await assert.rejects(
      saveWithReceipt({
        deviceId,
        content: "已幫你記錄牛肉飯。",
        receipt: {
          toolMessageId: tool.id,
          mealTransactionId: loggedMeal.id,
          mealRevisionId: loggedMeal.mealRevisionId,
        },
        mutationOutcomeFact: {
          action: "unsupported_action",
          affectedDate: "2026-03-25",
          foodName: "牛肉飯",
        },
      }),
      /structured outcome|mutation outcome|invalid/i,
    );

    const afterAssistants = await db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.role, "assistant"));
    const receipts = await db.select().from(chatMealReceipts);
    const outcomes = await db.select().from(chatMutationOutcomes);

    assert.equal(afterAssistants.length, beforeAssistants.length);
    assert.equal(receipts.length, 0);
    assert.equal(outcomes.length, 0);
  });

  it("D-19/D-21/D-23 keeps legacy receipt display but omits compressed mutation claims without structured outcomes", async () => {
    const loggedMeal = await foodLoggingService.logFood(deviceId, {
      foodName: "鮭魚飯糰",
      calories: 280,
      protein: 14,
      carbs: 36,
      fat: 8,
      loggedAt: "2026-03-25T08:30:00.000Z",
    });
    const tool = await chatService.saveMessage(deviceId, "tool", "成功", { toolName: "log_food" });
    const assistant = await chatService.saveMessage(deviceId, "assistant", "已幫你記錄鮭魚飯糰。");
    await chatService.saveMealReceiptReference({
      deviceId,
      assistantMessageId: assistant.id,
      toolMessageId: tool.id,
      mealTransactionId: loggedMeal.id,
      mealRevisionId: loggedMeal.mealRevisionId,
    });

    const history = await chatService.getHistory(deviceId, 50);
    const restoredAssistant = history.find((message) => message.id === assistant.id);
    const compressed = await chatService.getCompressedHistory(deviceId, 10);
    const allContent = compressed.map((message) => message.content).join("\n");

    assert.equal(restoredAssistant?.didLogMeal, true);
    assert.equal(restoredAssistant?.loggedMeal?.foodName, "鮭魚飯糰");
    assert.equal(restoredAssistant?.loggedMeal?.mealId, loggedMeal.id);
    assert.doesNotMatch(allContent, /系統已完成餐點記錄/);
    assert.doesNotMatch(allContent, /鮭魚飯糰/);
  });

  it("D-19/D-25 omits compressed mutation claims for missing, malformed, or invalid structured outcomes", async () => {
    await chatService.saveMessage(deviceId, "user", "記一下午餐");
    await chatService.saveMessage(deviceId, "tool", "成功", { toolName: "log_food" });
    await chatService.saveMessage(deviceId, "tool", "{not-json", { toolName: "log_food" });
    await chatService.saveMessage(deviceId, "tool", JSON.stringify({ action: "log_food" }), { toolName: "log_food" });
    await chatService.saveMessage(deviceId, "assistant", "已記錄完成。");

    const compressed = await chatService.getCompressedHistory(deviceId, 10);
    const allContent = compressed.map((message) => message.content).join("\n");

    assert.doesNotMatch(allContent, /系統已完成餐點記錄/);
    assert.doesNotMatch(allContent, /committed|mutation|outcome/i);
    assert.doesNotMatch(allContent, /not-json/);
  });

  it("D-22/D-26 keeps stale and deleted legacy receipt identity display-only", async () => {
    const staleMeal = await foodLoggingService.logFood(deviceId, {
      foodName: "雞腿便當",
      calories: 640,
      protein: 30,
      carbs: 78,
      fat: 20,
      loggedAt: "2026-03-25T04:30:00.000Z",
    });
    const staleAssistant = await chatService.saveMessage(deviceId, "assistant", "已幫你記錄雞腿便當。");
    await chatService.saveMealReceiptReference({
      deviceId,
      assistantMessageId: staleAssistant.id,
      mealTransactionId: staleMeal.id,
      mealRevisionId: staleMeal.mealRevisionId,
    });
    await foodLoggingService.updateMeal(deviceId, staleMeal.id, {
      expectedMealRevisionId: staleMeal.mealRevisionId,
      items: [{ foodName: "雞腿便當半份", calories: 360, protein: 20, carbs: 45, fat: 10 }],
    });

    const deletedMeal = await foodLoggingService.logFood(deviceId, {
      foodName: "鮭魚飯糰",
      calories: 280,
      protein: 14,
      carbs: 36,
      fat: 8,
      loggedAt: "2026-03-25T08:30:00.000Z",
    });
    const deletedAssistant = await chatService.saveMessage(deviceId, "assistant", "已幫你記錄鮭魚飯糰。");
    await chatService.saveMealReceiptReference({
      deviceId,
      assistantMessageId: deletedAssistant.id,
      mealTransactionId: deletedMeal.id,
      mealRevisionId: deletedMeal.mealRevisionId,
    });
    await foodLoggingService.deleteMeal(deviceId, deletedMeal.id, deletedMeal.mealRevisionId);

    const history = await chatService.getHistory(deviceId, 50);
    const stale = history.find((message) => message.id === staleAssistant.id);
    const deleted = history.find((message) => message.id === deletedAssistant.id);

    for (const message of [stale, deleted]) {
      assert.equal(message?.didLogMeal, true);
      assert.ok(message?.loggedMeal);
      assert.equal(message.loggedMeal.mealId, undefined);
      assert.equal(message.loggedMeal.dateKey, undefined);
      assert.equal(message.loggedMeal.mealRevisionId, undefined);
    }
  });

  it("omits deleted log facts from compressed current-meal history while preserving delete confirmation", async () => {
    const loggedMeal = await foodLoggingService.logFood(deviceId, {
      foodName: "雞胸便當",
      calories: 620,
      protein: 42,
      carbs: 72,
      fat: 18,
      loggedAt: "2026-03-25T04:30:00.000Z",
    });
    await chatService.saveMessage(deviceId, "user", "幫我記雞胸便當");
    const tool = await chatService.saveMessage(deviceId, "tool", "成功", { toolName: "log_food" });
    await chatService.saveAssistantReplyWithReceipt({
      deviceId,
      content: "已幫你記錄雞胸便當。",
      receipt: {
        toolMessageId: tool.id,
        mealTransactionId: loggedMeal.id,
        mealRevisionId: loggedMeal.mealRevisionId,
      },
      mutationOutcomeFact: {
        action: "log_food",
        affectedDate: "2026-03-25",
        foodName: "雞胸便當",
        calories: 620,
        protein: 42,
        carbs: 72,
        fat: 18,
      },
    });

    await foodLoggingService.deleteMeal(deviceId, loggedMeal.id, loggedMeal.mealRevisionId);
    await chatService.saveMessage(deviceId, "user", "刪掉剛剛那餐");
    await chatService.saveAssistantReplyWithReceipt({
      deviceId,
      content: "已刪除這筆餐點。",
      mutationOutcomeFact: {
        action: "delete_meal",
        affectedDate: "2026-03-25",
        foodName: "雞胸便當",
      },
    });
    await chatService.saveMessage(deviceId, "user", "今天吃了什麼？");

    const compressed = await chatService.getCompressedHistory(deviceId, 10);
    const allContent = compressed.map((message) => message.content).join("\n");

    assert.match(allContent, /已刪除這筆餐點/);
    assert.doesNotMatch(allContent, /已幫你記錄雞胸便當/);
    assert.doesNotMatch(allContent, /系統已記錄餐點：2026-03-25 雞胸便當/);
    assert.doesNotMatch(allContent, /620 kcal|蛋白質 42 g|碳水 72 g|脂肪 18 g/);
  });
});
