import { and, asc, desc, eq, gt, gte, inArray, isNull, lt, or, sql } from "drizzle-orm";
import type { AppDatabase } from "../db/client.js";
import {
  mealRevisionItems,
  mealRevisions,
  mealTransactions,
} from "../db/schema.js";
import { normalizeMealPeriod, type MealPeriod } from "../lib/meal-period.js";
import { formatLocalDate, getLocalDayBounds } from "../lib/time.js";
import { buildAssetUrl } from "./assets.js";
import { projectMealDisplay } from "./meal-display.js";
import type { createSummaryService, DailySummary } from "./summary.js";

const HISTORY_DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export interface HistoryQueryIssue {
  field: string;
  message: string;
}

export interface HistoryMealDto {
  id: string;
  mealRevisionId: string;
  dateKey: string;
  loggedAt: string;
  display: { title: string };
  itemCount: number;
  nutrition: { calories: number; protein: number; carbs: number; fat: number };
  items: Array<{
    name: string;
    position: number;
    nutrition: { calories: number; protein: number; carbs: number; fat: number };
  }>;
  asset: { imageAssetId: string | null; imageUrl: string | null };
  imageAssetId: string | null;
  imageUrl: string | null;
  mealPeriod?: MealPeriod;
  revision: { currentRevisionNumber: number };
}

export interface HistorySearchResultDto {
  item: {
    name: string;
    position: number;
    nutrition: { calories: number; protein: number; carbs: number; fat: number };
  };
  meal: HistoryMealDto;
}

export interface HistoryNutritionBounds {
  calories?: { min?: number; max?: number };
  protein?: { min?: number; max?: number };
  carbs?: { min?: number; max?: number };
  fat?: { min?: number; max?: number };
}

export type HistoryTrendCompleteness = "empty" | "sparse" | "complete";

export interface HistoryTrendBucketDto {
  date: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  mealCount: number;
}

export interface HistoryTrendResponseDto {
  from: string;
  to: string;
  completeness: HistoryTrendCompleteness;
  daily: HistoryTrendBucketDto[];
  totals: {
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
    mealCount: number;
  };
  averages: {
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
    mealsPerDay: number;
  };
}

export class HistoryQueryValidationError extends Error {
  readonly issues: HistoryQueryIssue[];

  constructor(issues: HistoryQueryIssue[]) {
    super("Invalid history query");
    this.name = "HistoryQueryValidationError";
    this.issues = issues;
  }
}

interface HistoryMealHeader {
  id: string;
  loggedAt: string;
  mealPeriod: MealPeriod | null;
  createdAt: string;
  currentRevisionId: string;
  currentRevisionNumber: number;
}

interface HistoryDateRange {
  fromDate: Date;
  toDate: Date;
  startIso: string;
  endIso: string;
}

interface HistoryCursor {
  loggedAt: string;
  createdAt: string;
  id: string;
}

interface HistorySearchCursor extends HistoryCursor {
  matchedItemPosition: number;
}

export const MAX_HISTORY_TREND_DAYS = 366;

interface MatchedHistoryMealHeader extends HistoryMealHeader {
  matchedItemPosition: number;
  matchedItemName: string;
}

function invalidIssue(field: string): HistoryQueryIssue {
  return { field, message: `${field} must be a valid YYYY-MM-DD date` };
}

export function parseHistoryDateKey(dateKey: string, field: string): Date {
  if (!HISTORY_DATE_KEY_PATTERN.test(dateKey)) {
    throw new HistoryQueryValidationError([invalidIssue(field)]);
  }

  const parsedDate = new Date(`${dateKey}T12:00:00`);
  const normalizedDateKey = Number.isNaN(parsedDate.getTime())
    ? ""
    : [
        String(parsedDate.getFullYear()).padStart(4, "0"),
        String(parsedDate.getMonth() + 1).padStart(2, "0"),
        String(parsedDate.getDate()).padStart(2, "0"),
      ].join("-");
  if (normalizedDateKey !== dateKey) {
    throw new HistoryQueryValidationError([invalidIssue(field)]);
  }

  return parsedDate;
}

function resolveHistoryDateRange(from: string, to: string, maxDays?: number): HistoryDateRange {
  const fromDate = parseHistoryDateKey(from, "from");
  const toDate = parseHistoryDateKey(to, "to");

  if (fromDate.getTime() > toDate.getTime()) {
    throw new HistoryQueryValidationError([
      { field: "from", message: "from must be on or before to" },
    ]);
  }

  const fromUtc = new Date(Date.UTC(2000, fromDate.getMonth(), fromDate.getDate()));
  fromUtc.setUTCFullYear(fromDate.getFullYear());
  const toUtc = new Date(Date.UTC(2000, toDate.getMonth(), toDate.getDate()));
  toUtc.setUTCFullYear(toDate.getFullYear());
  const inclusiveDays = Math.floor((toUtc.getTime() - fromUtc.getTime()) / 86_400_000) + 1;
  if (maxDays !== undefined && inclusiveDays > maxDays) {
    throw new HistoryQueryValidationError([
      { field: "to", message: `date range must not exceed ${maxDays} days` },
    ]);
  }

  const { startIso } = getLocalDayBounds(fromDate);
  const { endIso } = getLocalDayBounds(toDate);
  return { fromDate, toDate, startIso, endIso };
}

export function encodeHistoryCursor(cursor: HistoryCursor): string {
  return Buffer.from(
    JSON.stringify({ v: 1, loggedAt: cursor.loggedAt, createdAt: cursor.createdAt, id: cursor.id }),
    "utf8",
  ).toString("base64url");
}

function invalidCursor(): HistoryQueryValidationError {
  return new HistoryQueryValidationError([
    { field: "cursor", message: "cursor is invalid" },
  ]);
}

export function decodeHistoryCursor(value: string): HistoryCursor {
  try {
    const decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;
    if (
      decoded === null ||
      typeof decoded !== "object" ||
      !("v" in decoded) ||
      !("loggedAt" in decoded) ||
      !("createdAt" in decoded) ||
      !("id" in decoded)
    ) {
      throw invalidCursor();
    }

    const cursor = decoded as { v: unknown; loggedAt: unknown; createdAt: unknown; id: unknown };
    if (
      cursor.v !== 1 ||
      typeof cursor.loggedAt !== "string" ||
      cursor.loggedAt.length === 0 ||
      typeof cursor.createdAt !== "string" ||
      cursor.createdAt.length === 0 ||
      typeof cursor.id !== "string" ||
      cursor.id.length === 0
    ) {
      throw invalidCursor();
    }

    return { loggedAt: cursor.loggedAt, createdAt: cursor.createdAt, id: cursor.id };
  } catch (error) {
    if (error instanceof HistoryQueryValidationError) {
      throw error;
    }
    throw invalidCursor();
  }
}

function encodeHistorySearchCursor(cursor: HistorySearchCursor): string {
  return Buffer.from(
    JSON.stringify({
      v: 2,
      type: "history-search",
      loggedAt: cursor.loggedAt,
      createdAt: cursor.createdAt,
      id: cursor.id,
      matchedItemPosition: cursor.matchedItemPosition,
    }),
    "utf8",
  ).toString("base64url");
}

function decodeHistorySearchCursor(value: string): HistorySearchCursor {
  try {
    const decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;
    if (
      decoded === null ||
      typeof decoded !== "object" ||
      !("v" in decoded) ||
      !("type" in decoded) ||
      !("loggedAt" in decoded) ||
      !("createdAt" in decoded) ||
      !("id" in decoded) ||
      !("matchedItemPosition" in decoded)
    ) {
      throw invalidCursor();
    }

    const cursor = decoded as {
      v: unknown;
      type: unknown;
      loggedAt: unknown;
      createdAt: unknown;
      id: unknown;
      matchedItemPosition: unknown;
    };
    const matchedItemPosition = cursor.matchedItemPosition;
    if (
      cursor.v !== 2 ||
      cursor.type !== "history-search" ||
      typeof cursor.loggedAt !== "string" ||
      cursor.loggedAt.length === 0 ||
      typeof cursor.createdAt !== "string" ||
      cursor.createdAt.length === 0 ||
      typeof cursor.id !== "string" ||
      cursor.id.length === 0 ||
      typeof matchedItemPosition !== "number" ||
      !Number.isInteger(matchedItemPosition) ||
      matchedItemPosition < 0
    ) {
      throw invalidCursor();
    }

    return {
      loggedAt: cursor.loggedAt,
      createdAt: cursor.createdAt,
      id: cursor.id,
      matchedItemPosition,
    };
  } catch (error) {
    if (error instanceof HistoryQueryValidationError) {
      throw error;
    }
    throw invalidCursor();
  }
}

function createCursorSeekFilter(cursor: HistoryCursor) {
  return or(
    lt(mealTransactions.loggedAt, cursor.loggedAt),
    and(
      eq(mealTransactions.loggedAt, cursor.loggedAt),
      lt(mealTransactions.createdAt, cursor.createdAt),
    ),
    and(
      eq(mealTransactions.loggedAt, cursor.loggedAt),
      eq(mealTransactions.createdAt, cursor.createdAt),
      gt(mealTransactions.id, cursor.id),
    ),
  );
}

function createSearchCursorSeekFilter(cursor: HistorySearchCursor) {
  return or(
    lt(mealTransactions.loggedAt, cursor.loggedAt),
    and(
      eq(mealTransactions.loggedAt, cursor.loggedAt),
      lt(mealTransactions.createdAt, cursor.createdAt),
    ),
    and(
      eq(mealTransactions.loggedAt, cursor.loggedAt),
      eq(mealTransactions.createdAt, cursor.createdAt),
      gt(mealTransactions.id, cursor.id),
    ),
    and(
      eq(mealTransactions.loggedAt, cursor.loggedAt),
      eq(mealTransactions.createdAt, cursor.createdAt),
      eq(mealTransactions.id, cursor.id),
      gt(mealRevisionItems.position, cursor.matchedItemPosition),
    ),
  );
}

function mealMatchesNutritionBounds(meal: HistoryMealDto, bounds?: HistoryNutritionBounds): boolean {
  if (!bounds) {
    return true;
  }

  return (
    (typeof bounds.calories?.min === "undefined" || meal.nutrition.calories >= bounds.calories.min) &&
    (typeof bounds.calories?.max === "undefined" || meal.nutrition.calories <= bounds.calories.max) &&
    (typeof bounds.protein?.min === "undefined" || meal.nutrition.protein >= bounds.protein.min) &&
    (typeof bounds.protein?.max === "undefined" || meal.nutrition.protein <= bounds.protein.max) &&
    (typeof bounds.carbs?.min === "undefined" || meal.nutrition.carbs >= bounds.carbs.min) &&
    (typeof bounds.carbs?.max === "undefined" || meal.nutrition.carbs <= bounds.carbs.max) &&
    (typeof bounds.fat?.min === "undefined" || meal.nutrition.fat >= bounds.fat.min) &&
    (typeof bounds.fat?.max === "undefined" || meal.nutrition.fat <= bounds.fat.max)
  );
}

function buildInclusiveLocalDateKeys(fromDate: Date, toDate: Date): string[] {
  const dateKeys: string[] = [];
  const cursor = new Date(fromDate);

  while (cursor.getTime() <= toDate.getTime()) {
    dateKeys.push(formatLocalDate(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }

  return dateKeys;
}

function classifyTrendCompleteness(buckets: HistoryTrendBucketDto[]): HistoryTrendCompleteness {
  const populatedDays = buckets.filter((bucket) => bucket.mealCount > 0).length;
  if (populatedDays === 0) {
    return "empty";
  }

  return populatedDays === buckets.length ? "complete" : "sparse";
}

async function projectHistoryMeals(
  db: AppDatabase,
  headers: HistoryMealHeader[],
): Promise<HistoryMealDto[]> {
  if (headers.length === 0) {
    return [];
  }

  const revisionIds = headers.map((header) => header.currentRevisionId);
  const revisions = await db
    .select({
      id: mealRevisions.id,
      imageAssetId: mealRevisions.imageAssetId,
    })
    .from(mealRevisions)
    .where(inArray(mealRevisions.id, revisionIds));
  const items = await db
    .select({
      revisionId: mealRevisionItems.revisionId,
      position: mealRevisionItems.position,
      foodName: mealRevisionItems.foodName,
      calories: mealRevisionItems.calories,
      protein: mealRevisionItems.protein,
      carbs: mealRevisionItems.carbs,
      fat: mealRevisionItems.fat,
    })
    .from(mealRevisionItems)
    .where(inArray(mealRevisionItems.revisionId, revisionIds))
    .orderBy(asc(mealRevisionItems.position));

  const revisionById = new Map(revisions.map((revision) => [revision.id, revision]));
  const itemsByRevisionId = new Map<
    string,
    Array<{
      position: number;
      foodName: string;
      calories: number;
      protein: number;
      carbs: number;
      fat: number;
    }>
  >();

  for (const item of items) {
    const revisionItems = itemsByRevisionId.get(item.revisionId) ?? [];
    revisionItems.push(item);
    itemsByRevisionId.set(item.revisionId, revisionItems);
  }

  return headers.map((header) => {
    const revision = revisionById.get(header.currentRevisionId);
    const revisionItems = itemsByRevisionId.get(header.currentRevisionId) ?? [];
    const imageAssetId = revision?.imageAssetId ?? null;
    const imageUrl = imageAssetId ? buildAssetUrl(imageAssetId) : null;
    const display = projectMealDisplay(revisionItems);
    const mealPeriod = normalizeMealPeriod(header.mealPeriod);

    return {
      id: header.id,
      mealRevisionId: header.currentRevisionId,
      dateKey: formatLocalDate(new Date(header.loggedAt)),
      loggedAt: header.loggedAt,
      display: { title: display.foodName },
      itemCount: display.itemCount,
      nutrition: {
        calories: revisionItems.reduce((sum, item) => sum + item.calories, 0),
        protein: revisionItems.reduce((sum, item) => sum + item.protein, 0),
        carbs: revisionItems.reduce((sum, item) => sum + item.carbs, 0),
        fat: revisionItems.reduce((sum, item) => sum + item.fat, 0),
      },
      items: revisionItems.map((item) => ({
        name: item.foodName,
        position: item.position,
        nutrition: {
          calories: item.calories,
          protein: item.protein,
          carbs: item.carbs,
          fat: item.fat,
        },
      })),
      asset: {
        imageAssetId,
        imageUrl,
      },
      imageAssetId,
      imageUrl,
      ...(mealPeriod ? { mealPeriod } : {}),
      revision: { currentRevisionNumber: header.currentRevisionNumber },
    };
  });
}

export function createHistoryQueryService(
  db: AppDatabase,
  deps: { summaryService: ReturnType<typeof createSummaryService> },
) {
  return {
    async getMeals(args: {
      deviceId: string;
      from: string;
      to: string;
      limit: number;
      cursor?: string;
    }): Promise<{ meals: HistoryMealDto[]; nextCursor: string | null }> {
      const range = resolveHistoryDateRange(args.from, args.to);
      const cursor = args.cursor ? decodeHistoryCursor(args.cursor) : null;
      const seekFilter = cursor ? createCursorSeekFilter(cursor) : undefined;
      const whereFilter = seekFilter
        ? and(
            eq(mealTransactions.deviceId, args.deviceId),
            isNull(mealTransactions.deletedAt),
            gte(mealTransactions.loggedAt, range.startIso),
            lt(mealTransactions.loggedAt, range.endIso),
            seekFilter,
          )
        : and(
            eq(mealTransactions.deviceId, args.deviceId),
            isNull(mealTransactions.deletedAt),
            gte(mealTransactions.loggedAt, range.startIso),
            lt(mealTransactions.loggedAt, range.endIso),
          );
      const fetchLimit = args.limit + 1;
      const headers = await db
        .select({
          id: mealTransactions.id,
          loggedAt: mealTransactions.loggedAt,
          mealPeriod: mealTransactions.mealPeriod,
          createdAt: mealTransactions.createdAt,
          currentRevisionId: mealTransactions.currentRevisionId,
          currentRevisionNumber: mealTransactions.currentRevisionNumber,
        })
        .from(mealTransactions)
        .where(whereFilter)
        .orderBy(desc(mealTransactions.loggedAt), desc(mealTransactions.createdAt), asc(mealTransactions.id))
        .limit(fetchLimit);

      const returnedHeaders = headers.slice(0, args.limit);
      const meals = await projectHistoryMeals(db, returnedHeaders);
      const lastReturned = returnedHeaders.at(-1);
      const nextCursor =
        headers.length > args.limit && lastReturned
          ? encodeHistoryCursor({
              loggedAt: lastReturned.loggedAt,
              createdAt: lastReturned.createdAt,
              id: lastReturned.id,
            })
          : null;

      return { meals, nextCursor };
    },

    async searchMeals(args: {
      deviceId: string;
      q: string;
      from: string;
      to: string;
      limit: number;
      cursor?: string;
      nutritionBounds?: HistoryNutritionBounds;
    }): Promise<{ results: HistorySearchResultDto[]; nextCursor: string | null }> {
      const trimmedQ = args.q.trim();
      if (trimmedQ.length === 0) {
        throw new HistoryQueryValidationError([{ field: "q", message: "q is required" }]);
      }

      const range = resolveHistoryDateRange(args.from, args.to);
      let cursor = args.cursor ? decodeHistorySearchCursor(args.cursor) : null;
      const likePattern = `%${trimmedQ}%`;
      const fetchLimit = args.limit + 1;
      const boundedHeaders: MatchedHistoryMealHeader[] = [];

      while (boundedHeaders.length < fetchLimit) {
        const seekFilter = cursor ? createSearchCursorSeekFilter(cursor) : undefined;
        const filters = [
          eq(mealTransactions.deviceId, args.deviceId),
          isNull(mealTransactions.deletedAt),
          gte(mealTransactions.loggedAt, range.startIso),
          lt(mealTransactions.loggedAt, range.endIso),
          sql`lower(${mealRevisionItems.foodName}) like lower(${likePattern})`,
        ];

        if (seekFilter) {
          filters.push(seekFilter);
        }

        const matchedHeaders = await db
          .select({
            id: mealTransactions.id,
            loggedAt: mealTransactions.loggedAt,
            mealPeriod: mealTransactions.mealPeriod,
            createdAt: mealTransactions.createdAt,
            currentRevisionId: mealTransactions.currentRevisionId,
            currentRevisionNumber: mealTransactions.currentRevisionNumber,
            matchedItemPosition: mealRevisionItems.position,
            matchedItemName: mealRevisionItems.foodName,
          })
          .from(mealTransactions)
          .innerJoin(
            mealRevisions,
            eq(mealTransactions.currentRevisionId, mealRevisions.id),
          )
          .innerJoin(
            mealRevisionItems,
            eq(mealTransactions.currentRevisionId, mealRevisionItems.revisionId),
          )
          .where(and(...filters))
          .orderBy(
            desc(mealTransactions.loggedAt),
            desc(mealTransactions.createdAt),
            asc(mealTransactions.id),
            asc(mealRevisionItems.position),
          )
          .limit(fetchLimit);

        if (matchedHeaders.length === 0) {
          break;
        }

        const projectedMeals = await projectHistoryMeals(db, matchedHeaders);
        const mealsById = new Map(projectedMeals.map((meal) => [meal.id, meal]));
        boundedHeaders.push(
          ...matchedHeaders.filter((header) => {
            const meal = mealsById.get(header.id);
            return meal ? mealMatchesNutritionBounds(meal, args.nutritionBounds) : false;
          }),
        );

        const lastMatched = matchedHeaders.at(-1)!;
        cursor = {
          loggedAt: lastMatched.loggedAt,
          createdAt: lastMatched.createdAt,
          id: lastMatched.id,
          matchedItemPosition: lastMatched.matchedItemPosition,
        };

        if (matchedHeaders.length < fetchLimit) {
          break;
        }
      }

      const returnedHeaders = boundedHeaders.slice(0, args.limit);
      const projectedMeals = await projectHistoryMeals(db, returnedHeaders);
      const mealsById = new Map(projectedMeals.map((meal) => [meal.id, meal]));
      const results = returnedHeaders.flatMap((header) => {
        const meal = mealsById.get(header.id);
        const item = meal?.items.find(
          (candidate) =>
            candidate.position === header.matchedItemPosition &&
            candidate.name === header.matchedItemName,
        );

        return meal && item ? [{ item, meal }] : [];
      });
      const lastReturned = returnedHeaders.at(-1);
      const nextCursor =
        boundedHeaders.length > args.limit && lastReturned
          ? encodeHistorySearchCursor({
              loggedAt: lastReturned.loggedAt,
              createdAt: lastReturned.createdAt,
              id: lastReturned.id,
              matchedItemPosition: lastReturned.matchedItemPosition,
            })
          : null;

      return { results, nextCursor };
    },

    async getTrends(args: {
      deviceId: string;
      from: string;
      to: string;
    }): Promise<HistoryTrendResponseDto> {
      const range = resolveHistoryDateRange(args.from, args.to, MAX_HISTORY_TREND_DAYS);
      const dateKeys = buildInclusiveLocalDateKeys(range.fromDate, range.toDate);
      const bucketsByDate = new Map<string, HistoryTrendBucketDto & { transactionIds: Set<string> }>();

      for (const dateKey of dateKeys) {
        bucketsByDate.set(dateKey, {
          date: dateKey,
          calories: 0,
          protein: 0,
          carbs: 0,
          fat: 0,
          mealCount: 0,
          transactionIds: new Set<string>(),
        });
      }

      const rows = await db
        .select({
          transactionId: mealTransactions.id,
          loggedAt: mealTransactions.loggedAt,
          calories: mealRevisionItems.calories,
          protein: mealRevisionItems.protein,
          carbs: mealRevisionItems.carbs,
          fat: mealRevisionItems.fat,
        })
        .from(mealTransactions)
        .innerJoin(
          mealRevisions,
          eq(mealTransactions.currentRevisionId, mealRevisions.id),
        )
        .innerJoin(
          mealRevisionItems,
          eq(mealRevisionItems.revisionId, mealRevisions.id),
        )
        .where(
          and(
            eq(mealTransactions.deviceId, args.deviceId),
            isNull(mealTransactions.deletedAt),
            gte(mealTransactions.loggedAt, range.startIso),
            lt(mealTransactions.loggedAt, range.endIso),
          ),
        );

      for (const row of rows) {
        const dateKey = formatLocalDate(new Date(row.loggedAt));
        const bucket = bucketsByDate.get(dateKey);
        if (!bucket) {
          continue;
        }

        bucket.calories += row.calories;
        bucket.protein += row.protein;
        bucket.carbs += row.carbs;
        bucket.fat += row.fat;
        bucket.transactionIds.add(row.transactionId);
        bucket.mealCount = bucket.transactionIds.size;
      }

      const daily = dateKeys.map((dateKey) => {
        const bucket = bucketsByDate.get(dateKey)!;
        return {
          date: bucket.date,
          calories: bucket.calories,
          protein: bucket.protein,
          carbs: bucket.carbs,
          fat: bucket.fat,
          mealCount: bucket.mealCount,
        };
      });
      const totals = daily.reduce(
        (sum, bucket) => ({
          calories: sum.calories + bucket.calories,
          protein: sum.protein + bucket.protein,
          carbs: sum.carbs + bucket.carbs,
          fat: sum.fat + bucket.fat,
          mealCount: sum.mealCount + bucket.mealCount,
        }),
        { calories: 0, protein: 0, carbs: 0, fat: 0, mealCount: 0 },
      );
      const dayCount = daily.length;

      return {
        from: args.from,
        to: args.to,
        completeness: classifyTrendCompleteness(daily),
        daily,
        totals,
        averages: {
          calories: totals.calories / dayCount,
          protein: totals.protein / dayCount,
          carbs: totals.carbs / dayCount,
          fat: totals.fat / dayCount,
          mealsPerDay: totals.mealCount / dayCount,
        },
      };
    },

    async getDaySnapshot(args: {
      deviceId: string;
      date: string;
    }): Promise<{ date: string; summary: DailySummary; meals: HistoryMealDto[] }> {
      const date = parseHistoryDateKey(args.date, "date");
      const [summary, mealResult] = await Promise.all([
        deps.summaryService.getDailySummary(args.deviceId, date),
        this.getMeals({
          deviceId: args.deviceId,
          from: args.date,
          to: args.date,
          limit: Number.MAX_SAFE_INTEGER,
        }),
      ]);

      return { date: args.date, summary, meals: mealResult.meals };
    },
  };
}
