import { and, asc, desc, eq, gt, gte, inArray, isNull, lt, or } from "drizzle-orm";
import type { AppDatabase } from "../db/client.js";
import {
  mealRevisionItems,
  mealRevisions,
  mealTransactions,
} from "../db/schema.js";
import { formatLocalDate, getLocalDayBounds } from "../lib/time.js";
import { buildAssetUrl } from "./assets.js";
import type { createSummaryService, DailySummary } from "./summary.js";

const HISTORY_DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export interface HistoryQueryIssue {
  field: string;
  message: string;
}

export interface HistoryMealDto {
  id: string;
  dateKey: string;
  loggedAt: string;
  display: { title: string };
  nutrition: { calories: number; protein: number; carbs: number; fat: number };
  items: Array<{
    name: string;
    position: number;
    nutrition: { calories: number; protein: number; carbs: number; fat: number };
  }>;
  asset: { imageAssetId: string | null; imageUrl: string | null };
  revision: { currentRevisionNumber: number };
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

function invalidIssue(field: string): HistoryQueryIssue {
  return { field, message: `${field} must be a valid YYYY-MM-DD date` };
}

export function parseHistoryDateKey(dateKey: string, field: string): Date {
  if (!HISTORY_DATE_KEY_PATTERN.test(dateKey)) {
    throw new HistoryQueryValidationError([invalidIssue(field)]);
  }

  const parsedDate = new Date(`${dateKey}T12:00:00`);
  if (Number.isNaN(parsedDate.getTime()) || formatLocalDate(parsedDate) !== dateKey) {
    throw new HistoryQueryValidationError([invalidIssue(field)]);
  }

  return parsedDate;
}

function resolveHistoryDateRange(from: string, to: string): HistoryDateRange {
  const fromDate = parseHistoryDateKey(from, "from");
  const toDate = parseHistoryDateKey(to, "to");

  if (fromDate.getTime() > toDate.getTime()) {
    throw new HistoryQueryValidationError([
      { field: "from", message: "from must be on or before to" },
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

function buildGroupedFoodName(items: Array<{ foodName: string }>) {
  if (items.length === 1) {
    return items[0]!.foodName;
  }

  if (items.length === 2) {
    return `${items[0]!.foodName}、${items[1]!.foodName}`;
  }

  const count = items.length;
  return `${items[0]?.foodName ?? "餐點"}、${items[1]?.foodName ?? "項目"} 等${count}項`;
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

    return {
      id: header.id,
      dateKey: formatLocalDate(new Date(header.loggedAt)),
      loggedAt: header.loggedAt,
      display: { title: buildGroupedFoodName(revisionItems) },
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
        imageUrl: imageAssetId ? buildAssetUrl(imageAssetId) : null,
      },
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
      const seekFilter = cursor
        ? or(
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
          )
        : undefined;
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
