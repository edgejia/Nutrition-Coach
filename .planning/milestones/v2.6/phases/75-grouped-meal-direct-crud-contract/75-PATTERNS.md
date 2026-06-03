# Phase 75: Grouped Meal Direct CRUD Contract - Pattern Map

**Mapped:** 2026-06-03
**Files analyzed:** 6 likely new/modified files
**Analogs found:** 6 / 6

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `server/routes/meals.ts` | route/controller | request-response | `server/routes/meals.ts` current `PATCH /api/meals/:id` and `DELETE /api/meals/:id` | exact |
| `server/services/food-logging.ts` | service | CRUD / transform | `server/services/food-logging.ts` current `updateMeal()` and aggregate projection | exact |
| `server/services/meal-transactions.ts` | service | CRUD / transaction | `server/services/meal-transactions.ts` current `updateTransaction()` | exact |
| `tests/integration/meals-api.test.ts` | test | request-response / CRUD / realtime side effects | Existing PATCH/DELETE route tests in `tests/integration/meals-api.test.ts` | exact |
| `tests/unit/meal-transactions.test.ts` | test | CRUD / transaction | Existing update/revision tests in `tests/unit/meal-transactions.test.ts` | exact, optional |
| `client/src/types.ts` / `client/src/api.ts` | type + transport helper | request-response / transform | Current `UpdateMealInput`, `updateMeal()`, and read-path item normalization | role-match, optional |

## Pattern Assignments

### `server/routes/meals.ts` (route/controller, request-response)

**Analog:** `server/routes/meals.ts`

**Imports and dependency pattern** (lines 1-16, 18-25):
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
import { formatLocalDate } from "../lib/time.js";
import { resolveGuestSession } from "../lib/guest-session-resolver.js";
import {
  buildSummaryOutcomeAfterMealCommit,
  dailySummaryFromOutcome,
  type SummaryOutcome,
} from "../services/summary-outcome.js";
```

```typescript
interface Deps {
  foodLoggingService: ReturnType<typeof createFoodLoggingService>;
  summaryService: ReturnType<typeof createSummaryService>;
  deviceService: ReturnType<typeof createDeviceService>;
  guestSessionService: ReturnType<typeof createGuestSessionService>;
  assetService: ReturnType<typeof createAssetService>;
  publisher: RealtimePublisher;
}
```

**Validation/parser pattern to extend** (lines 37-77):
```typescript
function isFiniteNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function parseMealUpdateBody(body: unknown): MealUpdateBody | null {
  if (!body || typeof body !== "object") {
    return null;
  }

  const input = body as Record<string, unknown>;
  const foodName = typeof input.foodName === "string" ? input.foodName.trim() : "";
  const imageAssetId =
    typeof input.imageAssetId === "string" && input.imageAssetId.trim()
      ? input.imageAssetId.trim()
      : null;

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
```

**Auth/session pattern** (lines 172-183):
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
```

**Current scalar update and grouped rejection pattern to adapt** (lines 185-225):
```typescript
const update = parseMealUpdateBody(request.body);
if (!update) {
  return reply.code(400).send({ error: "Invalid meal update" });
}

const { id } = request.params as { id: string };
let affectedDateKey: string;
let updatedMeal: Awaited<ReturnType<typeof foodLoggingService.updateMeal>>;
try {
  const mutationGuard = await foodLoggingService.getMealMutationGuard(
    deviceId,
    id,
    update.expectedMealRevisionId,
  );
  if (mutationGuard.itemCount > 1) {
    return reply.code(409).send({
      error: "MEAL_REQUIRES_GROUPED_UPDATE",
      message: "Grouped meals must be corrected through chat.",
    });
  }

  updatedMeal = await foodLoggingService.updateMeal(deviceId, id, {
    expectedMealRevisionId: update.expectedMealRevisionId,
    imagePath: update.imageAssetId ? `asset:${update.imageAssetId}` : null,
    items: [
      {
        foodName: update.foodName,
        calories: update.calories,
        protein: update.protein,
        carbs: update.carbs,
        fat: update.fat,
      },
    ],
  });
```

Planner note: keep scalar-on-grouped rejection, but bypass it for valid `items[]` replacement. Grouped writes should map public `name` to service `foodName` before calling `foodLoggingService.updateMeal()`.

**Revision conflict pattern** (lines 90-97, 227-234):
```typescript
function sendMealRevisionConflict(reply: FastifyReply, error: MealRevisionPreconditionError) {
  return reply.code(409).send({
    error: error.code,
    mealId: error.mealId,
    affectedDate: error.affectedDate,
    currentMealRevisionId: error.currentMealRevisionId,
  });
}
```

```typescript
} catch (error) {
  if (error instanceof Error && error.message === "MEAL_NOT_FOUND") {
    return reply.code(404).send({ error: "Meal not found" });
  }
  if (error instanceof MealRevisionPreconditionError) {
    return sendMealRevisionConflict(reply, error);
  }
  throw error;
}
```

**Summary and realtime publish pattern** (lines 237-251):
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

**Response shape pattern** (lines 253-272):
```typescript
const imageAssetId = parseAssetRef(updatedMeal.imagePath);
return {
  affectedDate: affectedDateKey,
  summaryOutcome,
  ...(dailySummary ? { dailySummary } : {}),
  meal: {
    id: updatedMeal.id,
    mealRevisionId: updatedMeal.mealRevisionId,
    foodName: updatedMeal.foodName,
    itemCount: updatedMeal.itemCount ?? 1,
    calories: updatedMeal.calories,
    protein: updatedMeal.protein,
    carbs: updatedMeal.carbs,
    fat: updatedMeal.fat,
    imageAssetId,
    imageUrl: imageAssetId ? buildAssetUrl(imageAssetId) : null,
    loggedAt: updatedMeal.loggedAt,
    ...(updatedMeal.mealPeriod ? { mealPeriod: updatedMeal.mealPeriod } : {}),
  },
};
```

---

### `server/services/food-logging.ts` (service, CRUD / transform)

**Analog:** `server/services/food-logging.ts`

**Imports and type boundary** (lines 2-15, 43-47):
```typescript
import { and, eq, isNull } from "drizzle-orm";
import type { AppDatabase } from "../db/client.js";
import {
  mealRevisionItems,
  mealTransactions,
} from "../db/schema.js";
import {
  createMealTransactionsService,
  type CreateMealTransactionInput,
  type MealTransactionItemInput,
} from "./meal-transactions.js";
import type { MealPeriod } from "../lib/meal-period.js";
import { createMealHistoryService } from "./meal-history.js";
import { projectMealDisplay } from "./meal-display.js";
```

```typescript
export interface GroupedMealData extends CreateMealTransactionInput {}

export interface GroupedMealUpdateData extends GroupedMealData {
  expectedMealRevisionId?: string | null;
}
```

**Aggregate compatibility projection** (lines 53-78):
```typescript
function projectCompatibilityEntry(
  deviceId: string,
  transactionId: string,
  revisionId: string,
  loggedAt: string,
  mealPeriod: MealPeriod | null,
  imagePath: string | null | undefined,
  items: MealTransactionItemInput[],
): MealCompatibilityEntry {
  const display = projectMealDisplay(items);

  return {
    id: transactionId,
    mealRevisionId: revisionId,
    deviceId,
    foodName: display.foodName,
    itemCount: display.itemCount,
    calories: items.reduce((sum, item) => sum + item.calories, 0),
    protein: items.reduce((sum, item) => sum + item.protein, 0),
    carbs: items.reduce((sum, item) => sum + item.carbs, 0),
    fat: items.reduce((sum, item) => sum + item.fat, 0),
    imagePath: imagePath ?? null,
    loggedAt,
    mealPeriod,
  };
}
```

**Service wrapper pattern** (lines 137-138, 165-175):
```typescript
async getMealMutationGuard(deviceId: string, mealId: string, expectedMealRevisionId?: string | null) {
  return mealTransactionsService.getMealMutationGuard(deviceId, mealId, expectedMealRevisionId);
},
```

```typescript
async updateMeal(deviceId: string, mealId: string, input: GroupedMealUpdateData) {
  const updated = await mealTransactionsService.updateTransaction(deviceId, mealId, input);
  return projectCompatibilityEntry(
    deviceId,
    updated.transactionId,
    updated.revisionId,
    updated.loggedAt,
    updated.mealPeriod,
    updated.imageAssetId ? `asset:${updated.imageAssetId}` : null,
    updated.items,
  );
},
```

Planner note: this file likely needs no behavior change unless the route needs a narrower helper. Prefer passing grouped item arrays through the existing `GroupedMealUpdateData` contract.

---

### `server/services/meal-transactions.ts` (service, CRUD / transaction)

**Analog:** `server/services/meal-transactions.ts`

**Imports and item/update contracts** (lines 1-13, 15-21, 57-71):
```typescript
import { and, asc, eq, isNull } from "drizzle-orm";
import type { AppDatabase } from "../db/client.js";
import {
  assetReferences,
  assets,
  mealRevisionItems,
  mealRevisions,
  mealTransactions,
} from "../db/schema.js";
import { parseAssetRef } from "./assets.js";
import { normalizeMealPeriod, type MealPeriod } from "../lib/meal-period.js";
import { formatLocalDate } from "../lib/time.js";
import { projectMealDisplay } from "./meal-display.js";
```

```typescript
export interface MealTransactionItemInput {
  foodName: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}
```

```typescript
export interface MealTransactionUpdateInput {
  expectedMealRevisionId?: string | null;
  imagePath?: string | null;
  items: MealTransactionItemInput[];
}
```

**Existing item normalization boundary** (lines 120-132):
```typescript
function normalizeItems(items: MealTransactionItemInput[]) {
  if (items.length === 0) {
    throw new Error("MEAL_ITEMS_REQUIRED");
  }

  return items.map((item) => ({
    foodName: item.foodName,
    calories: item.calories,
    protein: item.protein,
    carbs: item.carbs,
    fat: item.fat,
  }));
}
```

**Revision precondition pattern** (lines 229-253):
```typescript
function assertExpectedMealRevision(
  existing: MealRevisionAssertionTarget,
  expectedMealRevisionId: string | null | undefined,
) {
  const expected = typeof expectedMealRevisionId === "string" ? expectedMealRevisionId.trim() : "";
  const affectedDate = formatLocalDate(new Date(existing.loggedAt));

  if (!expected) {
    throw new MealRevisionPreconditionError({
      code: "MEAL_REVISION_REQUIRED",
      mealId: existing.id,
      affectedDate,
      currentMealRevisionId: existing.currentRevisionId,
    });
  }

  if (expected !== existing.currentRevisionId) {
    throw new MealRevisionPreconditionError({
      code: "MEAL_REVISION_STALE",
      mealId: existing.id,
      affectedDate,
      currentMealRevisionId: existing.currentRevisionId,
    });
  }
}
```

**Mutation guard pattern** (lines 303-340):
```typescript
async getMealMutationGuard(
  deviceId: string,
  transactionId: string,
  expectedMealRevisionId?: string | null,
): Promise<MealMutationGuard> {
  const existing = db.$client
    .prepare(
      `
        SELECT
          mt.id,
          mt.logged_at AS loggedAt,
          mt.current_revision_id AS currentRevisionId,
          mt.current_revision_number AS currentRevisionNumber,
          mt.deleted_at AS deletedAt,
          mt.created_at AS createdAt,
          COUNT(mri.revision_id) AS itemCount
        FROM meal_transactions AS mt INDEXED BY meal_tx_device_id_id_idx
        LEFT JOIN meal_revision_items AS mri
          ON mri.revision_id = mt.current_revision_id
        WHERE mt.device_id = ? AND mt.id = ?
        GROUP BY mt.id, mt.logged_at, mt.current_revision_id, mt.current_revision_number, mt.deleted_at, mt.created_at
        LIMIT 1
      `,
    )
    .get(deviceId, transactionId) as (MealTransactionRow & { itemCount: number }) | undefined;
```

**Full-list revision update transaction** (lines 492-593):
```typescript
async updateTransaction(
  deviceId: string,
  transactionId: string,
  input: MealTransactionUpdateInput,
): Promise<MealTransactionUpdateResult> {
  const items = normalizeItems(input.items);
  const createdAt = new Date().toISOString();
  const explicitImageAssetId = parseAssetRef(input.imagePath);

  return db.transaction((tx) => {
    const existing = getTransactionByDeviceAndIdFromReader(tx, deviceId, transactionId);

    if (!existing) {
      throw new Error("MEAL_NOT_FOUND");
    }
    assertMutableExpectedRevision(existing, input.expectedMealRevisionId);

    const revisionNumber = existing.currentRevisionNumber + 1;
    const revisionId = `${existing.id}:r${revisionNumber}`;
    const currentRevision = tx
      .select({
        imageAssetId: mealRevisions.imageAssetId,
      })
      .from(mealRevisions)
      .where(eq(mealRevisions.id, existing.currentRevisionId))
      .limit(1)
      .get();
    const imageAssetId = explicitImageAssetId ?? currentRevision?.imageAssetId ?? null;
```

```typescript
tx.insert(mealRevisionItems)
  .values(
    items.map((item, position) => ({
      revisionId,
      position,
      foodName: item.foodName,
      calories: item.calories,
      protein: item.protein,
      carbs: item.carbs,
      fat: item.fat,
    })),
  )
  .run();
```

Planner note: this already performs complete ordered list replacement and image preservation. Do not add stable item IDs, sorting, dedupe, or partial operations.

---

### `tests/integration/meals-api.test.ts` (test, request-response / CRUD / side effects)

**Analog:** `tests/integration/meals-api.test.ts`

**Imports and real app fixture pattern** (lines 1-14, 33-55):
```typescript
process.env.TZ = "Asia/Taipei";

import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../server/app.js";
import type { AppServices } from "../../server/app.js";
import { formatLocalDate } from "../../server/lib/time.js";
import { MockLLMProvider } from "../../server/llm/mock.js";
```

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
  deviceId = deviceRes.json().deviceId;
  deviceCookieHeader = toCookieHeader(deviceRes.headers["set-cookie"]);
```

**Successful PATCH + summary/publish assertion pattern** (lines 375-424):
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
    expectedMealRevisionId: meal.mealRevisionId,
  },
});

assert.equal(updateRes.statusCode, 200);
const body = updateRes.json();
const affectedDate = formatLocalDate(new Date(meal.loggedAt));
assert.equal(body.affectedDate, affectedDate);
assert.equal(body.dailySummary.totalCalories, 260);
assert.deepEqual(body.summaryOutcome, {
  status: "fresh",
  dailySummary: body.dailySummary,
});
assert.equal(body.meal.foodName, "雞胸肉沙拉半份");
assert.equal(typeof body.meal.mealRevisionId, "string");
assert.notEqual(body.meal.mealRevisionId, meal.mealRevisionId);
assertNoPublishFailureFields(body);
assert.equal(publishedPayloads.length, 1);
assertMealMutationSummaryEnvelope(publishedPayloads[0], affectedDate);
```

**Missing/stale revision no-side-effect pattern** (lines 474-578):
```typescript
let summaryCalls = 0;
let publishCalls = 0;
const originalGetDailySummary = services.summaryService.getDailySummary.bind(services.summaryService);
const originalPublishDailySummary = services.publisher.publishDailySummary.bind(services.publisher);
services.summaryService.getDailySummary = async (...args) => {
  summaryCalls += 1;
  return originalGetDailySummary(...args);
};
services.publisher.publishDailySummary = (...args) => {
  publishCalls += 1;
  return originalPublishDailySummary(...args);
};
```

```typescript
assert.equal(stalePatch.statusCode, 409);
assert.deepEqual(stalePatch.json(), {
  error: "MEAL_REVISION_STALE",
  mealId: meal.id,
  affectedDate: formatLocalDate(new Date(meal.loggedAt)),
  currentMealRevisionId,
});
assertNoSummaryFields(stalePatch.json());
assert.equal(summaryCalls, 0);
assert.equal(publishCalls, 0);
```

**Grouped current-meal conflict ordering pattern** (lines 631-688):
```typescript
const groupedCurrentMeal = await services.foodLoggingService.updateMeal(deviceId, meal.id, {
  expectedMealRevisionId: meal.mealRevisionId,
  items: [
    { foodName: "雞腿", calories: 260, protein: 24, carbs: 0, fat: 12 },
    { foodName: "白飯", calories: 280, protein: 4, carbs: 62, fat: 0.5 },
  ],
});

const stalePatch = await app.inject({
  method: "PATCH",
  url: `/api/meals/${meal.id}`,
  headers: { cookie: deviceCookieHeader },
  payload: {
    foodName: "雞腿飯少飯",
    calories: 460,
    protein: 28,
    carbs: 42,
    fat: 12.5,
    imageAssetId: null,
    expectedMealRevisionId: meal.mealRevisionId,
  },
});

assert.equal(stalePatch.statusCode, 409);
assert.deepEqual(stalePatch.json(), {
  error: "MEAL_REVISION_STALE",
  mealId: meal.id,
  affectedDate: formatLocalDate(new Date(meal.loggedAt)),
  currentMealRevisionId: groupedCurrentMeal.mealRevisionId,
});
assertNoSummaryFields(stalePatch.json());
assert.equal(summaryCalls, 0);
assert.equal(publishCalls, 0);
```

**Current scalar-on-grouped rejection to update carefully** (lines 1106-1152):
```typescript
it("PATCH /api/meals/:id returns 409 MEAL_REQUIRES_GROUPED_UPDATE for grouped direct edits", async () => {
  assert.ok(services, "expected onServicesReady to capture app services");

  const meal = await services.foodLoggingService.logGroupedMeal(deviceId, {
    items: [
      { foodName: "雞腿", calories: 260, protein: 24, carbs: 0, fat: 12 },
      { foodName: "白飯", calories: 280, protein: 4, carbs: 62, fat: 0.5 },
    ],
  });
```

```typescript
assert.equal(updateRes.statusCode, 409);
assert.deepEqual(updateRes.json(), {
  error: "MEAL_REQUIRES_GROUPED_UPDATE",
  message: "Grouped meals must be corrected through chat.",
});
assertNoSummaryFields(updateRes.json());
assert.equal(summaryCalls, 0);
assert.equal(publishCalls, 0);
```

Planner note: keep this coverage for scalar payloads against grouped meals, but add new neighboring cases where `items[]` succeeds.

**Image metadata continuity proof pattern** (lines 1266-1314):
```typescript
const imageAsset = await createOwnedAsset(deviceId, "continuity.png");
const imageMeal = await services.foodLoggingService.logFood(deviceId, {
  foodName: "照片便當",
  calories: 640,
  protein: 32,
  carbs: 78,
  fat: 21,
  imagePath: `asset:${imageAsset.id}`,
});

const updateRes = await app.inject({
  method: "PATCH",
  url: `/api/meals/${imageMeal.id}`,
  headers: { cookie: deviceCookieHeader },
  payload: {
    foodName: "照片便當更新",
    calories: 660,
    protein: 34,
    carbs: 80,
    fat: 22,
    imageAssetId: imageAsset.id,
    expectedMealRevisionId: imageMeal.mealRevisionId,
  },
});
assert.equal(updateRes.statusCode, 200);
```

Planner note: Phase 75 grouped replacement should add an image-preservation assertion with `items[]` and no image input.

---

### `tests/unit/meal-transactions.test.ts` (test, CRUD / transaction)

**Analog:** `tests/unit/meal-transactions.test.ts`

**Imports and in-memory DB fixture** (lines 1-23, 61-73):
```typescript
process.env.TZ = "Asia/Taipei";

import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { createDb } from "../../server/db/client.js";
import {
  assetReferences,
  assets,
  mealRevisionItems,
  mealRevisions,
  mealTransactions,
} from "../../server/db/schema.js";
import {
  MealRevisionPreconditionError,
  createMealTransactionsService,
} from "../../server/services/meal-transactions.js";
```

```typescript
describe("MealTransactionsService", () => {
  let db: ReturnType<typeof createDb>;
  let mealTransactionsService: ReturnType<typeof createMealTransactionsService>;
  let deviceId: string;
  let foreignDeviceId: string;

  beforeEach(async () => {
    db = createDb(":memory:");
    const deviceService = createDeviceService(db);
    mealTransactionsService = createMealTransactionsService(db);
    deviceId = (await deviceService.createDevice("fat_loss")).deviceId;
    foreignDeviceId = (await deviceService.createDevice("muscle_gain")).deviceId;
  });
```

**Persisted item position assertion pattern** (lines 121-183):
```typescript
const items = await db.select().from(mealRevisionItems);

assert.equal(items.length, 1);
assert.equal(items[0]!.revisionId, revisions[0]!.id);
assert.equal(items[0]!.position, 0);
assert.equal(items[0]!.foodName, "蘋果");
assert.equal(items[0]!.calories, 95);
```

**Update revision identity pattern** (lines 409-452):
```typescript
const updated = await mealTransactionsService.updateTransaction(deviceId, created.transactionId, {
  expectedMealRevisionId: created.revisionId,
  items: [
    {
      foodName: "蘋果半顆",
      calories: 48,
      protein: 0.2,
      carbs: 12,
      fat: 0.1,
    },
  ],
});

const transaction = (
  await db
    .select()
    .from(mealTransactions)
    .where(eq(mealTransactions.id, created.transactionId))
)[0];
const revisions = await db
  .select()
  .from(mealRevisions)
  .where(eq(mealRevisions.transactionId, created.transactionId));

assert.ok(transaction);
assert.equal(revisions.length, 2);
assert.equal(updated.transactionId, created.transactionId);
assert.equal(updated.revisionId, transaction!.currentRevisionId);
assert.notEqual(updated.revisionId, created.revisionId);
```

**Precondition rollback pattern** (lines 493-539):
```typescript
const beforeMissing = await getTransactionState(created.transactionId);
await assert.rejects(
  () => mealTransactionsService.updateTransaction(deviceId, created.transactionId, updateInput),
  assertMealRevisionPrecondition("MEAL_REVISION_REQUIRED", created.transactionId, created.revisionId),
);
assert.deepEqual(await getTransactionState(created.transactionId), beforeMissing);

const updated = await mealTransactionsService.updateTransaction(deviceId, created.transactionId, {
  ...updateInput,
  expectedMealRevisionId: created.revisionId,
});

const beforeStale = await getTransactionState(created.transactionId);
await assert.rejects(
  () =>
    mealTransactionsService.updateTransaction(deviceId, created.transactionId, {
      ...updateInput,
      expectedMealRevisionId: created.revisionId,
    }),
  assertMealRevisionPrecondition("MEAL_REVISION_STALE", created.transactionId, updated.revisionId),
);
assert.deepEqual(await getTransactionState(created.transactionId), beforeStale);
```

Planner note: add unit tests only if integration tests cannot directly prove persisted item order/history/image preservation. If added, query `mealRevisionItems` ordered by `position` and assert the new revision's rows match submitted order.

---

### `client/src/types.ts` / `client/src/api.ts` (types + transport, request-response / transform, optional)

**Analog:** `client/src/types.ts` and `client/src/api.ts`

**Public item DTO type** (`client/src/types.ts` lines 69-76):
```typescript
export interface MealItemDetail {
  name: string;
  position: number;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}
```

**Current scalar write input** (`client/src/types.ts` lines 111-119):
```typescript
export interface UpdateMealInput {
  expectedMealRevisionId: string;
  foodName: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  imageAssetId?: string | null;
}
```

**Read-path tolerant item normalization to avoid copying for writes** (`client/src/api.ts` lines 85-132):
```typescript
function normalizeMealItems(value: unknown): MealItemDetail[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const items = value
    .map((item): MealItemDetail | null => {
      if (!isRecord(item)) {
        return null;
      }

      const nutrition = isRecord(item.nutrition) ? item.nutrition : item;
      const name = typeof item.name === "string" ? item.name.trim() : "";
      const position = item.position;
      const calories = nutrition.calories;
      const protein = nutrition.protein;
      const carbs = nutrition.carbs;
      const fat = nutrition.fat;
```

```typescript
    .filter((item): item is MealItemDetail => item !== null)
    .sort((a, b) => a.position - b.position);

  return items.length > 0 ? items : undefined;
}
```

**Transport error/conflict pattern** (`client/src/api.ts` lines 1095-1118):
```typescript
export async function updateMeal(mealId: string, input: UpdateMealInput): Promise<UpdateMealResponse> {
  const res = await fetch(`/api/meals/${encodeURIComponent(mealId)}`, {
    method: "PATCH",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (res.status === 401) throw new Error("UNAUTHORIZED");
  if (!res.ok) {
    const body = await readJsonSafe(res);
    const conflict = getMealRevisionConflictError(res.status, body);
    if (conflict) {
      throw conflict;
    }
    const errorMessage = getResponseErrorMessage(body);
    throw new Error(errorMessage ?? "Failed to update meal");
  }
  const body = await res.json() as UpdateMealResponse;
  const normalizedBody = normalizeSummaryOutcomeFields(body);
  return {
    ...normalizedBody,
    meal: normalizeMealEntry(normalizedBody.meal),
  };
}
```

Planner note: if Phase 75 touches client types, define a union for scalar vs grouped write input using `MealItemDetail[]`, but do not reuse `normalizeMealItems()` semantics for server writes. The server write parser must be strict and must reject nested `nutrition`, aliases, extra keys, and sorting.

## Shared Patterns

### Signed Guest Session
**Source:** `server/routes/meals.ts` lines 172-183
**Apply to:** `PATCH /api/meals/:id` grouped branch and any route test expectations
```typescript
const session = await resolveGuestSession(request, { deviceService, guestSessionService });
if (!session.ok) {
  if (session.clearCookies) {
    reply.header("set-cookie", guestSessionService.clearSessionCookies());
  }
  return reply.code(401).send({ error: session.error });
}
const { deviceId } = session;
```

### Simple Validation Failure Body
**Source:** `server/routes/meals.ts` lines 185-188
**Apply to:** malformed scalar or grouped write payloads
```typescript
const update = parseMealUpdateBody(request.body);
if (!update) {
  return reply.code(400).send({ error: "Invalid meal update" });
}
```

### Structured Revision Conflicts
**Source:** `server/routes/meals.ts` lines 90-97 and `server/services/meal-transactions.ts` lines 229-253
**Apply to:** missing/stale `expectedMealRevisionId` for scalar and grouped writes
```typescript
return reply.code(409).send({
  error: error.code,
  mealId: error.mealId,
  affectedDate: error.affectedDate,
  currentMealRevisionId: error.currentMealRevisionId,
});
```

### Post-Commit Summary and Realtime Publish
**Source:** `server/routes/meals.ts` lines 237-251
**Apply to:** successful grouped replacement only, never validation/conflict branches
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

### Ordered Full-List Persistence
**Source:** `server/services/meal-transactions.ts` lines 555-567
**Apply to:** grouped replacement service call
```typescript
tx.insert(mealRevisionItems)
  .values(
    items.map((item, position) => ({
      revisionId,
      position,
      foodName: item.foodName,
      calories: item.calories,
      protein: item.protein,
      carbs: item.carbs,
      fat: item.fat,
    })),
  )
  .run();
```

### Integration Test Side-Effect Suppression
**Source:** `tests/integration/meals-api.test.ts` lines 485-496 and 569-578
**Apply to:** stale/missing revision, malformed grouped payloads, scalar-on-grouped rejection
```typescript
let summaryCalls = 0;
let publishCalls = 0;
services.summaryService.getDailySummary = async (...args) => {
  summaryCalls += 1;
  return originalGetDailySummary(...args);
};
services.publisher.publishDailySummary = (...args) => {
  publishCalls += 1;
  return originalPublishDailySummary(...args);
};
```

```typescript
assertNoSummaryFields(stalePatch.json());
assert.equal(summaryCalls, 0);
assert.equal(publishCalls, 0);
```

## No Analog Found

No Phase 75 surface lacks an analog. Avoid adding new files unless planning discovers a narrow helper is necessary.

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| none | - | - | Existing direct route, services, and tests cover the needed patterns. |

## Metadata

**Analog search scope:** `server/routes`, `server/services`, `tests/integration`, `tests/unit`, `client/src`
**Files scanned:** 100+ files via `rg --files`; 7 primary files read
**Pattern extraction date:** 2026-06-03
**Project constraints applied:** `AGENTS.md`; `.codex/skills/nutrition-gen-test/SKILL.md`; `.codex/skills/nutrition-verify-change/SKILL.md`; `.codex/skills/nutrition-code-review/SKILL.md`; `.codex/skills/nutrition-security-review/SKILL.md`
