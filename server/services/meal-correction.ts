import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import type { AppDatabase } from "../db/client.js";
import {
  mealRevisionItems,
  mealTransactions,
} from "../db/schema.js";
import { resolveHistoricalDateIntent } from "../lib/historical-date.js";
import { currentAppDate, formatLocalDate } from "../lib/time.js";
import {
  createMealTransactionsService,
  type DeletedMealSnapshot,
  type MealTransactionItemInput,
} from "./meal-transactions.js";
import type {
  MealNumericAffectedField,
  MealNumericField,
  MealNumericUpdateInput,
} from "./meal-numeric-proposals.js";
import { createTurnStateService } from "./turn-state.js";
import { createSummaryService, type DailySummary } from "./summary.js";
import { createFoodLoggingService } from "./food-logging.js";
import {
  buildSummaryOutcomeAfterMealCommit,
  dailySummaryFromOutcome,
  type SummaryOutcome,
} from "./summary-outcome.js";
import { makeAssetRef } from "./assets.js";
import { projectMealDisplay } from "./meal-display.js";
import { normalizeMealPeriod, type MealPeriod } from "../lib/meal-period.js";

const PENDING_SELECTION_KIND = "meal_target_selection";
const PENDING_SELECTION_TTL_MS = 15 * 60 * 1000;

export interface MealCorrectionCandidate {
  mealId: string;
  mealRevisionId: string;
  foodName: string;
  itemCount: number;
  itemNames: string[];
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  loggedAt: string;
  dateKey: string;
  mealPeriod: MealPeriod;
  mealPeriodSource: "explicit" | "inferred";
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
  mealRevisionId: string;
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
  mealPeriod: MealPeriod | null;
  currentRevisionId: string;
}

type DateResolution =
  | {
      status: "resolved";
      targetDateKey?: string;
      hasExplicitDate: boolean;
      canUseDateRecovery: boolean;
    }
  | { status: "needs_clarification"; prompt: string };

interface EvidenceTierResolution {
  status: "resolved" | "needs_clarification" | "not_found";
  candidates: MealCorrectionCandidate[];
  rememberResolved: boolean;
  prompt?: string;
}

const NUMERIC_ITEM_FIELDS = ["calories", "protein", "carbs", "fat"] as const;
type NumericItemField = (typeof NUMERIC_ITEM_FIELDS)[number];

interface MealCorrectionServiceDeps {
  summaryService?: Pick<ReturnType<typeof createSummaryService>, "getDailySummary">;
  foodLoggingService?: Pick<ReturnType<typeof createFoodLoggingService>, "getMealsByDate">;
}

export interface CurrentMealFacts {
  mealId: string;
  currentMealRevisionId: string;
  mealLabel: string;
  items: MealTransactionItemInput[];
  totals: Record<NumericItemField, number>;
}

export type MealNumericOperatorIntent =
  | { fields: MealNumericField[]; operator: "half" }
  | { fields: MealNumericField[]; operator: "subtract_percent"; value: number }
  | { fields: MealNumericField[]; operator: "add_amount"; value: number }
  | { fields: MealNumericField[]; operator: "subtract_amount"; value: number };

export interface MealNumericCorrectionPreview {
  mealId: string;
  expectedMealRevisionId: string;
  mealLabel: string;
  updateInput: MealNumericUpdateInput;
  items?: MealTransactionItemInput[];
  affectedFields: MealNumericAffectedField[];
  sourceOperator: MealNumericOperatorIntent["operator"];
}

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, "");
}

function inferMealPeriod(loggedAt: string): MealPeriod {
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
  if (/宵夜/.test(query)) return "late_night";
  return undefined;
}

function hasUnsupportedMealPeriodReference(query: string): boolean {
  return /(點心|下午茶)/.test(query);
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
  const explicitPeriodLabel = candidate.mealPeriodSource === "explicit"
    ? ` ${formatMealPeriodLabel(candidate.mealPeriod)}`
    : "";
  return `${index + 1}. ${candidate.dateKey} ${hour}:${minute}${explicitPeriodLabel} ${candidate.foodName}`;
}

function formatMealPeriodLabel(period: MealPeriod): string {
  switch (period) {
    case "breakfast":
      return "早餐";
    case "lunch":
      return "午餐";
    case "dinner":
      return "晚餐";
    case "late_night":
      return "宵夜";
    default:
      return "餐別";
  }
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

function buildDateNoMealsPrompt(action: "update" | "delete", dateKey: string): string {
  const verb = action === "update" ? "修改" : "刪除";
  return `${dateKey} 沒有記錄餐點，所以我還不能${verb}那一天的餐點。請提供另一個日期或食物名稱。`;
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

function roundNonNegativePatchValue(value: number): number {
  return roundPatchValue(Math.max(value, 0));
}

function matchesCandidateLabel(candidate: MealCorrectionCandidate, normalizedQuery: string): boolean {
  const labels = [candidate.foodName, ...candidate.itemNames].map(normalizeText);
  return labels.some((label) => label.length > 0 && normalizedQuery.includes(label));
}

function extractTargetEvidenceText(query: string): string {
  const changeVerb = query.match(/^(.*?)(?:改成|改為|改到|變成|換成|調成)/);
  return changeVerb?.[1] ?? query;
}

function hasLikelyFoodReference(query: string): boolean {
  const targetText = normalizeText(extractTargetEvidenceText(query))
    .replace(/今天|昨日|昨天|前天|明天|上週|這週|本週|星期[一二三四五六日天]|週[一二三四五六日天]/g, "")
    .replace(/早餐|早上|早飯|午餐|中午|晚餐|晚上|宵夜|點心|下午茶/g, "")
    .replace(/剛剛|剛才|上一筆|上一餐|那筆|這筆|那餐|這餐|第[一二兩三四五六七八九0-9]+(?:個|筆|份|條)?/g, "")
    .replace(/幫我|請|把|的|要|想|覺得|正常|平均|多少|哪一筆|哪餐/g, "")
    .replace(/修改|修正|更新|調整|降低|提高|刪掉|刪除|移除|補充|套用/g, "")
    .replace(/蛋白質|熱量|卡路里|碳水化合物|碳水|脂肪|卡|kcal|cal/g, "")
    .replace(/[0-9０-９一二兩三四五六七八九十百千.]+(?:g|克|卡|顆|份|碗|盤|個)?/g, "");

  return /(雞|鴨|豬|牛|羊|魚|蝦|蛋|飯|麵|面|菜|豆|奶|肉|便當|餅|粥|湯|沙拉|吐司|麥|滷|煮|炸|烤|炒|咖哩)/.test(targetText);
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

function sortNewestFirst(candidates: MealCorrectionCandidate[]): MealCorrectionCandidate[] {
  return [...candidates].sort((left, right) => right.loggedAt.localeCompare(left.loggedAt));
}

function chooseUniqueOrClarify(
  candidates: MealCorrectionCandidate[],
  query: string,
  allowRecentTieBreak: boolean,
): EvidenceTierResolution {
  const sorted = sortNewestFirst(candidates);
  if (sorted.length === 0) {
    return { status: "not_found", candidates: [], rememberResolved: false };
  }

  if (sorted.length === 1 || (allowRecentTieBreak && hasRecentReference(query))) {
    return {
      status: "resolved",
      candidates: [sorted[0]!],
      rememberResolved: true,
    };
  }

  return {
    status: "needs_clarification",
    candidates: sorted.slice(0, 5),
    rememberResolved: false,
  };
}

function resolveByEvidenceTier(
  candidates: MealCorrectionCandidate[],
  action: "update" | "delete",
  query: string,
  dateResolution: Extract<DateResolution, { status: "resolved" }>,
): EvidenceTierResolution {
  const scopedCandidates = dateResolution.targetDateKey
    ? candidates.filter((candidate) => candidate.dateKey === dateResolution.targetDateKey)
    : candidates;
  const targetMealPeriod = extractMealPeriod(query);
  const unsupportedMealPeriodReference = targetMealPeriod === undefined
    && hasUnsupportedMealPeriodReference(query);
  const normalizedQuery = normalizeText(extractTargetEvidenceText(query));
  const labelMatches = scopedCandidates.filter((candidate) => matchesCandidateLabel(candidate, normalizedQuery));

  if (labelMatches.length > 0) {
    return chooseUniqueOrClarify(labelMatches, query, true);
  }

  if (hasLikelyFoodReference(query)) {
    if (dateResolution.targetDateKey && dateResolution.canUseDateRecovery) {
      const sameDate = sortNewestFirst(scopedCandidates).slice(0, 5);
      return sameDate.length > 0
        ? { status: "needs_clarification", candidates: sameDate, rememberResolved: false }
        : {
            status: "needs_clarification",
            candidates: [],
            rememberResolved: false,
            prompt: buildDateNoMealsPrompt(action, dateResolution.targetDateKey),
          };
    }

    return { status: "needs_clarification", candidates: [], rememberResolved: false };
  }

  if (unsupportedMealPeriodReference) {
    const sameScope = sortNewestFirst(scopedCandidates).slice(0, 5);
    return sameScope.length > 0
      ? { status: "needs_clarification", candidates: sameScope, rememberResolved: false }
      : { status: "needs_clarification", candidates: [], rememberResolved: false };
  }

  if (targetMealPeriod) {
    const periodMatches = scopedCandidates.filter((candidate) => candidate.mealPeriod === targetMealPeriod);
    const explicitMatches = periodMatches.filter((candidate) => candidate.mealPeriodSource === "explicit");
    if (explicitMatches.length > 0) {
      return chooseUniqueOrClarify(explicitMatches, query, true);
    }

    const inferredMatches = periodMatches.filter((candidate) => candidate.mealPeriodSource === "inferred");
    if (inferredMatches.length > 0) {
      return chooseUniqueOrClarify(inferredMatches, query, true);
    }
  }

  if (hasRecentReference(query) && scopedCandidates.length > 0) {
    return {
      status: "resolved",
      candidates: [sortNewestFirst(scopedCandidates)[0]!],
      rememberResolved: true,
    };
  }

  if (dateResolution.targetDateKey && dateResolution.canUseDateRecovery) {
    if (scopedCandidates.length === 0) {
      return {
        status: "needs_clarification",
        candidates: [],
        rememberResolved: false,
        prompt: buildDateNoMealsPrompt(action, dateResolution.targetDateKey),
      };
    }

    return chooseUniqueOrClarify(scopedCandidates, query, false);
  }

  return { status: "not_found", candidates: [], rememberResolved: false };
}

function resolveFindMealsTargetDateKey(
  query: string,
  action: "update" | "delete",
  options?: FindMealsOptions,
): DateResolution {
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
    hasExplicitDate: dateIntent.source === "explicit",
    canUseDateRecovery: dateIntent.source === "explicit" && dateIntent.isHistorical,
  };
}

export function createMealCorrectionService(db: AppDatabase, deps: MealCorrectionServiceDeps = {}) {
  const mealTransactionsService = createMealTransactionsService(db);
  const turnStateService = createTurnStateService(db);
  const summaryService = deps.summaryService ?? createSummaryService(db);
  const foodLoggingService = deps.foodLoggingService ?? createFoodLoggingService(db);

  async function loadActiveCandidates(deviceId: string, limit = 20): Promise<MealCorrectionCandidate[]> {
    const headers = await db
      .select({
        id: mealTransactions.id,
        loggedAt: mealTransactions.loggedAt,
        mealPeriod: mealTransactions.mealPeriod,
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
      const display = projectMealDisplay(revisionItems, "未知餐點");
      const explicitMealPeriod = normalizeMealPeriod(header.mealPeriod);

      return {
        mealId: header.id,
        mealRevisionId: header.currentRevisionId,
        foodName: display.foodName,
        itemCount: display.itemCount,
        itemNames: revisionItems.map((item) => item.foodName),
        calories: revisionItems.reduce((sum, item) => sum + item.calories, 0),
        protein: revisionItems.reduce((sum, item) => sum + item.protein, 0),
        carbs: revisionItems.reduce((sum, item) => sum + item.carbs, 0),
        fat: revisionItems.reduce((sum, item) => sum + item.fat, 0),
        loggedAt: header.loggedAt,
        dateKey: formatLocalDate(new Date(header.loggedAt)),
        mealPeriod: explicitMealPeriod ?? inferMealPeriod(header.loggedAt),
        mealPeriodSource: explicitMealPeriod ? "explicit" : "inferred",
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

  async function tryResolvePendingSelection(
    deviceId: string,
    action: "update" | "delete",
    query: string,
  ): Promise<FindMealsResolvedResult | FindMealsClarificationResult | undefined> {
    const pending = await turnStateService.getState<PendingMealSelectionState>(deviceId, PENDING_SELECTION_KIND);
    if (!pending) {
      return undefined;
    }

    if (pending.action !== action) {
      await turnStateService.clearState(deviceId, PENDING_SELECTION_KIND);
      return undefined;
    }

    if (hasUnsupportedMealPeriodReference(query) && extractMealPeriod(query) === undefined) {
      await turnStateService.clearState(deviceId, PENDING_SELECTION_KIND);
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
        mealRevisionId: candidate.mealRevisionId,
        candidate,
        fromPending: true,
      };
    }

    const normalized = normalizeText(extractTargetEvidenceText(query));
    const matchingCandidates = pending.candidates.filter((candidate) => {
      const labels = [candidate.foodName, ...candidate.itemNames].map(normalizeText);
      return labels.some((label) => label.length > 0 && normalized.includes(label));
    });

    if (matchingCandidates.length === 1) {
      return {
        status: "resolved",
        action: pending.action,
        resolvedMealId: matchingCandidates[0]!.mealId,
        mealRevisionId: matchingCandidates[0]!.mealRevisionId,
        candidate: matchingCandidates[0]!,
        fromPending: true,
      };
    }

    if (
      pending.candidates.length === 1 &&
      !hasLikelyFoodReference(query) &&
      extractMealPeriod(query) === undefined &&
      !hasUnsupportedMealPeriodReference(query)
    ) {
      return {
        status: "resolved",
        action: pending.action,
        resolvedMealId: pending.candidates[0]!.mealId,
        mealRevisionId: pending.candidates[0]!.mealRevisionId,
        candidate: pending.candidates[0]!,
        fromPending: true,
      };
    }

    await turnStateService.clearState(deviceId, PENDING_SELECTION_KIND);
    return undefined;
  }

  function previewFieldValue(before: number, intent: MealNumericOperatorIntent): number {
    switch (intent.operator) {
      case "half":
        return roundNonNegativePatchValue(before / 2);
      case "subtract_percent":
        return roundNonNegativePatchValue(before * (1 - intent.value / 100));
      case "add_amount":
        return roundNonNegativePatchValue(before + intent.value);
      case "subtract_amount":
        return roundNonNegativePatchValue(before - intent.value);
      default:
        throw new Error("unsupported meal numeric correction operator");
    }
  }

  function previewMealNumericCorrection(
    currentFacts: CurrentMealFacts,
    operatorIntent: MealNumericOperatorIntent,
  ): MealNumericCorrectionPreview {
    if (operatorIntent.fields.length === 0) {
      throw new Error("meal numeric correction requires at least one field");
    }

    const updateInput: MealNumericUpdateInput = {};
    const affectedFields: MealNumericAffectedField[] = [];
    for (const field of operatorIntent.fields) {
      const before = currentFacts.totals[field];
      const after = previewFieldValue(before, operatorIntent);
      updateInput[field] = after;
      affectedFields.push({ field, before, after });
    }

    return {
      mealId: currentFacts.mealId,
      expectedMealRevisionId: currentFacts.currentMealRevisionId,
      mealLabel: currentFacts.mealLabel,
      updateInput,
      affectedFields,
      sourceOperator: operatorIntent.operator,
    };
  }

  return {
    async findMeals(
      deviceId: string,
      action: "update" | "delete",
      query: string,
      options?: FindMealsOptions,
    ): Promise<FindMealsResult> {
      const pendingSelection = await tryResolvePendingSelection(deviceId, action, query);
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

      const tierResult = resolveByEvidenceTier(candidates, action, query, dateResolution);

      if (tierResult.status === "not_found") {
        return {
          status: "not_found",
          action,
          prompt: tierResult.prompt ?? buildNotFoundPrompt(action),
        };
      }

      if (tierResult.status === "resolved") {
        const candidate = tierResult.candidates[0]!;
        if (tierResult.rememberResolved) {
          await rememberResolvedCandidate(deviceId, action, candidate);
        }
        return {
          status: "resolved",
          action,
          resolvedMealId: candidate.mealId,
          mealRevisionId: candidate.mealRevisionId,
          candidate,
          fromPending: false,
        };
      }

      const narrowed = tierResult.candidates.slice(0, 5);
      if (narrowed.length > 0) {
        await turnStateService.putState(
          deviceId,
          PENDING_SELECTION_KIND,
          { action, candidates: narrowed },
          PENDING_SELECTION_TTL_MS,
        );
      }

      return {
        status: "needs_clarification",
        action,
        prompt: tierResult.prompt ?? (
          narrowed.length > 0 ? buildClarificationPrompt(action, narrowed) : buildNotFoundPrompt(action)
        ),
        candidates: narrowed,
      };
    },

    async clearPendingSelection(deviceId: string): Promise<void> {
      await turnStateService.clearState(deviceId, PENDING_SELECTION_KIND);
    },

    async loadCurrentMealFacts(
      deviceId: string,
      mealId: string,
      expectedMealRevisionId: string,
    ): Promise<CurrentMealFacts> {
      const items = await mealTransactionsService.getCurrentItemsForMutation(
        deviceId,
        mealId,
        expectedMealRevisionId,
      );
      const header = await db
        .select({
          id: mealTransactions.id,
          currentRevisionId: mealTransactions.currentRevisionId,
        })
        .from(mealTransactions)
        .where(and(eq(mealTransactions.deviceId, deviceId), eq(mealTransactions.id, mealId)))
        .limit(1);
      const current = header[0];
      if (!current) {
        throw new Error("MEAL_NOT_FOUND");
      }
      const display = projectMealDisplay(items, "未知餐點");

      return {
        mealId: current.id,
        currentMealRevisionId: current.currentRevisionId,
        mealLabel: display.foodName,
        items,
        totals: {
          calories: items.reduce((sum, item) => sum + item.calories, 0),
          protein: items.reduce((sum, item) => sum + item.protein, 0),
          carbs: items.reduce((sum, item) => sum + item.carbs, 0),
          fat: items.reduce((sum, item) => sum + item.fat, 0),
        },
      };
    },

    previewMealNumericCorrection,

    async updateMeal(
      deviceId: string,
      mealId: string,
      input: MealCorrectionUpdateInput,
      expectedMealRevisionId?: string | null,
    ): Promise<{
      updatedMeal: {
        id: string;
        mealRevisionId: string;
        foodName: string;
        calories: number;
        protein: number;
        carbs: number;
        fat: number;
        itemCount: number;
        items: Array<{
          name: string;
          position: number;
          calories: number;
          protein: number;
          carbs: number;
          fat: number;
        }>;
        imagePath: string | null;
        loggedAt: string;
        mealPeriod: MealPeriod | null;
      };
      affectedDate: string;
      summaryOutcome: SummaryOutcome;
      dailySummary?: DailySummary;
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
        const currentItems = await mealTransactionsService.getCurrentItemsForMutation(
          deviceId,
          mealId,
          expectedMealRevisionId,
        );
        nextItems = applyMealPatch(currentItems, items);
      }

      const updated = await mealTransactionsService.updateTransaction(deviceId, mealId, {
        expectedMealRevisionId,
        items: nextItems,
      });
      const summaryOutcome = await buildSummaryOutcomeAfterMealCommit({
        deviceId,
        affectedDate: updated.affectedDateKey,
        summaryService,
        foodLoggingService,
      });
      const dailySummary = dailySummaryFromOutcome(summaryOutcome);

      const display = projectMealDisplay(updated.items);

      return {
        updatedMeal: {
          id: updated.transactionId,
          mealRevisionId: updated.revisionId,
          foodName: display.foodName,
          calories: updated.items.reduce((sum, item) => sum + item.calories, 0),
          protein: updated.items.reduce((sum, item) => sum + item.protein, 0),
          carbs: updated.items.reduce((sum, item) => sum + item.carbs, 0),
          fat: updated.items.reduce((sum, item) => sum + item.fat, 0),
          itemCount: display.itemCount,
          items: updated.items.map((item, index) => ({
            name: item.foodName,
            position: index + 1,
            calories: item.calories,
            protein: item.protein,
            carbs: item.carbs,
            fat: item.fat,
          })),
          imagePath: updated.imageAssetId ? makeAssetRef(updated.imageAssetId) : null,
          loggedAt: updated.loggedAt,
          mealPeriod: updated.mealPeriod,
        },
        affectedDate: updated.affectedDateKey,
        summaryOutcome,
        ...(dailySummary ? { dailySummary } : {}),
      };
    },

    async deleteMeal(
      deviceId: string,
      mealId: string,
      expectedMealRevisionId?: string | null,
    ): Promise<{
      deletedMealId: string;
      affectedDate: string;
      summaryOutcome: SummaryOutcome;
      dailySummary?: DailySummary;
      deletedMeal: DeletedMealSnapshot;
    }> {
      const deleted = await mealTransactionsService.softDeleteTransaction(deviceId, mealId, expectedMealRevisionId);
      const summaryOutcome = await buildSummaryOutcomeAfterMealCommit({
        deviceId,
        affectedDate: deleted.affectedDateKey,
        summaryService,
        foodLoggingService,
      });
      const dailySummary = dailySummaryFromOutcome(summaryOutcome);

      return {
        deletedMealId: deleted.deletedMeal.mealId,
        affectedDate: deleted.affectedDateKey,
        summaryOutcome,
        ...(dailySummary ? { dailySummary } : {}),
        deletedMeal: deleted.deletedMeal,
      };
    },
  };
}
