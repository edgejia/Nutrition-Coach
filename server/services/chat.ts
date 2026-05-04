// server/services/chat.ts
import { eq, and, asc, desc, gte, inArray, lte, or, sql } from "drizzle-orm";
import {
  assetReferences,
  assets,
  chatMessages,
  mealRevisions,
  mealRevisionItems,
  mealTransactions,
} from "../db/schema.js";
import type { AppDatabase } from "../db/client.js";
import { buildAssetUrl, parseAssetRef } from "./assets.js";
import { formatLocalDate } from "../lib/time.js";

const RECEIPT_REHYDRATION_GRACE_MS = 5_000;
type ChatMessageStatus = "complete" | "stopped" | "error";

interface LoggedMealReceipt {
  mealId: string;
  dateKey: string;
  loggedAt: string;
  imageAssetId: string | null;
  imageUrl: string | null;
  foodName: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

function formatToolSummary(toolName: string, content: string): string {
  if (toolName === "log_food") {
    return "[系統已完成餐點記錄]";
  }
  if (toolName === "update_meal") {
    return "[系統已完成餐點修改]";
  }
  if (toolName === "delete_meal") {
    return "[系統已完成餐點刪除]";
  }
  if (toolName === "find_meals") {
    return "[系統已完成餐點查找]";
  }
  if (toolName === "get_daily_summary") {
    return `[系統已更新今日攝取摘要：${content}]`;
  }
  return `[系統工具已完成：${content}]`;
}

function buildGroupedFoodName(items: Array<{ foodName: string }>) {
  if (items.length === 1) {
    return items[0]!.foodName;
  }

  if (items.length === 2) {
    return `${items[0]!.foodName}、${items[1]!.foodName}`;
  }

  return `${items[0]!.foodName}、${items[1]!.foodName} 等${items.length}項`;
}

function addMilliseconds(isoTimestamp: string, milliseconds: number): string {
  return new Date(new Date(isoTimestamp).getTime() + milliseconds).toISOString();
}

export function createChatService(db: AppDatabase) {
  async function getLoggedMealReceiptForTurn(
    deviceId: string,
    turnStartAt: string | undefined,
    assistantCreatedAt: string,
  ): Promise<LoggedMealReceipt | undefined> {
    const createdAfter = turnStartAt ?? assistantCreatedAt;
    const createdBefore = addMilliseconds(assistantCreatedAt, RECEIPT_REHYDRATION_GRACE_MS);
    const turnCreatedAtMatch = and(
      gte(mealTransactions.createdAt, createdAfter),
      lte(mealTransactions.createdAt, createdBefore),
    );
    const turnCurrentRevisionMatch = and(
      gte(mealRevisions.createdAt, createdAfter),
      lte(mealRevisions.createdAt, createdBefore),
    );
    const transactions = await db
      .select({
        id: mealTransactions.id,
        currentRevisionId: mealTransactions.currentRevisionId,
        loggedAt: mealTransactions.loggedAt,
        createdAt: mealTransactions.createdAt,
        imageAssetId: mealRevisions.imageAssetId,
      })
      .from(mealTransactions)
      .innerJoin(mealRevisions, eq(mealRevisions.id, mealTransactions.currentRevisionId))
      .where(
        and(
          eq(mealTransactions.deviceId, deviceId),
          or(turnCreatedAtMatch, turnCurrentRevisionMatch),
        ),
      )
      .orderBy(
        desc(sql`case when ${mealRevisions.createdAt} >= ${createdAfter} and ${mealRevisions.createdAt} <= ${createdBefore} then ${mealRevisions.createdAt} else ${mealTransactions.createdAt} end`),
        desc(mealTransactions.id),
      )
      .limit(1);

    const transaction = transactions[0];
    const revisionId = transaction?.currentRevisionId;
    if (!revisionId) {
      return undefined;
    }

    const items = await db
      .select({
        foodName: mealRevisionItems.foodName,
        calories: mealRevisionItems.calories,
        protein: mealRevisionItems.protein,
        carbs: mealRevisionItems.carbs,
        fat: mealRevisionItems.fat,
      })
      .from(mealRevisionItems)
      .where(inArray(mealRevisionItems.revisionId, [revisionId]))
      .orderBy(asc(mealRevisionItems.position));

    if (items.length === 0) {
      return undefined;
    }

    return {
      mealId: transaction.id,
      dateKey: formatLocalDate(new Date(transaction.loggedAt)),
      loggedAt: transaction.loggedAt,
      imageAssetId: transaction.imageAssetId ?? null,
      imageUrl: transaction.imageAssetId ? buildAssetUrl(transaction.imageAssetId) : null,
      foodName: buildGroupedFoodName(items),
      calories: items.reduce((sum, item) => sum + item.calories, 0),
      protein: items.reduce((sum, item) => sum + item.protein, 0),
      carbs: items.reduce((sum, item) => sum + item.carbs, 0),
      fat: items.reduce((sum, item) => sum + item.fat, 0),
    };
  }

  return {
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
      // Fetch all roles (including tool) to compute the didLogMeal projection,
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

      let pendingDidLogMeal = false;
      let pendingTurnStartAt: string | undefined;
      let latestUserCreatedAt: string | undefined;

      for (const row of chronological) {
        if (row.role === "tool") {
          const isSuccessfulMutationTool =
            (row.toolName === "log_food" || row.toolName === "update_meal") &&
            row.content === "成功";
          if (isSuccessfulMutationTool) {
            pendingDidLogMeal = true;
            pendingTurnStartAt = latestUserCreatedAt;
          }
          if (row.toolName === "delete_meal") {
            pendingDidLogMeal = false;
            pendingTurnStartAt = undefined;
          }
          continue;
        }

        if (row.role !== "user" && row.role !== "assistant") {
          continue;
        }

        if (row.role === "assistant") {
          const loggedMeal = pendingDidLogMeal
            ? await getLoggedMealReceiptForTurn(deviceId, pendingTurnStartAt, row.createdAt)
            : undefined;
          projected.push({
            ...row,
            didLogMeal: pendingDidLogMeal || undefined,
            ...(loggedMeal ? { loggedMeal } : {}),
          });
          pendingDidLogMeal = false;
          pendingTurnStartAt = undefined;
          continue;
        }

        projected.push(row);
        pendingDidLogMeal = false;
        pendingTurnStartAt = undefined;
        latestUserCreatedAt = row.createdAt;
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
