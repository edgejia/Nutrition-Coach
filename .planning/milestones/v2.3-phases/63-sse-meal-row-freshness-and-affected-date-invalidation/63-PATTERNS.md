# Phase 63: SSE Meal-Row Freshness and Affected-Date Invalidation - Pattern Map

**Mapped:** 2026-05-18
**Files analyzed:** 21
**Analogs found:** 21 / 21

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `server/realtime/publisher.ts` | service / realtime publisher | event-driven fan-out | `server/realtime/publisher.ts` | exact |
| `server/routes/sse.ts` | route | streaming / request-response | `server/routes/sse.ts` | exact |
| `server/routes/chat.ts` | route | streaming + request-response | `server/routes/chat.ts` | exact |
| `server/routes/meals.ts` | route | CRUD / request-response + event fan-out | `server/routes/meals.ts` | exact |
| `client/src/types.ts` | model / DTO | transform | `client/src/types.ts` | exact |
| `client/src/sse.ts` | utility / transport | event-driven | `client/src/sse.ts` | exact |
| `client/src/sse-summary-coordinator.ts` | utility / coordinator | event-driven + request-response | `client/src/meal-edit-refresh.ts` | role-match |
| `client/src/lib/history-week.ts` | utility | transform / date parsing | `client/src/lib/history-week.ts` | exact |
| `client/src/store.ts` | store | event-driven state | `client/src/store.ts` | exact |
| `client/src/components/MainLayout.tsx` | component / provider shell | event-driven + request-response | `client/src/components/MainLayout.tsx` | exact |
| `client/src/components/HistoryScreen.tsx` | component | request-response + event-driven invalidation | `client/src/components/HistoryScreen.tsx` | exact |
| `client/src/components/HistoryDayDetailScreen.tsx` | component | request-response + visible refresh | `client/src/components/HistoryDayDetailScreen.tsx` | exact |
| `client/src/meal-edit-refresh.ts` | utility | request-response refresh | `client/src/meal-edit-refresh.ts` | exact |
| `tests/unit/sse-client.test.ts` | test | event-driven parser proof | `tests/unit/sse-client.test.ts` | exact |
| `tests/unit/sse-summary-coordinator.test.ts` | test | event-driven + async ordering proof | `tests/unit/sse-client.test.ts` | role-match |
| `tests/unit/store.test.ts` | test | event-driven state proof | `tests/unit/store.test.ts` | exact |
| `tests/unit/history-week.test.ts` | test | transform / date helper proof | `tests/unit/history-week.test.ts` | exact |
| `tests/unit/history-day-detail-source-contract.test.ts` | test | source contract UI proof | `tests/unit/history-day-detail-source-contract.test.ts` | exact |
| `tests/integration/sse.test.ts` | test | streaming realtime proof | `tests/integration/sse.test.ts` | exact |
| `tests/integration/meals-api.test.ts` | test | CRUD + SSE emission proof | `tests/integration/meals-api.test.ts` | exact |
| `tests/integration/chat-api.test.ts` | test | streaming / request-response publish proof | `tests/integration/chat-api.test.ts` | exact |

## Pattern Assignments

### `server/realtime/publisher.ts` (service / realtime publisher, event-driven fan-out)

**Analog:** `server/realtime/publisher.ts`

**Imports and event type boundary** (lines 1-3):
```typescript
import type { DailySummary } from "../services/summary.js";
import type { DailyTargets } from "../services/device.js";
import type { FastifyReply } from "fastify";
```

**Fan-out and stale reply cleanup pattern** (lines 27-47):
```typescript
private publish(deviceId: string, event: string, payload: unknown): { sent: number } {
  const replies = this.connections.get(deviceId) ?? [];
  const data = JSON.stringify(payload);
  const stale: FastifyReply[] = [];
  let sent = 0;
  for (const reply of replies) {
    if (reply.raw.destroyed) {
      stale.push(reply);
      continue;
    }
    try {
      reply.raw.write(`event: ${event}\ndata: ${data}\n\n`);
      sent += 1;
    } catch {
      stale.push(reply);
    }
  }
  for (const reply of stale) {
    this.unsubscribe(deviceId, reply);
  }
  return { sent };
}
```

**Publisher method to widen** (lines 50-52):
```typescript
publishDailySummary(deviceId: string, summary: DailySummary) {
  return this.publish(deviceId, "daily_summary", summary);
}
```

**Phase 63 application:** widen `publishDailySummary` to accept the strict envelope `{ summary, affectedDate, source }`. Keep `publish()` fan-out only: no summary service calls, no DB reads, no route-specific date logic.

---

### `server/routes/sse.ts` (route, streaming / request-response)

**Analog:** `server/routes/sse.ts`

**Imports and dependency injection pattern** (lines 1-9):
```typescript
import type { OutgoingHttpHeaders } from "node:http";
import type { FastifyInstance } from "fastify";
import type { RealtimePublisher } from "../realtime/publisher.js";
import type { createSummaryService } from "../services/summary.js";
import type { createDeviceService } from "../services/device.js";
import type { createGuestSessionService } from "../services/guest-session.js";
import { currentAppDate } from "../lib/time.js";
import { resolveGuestSession } from "../lib/guest-session-resolver.js";
import { logSseConnectionState } from "../observability/events.js";
```

**Cookie-backed guest-session guard** (lines 21-30):
```typescript
app.get("/api/sse", async (request, reply) => {
  const session = await resolveGuestSession(request, { deviceService, guestSessionService });
  if (!session.ok) {
    if (session.clearCookies) {
      reply.header("set-cookie", guestSessionService.clearSessionCookies());
    }
    logSseConnectionState(request.log, { state: "rejected" });
    return reply.code(401).send({ error: session.error });
  }
  const { deviceId } = session;
```

**Manual SSE response pattern** (lines 32-49):
```typescript
reply.hijack();
const headers: OutgoingHttpHeaders = {
  "content-type": "text/event-stream",
  "cache-control": "no-cache",
  connection: "keep-alive",
};
if (session.setCookies) {
  headers["set-cookie"] = [...session.setCookies];
}
reply.raw.writeHead(200, headers);

// Send initial daily summary
const summary = await summaryService.getDailySummary(deviceId, currentAppDate());
reply.raw.write(`event: daily_summary\ndata: ${JSON.stringify(summary)}\n\n`);

// Subscribe for future updates
publisher.subscribe(deviceId, reply);
```

**Cleanup pattern** (lines 52-62):
```typescript
const keepalive = setInterval(() => {
  reply.raw.write(": keepalive\n\n");
}, 30000);

request.raw.on("close", () => {
  clearInterval(keepalive);
  publisher.unsubscribe(deviceId, reply);
  logSseConnectionState(request.log, { state: "closed" });
});
```

**Phase 63 application:** keep auth, headers, keepalive, and cleanup unchanged. Replace raw `summary` frame data with `{ summary, affectedDate: summary.date, source: "initial" }`.

---

### `server/routes/chat.ts` (route, streaming + request-response)

**Analog:** `server/routes/chat.ts`

**Imports and route dependency pattern** (lines 1-39):
```typescript
import { PassThrough } from "node:stream";
import { writeFile, mkdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { FastifyInstance, FastifyRequest, FastifyBaseLogger } from "fastify";
import type { createOrchestrator } from "../orchestrator/index.js";
import type { RealtimePublisher } from "../realtime/publisher.js";
import type { DailySummary } from "../services/summary.js";
import { currentAppDate, formatLocalDate } from "../lib/time.js";
import { resolveGuestSession } from "../lib/guest-session-resolver.js";
```

**Current summary publish helper to change** (lines 387-413):
```typescript
function publishSummarySafe(
  publisher: RealtimePublisher,
  deviceId: string,
  didMutateMeal: boolean,
  dailySummary: unknown,
  log: FastifyBaseLogger,
): void {
  const summaryDate = (
    dailySummary
    && typeof dailySummary === "object"
    && "date" in dailySummary
    && typeof (dailySummary as { date?: unknown }).date === "string"
  )
    ? (dailySummary as DailySummary).date
    : undefined;
  if (!didMutateMeal || !summaryDate || summaryDate !== formatLocalDate(currentAppDate())) return;
  try {
    publisher.publishDailySummary(deviceId, dailySummary as DailySummary);
    log.info({ event: "summary_publish_success" }, "Summary publish success");
  } catch (publishErr) {
    void publishErr;
    log.warn(
      { event: "summary_publish_failed", failureReason: "publisher_error" },
      "Summary publish failed (non-fatal)",
    );
  }
}
```

**Streaming terminal ordering to preserve** (lines 966-990):
```typescript
const doneData = {
  turnId: stopControl.turnId,
  didLogMeal: streamDidLogMeal,
  didMutateMeal: streamDidMutateMeal,
  ...(streamLoggedMealReceipt ? { loggedMeal: streamLoggedMealReceipt } : {}),
  ...(streamDailySummary ? { dailySummary: streamDailySummary } : {}),
  ...(streamSummaryOutcome ? { summaryOutcome: streamSummaryOutcome } : {}),
  ...(streamDailyTargets ? { dailyTargets: streamDailyTargets } : {}),
  ...(streamAffectedDate ? { affectedDate: streamAffectedDate } : {}),
};
stream.write(`event: done\ndata: ${JSON.stringify(doneData)}\n\n`);
...
publishSummarySafe(deps.publisher, deviceId, streamDidMutateMeal, streamDailySummary, deps.log);
```

**JSON path publish boundary** (lines 1403-1405):
```typescript
// D-03/C6: JSON path publish boundary — immediately before reply.send().
// C1: try/catch ensures publish failure never changes the HTTP response or status code.
publishSummarySafe(publisher, deviceId, jsonDidMutateMeal, dailySummary, turnLog);
```

**Phase 63 application:** add `affectedDate` to `publishSummarySafe`, require `dailySummary.date === affectedDate`, and publish `{ summary: dailySummary, affectedDate, source: "meal_mutation" }`. Remove the today-only gate. Keep publish calls after `done` on streaming paths and immediately before return/send on JSON paths.

---

### `server/routes/meals.ts` (route, CRUD / request-response + event fan-out)

**Analog:** `server/routes/meals.ts`

**Imports and route dependency pattern** (lines 1-16):
```typescript
import type { FastifyBaseLogger, FastifyInstance, FastifyReply } from "fastify";
import { buildAssetUrl, parseAssetRef } from "../services/assets.js";
import type { createFoodLoggingService } from "../services/food-logging.js";
import { MealRevisionPreconditionError } from "../services/meal-transactions.js";
import type { createSummaryService, DailySummary } from "../services/summary.js";
import type { createDeviceService } from "../services/device.js";
import type { createGuestSessionService } from "../services/guest-session.js";
import type { createAssetService } from "../services/assets.js";
import type { RealtimePublisher } from "../realtime/publisher.js";
import { currentAppDate, formatLocalDate } from "../lib/time.js";
import { resolveGuestSession } from "../lib/guest-session-resolver.js";
import {
  buildSummaryOutcomeAfterMealCommit,
  dailySummaryFromOutcome,
  type SummaryOutcome,
} from "../services/summary-outcome.js";
```

**Current publish helper to change** (lines 99-124):
```typescript
function publishDailySummarySafe(input: {
  publisher: RealtimePublisher;
  deviceId: string;
  dailySummary: DailySummary | undefined;
  summaryOutcome: SummaryOutcome;
  affectedDate: string;
  log: FastifyBaseLogger;
}): void {
  const { publisher, deviceId, dailySummary, summaryOutcome, affectedDate, log } = input;
  if (!dailySummary || dailySummary.date !== formatLocalDate(currentAppDate())) {
    return;
  }

  try {
    publisher.publishDailySummary(deviceId, dailySummary);
```

**PATCH affected-date recompute + publish pattern** (lines 221-246):
```typescript
affectedDateKey = formatLocalDate(new Date(updatedMeal.loggedAt));
...
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

**DELETE affected-date recompute + publish pattern** (lines 287-314):
```typescript
const deleted = await foodLoggingService.deleteMeal(deviceId, id, expectedMealRevisionId);
affectedDateKey = deleted.affectedDateKey;
deletedMealId = deleted.transactionId;
...
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

**Phase 63 application:** remove the today-only guard, but keep the summary availability guard. Publish only when `dailySummary` exists and `dailySummary.date === affectedDate`; use source `"meal_mutation"`.

---

### `client/src/types.ts` (model / DTO, transform)

**Analog:** `client/src/types.ts`

**SSE payload type placement pattern** (lines 30-52):
```typescript
export interface DailyTargets {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

export interface GoalsUpdatePayload {
  targets: DailyTargets;
}

export interface DailySummary {
  date: string;
  totalCalories: number;
  totalProtein: number;
  totalCarbs: number;
  totalFat: number;
  mealCount: number;
}
```

**Mutation response DTO pattern** (lines 113-125):
```typescript
export interface UpdateMealResponse {
  affectedDate: string;
  dailySummary?: DailySummary;
  summaryOutcome?: SummaryOutcome;
  meal: MealEntry;
}

export interface DeleteMealResponse {
  affectedDate: string;
  dailySummary?: DailySummary;
  summaryOutcome?: SummaryOutcome;
  deletedMealId?: string;
}
```

**Phase 63 application:** add `DailySummarySSEPayload` near `GoalsUpdatePayload` / `DailySummary`:
```typescript
export type DailySummarySSESource = "initial" | "meal_mutation";
export interface DailySummarySSEPayload {
  summary: DailySummary;
  affectedDate: string;
  source: DailySummarySSESource;
}
```

---

### `client/src/sse.ts` (utility / transport, event-driven)

**Analog:** `client/src/sse.ts`

**Current handler type to widen** (lines 1-8):
```typescript
import type { DailySummary, DailyTargets, GoalsUpdatePayload } from "./types.js";

let eventSource: EventSource | null = null;

export interface SSEHandlers {
  onSummary: (summary: DailySummary) => void;
  onGoalsUpdate: (targets: DailyTargets) => void;
}
```

**Goals update validation precedent** (lines 10-23):
```typescript
function isValidTargets(value: unknown): value is DailyTargets {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.calories === "number" && Number.isFinite(obj.calories) &&
    typeof obj.protein === "number" && Number.isFinite(obj.protein) &&
    typeof obj.carbs === "number" && Number.isFinite(obj.carbs) &&
    typeof obj.fat === "number" && Number.isFinite(obj.fat)
  );
}
```

**Daily summary parser to replace** (lines 29-32):
```typescript
eventSource.addEventListener("daily_summary", (event) => {
  const summary = JSON.parse((event as MessageEvent<string>).data) as DailySummary;
  handlers.onSummary(summary);
});
```

**Silent malformed-frame pattern** (lines 39-49):
```typescript
eventSource.addEventListener("goals_update", (event) => {
  try {
    const raw = (event as MessageEvent<string>).data;
    const parsed = JSON.parse(raw) as GoalsUpdatePayload;
    if (parsed && typeof parsed === "object" && isValidTargets(parsed.targets)) {
      handlers.onGoalsUpdate(parsed.targets);
    }
  } catch {
    // Malformed JSON from server or a spoofed frame: ignore without
    // propagating into the EventSource dispatcher.
  }
});
```

**Phase 63 application:** implement `isDailySummarySSEPayload` with recursive `DailySummary` validation, real date-key validation, source literal validation, and `summary.date === affectedDate`. On malformed frames, catch and silently ignore exactly like `goals_update`.

---

### `client/src/sse-summary-coordinator.ts` (utility / coordinator, event-driven + request-response)

**Analog:** `client/src/meal-edit-refresh.ts`

**Direct mutation refresh primitive to compare against** (lines 3-10, 18-37):
```typescript
interface RefreshAfterMealMutationDeps<Meal> {
  redactChatReceiptIdentity: (mealId: string) => void;
  recordMealMutation: (affectedDate: string) => void;
  setDailySummary: (dailySummary: DailySummary) => void;
  getMeals: (options: { refreshReason: "meal_mutation" }) => Promise<{ meals: Meal[] }>;
  setMeals: (meals: Meal[]) => void;
  todayKey: () => string;
}

export async function refreshAfterMealMutation<Meal>(
  deps: RefreshAfterMealMutationDeps<Meal>,
  input: RefreshAfterMealMutationInput,
) {
  const today = deps.todayKey();

  deps.redactChatReceiptIdentity(input.mealId);
  deps.recordMealMutation(input.affectedDate);

  if (input.dailySummary?.date === today) {
    deps.setDailySummary(input.dailySummary);
  }

  if (input.affectedDate !== today) {
    return;
  }

  const { meals } = await deps.getMeals({ refreshReason: "meal_mutation" });
  deps.setMeals(meals);
}
```

**History latest-wins cancellation analog** (from `client/src/components/HistoryScreen.tsx`, lines 449-481):
```typescript
const loadSelectedDay = useCallback(
  (cancelledRef?: { current: boolean }) => {
    const requestDateKey = selectedDateKey;
    setLoadingDay(true);
    setDayError(null);
    return getHistoryDaySnapshot(requestDateKey)
      .then((response) => {
        if (!cancelledRef?.current) {
          setDayCache((cache) => {
            const next = new Map(cache);
            next.set(requestDateKey, response);
            return next;
          });
        }
      })
      ...
      .finally(() => {
        if (!cancelledRef?.current) setLoadingDay(false);
      });
  },
  [recoverGuestSession, selectedDateKey],
);
```

**Phase 63 application:** new coordinator should be lower-coupling than `meal-edit-refresh.ts`: no receipt redaction, no direct mutation behavior changes. It should own future-date ignore, same-day refetch-first, latest-token guards for SSE vs initial `getMeals()`, and historical `recordMealMutation(affectedDate)`.

---

### `client/src/lib/history-week.ts` (utility, transform / date parsing)

**Analog:** `client/src/lib/history-week.ts`

**Calendar-real date-key parser** (lines 63-85):
```typescript
const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseDateKey(dateKey: string): Date {
  const match = DATE_KEY_PATTERN.exec(dateKey);
  if (!match) {
    throw new Error("INVALID_DATE_KEY");
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    throw new Error("INVALID_DATE_KEY");
  }

  return date;
}
```

**Phase 63 application:** export a non-throwing `isRealDateKey` or equivalent shared helper, or mirror this exact round-trip logic in `client/src/sse.ts`. Tests should include impossible dates such as `2026-02-31`.

---

### `client/src/store.ts` (store, event-driven state)

**Analog:** `client/src/store.ts`

**State/actions to reuse** (lines 57-88):
```typescript
dailySummary: DailySummary | null;
meals: MealEntry[];
lastMealMutation: MealMutationNotice | null;
...
setMeals: (meals: MealEntry[]) => void;
recordMealMutation: (affectedDate: string) => void;
setDailySummary: (summary: DailySummary) => void;
setRolloverRefreshHandler: (handler: RolloverRefreshHandler | null) => void;
```

**Historical invalidation nonce** (lines 162-168):
```typescript
recordMealMutation: (affectedDate) =>
  set((state) => ({
    lastMealMutation: {
      affectedDate,
      nonce: (state.lastMealMutation?.nonce ?? 0) + 1,
    },
  })),
```

**Guarded same-day summary commit** (lines 262-282):
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
    // Intentionally suppressed — handler errors must not reach the caller.
  }
},
```

**Phase 63 application:** keep `store.ts` as commit boundary. Do not move SSE orchestration into the store. Use `setDailySummary` only after same-day routing/refetch succeeds; use `recordMealMutation` for valid non-future historical events only.

---

### `client/src/components/MainLayout.tsx` (component / provider shell, event-driven + request-response)

**Analog:** `client/src/components/MainLayout.tsx`

**Imports and shell wiring** (lines 1-5):
```typescript
import { useCallback, useEffect, useLayoutEffect, type ReactNode } from "react";
import { useStore } from "../store.js";
import { getMeals } from "../api.js";
import { connectSSE, disconnectSSE } from "../sse.js";
import { useDailyRollover } from "../useDailyRollover.js";
```

**Rollover reconnect call site** (lines 126-140):
```typescript
const refreshForRollover = useCallback(async () => {
  if (!deviceId) return;
  disconnectSSE();
  connectSSE(deviceId, { onSummary: setDailySummary, onGoalsUpdate: setDailyTargets });
  try {
    const { meals } = await getMeals({ refreshReason: "day_rollover" });
    setMeals(meals);
  } catch (err) {
    if (err instanceof Error && err.message === "UNAUTHORIZED") {
      void recoverGuestSession();
    }
  }
}, [deviceId, setDailySummary, setDailyTargets, setMeals, recoverGuestSession]);
```

**Initial row load and normal SSE subscription call sites** (lines 142-160):
```typescript
useEffect(() => {
  if (!deviceId) return;
  getMeals()
    .then(({ meals }) => setMeals(meals))
    .catch((err) => {
      if (err instanceof Error && err.message === "UNAUTHORIZED") {
        void recoverGuestSession();
      }
    });
}, [deviceId, setMeals, recoverGuestSession]);

useEffect(() => {
  if (!deviceId) return;
  connectSSE(deviceId, { onSummary: setDailySummary, onGoalsUpdate: setDailyTargets });
  return () => disconnectSSE();
}, [deviceId, setDailySummary, setDailyTargets]);
```

**Phase 63 application:** both `connectSSE` call sites must pass the coordinator handler, not raw `setDailySummary`. The initial `getMeals()` path must also go through the same latest-token family so stale initial rows cannot overwrite fresher SSE reconcile rows.

---

### `client/src/components/HistoryScreen.tsx` (component, request-response + event-driven invalidation)

**Analog:** `client/src/components/HistoryScreen.tsx`

**Imports and local helpers** (lines 1-17):
```typescript
import { useCallback, useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { getHistoryDaySnapshot, getHistoryTrends } from "../api.js";
import {
  buildHistoryWeek,
  buildHistoryWeekStats,
  getHistorySportStatusMeta,
  getMondayWeekStart,
  selectSameWeekdayOrClosestAvailable,
  shiftHistoryWeek,
} from "../lib/history-week.js";
import { formatLocalDate } from "../lib/time.js";
import { useStore } from "../store.js";
import type { HistoryDaySnapshot, HistoryTrendResponse, MealEntry } from "../types.js";
```

**Request cancellation pattern** (lines 420-447):
```typescript
const loadTrends = useCallback(
  (cancelledRef?: { current: boolean }) => {
    const requestWeekStartKey = weekStartKey;
    const requestWeekEndKey = weekEndKey;
    setLoadingTrends(true);
    setTrendError(null);
    return getHistoryTrends(requestWeekStartKey, requestWeekEndKey)
      .then((response) => {
        if (!cancelledRef?.current) {
          setTrendsCache((cache) => {
            const next = new Map(cache);
            next.set(requestWeekStartKey, response);
            return next;
          });
        }
      })
```

**Existing historical invalidation pattern** (lines 500-536):
```typescript
useEffect(() => {
  if (!lastMealMutation) {
    return;
  }

  const affectedDate = lastMealMutation.affectedDate;
  const affectedWeekStartKey = getMondayWeekStart(affectedDate);
  setDayCache((cache) => {
    const next = new Map(cache);
    if (affectedDate !== selectedDateKey) {
      next.delete(affectedDate);
    }
    return next;
  });
  setTrendsCache((cache) => {
    const next = new Map(cache);
    if (affectedWeekStartKey !== weekStartKey) {
      next.delete(affectedWeekStartKey);
    }
    return next;
  });

  const shouldRefreshDay = affectedDate === selectedDateKey;
  const shouldRefreshWeek = affectedWeekStartKey === weekStartKey;
  if (!shouldRefreshDay && !shouldRefreshWeek) {
    return;
  }

  const cancelledRef = { current: false };
  void Promise.all([
    shouldRefreshDay ? loadSelectedDay(cancelledRef) : Promise.resolve(),
    shouldRefreshWeek ? loadTrends(cancelledRef) : Promise.resolve(),
  ]);
  return () => {
    cancelledRef.current = true;
  };
}, [lastMealMutation, loadSelectedDay, loadTrends, selectedDateKey, weekStartKey]);
```

**Phase 63 application:** preserve selected-day/current-week gating. Historical SSE invalidation should use this existing path by calling `recordMealMutation(affectedDate)`; do not refresh merely because History tab exists.

---

### `client/src/components/HistoryDayDetailScreen.tsx` (component, request-response + visible refresh)

**Analog:** `client/src/components/HistoryDayDetailScreen.tsx`

**Imports and state boundary** (lines 1-9):
```typescript
import { useEffect, useMemo, useRef, useState } from "react";
import { getHistoryDaySnapshot } from "../api.js";
import { getHistoryCalorieStatus, getHistorySportStatusMeta } from "../lib/history-week.js";
import { formatLocalDate } from "../lib/time.js";
import { useStore } from "../store.js";
import type { HistoryDaySnapshot, MealEntry } from "../types.js";
```

**Current date-key load pattern** (lines 120-143):
```typescript
useEffect(() => {
  let cancelled = false;
  setLoading(true);
  setError(null);
  setSnapshot(null);

  getHistoryDaySnapshot(dateKey)
    .then((nextSnapshot) => {
      if (!cancelled) setSnapshot(nextSnapshot);
    })
    .catch((err: unknown) => {
      if (err instanceof Error && err.message === "UNAUTHORIZED") {
        void recoverGuestSession();
      }
      if (!cancelled) setError("當日詳情暫時載入失敗。請稍後再試。");
    })
    .finally(() => {
      if (!cancelled) setLoading(false);
    });

  return () => {
    cancelled = true;
  };
}, [dateKey, recoverGuestSession]);
```

**Related same-surface invalidation analog** (from `client/src/components/SummaryDetailScreen.tsx`, lines 446-482):
```typescript
useEffect(() => {
  if (!lastMealMutation || lastMealMutation.affectedDate !== selectedDateKey) {
    return;
  }

  let cancelled = false;
  setLoading(true);
  setError(null);

  getDaySnapshot(selectedDateKey)
    .then((nextSnapshot) => {
      if (!cancelled) {
        setSnapshot(nextSnapshot);
      }
    })
    ...
  return () => {
    cancelled = true;
  };
}, [lastMealMutation?.affectedDate, lastMealMutation?.nonce, selectedDateKey, recoverGuestSession]);
```

**Phase 63 application:** subscribe to `lastMealMutation`; refresh only when the open Day Detail `dateKey` equals `lastMealMutation.affectedDate`. Use the same cancellation/latest-wins shape and existing loading/error copy.

---

## Test Pattern Assignments

### `tests/unit/sse-client.test.ts` (test, event-driven parser proof)

**Analog:** `tests/unit/sse-client.test.ts`

**Fake EventSource harness** (lines 1-18, 43-60):
```typescript
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import type { DailySummary, DailyTargets } from "../../client/src/types.js";

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  public url: string;
  public listeners = new Map<string, FakeEventHandler[]>();
  public onerror: (() => void) | null = null;
  public closed = false;
  ...
  emit(type: string, data: string) {
    const handlers = this.listeners.get(type) ?? [];
    const event = { data } as MessageEvent<string>;
    for (const handler of handlers) {
      handler(event);
    }
  }
}

(globalThis as { EventSource?: unknown }).EventSource = FakeEventSource;
const sse = await import("../../client/src/sse.js");
```

**Current daily summary test to replace** (lines 72-98):
```typescript
it("fake EventSource daily_summary event still calls the summary callback", () => {
  const receivedSummaries: DailySummary[] = [];
  ...
  es.emit("daily_summary", JSON.stringify(summary));

  assert.equal(receivedSummaries.length, 1);
  assert.deepEqual(receivedSummaries[0], summary);
});
```

**Malformed silent-ignore precedent** (lines 125-167):
```typescript
assert.doesNotThrow(() => es.emit("goals_update", "NOT_JSON"));
assert.doesNotThrow(() => es.emit("goals_update", JSON.stringify({})));
assert.doesNotThrow(() =>
  es.emit("goals_update", JSON.stringify({ targets: { calories: "1800" } })),
);
...
assert.equal(receivedTargets.length, 0);
```

**Phase 63 application:** update the happy path to send the envelope and assert `onSummary` receives the envelope. Add malformed `daily_summary` tests mirroring `goals_update`: bad JSON, missing `summary`, invalid `source`, impossible date, non-finite macro, and `summary.date !== affectedDate`.

---

### `tests/unit/sse-summary-coordinator.test.ts` (test, event-driven + async ordering proof)

**Analogs:** `tests/unit/sse-client.test.ts`, `tests/unit/store.test.ts`

**Store test setup pattern** (from `tests/unit/store.test.ts`, lines 4-18):
```typescript
const storage = new Map<string, string>();
globalThis.localStorage = {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => { storage.set(key, value); },
  removeItem: (key: string) => { storage.delete(key); },
  clear: () => { storage.clear(); },
  get length() { return storage.size; },
  key: (index: number) => [...storage.keys()][index] ?? null,
} as Storage;

const { useStore } = await import("../../client/src/store.js");
const { formatLocalDate } = await import("../../client/src/lib/time.js");
```

**Nonce proof pattern** (from `tests/unit/store.test.ts`, lines 298-306):
```typescript
it("recordMealMutation tracks affected date with a monotonic nonce", () => {
  useStore.getState().recordMealMutation("2026-04-30");
  const first = useStore.getState().lastMealMutation;
  useStore.getState().recordMealMutation("2026-04-30");
  const second = useStore.getState().lastMealMutation;

  assert.deepEqual(first, { affectedDate: "2026-04-30", nonce: 1 });
  assert.deepEqual(second, { affectedDate: "2026-04-30", nonce: 2 });
});
```

**Phase 63 application:** test the coordinator directly with fake `getMeals`, `setMeals`, `setDailySummary`, `recordMealMutation`, and `todayKey` deps. Required cases: same-day `meal_mutation` refetches rows before summary commit, refetch failure commits neither, future date commits nothing, historical date calls only `recordMealMutation`, overlapping tokens drop older results, and initial row-load result cannot overwrite a newer reconcile result.

---

### `tests/integration/sse.test.ts` (test, streaming realtime proof)

**Analog:** `tests/integration/sse.test.ts`

**SSE frame parser and reader helpers** (lines 27-39, 81-102):
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

async function readSSEFrame(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  expectedEvent: string,
  maxReads = 20,
): Promise<SSEFrame> {
  ...
}
```

**Initial frame assertion to update** (lines 198-200):
```typescript
const frame = await readSSEFrame(reader, "daily_summary");
assert.match(frame.data, /"date":"\d{4}-\d{2}-\d{2}"/);
await waitForSseState(logLines, "opened");
```

**Post-mutation frame assertion to update** (lines 281-285):
```typescript
const secondChunk = await reader.read();
const text = new TextDecoder().decode(secondChunk.value);
assert.match(text, /event: daily_summary/);
assert.match(text, /"date":"\d{4}-\d{2}-\d{2}"/);
```

**Phase 63 application:** parse `frame.data` as JSON and assert `payload.source`, `payload.affectedDate`, `payload.summary.date`, and `payload.summary.date === payload.affectedDate` instead of regex-only raw summary assertions.

---

### `tests/integration/meals-api.test.ts` (test, CRUD + SSE emission proof)

**Analog:** `tests/integration/meals-api.test.ts`

**Fixture and real-app setup pattern** (lines 1-14, 33-55):
```typescript
process.env.TZ = "Asia/Taipei";

import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../../server/app.js";
import type { AppServices } from "../../server/app.js";
import { formatLocalDate } from "../../server/lib/time.js";
import { MockLLMProvider } from "../../server/llm/mock.js";

beforeEach(async () => {
  mockLLM = new MockLLMProvider();
  tempRoot = await mkdtemp(path.join(tmpdir(), "nutrition-meals-api-"));
  ...
  app = await buildApp({
    dbPath: ":memory:",
    llmProvider: mockLLM,
    uploadsDir,
    assetsDir,
    onServicesReady: (readyServices) => {
      services = readyServices;
    },
  });
```

**Historical recompute proof** (lines 1234-1271):
```typescript
it("DELETE /api/meals/:id recomputes the deleted transaction's affected local day", async () => {
  ...
  services.summaryService.getDailySummary = async (summaryDeviceId, date) => {
    requestedDates.push(formatLocalDate(date));
    return originalGetDailySummary(summaryDeviceId, date);
  };
  ...
  assert.deepEqual(
    requestedDates,
    [formatLocalDate(new Date(loggedAt))],
    "delete should recompute the affected local day, not today",
  );
});
```

**Current historical no-event test to invert** (lines 1274-1335):
```typescript
it("DELETE /api/meals/:id does not publish historical recomputes into the today SSE loop", async () => {
  ...
  const extraChunk = await readOptionalSSEChunk(reader, 250);
  assert.ok(
    extraChunk === null || !extraChunk.includes("event: daily_summary"),
    `historical delete must not emit a today SSE summary, got ${extraChunk ?? "<none>"}`,
  );
});
```

**Phase 63 application:** replace the no-event assertion with an expected historical `daily_summary` envelope: `source: "meal_mutation"`, `affectedDate: "2026-03-25"`, `summary.date: "2026-03-25"`, `mealCount: 0`. The test name should reflect "publishes historical affected-date envelope without today semantics".

---

### `tests/integration/chat-api.test.ts` (test, streaming / request-response publish proof)

**Analog:** `tests/integration/chat-api.test.ts`

**Publish failure stays non-fatal** (lines 2306-2349):
```typescript
it("POST /api/chat JSON keeps publish failure out of summaryOutcome", async () => {
  assert.ok(services, "expected app services");
  services.publisher.publishDailySummary = () => {
    throw new Error("publish failed after committed log");
  };
  ...
  assert.equal(res.status, 200);
  ...
  assertFreshSummaryOutcome(body.summaryOutcome);
  assert.ok(body.dailySummary);
  assertNoPublishFailurePayload(body);
});
```

**SSE ordering proof to preserve** (lines 2724-2780):
```typescript
it("D-03: daily_summary SSE push arrives on /api/sse AFTER done event is emitted on chat stream", async () => {
  ...
  await readUntilEventCount(sseReader, "daily_summary", 1);
  const dailySummaryPromise = readUntilEventCount(sseReader, "daily_summary", 1);
  ...
  const chatDoneEvent = await readUntilEventCount(chatReader, "done", 1);
  const dailySummaryEvent = await dailySummaryPromise;

  assert.ok(
    dailySummaryEvent.observedAt >= chatDoneEvent.observedAt,
    `daily_summary observed at ${dailySummaryEvent.observedAt}, before chat done at ${chatDoneEvent.observedAt}`,
  );
```

**Phase 63 application:** update publisher stubs to accept the envelope. Extend the ordering test to parse the second `daily_summary` data and assert `source: "meal_mutation"`, matching `affectedDate`, and nested `summary`.

---

### `tests/unit/history-week.test.ts` (test, transform / date helper proof)

**Analog:** `tests/unit/history-week.test.ts`

**Import and helper test pattern** (lines 1-12):
```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildHistoryWeek,
  buildHistoryWeekStats,
  getHistoryCalorieStatus,
  getHistorySportStatusMeta,
  getMondayWeekStart,
  selectSameWeekdayOrClosestAvailable,
  shiftHistoryWeek,
} from "../../client/src/lib/history-week.js";
```

**Date-key behavior style** (lines 15-22):
```typescript
it("returns the Monday start for a date key", () => {
  assert.equal(getMondayWeekStart("2026-04-30"), "2026-04-27");
});

it("shifts week starts by whole weeks", () => {
  assert.equal(shiftHistoryWeek("2026-04-27", -1), "2026-04-20");
  assert.equal(shiftHistoryWeek("2026-04-27", 1), "2026-05-04");
});
```

**Phase 63 application:** if exporting `isRealDateKey`, add focused tests here for valid date, wrong shape, impossible date, and leap-day behavior.

---

### `tests/unit/history-day-detail-source-contract.test.ts` (test, source contract UI proof)

**Analog:** `tests/unit/history-day-detail-source-contract.test.ts`

**Source-scan pattern** (lines 1-20):
```typescript
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

function sourcePath(relativePath: string) {
  return fileURLToPath(new URL(relativePath, import.meta.url));
}

async function readSource(relativePath: string) {
  return readFile(sourcePath(relativePath), "utf8");
}
...
const [dayDetail] = await Promise.all([readSource("../../client/src/components/HistoryDayDetailScreen.tsx")]);
```

**Phase 63 application:** add a source contract assertion only if no behavioral component test is practical. It should prove `HistoryDayDetailScreen` reads `lastMealMutation` and refreshes only when `lastMealMutation.affectedDate === dateKey`.

## Shared Patterns

### ESM Imports
**Source:** all touched TypeScript files
**Apply to:** every new/modified local import
```typescript
import { connectSSE, disconnectSSE } from "../sse.js";
import { resolveGuestSession } from "../lib/guest-session-resolver.js";
```

### Cookie-Backed SSE Auth
**Source:** `server/routes/sse.ts` lines 21-30
**Apply to:** `/api/sse`; do not add raw `deviceId` query/header auth
```typescript
const session = await resolveGuestSession(request, { deviceService, guestSessionService });
if (!session.ok) {
  if (session.clearCookies) {
    reply.header("set-cookie", guestSessionService.clearSessionCookies());
  }
  logSseConnectionState(request.log, { state: "rejected" });
  return reply.code(401).send({ error: session.error });
}
```

### Publisher Is Fan-Out Only
**Source:** `server/realtime/publisher.ts` lines 27-47
**Apply to:** publisher changes and route publish helpers
```typescript
const data = JSON.stringify(payload);
...
reply.raw.write(`event: ${event}\ndata: ${data}\n\n`);
...
return { sent };
```

### Silent Transport Validation
**Source:** `client/src/sse.ts` lines 39-49
**Apply to:** `daily_summary` parser
```typescript
try {
  const raw = (event as MessageEvent<string>).data;
  const parsed = JSON.parse(raw) as GoalsUpdatePayload;
  if (parsed && typeof parsed === "object" && isValidTargets(parsed.targets)) {
    handlers.onGoalsUpdate(parsed.targets);
  }
} catch {
  // Malformed JSON from server or a spoofed frame: ignore without
  // propagating into the EventSource dispatcher.
}
```

### Historical Invalidation
**Source:** `client/src/store.ts` lines 162-168 and `client/src/components/HistoryScreen.tsx` lines 500-536
**Apply to:** valid non-future historical SSE events
```typescript
recordMealMutation: (affectedDate) =>
  set((state) => ({
    lastMealMutation: {
      affectedDate,
      nonce: (state.lastMealMutation?.nonce ?? 0) + 1,
    },
  })),
```

### Guarded Summary Commit
**Source:** `client/src/store.ts` lines 262-282
**Apply to:** same-day coordinator only after row refetch success
```typescript
if (summary.date === activeDate) {
  set({ dailySummary: summary });
  return;
}
```

### React Async Drop Pattern
**Source:** `client/src/components/HistoryScreen.tsx` lines 420-447 and `HistoryDayDetailScreen.tsx` lines 120-143
**Apply to:** visible historical refresh and Day Detail refresh
```typescript
const cancelledRef = { current: false };
void loadSelectedDay(cancelledRef);
return () => {
  cancelledRef.current = true;
};
```

### Node Test Stack
**Source:** `tests/unit/sse-client.test.ts` lines 1-3 and `tests/integration/sse.test.ts` lines 1-8
**Apply to:** all new/modified tests
```typescript
process.env.TZ = "Asia/Taipei";

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
```

## No Analog Found

No files are without usable analogs. `client/src/sse-summary-coordinator.ts` has no exact existing coordinator analog, but `client/src/meal-edit-refresh.ts`, `client/src/components/MainLayout.tsx`, and `client/src/components/HistoryScreen.tsx` provide enough concrete dependency-injection, refresh, and async-drop patterns for planning.

## Metadata

**Analog search scope:** `server/realtime`, `server/routes`, `client/src`, `tests/unit`, `tests/integration`
**Files scanned:** 21 primary files plus phase context/research/UI spec and local project skills
**Pattern extraction date:** 2026-05-18
