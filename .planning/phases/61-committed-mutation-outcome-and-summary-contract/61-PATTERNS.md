# Phase 61: Committed Mutation Outcome and Summary Contract - Pattern Map

**Mapped:** 2026-05-17
**Files analyzed:** 21
**Analogs found:** 21 / 21

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `server/services/summary-outcome.ts` | service/utility | transform + CRUD read | `server/orchestrator/tools.ts` recovery helper + `server/services/summary.ts` | role-match |
| `server/services/meal-correction.ts` | service | CRUD | `server/services/meal-correction.ts` update/delete methods | exact |
| `server/routes/meals.ts` | route | request-response + CRUD | `server/routes/meals.ts` PATCH/DELETE routes | exact |
| `server/routes/chat.ts` | route | request-response + streaming | `server/routes/chat.ts` JSON/SSE projection and publish helper | exact |
| `server/orchestrator/tools.ts` | orchestrator tool adapter | request-response + transform | `server/orchestrator/tools.ts` log/update/delete contracts | exact |
| `server/orchestrator/mutation-effects.ts` | model/DTO | transform | `server/orchestrator/mutation-effects.ts` mutation union | exact |
| `server/orchestrator/index.ts` | orchestrator service | event-driven + request-response | `server/orchestrator/index.ts` mutation effect assembly | exact |
| `server/orchestrator/mutation-receipts.ts` | utility | transform | `server/orchestrator/mutation-receipts.ts` committed-facts receipt renderer | exact |
| `server/app.ts` | composition root | dependency injection | `server/app.ts` service construction and route registration | exact |
| `client/src/types.ts` | model/DTO | transform | `client/src/types.ts` `DailySummary`, `ChatReply`, meal mutation DTOs | exact |
| `client/src/api.ts` | client transport utility | request-response + streaming | `client/src/api.ts` chat normalization and meal mutation helpers | exact |
| `client/src/components/MealEditScreen.tsx` | component | event-driven + request-response | `client/src/components/MealEditScreen.tsx` direct mutation refresh flow | exact |
| `tests/unit/summary-outcome.test.ts` | test | transform + CRUD read | `tests/unit/tools.test.ts` recompute recovery test | role-match |
| `tests/unit/tools.test.ts` | test | tool contract transform | `tests/unit/tools.test.ts` log/update/delete contract tests | exact |
| `tests/unit/meal-correction.test.ts` | test | CRUD | `tests/unit/meal-correction.test.ts` update/delete affected-date tests | exact |
| `tests/unit/orchestrator.test.ts` | test | event-driven + request-response | `tests/unit/orchestrator.test.ts` committed receipt tests | exact |
| `tests/integration/meals-api.test.ts` | test | request-response + CRUD | `tests/integration/meals-api.test.ts` Fastify `app.inject()` meal tests | exact |
| `tests/integration/chat-api.test.ts` | test | request-response | `tests/integration/chat-api.test.ts` chat JSON mutation tests | exact |
| `tests/integration/chat-streaming.test.ts` | test | streaming | `tests/integration/chat-streaming.test.ts` chat SSE terminal payload tests | exact |
| `tests/unit/api-client.test.ts` | test | request-response + streaming | `tests/unit/api-client.test.ts` mocked fetch and SSE parser tests | exact |
| `tests/unit/meal-edit-screen.test.ts` | test | component source contract | `tests/unit/meal-edit-screen.test.ts` source-contract assertions | exact |

## Pattern Assignments

### `server/services/summary-outcome.ts` (service/utility, transform + CRUD read)

**Analog:** `server/orchestrator/tools.ts` and `server/services/summary.ts`

**Imports pattern** (`tools.ts` lines 1-10, `summary.ts` lines 8-10):
```typescript
import type { createFoodLoggingService } from "../services/food-logging.js";
import type { createSummaryService, DailySummary } from "../services/summary.js";
import { currentAppDate, formatLocalDate } from "../lib/time.js";
```

**Core recovery pattern** (`server/orchestrator/tools.ts` lines 560-581):
```typescript
function buildLocalMidpointDate(dateKey: string): Date {
  return new Date(`${dateKey}T12:00:00`);
}

async function recoverDailySummaryFromPersistedMeals(
  deps: ToolDeps,
  deviceId: string,
  dateKey: string,
): Promise<DailySummary> {
  const meals = await deps.foodLoggingService.getMealsByDate(
    deviceId,
    buildLocalMidpointDate(dateKey),
  );

  return {
    totalCalories: meals.reduce((sum, meal) => sum + meal.calories, 0),
    totalProtein: meals.reduce((sum, meal) => sum + meal.protein, 0),
    totalCarbs: meals.reduce((sum, meal) => sum + meal.carbs, 0),
    totalFat: meals.reduce((sum, meal) => sum + meal.fat, 0),
    mealCount: meals.length,
    date: dateKey,
  };
}
```

**Summary service read pattern** (`server/services/summary.ts` lines 20-50):
```typescript
export function createSummaryService(db: AppDatabase) {
  return {
    async getDailySummary(deviceId: string, date: Date): Promise<DailySummary> {
      const { dateKey, startIso, endIso } = getLocalDayBounds(date);
      const result = await db
        .select({
          totalCalories: sql<number>`coalesce(sum(${mealRevisionItems.calories}), 0)`,
          totalProtein: sql<number>`coalesce(sum(${mealRevisionItems.protein}), 0)`,
          totalCarbs: sql<number>`coalesce(sum(${mealRevisionItems.carbs}), 0)`,
          totalFat: sql<number>`coalesce(sum(${mealRevisionItems.fat}), 0)`,
          mealCount: sql<number>`count(distinct ${mealTransactions.id})`,
        })
        .from(mealTransactions)
        .where(and(eq(mealTransactions.deviceId, deviceId), isNull(mealTransactions.deletedAt)));
      return { ...result[0], date: dateKey };
    },
  };
}
```

**Apply:** Define `SummaryOutcome`, `dailySummaryFromOutcome()`, and a post-commit helper that first calls `summaryService.getDailySummary(...)`, then recovers from persisted meals, then returns `{ status: "unavailable", reason: "recompute_failed" }`.

---

### `server/services/meal-correction.ts` (service, CRUD)

**Analog:** `server/services/meal-correction.ts`

**Imports pattern** (lines 1-17):
```typescript
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import type { AppDatabase } from "../db/client.js";
import { currentAppDate, formatLocalDate } from "../lib/time.js";
import { createSummaryService, type DailySummary } from "./summary.js";
import { projectMealDisplay } from "./meal-display.js";
```

**Commit-then-summary pattern to replace** (lines 679-710):
```typescript
const updated = await mealTransactionsService.updateTransaction(deviceId, mealId, { items: nextItems });
const dailySummary = await summaryService.getDailySummary(
  deviceId,
  new Date(`${updated.affectedDateKey}T12:00:00`),
);

const display = projectMealDisplay(updated.items);

return {
  updatedMeal: { /* committed facts */ },
  affectedDate: updated.affectedDateKey,
  dailySummary,
};
```

**Delete pattern to preserve committed facts** (lines 722-733):
```typescript
const deleted = await mealTransactionsService.softDeleteTransaction(deviceId, mealId);
const dailySummary = await summaryService.getDailySummary(
  deviceId,
  new Date(`${deleted.affectedDateKey}T12:00:00`),
);

return {
  deletedMealId: deleted.deletedMeal.mealId,
  affectedDate: deleted.affectedDateKey,
  dailySummary,
  deletedMeal: deleted.deletedMeal,
};
```

**Apply:** Keep `updateTransaction` / `softDeleteTransaction` as the commit authority. Return committed facts even when summary recompute/recovery degrades, replacing required `dailySummary` with `summaryOutcome` plus compatibility projection.

---

### `server/routes/meals.ts` (route, request-response + CRUD)

**Analog:** `server/routes/meals.ts`

**Auth/session and validation pattern** (lines 109-125):
```typescript
app.patch("/api/meals/:id", async (request, reply) => {
  const session = await resolveGuestSession(request, { deviceService, guestSessionService });
  if (!session.ok) {
    if (session.clearCookies) {
      reply.header("set-cookie", guestSessionService.clearSessionCookies());
    }
    return reply.code(401).send({ error: session.error });
  }
  const { deviceId } = session;
  if (session.setCookies) {
    reply.header("set-cookie", session.setCookies);
  }

  const update = parseMealUpdateBody(request.body);
  if (!update) {
    return reply.code(400).send({ error: "Invalid meal update" });
  }
```

**Current direct PATCH projection** (lines 169-193):
```typescript
const dailySummary = await summaryService.getDailySummary(
  deviceId,
  new Date(`${affectedDateKey}T12:00:00`),
);
if (dailySummary.date === formatLocalDate(currentAppDate())) {
  publisher.publishDailySummary(deviceId, dailySummary);
}

const imageAssetId = parseAssetRef(updatedMeal.imagePath);
return {
  affectedDate: affectedDateKey,
  dailySummary,
  meal: {
    id: updatedMeal.id,
    foodName: updatedMeal.foodName,
    itemCount: updatedMeal.itemCount ?? 1,
  },
};
```

**Current direct DELETE projection** (lines 220-230):
```typescript
const dailySummary = await summaryService.getDailySummary(
  deviceId,
  new Date(`${affectedDateKey}T12:00:00`),
);
if (dailySummary.date === formatLocalDate(currentAppDate())) {
  publisher.publishDailySummary(deviceId, dailySummary);
}
return {
  affectedDate: affectedDateKey,
  dailySummary,
};
```

**Apply:** Keep 401/400/404/409 behavior unchanged. After a committed PATCH/DELETE, return HTTP `200` with committed facts and `summaryOutcome`. Include top-level `dailySummary` only from `dailySummaryFromOutcome(summaryOutcome)`. Wrap publish with the chat route's non-fatal pattern.

---

### `server/routes/chat.ts` (route, request-response + streaming)

**Analog:** `server/routes/chat.ts`

**Non-fatal publish pattern** (lines 386-411):
```typescript
function publishSummarySafe(
  publisher: RealtimePublisher,
  deviceId: string,
  didMutateMeal: boolean,
  dailySummary: unknown,
  log: FastifyBaseLogger,
): void {
  const summaryDate = /* validate dailySummary.date */;
  if (!didMutateMeal || !summaryDate || summaryDate !== formatLocalDate(currentAppDate())) return;
  try {
    publisher.publishDailySummary(deviceId, dailySummary as DailySummary);
    log.info({ event: "summary_publish_success" }, "Summary publish success");
  } catch (publishErr) {
    log.warn(
      { event: "summary_publish_failed", err: publishErr instanceof Error ? publishErr.message : String(publishErr) },
      "Summary publish failed (non-fatal)",
    );
  }
}
```

**SSE terminal payload pattern** (lines 936-968):
```typescript
if (streamResult.stopped) {
  const stoppedData = {
    stopped: true,
    turnId: stopControl.turnId,
    didLogMeal: streamDidLogMeal,
    didMutateMeal: streamDidMutateMeal,
    ...(streamLoggedMealReceipt ? { loggedMeal: streamLoggedMealReceipt } : {}),
    ...(streamDailySummary ? { dailySummary: streamDailySummary } : {}),
    ...(streamAffectedDate ? { affectedDate: streamAffectedDate } : {}),
  };
  stream.write(`event: stopped\ndata: ${JSON.stringify(stoppedData)}\n\n`);
  publishSummarySafe(deps.publisher, deviceId, streamDidMutateMeal, streamDailySummary, deps.log);
  return;
}

const doneData = {
  turnId: stopControl.turnId,
  didLogMeal: streamDidLogMeal,
  didMutateMeal: streamDidMutateMeal,
  ...(streamLoggedMealReceipt ? { loggedMeal: streamLoggedMealReceipt } : {}),
  ...(streamDailySummary ? { dailySummary: streamDailySummary } : {}),
  ...(streamAffectedDate ? { affectedDate: streamAffectedDate } : {}),
};
stream.write(`event: done\ndata: ${JSON.stringify(doneData)}\n\n`);
```

**JSON response projection pattern** (lines 1393-1422):
```typescript
publishSummarySafe(publisher, deviceId, jsonDidMutateMeal, dailySummary, turnLog);
return {
  turnId,
  reply: sanitizedJson,
  didLogMeal,
  ...(result.didMutateMeal !== undefined ? { didMutateMeal: result.didMutateMeal } : {}),
  ...(jsonLoggedMealReceipt ? { loggedMeal: jsonLoggedMealReceipt } : {}),
  ...(dailySummary ? { dailySummary } : {}),
  ...(dailyTargets ? { dailyTargets } : {}),
  ...(affectedDate ? { affectedDate } : {}),
};
```

**Apply:** Add `summaryOutcome` to `done`, `stopped`, and JSON chat responses for committed meal mutations. Remove/relax the JSON invariant at lines 1299-1301 that throws when `didLogMeal` lacks `dailySummary`; `summaryOutcome.unavailable` is now valid.

---

### `server/orchestrator/tools.ts` (orchestrator tool adapter, request-response + transform)

**Analog:** `server/orchestrator/tools.ts`

**Tool dependency shape** (lines 47-58):
```typescript
export interface ToolDeps {
  foodLoggingService: ReturnType<typeof createFoodLoggingService>;
  summaryService: ReturnType<typeof createSummaryService>;
  mealCorrectionService?: ReturnType<typeof createMealCorrectionService>;
  deviceService?: ReturnType<typeof createDeviceService>;
  publisher?: Pick<RealtimePublisher, "publishGoalsUpdate">;
  toolSessionState?: {
    resolvedMealIds: string[];
  };
}
```

**Existing log recovery precedent** (lines 1045-1059):
```typescript
// persist the meal BEFORE recomputing the daily summary
let dailySummary: DailySummary;
try {
  dailySummary = await deps.summaryService.getDailySummary(
    deviceId,
    buildLocalMidpointDate(dateIntent.dateKey),
  );
} catch {
  dailySummary = await recoverDailySummaryFromPersistedMeals(
    deps,
    deviceId,
    dateIntent.dateKey,
  );
}
```

**Update/delete contract pattern** (lines 1274-1317, 1347-1358):
```typescript
const updated = await deps.mealCorrectionService.updateMeal(deviceId, args.meal_id, input);
await deps.mealCorrectionService.clearPendingSelection(deviceId);
return {
  ok: true,
  result: updated,
  toolMessage: "已更新餐點",
};

const deleted = await deps.mealCorrectionService.deleteMeal(deviceId, args.meal_id);
return {
  ok: true,
  result: deleted,
  toolMessage: "已刪除餐點",
};
```

**ToolExecutionResult projection pattern to update** (lines 1699-1762):
```typescript
if (toolCall.function.name === "update_meal") {
  const contractResult = outcome.contractResult as UpdateMealResult;
  return {
    summary: "成功",
    mealMutationKind: "update",
    dailySummary: contractResult.dailySummary,
    affectedDate: contractResult.affectedDate,
    loggedMeal: { /* committed updated meal facts */ },
  };
}

if (toolCall.function.name === "delete_meal") {
  const contractResult = outcome.contractResult as DeleteMealResult;
  return {
    summary: "成功",
    mealMutationKind: "delete",
    dailySummary: contractResult.dailySummary,
    affectedDate: contractResult.affectedDate,
    deletedMeal: contractResult.deletedMeal,
  };
}
```

**Apply:** Add `summaryOutcome` to tool result types and projections for `log_food`, `update_meal`, and `delete_meal`. Keep `dailySummary` compatibility only when projected from `summaryOutcome`.

---

### `server/orchestrator/mutation-effects.ts` (model/DTO, transform)

**Analog:** `server/orchestrator/mutation-effects.ts`

**Current union pattern** (lines 28-59):
```typescript
interface MutationEffectsBase {
  affectedDate: string;
  committedSummary: DailySummary;
  committedTargets: DailyTargets;
}

export interface LogMutationEffects extends MutationEffectsBase {
  kind: "log";
  meal: CommittedMealFacts;
}

export interface UpdateMutationEffects extends MutationEffectsBase {
  kind: "update";
  meal: CommittedMealFacts;
}

export interface DeleteMutationEffects extends MutationEffectsBase {
  kind: "delete";
  deletedMeal: DeletedMealSnapshot;
}

export type MutationEffects =
  | LogMutationEffects
  | UpdateMutationEffects
  | DeleteMutationEffects
  | GoalsMutationEffects;
```

**Apply:** Split meal mutation effects from goal effects if needed. Meal log/update/delete effects should not require `committedSummary`; carry `summaryOutcome` or optional summary projection while keeping committed facts required. Goal mutation migration is out of scope unless purely internal.

---

### `server/orchestrator/index.ts` (orchestrator service, event-driven + request-response)

**Analog:** `server/orchestrator/index.ts`

**Current result shape and invariant to relax** (lines 91-135):
```typescript
export type OrchestratorResult =
  | ({
      reply: string;
      didLogMeal: boolean;
      didMutateMeal?: boolean;
      dailySummary?: DailySummary;
      affectedDate?: string;
      loggedMeal?: LoggedMealReceipt;
    } & FinalReplyTraceMetadata)
  | ({
      streamGenerator: AsyncGenerator<string>;
      didLogMeal: boolean;
      didMutateMeal?: boolean;
      dailySummary?: DailySummary;
      affectedDate?: string;
      loggedMeal?: LoggedMealReceipt;
    } & FinalReplyTraceMetadata);

function requireDailySummaryForLoggedMeal(dailySummary: DailySummary | undefined): DailySummary {
  if (!dailySummary) {
    throw new Error("log_food succeeded without dailySummary");
  }
  return dailySummary;
}
```

**Mutation effect assembly to update** (lines 965-1015):
```typescript
if (toolCall.function.name === "log_food") {
  didLogMeal = true;
  didMutateMeal = true;
  logMealSummary = requireDailySummaryForLoggedMeal(dailySummary);
  mutationEffects = {
    kind: "log",
    affectedDate: affectedDate ?? toolLoggedMeal.dateKey,
    committedSummary: logMealSummary,
    committedTargets: getDeviceTargets(device),
    meal: toolLoggedMeal,
  };
  mutationReceiptText = renderCheckedMutationReceipt(mutationEffects);
}
if (mealMutationKind === "update" || mealMutationKind === "delete") {
  didMutateMeal = true;
  logMealSummary = requireDailySummaryForLoggedMeal(dailySummary);
  // update/delete build committed-facts effects here
}
```

**Partial-success return pattern** (lines 1062-1074, 1086-1100):
```typescript
if (mutationReceiptText && mutationEffects) {
  return {
    reply: mutationReceiptText,
    didLogMeal,
    didMutateMeal,
    dailySummary: logMealSummary,
    dailyTargets: successfulGoalTargets,
    affectedDate: resolvedAffectedDate,
    loggedMeal,
    loggedMealToolMessageId,
    finalReplySource: "renderer",
    finalReplyShape: classifyPlainReplyShape(mutationReceiptText),
  };
}
```

**Apply:** Preserve renderer-owned committed receipts, fatal-later-tool partial success, and `MAX_ROUNDS` fallback behavior. Stop using `requireDailySummaryForLoggedMeal(...)` as a post-commit gate for meal mutations.

---

### `server/orchestrator/mutation-receipts.ts` (utility, transform)

**Analog:** `server/orchestrator/mutation-receipts.ts`

**Committed-facts copy pattern** (lines 108-132):
```typescript
function logUncertaintySuffix(effects: MutationEffects): string {
  if (
    effects.kind === "log" &&
    (effects.meal.quantityUncertaintyReason === "missing_quantity" ||
      effects.meal.usedConservativeAssumption === true)
  ) {
    return "若份量不同，可以再調整。";
  }
  return "";
}

export function renderMutationReceipt(effects: MutationEffects): string {
  switch (effects.kind) {
    case "log":
      return `已記錄${datePrefix}${effects.meal.foodName}，${formatNumber(effects.meal.calories)} kcal，蛋白質 ${formatNumber(effects.meal.protein)} g。${logUncertaintySuffix(effects)}`;
    case "update":
      return `已更新${datePrefix}${effects.meal.foodName}，${formatNumber(effects.meal.calories)} kcal，蛋白質 ${formatNumber(effects.meal.protein)} g。`;
    case "delete":
      return `已刪除${datePrefix}${effects.deletedMeal.foodName}，已從當日紀錄移除。`;
  }
}
```

**Forbidden implementation-copy guard** (lines 5-32):
```typescript
export const FORBIDDEN_RECEIPT_TERMS = [
  "log_food",
  "update_meal",
  "delete_meal",
  "dailySummary",
  "PATCH",
  "DELETE",
  "/api",
  "response",
] as const;
```

**Apply:** Keep receipt text independent from `summaryOutcome.status`; do not append summary freshness caveats.

---

### `server/app.ts` (composition root, dependency injection)

**Analog:** `server/app.ts`

**Service construction pattern** (lines 84-103):
```typescript
const foodLoggingService = createFoodLoggingService(db);
const summaryService = createSummaryService(db);
const historyQueryService = createHistoryQueryService(db, { summaryService });
const daySnapshotService = createDaySnapshotService({ summaryService, foodLoggingService });
const mealCorrectionService = createMealCorrectionService(db);
const publisher = new RealtimePublisher();
```

**Route registration pattern** (lines 131-147):
```typescript
registerChatRoutes(app, {
  orchestrator,
  chatService,
  deviceService,
  guestSessionService,
  assetService,
  publisher,
  uploadsDir: opts.uploadsDir,
  llmTraceRecorderFactory: opts.llmTraceRecorderFactory,
});
registerMealRoutes(app, { foodLoggingService, summaryService, deviceService, guestSessionService, assetService, publisher });
registerSSERoutes(app, { publisher, summaryService, deviceService, guestSessionService });
```

**Apply:** If `summary-outcome.ts` is a factory service, construct it in `buildApp()` and pass it through route/orchestrator deps here. If it is a pure helper over existing deps, no `app.ts` change is needed.

---

### `client/src/types.ts` (model/DTO, transform)

**Analog:** `client/src/types.ts`

**DTO pattern** (lines 44-51, 100-104, 169-178):
```typescript
export interface DailySummary {
  date: string;
  totalCalories: number;
  totalProtein: number;
  totalCarbs: number;
  totalFat: number;
  mealCount: number;
}

export interface UpdateMealResponse {
  affectedDate: string;
  dailySummary: DailySummary;
  meal: MealEntry;
}

export interface ChatReply {
  turnId: string;
  reply: string;
  didLogMeal?: boolean;
  didMutateMeal?: boolean;
  loggedMeal?: LoggedMealReceipt;
  dailySummary?: DailySummary;
  dailyTargets?: DailyTargets;
  affectedDate?: string;
}
```

**Apply:** Add a client `SummaryOutcome` union mirroring the public response. Make direct meal mutation `dailySummary` optional/compatibility-derived, and add `summaryOutcome` to chat/direct mutation DTOs where consumed.

---

### `client/src/api.ts` (client transport utility, request-response + streaming)

**Analog:** `client/src/api.ts`

**Runtime normalization helpers pattern** (lines 44-63):
```typescript
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeMealItems(value: unknown): MealItemDetail[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const items = value
    .map((item): MealItemDetail | null => {
      if (!isRecord(item)) {
        return null;
      }
      // validate fields before projecting
    });
}
```

**SSE terminal parse pattern** (lines 628-659):
```typescript
} else if (eventType === "done") {
  callbacks.onDone({
    didLogMeal: Boolean(parsed.didLogMeal),
    ...(parsed.didMutateMeal !== undefined ? { didMutateMeal: Boolean(parsed.didMutateMeal) } : {}),
    ...(isLoggedMealReceipt(parsed.loggedMeal)
      ? { loggedMeal: normalizeLoggedMealReceipt(parsed.loggedMeal) }
      : {}),
    ...(isDailySummary(parsed.dailySummary) ? { dailySummary: parsed.dailySummary } : {}),
    ...(typeof parsed.affectedDate === "string" ? { affectedDate: parsed.affectedDate } : {}),
  });
} else if (eventType === "stopped") {
  callbacks.onStopped?.({
    stopped: true,
    tokensStreamed: typeof parsed.tokensStreamed === "number" && Number.isFinite(parsed.tokensStreamed)
      ? parsed.tokensStreamed
      : 0,
    ...(isDailySummary(parsed.dailySummary) ? { dailySummary: parsed.dailySummary } : {}),
  });
}
```

**Direct mutation transport pattern** (lines 789-824):
```typescript
export interface DeleteMealResponse {
  affectedDate: string;
  dailySummary: DailySummary;
}

export async function deleteMeal(mealId: string): Promise<DeleteMealResponse> {
  const res = await fetch(`/api/meals/${mealId}`, {
    method: "DELETE",
    credentials: "same-origin",
  });
  if (res.status === 401) throw new Error("UNAUTHORIZED");
  if (!res.ok) throw new Error("Failed to delete meal");
  return res.json() as Promise<DeleteMealResponse>;
}
```

**Apply:** Add an `isSummaryOutcome()` guard or equivalent narrow parser. Do not throw on HTTP `200` just because top-level `dailySummary` is absent when `summaryOutcome.status === "unavailable"`.

---

### `client/src/components/MealEditScreen.tsx` (component, event-driven + request-response)

**Analog:** `client/src/components/MealEditScreen.tsx`

**Direct mutation refresh pattern** (lines 121-130):
```typescript
async function refreshAfterMealMutation(mealId: string, affectedDate: string, dailySummary: DailySummary) {
  redactChatReceiptIdentity(mealId);
  recordMealMutation(affectedDate);
  if (dailySummary.date !== formatLocalDate(new Date())) {
    return;
  }

  setDailySummary(dailySummary);
  const { meals } = await getMeals({ refreshReason: "meal_mutation" });
  setMeals(meals);
}
```

**Save/delete callers** (lines 147-180):
```typescript
const response = await updateMeal(payload.mealId, {
  ...parsedDraft,
  imageAssetId: payload.imageAssetId ?? null,
});
await refreshAfterMealMutation(payload.mealId, response.affectedDate, response.dailySummary);
onBack();

const { affectedDate, dailySummary } = await deleteMeal(payload.mealId);
await refreshAfterMealMutation(payload.mealId, affectedDate, dailySummary);
onBack();
```

**Apply:** Keep committed mutation side effects (`redactChatReceiptIdentity`, `recordMealMutation`, navigation back) even when summary is unavailable. Only call `setDailySummary` when a usable summary exists.

---

## Test Pattern Assignments

### `tests/unit/summary-outcome.test.ts` (test, transform + CRUD read)

**Analog:** `tests/unit/tools.test.ts`

**Imports and fixture pattern** (`tests/unit/tools.test.ts` lines 1-18, 46-52):
```typescript
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createDb } from "../../server/db/client.js";
import { createDeviceService } from "../../server/services/device.js";
import { createFoodLoggingService } from "../../server/services/food-logging.js";
import { createSummaryService } from "../../server/services/summary.js";
import { formatLocalDate } from "../../server/lib/time.js";

beforeEach(async () => {
  db = createDb(":memory:");
  const deviceService = createDeviceService(db);
  foodLoggingService = createFoodLoggingService(db);
  summaryService = createSummaryService(db);
  deviceId = (await deviceService.createDevice("fat_loss")).deviceId;
});
```

**Recovery assertion pattern** (`tests/unit/tools.test.ts` lines 961-1021):
```typescript
const throwingSummary = {
  getDailySummary: async () => {
    throw new Error("summary computation failed");
  },
} as unknown as typeof summaryService;

const outcome = await runContract(contract!, logFoodCall, {
  currentUserMessage: "",
  previousAssistantMessage: undefined,
  deps: { toolDeps, deviceId },
});

assert.equal(outcome.success, true);
assert.equal(outcome.executed, true);
assert.equal(contractResult.status, "logged");
assert.deepEqual(contractResult.dailySummary, {
  totalCalories: 100,
  mealCount: 1,
  date: formatLocalDate(new Date()),
});
```

**Apply:** Add focused tests for `fresh`, `recovered`, `unavailable`, and `dailySummaryFromOutcome()` compatibility projection.

---

### `tests/unit/tools.test.ts` (test, tool contract transform)

**Analog:** `tests/unit/tools.test.ts`

**Update/delete committed facts pattern** (lines 1145-1235):
```typescript
const result = await executeTool(call, deviceId, {
  foodLoggingService,
  summaryService,
  mealCorrectionService,
  toolSessionState: {
    resolvedMealIds: [created.id],
  },
});

assert.equal(result.mealMutationKind, "update");
assert.equal(result.loggedMeal?.mealId, created.id);
assert.equal(result.loggedMeal?.mealRevisionId, transaction!.currentRevisionId);
assert.equal(result.loggedMeal?.dateKey, "2026-03-25");

assert.equal(result.mealMutationKind, "delete");
assert.equal(result.affectedDate, "2026-03-25");
assert.equal(result.dailySummary?.mealCount, 0);
assert.ok(result.deletedMeal);
```

**Apply:** Extend assertions to check `summaryOutcome.status` for log/update/delete and compatibility `dailySummary` only when fresh/recovered.

---

### `tests/unit/meal-correction.test.ts` (test, CRUD)

**Analog:** `tests/unit/meal-correction.test.ts`

**Fixture/timezone pattern** (lines 1-66):
```typescript
process.env.TZ = "Asia/Taipei";

import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";

const REAL_DATE = Date;
const FIXED_NOW = new REAL_DATE("2026-04-19T12:00:00+08:00");

beforeEach(async () => {
  globalThis.Date = FixedDate as DateConstructor;
  db = createDb(":memory:");
  const deviceService = createDeviceService(db);
  foodLoggingService = createFoodLoggingService(db);
  mealCorrectionService = createMealCorrectionService(db);
  deviceId = (await deviceService.createDevice("fat_loss")).deviceId;
});

afterEach(() => {
  globalThis.Date = REAL_DATE;
});
```

**Affected-date assertions** (lines 356-372, 457-478):
```typescript
const result = await mealCorrectionService.updateMeal(deviceId, original.id, {
  patch: { calories: 500 },
});

assert.equal(result.affectedDate, "2026-03-25");
assert.equal(result.dailySummary.date, result.affectedDate);
assert.equal(result.updatedMeal.calories, 500);

const result = await mealCorrectionService.deleteMeal(deviceId, meal.id);
assert.equal(result.deletedMealId, meal.id);
assert.equal(result.affectedDate, "2026-03-25");
assert.equal(result.dailySummary.mealCount, 0);
assert.deepEqual(result.deletedMeal, { mealId: meal.id, dateKey: "2026-03-25", /* ... */ });
```

**Apply:** Add failure-injection tests proving update/delete still return committed facts with `summaryOutcome.recovered` or `summaryOutcome.unavailable`.

---

### `tests/unit/orchestrator.test.ts` (test, event-driven + request-response)

**Analog:** `tests/unit/orchestrator.test.ts`

**Committed receipt after recompute failure** (lines 529-556):
```typescript
it("handleMessage returns a committed log receipt when summary recomputation fails after persistence", async () => {
  shouldFailSummary = true;
  mockLLM.queueChatResponse({
    toolCalls: [{ function: { name: "log_food", arguments: JSON.stringify({ food_name: "蘋果", calories: 100 }) } }],
  });

  const result = await orchestrator.handleMessage(deviceId, "我吃了蘋果");

  assert.ok("reply" in result);
  assert.equal(result.didLogMeal, true);
  assert.equal(result.didMutateMeal, true);
  assert.equal(result.finalReplySource, "renderer");
  assert.match(result.reply, /已記錄蘋果/);
  assert.equal(result.dailySummary?.mealCount, 1);
});
```

**Update/delete receipt pattern** (lines 718-819):
```typescript
const result = await orchestrator.handleMessage(deviceId, "把雞腿便當改成半份雞腿便當...");
assert.equal(result.reply, "已更新半份雞腿便當，360 kcal，蛋白質 20 g。");
assert.equal(result.didMutateMeal, true);
assert.equal(result.loggedMeal?.mealId, seeded.id);
assert.equal(result.dailySummary?.totalCalories, 360);

const deleteResult = await orchestrator.handleMessage(deviceId, "刪掉雞腿便當");
assert.equal(deleteResult.reply, "已刪除雞腿便當，已從當日紀錄移除。");
assert.equal(deleteResult.didMutateMeal, true);
assert.equal(deleteResult.dailySummary?.mealCount, 0);
```

**Apply:** Assert `summaryOutcome` on renderer-owned committed receipts and add unavailable coverage where no top-level `dailySummary` should be present.

---

### `tests/integration/meals-api.test.ts` (test, request-response + CRUD)

**Analog:** `tests/integration/meals-api.test.ts`

**Fastify app fixture pattern** (lines 1-61):
```typescript
process.env.TZ = "Asia/Taipei";

import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../../server/app.js";
import { MockLLMProvider } from "../../server/llm/mock.js";

beforeEach(async () => {
  mockLLM = new MockLLMProvider();
  app = await buildApp({
    dbPath: ":memory:",
    llmProvider: mockLLM,
    onServicesReady: (readyServices) => {
      services = readyServices;
    },
  });
  const deviceRes = await app.inject({ method: "POST", url: "/api/device", payload: { goal: "fat_loss" } });
  deviceCookieHeader = toCookieHeader(deviceRes.headers["set-cookie"]);
});
```

**Direct DELETE/PATCH assertions** (lines 243-299):
```typescript
const ownDelete = await app.inject({
  method: "DELETE",
  url: `/api/meals/${mealId}`,
  headers: { cookie: deviceCookieHeader },
});
assert.equal(ownDelete.statusCode, 200);
assert.deepEqual(ownDelete.json(), {
  affectedDate: formatLocalDate(new Date()),
  dailySummary: { mealCount: 0, /* ... */ },
});

const updateRes = await app.inject({
  method: "PATCH",
  url: `/api/meals/${meal.id}`,
  headers: { cookie: deviceCookieHeader },
  payload: { foodName: "雞胸肉沙拉半份", calories: 260, protein: 20, carbs: 8, fat: 12, imageAssetId: null },
});
assert.equal(updateRes.statusCode, 200);
assert.equal(body.affectedDate, formatLocalDate(new Date(meal.loggedAt)));
assert.equal(body.dailySummary.totalCalories, 260);
```

**Affected local day spy pattern** (lines 587-609):
```typescript
const requestedDates: string[] = [];
const originalGetDailySummary = services.summaryService.getDailySummary.bind(services.summaryService);
services.summaryService.getDailySummary = async (summaryDeviceId, date) => {
  requestedDates.push(formatLocalDate(date));
  return originalGetDailySummary(summaryDeviceId, date);
};
try {
  const deleteRes = await app.inject({ method: "DELETE", url: `/api/meals/${meal.id}`, headers: { cookie: deviceCookieHeader } });
  assert.equal(deleteRes.statusCode, 200);
  assert.deepEqual(requestedDates, [formatLocalDate(new Date(loggedAt))]);
} finally {
  services.summaryService.getDailySummary = originalGetDailySummary;
}
```

**Apply:** Add direct PATCH/DELETE tests for recompute failure, recovery failure, and publisher failure. Assert committed HTTP `200`, `summaryOutcome`, and compatibility `dailySummary` projection.

---

### `tests/integration/chat-api.test.ts` (test, request-response)

**Analog:** `tests/integration/chat-api.test.ts`

**Summary failure injection pattern** (lines 1368-1421):
```typescript
services.summaryService.getDailySummary = async () => {
  throw new Error("summary recomputation failed after persistence");
};
mockLLM.queueChatResponse({
  toolCalls: [{ function: { name: "log_food", arguments: JSON.stringify({ food_name: "雞腿便當", calories: 620 }) } }],
});

const res = await fetch(`${address}/api/chat`, {
  method: "POST",
  headers: { cookie: sessionCookieHeader },
  body: form,
});

assert.equal(res.status, 200);
const body = await res.json() as {
  reply: string;
  didLogMeal: boolean;
  didMutateMeal?: boolean;
  loggedMeal?: { mealId?: string; foodName?: string };
  dailySummary?: { mealCount?: number; totalCalories?: number; totalProtein?: number; date?: string };
};
assert.equal(body.didLogMeal, true);
assert.equal(body.didMutateMeal, true);
assert.equal(body.dailySummary?.mealCount, 1);
```

**Publish freshness boundary pattern** (lines 1494-1545, 2343-2398):
```typescript
const sseRes = await fetch(`${address}/api/sse`, { headers: { cookie: sessionCookieHeader } });
assert.equal(sseRes.status, 200);

const res = await fetch(`${address}/api/chat`, {
  method: "POST",
  headers: { cookie: sessionCookieHeader, Accept: "text/event-stream" },
  body: form,
});
const chatDoneEvent = await readUntilEventCount(chatReader, "done", 1);
const dailySummaryEvent = await dailySummaryPromise;

assert.ok(dailySummaryEvent.observedAt >= chatDoneEvent.observedAt);
const donePayload = JSON.parse(doneFrame.data) as { didLogMeal: boolean; dailySummary?: { mealCount: number } };
assert.equal(donePayload.didLogMeal, true);
```

**Apply:** Extend JSON tests for `summaryOutcome.recovered` and `.unavailable` across log/update/delete. Keep publish failure assertions separate from `summaryOutcome`.

---

### `tests/integration/chat-streaming.test.ts` (test, streaming)

**Analog:** `tests/integration/chat-streaming.test.ts`

**SSE summary failure pattern** (lines 3025-3066):
```typescript
services.summaryService.getDailySummary = async () => {
  throw new Error("summary recomputation failed after persistence");
};
mockLLM.queueRoundResponse({ toolCalls: [createTrustedLogFoodToolCall()] });

const res = await fetch(`${address}/api/chat`, {
  method: "POST",
  headers: { cookie: sessionCookieHeader, "Accept": "text/event-stream" },
  signal: controller.signal,
  body: form,
});

const text = await readStreamUntil(reader, "event: done");
const donePayload = JSON.parse(doneMatch[1]) as {
  didLogMeal?: boolean;
  didMutateMeal?: boolean;
  loggedMeal?: { mealId?: string; foodName?: string };
  dailySummary?: { mealCount?: number; totalCalories?: number; totalProtein?: number; date?: string };
};
assert.equal(donePayload.didLogMeal, true);
assert.equal(donePayload.didMutateMeal, true);
assert.equal(donePayload.dailySummary?.mealCount, 1);
```

**Fallback terminal payload pattern** (lines 3072-3101, 3172-3204):
```typescript
const donePayload = JSON.parse(doneMatch[1]) as { didLogMeal?: boolean; dailySummary?: { date?: string } };
assert.equal(donePayload.didLogMeal, true, "stream failure after log_food must preserve didLogMeal");
assert.ok(donePayload.dailySummary, "stream failure after log_food must preserve dailySummary");

const groupedPayload = JSON.parse(doneMatch[1]) as {
  didLogMeal?: boolean;
  dailySummary?: { mealCount?: number; totalCalories?: number; date?: string };
  loggedMeal?: { itemCount?: number; foodName?: string };
};
assert.equal(groupedPayload.didLogMeal, true);
assert.equal(groupedPayload.loggedMeal?.itemCount, 3);
```

**Apply:** Add `summaryOutcome` assertions to `done` and `stopped` payloads. For unavailable outcome, assert no top-level `dailySummary`.

---

### `tests/unit/api-client.test.ts` (test, request-response + streaming)

**Analog:** `tests/unit/api-client.test.ts`

**Mock fetch pattern** (lines 16-27):
```typescript
const originalFetch = globalThis.fetch;
let fetchCalls: Array<{ url: string; init: RequestInit }> = [];

function mockFetch(status: number, body: unknown) {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    fetchCalls.push({ url, init: init ?? {} });
    return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
  }) as typeof fetch;
}
```

**Direct mutation test pattern** (lines 632-661):
```typescript
mockFetch(200, {
  affectedDate: "2026-03-25",
  dailySummary: {
    date: "2026-03-25",
    totalCalories: 0,
    totalProtein: 0,
    totalCarbs: 0,
    totalFat: 0,
    mealCount: 0,
  },
});

const result = await api.deleteMeal("meal-1");

assert.deepEqual(result, { affectedDate: "2026-03-25", dailySummary: { mealCount: 0, /* ... */ } });
assert.equal(fetchCalls[0].url, "/api/meals/meal-1");
assert.equal(fetchCalls[0].init.method, "DELETE");
```

**Apply:** Add mocked responses for `summaryOutcome.fresh`, `.recovered`, and `.unavailable`. Assert unavailable does not throw and has no top-level `dailySummary`.

---

### `tests/unit/meal-edit-screen.test.ts` (test, component source contract)

**Analog:** `tests/unit/meal-edit-screen.test.ts`

**Source scan test pattern** (lines 1-14, 40-55):
```typescript
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

async function readSource(relativePath: string) {
  return readFile(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

const source = await readSource("../../client/src/components/MealEditScreen.tsx");

it("saves and deletes through canonical meal mutation helpers", () => {
  for (const expected of [
    "updateMeal",
    "deleteMeal",
    "setDailySummary",
    "redactChatReceiptIdentity",
    "recordMealMutation",
  ]) {
    assert.match(source, escapedPattern(expected));
  }
});
```

**Apply:** Update or add source-contract checks proving mutation commit UI side effects do not require `dailySummary`, while `setDailySummary` remains guarded by a usable summary.

---

## Shared Patterns

### Authentication And Ownership

**Source:** `server/routes/meals.ts` lines 109-120 and `server/routes/chat.ts` imports line 27

**Apply to:** `server/routes/meals.ts`, `server/routes/chat.ts`, direct mutation tests

```typescript
const session = await resolveGuestSession(request, { deviceService, guestSessionService });
if (!session.ok) {
  if (session.clearCookies) {
    reply.header("set-cookie", guestSessionService.clearSessionCookies());
  }
  return reply.code(401).send({ error: session.error });
}
const { deviceId } = session;
if (session.setCookies) {
  reply.header("set-cookie", session.setCookies);
}
```

### Post-Commit Authority

**Source:** `server/orchestrator/tools.ts` lines 1039-1059; `server/services/meal-transactions.ts` lines 275-303 and 332-387

**Apply to:** all meal log/update/delete paths

```typescript
const loggedMeal = await deps.foodLoggingService.logGroupedMeal(deviceId, input);
// Persist before summary recompute.
try {
  dailySummary = await deps.summaryService.getDailySummary(deviceId, buildLocalMidpointDate(dateKey));
} catch {
  dailySummary = await recoverDailySummaryFromPersistedMeals(deps, deviceId, dateKey);
}
```

### Metadata-Only Publish Failure

**Source:** `server/routes/chat.ts` lines 401-410

**Apply to:** direct routes and chat routes

```typescript
if (!didMutateMeal || !summaryDate || summaryDate !== formatLocalDate(currentAppDate())) return;
try {
  publisher.publishDailySummary(deviceId, dailySummary as DailySummary);
  log.info({ event: "summary_publish_success" }, "Summary publish success");
} catch (publishErr) {
  log.warn(
    { event: "summary_publish_failed", err: publishErr instanceof Error ? publishErr.message : String(publishErr) },
    "Summary publish failed (non-fatal)",
  );
}
```

### Compatibility Daily Summary Projection

**Source:** Phase 61 decisions D-05 through D-08 and existing projection in `server/routes/chat.ts` lines 1413-1422

**Apply to:** JSON chat, SSE `done` / `stopped`, direct PATCH/DELETE responses, client DTO parsing

```typescript
return {
  turnId,
  reply: sanitizedJson,
  didLogMeal,
  ...(result.didMutateMeal !== undefined ? { didMutateMeal: result.didMutateMeal } : {}),
  ...(jsonLoggedMealReceipt ? { loggedMeal: jsonLoggedMealReceipt } : {}),
  ...(dailySummary ? { dailySummary } : {}),
  ...(dailyTargets ? { dailyTargets } : {}),
  ...(affectedDate ? { affectedDate } : {}),
};
```

Planner should replace the `dailySummary` condition with `dailySummaryFromOutcome(summaryOutcome)` and add `summaryOutcome` unconditionally for committed meal mutation responses.

### Node Test And Real SQLite

**Source:** `tests/unit/tools.test.ts` lines 1-18; `tests/integration/meals-api.test.ts` lines 1-13

**Apply to:** all new/modified tests

```typescript
process.env.TZ = "Asia/Taipei";

import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../../server/app.js";
import { MockLLMProvider } from "../../server/llm/mock.js";
```

## No Analog Found

All expected files have a close analog in the current codebase. The only new file, `server/services/summary-outcome.ts`, should copy from existing log recovery and summary service patterns rather than inventing a new persistence or validation style.

## Metadata

**Analog search scope:** `server/services`, `server/routes`, `server/orchestrator`, `server/realtime`, `client/src`, `tests/unit`, `tests/integration`

**Files scanned:** 21 candidate implementation/test files plus project guidance and phase artifacts.

**Pattern extraction date:** 2026-05-17

**Project constraints applied:** explicit `.js` TypeScript imports, route/service/orchestrator boundaries, signed guest-session ownership, Node `node:test`, real SQLite tests, `TZ=Asia/Taipei`, `yarn` verification gates.
