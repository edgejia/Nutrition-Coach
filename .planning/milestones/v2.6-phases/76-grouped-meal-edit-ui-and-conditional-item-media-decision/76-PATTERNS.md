# Phase 76: Grouped Meal Edit UI and Conditional Item Media Decision - Pattern Map

**Mapped:** 2026-06-03
**Files analyzed:** 13
**Analogs found:** 12 / 13

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `client/src/components/MealEditScreen.tsx` | component | request-response | `client/src/components/MealEditScreen.tsx` current scalar edit + grouped lock branch | exact |
| `client/src/app.css` | config/style | transform | existing `sp-meal-edit-*` styles in `client/src/app.css` | exact |
| `client/src/meal-edit-grouped-draft.ts` | utility | transform | `parseDraft()` in `MealEditScreen.tsx` + `parseGroupedMealItems()` in `server/routes/meals.ts` | partial |
| `client/src/types.ts` | model | request-response | `MealItemDetail`, `MealEntry`, current `UpdateMealInput` | exact |
| `client/src/api.ts` | service/transport | request-response | `updateMeal()`, `MealRevisionConflictError`, `normalizeMealItems()` | exact |
| `client/src/meal-edit-payload.ts` | utility | transform | existing grouped item normalization and payload builders | exact |
| `server/services/meal-history.ts` | service | CRUD | existing meal history projection and revision item query | exact |
| `server/routes/meals.ts` | route/controller | request-response | existing `/api/meals` GET projection + grouped PATCH parser | exact |
| `tests/unit/meal-edit-screen.test.ts` | test | transform | existing source-contract tests for Meal Edit | exact |
| `tests/unit/api-client.test.ts` | test | request-response | existing `updateMeal` body/conflict tests | exact |
| `tests/unit/meal-edit-grouped-draft.test.ts` | test | transform | `tests/unit/meal-edit-payload.test.ts` pure helper test style | role-match |
| `tests/unit/meal-edit-payload.test.ts` | test | transform | existing grouped item/image authority tests | exact |
| `tests/integration/meals-api.test.ts` | test | request-response/CRUD | existing `/api/meals` GET and grouped PATCH integration tests | exact |

## Pattern Assignments

### `client/src/components/MealEditScreen.tsx` (component, request-response)

**Analog:** current `client/src/components/MealEditScreen.tsx`

**Imports pattern** (lines 1-9):
```typescript
import { useEffect, useState } from "react";
import { deleteMeal, getMeals, MealRevisionConflictError, updateMeal } from "../api.js";
import { formatLocalDate } from "../lib/time.js";
import { refreshAfterMealMutation } from "../meal-edit-refresh.js";
import { useStore } from "../store.js";
import type { MealEditPayload } from "../types.js";
import { PersistedAssetImage } from "./PersistedAssetImage.js";
import { SportChevronLeftIcon } from "./SportIcons.js";
import { SportCard, SportIconButton, SportScreen } from "./SportPrimitives.js";
```

**Whole-meal media pattern** (lines 71-103):
```tsx
function MealEditImageFrame({ payload }: { payload: MealEditPayload }) {
  return (
    <section className="sp-meal-edit-image-frame">
      {payload.imageUrl ? (
        <>
          <div className="sp-meal-edit-image-copy">
            <span>整餐照片</span>
            <p>這張照片代表整餐，不是單一食物裁切。</p>
          </div>
          <div className="sp-meal-edit-image-media">
            <PersistedAssetImage
              src={payload.imageUrl}
              alt={`${payload.foodName} 整餐照片`}
              imgClassName="sp-meal-edit-image"
              fallbackClassName="sp-meal-edit-image-fallback"
            />
          </div>
        </>
      ) : (
        <div className="sp-meal-edit-image-placeholder">
          <span>尚未附上餐點照片</span>
          <p>這筆餐點是文字記錄，仍可編輯名稱與營養數值。</p>
        </div>
      )}
    </section>
  );
}
```

**Store/auth/recovery pattern** (lines 106-155):
```typescript
export function MealEditScreen({ onBack }: { onBack: () => void }) {
  const secondaryScreen = useStore((s) => s.secondaryScreen);
  const setActiveScreen = useStore((s) => s.setActiveScreen);
  const closeSecondaryScreen = useStore((s) => s.closeSecondaryScreen);
  const setDailySummary = useStore((s) => s.setDailySummary);
  const setMeals = useStore((s) => s.setMeals);
  const redactChatReceiptIdentity = useStore((s) => s.redactChatReceiptIdentity);
  const recordMealMutation = useStore((s) => s.recordMealMutation);
  const recoverGuestSession = useStore((s) => s.recoverGuestSession);

  async function handleMealRevisionConflict(error: MealRevisionConflictError, mode: "save" | "delete") {
    setStaleBlocked(true);
    setError(
      mode === "delete"
        ? STALE_DELETE_ERROR_COPY
        : error.code === MEAL_REVISION_REQUIRED
          ? MISSING_REVISION_ERROR_COPY
          : STALE_EDIT_ERROR_COPY,
    );
    await refreshAfterStaleConflict(error.mealId, error.affectedDate);
  }
}
```

**Save/refresh/error pattern** (lines 171-219):
```typescript
async function handleSave() {
  if (!payload || staleBlocked || payload.itemCount > 1 || !draft) {
    return;
  }

  const parsedDraft = parseDraft(draft);
  if (!parsedDraft) {
    setError("請確認餐名與數值都已填寫，且數值不可為負。");
    return;
  }

  setPending(true);
  setError(null);
  try {
    const response = await updateMeal(payload.mealId, {
      expectedMealRevisionId: payload.mealRevisionId,
      ...parsedDraft,
      imageAssetId: payload.imageAssetId ?? null,
    });
    await refreshAfterMealMutation({
      redactChatReceiptIdentity,
      recordMealMutation,
      setDailySummary,
      getMeals,
      setMeals,
      todayKey: () => formatLocalDate(new Date()),
    }, {
      mealId: payload.mealId,
      affectedDate: response.affectedDate,
      dailySummary: response.dailySummary,
    });
    onBack();
  } catch (err) {
    if (err instanceof Error && err.message === "UNAUTHORIZED") {
      void recoverGuestSession();
    } else if (err instanceof MealRevisionConflictError) {
      await handleMealRevisionConflict(err, "save");
    } else {
      setError("餐點暫時無法儲存，請稍後再試。");
    }
  } finally {
    setPending(false);
  }
}
```

**Grouped branch to replace** (lines 297-338):
```tsx
if (payload.itemCount > 1) {
  return (
    <SportScreen className="sp-meal-edit-screen">
      <main className="screen-scroll-safe sp-meal-edit-scroll sp-meal-edit-grouped-scroll">
        <MealEditImageFrame payload={payload} />
        <SportCard className="sp-meal-edit-grouped-lock">
          <div className="sp-meal-edit-grouped-label">組合餐點</div>
          {payload.items && payload.items.length > 0 ? (
            <div className="sp-meal-edit-grouped-items" aria-label={`${payload.foodName} 項目明細`}>
              {payload.items.map((item) => (
                <div key={`${item.position}-${item.name}`} className="sp-meal-edit-grouped-item">
                  <div className="sp-meal-edit-grouped-item-name">{item.name}</div>
                  <div className="sp-meal-edit-grouped-item-macros">
                    <span>熱量 {formatMealItemMacro(item.calories, "kcal")}</span>
                    <span>蛋白質 {formatMealItemMacro(item.protein, "g")}</span>
                    <span>碳水 {formatMealItemMacro(item.carbs, "g")}</span>
                    <span>脂肪 {formatMealItemMacro(item.fat, "g")}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </SportCard>
      </main>
    </SportScreen>
  );
}
```

**Scalar form field pattern to copy for expanded grouped rows** (lines 393-428):
```tsx
<label className="sp-meal-edit-field sp-meal-edit-name-field">
  <span>餐點名稱</span>
  <input
    value={draft.foodName}
    disabled={pending}
    onChange={(event) => setDraft({ ...draft, foodName: event.target.value })}
  />
</label>

<div className="sp-meal-edit-macro-grid">
  {NUTRITION_FIELDS.map((field) => (
    <label key={field.key} className="sp-meal-edit-field sp-meal-edit-macro-field">
      <span>{field.label}</span>
      <div>
        <input
          type="number"
          min="0"
          step="1"
          inputMode="decimal"
          value={draft[field.key]}
          disabled={pending}
          onChange={(event) => setDraft({ ...draft, [field.key]: event.target.value })}
        />
        <small>{field.unit}</small>
      </div>
    </label>
  ))}
</div>
```

### `client/src/app.css` (config/style, transform)

**Analog:** existing `sp-meal-edit-*` block in `client/src/app.css`

**Screen/header/footer pattern** (lines 2193-2262, 2620-2665):
```css
.sp-meal-edit-screen {
  min-width: 0;
  background: var(--sp-bg);
}

.sp-meal-edit-header {
  display: grid;
  grid-template-columns: 48px minmax(0, 1fr) 48px;
  align-items: center;
  gap: 8px;
  border-bottom: 1px solid var(--sp-line);
  padding: 20px 18px 14px;
}

.sp-meal-edit-scroll {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 14px 18px calc(128px + var(--app-bottom-occlusion, 0px) + env(safe-area-inset-bottom));
}

.sp-meal-edit-footer {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 20;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 2fr);
  gap: 10px;
}
```

**Field/error pattern** (lines 2391-2450, 2502-2511):
```css
.sp-meal-edit-field {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 6px;
}

.sp-meal-edit-name-field,
.sp-meal-edit-macro-field {
  border: 1px solid var(--sp-line);
  border-radius: 10px;
  background: var(--sp-surface-2);
  padding: 10px 12px;
}

.sp-meal-edit-macro-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.sp-meal-edit-error {
  border: 1px solid rgba(255, 77, 77, 0.32);
  border-radius: var(--sp-r-sm);
  background: rgba(255, 77, 77, 0.10);
  color: #ffb3b3;
  padding: 10px 12px;
}
```

**Grouped row/card pattern** (lines 2520-2618):
```css
.sp-meal-edit-grouped-lock {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 16px;
  border: 1px solid var(--sp-line);
  background: var(--sp-surface);
}

.sp-meal-edit-grouped-items {
  display: grid;
  gap: 8px;
  border: 1px solid var(--sp-line);
  border-radius: var(--sp-r-md);
  padding: 8px;
}

.sp-meal-edit-grouped-item {
  display: grid;
  min-width: 0;
  gap: 8px;
  border-radius: var(--sp-r-sm);
  background: var(--sp-surface-2);
  padding: 10px 12px;
}

.sp-meal-edit-grouped-primary {
  min-height: 44px;
  border: 1px solid var(--sp-lime);
  border-radius: var(--sp-r-pill);
  background: var(--sp-lime);
}
```

### `client/src/meal-edit-grouped-draft.ts` (utility, transform)

**Analogs:** `parseDraft()` in `MealEditScreen.tsx`; `parseGroupedMealItems()` in `server/routes/meals.ts`

**Scalar draft validation pattern** (MealEditScreen lines 50-69):
```typescript
function parseDraft(draft: DraftState) {
  const foodName = draft.foodName.trim();
  const rawValues = [draft.calories, draft.protein, draft.carbs, draft.fat];
  if (!foodName || rawValues.some((value) => value.trim() === "")) {
    return null;
  }

  const [calories, protein, carbs, fat] = rawValues.map(Number);
  if ([calories, protein, carbs, fat].some((value) => !Number.isFinite(value) || value < 0)) {
    return null;
  }

  return { foodName, calories, protein, carbs, fat };
}
```

**Strict grouped item write shape to mirror** (server/routes/meals.ts lines 72-130):
```typescript
function parseGroupedMealItems(value: unknown): MealTransactionItemInput[] | null {
  if (!Array.isArray(value) || value.length === 0) {
    return null;
  }

  const expectedKeys = ["calories", "carbs", "fat", "name", "position", "protein"].sort();
  const items: MealTransactionItemInput[] = [];

  for (const [index, item] of value.entries()) {
    const itemKeys = Object.keys(item).sort();
    if (itemKeys.length !== expectedKeys.length || itemKeys.some((key, i) => key !== expectedKeys[i])) {
      return null;
    }

    const name = typeof item.name === "string" ? item.name.trim() : "";
    if (!name) return null;
    if (!Number.isInteger(item.position) || item.position !== index) return null;
    if (
      !isFiniteNonNegativeNumber(item.calories) ||
      !isFiniteNonNegativeNumber(item.protein) ||
      !isFiniteNonNegativeNumber(item.carbs) ||
      !isFiniteNonNegativeNumber(item.fat)
    ) {
      return null;
    }
  }
}
```

**Planner note:** If extracted, keep this helper pure and UI-free. Return row/field errors and parsed `MealItemDetail[]`; assign `position` from visible order at submit time.

### `client/src/types.ts` (model, request-response)

**Analog:** existing DTO/input type block in `client/src/types.ts`

**Meal item detail stays media-free** (lines 69-76):
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

**Read DTOs already carry optional grouped details** (lines 9-24, 95-109):
```typescript
export interface MealEditPayload {
  mealId: string;
  mealRevisionId: string;
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
}

export interface MealEntry {
  id: string;
  mealRevisionId?: string;
  foodName: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  itemCount: number;
  items?: MealItemDetail[];
}
```

**Current scalar-only input to expand** (lines 111-119):
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

**Copy pattern:** Replace with a scalar-or-grouped union. Grouped arm should be only `{ expectedMealRevisionId: string; items: MealItemDetail[] }`; no `imageAssetId`, scalar nutrition, media, or crop fields.

### `client/src/api.ts` (service/transport, request-response)

**Analog:** existing `client/src/api.ts`

**Conflict error pattern** (lines 53-67, 206-224):
```typescript
export type MealRevisionConflictCode = "MEAL_REVISION_REQUIRED" | "MEAL_REVISION_STALE";

export class MealRevisionConflictError extends Error {
  readonly kind = "meal_revision_conflict";

  constructor(
    readonly code: MealRevisionConflictCode,
    readonly mealId: string,
    readonly affectedDate: string,
    readonly currentMealRevisionId?: string,
  ) {
    super(code);
    this.name = "MealRevisionConflictError";
  }
}

function getMealRevisionConflictError(status: number, body: unknown): MealRevisionConflictError | null {
  if (status !== 409 || !isRecord(body)) return null;
  const code = body.error;
  if (code !== "MEAL_REVISION_REQUIRED" && code !== "MEAL_REVISION_STALE") return null;
  return new MealRevisionConflictError(code, body.mealId, body.affectedDate, currentMealRevisionId);
}
```

**Tolerant read normalization pattern** (lines 85-132):
```typescript
function normalizeMealItems(value: unknown): MealItemDetail[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const items = value
    .map((item): MealItemDetail | null => {
      const nutrition = isRecord(item.nutrition) ? item.nutrition : item;
      const name = typeof item.name === "string" ? item.name.trim() : "";
      const position = item.position;
      const calories = nutrition.calories;
      const protein = nutrition.protein;
      const carbs = nutrition.carbs;
      const fat = nutrition.fat;
      if (!name || typeof position !== "number" || !Number.isFinite(position)) {
        return null;
      }
      return { name, position: Math.floor(position), calories, protein, carbs, fat };
    })
    .filter((item): item is MealItemDetail => item !== null)
    .sort((a, b) => a.position - b.position);

  return items.length > 0 ? items : undefined;
}
```

**PATCH helper pattern** (lines 1095-1117):
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
    if (conflict) throw conflict;
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

### `client/src/meal-edit-payload.ts` (utility, transform)

**Analog:** existing payload builders

**Grouped item normalization and image preservation** (lines 23-70, 100-115):
```typescript
function normalizeMealItems(value: unknown): MealItemDetail[] | undefined {
  if (!Array.isArray(value)) return undefined;

  const items = value
    .map((item): MealItemDetail | null => {
      const name = typeof item.name === "string" ? item.name.trim() : "";
      const position = item.position;
      const calories = item.calories;
      const protein = item.protein;
      const carbs = item.carbs;
      const fat = item.fat;
      if (!name || typeof position !== "number" || !Number.isFinite(position)) return null;
      return { name, position: Math.floor(position), calories, protein, carbs, fat };
    })
    .filter((item): item is MealItemDetail => item !== null)
    .sort((a, b) => a.position - b.position);

  return items.length > 0 ? items : undefined;
}

return {
  mealId: meal.id,
  mealRevisionId,
  foodName: meal.foodName,
  itemCount: normalizeItemCount(meal.itemCount),
  ...(items ? { items } : {}),
  imageAssetId: meal.imageAssetId ?? null,
  imageUrl: meal.imageUrl ?? null,
};
```

### `server/services/meal-history.ts` (service, CRUD)

**Analog:** existing revision item query and aggregate projection

**Imports and DB query pattern** (lines 1-12, 29-63):
```typescript
import { and, asc, eq, gte, inArray, isNull, lt } from "drizzle-orm";
import type { AppDatabase } from "../db/client.js";
import { mealRevisionItems, mealRevisions, mealTransactions } from "../db/schema.js";
import { getLocalDayBounds } from "../lib/time.js";
import { makeAssetRef } from "./assets.js";
import { projectMealDisplay } from "./meal-display.js";

async getMealsByDate(deviceId: string, date: Date): Promise<MealHistoryEntry[]> {
  const { startIso, endIso } = getLocalDayBounds(date);
  const headers = await db.select({...}).from(mealTransactions).where(...).orderBy(asc(mealTransactions.loggedAt));
  const revisionIds = headers.map((header) => header.currentRevisionId);
  const revisions = await db.select().from(mealRevisions).where(inArray(mealRevisions.id, revisionIds));
  const items = await db
    .select()
    .from(mealRevisionItems)
    .where(inArray(mealRevisionItems.revisionId, revisionIds))
    .orderBy(asc(mealRevisionItems.position));
}
```

**Projection pattern to extend with item detail** (lines 65-105):
```typescript
const itemsByRevisionId = new Map<string, Array<{
  foodName: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}>>();

for (const item of items) {
  const revisionItems = itemsByRevisionId.get(item.revisionId) ?? [];
  revisionItems.push({
    foodName: item.foodName,
    calories: item.calories,
    protein: item.protein,
    carbs: item.carbs,
    fat: item.fat,
  });
  itemsByRevisionId.set(item.revisionId, revisionItems);
}

return headers.map((header) => {
  const revisionItems = itemsByRevisionId.get(header.currentRevisionId) ?? [];
  const display = projectMealDisplay(revisionItems);
  return {
    id: header.id,
    mealRevisionId: header.currentRevisionId,
    foodName: display.foodName,
    itemCount: display.itemCount,
    calories: revisionItems.reduce((sum, item) => sum + item.calories, 0),
    imagePath: revision?.imageAssetId ? makeAssetRef(revision.imageAssetId) : null,
  };
});
```

**Planner note:** If `/api/meals` needs grouped `items[]`, add `position` to the internal item map and project `{ name, position, calories, protein, carbs, fat }` from this service or route. Do not include media fields per item.

### `server/routes/meals.ts` (route/controller, request-response)

**Analog:** existing meals route

**Auth/session pattern** (lines 255-267):
```typescript
app.get("/api/meals", async (request, reply) => {
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
});
```

**GET `/api/meals` DTO projection to extend** (lines 272-291):
```typescript
const meals = await foodLoggingService.getMealsByDate(deviceId, new Date());
return {
  meals: meals.map((meal) => {
    const imageAssetId = parseAssetRef(meal.imagePath);
    return {
      id: meal.id,
      mealRevisionId: meal.mealRevisionId,
      foodName: meal.foodName,
      itemCount: meal.itemCount ?? 1,
      calories: meal.calories,
      protein: meal.protein,
      carbs: meal.carbs,
      fat: meal.fat,
      imageAssetId,
      imageUrl: imageAssetId ? buildAssetUrl(imageAssetId) : null,
      loggedAt: meal.loggedAt,
      ...(meal.mealPeriod ? { mealPeriod: meal.mealPeriod } : {}),
    };
  }),
};
```

**Grouped PATCH parser and mutual exclusion pattern** (lines 139-165):
```typescript
if (hasOwn(input, "items")) {
  const topLevelKeys = Object.keys(input).sort();
  const expectedTopLevelKeys = hasOwn(input, "expectedMealRevisionId")
    ? ["expectedMealRevisionId", "items"]
    : ["items"];
  if (
    topLevelKeys.length !== expectedTopLevelKeys.length ||
    topLevelKeys.some((key, i) => key !== expectedTopLevelKeys[i])
  ) {
    return null;
  }

  const expectedMealRevisionId = parseExpectedMealRevisionIdValue(input.expectedMealRevisionId);
  if (expectedMealRevisionId === null) return null;

  const items = parseGroupedMealItems(input.items);
  if (!items) return null;

  return {
    kind: "items",
    items,
    ...(expectedMealRevisionId ? { expectedMealRevisionId } : {}),
  };
}
```

**Grouped update execution pattern** (lines 349-354, 382-400):
```typescript
updatedMeal = await foodLoggingService.updateMeal(deviceId, id, {
  expectedMealRevisionId: update.expectedMealRevisionId,
  items: update.items,
});

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
  },
};
```

### `tests/unit/meal-edit-screen.test.ts` (test, transform)

**Analog:** existing source-contract tests

**Source-read harness pattern** (lines 1-17):
```typescript
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

async function readSource(relativePath: string) {
  return readFile(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

const source = await readSource("../../client/src/components/MealEditScreen.tsx");

function escapedPattern(text: string) {
  return new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
}
```

**Canonical mutation helper assertions** (lines 41-59):
```typescript
it("saves and deletes through canonical meal mutation helpers", () => {
  for (const expected of [
    "updateMeal",
    "deleteMeal",
    "MealRevisionConflictError",
    "refreshAfterMealMutation",
    "expectedMealRevisionId: payload.mealRevisionId",
    "confirm",
    "setDailySummary",
    "redactChatReceiptIdentity",
    "recordMealMutation",
    'getMeals({ refreshReason: "meal_mutation" })',
    "recoverGuestSession",
  ]) {
    assert.match(source, escapedPattern(expected));
  }
});
```

**Grouped-lock test to replace** (lines 149-183):
```typescript
it("locks direct editing for grouped Meal Edit payloads and points users to chat correction", () => {
  assert.match(source, /payload\.itemCount\s*>\s*1/);
  assert.match(source, escapedPattern("組合餐點"));
  assert.match(source, /payload\.items/);
  assert.match(source, escapedPattern("sp-meal-edit-grouped-items"));
  assert.match(source, escapedPattern("sp-meal-edit-grouped-item-name"));
  assert.match(source, escapedPattern("sp-meal-edit-grouped-item-macros"));

  const groupedBranch = source.match(/if \(payload\.itemCount\s*>\s*1\) \{[\s\S]+?sp-meal-edit-grouped-primary[\s\S]+?\n\s*\);\n\s*\}/)?.[0] ?? "";
  assert.match(groupedBranch, escapedPattern("sp-meal-edit-grouped-lock"));
  assert.match(groupedBranch, /payload\.items\.map/);
  assert.doesNotMatch(groupedBranch, escapedPattern("儲存"));
  assert.doesNotMatch(groupedBranch, /<input\b/);
});
```

**Planner note:** Replace the last test with grouped editor assertions: add/delete controls, one expanded row, `items` grouped save path, no per-item media strings, invalid-save copy, stale-block reuse, and dirty discard confirmation.

### `tests/unit/api-client.test.ts` (test, request-response)

**Analog:** existing API client tests

**PATCH body pass-through pattern** (lines 955-1000):
```typescript
it("updateMeal sends PATCH with same-origin JSON body and returns refreshed daily summary", async () => {
  mockFetch(200, {
    affectedDate: "2026-04-30",
    dailySummary: { date: "2026-04-30", totalCalories: 260, totalProtein: 20, totalCarbs: 8, totalFat: 12, mealCount: 1 },
    meal: {
      id: "meal-1",
      mealRevisionId: "meal-1:r2",
      foodName: "雞胸肉沙拉半份",
      calories: 260,
      protein: 20,
      carbs: 8,
      fat: 12,
      imageAssetId: null,
      imageUrl: null,
      loggedAt: "2026-04-30T04:00:00.000Z",
    },
  });

  const result = await api.updateMeal("meal-1", input);
  assert.equal(fetchCalls[0].url, "/api/meals/meal-1");
  assert.equal(fetchCalls[0].init.method, "PATCH");
  assert.deepEqual(JSON.parse(String(fetchCalls[0].init.body)), input);
  assert.equal(result.meal.mealRevisionId, "meal-1:r2");
});
```

**Conflict proof pattern** (lines 1002-1049):
```typescript
mockFetch(409, {
  error: "MEAL_REVISION_STALE",
  mealId: "meal-1",
  affectedDate: "2026-04-30",
  currentMealRevisionId: "meal-1:r2",
});

await assert.rejects(
  () => api.updateMeal("meal-1", { expectedMealRevisionId: "meal-1:r1", foodName: "雞胸肉沙拉半份", calories: 260, protein: 20, carbs: 8, fat: 12, imageAssetId: null }),
  (error: unknown) => {
    assert.ok(error instanceof api.MealRevisionConflictError);
    assert.equal(error.code, "MEAL_REVISION_STALE");
    assert.equal(error.mealId, "meal-1");
    assert.equal(error.affectedDate, "2026-04-30");
    assert.equal(error.currentMealRevisionId, "meal-1:r2");
    return true;
  },
);
```

**Planner note:** Add a grouped input case where `input` is `{ expectedMealRevisionId, items: [...] }`; assert body exactly equals that object and contains no `imageAssetId`, `foodName`, or scalar nutrition keys.

### `tests/unit/meal-edit-grouped-draft.test.ts` (test, transform)

**Analog:** `tests/unit/meal-edit-payload.test.ts`

**Pure helper test style** (meal-edit-payload.test.ts lines 1-13):
```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildHistoryMealEditPayload,
  buildMealEditPayloadIfComplete,
  buildReceiptMealEditPayload,
} from "../../client/src/meal-edit-payload.js";

describe("meal edit payload builders", () => {
  it("normalizeHistoryMeal preserves valid grouped item detail from history DTOs", () => {
    // Arrange helper input, call helper, assert exact object shape.
  });
});
```

**Grouped sorted item assertion pattern** (meal-edit-payload.test.ts lines 174-205):
```typescript
const payload = buildMealEditPayloadIfComplete({
  id: "home-grouped-meal",
  mealRevisionId: "home-grouped-meal:r1",
  foodName: "雞腿、白飯、青菜",
  calories: 720,
  protein: 42,
  carbs: 88,
  fat: 24,
  itemCount: 3,
  items: [
    { name: "青菜", position: 2, calories: 80, protein: 4, carbs: 10, fat: 2 },
    { name: "雞腿", position: 0, calories: 340, protein: 32, carbs: 2, fat: 18 },
    { name: "白飯", position: 1, calories: 300, protein: 6, carbs: 76, fat: 4 },
  ],
} as any, "2026-05-06");

assert.deepEqual(payload?.items, [
  { name: "雞腿", position: 0, calories: 340, protein: 32, carbs: 2, fat: 18 },
  { name: "白飯", position: 1, calories: 300, protein: 6, carbs: 76, fat: 4 },
  { name: "青菜", position: 2, calories: 80, protein: 4, carbs: 10, fat: 2 },
]);
```

### `tests/unit/meal-edit-payload.test.ts` (test, transform)

**Analog:** existing grouped detail and media authority tests

**Preserve grouped item/image authority pattern** (lines 174-205):
```typescript
it("buildMealEditPayloadIfComplete preserves grouped item and image authority", () => {
  const payload = buildMealEditPayloadIfComplete({
    id: "home-grouped-meal",
    mealRevisionId: "home-grouped-meal:r1",
    foodName: "雞腿、白飯、青菜",
    calories: 720,
    protein: 42,
    carbs: 88,
    fat: 24,
    itemCount: 3,
    items: [
      { name: "青菜", position: 2, calories: 80, protein: 4, carbs: 10, fat: 2 },
      { name: "雞腿", position: 0, calories: 340, protein: 32, carbs: 2, fat: 18 },
      { name: "白飯", position: 1, calories: 300, protein: 6, carbs: 76, fat: 4 },
    ],
    imageAssetId: "asset-grouped",
    imageUrl: "/api/assets/asset-grouped",
  } as any, "2026-05-06");

  assert.deepEqual(payload?.items, [
    { name: "雞腿", position: 0, calories: 340, protein: 32, carbs: 2, fat: 18 },
    { name: "白飯", position: 1, calories: 300, protein: 6, carbs: 76, fat: 4 },
    { name: "青菜", position: 2, calories: 80, protein: 4, carbs: 10, fat: 2 },
  ]);
  assert.equal(payload?.imageAssetId, "asset-grouped");
  assert.equal(payload?.imageUrl, "/api/assets/asset-grouped");
});
```

### `tests/integration/meals-api.test.ts` (test, request-response/CRUD)

**Analog:** existing route integration tests

**GET `/api/meals` projection test to extend** (lines 254-288):
```typescript
it("GET /api/meals preserves grouped itemCount from meal history service rows", async () => {
  const groupedMeal = await services.foodLoggingService.logGroupedMeal(deviceId, {
    items: [
      { foodName: "雞腿", calories: 260, protein: 24, carbs: 0, fat: 12 },
      { foodName: "白飯", calories: 280, protein: 4, carbs: 62, fat: 0.5 },
      { foodName: "青菜", calories: 40, protein: 2, carbs: 8, fat: 1 },
    ],
  });

  const res = await app.inject({
    method: "GET",
    url: "/api/meals",
    headers: { cookie: deviceCookieHeader },
  });

  assert.equal(res.statusCode, 200);
  const body = res.json() as { meals: Array<{ id: string; foodName: string; itemCount?: number }> };
  assert.deepEqual(body.meals, [{ id: groupedMeal.id, itemCount: 3, foodName: "雞腿、白飯、青菜" }]);
});
```

**Grouped PATCH success pattern** (lines 522-572):
```typescript
const updateRes = await app.inject({
  method: "PATCH",
  url: `/api/meals/${meal.id}`,
  headers: { cookie: deviceCookieHeader },
  payload: {
    expectedMealRevisionId: meal.mealRevisionId,
    items: [
      { name: "蛋餅", position: 0, calories: 310, protein: 18, carbs: 32, fat: 12 },
      { name: "無糖豆漿", position: 1, calories: 120, protein: 9, carbs: 8, fat: 5 },
    ],
  },
});

assert.equal(updateRes.statusCode, 200);
assertFreshMealPatchResponse(updateRes.json(), {
  mealId: meal.id,
  previousMealRevisionId: meal.mealRevisionId,
  foodName: "蛋餅、無糖豆漿",
  itemCount: 2,
  calories: 430,
  protein: 27,
  carbs: 40,
  fat: 17,
});
```

**Malformed grouped payload rejection pattern** (lines 678-847):
```typescript
const validItem = { name: "雞腿", position: 0, calories: 260, protein: 24, carbs: 0, fat: 12 };
const invalidBodies = [
  { name: "empty items", payload: (expectedMealRevisionId: string) => ({ expectedMealRevisionId, items: [] }) },
  { name: "items plus imageAssetId", payload: (expectedMealRevisionId: string) => ({ expectedMealRevisionId, imageAssetId: null, items: [validItem] }) },
  { name: "item uses nested nutrition", payload: (expectedMealRevisionId: string) => ({ expectedMealRevisionId, items: [{ name: "雞腿", position: 0, nutrition: { calories: 260, protein: 24, carbs: 0, fat: 12 } }] }) },
  { name: "position does not match zero-based array index", payload: (expectedMealRevisionId: string) => ({ expectedMealRevisionId, items: [{ ...validItem, position: 1 }] }) },
];

for (const invalidBody of invalidBodies) {
  const updateRes = await app.inject({
    method: "PATCH",
    url: `/api/meals/${meal.id}`,
    headers: { cookie: deviceCookieHeader },
    payload: invalidBody.payload(meal.mealRevisionId),
  });
  assert.equal(updateRes.statusCode, 400, invalidBody.name);
  assert.deepEqual(updateRes.json(), { error: "Invalid meal update" }, invalidBody.name);
}
```

## Shared Patterns

### Authentication And Unauthorized Recovery

**Source:** `server/routes/meals.ts` lines 255-267; `MealEditScreen.tsx` lines 207-214 and 254-258
**Apply to:** `server/routes/meals.ts`, `client/src/components/MealEditScreen.tsx`, `client/src/api.ts`

```typescript
const session = await resolveGuestSession(request, { deviceService, guestSessionService });
if (!session.ok) {
  if (session.clearCookies) {
    reply.header("set-cookie", guestSessionService.clearSessionCookies());
  }
  return reply.code(401).send({ error: session.error });
}

if (err instanceof Error && err.message === "UNAUTHORIZED") {
  void recoverGuestSession();
}
```

### Revision Conflict Recovery

**Source:** `client/src/api.ts` lines 53-67, 206-224; `MealEditScreen.tsx` lines 143-155
**Apply to:** grouped save/delete UI and API tests

```typescript
if (err instanceof MealRevisionConflictError) {
  await handleMealRevisionConflict(err, "save");
  return;
}
```

### Committed Mutation Refresh

**Source:** `client/src/meal-edit-refresh.ts` lines 18-37; `MealEditScreen.tsx` lines 190-206
**Apply to:** grouped save success

```typescript
await refreshAfterMealMutation({
  redactChatReceiptIdentity,
  recordMealMutation,
  setDailySummary,
  getMeals,
  setMeals,
  todayKey: () => formatLocalDate(new Date()),
}, {
  mealId: payload.mealId,
  affectedDate: response.affectedDate,
  dailySummary: response.dailySummary,
});
```

### Grouped Write Shape

**Source:** `server/routes/meals.ts` lines 72-165; `tests/integration/meals-api.test.ts` lines 678-847
**Apply to:** `MealEditScreen.tsx`, optional `meal-edit-grouped-draft.ts`, `types.ts`, `api-client.test.ts`

```typescript
{
  expectedMealRevisionId: payload.mealRevisionId,
  items: draftRows.map((item, index) => ({
    name: item.name.trim(),
    position: index,
    calories: item.calories,
    protein: item.protein,
    carbs: item.carbs,
    fat: item.fat,
  })),
}
```

Do not include `imageAssetId`, scalar nutrition fields, nested `nutrition`, `foodName`, per-item media, or extra keys in grouped writes.

### Whole-Meal Media Only

**Source:** `client/src/types.ts` lines 69-76; `MealEditScreen.tsx` lines 71-103; `meal-edit-payload.test.ts` lines 174-205
**Apply to:** grouped UI, grouped write payloads, type/test updates

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

### Node Test Style

**Source:** `tests/unit/meal-edit-screen.test.ts` lines 1-17; `tests/unit/meal-edit-payload.test.ts` lines 1-13
**Apply to:** all Phase 76 unit tests

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
```

Use `node scripts/run-node-with-tz.mjs --import tsx --test <files>` for targeted tests. Use `app.inject()` with real app services for route integration tests.

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `client/src/meal-edit-grouped-draft.ts` | utility | transform | No existing grouped draft helper exists. Use the existing scalar draft parser and strict grouped route parser as combined analogs. |

## Metadata

**Analog search scope:** `client/src`, `server/routes`, `server/services`, `tests/unit`, `tests/integration`, `.codex/skills`
**Files scanned:** 19 direct files plus project skill indexes
**Pattern extraction date:** 2026-06-03

