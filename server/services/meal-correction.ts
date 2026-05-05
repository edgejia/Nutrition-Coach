import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import type { AppDatabase } from "../db/client.js";
import {
  mealRevisionItems,
  mealTransactions,
} from "../db/schema.js";
import { resolveHistoricalDateIntent } from "../lib/historical-date.js";
import { currentAppDate, formatLocalDate } from "../lib/time.js";
import { createMealTransactionsService, type MealTransactionItemInput } from "./meal-transactions.js";
import { createTurnStateService } from "./turn-state.js";
import { createSummaryService, type DailySummary } from "./summary.js";
import { makeAssetRef } from "./assets.js";

const PENDING_SELECTION_KIND = "meal_target_selection";
const PENDING_SELECTION_TTL_MS = 15 * 60 * 1000;

export interface MealCorrectionCandidate {
  mealId: string;
  foodName: string;
  itemNames: string[];
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  loggedAt: string;
  dateKey: string;
  mealPeriod: "breakfast" | "lunch" | "dinner" | "late_night";
}

export interface PendingMealSelectionState {
  action: "update" | "delete";
  candidates: MealCorrectionCandidate[];
}

type MealCorrectionUpdateInput =
  | { items: MealTransactionItemInput[] }
  | {
      patch: Partial<MealTransactionItemInput>;
    };

export interface FindMealsResolvedResult {
  status: "resolved";
  action: "update" | "delete";
  resolvedMealId: string;
  candidate: MealCorrectionCandidate;
  fromPending: boolean;
}

export interface FindMealsClarificationResult {
  status: "needs_clarification";
  action: "update" | "delete";
  prompt: string;
  candidates: MealCorrectionCandidate[];
}

export interface FindMealsNotFoundResult {
  status: "not_found";
  action: "update" | "delete";
  prompt: string;
}

export type FindMealsResult =
  | FindMealsResolvedResult
  | FindMealsClarificationResult
  | FindMealsNotFoundResult;

interface FindMealsOptions {
  currentDate?: Date;
  previousDateKey?: string;
}

interface CandidateHeaderRow {
  id: string;
  loggedAt: string;
  currentRevisionId: string;
}

const NUMERIC_ITEM_FIELDS = ["calories", "protein", "carbs", "fat"] as const;
type NumericItemField = (typeof NUMERIC_ITEM_FIELDS)[number];

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, "");
}

function inferMealPeriod(loggedAt: string): "breakfast" | "lunch" | "dinner" | "late_night" {
  const hour = new Date(loggedAt).getHours();
  if (hour < 11) return "breakfast";
  if (hour < 15) return "lunch";
  if (hour < 21) return "dinner";
  return "late_night";
}

function hasRecentReference(query: string): boolean {
  return /(剛剛|剛才|上一筆|那筆|那餐|剛剛那筆|剛才那筆|上一餐)/.test(query);
}

function extractMealPeriod(query: string): MealCorrectionCandidate["mealPeriod"] | undefined {
  if (/(早餐|早上|早飯)/.test(query)) return "breakfast";
  if (/(午餐|中午)/.test(query)) return "lunch";
  if (/(晚餐|晚上)/.test(query)) return "dinner";
  if (/(宵夜|點心|下午茶)/.test(query)) return "late_night";
  return undefined;
}

function extractSelectionIndex(query: string): number | undefined {
  const trimmed = normalizeText(query);
  const directDigit = trimmed.match(/^(?:第)?([1-9])(?:個|筆|份|條)?$/);
  if (directDigit) {
    return Number(directDigit[1]) - 1;
  }

  const chineseMap: Record<string, number> = {
    一: 0,
    二: 1,
    兩: 1,
    三: 2,
    四: 3,
    五: 4,
    六: 5,
    七: 6,
    八: 7,
    九: 8,
  };
  const chinese = trimmed.match(/^第?([一二兩三四五六七八九])(?:個|筆|份|條)?$/);
  if (chinese) {
    return chineseMap[chinese[1]];
  }

  return undefined;
}

function formatCandidate(candidate: MealCorrectionCandidate, index: number): string {
  const local = new Date(candidate.loggedAt);
  const hour = `${local.getHours()}`.padStart(2, "0");
  const minute = `${local.getMinutes()}`.padStart(2, "0");
  return `${index + 1}. ${candidate.dateKey} ${hour}:${minute} ${candidate.foodName}`;
}

function buildClarificationPrompt(
  action: "update" | "delete",
  candidates: MealCorrectionCandidate[],
): string {
  const verb = action === "update" ? "修改" : "刪除";
  const lines = candidates.map((candidate, index) => formatCandidate(candidate, index));
  return `我找到多筆可能要${verb}的餐點，請直接回覆編號：\n${lines.join("\n")}`;
}

function buildNotFoundPrompt(action: "update" | "delete"): string {
  const verb = action === "update" ? "修改" : "刪除";
  return `我還不能確定你要${verb}哪一筆餐點，請補充日期、餐別或食物名稱。`;
}

function buildDateClarificationPrompt(
  action: "update" | "delete",
  reason: "multiple_dates" | "unsupported" | "unparseable",
): string {
  if (reason === "multiple_dates") {
    const verb = action === "update" ? "修改" : "刪除";
    return `我還不能確定你要${verb}哪一天的餐點，請一次告訴我一個日期。`;
  }

  return "我還不能確定是哪一天，請再說一次日期。";
}

function roundPatchValue(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function matchesCandidateLabel(candidate: MealCorrectionCandidate, normalizedQuery: string): boolean {
  const labels = [candidate.foodName, ...candidate.itemNames].map(normalizeText);
  return labels.some((label) => label.length > 0 && normalizedQuery.includes(label));
}

function distributePatchedTotal(
  items: MealTransactionItemInput[],
  field: NumericItemField,
  targetTotal: number,
): MealTransactionItemInput[] {
  if (items.length === 1) {
    return [{ ...items[0]!, [field]: targetTotal }];
  }

  const currentTotal = items.reduce((sum, item) => sum + item[field], 0);
  let remaining = targetTotal;

  return items.map((item, index) => {
    if (index === items.length - 1) {
      return {
        ...item,
        [field]: roundPatchValue(remaining),
      };
    }

    let nextValue: number;
    if (currentTotal > 0) {
      nextValue = roundPatchValue(targetTotal * (item[field] / currentTotal));
    } else {
      nextValue = roundPatchValue(targetTotal / items.length);
    }

    remaining -= nextValue;
    return {
      ...item,
      [field]: nextValue,
    };
  });
}

function applyMealPatch(
  currentItems: MealTransactionItemInput[],
  patch: Partial<MealTransactionItemInput>,
): MealTransactionItemInput[] {
  let nextItems = currentItems.map((item) => ({ ...item }));

  if (patch.foodName !== undefined) {
    if (nextItems.length !== 1) {
      throw new Error("MEAL_NAME_PATCH_REQUIRES_SINGLE_ITEM");
    }
    nextItems[0] = {
      ...nextItems[0]!,
      foodName: patch.foodName,
    };
  }

  for (const field of NUMERIC_ITEM_FIELDS) {
    const nextValue = patch[field];
    if (nextValue === undefined) {
      continue;
    }
    nextItems = distributePatchedTotal(nextItems, field, nextValue);
  }

  return nextItems;
}

function scoreCandidate(
  candidate: MealCorrectionCandidate,
  query: string,
  targetDateKey: string | undefined,
  targetMealPeriod: MealCorrectionCandidate["mealPeriod"] | undefined,
): number {
  const normalizedQuery = normalizeText(query);
  let score = 0;

  if (targetDateKey) {
    if (candidate.dateKey !== targetDateKey) {
      return -1;
    }
    score += 4;
  }

  if (targetMealPeriod) {
    if (candidate.mealPeriod !== targetMealPeriod) {
      return -1;
    }
    score += 2;
  }

  const matched = matchesCandidateLabel(candidate, normalizedQuery);
  if (matched) {
    score += 3;
  }

  return score;
}

function resolveFindMealsTargetDateKey(
  query: string,
  action: "update" | "delete",
  options?: FindMealsOptions,
): { status: "resolved"; targetDateKey?: string } | { status: "needs_clarification"; prompt: string } {
  const currentDate = options?.currentDate ?? currentAppDate();
  const dateIntent = resolveHistoricalDateIntent({
    input: query,
    currentDate,
    mode: "mutation",
    previousDateKey: options?.previousDateKey,
  });

  if (dateIntent.status === "needs_clarification") {
    return {
      status: "needs_clarification",
      prompt: buildDateClarificationPrompt(action, dateIntent.reason),
    };
  }

  if (dateIntent.status === "resolved_many") {
    return {
      status: "needs_clarification",
      prompt: buildDateClarificationPrompt(action, "multiple_dates"),
    };
  }

  return {
    status: "resolved",
    targetDateKey: dateIntent.source === "default_today" ? undefined : dateIntent.dateKey,
  };
}

export function createMealCorrectionService(db: AppDatabase) {
  const mealTransactionsService = createMealTransactionsService(db);
  const turnStateService = createTurnStateService(db);
  const summaryService = createSummaryService(db);

  async function loadActiveCandidates(deviceId: string, limit = 20): Promise<MealCorrectionCandidate[]> {
    const headers = await db
      .select({
        id: mealTransactions.id,
        loggedAt: mealTransactions.loggedAt,
        currentRevisionId: mealTransactions.currentRevisionId,
      })
      .from(mealTransactions)
      .where(and(eq(mealTransactions.deviceId, deviceId), isNull(mealTransactions.deletedAt)))
      .orderBy(asc(mealTransactions.loggedAt));

    if (headers.length === 0) {
      return [];
    }

    const limitedHeaders = headers.slice(-limit).reverse();
    const revisionIds = limitedHeaders.map((header) => header.currentRevisionId);
    const items = await db
      .select()
      .from(mealRevisionItems)
      .where(inArray(mealRevisionItems.revisionId, revisionIds))
      .orderBy(asc(mealRevisionItems.position));

    const itemsByRevisionId = new Map<string, typeof items>();
    for (const item of items) {
      const existing = itemsByRevisionId.get(item.revisionId) ?? [];
      existing.push(item);
      itemsByRevisionId.set(item.revisionId, existing);
    }

    return limitedHeaders.map((header) => {
      const revisionItems = itemsByRevisionId.get(header.currentRevisionId) ?? [];
      const foodName =
        revisionItems.length <= 1
          ? revisionItems[0]?.foodName ?? "未知餐點"
          : revisionItems.length === 2
            ? `${revisionItems[0]!.foodName}、${revisionItems[1]!.foodName}`
            : `${revisionItems[0]!.foodName}、${revisionItems[1]!.foodName} 等${revisionItems.length}項`;

      return {
        mealId: header.id,
        foodName,
        itemNames: revisionItems.map((item) => item.foodName),
        calories: revisionItems.reduce((sum, item) => sum + item.calories, 0),
        protein: revisionItems.reduce((sum, item) => sum + item.protein, 0),
        carbs: revisionItems.reduce((sum, item) => sum + item.carbs, 0),
        fat: revisionItems.reduce((sum, item) => sum + item.fat, 0),
        loggedAt: header.loggedAt,
        dateKey: formatLocalDate(new Date(header.loggedAt)),
        mealPeriod: inferMealPeriod(header.loggedAt),
      };
    });
  }

  async function rememberResolvedCandidate(
    deviceId: string,
    action: "update" | "delete",
    candidate: MealCorrectionCandidate,
  ): Promise<void> {
    await turnStateService.putState(
      deviceId,
      PENDING_SELECTION_KIND,
      { action, candidates: [candidate] },
      PENDING_SELECTION_TTL_MS,
    );
  }

  async function loadCurrentItems(deviceId: string, mealId: string): Promise<MealTransactionItemInput[]> {
    const transaction = await db
      .select({
        currentRevisionId: mealTransactions.currentRevisionId,
      })
      .from(mealTransactions)
      .where(and(
        eq(mealTransactions.deviceId, deviceId),
        eq(mealTransactions.id, mealId),
        isNull(mealTransactions.deletedAt),
      ))
      .limit(1);

    const currentRevisionId = transaction[0]?.currentRevisionId;
    if (!currentRevisionId) {
      throw new Error("MEAL_NOT_FOUND");
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
      .where(eq(mealRevisionItems.revisionId, currentRevisionId))
      .orderBy(asc(mealRevisionItems.position));

    if (items.length === 0) {
      throw new Error("MEAL_ITEMS_REQUIRED");
    }

    return items;
  }

  async function tryResolvePendingSelection(
    deviceId: string,
    query: string,
  ): Promise<FindMealsResolvedResult | FindMealsClarificationResult | undefined> {
    const pending = await turnStateService.getState<PendingMealSelectionState>(deviceId, PENDING_SELECTION_KIND);
    if (!pending) {
      return undefined;
    }

    const index = extractSelectionIndex(query);
    if (index !== undefined) {
      const candidate = pending.candidates[index];
      if (!candidate) {
        return {
          status: "needs_clarification",
          action: pending.action,
          prompt: buildClarificationPrompt(pending.action, pending.candidates),
          candidates: pending.candidates,
        };
      }

      return {
        status: "resolved",
        action: pending.action,
        resolvedMealId: candidate.mealId,
        candidate,
        fromPending: true,
      };
    }

    const normalized = normalizeText(query);
    const matchingCandidates = pending.candidates.filter((candidate) => {
      const labels = [candidate.foodName, ...candidate.itemNames].map(normalizeText);
      return labels.some((label) => label.length > 0 && normalized.includes(label));
    });

    if (matchingCandidates.length === 1) {
      return {
        status: "resolved",
        action: pending.action,
        resolvedMealId: matchingCandidates[0]!.mealId,
        candidate: matchingCandidates[0]!,
        fromPending: true,
      };
    }

    if (pending.candidates.length === 1) {
      return {
        status: "resolved",
        action: pending.action,
        resolvedMealId: pending.candidates[0]!.mealId,
        candidate: pending.candidates[0]!,
        fromPending: true,
      };
    }

    await turnStateService.clearState(deviceId, PENDING_SELECTION_KIND);
    return undefined;
  }

  return {
    async findMeals(
      deviceId: string,
      action: "update" | "delete",
      query: string,
      options?: FindMealsOptions,
    ): Promise<FindMealsResult> {
      const pendingSelection = await tryResolvePendingSelection(deviceId, query);
      if (pendingSelection) {
        return pendingSelection;
      }

      const candidates = await loadActiveCandidates(deviceId);
      if (candidates.length === 0) {
        return {
          status: "not_found",
          action,
          prompt: buildNotFoundPrompt(action),
        };
      }

      const dateResolution = resolveFindMealsTargetDateKey(query, action, options);
      if (dateResolution.status === "needs_clarification") {
        return {
          status: "needs_clarification",
          action,
          prompt: dateResolution.prompt,
          candidates: [],
        };
      }

      const targetDateKey = dateResolution.targetDateKey;
      const targetMealPeriod = extractMealPeriod(query);
      const normalizedQuery = normalizeText(query);

      const scored = candidates
        .map((candidate) => ({
          candidate,
          score: scoreCandidate(candidate, query, targetDateKey, targetMealPeriod),
          labelMatched: matchesCandidateLabel(candidate, normalizedQuery),
        }))
        .filter((entry) => entry.score >= 0)
        .sort((left, right) => {
          if (right.score !== left.score) {
            return right.score - left.score;
          }
          return right.candidate.loggedAt.localeCompare(left.candidate.loggedAt);
        });

      if (hasRecentReference(query)) {
        const positiveMatches = scored.filter((entry) => entry.score > 0);
        if (positiveMatches.length > 0) {
          await rememberResolvedCandidate(deviceId, action, positiveMatches[0]!.candidate);
          return {
            status: "resolved",
            action,
            resolvedMealId: positiveMatches[0]!.candidate.mealId,
            candidate: positiveMatches[0]!.candidate,
            fromPending: false,
          };
        }

        const hasStructuredHint = targetDateKey !== undefined || targetMealPeriod !== undefined;
        const hasLabelHint = scored.some((entry) => entry.labelMatched);
        if (!hasStructuredHint && !hasLabelHint) {
          await rememberResolvedCandidate(deviceId, action, candidates[0]!);
          return {
            status: "resolved",
            action,
            resolvedMealId: candidates[0]!.mealId,
            candidate: candidates[0]!,
            fromPending: false,
          };
        }
      }

      if (scored.length === 0) {
        return {
          status: "not_found",
          action,
          prompt: buildNotFoundPrompt(action),
        };
      }

      const bestScore = scored[0]!.score;
      const top = scored.filter((entry) => entry.score === bestScore).map((entry) => entry.candidate);

      if (bestScore <= 0) {
        return {
          status: "not_found",
          action,
          prompt: buildNotFoundPrompt(action),
        };
      }

      if (top.length === 1) {
        await rememberResolvedCandidate(deviceId, action, top[0]!);
        return {
          status: "resolved",
          action,
          resolvedMealId: top[0]!.mealId,
          candidate: top[0]!,
          fromPending: false,
        };
      }

      const narrowed = top.slice(0, 5);
      await turnStateService.putState(
        deviceId,
        PENDING_SELECTION_KIND,
        { action, candidates: narrowed },
        PENDING_SELECTION_TTL_MS,
      );

      return {
        status: "needs_clarification",
        action,
        prompt: buildClarificationPrompt(action, narrowed),
        candidates: narrowed,
      };
    },

    async clearPendingSelection(deviceId: string): Promise<void> {
      await turnStateService.clearState(deviceId, PENDING_SELECTION_KIND);
    },

    async updateMeal(
      deviceId: string,
      mealId: string,
      input: MealCorrectionUpdateInput,
    ): Promise<{
      updatedMeal: {
        id: string;
        mealRevisionId: string;
        foodName: string;
        calories: number;
        protein: number;
        carbs: number;
        fat: number;
        imagePath: string | null;
        loggedAt: string;
      };
      affectedDate: string;
      dailySummary: DailySummary;
    }> {
      const items = "items" in input
        ? input.items
        : (() => {
            const patch = input.patch;
            return patch;
          })();
      let nextItems: MealTransactionItemInput[];

      if (Array.isArray(items)) {
        nextItems = items;
      } else {
        const currentItems = await loadCurrentItems(deviceId, mealId);
        nextItems = applyMealPatch(currentItems, items);
      }

      const updated = await mealTransactionsService.updateTransaction(deviceId, mealId, { items: nextItems });
      const dailySummary = await summaryService.getDailySummary(
        deviceId,
        new Date(`${updated.affectedDateKey}T12:00:00`),
      );

      const foodName =
        updated.items.length <= 1
          ? updated.items[0]!.foodName
          : updated.items.length === 2
            ? `${updated.items[0]!.foodName}、${updated.items[1]!.foodName}`
            : `${updated.items[0]!.foodName}、${updated.items[1]!.foodName} 等${updated.items.length}項`;

      return {
        updatedMeal: {
          id: updated.transactionId,
          mealRevisionId: updated.revisionId,
          foodName,
          calories: updated.items.reduce((sum, item) => sum + item.calories, 0),
          protein: updated.items.reduce((sum, item) => sum + item.protein, 0),
          carbs: updated.items.reduce((sum, item) => sum + item.carbs, 0),
          fat: updated.items.reduce((sum, item) => sum + item.fat, 0),
          imagePath: updated.imageAssetId ? makeAssetRef(updated.imageAssetId) : null,
          loggedAt: updated.loggedAt,
        },
        affectedDate: updated.affectedDateKey,
        dailySummary,
      };
    },

    async deleteMeal(
      deviceId: string,
      mealId: string,
    ): Promise<{ deletedMealId: string; affectedDate: string; dailySummary: DailySummary }> {
      const deleted = await mealTransactionsService.softDeleteTransaction(deviceId, mealId);
      const dailySummary = await summaryService.getDailySummary(
        deviceId,
        new Date(`${deleted.affectedDateKey}T12:00:00`),
      );

      return {
        deletedMealId: deleted.transactionId,
        affectedDate: deleted.affectedDateKey,
        dailySummary,
      };
    },
  };
}
