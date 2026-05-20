# Phase 62: Meal Revision Tokens and Stale Receipt Protection - Pattern Map

**Mapped:** 2026-05-17
**Files analyzed:** 34
**Analogs found:** 34 / 34

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `server/services/meal-transactions.ts` | service | CRUD / transaction write | `server/services/meal-transactions.ts` | exact |
| `server/services/food-logging.ts` | service | CRUD / projection | `server/services/food-logging.ts` | exact |
| `server/services/meal-correction.ts` | service | CRUD / request-response tool side effect | `server/services/meal-correction.ts` | exact |
| `server/services/meal-history.ts` | service | CRUD / read projection | `server/services/meal-history.ts` | exact |
| `server/services/history-query.ts` | service | CRUD / paginated read projection | `server/services/history-query.ts` | exact |
| `server/services/chat.ts` | service | CRUD / restored receipt projection | `server/services/chat.ts` | exact |
| `server/routes/meals.ts` | route | request-response | `server/routes/meals.ts` | exact |
| `server/routes/chat.ts` | route | request-response / streaming | `server/routes/chat.ts` | exact |
| `server/routes/day-snapshot.ts` | route | request-response | `server/routes/day-snapshot.ts` | exact |
| `server/orchestrator/tools.ts` | service / tool contract | event-driven tool execution | `server/orchestrator/tools.ts` | exact |
| `server/orchestrator/mutation-effects.ts` | model / contract | transform | `server/orchestrator/mutation-effects.ts` | exact |
| `server/orchestrator/mutation-receipts.ts` | utility | transform | `server/orchestrator/mutation-receipts.ts` | exact |
| `client/src/types.ts` | model | transform / DTO | `client/src/types.ts` | exact |
| `client/src/api.ts` | utility / API client | request-response / SSE | `client/src/api.ts` | exact |
| `client/src/meal-edit-payload.ts` | utility | transform | `client/src/meal-edit-payload.ts` | exact |
| `client/src/store.ts` | store | event-driven state | `client/src/store.ts` | exact |
| `client/src/components/MealEditScreen.tsx` | component | request-response UI action | `client/src/components/MealEditScreen.tsx` | exact |
| `client/src/components/MessageBubble.tsx` | component | event-driven UI affordance | `client/src/components/MessageBubble.tsx` | exact |
| `tests/unit/meal-transactions.test.ts` | test | CRUD / SQLite proof | `tests/unit/meal-transactions.test.ts` | exact |
| `tests/unit/food-logging.test.ts` | test | CRUD / projection proof | `tests/unit/food-logging.test.ts` | exact |
| `tests/unit/meal-correction.test.ts` | test | CRUD / service side effect proof | `tests/unit/meal-correction.test.ts` | exact |
| `tests/unit/tools.test.ts` | test | event-driven tool execution proof | `tests/unit/tools.test.ts` | exact |
| `tests/unit/mutation-receipts.test.ts` | test | transform / copy contract | `tests/unit/mutation-receipts.test.ts` | exact |
| `tests/unit/api-client.test.ts` | test | request-response client proof | `tests/unit/api-client.test.ts` | exact |
| `tests/unit/meal-edit-payload.test.ts` | test | transform proof | `tests/unit/meal-edit-payload.test.ts` | exact |
| `tests/unit/meal-edit-screen.test.ts` | test | source contract UI proof | `tests/unit/meal-edit-screen.test.ts` | exact |
| `tests/unit/store.test.ts` | test | event-driven state proof | `tests/unit/store.test.ts` | exact |
| `tests/unit/chat-bubble-contract.test.ts` | test | source contract UI proof | `tests/unit/chat-bubble-contract.test.ts` | exact |
| `tests/integration/meals-api.test.ts` | test | request-response Fastify proof | `tests/integration/meals-api.test.ts` | exact |
| `tests/integration/chat-api.test.ts` | test | request-response chat proof | `tests/integration/chat-api.test.ts` | exact |
| `tests/integration/chat-streaming.test.ts` | test | streaming SSE proof | `tests/integration/chat-streaming.test.ts` | exact |
| `tests/integration/chat-meal-correction.integration.test.ts` | test | request-response tool integration proof | `tests/integration/chat-meal-correction.integration.test.ts` | exact |
| `tests/integration/sse.test.ts` | test | streaming realtime proof | `tests/integration/sse.test.ts` | exact |

## Pattern Assignments

### `server/services/meal-transactions.ts` (service, CRUD / transaction write)

**Analog:** `server/services/meal-transactions.ts`

**Imports and schema pattern** (lines 1-12):
```typescript
import { asc, eq } from "drizzle-orm";
import type { AppDatabase } from "../db/client.js";
import {
  assetReferences,
  assets,
  mealRevisionItems,
  mealRevisions,
  mealTransactions,
} from "../db/schema.js";
import { parseAssetRef } from "./assets.js";
import { formatLocalDate } from "../lib/time.js";
import { projectMealDisplay } from "./meal-display.js";
```

**Current revision lookup pattern** (lines 113-135):
```typescript
function getActiveTransactionByDeviceAndId(
  deviceId: string,
  transactionId: string,
): MealTransactionRow | undefined {
  return db.$client
    .prepare(`
      SELECT
        id,
        device_id AS deviceId,
        logged_at AS loggedAt,
        current_revision_id AS currentRevisionId,
        current_revision_number AS currentRevisionNumber,
        deleted_at AS deletedAt,
        created_at AS createdAt
      FROM meal_transactions INDEXED BY meal_tx_device_id_id_idx
      WHERE device_id = ? AND id = ? AND deleted_at IS NULL
      LIMIT 1
    `)
    .get(deviceId, transactionId) as MealTransactionRow | undefined;
}
```

**Delete write boundary to protect** (lines 260-303):
```typescript
async softDeleteTransaction(
  deviceId: string,
  transactionId: string,
): Promise<MealTransactionDeleteResult> {
  const existing = getActiveTransactionByDeviceAndId(deviceId, transactionId);

  if (!existing) {
    throw new Error("MEAL_NOT_FOUND");
  }

  const deletedMeal = await loadDeletedMealSnapshot(existing);
  const deletedAt = new Date().toISOString();
  const revisionNumber = existing.currentRevisionNumber + 1;
  const revisionId = `${existing.id}:r${revisionNumber}`;

  return db.transaction((tx) => {
    tx.insert(mealRevisions)
      .values({
        id: revisionId,
        transactionId: existing.id,
        revisionNumber,
        supersedesRevisionId: existing.currentRevisionId,
        imageAssetId: null,
        changeType: "delete",
        createdAt: deletedAt,
      })
      .run();
```

**Update write boundary to protect** (lines 306-401):
```typescript
async updateTransaction(
  deviceId: string,
  transactionId: string,
  input: MealTransactionUpdateInput,
): Promise<MealTransactionUpdateResult> {
  const existing = getActiveTransactionByDeviceAndId(deviceId, transactionId);

  if (!existing) {
    throw new Error("MEAL_NOT_FOUND");
  }

  const items = normalizeItems(input.items);
  const createdAt = new Date().toISOString();
  const revisionNumber = existing.currentRevisionNumber + 1;
  const revisionId = `${existing.id}:r${revisionNumber}`;
  ...
  return db.transaction((tx) => {
    ...
    tx.insert(mealRevisions)
      .values({
        id: revisionId,
        transactionId: existing.id,
        revisionNumber,
        supersedesRevisionId: existing.currentRevisionId,
        imageAssetId,
        changeType: "update",
        createdAt,
      })
      .run();
```

**Phase 62 application:** add a typed precondition error and compare `expectedMealRevisionId` to `existing.currentRevisionId` immediately after `MEAL_NOT_FOUND`, before `loadDeletedMealSnapshot`, `normalizeItems`, revision id generation, `db.transaction`, `mealRevisions` insert, or `mealTransactions` update.

### `server/services/food-logging.ts` (service, CRUD / projection)

**Analog:** `server/services/food-logging.ts`

**Compatibility DTO and projection pattern** (lines 26-69):
```typescript
export interface MealCompatibilityEntry {
  id: string;
  mealRevisionId: string;
  deviceId: string;
  foodName: string;
  itemCount: number;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  imagePath: string | null;
  loggedAt: string;
}

function projectCompatibilityEntry(...): MealCompatibilityEntry {
  const display = projectMealDisplay(items);

  return {
    id: transactionId,
    mealRevisionId: revisionId,
    deviceId,
    foodName: display.foodName,
    itemCount: display.itemCount,
    calories: items.reduce((sum, item) => sum + item.calories, 0),
    ...
  };
}
```

**Mutation forwarding pattern** (lines 117-119, 145-154):
```typescript
async deleteMeal(deviceId: string, mealId: string) {
  return mealTransactionsService.softDeleteTransaction(deviceId, mealId);
}

async updateMeal(deviceId: string, mealId: string, input: GroupedMealData) {
  const updated = await mealTransactionsService.updateTransaction(deviceId, mealId, input);
  return projectCompatibilityEntry(
    deviceId,
    updated.transactionId,
    updated.revisionId,
    updated.loggedAt,
    updated.imageAssetId ? `asset:${updated.imageAssetId}` : null,
    updated.items,
  );
}
```

**Phase 62 application:** extend update/delete signatures to accept `expectedMealRevisionId` and pass it through to `mealTransactionsService`. Keep creation/logging signatures unchanged.

### `server/services/meal-correction.ts` (service, CRUD / request-response tool side effect)

**Analog:** `server/services/meal-correction.ts`

**Imports and service boundary pattern** (lines 1-23):
```typescript
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
...
```

**Resolved target shape pattern** (lines 53-58):
```typescript
export interface FindMealsResolvedResult {
  status: "resolved";
  action: "update" | "delete";
  resolvedMealId: string;
  candidate: MealCorrectionCandidate;
  fromPending: boolean;
}
```

**Candidate resolution pattern** (lines 571-581, 617-624):
```typescript
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
}
...
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
```

**Update/delete side-effect pattern** (lines 692-727, 740-755):
```typescript
const updated = await mealTransactionsService.updateTransaction(deviceId, mealId, { items: nextItems });
const summaryOutcome = await buildSummaryOutcomeAfterMealCommit({
  deviceId,
  affectedDate: updated.affectedDateKey,
  summaryService,
  foodLoggingService,
});
const dailySummary = dailySummaryFromOutcome(summaryOutcome);

return {
  updatedMeal: {
    id: updated.transactionId,
    mealRevisionId: updated.revisionId,
    ...
  },
  affectedDate: updated.affectedDateKey,
  summaryOutcome,
  ...(dailySummary ? { dailySummary } : {}),
};

const deleted = await mealTransactionsService.softDeleteTransaction(deviceId, mealId);
const summaryOutcome = await buildSummaryOutcomeAfterMealCommit({ ... });
```

**Phase 62 application:** add `mealRevisionId` to `MealCorrectionCandidate`, pending selection state, resolved results, and tool-session state. Pass the resolved candidate revision as `expectedMealRevisionId` to update/delete. Do not run summary recompute if the transaction service throws the precondition error.

### `server/services/meal-history.ts` and `server/services/history-query.ts` (services, read projection)

**Analogs:** `server/services/meal-history.ts`, `server/services/history-query.ts`

**Meal history current revision read pattern** (meal-history lines 28-58):
```typescript
const headers = await db
  .select({
    id: mealTransactions.id,
    loggedAt: mealTransactions.loggedAt,
    currentRevisionId: mealTransactions.currentRevisionId,
  })
  .from(mealTransactions)
  .where(and(...))
  .orderBy(asc(mealTransactions.loggedAt));

const revisionIds = headers.map((header) => header.currentRevisionId);
const revisions = await db
  .select()
  .from(mealRevisions)
  .where(inArray(mealRevisions.id, revisionIds));
```

**Meal history projection pattern** (meal-history lines 84-99):
```typescript
return headers.map((header) => {
  const revision = revisionById.get(header.currentRevisionId);
  const revisionItems = itemsByRevisionId.get(header.currentRevisionId) ?? [];
  const display = projectMealDisplay(revisionItems);

  return {
    id: header.id,
    foodName: display.foodName,
    itemCount: display.itemCount,
    calories: revisionItems.reduce((sum, item) => sum + item.calories, 0),
    ...
    loggedAt: header.loggedAt,
  };
});
```

**History query projection pattern** (history-query lines 399-425):
```typescript
return headers.map((header) => {
  const revision = revisionById.get(header.currentRevisionId);
  const revisionItems = itemsByRevisionId.get(header.currentRevisionId) ?? [];
  const imageAssetId = revision?.imageAssetId ?? null;
  const imageUrl = imageAssetId ? buildAssetUrl(imageAssetId) : null;
  const display = projectMealDisplay(revisionItems);

  return {
    id: header.id,
    dateKey: formatLocalDate(new Date(header.loggedAt)),
    loggedAt: header.loggedAt,
    display: { title: display.foodName },
    itemCount: display.itemCount,
    nutrition: { ... },
    items: revisionItems.map((item) => ({ ... })),
```

**Phase 62 application:** expose `mealRevisionId: header.currentRevisionId` in read DTOs that can open Meal Edit. Preserve the existing rule that internal `currentRevisionId` is not exposed by name.

### `server/services/chat.ts` (service, restored receipt projection)

**Analog:** `server/services/chat.ts`

**Receipt lookup pattern** (lines 66-88):
```typescript
const receipts = await db
  .select({
    mealTransactionId: mealTransactions.id,
    currentRevisionId: mealTransactions.currentRevisionId,
    deletedAt: mealTransactions.deletedAt,
    mealRevisionId: mealRevisions.id,
    loggedAt: mealTransactions.loggedAt,
    imageAssetId: mealRevisions.imageAssetId,
  })
  .from(chatMealReceipts)
  .innerJoin(chatMessages, eq(chatMessages.id, chatMealReceipts.assistantMessageId))
  .innerJoin(mealTransactions, eq(mealTransactions.id, chatMealReceipts.mealTransactionId))
  .innerJoin(mealRevisions, eq(mealRevisions.id, chatMealReceipts.mealRevisionId))
  .where(and(...))
  .limit(1);
```

**Current-active editability gate** (lines 112-121):
```typescript
const isCurrentActiveReceipt =
  receipt.deletedAt === null && receipt.mealRevisionId === receipt.currentRevisionId;

return {
  ...(isCurrentActiveReceipt
    ? {
        mealId: receipt.mealTransactionId,
        dateKey: formatLocalDate(new Date(receipt.loggedAt)),
      }
    : {}),
```

**Save receipt reference pattern** (lines 143-164):
```typescript
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
```

**Phase 62 application:** restored current-active receipts should include public `mealRevisionId` alongside `mealId` and `dateKey`. Stale/non-current receipts should stay display-only by omitting edit identity fields.

### `server/routes/meals.ts` and `server/routes/day-snapshot.ts` (routes, request-response)

**Analogs:** `server/routes/meals.ts`, `server/routes/day-snapshot.ts`

**Route imports and auth pattern** (meals lines 1-15, 101-115):
```typescript
import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import { buildAssetUrl, parseAssetRef } from "../services/assets.js";
...
import { resolveGuestSession } from "../lib/guest-session-resolver.js";

export function registerMealRoutes(app: FastifyInstance, deps: Deps) {
  const { foodLoggingService, summaryService, deviceService, guestSessionService, assetService, publisher } = deps;

  app.get("/api/meals", async (request, reply) => {
    const session = await resolveGuestSession(request, { deviceService, guestSessionService });
    if (!session.ok) {
      if (session.clearCookies) {
        reply.header("set-cookie", guestSessionService.clearSessionCookies());
      }
      return reply.code(401).send({ error: session.error });
    }
```

**Validation pattern** (meals lines 39-71):
```typescript
function parseMealUpdateBody(body: unknown): MealUpdateBody | null {
  if (!body || typeof body !== "object") {
    return null;
  }

  const input = body as Record<string, unknown>;
  const foodName = typeof input.foodName === "string" ? input.foodName.trim() : "";
  ...
  if (!foodName) {
    return null;
  }
  if (
    !isFiniteNonNegativeNumber(input.calories) ||
    !isFiniteNonNegativeNumber(input.protein) ||
    !isFiniteNonNegativeNumber(input.carbs) ||
    !isFiniteNonNegativeNumber(input.fat)
  ) {
    return null;
  }
  return { foodName, calories: input.calories, ... };
}
```

**GET projection pattern** (meals lines 121-137):
```typescript
const meals = await foodLoggingService.getMealsByDate(deviceId, new Date());
return {
  meals: meals.map((meal) => {
    const imageAssetId = parseAssetRef(meal.imagePath);
    return {
      id: meal.id,
      foodName: meal.foodName,
      itemCount: meal.itemCount ?? 1,
      calories: meal.calories,
      ...
      loggedAt: meal.loggedAt,
    };
  }),
};
```

**Conflict body pattern** (meals lines 163-171):
```typescript
const itemCount = await foodLoggingService.getMealItemCount(deviceId, id);
if (itemCount === null) {
  return reply.code(404).send({ error: "Meal not found" });
}
if (itemCount > 1) {
  return reply.code(409).send({
    error: "MEAL_REQUIRES_GROUPED_UPDATE",
    message: "Grouped meals must be corrected through chat.",
  });
}
```

**Post-commit side-effect pattern** (meals lines 201-215, 264-278):
```typescript
const summaryOutcome = await buildSummaryOutcomeAfterMealCommit({
  deviceId,
  affectedDate: affectedDateKey,
  summaryService,
  foodLoggingService,
});
const dailySummary = dailySummaryFromOutcome(summaryOutcome);
publishDailySummarySafe({
  publisher,
  deviceId,
  dailySummary,
  summaryOutcome,
  affectedDate: affectedDateKey,
  log: request.log,
});
```

**Day snapshot projection analog** (day-snapshot lines 35-55):
```typescript
const snapshot = await daySnapshotService.getDaySnapshot(deviceId, date);
return {
  date: snapshot.date,
  summary: snapshot.summary,
  meals: snapshot.meals.map((meal) => {
    const imageAssetId = parseAssetRef(meal.imagePath);
    return {
      id: meal.id,
      foodName: meal.foodName,
      itemCount: meal.itemCount ?? 1,
      ...
      loggedAt: meal.loggedAt,
    };
  }),
};
```

**Phase 62 application:** add `expectedMealRevisionId` parsing to update/delete boundaries. Map transaction precondition errors to `409` bodies with stable `error` values `MEAL_REVISION_REQUIRED` and `MEAL_REVISION_STALE`. Return before summary recompute and `publishDailySummarySafe`.

### `server/routes/chat.ts` (route, request-response / streaming)

**Analog:** `server/routes/chat.ts`

**Receipt identity type and save pattern** (lines 70-75, 240-247):
```typescript
type LoggedMealReceipt = NonNullable<ToolExecutionResult["loggedMeal"]>;
type ReceiptIdentity = {
  mealTransactionId: string;
  mealRevisionId: string;
  toolMessageId?: string;
};

if (receiptIdentity) {
  await chatService.saveMealReceiptReference({
    deviceId,
    assistantMessageId: assistantMessage.id,
    toolMessageId: receiptIdentity.toolMessageId,
    mealTransactionId: receiptIdentity.mealTransactionId,
    mealRevisionId: receiptIdentity.mealRevisionId,
  });
}
```

**Receipt projection pattern** (lines 415-478):
```typescript
function projectLoggedMealReceipt(loggedMeal: LoggedMealReceipt | undefined) {
  if (!loggedMeal) return undefined;

  const {
    mealId,
    dateKey,
    loggedAt,
    imageAssetId,
    imageUrl,
    foodName,
    itemCount,
    calories,
    protein,
    carbs,
    fat,
  } = loggedMeal;
  ...
  return {
    ...(typeof mealId === "string" ? { mealId } : {}),
    ...(typeof dateKey === "string" ? { dateKey } : {}),
    ...(typeof loggedAt === "string" ? { loggedAt } : {}),
    ...
    foodName,
    itemCount,
    calories,
    protein,
    carbs,
    fat,
    ...(items && items.length > 0 ? { items } : {}),
  };
}
```

**SSE terminal payload pattern** (lines 907-970):
```typescript
streamLoggedMealReceipt = projectLoggedMealReceipt(loggedMeal);
streamReceiptIdentity = buildReceiptIdentity(loggedMeal, result.loggedMealToolMessageId);
...
const doneData = {
  turnId: stopControl.turnId,
  didLogMeal: streamDidLogMeal,
  didMutateMeal: streamDidMutateMeal,
  ...(streamLoggedMealReceipt ? { loggedMeal: streamLoggedMealReceipt } : {}),
  ...(streamDailySummary ? { dailySummary: streamDailySummary } : {}),
  ...(streamSummaryOutcome ? { summaryOutcome: streamSummaryOutcome } : {}),
```

**JSON terminal payload pattern** (lines 1304-1308, 1421-1429):
```typescript
jsonLoggedMealFallback = result.loggedMeal
  ? buildPartialSuccessLoggedReply(result.loggedMeal)
  : undefined;
jsonLoggedMealReceipt = projectLoggedMealReceipt(result.loggedMeal);
jsonReceiptIdentity = buildReceiptIdentity(result.loggedMeal, result.loggedMealToolMessageId);
...
return {
  turnId,
  reply: sanitizedJson,
  didLogMeal,
  ...(result.didMutateMeal !== undefined ? { didMutateMeal: result.didMutateMeal } : {}),
  ...(jsonLoggedMealReceipt ? { loggedMeal: jsonLoggedMealReceipt } : {}),
```

**Phase 62 application:** preserve `mealRevisionId` in `projectLoggedMealReceipt` for chat JSON/SSE. Keep SSE event ordering unchanged.

### `server/orchestrator/tools.ts` (tool contract, event-driven tool execution)

**Analog:** `server/orchestrator/tools.ts`

**Tool deps/session state pattern** (lines 55-62):
```typescript
interface ToolDeps {
  mealCorrectionService?: ReturnType<typeof createMealCorrectionService>;
  deviceService?: ReturnType<typeof createDeviceService>;
  goalProposalService?: ReturnType<typeof createGoalProposalService>;
  publisher?: Pick<RealtimePublisher, "publishGoalsUpdate">;
  imagePath?: string;
  toolSessionState?: {
    resolvedMealIds: string[];
  };
}
```

**Logged meal result shape** (lines 92-105):
```typescript
affectedDate?: string;
mealMutationKind?: "log" | "update" | "delete";
deletedMeal?: DeletedMealSnapshot;
loggedMeal?: {
  mealId: string;
  mealRevisionId: string;
  dateKey: string;
  loggedAt: string;
  imageAssetId: string | null;
  imageUrl: string | null;
  foodName: string;
  calories: number;
```

**Identity projection pattern** (lines 871-884):
```typescript
function projectMealIdentityFields(meal: {
  id: string;
  mealRevisionId: string;
  loggedAt: string;
  imagePath: string | null;
}) {
  const imageAssetId = parseAssetRef(meal.imagePath);
  return {
    mealId: meal.id,
    mealRevisionId: meal.mealRevisionId,
    dateKey: formatLocalDate(new Date(meal.loggedAt)),
    loggedAt: meal.loggedAt,
    imageAssetId,
    imageUrl: imageAssetId ? buildAssetUrl(imageAssetId) : null,
  };
}
```

**Find-meals session-state pattern** (lines 1100-1116):
```typescript
const result = await deps.mealCorrectionService.findMeals(deviceId, args.action, args.query.trim(), {
  currentDate,
  previousDateKey: extractPreviousHistoricalDateKey(context.previousAssistantMessage, currentDate),
});
if (deps.toolSessionState) {
  deps.toolSessionState.resolvedMealIds =
    result.status === "resolved" ? [result.resolvedMealId] : [];
}
```

**Guarded update/delete tool pattern** (lines 1253-1288, 1326-1331):
```typescript
const resolvedMealIds = deps.toolSessionState?.resolvedMealIds ?? [];
if (!resolvedMealIds.includes(args.meal_id)) {
  throw new FatalToolError("meal target unresolved");
}

let updated: UpdateMealResult;
try {
  updated = await deps.mealCorrectionService.updateMeal(deviceId, args.meal_id, ...);
} catch (error) {
  const message = error instanceof Error ? error.message : "meal update failed";
  if (message === "MEAL_NAME_PATCH_REQUIRES_SINGLE_ITEM") {
    throw new FatalToolError("multi-item meal name changes require full items replacement");
  }
  throw error;
}

const deleted = await deps.mealCorrectionService.deleteMeal(deviceId, args.meal_id);
```

**Result mapping pattern** (lines 1714-1749):
```typescript
if (toolCall.function.name === "update_meal") {
  const contractResult = outcome.contractResult as UpdateMealResult;
  return {
    result: outcome.result,
    summary: "成功",
    mealMutationKind: "update",
    dailySummary: contractResult.dailySummary,
    summaryOutcome: contractResult.summaryOutcome,
    affectedDate: contractResult.affectedDate,
    loggedMeal: {
      ...projectMealIdentityFields(contractResult.updatedMeal),
      foodName: contractResult.updatedMeal.foodName,
      ...
    },
  };
}
```

**Phase 62 application:** change `toolSessionState` from ids-only to resolved identity objects containing `mealId` and `mealRevisionId`. Tool schemas/results should carry an expected revision where needed, but do not expose implementation copy in user receipts.

### `server/orchestrator/mutation-effects.ts` and `server/orchestrator/mutation-receipts.ts` (contracts/utilities, transform)

**Analogs:** `server/orchestrator/mutation-effects.ts`, `server/orchestrator/mutation-receipts.ts`

**Committed facts contract** (mutation-effects lines 5-18, 42-55):
```typescript
export interface CommittedMealFacts {
  mealId: string;
  mealRevisionId: string;
  dateKey: string;
  loggedAt: string;
  foodName: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  itemCount: number;
  quantityUncertaintyReason?: "missing_quantity";
  usedConservativeAssumption?: boolean;
}

export interface UpdateMutationEffects extends MealMutationEffectsBase {
  kind: "update";
  meal: CommittedMealFacts;
}
```

**Forbidden implementation-copy pattern** (mutation-receipts lines 5-35):
```typescript
export const FORBIDDEN_RECEIPT_TERMS = [
  "headline",
  "先抓低",
  "保守估算",
  "log_food",
  "update_meal",
  "delete_meal",
  "update_goals",
  "revision",
  "deviceId",
  "mealMutationKind",
  "summaryOutcome",
  "dailySummary",
  ...
] as const;
```

**Receipt render pattern** (mutation-receipts lines 122-135):
```typescript
export function renderMutationReceipt(effects: MutationEffects): string {
  switch (effects.kind) {
    case "log": {
      const datePrefix = formatDatePrefix(effects.meal.dateKey || effects.affectedDate);
      return `已記錄${datePrefix}${effects.meal.foodName}，${formatNumber(effects.meal.calories)} kcal，蛋白質 ${formatNumber(effects.meal.protein)} g。${logUncertaintySuffix(effects)}`;
    }
    case "update": {
      const datePrefix = formatDatePrefix(effects.meal.dateKey || effects.affectedDate);
      return `已更新${datePrefix}${effects.meal.foodName}，${formatNumber(effects.meal.calories)} kcal，蛋白質 ${formatNumber(effects.meal.protein)} g。`;
    }
```

**Phase 62 application:** `mealRevisionId` stays committed metadata, not user copy. Keep "revision" in forbidden receipt terms.

### `client/src/types.ts` (model, DTO transform)

**Analog:** `client/src/types.ts`

**Edit payload and receipt DTO pattern** (lines 8-21, 67-103):
```typescript
export interface MealEditPayload {
  mealId: string;
  dateKey: string;
  foodName: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  itemCount: number;
  items?: MealItemDetail[];
  imageAssetId?: string | null;
  imageUrl?: string | null;
  loggedAt?: string;
}

export interface LoggedMealReceipt {
  foodName: string;
  calories: number;
  ...
  mealId?: string;
  dateKey?: string;
  loggedAt?: string;
}

export interface UpdateMealInput {
  foodName: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  imageAssetId?: string | null;
}
```

**Phase 62 application:** add read-side `mealRevisionId` to `MealEditPayload`, `LoggedMealReceipt`, and `MealEntry`; add write-side `expectedMealRevisionId` to `UpdateMealInput` and delete options/input only.

### `client/src/api.ts` (API client, request-response / SSE)

**Analog:** `client/src/api.ts`

**Type guard and normalizer pattern** (lines 114-130, 382-420):
```typescript
function isLoggedMealReceipt(value: unknown): value is LoggedMealReceipt {
  if (!isRecord(value)) {
    return false;
  }

  if (
    typeof value.foodName === "string" &&
    value.foodName.trim().length > 0 &&
    typeof value.calories === "number" &&
    Number.isFinite(value.calories) &&
    ...
  ) {
```

```typescript
export function normalizeLoggedMealReceipt(receipt: LoggedMealReceipt): LoggedMealReceipt {
  const items = normalizeMealItems((receipt as { items?: unknown }).items);

  return {
    ...receipt,
    itemCount: normalizeItemCount(receipt.itemCount),
    ...(items ? { items } : {}),
    ...(receipt.imageUrl === undefined
      ? {}
      : { imageUrl: withAuthorizedAssetUrl(receipt.imageUrl) ?? null }),
  };
}
```

**Meals/history normalization pattern** (lines 729-749, 790-805):
```typescript
export async function getMeals(options?: { refreshReason?: "day_rollover" | "meal_mutation" }): Promise<{ meals: MealEntry[] }> {
  const headers: Record<string, string> = {};
  if (options?.refreshReason) {
    headers["X-Refresh-Reason"] = options.refreshReason;
  }

  const res = await fetch("/api/meals", { credentials: "same-origin", headers });
  ...
  return {
    meals: body.meals.map((meal) => ({
      ...meal,
      itemCount: normalizeItemCount(meal.itemCount),
      ...
      imageUrl: withAuthorizedAssetUrl(meal.imageUrl),
    })),
  };
}
```

**Mutation request/error pattern** (lines 828-850):
```typescript
export async function deleteMeal(mealId: string): Promise<DeleteMealResponse> {
  const res = await fetch(`/api/meals/${mealId}`, {
    method: "DELETE",
    credentials: "same-origin",
  });
  if (res.status === 401) throw new Error("UNAUTHORIZED");
  if (!res.ok) throw new Error("Failed to delete meal");
  const body = await res.json() as DeleteMealResponse;
  return normalizeSummaryOutcomeFields(body);
}

export async function updateMeal(mealId: string, input: UpdateMealInput): Promise<UpdateMealResponse> {
  const res = await fetch(`/api/meals/${encodeURIComponent(mealId)}`, {
    method: "PATCH",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (res.status === 401) throw new Error("UNAUTHORIZED");
  if (!res.ok) {
    const errorMessage = getResponseErrorMessage(await readJsonSafe(res));
    throw new Error(errorMessage ?? "Failed to update meal");
  }
```

**Phase 62 application:** preserve structured stale error metadata instead of reducing it to `Error(message)`. Send `expectedMealRevisionId` in update JSON and delete request shape. Continue using same-origin credentials and `X-Refresh-Reason: meal_mutation`.

### `client/src/meal-edit-payload.ts` (utility, transform)

**Analog:** `client/src/meal-edit-payload.ts`

**Builder and validation pattern** (lines 60-108):
```typescript
export function buildHistoryMealEditPayload(meal: MealEntry, dateKey: string): MealEditPayload {
  const items = normalizeMealItems((meal as { items?: unknown }).items);

  return {
    mealId: meal.id,
    dateKey,
    foodName: meal.foodName,
    calories: meal.calories,
    ...
    loggedAt: meal.loggedAt,
  };
}

export function buildReceiptMealEditPayload(loggedMeal: LoggedMealReceipt | undefined): MealEditPayload | null {
  if (
    !loggedMeal ||
    !loggedMeal.mealId ||
    !loggedMeal.dateKey ||
    loggedMeal.foodName.trim().length === 0 ||
    !Number.isFinite(loggedMeal.calories) ||
    ...
  ) {
    return null;
  }
```

**Phase 62 application:** require `mealRevisionId` in both builders before returning editable payloads. Old receipts with no revision should return `null`, making MessageBubble display-only.

### `client/src/store.ts` (store, event-driven state)

**Analog:** `client/src/store.ts`

**Action shape pattern** (lines 49-74):
```typescript
interface AppState {
  deviceId: string | null;
  goal: string | null;
  activeScreen: ActiveScreen;
  ...
  meals: MealEntry[];
  ...
  openMealEdit: (payload: MealEditPayload, origin?: PrimaryTab) => void;
  closeSecondaryScreen: () => void;
  setMeals: (meals: MealEntry[]) => void;
  removeMeal: (mealId: string) => void;
  redactChatReceiptIdentity: (mealId: string) => void;
  recordMealMutation: (affectedDate: string) => void;
```

**Receipt redaction pattern** (lines 146-155):
```typescript
redactChatReceiptIdentity: (mealId) =>
  set((state) => ({
    messages: state.messages.map((message) => {
      if (message.loggedMeal?.mealId !== mealId) {
        return message;
      }

      const { mealId: _mealId, dateKey: _dateKey, ...displayOnlyReceipt } = message.loggedMeal;
      return { ...message, loggedMeal: displayOnlyReceipt };
    }),
  })),
```

**Guarded async side-effect pattern** (lines 257-277):
```typescript
setDailySummary: (summary) => {
  const activeDate = formatLocalDate(new Date());
  if (summary.date === activeDate) {
    set({ dailySummary: summary });
    return;
  }
  try {
    const result = rolloverRefreshHandler?.();
    if (result && typeof (result as Promise<void>).catch === "function") {
      (result as Promise<void>).catch(() => undefined);
    }
  } catch {
    // Intentionally suppressed.
  }
},
```

**Phase 62 application:** add stale recovery/invalidation state/action in the same Zustand action style. Redaction should also remove `mealRevisionId` when redacting a stale receipt.

### `client/src/components/MealEditScreen.tsx` (component, request-response UI action)

**Analog:** `client/src/components/MealEditScreen.tsx`

**Imports and state pattern** (lines 1-8, 100-115):
```typescript
import { useEffect, useState } from "react";
import { deleteMeal, getMeals, updateMeal } from "../api.js";
import { formatLocalDate } from "../lib/time.js";
import { useStore } from "../store.js";
import type { DailySummary, MealEditPayload } from "../types.js";
...
const [draft, setDraft] = useState<DraftState | null>(() => (payload && !isGroupedPayload ? createDraft(payload) : null));
const [pending, setPending] = useState(false);
const [error, setError] = useState<string | null>(null);
```

**Refresh/invalidation pattern** (lines 121-130):
```typescript
async function refreshAfterMealMutation(mealId: string, affectedDate: string, dailySummary?: DailySummary) {
  redactChatReceiptIdentity(mealId);
  recordMealMutation(affectedDate);
  if (!dailySummary || dailySummary.date !== formatLocalDate(new Date())) {
    return;
  }

  setDailySummary(dailySummary);
  const { meals } = await getMeals({ refreshReason: "meal_mutation" });
  setMeals(meals);
}
```

**Save/delete error handling pattern** (lines 146-160, 175-186):
```typescript
try {
  const response = await updateMeal(payload.mealId, {
    ...parsedDraft,
    imageAssetId: payload.imageAssetId ?? null,
  });
  await refreshAfterMealMutation(payload.mealId, response.affectedDate, response.dailySummary);
  onBack();
} catch (err) {
  if (err instanceof Error && err.message === "UNAUTHORIZED") {
    void recoverGuestSession();
  } else if (err instanceof Error && err.message === MULTI_ITEM_UPDATE_ERROR_CODE) {
    setError(MULTI_ITEM_UPDATE_ERROR_COPY);
  } else {
    setError("餐點暫時無法儲存，請稍後再試。");
  }
}
```

**Alert and button pattern** (lines 365-379):
```tsx
{error ? (
  <div className="sp-meal-edit-error" role="alert">
    {error}
  </div>
) : null}
...
<button type="button" className="sp-meal-edit-save" onClick={handleSave} disabled={pending}>
  {pending ? "儲存中..." : "儲存"}
</button>
```

**Phase 62 application:** pass `expectedMealRevisionId: payload.mealRevisionId` on save/delete. Branch on stable stale error strings and show UI-spec Traditional Chinese copy in the existing `role="alert"` region. Block further save/delete from the stale instance after stale recovery begins.

### `client/src/components/MessageBubble.tsx` (component, event-driven UI affordance)

**Analog:** `client/src/components/MessageBubble.tsx`

**Receipt editability pattern** (lines 29-35, 73-89):
```typescript
function isCompleteLoggedMealReceipt(message: Message) {
  return getCompleteReceiptEditPayload(message) !== null;
}

export function getCompleteReceiptEditPayload(message: Message): MealEditPayload | null {
  return buildReceiptMealEditPayload(message.loggedMeal);
}

const canEdit = editPayload !== null && onOpenMealEdit !== undefined;

function handleReceiptKeyDown(event: KeyboardEvent<HTMLDivElement>) {
  if (!canEdit || (event.key !== "Enter" && event.key !== " ")) {
    return;
  }
  event.preventDefault();
  handleOpenReceipt();
}
```

**Receipt render pattern** (lines 229-240):
```tsx
const editPayload = getCompleteReceiptEditPayload(message);
const shouldRenderReceipt = Boolean(message.loggedMeal);

if (shouldRenderReceipt) {
  return (
    <>
      <ReceiptCard
        message={message}
        editPayload={isCompleteLoggedMealReceipt(message) ? editPayload : null}
        onOpenMealEdit={onOpenMealEdit}
      />
```

**Phase 62 application:** because `buildReceiptMealEditPayload` will require `mealRevisionId`, no additional visible copy is needed. Missing revision receipts should omit chevron/button behavior.

## Test Pattern Assignments

### Service Tests

**Analogs:** `tests/unit/meal-transactions.test.ts`, `tests/unit/food-logging.test.ts`, `tests/unit/meal-correction.test.ts`

**Node test and real SQLite setup** (meal-transactions lines 1-29):
```typescript
process.env.TZ = "Asia/Taipei";

import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { createDb } from "../../server/db/client.js";
...
beforeEach(async () => {
  db = createDb(":memory:");
  const deviceService = createDeviceService(db);
  mealTransactionsService = createMealTransactionsService(db);
  deviceId = (await deviceService.createDevice("fat_loss")).deviceId;
  foreignDeviceId = (await deviceService.createDevice("muscle_gain")).deviceId;
});
```

**No-write-on-failure style** (meal-transactions lines 161-198):
```typescript
await assert.rejects(() =>
  mealTransactionsService.createTransaction(deviceId, { ... }),
);
...
const transactions = await db.select().from(mealTransactions);
const revisions = await db.select().from(mealRevisions);
const items = await db.select().from(mealRevisionItems);
const refs = await db.select().from(assetReferences);

assert.equal(transactions.length, 1);
assert.equal(revisions.length, 1);
assert.equal(items.length, 2);
assert.equal(refs.length, 2);
```

**Projection proof pattern** (food-logging lines 123-160):
```typescript
const updated = await foodService.updateMeal(deviceId, created.id, { items: [...] });
...
assert.equal(revisions.length, 2);
assert.equal(updated.id, created.id);
assert.equal(updated.mealRevisionId, transaction!.currentRevisionId);
assert.notEqual(updated.mealRevisionId, created.mealRevisionId);
```

**Correction side-effect proof pattern** (meal-correction lines 366-404, 499-518):
```typescript
const result = await mealCorrectionService.updateMeal(deviceId, original.id, {
  patch: { calories: 500 },
});

assert.equal(result.affectedDate, "2026-03-25");
assert.ok(result.dailySummary);
assert.equal(result.dailySummary.date, result.affectedDate);
assert.equal(result.updatedMeal.calories, 500);
...
await assert.rejects(
  () => mealCorrectionService.deleteMeal(foreignDeviceId, meal.id),
  /MEAL_NOT_FOUND/,
);
const result = await mealCorrectionService.deleteMeal(deviceId, meal.id);
assert.equal(result.deletedMealId, meal.id);
```

**Phase 62 test use:** add missing/stale expected revision tests at transaction, food-logging, and correction layers. Assert revision row counts and transaction `currentRevisionId` do not change on stale/missing errors.

### Orchestrator Tests

**Analogs:** `tests/unit/tools.test.ts`, `tests/unit/mutation-receipts.test.ts`

**Tool execution setup** (tools lines 1-18, 46-52):
```typescript
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { createDb } from "../../server/db/client.js";
...
beforeEach(async () => {
  db = createDb(":memory:");
  const deviceService = createDeviceService(db);
  foodLoggingService = createFoodLoggingService(db);
  summaryService = createSummaryService(db);
  deviceId = (await deviceService.createDevice("fat_loss")).deviceId;
});
```

**Logged meal revision assertion pattern** (tools lines 271-314):
```typescript
const result = await executeTool(logFoodCall, deviceId, {
  foodLoggingService,
  summaryService,
});

assert.ok(result.loggedMeal, "loggedMeal must be returned");
assert.ok(result.loggedMeal.mealId, "loggedMeal mealId must be returned");
assert.ok(result.loggedMeal.mealRevisionId, "loggedMeal mealRevisionId must be returned");
...
assert.equal(result.loggedMeal.mealRevisionId, transaction!.currentRevisionId);
```

**Update tool session-state pattern** (tools lines 1202-1228):
```typescript
const result = await executeTool(call, deviceId, {
  foodLoggingService,
  summaryService,
  mealCorrectionService,
  toolSessionState: {
    resolvedMealIds: [created.id],
  },
});
...
assert.equal(result.mealMutationKind, "update");
assert.equal(result.loggedMeal.mealId, created.id);
assert.equal(result.loggedMeal.mealRevisionId, transaction!.currentRevisionId);
assert.notEqual(result.loggedMeal.mealRevisionId, created.mealRevisionId);
```

**Receipt copy forbidden terms pattern** (mutation-receipts lines 420-438):
```typescript
const rejected = [
  "headline",
  "先抓低",
  "保守估算",
  "log_food",
  "update_meal",
  "delete_meal",
  "revision",
  "deviceId",
  "summaryOutcome",
  "dailySummary",
  ...
];
```

**Phase 62 test use:** update tool-session fixtures from ids to resolved identities. Add stale/missing contract assertions for `update_meal` and `delete_meal` after `find_meals`.

### Route and SSE Integration Tests

**Analogs:** `tests/integration/meals-api.test.ts`, `tests/integration/chat-api.test.ts`, `tests/integration/chat-streaming.test.ts`, `tests/integration/chat-meal-correction.integration.test.ts`, `tests/integration/sse.test.ts`

**Fastify fixture pattern** (meals-api lines 33-55):
```typescript
beforeEach(async () => {
  mockLLM = new MockLLMProvider();
  tempRoot = await mkdtemp(path.join(tmpdir(), "nutrition-meals-api-"));
  uploadsDir = path.join(tempRoot, "uploads");
  assetsDir = path.join(tempRoot, "assets");
  app = await buildApp({
    dbPath: ":memory:",
    llmProvider: mockLLM,
    uploadsDir,
    assetsDir,
    onServicesReady: (readyServices) => {
      services = readyServices;
    },
  });
  const deviceRes = await app.inject({ method: "POST", url: "/api/device", payload: { goal: "fat_loss" } });
  deviceCookieHeader = toCookieHeader(deviceRes.headers["set-cookie"]);
  address = await app.listen({ port: 0 });
});
```

**Direct PATCH success pattern** (meals-api lines 298-321):
```typescript
const updateRes = await app.inject({
  method: "PATCH",
  url: `/api/meals/${meal.id}`,
  headers: { cookie: deviceCookieHeader },
  payload: {
    foodName: "雞胸肉沙拉半份",
    calories: 260,
    protein: 20,
    carbs: 8,
    fat: 12,
    imageAssetId: null,
  },
});

assert.equal(updateRes.statusCode, 200);
const body = updateRes.json();
assert.equal(body.affectedDate, formatLocalDate(new Date(meal.loggedAt)));
assert.equal(body.dailySummary.totalCalories, 260);
assert.equal(body.meal.foodName, "雞胸肉沙拉半份");
```

**409 body pattern** (meals-api lines 532-550):
```typescript
const updateRes = await app.inject({
  method: "PATCH",
  url: `/api/meals/${meal.id}`,
  headers: { cookie: deviceCookieHeader },
  payload: { ... },
});

assert.equal(updateRes.statusCode, 409);
assert.deepEqual(updateRes.json(), {
  error: "MEAL_REQUIRES_GROUPED_UPDATE",
  message: "Grouped meals must be corrected through chat.",
});
```

**Historical no-SSE side-effect pattern** (meals-api lines 861-894):
```typescript
const deleteRes = await fetch(`${address}/api/meals/${meal.id}`, {
  method: "DELETE",
  headers: { cookie: deviceCookieHeader },
});
assert.equal(deleteRes.status, 200);
...
const extraChunk = await readOptionalSSEChunk(reader, 250);
assert.ok(
  extraChunk === null || !extraChunk.includes("event: daily_summary"),
  `historical delete must not emit a today SSE summary, got ${extraChunk ?? "<none>"}`,
);
```

**Chat JSON mutation pattern** (chat-api lines 2150-2203):
```typescript
mockLLM.queueChatResponse({
  toolCalls: [
    { function: { name: "find_meals", arguments: JSON.stringify({ action: "update", query: "牛肉麵" }) } },
    { function: { name: "update_meal", arguments: JSON.stringify({ meal_id: mealId, food_name: "半碗牛肉麵", ... }) } },
  ],
});
...
assert.equal(updateRes.status, 200);
const body = await updateRes.json() as { didMutateMeal?: boolean; loggedMeal?: { mealId?: string; foodName?: string }; ... };
assert.equal(body.didMutateMeal, true);
assert.equal(body.loggedMeal?.mealId, mealId);
assert.equal(body.loggedMeal?.foodName, "半碗牛肉麵");
assertUnavailableSummaryOutcome(body.summaryOutcome);
```

**Chat SSE done pattern** (chat-streaming lines 2238-2260):
```typescript
const res = await fetch(`${address}/api/chat`, {
  method: "POST",
  headers: { cookie: sessionCookieHeader, "Accept": "text/event-stream" },
  signal: controller.signal,
  body: form,
});
const reader = res.body.getReader();
const text = await readStreamUntil(reader, "event: done");
const events = parseSSEEvents(text);
const chunkEvents = events.filter((event) => event.event === "chunk");
const doneEvents = events.filter((event) => event.event === "done");

assert.ok(chunkEvents.length >= 2, "expected multiple progressive chunk events before done");
assert.equal(doneEvents.length, 1, "expected a single done event");
```

**SSE helper pattern** (sse lines 27-39, 81-101):
```typescript
function parseSSEFrames(raw: string): SSEFrame[] {
  return raw
    .split("\n\n")
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const lines = block.split("\n");
      return {
        event: lines.find((line) => line.startsWith("event: "))?.slice("event: ".length) ?? "",
        data: lines.find((line) => line.startsWith("data: "))?.slice("data: ".length) ?? "",
      };
    });
}
```

**Phase 62 test use:** add direct route tests for missing and stale `expectedMealRevisionId` on PATCH and DELETE, asserting `409` stable bodies and no side effects. Add chat JSON/SSE tests that stale tool update/delete do not mutate and terminal payloads include `loggedMeal.mealRevisionId` where editable.

### Client Tests

**Analogs:** `tests/unit/api-client.test.ts`, `tests/unit/meal-edit-payload.test.ts`, `tests/unit/meal-edit-screen.test.ts`, `tests/unit/store.test.ts`, `tests/unit/chat-bubble-contract.test.ts`

**API client fetch spy pattern** (api-client lines 20-27):
```typescript
let fetchCalls: Array<{ url: string; init: RequestInit }> = [];

function mockFetch(status: number, body: unknown) {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    fetchCalls.push({ url, init: init ?? {} });
    return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
  }) as typeof fetch;
}
```

**Update request body assertion pattern** (api-client lines 688-729):
```typescript
const input = {
  foodName: "雞胸肉沙拉半份",
  calories: 260,
  protein: 20,
  carbs: 8,
  fat: 12,
  imageAssetId: null,
};
const result = await api.updateMeal("meal-1", input);

assert.equal(fetchCalls[0].url, "/api/meals/meal-1");
assert.equal(fetchCalls[0].init.method, "PATCH");
assert.equal(fetchCalls[0].init.credentials, "same-origin");
assert.deepEqual(fetchCalls[0].init.headers, { "content-type": "application/json" });
assert.deepEqual(JSON.parse(String(fetchCalls[0].init.body)), input);
```

**Payload builder proof pattern** (meal-edit-payload lines 74-110, 113-155):
```typescript
const payload = buildHistoryMealEditPayload({
  id: "meal-1",
  foodName: "雞腿便當",
  ...
} as any, "2026-05-06");

assert.deepEqual(payload, {
  mealId: "meal-1",
  dateKey: "2026-05-06",
  foodName: "雞腿便當",
  ...
});

assert.equal(buildReceiptMealEditPayload({
  foodName: "缺少 ID",
  calories: 1,
  protein: 1,
  carbs: 1,
  fat: 1,
} as any), null);
```

**Meal edit source contract pattern** (meal-edit-screen lines 41-56, 58-72):
```typescript
for (const expected of [
  "updateMeal",
  "deleteMeal",
  "confirm",
  "setDailySummary",
  "redactChatReceiptIdentity",
  "recordMealMutation",
  "redactChatReceiptIdentity(mealId)",
  'getMeals({ refreshReason: "meal_mutation" })',
  "setMeals",
  "recoverGuestSession",
]) {
  assert.match(source, escapedPattern(expected));
}
...
assert.match(source, /await refreshAfterMealMutation\(payload\.mealId, response\.affectedDate, response\.dailySummary\);/);
```

**Store redaction proof pattern** (store lines 330-359):
```typescript
useStore.getState().redactChatReceiptIdentity("meal-1");

const [redactedMessage, untouchedMessage] = useStore.getState().messages;
assert.equal(redactedMessage?.loggedMeal?.mealId, undefined);
assert.equal(redactedMessage?.loggedMeal?.dateKey, undefined);
assert.equal(redactedMessage?.loggedMeal?.foodName, "雞腿便當");
assert.equal(buildReceiptMealEditPayload(redactedMessage?.loggedMeal), null);
assert.equal(untouchedMessage?.loggedMeal?.mealId, "meal-2");
```

**MessageBubble source contract pattern** (chat-bubble-contract lines 153-171):
```typescript
assert.match(bubble, /getCompleteReceiptEditPayload/);
assert.match(bubble, /buildReceiptMealEditPayload\(message\.loggedMeal\)/);
assert.match(bubble, /MealEditPayload/);
assert.match(bubble, /onOpenMealEdit\?\.\(editPayload\)/);
assert.match(bubble, /SportChevronRightIcon/);
assert.match(payloadBuilder, /Number\.isFinite/);
assert.doesNotMatch(chatPanel, /缺少可編輯/);
```

**Phase 62 test use:** assert `expectedMealRevisionId` is sent, stale error objects preserve `error`, `mealId`, `affectedDate`, and optional `currentMealRevisionId`, stale copy appears in `MealEditScreen`, and old receipts without `mealRevisionId` stay read-only.

## Shared Patterns

### Authentication / Ownership

**Source:** `server/routes/meals.ts`, `server/routes/day-snapshot.ts`
**Apply to:** all protected routes touched in Phase 62

Use `resolveGuestSession(request, { deviceService, guestSessionService })`, clear cookies on invalid sessions, set refreshed cookies when provided, and derive `deviceId` from the session only.

### Error Handling

**Source:** `server/routes/meals.ts`
**Apply to:** direct update/delete routes and any surfaced transaction precondition errors

Existing route convention is stable `409 { error: "..." }` for deterministic conflict contracts. Add `MEAL_REVISION_REQUIRED` and `MEAL_REVISION_STALE` to that convention. Preserve `MEAL_NOT_FOUND` as 404.

### Transaction Side-Effect Ordering

**Source:** `server/services/meal-transactions.ts`, `server/routes/meals.ts`, `server/services/meal-correction.ts`
**Apply to:** direct and chat/tool update/delete

Precondition checks must happen before new `meal_revisions` rows, `meal_transactions.currentRevisionId` updates, summary recompute, or realtime publish. Existing summary and publish calls are already after successful mutation; keep conflict returns before those blocks.

### DTO Naming

**Source:** `62-CONTEXT.md`, `client/src/types.ts`, `server/orchestrator/tools.ts`
**Apply to:** server DTOs, client DTOs, and write inputs

Use `mealRevisionId` for read/display identity. Use `expectedMealRevisionId` for write preconditions. Do not accept `expectedMealRevisionId` for meal creation/logging.

### UI Copy and Recovery

**Source:** `62-UI-SPEC.md`, `client/src/components/MealEditScreen.tsx`
**Apply to:** Meal Edit stale save/delete failures

Use deterministic Traditional Chinese stale guidance in the existing `role="alert"` region:
- `MEAL_REVISION_STALE` edit: `餐點已被更新，請重新載入最新餐點後再編輯。`
- `MEAL_REVISION_REQUIRED`: `餐點版本已失效，請重新載入最新餐點後再編輯。`
- stale delete: `餐點已被更新，未刪除。請重新載入最新餐點後再決定是否刪除。`
- recovery CTA if added: `重新載入餐點`

Keep existing Sport primitives and `SportIcons`; do not add new UI libraries.

### Testing

**Source:** `AGENTS.md`, `nutrition-gen-test` / `nutrition-verify-change` skill indexes
**Apply to:** all Phase 62 tests

Use Node built-in `node:test`, real SQLite `:memory:`, explicit `.js` imports, and Fastify `app.inject()` or existing fetch-based integration fixtures. Expected verification for implementation edits: `yarn tsc --noEmit`, `yarn test:unit`, and `yarn test:integration`.

## No Analog Found

All planned Phase 62 files have close in-repo analogs. No external pattern is required.

## Metadata

**Analog search scope:** `server/services`, `server/routes`, `server/orchestrator`, `client/src`, `tests/unit`, `tests/integration`
**Files scanned:** 150+ via `rg --files`, then focused analog reads
**Pattern extraction date:** 2026-05-17
