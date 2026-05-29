# Phase 65: Tool Contract Alignment and Meal-Period Authority - Pattern Map

**Mapped:** 2026-05-27
**Files analyzed:** 43
**Analogs found:** 43 / 43

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `server/db/schema.ts` | model | CRUD | `server/db/schema.ts` | exact |
| `drizzle/0007_*.sql` | migration | CRUD | `drizzle/0005_chat_message_status.sql` | exact |
| `drizzle/meta/0007_snapshot.json` | migration | CRUD | `drizzle/meta/0006_snapshot.json` | exact |
| `drizzle/meta/_journal.json` | migration | CRUD | `drizzle/meta/_journal.json` | exact |
| `server/lib/meal-period.ts` | utility | transform | `server/lib/historical-date.ts`, `server/orchestrator/source-text-guard.ts` | role-match |
| `server/orchestrator/tools.ts` | service | request-response | `server/orchestrator/tools.ts` | exact |
| `server/orchestrator/system-prompt.ts` | config | transform | `server/orchestrator/system-prompt.ts` | exact |
| `server/services/meal-transactions.ts` | service | CRUD | `server/services/meal-transactions.ts` | exact |
| `server/services/food-logging.ts` | service | CRUD | `server/services/food-logging.ts` | exact |
| `server/services/meal-history.ts` | service | CRUD | `server/services/meal-history.ts` | exact |
| `server/services/history-query.ts` | service | CRUD | `server/services/history-query.ts` | exact |
| `server/services/chat.ts` | service | CRUD | `server/services/chat.ts` | exact |
| `server/routes/chat.ts` | route | streaming | `server/routes/chat.ts` | exact |
| `server/routes/meals.ts` | route | request-response | `server/routes/meals.ts` | exact |
| `server/routes/day-snapshot.ts` | route | request-response | `server/routes/day-snapshot.ts` | exact |
| `server/routes/history.ts` | route | request-response | `server/routes/history.ts` | exact |
| `server/services/meal-correction.ts` | service | CRUD | `server/services/meal-correction.ts` | exact |
| `client/src/types.ts` | model | transform | `client/src/types.ts` | exact |
| `client/src/api.ts` | utility | request-response | `client/src/api.ts` | exact |
| `client/src/meal-edit-payload.ts` | utility | transform | `client/src/meal-edit-payload.ts` | exact |
| `client/src/components/HomeScreen.tsx` | component | transform | `client/src/components/HomeScreen.tsx` | exact |
| `client/src/components/HistoryScreen.tsx` | component | transform | `client/src/components/HistoryScreen.tsx` | exact |
| `client/src/components/HistoryDayDetailScreen.tsx` | component | transform | `client/src/components/HistoryDayDetailScreen.tsx` | exact |
| `client/src/components/SummaryDetailScreen.tsx` | component | transform | `client/src/components/SummaryDetailScreen.tsx` | exact |
| `tests/unit/tools.test.ts` | test | request-response | `tests/unit/tools.test.ts` | exact |
| `tests/unit/tool-contract.test.ts` | test | request-response | `tests/unit/tools.test.ts` | role-match |
| `tests/unit/system-prompt.test.ts` | test | transform | `tests/unit/system-prompt.test.ts` | exact |
| `tests/unit/protein-trust.test.ts` | test | transform | `tests/unit/protein-trust.test.ts` | exact |
| `tests/unit/meal-transactions.test.ts` | test | CRUD | `tests/unit/meal-transactions.test.ts` | exact |
| `tests/unit/food-logging.test.ts` | test | CRUD | `tests/unit/food-logging.test.ts` | exact |
| `tests/unit/api-client.test.ts` | test | request-response | `tests/unit/api-client.test.ts` | exact |
| `tests/unit/home-dashboard-contract.test.ts` | test | transform | `tests/unit/home-dashboard-contract.test.ts` | exact |
| `tests/unit/history-screen-contract.test.ts` | test | transform | `tests/unit/home-dashboard-contract.test.ts` | role-match |
| `tests/unit/history-day-detail-screen.test.ts` | test | transform | `tests/unit/history-day-detail-screen.test.ts` | exact |
| `tests/unit/summary-detail-screen.test.ts` | test | transform | `tests/unit/summary-detail-screen.test.ts` | exact |
| `tests/unit/meal-edit-payload.test.ts` | test | transform | `tests/unit/meal-edit-payload.test.ts` | exact |
| `tests/unit/meal-correction.test.ts` | test | CRUD | `tests/unit/meal-correction.test.ts` | exact |
| `tests/integration/chat-api.test.ts` | test | request-response | `tests/integration/chat-api.test.ts` | exact |
| `tests/integration/chat-streaming.test.ts` | test | streaming | `tests/integration/chat-streaming.test.ts` | exact |
| `tests/integration/orchestrator.test.ts` | test | request-response | `tests/integration/orchestrator.test.ts` | exact |
| `tests/integration/meals-api.test.ts` | test | request-response | `tests/integration/meals-api.test.ts` | exact |
| `tests/integration/day-snapshot-api.test.ts` | test | request-response | `tests/integration/day-snapshot-api.test.ts` | exact |
| `tests/integration/history-api.test.ts` | test | request-response | `tests/integration/history-api.test.ts` | exact |

## Pattern Assignments

### `server/db/schema.ts` and `drizzle/0007_*.sql` (model/migration, CRUD)

**Analog:** `server/db/schema.ts`, `drizzle/0005_chat_message_status.sql`, `drizzle/meta/_journal.json`

**Imports and table pattern** (`server/db/schema.ts` lines 1-2, 64-86):
```typescript
import { desc, sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const mealTransactions = sqliteTable(
  "meal_transactions",
  {
    id: text("id").primaryKey(),
    deviceId: text("device_id")
      .notNull()
      .references(() => devices.id),
    loggedAt: text("logged_at").notNull(),
    currentRevisionId: text("current_revision_id").notNull(),
    currentRevisionNumber: integer("current_revision_number").notNull(),
    deletedAt: text("deleted_at"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("meal_tx_active_device_logged_at_idx")
      .on(table.deviceId, table.loggedAt)
      .where(sql`${table.deletedAt} is null`),
  ],
);
```

**Additive nullable migration pattern** (`drizzle/0005_chat_message_status.sql` line 1):
```sql
ALTER TABLE chat_messages ADD COLUMN status TEXT NOT NULL DEFAULT 'complete' CHECK (status IN ('complete','stopped','error'));
```

Apply as a nullable enum-like text column on `meal_transactions`; do not backfill inferred values. Let `drizzle-kit` generate `0007_*` and the snapshot, then verify the SQL is equivalent to:

```sql
ALTER TABLE meal_transactions ADD COLUMN meal_period TEXT CHECK (meal_period IN ('breakfast','lunch','dinner','late_night'));
```

**Journal pattern** (`drizzle/meta/_journal.json` lines 47-52):
```json
{
  "idx": 6,
  "version": "6",
  "when": 1777996719981,
  "tag": "0006_colossal_selene",
  "breakpoints": true
}
```

---

### `server/lib/meal-period.ts` (utility, transform)

**Analog:** `server/lib/historical-date.ts`, `server/orchestrator/source-text-guard.ts`

**Shared enum source** (`server/lib/historical-date.ts` lines 3-5):
```typescript
export type HistoricalIntentMode = "query" | "mutation";
export type HistoricalMealPeriod = "breakfast" | "lunch" | "dinner" | "late_night";
```

**Narrow source-text utility style** (`server/orchestrator/source-text-guard.ts` lines 20-28, 54-68):
```typescript
export interface SourceGuardContext {
  currentUserMessage: string;
  previousAssistantMessage?: string;
}

export interface SourceGuardResult {
  ok: boolean;
  guardedFields: string[];
}

function normalizeGoalProposalDecisionText(message: string): string {
  return message.trim().toLowerCase().replace(/\s+/g, "");
}

export function isGoalProposalConsent(message: string): boolean {
  const normalized = normalizeGoalProposalDecisionText(message);
  if (!normalized || isGoalProposalCancel(message)) return false;
  return GOAL_PROPOSAL_CONSENT_PATTERNS.some((pattern) => pattern.test(normalized));
}
```

For Phase 65, copy this small pure-helper style. Export `MealPeriod`, `normalizeMealPeriod`, and `extractExplicitMealPeriodFromSourceText`. Keep extraction narrower than the legacy midpoint helper: `早餐|早飯`, `午餐|午飯`, `晚餐|晚飯`, `宵夜`; do not persist `早上|中午|晚上|點心|下午茶` as explicit authority.

---

### `server/orchestrator/tools.ts` (service, request-response)

**Analog:** `server/orchestrator/tools.ts`

**Zod optional evidence pattern** (lines 345-408):
```typescript
const historicalMealPeriodSchema = z.enum(["breakfast", "lunch", "dinner", "late_night"]).optional();
const proteinSourceSchema = z
  .object({
    name: z.string().min(1, "protein_sources[].name must be non-empty"),
    protein: finiteNumber,
    is_primary: z.boolean(),
    certainty: z.enum(["clear", "uncertain"]),
  })
  .strict();

const logFoodSchema = z.union([
  logFoodItemSchema
    .extend({
      date_text: historicalDateTextSchema,
      meal_period: historicalMealPeriodSchema,
      protein_sources: z.array(proteinSourceSchema).min(1).optional(),
    })
    .strict(),
  z.object({
    items: z.array(logFoodItemSchema).min(1, "items must contain at least one entry"),
    date_text: historicalDateTextSchema,
    meal_period: historicalMealPeriodSchema,
    protein_sources: z.array(proteinSourceSchema).min(1).optional(),
  }).strict(),
]);
```

**JSON schema misalignment to fix** (lines 910-965):
```typescript
const logFoodContract: ToolContract<LogFoodArgs, LogFoodResult> = {
  name: "log_food",
  parameters: {
    type: "object",
    properties: {
      protein_sources: {
        type: "array",
        description: "Required. List visually identifiable protein-bearing ingredients; mark uncertain when estimated from an image.",
      },
      meal_period: {
        type: "string",
        enum: ["breakfast", "lunch", "dinner", "late_night"],
      },
      items: { type: "array" },
    },
    additionalProperties: false,
    required: ["protein_sources"],
  },
  zodSchema: logFoodSchema,
};
```

Remove `required: ["protein_sources"]` and change the description to conditional evidence. Do not make raw `protein_sources` authoritative.

**Historical loggedAt and source-text context pattern** (lines 976-1049):
```typescript
execute: async (args, context) => {
  const currentDate = currentAppDate();
  const dateIntent = resolveHistoricalDateIntent({
    input: args.date_text?.trim() || context.currentUserMessage,
    currentDate,
    mode: "mutation",
  });

  const loggedAt = dateIntent.isHistorical
    ? buildHistoricalLoggedAt({
        dateKey: dateIntent.dateKey,
        mealPeriod: args.meal_period ?? extractHistoricalMealPeriod(context.currentUserMessage),
      })
    : undefined;

  const normalized = normalizeLogFoodArgs(args, context.currentUserMessage);
  const loggedMeal = await deps.foodLoggingService.logGroupedMeal(deviceId, {
    imagePath: deps.imagePath,
    loggedAt,
    items: normalizedItems,
  });
}
```

Add explicit `mealPeriod` beside `loggedAt` in the service call, but derive it from `context.currentUserMessage`, not raw `args.meal_period`.

**Receipt projection pattern** (lines 875-889, 1061-1083, 1755-1777):
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

Extend this projection and `ToolExecutionResult["loggedMeal"]` with optional `mealPeriod`; update both log and update wrappers.

---

### `server/orchestrator/system-prompt.ts` (config, transform)

**Analog:** `server/orchestrator/system-prompt.ts`

**Prompt section registry pattern** (lines 71-84, 147-166):
```typescript
export const SYSTEM_PROMPT_SECTION_IDS = {
  proteinEstimation: "protein-estimation",
  logFoodReceipt: "log-food-receipt",
} as const;

sections.push({
  id: SYSTEM_PROMPT_SECTION_IDS.proteinEstimation,
  content: `蛋白質估算規則：
5. 當你呼叫 log_food 時，必須提供 protein_sources 陣列；每個來源都要帶 name、protein、is_primary、certainty。
6. 成功記錄後，最終回覆要依下方成功 log_food 回覆契約；只有符合條件時才用一句簡短繁體中文說明主要蛋白來源。`,
});
```

Change rule 5 to conditional: provide `protein_sources` only when credible anchors exist, omit when missing. Keep receipt rule D backend-owned: successful copy may mention sources only when backend-counted sources exist.

---

### `server/services/meal-transactions.ts` and `server/services/food-logging.ts` (services, CRUD)

**Analog:** `server/services/meal-transactions.ts`, `server/services/food-logging.ts`

**Input/result extension pattern** (`server/services/meal-transactions.ts` lines 22-34, 67-75):
```typescript
export interface CreateMealTransactionInput {
  loggedAt?: string;
  imagePath?: string | null;
  items: MealTransactionItemInput[];
}

export interface MealTransactionWriteResult {
  transactionId: string;
  revisionId: string;
  loggedAt: string;
  imagePath: string | null;
  items: MealTransactionItemInput[];
}

interface MealTransactionRow {
  id: string;
  deviceId: string;
  loggedAt: string;
  currentRevisionId: string;
  currentRevisionNumber: number;
  deletedAt: string | null;
  createdAt: string;
}
```

Add `mealPeriod?: MealPeriod | null` to create input and `mealPeriod: MealPeriod | null` to read/write result rows.

**Transaction insert pattern** (`server/services/meal-transactions.ts` lines 334-423):
```typescript
async createTransaction(deviceId: string, input: CreateMealTransactionInput): Promise<MealTransactionWriteResult> {
  const items = normalizeItems(input.items);
  const transactionId = crypto.randomUUID();
  const loggedAt = input.loggedAt ?? new Date().toISOString();
  const revisionNumber = 1;
  const revisionId = `${transactionId}:r${revisionNumber}`;
  const createdAt = new Date().toISOString();

  return db.transaction((tx) => {
    tx.insert(mealTransactions)
      .values({
        id: transactionId,
        deviceId,
        loggedAt,
        currentRevisionId: revisionId,
        currentRevisionNumber: revisionNumber,
        deletedAt: null,
        createdAt,
      })
      .run();
    return { transactionId, revisionId, loggedAt, imagePath, items };
  });
}
```

Set nullable `mealPeriod` only on transaction create. Ordinary update paths should preserve the header by not touching the column.

**Edit preservation pattern** (`server/services/meal-transactions.ts` lines 479-580):
```typescript
async updateTransaction(deviceId: string, transactionId: string, input: MealTransactionUpdateInput) {
  return db.transaction((tx) => {
    const existing = getTransactionByDeviceAndIdFromReader(tx, deviceId, transactionId);
    assertMutableExpectedRevision(existing, input.expectedMealRevisionId);

    tx.insert(mealRevisions).values({
      id: revisionId,
      transactionId: existing.id,
      revisionNumber,
      supersedesRevisionId: existing.currentRevisionId,
      imageAssetId,
      changeType: "update",
      createdAt,
    }).run();

    tx.update(mealTransactions)
      .set({
        currentRevisionId: revisionId,
        currentRevisionNumber: revisionNumber,
      })
      .where(and(
        eq(mealTransactions.id, existing.id),
        eq(mealTransactions.currentRevisionId, existing.currentRevisionId),
        isNull(mealTransactions.deletedAt),
      ))
      .run();

    return { transactionId: existing.id, revisionId, loggedAt: existing.loggedAt, items };
  });
}
```

Keep `mealPeriod` out of ordinary update `.set(...)`; return `existing.mealPeriod` so routes and receipts keep projecting it after numeric/name/image edits.

**Compatibility projection pattern** (`server/services/food-logging.ts` lines 26-38, 50-72, 101-110, 157-166):
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
    loggedAt,
  };
}
```

Add `mealPeriod` to `MealCompatibilityEntry` and pass it through `logFood`, `logGroupedMeal`, `getMealsByDate`, and `updateMeal`.

---

### DTO projection services and routes (request-response)

**Analogs:** `server/services/meal-history.ts`, `server/services/history-query.ts`, `server/services/chat.ts`, `server/routes/meals.ts`, `server/routes/day-snapshot.ts`, `server/routes/history.ts`, `server/routes/chat.ts`

**Current-day/day snapshot service projection** (`server/services/meal-history.ts` lines 29-45, 85-101):
```typescript
const headers = await db
  .select({
    id: mealTransactions.id,
    loggedAt: mealTransactions.loggedAt,
    currentRevisionId: mealTransactions.currentRevisionId,
  })
  .from(mealTransactions)
  .where(and(eq(mealTransactions.deviceId, deviceId), isNull(mealTransactions.deletedAt)));

return headers.map((header) => ({
  id: header.id,
  mealRevisionId: header.currentRevisionId,
  foodName: display.foodName,
  itemCount: display.itemCount,
  imagePath: revision?.imageAssetId ? makeAssetRef(revision.imageAssetId) : null,
  loggedAt: header.loggedAt,
}));
```

Select and return `mealTransactions.mealPeriod` here; this feeds `/api/meals` and `/api/day-snapshot`.

**History DTO projection** (`server/services/history-query.ts` lines 20-37, 351-438, 471-485):
```typescript
export interface HistoryMealDto {
  id: string;
  mealRevisionId: string;
  dateKey: string;
  loggedAt: string;
  display: { title: string };
  itemCount: number;
  nutrition: { calories: number; protein: number; carbs: number; fat: number };
  asset: { imageAssetId: string | null; imageUrl: string | null };
}

function projectHistoryMeals(db: AppDatabase, headers: HistoryMealHeader[]) {
  return headers.map((header) => ({
    id: header.id,
    mealRevisionId: header.currentRevisionId,
    dateKey: formatLocalDate(new Date(header.loggedAt)),
    loggedAt: header.loggedAt,
    display: { title: display.foodName },
    itemCount: display.itemCount,
  }));
}
```

Add explicit-only `mealPeriod?: MealPeriod` to `HistoryMealDto`, `HistoryMealHeader`, `projectHistoryMeals`, `getMeals`, `searchMeals`, and `getDaySnapshot`.

**Route auth and DTO pattern** (`server/routes/meals.ts` lines 133-168, 171-270):
```typescript
app.get("/api/meals", async (request, reply) => {
  const session = await resolveGuestSession(request, { deviceService, guestSessionService });
  if (!session.ok) {
    if (session.clearCookies) {
      reply.header("set-cookie", guestSessionService.clearSessionCookies());
    }
    return reply.code(401).send({ error: session.error });
  }

  const meals = await foodLoggingService.getMealsByDate(deviceId, new Date());
  return {
    meals: meals.map((meal) => ({
      id: meal.id,
      mealRevisionId: meal.mealRevisionId,
      foodName: meal.foodName,
      itemCount: meal.itemCount ?? 1,
      loggedAt: meal.loggedAt,
    })),
  };
});
```

Apply the same `mealPeriod` projection in `GET /api/meals`, `PATCH /api/meals/:id`, and `GET /api/day-snapshot` (`server/routes/day-snapshot.ts` lines 35-56). `server/routes/history.ts` already returns service DTOs directly for `/api/history/meals` and `/api/history/days/:date` (lines 179-186, 323-325), so update `history-query.ts` instead of duplicating route mapping.

**Chat receipt projection** (`server/routes/chat.ts` lines 430-495, 981-991, 1439-1449):
```typescript
function projectLoggedMealReceipt(loggedMeal: LoggedMealReceipt | undefined) {
  if (!loggedMeal) return undefined;
  const { mealId, dateKey, mealRevisionId, loggedAt, imageAssetId, imageUrl, foodName } = loggedMeal;
  return {
    ...(typeof mealId === "string" ? { mealId } : {}),
    ...(typeof dateKey === "string" ? { dateKey } : {}),
    ...(typeof mealRevisionId === "string" ? { mealRevisionId } : {}),
    ...(typeof loggedAt === "string" ? { loggedAt } : {}),
    ...(typeof imageAssetId === "string" || imageAssetId === null ? { imageAssetId } : {}),
    ...(typeof imageUrl === "string" || imageUrl === null ? { imageUrl } : {}),
    foodName,
    itemCount,
    calories,
    protein,
    carbs,
    fat,
  };
}

const doneData = {
  turnId: stopControl.turnId,
  didLogMeal: streamDidLogMeal,
  ...(streamLoggedMealReceipt ? { loggedMeal: streamLoggedMealReceipt } : {}),
};
```

Add `mealPeriod` to `projectLoggedMealReceipt` validation/projection so JSON, SSE `done`, SSE `stopped`, and chat history receipts all carry it.

**Stored chat receipt reconstruction** (`server/services/chat.ts` lines 63-142, 267-273):
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
  .innerJoin(mealTransactions, eq(mealTransactions.id, chatMealReceipts.mealTransactionId));

return {
  loggedAt: receipt.loggedAt,
  imageAssetId: receipt.imageAssetId ?? null,
  foodName: display.foodName,
  itemCount: display.itemCount,
};
```

Select and return `mealTransactions.mealPeriod` here so `loadHistory` receipts match live receipts.

---

### `server/services/meal-correction.ts` (service, CRUD)

**Analog:** `server/services/meal-correction.ts`

**Candidate type and inference pattern** (lines 28-41, 104-122):
```typescript
export interface MealCorrectionCandidate {
  mealId: string;
  mealRevisionId: string;
  foodName: string;
  loggedAt: string;
  dateKey: string;
  mealPeriod: "breakfast" | "lunch" | "dinner" | "late_night";
}

function inferMealPeriod(loggedAt: string): "breakfast" | "lunch" | "dinner" | "late_night" {
  const hour = new Date(loggedAt).getHours();
  if (hour < 11) return "breakfast";
  if (hour < 15) return "lunch";
  if (hour < 21) return "dinner";
  return "late_night";
}
```

Add `mealPeriodSource: "explicit" | "inferred"` while keeping `mealPeriod` as compatibility/effective value.

**Candidate load/projection pattern** (lines 342-390):
```typescript
const headers = await db
  .select({
    id: mealTransactions.id,
    loggedAt: mealTransactions.loggedAt,
    currentRevisionId: mealTransactions.currentRevisionId,
  })
  .from(mealTransactions)
  .where(and(eq(mealTransactions.deviceId, deviceId), isNull(mealTransactions.deletedAt)))
  .orderBy(asc(mealTransactions.loggedAt));

return limitedHeaders.map((header) => ({
  mealId: header.id,
  mealRevisionId: header.currentRevisionId,
  loggedAt: header.loggedAt,
  dateKey: formatLocalDate(new Date(header.loggedAt)),
  mealPeriod: inferMealPeriod(header.loggedAt),
}));
```

Select `mealTransactions.mealPeriod`. Project:

```typescript
const explicitMealPeriod = normalizeMealPeriod(header.mealPeriod);
mealPeriod: explicitMealPeriod ?? inferMealPeriod(header.loggedAt),
mealPeriodSource: explicitMealPeriod ? "explicit" : "inferred",
```

Do not change ranking, tie-breaking, label matching, clarification, or Phase 67 behavior beyond this fact projection.

---

### Client DTOs, normalizers, and edit payloads (transform/request-response)

**Analogs:** `client/src/types.ts`, `client/src/api.ts`, `client/src/meal-edit-payload.ts`

**Public type extension pattern** (`client/src/types.ts` lines 8-22, 76-105, 107-126):
```typescript
export interface MealEditPayload {
  mealId: string;
  mealRevisionId: string;
  dateKey: string;
  foodName: string;
  loggedAt?: string;
}

export interface LoggedMealReceipt {
  foodName: string;
  itemCount: number;
  mealId?: string;
  mealRevisionId?: string;
  dateKey?: string;
  loggedAt?: string;
}

export interface MealEntry {
  id: string;
  mealRevisionId?: string;
  foodName: string;
  itemCount: number;
  loggedAt: string;
}
```

Add `export type MealPeriod = "breakfast" | "lunch" | "dinner" | "late_night";` and optional `mealPeriod?: MealPeriod` to `MealEditPayload`, `LoggedMealReceipt`, `MealEntry`, and `UpdateMealInput` only if PATCH explicitly needs to carry a grounded correction. Do not add `inferredMealPeriod`.

**Normalizer guard pattern** (`client/src/api.ts` lines 63-119, 131-158, 420-430, 811-845):
```typescript
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isLoggedMealReceipt(value: unknown): value is LoggedMealReceipt {
  return isRecord(value)
    && typeof value.foodName === "string"
    && typeof value.calories === "number"
    && (value.imageUrl === undefined || value.imageUrl === null || typeof value.imageUrl === "string");
}

export function normalizeLoggedMealReceipt(receipt: LoggedMealReceipt): LoggedMealReceipt {
  const items = normalizeMealItems((receipt as { items?: unknown }).items);
  return {
    ...receipt,
    itemCount: normalizeItemCount(receipt.itemCount),
    ...(items ? { items } : {}),
    ...(receipt.imageUrl === undefined ? {} : { imageUrl: withAuthorizedAssetUrl(receipt.imageUrl) ?? null }),
  };
}

export function normalizeHistoryMeal(meal: HistoryMealDto): MealEntry {
  return {
    id: meal.id,
    foodName: meal.display?.title ?? meal.foodName ?? "未命名餐點",
    imageUrl: withAuthorizedAssetUrl(meal.asset?.imageUrl ?? meal.imageUrl ?? null) ?? null,
    loggedAt: meal.loggedAt,
  };
}
```

Add a small `normalizeMealPeriod(value: unknown): MealPeriod | undefined`; only preserve the four enum values and treat invalid values as absent. Thread it through `normalizeLoggedMealReceipt`, `getMeals`, `getDaySnapshot`, `normalizeHistoryMeal`, SSE done/stopped parsing, and `updateMeal` response normalization.

**Edit payload preservation pattern** (`client/src/meal-edit-payload.ts` lines 60-81, 84-115):
```typescript
export function buildHistoryMealEditPayload(meal: MealEntry, dateKey: string): MealEditPayload {
  const items = normalizeMealItems((meal as { items?: unknown }).items);
  return {
    mealId: meal.id,
    mealRevisionId: meal.mealRevisionId,
    dateKey,
    foodName: meal.foodName,
    ...(items ? { items } : {}),
    imageAssetId: meal.imageAssetId ?? null,
    imageUrl: meal.imageUrl ?? null,
    loggedAt: meal.loggedAt,
  };
}

export function buildReceiptMealEditPayload(loggedMeal: LoggedMealReceipt | undefined): MealEditPayload | null {
  return {
    mealId: loggedMeal.mealId,
    mealRevisionId: loggedMeal.mealRevisionId,
    dateKey: loggedMeal.dateKey,
    foodName: loggedMeal.foodName,
    loggedAt: loggedMeal.loggedAt,
  };
}
```

Copy `mealPeriod` from source row/receipt when present. Do not synthesize fallback labels into payloads.

---

### Client meal-period UI helpers and touched surfaces (component, transform)

**Analogs:** `client/src/components/HomeScreen.tsx`, `HistoryScreen.tsx`, `HistoryDayDetailScreen.tsx`, `SummaryDetailScreen.tsx`

**Central label/badge helper pattern** (`client/src/components/HomeScreen.tsx` lines 50-71, 195-212):
```typescript
export function getDisplayMealLabel(loggedAt?: string | null): "早餐" | "午餐" | "點心" | "晚餐" | "餐點" {
  if (!loggedAt) return "餐點";
  const date = new Date(loggedAt);
  if (Number.isNaN(date.getTime())) return "餐點";

  const hour = date.getHours();
  if (hour >= 5 && hour < 11) return "早餐";
  if (hour >= 11 && hour < 14) return "午餐";
  if (hour >= 14 && hour < 17) return "點心";
  if (hour >= 17 && hour < 23) return "晚餐";
  return "餐點";
}

export function getMealBadge(loggedAt?: string | null): "B" | "L" | "S" | "D" | "M" {
  switch (getDisplayMealLabel(loggedAt)) {
    case "早餐": return "B";
    case "午餐": return "L";
    case "點心": return "S";
    case "晚餐": return "D";
    default: return "M";
  }
}
```

Change signature to `getDisplayMealLabel(mealPeriod?: MealPeriod | null, loggedAt?: string | null)` and `getMealBadge(mealPeriod?: MealPeriod | null, loggedAt?: string | null)`. Explicit `late_night` maps to `宵夜` / `N`; missing/invalid falls back to existing loggedAt behavior including `點心` / `S`.

**Home row pattern** (`client/src/components/HomeScreen.tsx` lines 383-413):
```tsx
<article key={meal.id} className="home-sport-meal-row">
  <div className="home-sport-meal-meta">
    <span>{formatMealRowTime(meal.loggedAt)}</span>
    <span>{getDisplayMealLabel(meal.loggedAt)}</span>
    <span>{getMealBadge(meal.loggedAt)}</span>
  </div>
  <div className="home-sport-meal-title">{meal.foodName}</div>
  <div className="home-sport-meal-macros">{getMealMacroSummary(meal)}</div>
</article>
```

Pass `meal.mealPeriod` first in each helper call. Keep existing layout classes and metadata hierarchy.

**History row pattern** (`client/src/components/HistoryScreen.tsx` lines 267-304):
```tsx
<button
  type="button"
  className="sp-history-meal-row"
  aria-label={`編輯 ${meal.foodName}`}
>
  <span className="sp-history-meal-meta">
    {formatMealRowTime(meal.loggedAt)}
  </span>
  <span className="sp-history-meal-name">{meal.foodName}</span>
</button>
```

Change metadata to `HH:mm · {resolvedLabel}` and update `aria-label` to include the resolved label before food name.

**Day detail / summary detail patterns** (`HistoryDayDetailScreen.tsx` lines 73-80, `SummaryDetailScreen.tsx` lines 73-79 and 110-113):
```tsx
<div className="sp-history-detail-meal-time">
  {new Intl.DateTimeFormat("zh-TW", { hour: "2-digit", minute: "2-digit", hour12: false }).format(
    new Date(meal.loggedAt),
  )}
</div>

function formatSummaryTime(loggedAt: string) {
  return new Intl.DateTimeFormat("zh-TW", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(loggedAt));
}
```

Prefer reusing `formatMealRowTime` plus `getDisplayMealLabel` from `HomeScreen.tsx` instead of duplicating period logic.

---

### Tests (unit/integration)

**Analogs:** `tests/unit/tools.test.ts`, `tests/unit/meal-transactions.test.ts`, `tests/unit/home-dashboard-contract.test.ts`, `tests/unit/meal-edit-payload.test.ts`, `tests/unit/meal-correction.test.ts`, integration API tests.

**Node test + real SQLite pattern** (`tests/unit/tools.test.ts` lines 1-18, 46-52):
```typescript
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { createDb } from "../../server/db/client.js";
import { mealRevisionItems, mealRevisions, mealTransactions } from "../../server/db/schema.js";

beforeEach(async () => {
  db = createDb(":memory:");
  const deviceService = createDeviceService(db);
  foodLoggingService = createFoodLoggingService(db);
  summaryService = createSummaryService(db);
  deviceId = (await deviceService.createDevice("fat_loss")).deviceId;
});
```

**Tool contract and persistence proof pattern** (`tests/unit/tools.test.ts` lines 54-128, 271-314):
```typescript
const toolDefs = Object.fromEntries(
  getToolDefinitions().map((definition) => [definition.function.name, definition.function.parameters]),
) as Record<string, any>;

assert.ok(toolDefs.log_food.properties.protein_sources, "protein_sources must stay top-level");
assert.ok(toolDefs.log_food.properties.items, "items[] must remain accepted");
assert.equal(toolDefs.log_food.properties.items.items.properties.protein_sources, undefined);

const result = await executeTool(logFoodCall, deviceId, { foodLoggingService, summaryService });
assert.ok(result.loggedMeal, "loggedMeal must be returned");
assert.equal(result.loggedMeal.mealId, meals[0].id);
const transaction = (await db.select().from(mealTransactions).where(eq(mealTransactions.id, result.loggedMeal.mealId)))[0];
assert.equal(result.loggedMeal.mealRevisionId, transaction!.currentRevisionId);
```

Add tests proving JSON schema no longer requires `protein_sources`, Zod accepts omission, unsupported weak claims strip/normalize, and `午餐我吃了雞腿便當` stores/projects `mealPeriod: "lunch"` while `loggedAt` stays breakfast-hour.

**Transaction write/update preservation pattern** (`tests/unit/meal-transactions.test.ts` lines 26-32, 80-143):
```typescript
beforeEach(async () => {
  db = createDb(":memory:");
  const deviceService = createDeviceService(db);
  mealTransactionsService = createMealTransactionsService(db);
  deviceId = (await deviceService.createDevice("fat_loss")).deviceId;
});

const result = await mealTransactionsService.createTransaction(deviceId, {
  loggedAt: "2026-03-25T04:30:00.000Z",
  imagePath: "asset:asset-apple",
  items: [{ foodName: "蘋果", calories: 95, protein: 0.5, carbs: 25, fat: 0.3 }],
});

const transactions = await db.select().from(mealTransactions);
assert.equal(transactions[0]!.loggedAt, "2026-03-25T04:30:00.000Z");
assert.equal(transactions[0]!.currentRevisionNumber, 1);
```

Extend with `mealPeriod: "lunch"` create proof, update without `mealPeriod` preservation proof, and legacy null proof.

**Client helper contract test pattern** (`tests/unit/home-dashboard-contract.test.ts` lines 16-24, 34-42, 108-114):
```typescript
const {
  formatMealRowTime,
  getDisplayMealLabel,
  getMealBadge,
} = await import("../../client/src/components/HomeScreen.js");

it("derives display-only meal labels from loggedAt", () => {
  assert.equal(getDisplayMealLabel("2026-04-29T07:30:00+08:00"), "早餐");
  assert.equal(getDisplayMealLabel("2026-04-29T12:30:00+08:00"), "午餐");
  assert.equal(getDisplayMealLabel("not-a-date"), "餐點");
});

assert.equal(getMealBadge("2026-04-29T07:30:00+08:00"), "B");
assert.equal(getMealBadge("not-a-date"), "M");
```

Update assertions for explicit `mealPeriod` preference: `getDisplayMealLabel("lunch", "2026-04-29T07:30:00+08:00") === "午餐"` and `getMealBadge("late_night", "...") === "N"`. Keep legacy fallback tests.

**Edit payload contract test pattern** (`tests/unit/meal-edit-payload.test.ts` lines 74-112, 115-152):
```typescript
const payload = buildHistoryMealEditPayload({
  id: "meal-1",
  mealRevisionId: "meal-1:r1",
  foodName: "雞腿便當",
  imageAssetId: "asset-history",
  imageUrl: "/api/assets/asset-history",
  loggedAt: "2026-05-06T12:00:00.000+08:00",
} as any, "2026-05-06");

assert.deepEqual(payload, {
  mealId: "meal-1",
  mealRevisionId: "meal-1:r1",
  dateKey: "2026-05-06",
  foodName: "雞腿便當",
  imageAssetId: "asset-history",
  imageUrl: "/api/assets/asset-history",
  loggedAt: "2026-05-06T12:00:00.000+08:00",
});
```

Add `mealPeriod` to the input and expected payload for history rows and receipts. Add an invalid/missing normalizer case that omits `mealPeriod`.

**Candidate projection test pattern** (`tests/unit/meal-correction.test.ts` lines 57-69, 321-343):
```typescript
beforeEach(async () => {
  globalThis.Date = FixedDate as DateConstructor;
  db = createDb(":memory:");
  const deviceService = createDeviceService(db);
  foodLoggingService = createFoodLoggingService(db);
  mealCorrectionService = createMealCorrectionService(db);
  deviceId = (await deviceService.createDevice("fat_loss")).deviceId;
});

const lunch = await foodLoggingService.logFood(deviceId, {
  foodName: "蛋餅",
  calories: 330,
  protein: 12,
  carbs: 38,
  fat: 14,
  loggedAt: "2026-04-19T04:30:00.000Z",
});
const result = await mealCorrectionService.findMeals(deviceId, "delete", "把今天午餐那餐刪掉");
assert.equal(result.status, "resolved");
assert.equal(result.resolvedMealId, lunch.id);
```

Add focused tests: explicit lunch with breakfast-hour `loggedAt` returns candidate `mealPeriod: "lunch"` and `mealPeriodSource: "explicit"`; legacy/no-authority row returns inferred period and `mealPeriodSource: "inferred"`.

## Shared Patterns

### Authentication / Ownership

**Source:** `server/routes/meals.ts` lines 133-145 and `server/routes/history.ts` lines 145-156

**Apply to:** all route DTO changes

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

Do not introduce `deviceId` query/header ownership for browser routes.

### Error Handling

**Source:** `server/routes/meals.ts` lines 184-233 and `server/routes/history.ts` lines 187-191

**Apply to:** route validation and mutation responses

```typescript
const update = parseMealUpdateBody(request.body);
if (!update) {
  return reply.code(400).send({ error: "Invalid meal update" });
}

try {
  updatedMeal = await foodLoggingService.updateMeal(deviceId, id, input);
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

### Backend-Owned Trusted Protein

**Source:** `server/orchestrator/protein-trust.ts` lines 102-165 and `server/orchestrator/tools.ts` lines 710-763

**Apply to:** `log_food` execution and reply-copy tests

```typescript
export function normalizeTrustedProteinEstimate(input: NormalizeTrustedProteinEstimateInput): TrustedProteinEstimate {
  const countedSources: TrustedProteinSource[] = [];
  const excludedSources: ExcludedProteinSource[] = [];
  for (const source of input.proteinSources) {
    const category = classifyProteinSource(source.name);
    if (category === "anchor") {
      countedSources.push({ name: source.name, protein, category, certainty: source.certainty });
      continue;
    }
    excludedSources.push({ name: source.name, protein, reason: category === "trace" ? "trace" : "unknown" });
  }
  return { trustedProtein, countedSources, excludedSources, usedConservativeAssumption };
}
```

Planner should preserve backend-normalized `countedSources` as the only authority for reply copy, ranking, and correction reasoning.

### Summary Outcome and Post-Commit Side Effects

**Source:** `server/orchestrator/tools.ts` lines 1051-1086 and `server/routes/meals.ts` lines 236-250

**Apply to:** log/update responses that add `mealPeriod`

```typescript
const summaryOutcome = await buildSummaryOutcomeAfterMealCommit({
  deviceId,
  affectedDate: dateIntent.dateKey,
  summaryService: deps.summaryService,
  foodLoggingService: deps.foodLoggingService,
});
const dailySummary = dailySummaryFromOutcome(summaryOutcome);

return {
  ok: true,
  result: {
    status: "logged",
    summaryOutcome,
    ...(dailySummary ? { dailySummary } : {}),
    loggedMeal: { ...projectMealIdentityFields(loggedMeal), foodName: loggedMeal.foodName },
  },
};
```

Do not change `summaryOutcome` semantics while adding `mealPeriod`.

### Client Normalization

**Source:** `client/src/api.ts` lines 405-430 and 829-845

**Apply to:** all client DTO additions

```typescript
export function withAuthorizedAssetUrl(assetUrl: string | null | undefined): string | null | undefined {
  if (!assetUrl || !assetUrl.startsWith("/api/assets/")) {
    return assetUrl;
  }
  const [pathname, queryString = ""] = assetUrl.split("?", 2);
  const params = new URLSearchParams(queryString);
  params.delete("deviceId");
  return params.toString() ? `${pathname}?${params.toString()}` : pathname;
}
```

Add `mealPeriod` using the same optional-field guard style; invalid transport values are absent, not coerced.

### Verification

**Source:** `AGENTS.md` and local project skills

**Apply to:** all implementation plans

Use `yarn` only. Any TypeScript edit requires `yarn tsc --noEmit`. Route/service edits require integration tests. Unit tests use Node `node:test` and real SQLite `:memory:` where persistence is involved.

## No Analog Found

No Phase 65 file lacks a close analog. `server/lib/meal-period.ts` is new if created, but `server/lib/historical-date.ts` and `server/orchestrator/source-text-guard.ts` provide the local utility style and enum precedent.

## Metadata

**Analog search scope:** `server/**`, `client/src/**`, `tests/unit/**`, `tests/integration/**`, `drizzle/**`
**Files scanned:** 180+ paths from `rg --files server client tests drizzle`
**Pattern extraction date:** 2026-05-27
**Warnings:** Existing `extractHistoricalMealPeriod` and `meal-correction.extractMealPeriod` include time-of-day and snack words; do not copy them directly for persisted explicit authority.
