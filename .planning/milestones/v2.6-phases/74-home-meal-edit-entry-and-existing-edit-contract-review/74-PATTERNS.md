# Phase 74: Home Meal Edit Entry and Existing Edit Contract Review - Pattern Map

**Mapped:** 2026-06-02
**Files analyzed:** 17
**Analogs found:** 17 / 17

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `client/src/components/HomeScreen.tsx` | component | event-driven | `client/src/components/HistoryScreen.tsx` | exact |
| `client/src/components/HistoryScreen.tsx` | component | event-driven | itself | exact |
| `client/src/components/MessageBubble.tsx` | component | event-driven | itself | exact |
| `client/src/components/MealEditScreen.tsx` | component | request-response | itself | exact |
| `client/src/meal-edit-payload.ts` | utility | transform | itself | exact |
| `client/src/store.ts` | store | event-driven | itself | exact |
| `client/src/contracts/capability-matrix.ts` | config | transform | itself | exact |
| `client/src/app.css` | component styling | event-driven | History row styles in `client/src/app.css` | role-match |
| `docs/capability-matrix.md` | generated docs | transform | `scripts/generate-capability-matrix-doc.mjs` | exact |
| `tests/unit/home-dashboard-contract.test.ts` | test | transform | `tests/unit/history-screen-contract.test.ts` | exact |
| `tests/unit/history-screen-contract.test.ts` | test | transform | itself | exact |
| `tests/unit/history-day-detail-screen.test.ts` | test | transform | itself | exact |
| `tests/unit/meal-edit-payload.test.ts` | test | transform | itself | exact |
| `tests/unit/meal-edit-screen.test.ts` | test | transform | itself | exact |
| `tests/unit/capability-matrix-contract.test.ts` | test | transform | itself | exact |
| `tests/unit/capability-matrix-source-scan.test.ts` | test | transform | itself | exact |
| `tests/integration/meals-api.test.ts` | test | request-response | itself | exact |

## Pattern Assignments

### `client/src/components/HomeScreen.tsx` (component, event-driven)

**Analog:** `client/src/components/HistoryScreen.tsx`

**Imports pattern** (lines 13-18):
```typescript
import { formatLocalDate } from "../lib/time.js";
import { buildHistoryMealEditPayload } from "../meal-edit-payload.js";
import { useStore } from "../store.js";
import type { HistoryDaySnapshot, HistoryTrendResponse, MealEntry } from "../types.js";
import { formatMealRowTime, getDisplayMealLabel, getMealMacroSummary } from "./HomeScreen.js";
import { PersistedAssetImage } from "./PersistedAssetImage.js";
```

**Current Home row to preserve visually** (lines 382-430):
```tsx
function MealRows({ meals, onEmptyChatClick }: { meals: MealEntry[]; onEmptyChatClick: () => void }) {
  const emptyCopy = getHomeEmptyCoachCopy();

  return (
    <section className="home-sport-meal-section">
      <div className="home-sport-section-header">
        <h2>今日紀錄</h2>
        <span>{meals.length}筆</span>
      </div>
      {meals.length === 0 ? (
        <SportCard className="home-sport-empty">
          <h3>{emptyCopy.headline}</h3>
          <p>{emptyCopy.body}</p>
          <button type="button" className="home-sport-empty-action" onClick={onEmptyChatClick}>
            {emptyCopy.actions[0]?.label}
          </button>
        </SportCard>
      ) : (
        <div className="home-sport-meal-list">
          {meals.map((meal) => (
            <article key={meal.id} className="home-sport-meal-row">
              <div className="home-sport-meal-media">
                {meal.imageUrl ? (
                  <PersistedAssetImage
                    src={meal.imageUrl}
                    alt={`${meal.foodName} 縮圖`}
                    imgClassName="home-sport-meal-image"
                    fallbackClassName="home-sport-meal-fallback"
                  />
                ) : (
                  <div role="img" aria-label={`${meal.foodName} 無照片`} className="home-sport-meal-fallback">
                    無照片
                  </div>
                )}
              </div>
```

**Edit-entry row pattern to copy** (lines 246-304):
```tsx
function onMealOpen(meal: MealEntry) {
  openMealEdit(buildHistoryMealEditPayload(meal, selectedDateKey), "history");
}

{sortedMeals.map((meal) => (
  <div key={meal.id} className="sp-history-timeline-item">
    <span className="sp-history-timeline-node" aria-hidden="true" />
    <button
      type="button"
      className="sp-history-meal-row"
      aria-label={`編輯 ${getDisplayMealLabel(meal.mealPeriod, meal.loggedAt)} ${meal.foodName}`}
      onClick={(event) => {
        event.stopPropagation();
        onMealOpen(meal);
      }}
    >
```

**Eligibility fallback pattern** (from `MessageBubble.tsx` lines 73-89):
```tsx
const canEdit = editPayload !== null && onOpenMealEdit !== undefined;

function handleOpenReceipt() {
  if (!editPayload) {
    return;
  }
  onOpenMealEdit?.(editPayload);
}

function handleReceiptKeyDown(event: KeyboardEvent<HTMLDivElement>) {
  if (!canEdit || (event.key !== "Enter" && event.key !== " ")) {
    return;
  }

  event.preventDefault();
  handleOpenReceipt();
}
```

Use native `<button type="button">` for eligible Home rows if practical. If markup cannot use a native button, copy the `role`, `tabIndex`, `onKeyDown`, and nullable `canEdit` branch from `MessageBubble.tsx` lines 93-100.

### `client/src/components/HistoryScreen.tsx` (component, event-driven)

**Analog:** itself

**Open Meal Edit handoff** (lines 218-248):
```tsx
function TimelineRows({
  meals,
  selectedDateKey,
  todayKey,
  openDayDetail,
  openMealEdit,
}: {
  meals: MealEntry[];
  selectedDateKey: string;
  todayKey: string;
  openDayDetail: ReturnType<typeof useStore.getState>["openDayDetail"];
  openMealEdit: ReturnType<typeof useStore.getState>["openMealEdit"];
}) {
  const sortedMeals = [...meals].sort(
    (left, right) => new Date(left.loggedAt).getTime() - new Date(right.loggedAt).getTime(),
  );

  function onMealOpen(meal: MealEntry) {
    openMealEdit(buildHistoryMealEditPayload(meal, selectedDateKey), "history");
  }
```

Do not change this except if a shared safe payload helper changes the import or naming. It is the exact behavior Home should match with origin `"home"` and today date key.

### `client/src/components/MessageBubble.tsx` (component, event-driven)

**Analog:** itself

**Nullable edit payload pattern** (lines 29-35):
```typescript
function isCompleteLoggedMealReceipt(message: Message) {
  return getCompleteReceiptEditPayload(message) !== null;
}

export function getCompleteReceiptEditPayload(message: Message): MealEditPayload | null {
  return buildReceiptMealEditPayload(message.loggedMeal);
}
```

**Fallback accessibility pattern** (lines 91-100):
```tsx
<SportReceipt
  className={`sp-receipt-card${canEdit ? " sp-receipt-button" : ""}`}
  aria-label={canEdit ? `編輯 ${loggedMeal.foodName}` : undefined}
  onClick={canEdit ? handleOpenReceipt : undefined}
  onKeyDown={canEdit ? handleReceiptKeyDown : undefined}
  role={canEdit ? "button" : undefined}
  tabIndex={canEdit ? 0 : undefined}
>
```

Use this only if Home cannot use native button semantics. Home must not show disabled or explanatory copy for ineligible rows.

### `client/src/components/MealEditScreen.tsx` (component, request-response)

**Analog:** itself

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

**Origin back-label pattern to extend** (lines 267-271):
```typescript
const backLabel = origin === "chat" ? "返回對話" : origin === "history" ? "返回歷史" : "返回";
const goToChatCorrection = () => {
  closeSecondaryScreen();
  setActiveScreen("chat");
};
```

Add the Home-origin label here or via a small helper: `origin === "home" ? "返回首頁"`.

**Revision-safe save pattern** (lines 171-219):
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
    try {
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
    } catch {
      recordMealMutation(response.affectedDate);
    }
    onBack();
```

**Revision-safe delete pattern** (lines 222-264):
```typescript
async function handleDelete() {
  if (!payload || staleBlocked) {
    return;
  }

  if (!window.confirm("刪除這筆餐點？系統會保留歷史紀錄。")) {
    return;
  }

  setPending(true);
  setError(null);
  try {
    const { affectedDate, dailySummary } = await deleteMeal(payload.mealId, {
      expectedMealRevisionId: payload.mealRevisionId,
    });
    try {
      await refreshAfterMealMutation({
        redactChatReceiptIdentity,
        recordMealMutation,
        setDailySummary,
        getMeals,
        setMeals,
        todayKey: () => formatLocalDate(new Date()),
      }, {
        mealId: payload.mealId,
        affectedDate,
        dailySummary,
      });
    } catch {
      recordMealMutation(affectedDate);
    }
    onBack();
```

**Grouped lock pattern** (lines 297-338):
```tsx
if (payload.itemCount > 1) {
  return (
    <div className="absolute inset-0 z-50 flex flex-col bg-[var(--sp-bg)]">
      <SportScreen className="sp-meal-edit-screen">
        <header className="sp-meal-edit-header">
          <SportIconButton aria-label={backLabel} className="sp-meal-edit-back" onClick={onBack}>
            <SportChevronLeftIcon size={18} stroke={2} />
          </SportIconButton>
        </header>

        <main className="screen-scroll-safe sp-meal-edit-scroll sp-meal-edit-grouped-scroll">
          <MealEditImageFrame payload={payload} />
          <SportCard className="sp-meal-edit-grouped-lock">
            <div className="sp-meal-edit-grouped-label">組合餐點</div>
            <h2>這筆是組合餐點</h2>
            <p>
              包含 {payload.itemCount} 項：{payload.foodName}。請到「對話」說明要改哪一項或要調整整餐，避免把多項餐點合併成一項。
            </p>
            {payload.items && payload.items.length > 0 ? (
              <div className="sp-meal-edit-grouped-items" aria-label={`${payload.foodName} 項目明細`}>
                {payload.items.map((item) => (
```

Grouped Home rows should enter this branch unchanged; do not add direct grouped save/delete controls.

### `client/src/meal-edit-payload.ts` (utility, transform)

**Analog:** itself

**Authority and revision guard pattern** (lines 72-115):
```typescript
export function buildHistoryMealEditPayload(meal: MealEntry, dateKey: string): MealEditPayload {
  const mealRevisionId = getRequiredString(meal.mealRevisionId);
  if (!mealRevisionId) {
    throw new Error("MEAL_REVISION_REQUIRED");
  }

  if (
    typeof meal.id !== "string" ||
    meal.id.trim().length === 0 ||
    typeof meal.foodName !== "string" ||
    meal.foodName.trim().length === 0 ||
    !isFiniteNumber(meal.calories) ||
    !isFiniteNumber(meal.protein) ||
    !isFiniteNumber(meal.carbs) ||
    !isFiniteNumber(meal.fat) ||
    !isFiniteNumber(meal.itemCount) ||
    meal.itemCount <= 0 ||
    typeof meal.loggedAt !== "string" ||
    meal.loggedAt.trim().length === 0
  ) {
    throw new Error("MEAL_AUTHORITY_REQUIRED");
  }

  const items = normalizeMealItems((meal as { items?: unknown }).items);
  const mealPeriod = isValidMealPeriod((meal as { mealPeriod?: unknown }).mealPeriod)
    ? meal.mealPeriod
    : undefined;

  return {
    mealId: meal.id,
    mealRevisionId: mealRevisionId,
    dateKey,
```

**Nullable builder pattern** (lines 118-152):
```typescript
export function buildReceiptMealEditPayload(loggedMeal: LoggedMealReceipt | undefined): MealEditPayload | null {
  const mealRevisionId = getRequiredString(loggedMeal?.mealRevisionId);
  if (
    !loggedMeal ||
    !loggedMeal.mealId ||
    !mealRevisionId ||
    !loggedMeal.dateKey ||
    loggedMeal.foodName.trim().length === 0 ||
    !Number.isFinite(loggedMeal.calories) ||
    !Number.isFinite(loggedMeal.protein) ||
    !Number.isFinite(loggedMeal.carbs) ||
    !Number.isFinite(loggedMeal.fat)
  ) {
    return null;
  }
```

For Home, add a non-throwing wrapper around `buildHistoryMealEditPayload()` in this file if shared by tests and component. It should return `MealEditPayload | null`, swallow only the builder's defensive authority failures, and preserve grouped `items`, `imageAssetId`, `imageUrl`, `loggedAt`, and `mealPeriod`.

### `client/src/store.ts` (store, event-driven)

**Analog:** itself

**Store boundary pattern** (lines 87-91):
```typescript
setActiveScreen: (screen: ActiveScreen) => void;
openSecondaryScreen: (screen: Exclude<SecondaryScreen, "mealEdit">, origin?: PrimaryTab) => void;
openDayDetail: (payload: DayDetailPayload, origin?: PrimaryTab) => void;
openMealEdit: (payload: MealEditPayload, origin?: PrimaryTab) => void;
closeSecondaryScreen: () => void;
```

**Meal Edit transition** (lines 156-163):
```typescript
openMealEdit: (payload, origin) =>
  set((state) => ({
    secondaryScreen: {
      screen: "mealEdit",
      origin: origin ?? (state.activeScreen === "onboarding" ? "home" : state.activeScreen),
      payload,
    },
  })),
```

Home should call `openMealEdit(payload, "home")`; do not add a parallel route or store field.

### `client/src/contracts/capability-matrix.ts` (config, transform)

**Analog:** itself

**Home row currently stale** (lines 68-88):
```typescript
{
  surface: "Home",
  affordance: "Today meal rows and authorized thumbnails",
  sourceFile: "client/src/components/HomeScreen.tsx",
  sourceMatchers: ["MealRows", "home-sport-meal-row", "getMealMacroSummary"],
  handlerMatchers: ["openMealEdit"],
  supportState: "supported-read-only",
  placeholderShape: "row",
  clientApi: ["getMeals", "withAuthorizedAssetUrl"],
  storeAction: ["openMealEdit"],
  backendRoute: ["/api/meals", "/api/assets/:id"],
  backendService: ["createFoodLoggingService", "readOwnedAsset"],
  handlingDecision: "Home can show current meals and asset-backed images, with mutation delegated to the supported Meal Edit surface.",
  requirements: ["ALIGN-01", "ALIGN-03"],
  testCoverage: ["tests/unit/capability-matrix-contract.test.ts"],
  visibleCopy: "今日餐點",
  disabledEvidence: [],
  futurePhaseRef: "Meal Image Continuity",
  severity: "none",
  activeHandler: "present",
},
```

After implementation, make Home metadata match actual Home handler evidence. Include source matchers for the payload helper and `openMealEdit(payload, "home")`, and keep handler matchers close to the actionable row handler so `capability-matrix-source-scan.test.ts` can find them near the `onClick`.

**Day Detail row currently stale** (lines 267-286):
```typescript
{
  surface: "Day Detail",
  affordance: "Read-only day snapshot",
  sourceFile: "client/src/components/HistoryDayDetailScreen.tsx",
  sourceMatchers: ["getHistoryDaySnapshot", "payloadLabel", "歷史快照"],
  handlerMatchers: ["onBack", "openMealEdit"],
  supportState: "supported-read-only",
  placeholderShape: "card",
  clientApi: ["getHistoryDaySnapshot", "withAuthorizedAssetUrl"],
  storeAction: ["openMealEdit"],
  backendRoute: ["/api/history/days/:date", "/api/assets/:id"],
  backendService: ["createHistoryQueryService", "readOwnedAsset"],
  handlingDecision: "Historical day detail is read-only except for route-backed meal edit handoff.",
```

Remove Day Detail `openMealEdit` claims. If `activeHandler` remains `"present"`, keep `handlerMatchers: ["onBack"]` because `capability-matrix-contract.test.ts` requires non-empty handler matchers for component rows with active handlers.

### `client/src/app.css` (component styling, event-driven)

**Analog:** History row styles in `client/src/app.css`

**Current Home row base** (lines 913-923):
```css
.home-sport-meal-row {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 12px;
  border: 1px solid var(--sp-line);
  border-radius: var(--sp-r-md);
  background: var(--sp-surface);
  color: var(--sp-ink);
  padding: 12px 14px;
}
```

**Interactive row CSS pattern** (lines 3494-3498 and 3756-3775):
```css
.sp-history-week-day:focus-visible,
.sp-history-timeline:focus-visible,
.sp-history-meal-row:focus-visible {
  outline: 2px solid var(--sp-lime);
  outline-offset: 2px;
}

.sp-history-meal-row {
  display: flex;
  width: 100%;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border: 1px solid var(--sp-line);
  border-radius: var(--sp-r-md);
  background: var(--sp-surface);
  color: var(--sp-ink);
  padding: 12px 14px;
  text-align: left;
  cursor: pointer;
}

.sp-history-meal-row:hover {
  border-color: var(--sp-line-strong);
  background: var(--sp-surface-2);
}
```

Apply only to eligible interactive Home rows or to a class branch that does not make ineligible rows look disabled or clickable.

### `docs/capability-matrix.md` (generated docs, transform)

**Analog:** `scripts/generate-capability-matrix-doc.mjs`

**Generator pattern** (lines 3-8 and 62-71):
```javascript
import { readFile, writeFile } from "node:fs/promises";
import process from "node:process";
import { capabilityMatrix } from "../client/src/contracts/capability-matrix.ts";

const OUTPUT_PATH = "docs/capability-matrix.md";
const SOURCE_PATH = "client/src/contracts/capability-matrix.ts";

if (process.argv.includes(CHECK_FLAG)) {
  const currentContent = await readFile(OUTPUT_PATH, "utf8").catch(() => null);
  if (currentContent !== nextContent) {
    console.error(`${OUTPUT_PATH} is out of sync with ${SOURCE_PATH}`);
    process.exit(1);
  }
  process.exit(0);
}

await writeFile(OUTPUT_PATH, nextContent, "utf8");
```

Do not hand-edit generated Markdown only. Update `capability-matrix.ts`, run `yarn matrix:gen`, then verify with `yarn matrix:check`.

**Current generated stale rows** (lines 13 and 21):
```markdown
| Day Detail | Read-only day snapshot | client/src/components/HistoryDayDetailScreen.tsx | supported-read-only | getHistoryDaySnapshot<br>withAuthorizedAssetUrl<br>openMealEdit | /api/history/days/:date<br>/api/assets/:id<br>createHistoryQueryService<br>readOwnedAsset | Historical day detail is read-only except for route-backed meal edit handoff. | ALIGN-01<br>ALIGN-03 | none |
| Home | Today meal rows and authorized thumbnails | client/src/components/HomeScreen.tsx | supported-read-only | getMeals<br>withAuthorizedAssetUrl<br>openMealEdit | /api/meals<br>/api/assets/:id<br>createFoodLoggingService<br>readOwnedAsset | Home can show current meals and asset-backed images, with mutation delegated to the supported Meal Edit surface. | ALIGN-01<br>ALIGN-03 | Meal Image Continuity |
```

## Test Pattern Assignments

### `tests/unit/home-dashboard-contract.test.ts` (test, transform)

**Analog:** `tests/unit/history-screen-contract.test.ts`

**Source-contract test style** (Home lines 26-32):
```typescript
function sourcePath(relativePath: string) {
  return fileURLToPath(new URL(relativePath, import.meta.url));
}

async function readSource(relativePath: string) {
  return readFile(sourcePath(relativePath), "utf8");
}
```

**Current read-only assertion to replace** (Home lines 185-198):
```typescript
it("Home meal rows stay read-only and empty state routes through Chat", async () => {
  const homeSource = await readSource("../../client/src/components/HomeScreen.tsx");

  assert.match(homeSource, /<article key=\{meal\.id\} className="home-sport-meal-row">/);
  assert.match(homeSource, /getMealBadge\(meal\.mealPeriod, meal\.loggedAt\)/);
  assert.match(homeSource, /formatMealRowTime\(meal\.loggedAt\)/);
  assert.match(homeSource, /getDisplayMealLabel\(meal\.mealPeriod, meal\.loggedAt\)/);
  assert.match(homeSource, /getMealMacroSummary\(meal\)/);
  assert.match(homeSource, /Math\.max\(0, Math\.round\(meal\.calories\)\)/);
  assert.match(homeSource, /stageHomeTaskOptionPrompt\(prompt, setPendingHomeChatDraft, setActiveScreen\)/);
  assert.match(homeSource, /<button type="button" className="home-sport-empty-action" onClick=\{onEmptyChatClick\}>/);
  assert.doesNotMatch(homeSource, /<button[^>]+home-sport-meal-row/);
  assert.doesNotMatch(homeSource, /SportPlusIcon/);
});
```

Replace with assertions that eligible Home rows use native button semantics, call `openMealEdit(..., "home")`, use the safe builder, preserve existing display helpers, and keep ineligible rows silent/read-only.

**History edit-entry test pattern** (History test lines 60-70):
```typescript
it("opens Meal Edit from meal rows with complete History-origin payload", () => {
  for (const expected of [
    "buildHistoryMealEditPayload",
    "openMealEdit",
    "event.stopPropagation()",
    "buildHistoryMealEditPayload(meal, selectedDateKey)",
    '"history"',
  ]) {
    assert.match(source, escapedPattern(expected));
  }
});
```

### `tests/unit/meal-edit-payload.test.ts` (test, transform)

**Analog:** itself

**Imports pattern** (lines 1-10):
```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildHistoryMealEditPayload,
  buildReceiptMealEditPayload,
} from "../../client/src/meal-edit-payload.js";
import {
  normalizeHistoryMeal,
  normalizeLoggedMealReceipt,
} from "../../client/src/api.js";
```

**Authority rejection test pattern** (lines 244-272):
```typescript
it("rejects history edit payloads missing itemCount authority", () => {
  assert.throws(() => buildHistoryMealEditPayload({
    id: "legacy-history",
    mealRevisionId: "legacy-history:r1",
    foodName: "蘋果",
    calories: 95,
    protein: 0,
    carbs: 25,
    fat: 0.3,
    imageAssetId: null,
    imageUrl: null,
    loggedAt: "2026-05-06T08:00:00.000+08:00",
  } as any, "2026-05-06"), { message: "MEAL_AUTHORITY_REQUIRED" });
```

If a safe Home/history wrapper lands here, add tests proving complete rows return a payload, missing revision/core authority returns `null`, and grouped `items` are preserved.

### `tests/unit/meal-edit-screen.test.ts` (test, transform)

**Analog:** itself

**Revision and refresh contract assertions** (lines 41-59):
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
    "redactChatReceiptIdentity(mealId)",
    'getMeals({ refreshReason: "meal_mutation" })',
    "setMeals",
    "recoverGuestSession",
  ]) {
    assert.match(source, escapedPattern(expected));
  }
});
```

**Grouped lock assertions** (lines 142-176):
```typescript
it("locks direct editing for grouped Meal Edit payloads and points users to chat correction", () => {
  assert.match(source, /payload\.itemCount\s*>\s*1/);
  assert.match(source, escapedPattern("組合餐點"));
  assert.match(source, escapedPattern("這筆是組合餐點"));
  assert.match(source, /包含 \{payload\.itemCount\} 項：\{payload\.foodName\}/);
  assert.match(source, /payload\.items/);
  assert.match(source, escapedPattern("到對話修正"));

  const groupedBranch = source.match(/if \(payload\.itemCount\s*>\s*1\) \{[\s\S]+?sp-meal-edit-grouped-primary[\s\S]+?\n\s*\);\n\s*\}/)?.[0] ?? "";
  assert.match(groupedBranch, escapedPattern("sp-meal-edit-grouped-lock"));
  assert.match(groupedBranch, /payload\.items\.map/);
  assert.doesNotMatch(groupedBranch, escapedPattern("儲存"));
  assert.doesNotMatch(groupedBranch, /<input\b/);
  assert.doesNotMatch(groupedBranch, /sp-meal-edit-macro-field/);
  assert.doesNotMatch(groupedBranch, escapedPattern("刪除"));
});
```

Add a Home-origin back-label assertion near the existing origin-label contract after changing `MealEditScreen`.

### `tests/unit/history-day-detail-screen.test.ts` (test, transform)

**Analog:** itself

**Read-only proof pattern** (lines 78-93):
```typescript
it("does not expose edit, delete, save, correction, or live-summary mutation controls", () => {
  for (const rejected of [
    "deleteMeal",
    "onDelete",
    "調整",
    "刪除",
    "儲存",
    "新增餐點",
    "date picker",
    "openMealEdit",
    "setDailySummary",
    "setMeals",
  ]) {
    assert.doesNotMatch(detailSource, escapedPattern(rejected));
  }
});
```

Keep this test aligned with the Day Detail matrix fix: Day Detail should remain read-only and continue rejecting `openMealEdit`.

### `tests/unit/capability-matrix-contract.test.ts` (test, transform)

**Analog:** itself

**Active handler invariant** (lines 85-113):
```typescript
for (const [index, row] of rows.entries()) {
  const label = `row ${index} ${row.surface} ${row.affordance}`;

  assertNonEmptyString(row.surface, `${label} surface`);
  assertNonEmptyString(row.affordance, `${label} affordance`);
  assertNonEmptyString(row.sourceFile, `${label} sourceFile`);
  assertNonEmptyArray(row.sourceMatchers, `${label} sourceMatchers`);
  assertNonEmptyString(row.supportState, `${label} supportState`);
  assertNonEmptyString(row.placeholderShape, `${label} placeholderShape`);
  assertNonEmptyString(row.handlingDecision, `${label} handlingDecision`);
  assertNonEmptyArray(row.requirements, `${label} requirements`);
  assertNonEmptyArray(row.testCoverage, `${label} testCoverage`);

  if (row.activeHandler === "present" && row.sourceFile.startsWith("client/src/components/")) {
    assertNonEmptyArray(row.handlerMatchers, `${label} handlerMatchers`);
  }
}
```

**Contract reference invariant** (lines 184-197):
```typescript
const hasContractReference =
  row.clientApi.length > 0 ||
  row.storeAction.length > 0 ||
  row.backendRoute.length > 0 ||
  row.backendService.length > 0;
assert.ok(hasContractReference, `${row.surface} ${row.affordance} lacks a supported contract reference`);

for (const reference of row.storeAction) {
  assert.match(storeSource, new RegExp(`\\b${symbolFromReference(reference)}\\b`), `missing storeAction ${reference}`);
}
```

When removing Day Detail `openMealEdit`, ensure the row still has real contract references (`getHistoryDaySnapshot`, assets, routes, services) and a real handler matcher if active.

### `tests/unit/capability-matrix-source-scan.test.ts` (test, transform)

**Analog:** itself

**Handler scan pattern** (lines 149-157):
```typescript
function findHandlers(file: string, source: string): HandlerOccurrence[] {
  const handlers: HandlerOccurrence[] = [];
  const pattern = /\bon(Click|Submit|Change|KeyDown|PointerDown)=\{/g;
  for (const match of source.matchAll(pattern)) {
    const kind = `on${match[1]}` as HandlerKind;
    const index = match.index ?? 0;
    const line = lineNumberForIndex(source, index);
    handlers.push({ file, line, kind, snippet: lineAt(source, line) });
  }
  return handlers;
}
```

**Near-handler matrix matching** (lines 188-193):
```typescript
function hasMatrixRowNearHandler(handler: HandlerOccurrence, source: string) {
  const context = contextAroundLine(source, handler.line);
  return matrixRowsForFile(handler.file).some((row) =>
    row.activeHandler === "present" && (row.handlerMatchers ?? []).some((matcher) => sourceIncludesMatcher(context, matcher)),
  );
}
```

If Home adds a new `onClick` near `home-sport-meal-row`, update the Home matrix `handlerMatchers` to match nearby code. Do not add a broad scanner exclusion.

### `tests/integration/meals-api.test.ts` (test, request-response)

**Analog:** itself

**Missing/stale revision proof** (lines 500-611):
```typescript
const missingPatch = await app.inject({
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
assert.equal(missingPatch.statusCode, 409);
assert.deepEqual(missingPatch.json(), {
  error: "MEAL_REVISION_REQUIRED",
  mealId: meal.id,
  affectedDate: formatLocalDate(new Date(meal.loggedAt)),
  currentMealRevisionId: meal.mealRevisionId,
});

const stalePatch = await app.inject({
  method: "PATCH",
  url: `/api/meals/${meal.id}`,
  headers: { cookie: deviceCookieHeader },
  payload: {
    foodName: "雞胸肉沙拉全份",
    calories: 520,
    protein: 40,
    carbs: 18,
    fat: 24,
    imageAssetId: null,
    expectedMealRevisionId: meal.mealRevisionId,
  },
});
assert.equal(stalePatch.statusCode, 409);
assert.deepEqual(stalePatch.json(), {
  error: "MEAL_REVISION_STALE",
  mealId: meal.id,
  affectedDate: formatLocalDate(new Date(meal.loggedAt)),
  currentMealRevisionId,
});
```

Revalidate this existing integration test in Phase 74. No server change is expected.

## Shared Patterns

### Meal Edit State Boundary
**Source:** `client/src/store.ts` lines 156-163
**Apply to:** `HomeScreen`, `HistoryScreen`, `MessageBubble`, `MealEditScreen`
```typescript
openMealEdit: (payload, origin) =>
  set((state) => ({
    secondaryScreen: {
      screen: "mealEdit",
      origin: origin ?? (state.activeScreen === "onboarding" ? "home" : state.activeScreen),
      payload,
    },
  })),
```

### Payload Authority
**Source:** `client/src/meal-edit-payload.ts` lines 72-115
**Apply to:** `HomeScreen`, `HistoryScreen`, `MessageBubble`, `meal-edit-payload` tests
```typescript
if (!mealRevisionId) {
  throw new Error("MEAL_REVISION_REQUIRED");
}

if (
  typeof meal.id !== "string" ||
  meal.id.trim().length === 0 ||
  typeof meal.foodName !== "string" ||
  meal.foodName.trim().length === 0 ||
  !isFiniteNumber(meal.calories) ||
  !isFiniteNumber(meal.protein) ||
  !isFiniteNumber(meal.carbs) ||
  !isFiniteNumber(meal.fat) ||
  !isFiniteNumber(meal.itemCount) ||
  meal.itemCount <= 0 ||
  typeof meal.loggedAt !== "string" ||
  meal.loggedAt.trim().length === 0
) {
  throw new Error("MEAL_AUTHORITY_REQUIRED");
}
```

### Mutation Refresh
**Source:** `client/src/meal-edit-refresh.ts` lines 18-37
**Apply to:** `MealEditScreen`; do not add Home-specific post-edit refresh.
```typescript
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

### Generated Capability Docs
**Source:** `scripts/generate-capability-matrix-doc.mjs` lines 22-57 and 62-71
**Apply to:** `client/src/contracts/capability-matrix.ts`, `docs/capability-matrix.md`, matrix tests
```javascript
const nextContent = renderMarkdown();

if (process.argv.includes(CHECK_FLAG)) {
  const currentContent = await readFile(OUTPUT_PATH, "utf8").catch(() => null);
  if (currentContent !== nextContent) {
    console.error(`${OUTPUT_PATH} is out of sync with ${SOURCE_PATH}`);
    process.exit(1);
  }
  process.exit(0);
}

await writeFile(OUTPUT_PATH, nextContent, "utf8");
```

## No Analog Found

None. All phase files have exact or role-match analogs in the current codebase.

## Verification Patterns

Use repo-native commands only:

```bash
node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/home-dashboard-contract.test.ts tests/unit/meal-edit-payload.test.ts tests/unit/meal-edit-screen.test.ts tests/unit/meal-edit-refresh.test.ts
yarn matrix:gen
yarn matrix:check
node scripts/run-node-with-tz.mjs --import tsx --test tests/integration/meals-api.test.ts
yarn tsc --noEmit
```

Per `AGENTS.md`, use `yarn` only and preserve `TZ=Asia/Taipei`.

## Metadata

**Analog search scope:** `client/src/components`, `client/src`, `client/src/contracts`, `tests/unit`, `tests/integration`, `docs`, `scripts`
**Files scanned:** 100+ via `rg --files`; 17 files read with line numbers
**Pattern extraction date:** 2026-06-02
