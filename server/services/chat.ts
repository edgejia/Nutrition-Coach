// server/services/chat.ts
import { eq, and, asc, desc, inArray, sql } from "drizzle-orm";
import { chatMessages } from "../db/schema.js";
import type { AppDatabase } from "../db/client.js";

export function createChatService(db: AppDatabase) {
  return {
    async saveMessage(
      deviceId: string,
      role: string,
      content: string,
      opts?: { toolName?: string; imagePath?: string }
    ) {
      await db.insert(chatMessages).values({
        id: crypto.randomUUID(),
        deviceId,
        role,
        content,
        toolName: opts?.toolName ?? null,
        imagePath: opts?.imagePath ?? null,
        createdAt: new Date().toISOString(),
      });
    },

    async getHistory(deviceId: string, limit: number) {
      const visibleRows = await db
        .select({
          rowId: sql<number>`rowid`,
          id: chatMessages.id,
          deviceId: chatMessages.deviceId,
          role: chatMessages.role,
          content: chatMessages.content,
          toolName: chatMessages.toolName,
          imagePath: chatMessages.imagePath,
          createdAt: chatMessages.createdAt,
        })
        .from(chatMessages)
        .where(
          and(
            eq(chatMessages.deviceId, deviceId),
            inArray(chatMessages.role, ["user", "assistant"])
          )
        )
        .orderBy(desc(sql`rowid`))
        .limit(limit);

      if (visibleRows.length === 0) {
        return [];
      }

      const selectedVisibleRowIds = new Set(visibleRows.map((row) => row.rowId));
      const earliestVisibleRowId = visibleRows[visibleRows.length - 1].rowId;

      const previousVisibleRow = await db
        .select({ rowId: sql<number>`rowid` })
        .from(chatMessages)
        .where(
          sql`${chatMessages.deviceId} = ${deviceId}
              and ${chatMessages.role} in ('user', 'assistant')
              and rowid < ${earliestVisibleRowId}`
        )
        .orderBy(desc(sql`rowid`))
        .limit(1);

      const startAfterRowId = previousVisibleRow[0]?.rowId ?? 0;
      const rows = await db
        .select({
          rowId: sql<number>`rowid`,
          id: chatMessages.id,
          deviceId: chatMessages.deviceId,
          role: chatMessages.role,
          content: chatMessages.content,
          toolName: chatMessages.toolName,
          imagePath: chatMessages.imagePath,
          createdAt: chatMessages.createdAt,
        })
        .from(chatMessages)
        .where(
          sql`${chatMessages.deviceId} = ${deviceId}
              and rowid > ${startAfterRowId}`
        )
        .orderBy(asc(sql`rowid`));

      const projected: Array<{
        id: string;
        deviceId: string;
        role: string;
        content: string;
        toolName: string | null;
        imagePath: string | null;
        createdAt: string;
        didLogMeal?: boolean;
      }> = [];

      let pendingDidLogMeal = false;

      for (const row of rows) {
        if (row.role === "tool") {
          if (row.toolName === "log_food") {
            pendingDidLogMeal = true;
          }
          continue;
        }

        if (row.role !== "user" && row.role !== "assistant") {
          continue;
        }

        if (row.role === "assistant") {
          if (selectedVisibleRowIds.has(row.rowId)) {
            const { rowId: _rowId, ...visibleRow } = row;
            projected.push({
              ...visibleRow,
              didLogMeal: pendingDidLogMeal || undefined,
            });
          }
          pendingDidLogMeal = false;
          continue;
        }

        pendingDidLogMeal = false;
        if (selectedVisibleRowIds.has(row.rowId)) {
          const { rowId: _rowId, ...visibleRow } = row;
          projected.push(visibleRow);
        }
      }

      return projected;
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
          pendingToolSummaries.push(`[使用 ${msg.toolName} → ${msg.content}]`);
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
