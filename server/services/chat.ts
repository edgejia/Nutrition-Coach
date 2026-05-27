// server/services/chat.ts
import { eq, and, asc, desc, sql } from "drizzle-orm";
import {
  assetReferences,
  assets,
  chatMealReceipts,
  chatMessages,
  mealRevisions,
  mealRevisionItems,
  mealTransactions,
} from "../db/schema.js";
import type { AppDatabase } from "../db/client.js";
import { buildAssetUrl, parseAssetRef } from "./assets.js";
import { formatLocalDate } from "../lib/time.js";
import { projectMealDisplay } from "./meal-display.js";
import { normalizeMealPeriod, type MealPeriod } from "../lib/meal-period.js";

type ChatMessageStatus = "complete" | "stopped" | "error";

interface LoggedMealReceipt {
  mealId?: string;
  dateKey?: string;
  mealRevisionId?: string;
  loggedAt: string;
  mealPeriod?: MealPeriod;
  imageAssetId: string | null;
  imageUrl: string | null;
  foodName: string;
  itemCount: number;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  items?: Array<{
    name: string;
    position: number;
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
  }>;
}

function formatToolSummary(toolName: string, content: string): string {
  const completed = content.trim() === "成功";
  if (toolName === "log_food") {
    return completed ? "[系統已完成餐點記錄]" : "[系統餐點記錄未完成]";
  }
  if (toolName === "update_meal") {
    return completed ? "[系統已完成餐點修改]" : "[系統餐點修改未完成]";
  }
  if (toolName === "delete_meal") {
    return completed ? "[系統已完成餐點刪除]" : "[系統餐點刪除未完成]";
  }
  if (toolName === "find_meals") {
    return "[系統已完成餐點查找]";
  }
  if (toolName === "get_daily_summary") {
    return `[系統已更新今日攝取摘要：${content}]`;
  }
  return `[系統工具已完成：${content}]`;
}

export function createChatService(db: AppDatabase) {
  async function getMealReceiptForAssistantMessage(
    deviceId: string,
    assistantMessageId: string,
  ): Promise<LoggedMealReceipt | undefined> {
    const receipts = await db
      .select({
        mealTransactionId: mealTransactions.id,
        currentRevisionId: mealTransactions.currentRevisionId,
        deletedAt: mealTransactions.deletedAt,
        mealRevisionId: mealRevisions.id,
        loggedAt: mealTransactions.loggedAt,
        mealPeriod: mealTransactions.mealPeriod,
        imageAssetId: mealRevisions.imageAssetId,
      })
      .from(chatMealReceipts)
      .innerJoin(chatMessages, eq(chatMessages.id, chatMealReceipts.assistantMessageId))
      .innerJoin(mealTransactions, eq(mealTransactions.id, chatMealReceipts.mealTransactionId))
      .innerJoin(mealRevisions, eq(mealRevisions.id, chatMealReceipts.mealRevisionId))
      .where(
        and(
          eq(chatMealReceipts.deviceId, deviceId),
          eq(chatMealReceipts.assistantMessageId, assistantMessageId),
          eq(chatMessages.deviceId, deviceId),
          eq(mealTransactions.deviceId, deviceId),
          eq(mealRevisions.transactionId, mealTransactions.id),
        ),
      )
      .limit(1);

    const receipt = receipts[0];
    if (!receipt) {
      return undefined;
    }

    const items = await db
      .select({
        foodName: mealRevisionItems.foodName,
        position: mealRevisionItems.position,
        calories: mealRevisionItems.calories,
        protein: mealRevisionItems.protein,
        carbs: mealRevisionItems.carbs,
        fat: mealRevisionItems.fat,
      })
      .from(mealRevisionItems)
      .where(eq(mealRevisionItems.revisionId, receipt.mealRevisionId))
      .orderBy(asc(mealRevisionItems.position));

    if (items.length === 0) {
      return undefined;
    }

    const isCurrentActiveReceipt =
      receipt.deletedAt === null && receipt.mealRevisionId === receipt.currentRevisionId;
    const mealPeriod = normalizeMealPeriod(receipt.mealPeriod);
    const display = projectMealDisplay(items);

    return {
      ...(isCurrentActiveReceipt
        ? {
            mealId: receipt.mealTransactionId,
            dateKey: formatLocalDate(new Date(receipt.loggedAt)),
            mealRevisionId: receipt.mealRevisionId,
          }
        : {}),
      loggedAt: receipt.loggedAt,
      ...(mealPeriod ? { mealPeriod } : {}),
      imageAssetId: receipt.imageAssetId ?? null,
      imageUrl: receipt.imageAssetId ? buildAssetUrl(receipt.imageAssetId) : null,
      foodName: display.foodName,
      itemCount: display.itemCount,
      calories: items.reduce((sum, item) => sum + item.calories, 0),
      protein: items.reduce((sum, item) => sum + item.protein, 0),
      carbs: items.reduce((sum, item) => sum + item.carbs, 0),
      fat: items.reduce((sum, item) => sum + item.fat, 0),
      items: items.map((item) => ({
        name: item.foodName,
        position: item.position + 1,
        calories: item.calories,
        protein: item.protein,
        carbs: item.carbs,
        fat: item.fat,
      })),
    };
  }

  return {
    async saveMealReceiptReference(input: {
      deviceId: string;
      assistantMessageId: string;
      toolMessageId?: string;
      mealTransactionId: string;
      mealRevisionId: string;
    }) {
      const createdAt = new Date().toISOString();
      const id = crypto.randomUUID();

      await db.insert(chatMealReceipts).values({
        id,
        deviceId: input.deviceId,
        assistantMessageId: input.assistantMessageId,
        toolMessageId: input.toolMessageId ?? null,
        mealTransactionId: input.mealTransactionId,
        mealRevisionId: input.mealRevisionId,
        createdAt,
      });

      return { id, createdAt };
    },

    getMealReceiptForAssistantMessage,

    async saveMessage(
      deviceId: string,
      role: string,
      content: string,
      opts?: { toolName?: string; imagePath?: string; status?: ChatMessageStatus }
    ) {
      const id = crypto.randomUUID();
      const createdAt = new Date().toISOString();
      const imageAssetId = parseAssetRef(opts?.imagePath);

      return db.transaction((tx) => {
        if (imageAssetId) {
          const existingAsset = tx
            .select({ id: assets.id })
            .from(assets)
            .where(eq(assets.id, imageAssetId))
            .limit(1)
            .get();

          if (!existingAsset) {
            tx.insert(assets)
              .values({
                id: imageAssetId,
                deviceId,
                storageKey: `unresolved/${imageAssetId}`,
                mimeType: "application/octet-stream",
                byteSize: 0,
                createdAt,
              })
              .run();
          }
        }

        tx.insert(chatMessages).values({
          id,
          deviceId,
          role,
          content,
          toolName: opts?.toolName ?? null,
          imagePath: opts?.imagePath ?? null,
          createdAt,
          status: opts?.status ?? "complete",
        }).run();

        if (imageAssetId) {
          // Normalize chat image evidence into asset_references.owner_type = "chat_message".
          tx.insert(assetReferences)
            .values({
              id: `chat_message:${id}:${imageAssetId}`,
              assetId: imageAssetId,
              deviceId,
              ownerType: "chat_message",
              ownerId: id,
              createdAt,
            })
            .run();
        }

        return { id, createdAt };
      });
    },

    async getHistory(deviceId: string, limit: number) {
      // Fetch all roles (including tool) to preserve the existing history window,
      // then filter to user+assistant before returning. Fetch limit*4 to ensure
      // we have enough rows after tool messages are dropped.
      const rows = await db
        .select()
        .from(chatMessages)
        .where(eq(chatMessages.deviceId, deviceId))
        .orderBy(desc(sql`rowid`))
        .limit(limit * 4);

      const chronological = rows.reverse();
      const projected: Array<{
        id: string;
        deviceId: string;
        role: string;
        content: string;
        toolName: string | null;
        imagePath: string | null;
        createdAt: string;
        status: string;
        didLogMeal?: boolean;
        loggedMeal?: LoggedMealReceipt;
      }> = [];

      for (const row of chronological) {
        if (row.role === "tool") {
          continue;
        }

        if (row.role !== "user" && row.role !== "assistant") {
          continue;
        }

        if (row.role === "assistant") {
          const loggedMeal = await getMealReceiptForAssistantMessage(deviceId, row.id);
          projected.push({
            ...row,
            didLogMeal: loggedMeal ? true : undefined,
            ...(loggedMeal ? { loggedMeal } : {}),
          });
          continue;
        }

        projected.push(row);
      }

      return projected.slice(-limit);
    },

    async getCompressedHistory(deviceId: string, turns: number) {
      // Find the earliest user message that belongs to the last N user turns.
      // Then load every message from that cutoff onward so no turn is truncated.
      const recentUserTurns = await db
        .select({ rowId: sql<number>`rowid` })
        .from(chatMessages)
        .where(
          and(
            eq(chatMessages.deviceId, deviceId),
            eq(chatMessages.role, "user")
          )
        )
        .orderBy(desc(sql`rowid`))
        .limit(turns);

      if (recentUserTurns.length === 0) {
        return [];
      }

      const cutoffRowId = recentUserTurns[recentUserTurns.length - 1].rowId;
      const msgs = await db
        .select()
        .from(chatMessages)
        .where(
          sql`${chatMessages.deviceId} = ${deviceId} and rowid >= ${cutoffRowId}`
        )
        .orderBy(asc(sql`rowid`));

      // Group into turns: each turn starts with a user message.
      // Tool summaries are merged into the assistant reply to avoid
      // consecutive assistant messages that confuse the OpenAI chat API.
      const turns_arr: Array<{ role: string; content: string }[]> = [];
      let current: Array<{ role: string; content: string }> = [];
      let pendingToolSummaries: string[] = [];
      for (const msg of msgs) {
        if (msg.role === "user" && current.length > 0) {
          // Flush any remaining tool summaries as a standalone assistant message
          if (pendingToolSummaries.length > 0) {
            current.push({ role: "assistant", content: pendingToolSummaries.join("\n") });
            pendingToolSummaries = [];
          }
          turns_arr.push(current);
          current = [];
        }
        if (msg.role === "tool") {
          pendingToolSummaries.push(formatToolSummary(msg.toolName ?? "", msg.content));
        } else if (msg.role === "user" && msg.imagePath) {
          current.push({ role: "user", content: `${msg.content}\n[附帶圖片]` });
        } else if (msg.role === "assistant") {
          // Merge pending tool summaries into the assistant message
          const toolPrefix = pendingToolSummaries.length > 0
            ? pendingToolSummaries.join("\n") + "\n"
            : "";
          current.push({ role: "assistant", content: toolPrefix + msg.content });
          pendingToolSummaries = [];
        } else {
          current.push({ role: msg.role, content: msg.content });
        }
      }
      // Flush any remaining tool summaries at the end of the last turn
      if (pendingToolSummaries.length > 0) {
        current.push({ role: "assistant", content: pendingToolSummaries.join("\n") });
      }
      if (current.length > 0) turns_arr.push(current);

      // Take last N turns and flatten
      return turns_arr.slice(-turns).flat();
    },
  };
}
