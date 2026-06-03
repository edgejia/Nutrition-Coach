# Phase 76: Grouped Meal Edit UI and Conditional Item Media Decision - Research

**Researched:** 2026-06-03  
**Domain:** React Meal Edit UI, grouped meal PATCH transport, authoritative meal DTO refresh  
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

The following locked decisions, discretion areas, and deferred ideas are copied verbatim from `.planning/phases/76-grouped-meal-edit-ui-and-conditional-item-media-decision/76-CONTEXT.md`. [VERIFIED: 76-CONTEXT.md]

### Locked Decisions

#### Media Decision

- **D-01:** Keep whole-meal photo identity only for Phase 76. Item rows edit text and nutrition only; the existing image remains meal-level context and source of truth, not item-level evidence.
- **D-02:** Do not imply per-item crops, item-photo mappings, or per-item media evidence in UI copy or data shape. Existing copy may be kept or lightly refined to make clear that the photo represents the whole meal.
- **D-03:** Defer item-level photo mapping until a later phase creates an explicit persistence, DTO, and evidence contract for it. Phase 75 preserves the whole-meal image when grouped updates omit image input; `MealItemDetail` remains media-free in Phase 76.

#### Row Editing Model

- **D-04:** Use compact grouped item summary rows with edit expansion. The editor keeps a full draft `items[]` internally while only one row is expanded for editing on mobile.
- **D-05:** Collapsed rows show item name plus compact macro summary, for example `雞腿 · 340 kcal · P32 · C2 · F18`, so users can scan and verify the whole meal without expanding every row. This is a new compact summary format that preserves the same nutrition facts currently available in the grouped read-only multi-line macro display.
- **D-06:** Expanded rows edit exactly the Phase 75 public item write fields: `name`, `calories`, `protein`, `carbs`, and `fat`. `position` is derived from list order and is not user-editable.
- **D-07:** Show live aggregate calories, protein, carbs, and fat totals computed from the draft `items[]` while editing. Original totals must not remain displayed as if current after draft edits.
- **D-08:** Saving a grouped edit submits the complete ordered draft `items[]`; the UI does not submit partial item operations.

#### Add/Delete Behavior

- **D-09:** Place the Add item button below the item list. Adding an item is a list-level draft construction action, not a footer commit action and not a per-row insertion action.
- **D-10:** Tapping Add item creates a new empty draft row, appends it to the end of the visible draft list, and expands it immediately.
- **D-11:** Use row-level delete for item removal. Normal many-to-one or many-to-many cleanup should not ask for confirmation on every item deletion.
- **D-12:** Normal non-final item deletion saves via the grouped full-list PATCH by omitting that item from the resulting non-empty `items[]`. Deleting down to one remaining item is allowed.
- **D-13:** If deleting a row would leave zero items, block the row-level delete and explain that at least one item is required. Do not send empty `items[]`, do not silently convert row delete into a grouped PATCH, and do not silently convert row delete into whole-meal `DELETE`.
- **D-14:** Users who intend to remove the whole meal should use the existing whole-meal Delete action, which continues to call `DELETE /api/meals/:id` with its existing confirmation and revision check.
- **D-15:** Do not include explicit item reordering controls in Phase 76. Preserve existing item order, append new items to the end, and let deletion close gaps.
- **D-16:** On save, rebuild submitted item positions from the visible draft order as contiguous zero-based positions because the backend requires `position === array index`.

#### Validation and Recovery

- **D-17:** Use inline per-row or per-field errors plus a top-level save error. Row errors show exactly what to fix; the top-level error explains that the save did not happen.
- **D-18:** Client validation must catch blank item names, blank nutrition fields, non-numeric values, and negative values before submitting. Server validation remains a safety net, not the primary user flow.
- **D-19:** If save is attempted with invalid rows, keep or open the first invalid row, show inline row/field errors, block Save, and show a top-level failed-save message.
- **D-20:** Server validation, stale revision, and generic mutation failures use the top-level error area because they are not necessarily tied to one row.
- **D-21:** Grouped stale revision conflicts reuse the existing stale-blocked Meal Edit recovery: on `MEAL_REVISION_REQUIRED` or `MEAL_REVISION_STALE`, show stale/revision copy, mark the edit stale-blocked, disable Save and Delete, record meal mutation state, refresh today rows if affected date is today, and offer the existing reload/back action.
- **D-22:** After a successful grouped save, reuse `refreshAfterMealMutation` and close Meal Edit. Do not patch the local draft directly into store and do not keep the editor open for continued edits in Phase 76.
- **D-23:** Confirm only when the grouped draft is dirty. Unchanged grouped drafts exit immediately on back/cancel; changed, added, or deleted item drafts ask once before discarding.
- **D-24:** Unauthorized recovery follows the existing Meal Edit pattern: `UNAUTHORIZED` calls `recoverGuestSession()`, without a new visible top-level error decision. Unsupported-state copy can be handled during planning/UI copy without additional product decision.

### the agent's Discretion

Planner may choose exact component/helper names, whether grouped draft parsing stays inside `MealEditScreen` or moves into a small local helper, exact Traditional Chinese field/error copy, and exact test naming. Planner should preserve the existing Meal Edit visual language, use existing transport/store boundaries, and keep the implementation scoped to grouped item editing rather than a wider screen redesign.

### Deferred Ideas (OUT OF SCOPE)

- Item-level photo mapping, crops, or per-item media evidence require a later phase with explicit persistence, DTO, and evidence contracts.
- Explicit item reordering controls are deferred; Phase 76 preserves order, appends new items, and compacts positions on save.
- Stable cross-revision item IDs remain deferred from Phase 75 unless a future phase needs cross-revision item identity or partial item operations.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| GROUP-UI-01 | Meal Edit renders grouped meal items as editable rows with clear controls for edit, add, and delete. [VERIFIED: .planning/REQUIREMENTS.md] | Replace the current grouped-lock branch in `MealEditScreen` with an item draft editor; use Phase 75 write fields only. [VERIFIED: client/src/components/MealEditScreen.tsx; VERIFIED: 75-CONTEXT.md] |
| GROUP-UI-02 | Meal Edit surfaces validation errors, stale revision conflicts, and unsupported states without implying a successful mutation. [VERIFIED: .planning/REQUIREMENTS.md] | Reuse current `MealRevisionConflictError` handling and add row-level draft validation before grouped PATCH submit. [VERIFIED: client/src/components/MealEditScreen.tsx; VERIFIED: client/src/api.ts] |
| GROUP-UI-03 | Successful grouped edits refresh affected meal, summary, and history state through existing authoritative DTO and store paths. [VERIFIED: .planning/REQUIREMENTS.md] | Reuse `refreshAfterMealMutation`; verify `/api/meals` can provide grouped `items[]` for Home/opened rows after refresh. [VERIFIED: client/src/meal-edit-refresh.ts; VERIFIED: server/routes/meals.ts] |
| MEDIA-DECISION-01 | Item-level photo mapping is either implemented because grouped item editing requires it or explicitly deferred with a source-of-truth note. [VERIFIED: .planning/REQUIREMENTS.md] | Defer item-level mapping and keep `MealItemDetail` media-free; preserve whole-meal image by omitting `imageAssetId` from grouped PATCH. [VERIFIED: 76-CONTEXT.md; VERIFIED: client/src/types.ts; VERIFIED: server/routes/meals.ts] |
</phase_requirements>

## Summary

Phase 76 should be planned as a scoped UI and DTO-completeness phase, not a new mutation-contract phase. [VERIFIED: 75-CONTEXT.md; VERIFIED: 76-CONTEXT.md] Phase 75 already implemented strict grouped full-list replacement through `PATCH /api/meals/:id`, including zero-based item positions, revision checks, image preservation, and summary/history freshness behavior. [VERIFIED: server/routes/meals.ts; VERIFIED: tests/integration/meals-api.test.ts]

The main planning risk is that Home opens Meal Edit from `/api/meals`, and the current `/api/meals` response preserves grouped `itemCount` but strips item detail, while History payload builders already preserve grouped item details when they are present. [VERIFIED: tests/integration/meals-api.test.ts; VERIFIED: client/src/meal-edit-payload.ts; VERIFIED: server/routes/meals.ts] To satisfy GROUP-UI-01 from Home without inventing a second local source of truth, plan a small authoritative DTO read-path update so grouped today rows can include flat `items[]`, then let `refreshAfterMealMutation` continue to refresh through the existing `getMeals` and store path. [VERIFIED: client/src/meal-edit-refresh.ts; VERIFIED: client/src/api.ts]

**Primary recommendation:** Implement grouped item editing in `MealEditScreen`, expand `UpdateMealInput` to a scalar-or-grouped union, add or expose grouped item details through the existing `/api/meals` DTO path, and explicitly keep item media deferred through code/test/source notes tied to `MealItemDetail` and whole-meal image copy. [VERIFIED: client/src/components/MealEditScreen.tsx; VERIFIED: client/src/types.ts; VERIFIED: 76-CONTEXT.md]

## Project Constraints (from AGENTS.md)

- Use `yarn` only; do not introduce `npm` commands into project workflow plans. [VERIFIED: AGENTS.md]
- Keep implementation surgical and avoid broad Meal Edit visual redesign or unrelated refactors. [VERIFIED: AGENTS.md; VERIFIED: 76-CONTEXT.md]
- `client/src/store.ts` is the single Zustand state boundary; `client/src/api.ts` and `client/src/sse.ts` own client transport helpers. [VERIFIED: AGENTS.md]
- `server/routes/*.ts` own HTTP validation, auth checks, and response shaping; `server/services/*.ts` own reusable domain and persistence logic. [VERIFIED: AGENTS.md]
- The repo is ESM and local TypeScript imports use explicit `.js` specifiers. [VERIFIED: AGENTS.md; VERIFIED: package.json]
- `TZ=Asia/Taipei` is required for local and test setups. [VERIFIED: AGENTS.md]
- Use Node built-in `node:test`; do not introduce Jest or Vitest without an explicit migration. [VERIFIED: AGENTS.md]
- Use real SQLite in tests; `:memory:` is acceptable, DB mocking is not. [VERIFIED: AGENTS.md]
- Treat `tests/harness/artifacts/**` as generated evidence and do not hand-edit artifacts. [VERIFIED: AGENTS.md]
- For any `*.ts` edit run `yarn tsc --noEmit`; for `tests/unit/*.test.ts` run `yarn test:unit`; for `server/routes/*.ts` or `server/services/*.ts` run `yarn test:integration`. [VERIFIED: AGENTS.md]
- Do not promote or touch `main`; `staging` and `main` promotion require explicit current-thread approval, and `yarn release:check` is required before merges to those branches. [VERIFIED: AGENTS.md]

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Grouped item row editing | Browser / Client | API / Backend | Draft editing, row expansion, dirty prompts, and live aggregate totals are local UI responsibilities; backend remains the final validation authority. [VERIFIED: 76-CONTEXT.md; VERIFIED: server/routes/meals.ts] |
| Grouped item write contract | API / Backend | Browser / Client | The route enforces exact item shape, no mixed scalar/image fields, and contiguous positions; the client should pre-validate to make failures recoverable. [VERIFIED: server/routes/meals.ts; VERIFIED: 76-CONTEXT.md] |
| Grouped item read availability | API / Backend | Browser / Client | Home Meal Edit needs item details from an authoritative DTO; current `/api/meals` rows expose aggregates but not `items[]`. [VERIFIED: tests/integration/meals-api.test.ts; VERIFIED: client/src/meal-edit-payload.ts] |
| Revision conflict recovery | API / Backend | Browser / Client | The backend returns structured 409 revision errors; the screen already stale-blocks edits, refreshes affected today rows, and offers reload/back recovery. [VERIFIED: client/src/api.ts; VERIFIED: client/src/components/MealEditScreen.tsx] |
| Post-mutation refresh | Browser / Client | API / Backend | `refreshAfterMealMutation` redacts receipt identity, records mutation state, applies same-day summaries, and refreshes today meals via `getMeals`. [VERIFIED: client/src/meal-edit-refresh.ts] |
| Whole-meal media decision | Browser / Client | API / Backend | The UI copy and type shape must avoid item media implications; grouped PATCH omits image input so the existing meal image is preserved. [VERIFIED: client/src/components/MealEditScreen.tsx; VERIFIED: client/src/types.ts; VERIFIED: server/routes/meals.ts] |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| React | Declared `^19.0.0`; registry latest `19.2.7` published 2026-06-01. [VERIFIED: package.json; VERIFIED: yarn info react version/time] | Meal Edit component rendering and state-driven UI. [VERIFIED: client/src/components/MealEditScreen.tsx] | Already used by the client; no new UI framework should be introduced. [VERIFIED: package.json] |
| Zustand | Declared `^5.0.0`; registry latest `5.0.14` published 2026-05-28. [VERIFIED: package.json; VERIFIED: yarn info zustand version/time] | Central client store and Meal Edit open/close state. [VERIFIED: client/src/store.ts] | Existing store boundary is mandated by project guidance. [VERIFIED: AGENTS.md] |
| TypeScript | Declared `^5.7.0`; registry latest `6.0.3` observed. [VERIFIED: package.json; VERIFIED: yarn info typescript version] | Shared DTO/input types and compile-time contract checks. [VERIFIED: client/src/types.ts] | Existing codebase language and verification gate. [VERIFIED: package.json; VERIFIED: AGENTS.md] |
| Fastify | Declared `5.8.5`; registry latest `5.8.5` observed. [VERIFIED: package.json; VERIFIED: yarn info fastify version] | Existing `/api/meals` route if grouped item read DTO must be exposed. [VERIFIED: server/routes/meals.ts] | Current backend transport framework. [VERIFIED: package.json] |

### Supporting

| Library / Tool | Version | Purpose | When to Use |
|----------------|---------|---------|-------------|
| Node.js | `v24.14.0` installed. [VERIFIED: node --version] | Runtime and Node test runner. [VERIFIED: package.json scripts] | Run targeted unit/integration tests and TypeScript gates. [VERIFIED: package.json] |
| Yarn Classic | `1.22.22` installed. [VERIFIED: yarn --version] | Package/script runner. [VERIFIED: AGENTS.md] | Use for all project scripts; do not use `npm`. [VERIFIED: AGENTS.md] |
| tsx | Declared `^4.19.0`; registry latest `4.22.4` observed. [VERIFIED: package.json; VERIFIED: yarn info tsx version] | TypeScript execution for tests and server scripts. [VERIFIED: package.json scripts] | Existing test scripts invoke `--import tsx`. [VERIFIED: package.json] |
| Vite | Declared `^6.2.0`; registry latest `8.0.16` observed. [VERIFIED: package.json; VERIFIED: yarn info vite version] | Client build/dev tooling. [VERIFIED: package.json scripts] | No Phase 76 Vite changes are needed unless visual verification requires local client dev. [VERIFIED: package.json] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Existing `MealEditScreen` state and helpers | New grouped editor route/screen | New route would duplicate revision, delete, stale, and refresh behavior that already exists in Meal Edit. [VERIFIED: client/src/components/MealEditScreen.tsx] |
| Existing `/api/meals` DTO path for grouped `items[]` | Separate edit-detail endpoint | A new endpoint can work, but it adds a second read path to refresh and test; existing success criteria explicitly prefer existing authoritative DTO/store paths. [VERIFIED: .planning/REQUIREMENTS.md; VERIFIED: client/src/meal-edit-refresh.ts] |
| Node built-in tests | Jest or Vitest | Project guidance forbids introducing Jest/Vitest without explicit migration. [VERIFIED: AGENTS.md] |

**Installation:** No external packages are recommended for Phase 76. [VERIFIED: package.json; VERIFIED: 76-CONTEXT.md]

```bash
# No install step.
yarn tsc --noEmit
```

**Version verification:** Package versions above were checked with `yarn info <package> version` and, where needed, `yarn info <package> time` because project policy uses Yarn. [VERIFIED: AGENTS.md; VERIFIED: yarn info]

## Package Legitimacy Audit

Phase 76 should not install external packages. [VERIFIED: 76-CONTEXT.md; VERIFIED: package.json] The Package Legitimacy Gate was not run because there are no recommended new dependencies to audit. [VERIFIED: package.json]

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| None | — | — | — | — | Not run | No install planned. [VERIFIED: package.json] |

**Packages removed due to slopcheck [SLOP] verdict:** none. [VERIFIED: package.json]  
**Packages flagged as suspicious [SUS]:** none. [VERIFIED: package.json]

## Architecture Patterns

### System Architecture Diagram

```text
Home / History / Chat Meal Edit entry
  -> build MealEditPayload
  -> MealEditScreen
      -> if scalar: existing scalar draft path
      -> if grouped with items[]: grouped row draft editor
      -> if grouped without items[]: visible unsupported/reload path
      -> client row validation
          -> invalid: inline row errors + top-level failed-save copy
          -> valid: updateMeal(mealId, { expectedMealRevisionId, items })
              -> PATCH /api/meals/:id
                  -> exact grouped body parser
                  -> revision guard
                  -> full-list replacement
                  -> aggregate meal + summaryOutcome response
              -> refreshAfterMealMutation
                  -> redact receipt identity
                  -> record mutation state
                  -> apply same-day dailySummary if returned
                  -> getMeals({ refreshReason: "meal_mutation" })
                  -> setMeals(authoritative DTO rows)
              -> close Meal Edit
```

This flow preserves the Phase 75 mutation contract and uses existing post-commit refresh behavior. [VERIFIED: 75-CONTEXT.md; VERIFIED: server/routes/meals.ts; VERIFIED: client/src/meal-edit-refresh.ts]

### Recommended Project Structure

```text
client/src/
├── components/MealEditScreen.tsx       # Replace grouped lock branch with grouped editor UI. [VERIFIED: client/src/components/MealEditScreen.tsx]
├── meal-edit-grouped-draft.ts          # Recommended small pure helper for grouped draft parsing/validation. [ASSUMED]
├── types.ts                            # Expand UpdateMealInput to scalar-or-grouped union. [VERIFIED: client/src/types.ts]
├── api.ts                              # Keep transport helper; typed grouped body pass-through. [VERIFIED: client/src/api.ts]
└── meal-edit-refresh.ts                # Reuse unchanged for grouped save success. [VERIFIED: client/src/meal-edit-refresh.ts]

server/
├── services/meal-history.ts            # If Home rows need items, include revision item detail in meal history entries. [VERIFIED: server/services/meal-history.ts]
└── routes/meals.ts                     # If needed, expose flat items[] on GET /api/meals without changing PATCH. [VERIFIED: server/routes/meals.ts]

tests/
├── unit/meal-edit-screen.test.ts       # Replace grouped-lock source contracts with grouped editor contracts. [VERIFIED: tests/unit/meal-edit-screen.test.ts]
├── unit/api-client.test.ts             # Add grouped update body/conflict transport proof. [VERIFIED: tests/unit/api-client.test.ts]
├── unit/meal-edit-payload.test.ts      # Preserve grouped items and image identity proof. [VERIFIED: tests/unit/meal-edit-payload.test.ts]
└── integration/meals-api.test.ts       # Add/update /api/meals grouped items projection proof if DTO path changes. [VERIFIED: tests/integration/meals-api.test.ts]
```

### Pattern 1: Scalar-or-Grouped Update Input

**What:** Type `UpdateMealInput` as mutually exclusive scalar and grouped shapes so client call sites cannot accidentally mix `items[]` with scalar fields or `imageAssetId`. [VERIFIED: client/src/types.ts; VERIFIED: server/routes/meals.ts]

**When to use:** Use grouped input when `payload.itemCount > 1` and authoritative `payload.items` are present. [VERIFIED: client/src/components/MealEditScreen.tsx; VERIFIED: client/src/meal-edit-payload.ts]

**Example:**

```ts
// Source: server/routes/meals.ts and client/src/types.ts
type ScalarUpdateMealInput = {
  expectedMealRevisionId: string;
  foodName: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  imageAssetId?: string | null;
};

type GroupedUpdateMealInput = {
  expectedMealRevisionId: string;
  items: MealItemDetail[];
};

export type UpdateMealInput = ScalarUpdateMealInput | GroupedUpdateMealInput;
```

### Pattern 2: Build Positions at Submit Time

**What:** Keep draft order as UI state and assign contiguous zero-based `position` values immediately before calling `updateMeal`. [VERIFIED: 76-CONTEXT.md; VERIFIED: server/routes/meals.ts]

**When to use:** Use for grouped save after validation passes and before PATCH body construction. [VERIFIED: 76-CONTEXT.md]

**Example:**

```ts
// Source: 76-CONTEXT.md and server/routes/meals.ts
const items = validDraft.items.map((item, index) => ({
  name: item.name.trim(),
  position: index,
  calories: item.calories,
  protein: item.protein,
  carbs: item.carbs,
  fat: item.fat,
}));
```

### Pattern 3: Reuse Stale Conflict Recovery

**What:** The existing screen turns `MealRevisionConflictError` into stale-blocked UI state, records mutation state, refreshes same-day rows, disables Save/Delete, and offers reload/back. [VERIFIED: client/src/components/MealEditScreen.tsx]

**When to use:** Use the same handler for grouped save failures with `MEAL_REVISION_REQUIRED` or `MEAL_REVISION_STALE`. [VERIFIED: client/src/api.ts; VERIFIED: 76-CONTEXT.md]

**Example:**

```ts
// Source: client/src/components/MealEditScreen.tsx
if (error instanceof MealRevisionConflictError) {
  await handleMealRevisionConflict(error, "save");
  return;
}
```

### Pattern 4: Preserve Whole-Meal Media

**What:** Do not send `imageAssetId` with grouped `items[]`; server-side grouped replacement preserves the existing meal image by omitting image input. [VERIFIED: server/routes/meals.ts; VERIFIED: 75-CONTEXT.md]

**When to use:** Use for every grouped PATCH in Phase 76. [VERIFIED: 76-CONTEXT.md]

**Example:**

```ts
// Source: server/routes/meals.ts
await updateMeal(payload.mealId, {
  expectedMealRevisionId: payload.mealRevisionId,
  items,
});
```

### Anti-Patterns to Avoid

- **Treating read normalization as write normalization:** `api.ts` tolerates and sorts item data on read, but grouped writes must submit strict flat item objects with `position === array index`. [VERIFIED: client/src/api.ts; VERIFIED: server/routes/meals.ts]
- **Patching local store after save:** Success should close Meal Edit after `refreshAfterMealMutation`, not manually splice grouped draft data into store. [VERIFIED: 76-CONTEXT.md; VERIFIED: client/src/meal-edit-refresh.ts]
- **Converting final item delete to whole-meal delete:** Row delete must block when it would create empty `items[]`; whole-meal Delete remains a separate confirmed action. [VERIFIED: 76-CONTEXT.md]
- **Adding per-item media fields:** `MealItemDetail` has no media fields and Phase 76 explicitly defers item-level photo mapping. [VERIFIED: client/src/types.ts; VERIFIED: 76-CONTEXT.md]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Grouped mutation persistence | Custom client-side item mutation or partial item operation model | Existing Phase 75 full-list grouped PATCH | Backend already validates full-list replacement, revision checks, summary freshness, and image preservation. [VERIFIED: server/routes/meals.ts; VERIFIED: tests/integration/meals-api.test.ts] |
| Post-save refresh | Manual local store patch of aggregate and item rows | `refreshAfterMealMutation` | Existing helper coordinates receipt redaction, mutation nonce, daily summary, and same-day meals refresh. [VERIFIED: client/src/meal-edit-refresh.ts] |
| Revision recovery | New grouped-specific stale flow | Existing `MealRevisionConflictError` and stale-blocked screen state | Current Meal Edit already handles structured revision conflicts and recovery. [VERIFIED: client/src/api.ts; VERIFIED: client/src/components/MealEditScreen.tsx] |
| Client transport | Separate fetch helper for grouped meals | Existing `updateMeal` with expanded input type | The route path and response normalization are shared with scalar edit. [VERIFIED: client/src/api.ts; VERIFIED: server/routes/meals.ts] |
| Item media evidence | Per-row crop/mapping convention | Explicit deferral and whole-meal media copy | No persistence, DTO, or evidence contract exists for item-level media in Phase 76. [VERIFIED: 76-CONTEXT.md; VERIFIED: client/src/types.ts] |

**Key insight:** The hard behavior is already standardized at the route/service boundary; Phase 76 should plan a small client editor plus DTO-read completeness, not invent a second grouped editing domain model. [VERIFIED: server/routes/meals.ts; VERIFIED: client/src/components/MealEditScreen.tsx]

## Common Pitfalls

### Pitfall 1: Home Grouped Rows May Not Have Items

**What goes wrong:** Meal Edit opens a grouped payload from Home with `itemCount > 1` but no `items[]`, so the editor has no item-level source for rows. [VERIFIED: tests/integration/meals-api.test.ts; VERIFIED: client/src/meal-edit-payload.ts]

**Why it happens:** The current `/api/meals` route response test preserves grouped `itemCount` and aggregate fields, but not item details. [VERIFIED: tests/integration/meals-api.test.ts]

**How to avoid:** Plan either an existing DTO path enhancement for `/api/meals` to return flat `items[]` or a visible unsupported/reload state plus a separate authoritative fetch; prefer `/api/meals` enhancement because GROUP-UI-03 requires existing authoritative DTO/store paths. [VERIFIED: .planning/REQUIREMENTS.md; VERIFIED: client/src/meal-edit-refresh.ts]

**Warning signs:** Grouped branch renders controls only for History but not Home, or tests pass with synthetic `payload.items` while Home paths are unproven. [VERIFIED: 74-CONTEXT.md; VERIFIED: tests/unit/meal-edit-payload.test.ts]

### Pitfall 2: Mixed Grouped PATCH Payloads

**What goes wrong:** Sending `items[]` with scalar fields or `imageAssetId` returns server validation errors. [VERIFIED: server/routes/meals.ts; VERIFIED: tests/integration/meals-api.test.ts]

**Why it happens:** Phase 75 intentionally made grouped replacement mutually exclusive with scalar update and image change. [VERIFIED: 75-CONTEXT.md; VERIFIED: server/routes/meals.ts]

**How to avoid:** Type `UpdateMealInput` as a union and construct grouped payloads with only `expectedMealRevisionId` and `items`. [VERIFIED: client/src/types.ts; VERIFIED: server/routes/meals.ts]

**Warning signs:** Client tests assert grouped update includes `imageAssetId`, `foodName`, or top-level nutrition fields. [VERIFIED: tests/integration/meals-api.test.ts]

### Pitfall 3: Invalid Position Rebuild

**What goes wrong:** Deleting or adding rows leaves gaps or stale `position` values, causing 400 responses. [VERIFIED: server/routes/meals.ts; VERIFIED: tests/integration/meals-api.test.ts]

**Why it happens:** The backend requires every item position to equal its array index. [VERIFIED: server/routes/meals.ts]

**How to avoid:** Ignore stored draft positions for writes and derive positions from visible order at submit time. [VERIFIED: 76-CONTEXT.md]

**Warning signs:** Draft model treats `position` as user-editable or preserves old positions after deletion. [VERIFIED: 76-CONTEXT.md]

### Pitfall 4: Stale Conflicts Look Like Save Success

**What goes wrong:** The UI closes or refreshes as if a grouped edit succeeded after a revision conflict. [VERIFIED: 76-CONTEXT.md]

**Why it happens:** Grouped save is a new branch and can accidentally bypass the existing `MealRevisionConflictError` handler. [VERIFIED: client/src/components/MealEditScreen.tsx]

**How to avoid:** Route grouped save through the same catch path as scalar save and stale-block the editor. [VERIFIED: client/src/components/MealEditScreen.tsx; VERIFIED: client/src/api.ts]

**Warning signs:** Tests only verify the scalar stale path, or grouped Save remains enabled after a 409. [VERIFIED: tests/unit/meal-edit-screen.test.ts]

### Pitfall 5: Media Copy Implies Item Evidence

**What goes wrong:** Per-row UI text suggests the whole-meal photo proves each item or has item-level crops. [VERIFIED: 76-CONTEXT.md]

**Why it happens:** Grouped rows sit below a meal image, so row-level labels can accidentally imply photo-to-food mapping. [VERIFIED: 76-CONTEXT.md]

**How to avoid:** Keep the existing whole-meal image frame copy and add tests/source notes that `MealItemDetail` remains media-free. [VERIFIED: client/src/components/MealEditScreen.tsx; VERIFIED: client/src/types.ts]

**Warning signs:** New code introduces item `image`, `crop`, `asset`, `evidence`, or upload affordances. [VERIFIED: client/src/types.ts; VERIFIED: 76-CONTEXT.md]

## Code Examples

Verified patterns from project sources:

### Grouped Draft Validation Shape

```ts
// Source: 76-CONTEXT.md and server/routes/meals.ts
type GroupedDraftRow = {
  name: string;
  calories: string;
  protein: string;
  carbs: string;
  fat: string;
};

type ParsedGroupedDraft =
  | { ok: true; items: MealItemDetail[]; totals: { calories: number; protein: number; carbs: number; fat: number } }
  | { ok: false; firstInvalidIndex: number; rowErrors: Record<number, Partial<Record<keyof GroupedDraftRow, string>>> };
```

This helper shape is recommended so row validation and position compaction can be tested without relying only on source-string tests. [ASSUMED]

### Existing Refresh Helper Usage

```ts
// Source: client/src/components/MealEditScreen.tsx and client/src/meal-edit-refresh.ts
await refreshAfterMealMutation(
  {
    getMeals,
    setMeals,
    setDailySummary,
    recordMealMutation,
    redactChatReceiptIdentity,
  },
  {
    mealId: payload.mealId,
    affectedDate: response.affectedDate,
    dailySummary: response.dailySummary ?? null,
  },
);
```

Use the same pattern after grouped save success. [VERIFIED: client/src/components/MealEditScreen.tsx; VERIFIED: client/src/meal-edit-refresh.ts]

### Unsupported Grouped Payload State

```ts
// Source: client/src/meal-edit-payload.ts and tests/integration/meals-api.test.ts
if (payload.itemCount > 1 && (!payload.items || payload.items.length === 0)) {
  // Show a recoverable unsupported state instead of pretending item editing is available.
}
```

This guard is needed unless the plan first guarantees grouped `items[]` through every Meal Edit entry DTO. [VERIFIED: client/src/meal-edit-payload.ts; VERIFIED: tests/integration/meals-api.test.ts]

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Grouped Meal Edit is read-only and points users to chat correction. [VERIFIED: client/src/components/MealEditScreen.tsx] | Phase 76 should render grouped item rows and submit full-list grouped PATCH. [VERIFIED: 76-CONTEXT.md; VERIFIED: 75-CONTEXT.md] | Planned for Phase 76 on 2026-06-03. [VERIFIED: 76-CONTEXT.md] | Replace grouped lock tests with edit/add/delete/validation tests. [VERIFIED: tests/unit/meal-edit-screen.test.ts] |
| Grouped direct CRUD was unsupported at route level. [VERIFIED: 74-CONTEXT.md] | Phase 75 added strict full-list grouped replacement with revision checks. [VERIFIED: server/routes/meals.ts; VERIFIED: tests/integration/meals-api.test.ts] | Phase 75 complete before Phase 76. [VERIFIED: .planning/ROADMAP.md] | Client can now use direct grouped PATCH instead of chat correction. [VERIFIED: 75-CONTEXT.md] |
| Item-level photo mapping was unresolved. [VERIFIED: .planning/REQUIREMENTS.md] | Phase 76 locks whole-meal photo identity and explicitly defers item-level mapping. [VERIFIED: 76-CONTEXT.md] | Phase 76 context gathered 2026-06-03. [VERIFIED: 76-CONTEXT.md] | UI and tests must avoid per-item media fields/copy. [VERIFIED: 76-CONTEXT.md; VERIFIED: client/src/types.ts] |

**Deprecated/outdated:**

- The grouped-lock branch that tells users to correct grouped meals in chat is outdated for Phase 76 scope. [VERIFIED: client/src/components/MealEditScreen.tsx; VERIFIED: 76-CONTEXT.md]
- Treating `imageAssetId` as part of grouped item updates is invalid because grouped PATCH rejects image changes and preserves the existing whole-meal image. [VERIFIED: server/routes/meals.ts; VERIFIED: tests/integration/meals-api.test.ts]

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Extracting `client/src/meal-edit-grouped-draft.ts` is recommended for testability, but the phase may also keep small helpers inside `MealEditScreen`. [ASSUMED] | Recommended Project Structure; Code Examples | Low: implementation can still satisfy the phase with local helpers, but validation tests may become more brittle. |

## Open Questions

1. **Should grouped item details be added to `/api/meals`, or should Meal Edit fetch a separate detail DTO?**
   - What we know: Home Meal Edit uses `/api/meals` rows and current route tests show aggregate grouped rows without `items[]`. [VERIFIED: tests/integration/meals-api.test.ts; VERIFIED: 74-CONTEXT.md]
   - What's unclear: Whether the planner wants to keep Phase 76 purely client-side by showing unsupported state for item-missing payloads, or include the small backend DTO projection needed for Home grouped editing. [VERIFIED: .planning/REQUIREMENTS.md]
   - Recommendation: Add flat `items[]` to the existing `/api/meals` authoritative DTO path for grouped rows, because GROUP-UI-01 applies to grouped meals and GROUP-UI-03 explicitly requires existing authoritative DTO/store paths. [VERIFIED: .planning/REQUIREMENTS.md; VERIFIED: client/src/meal-edit-refresh.ts]

2. **How much source-of-truth note is needed for MEDIA-DECISION-01?**
   - What we know: `76-CONTEXT.md` locks deferral, `MealItemDetail` has no media fields, and `MealEditImageFrame` already says the photo is whole-meal context. [VERIFIED: 76-CONTEXT.md; VERIFIED: client/src/types.ts; VERIFIED: client/src/components/MealEditScreen.tsx]
   - What's unclear: Whether planner should add a test-only source contract, a short source comment, or a planning artifact note only. [VERIFIED: .planning/REQUIREMENTS.md]
   - Recommendation: Add tests/source contract coverage that grouped rows do not introduce item media fields or per-item crop/upload copy, and keep the source-of-truth note in Phase 76 artifacts; add a code comment only if the UI copy alone is not enough. [VERIFIED: tests/unit/meal-edit-screen.test.ts; ASSUMED]

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Tests, build, TypeScript scripts | Yes | `v24.14.0` [VERIFIED: node --version] | None needed |
| Yarn | Project scripts and package metadata | Yes | `1.22.22` [VERIFIED: yarn --version] | None; project forbids npm workflow. [VERIFIED: AGENTS.md] |
| ctx7 CLI | Optional documentation lookup | No | — [VERIFIED: command -v ctx7] | Not needed because Phase 76 uses existing project stack and no new libraries. [VERIFIED: package.json] |
| TypeScript compiler | Verification gate | Yes via project dependency | Declared `^5.7.0` [VERIFIED: package.json] | `yarn tsc --noEmit` |
| Node test runner | Unit/integration proof | Yes via Node | `v24.14.0` [VERIFIED: node --version] | None needed |

**Missing dependencies with no fallback:** none. [VERIFIED: node --version; VERIFIED: yarn --version]  
**Missing dependencies with fallback:** ctx7 CLI is missing, but no external library documentation is required for this phase. [VERIFIED: command -v ctx7; VERIFIED: package.json]

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Node built-in `node:test` with `tsx`. [VERIFIED: package.json scripts; VERIFIED: AGENTS.md] |
| Config file | No separate Jest/Vitest config; tests run through `scripts/run-node-with-tz.mjs`. [VERIFIED: package.json scripts; VERIFIED: AGENTS.md] |
| Quick run command | `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/meal-edit-screen.test.ts tests/unit/api-client.test.ts tests/unit/meal-edit-payload.test.ts tests/unit/meal-edit-refresh.test.ts` [VERIFIED: package.json scripts; VERIFIED: tests/unit/meal-edit-screen.test.ts] |
| Full suite command | `yarn test` [VERIFIED: package.json scripts] |

### Phase Requirements -> Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| GROUP-UI-01 | Grouped rows render edit/add/delete controls and submit full ordered list. [VERIFIED: .planning/REQUIREMENTS.md] | Unit/source + helper unit | `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/meal-edit-screen.test.ts` | Existing file yes; expectations must change. [VERIFIED: tests/unit/meal-edit-screen.test.ts] |
| GROUP-UI-02 | Invalid drafts block save with inline row errors; stale conflicts stale-block Save/Delete; unsupported grouped payloads are visible. [VERIFIED: .planning/REQUIREMENTS.md] | Unit/source + API transport | `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/meal-edit-screen.test.ts tests/unit/api-client.test.ts` | Existing files yes; grouped cases missing. [VERIFIED: tests/unit/meal-edit-screen.test.ts; VERIFIED: tests/unit/api-client.test.ts] |
| GROUP-UI-03 | Successful grouped saves use `refreshAfterMealMutation` and refreshed DTO/store paths. [VERIFIED: .planning/REQUIREMENTS.md] | Unit + integration if DTO read changes | `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/meal-edit-refresh.test.ts tests/integration/meals-api.test.ts` | Existing files yes; `/api/meals` grouped `items[]` projection proof missing. [VERIFIED: tests/unit/meal-edit-refresh.test.ts; VERIFIED: tests/integration/meals-api.test.ts] |
| MEDIA-DECISION-01 | Whole-meal image identity remains; per-item media mapping is explicitly deferred. [VERIFIED: .planning/REQUIREMENTS.md] | Unit/source contract | `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/meal-edit-screen.test.ts tests/unit/meal-edit-payload.test.ts` | Existing files yes; grouped media-defer assertion should be added or retained. [VERIFIED: tests/unit/meal-edit-screen.test.ts; VERIFIED: tests/unit/meal-edit-payload.test.ts] |

### Sampling Rate

- **Per task commit:** Run the targeted unit command for edited client tests plus `yarn tsc --noEmit` for TypeScript edits. [VERIFIED: AGENTS.md]
- **Per wave merge:** Run `yarn test:unit`; if `/api/meals` or meal history service changes, also run `yarn test:integration`. [VERIFIED: AGENTS.md; VERIFIED: package.json]
- **Phase gate:** Run `yarn tsc --noEmit`, targeted unit/integration tests for changed paths, and `yarn test` before `$gsd-verify-work` if the planner wants full local closure. [VERIFIED: AGENTS.md; VERIFIED: package.json]

### Wave 0 Gaps

- [ ] `tests/unit/meal-edit-screen.test.ts` — replace grouped-lock expectations with grouped editor, validation, dirty discard, stale recovery, unsupported state, and media-defer contracts. [VERIFIED: tests/unit/meal-edit-screen.test.ts]
- [ ] `tests/unit/api-client.test.ts` — add grouped `updateMeal` body pass-through and grouped stale conflict proof. [VERIFIED: tests/unit/api-client.test.ts]
- [ ] `tests/unit/meal-edit-grouped-draft.test.ts` — create if grouped draft parsing is extracted; covers blank/non-numeric/negative values, first invalid row, live totals, append/delete, final-row delete block, and position rebuild. [ASSUMED]
- [ ] `tests/integration/meals-api.test.ts` — update if `/api/meals` starts returning grouped `items[]`; assert flat item details and no media fields. [VERIFIED: tests/integration/meals-api.test.ts]

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | Yes | Keep existing guest-session-backed protected route behavior; unauthorized client mutations call `recoverGuestSession()`. [VERIFIED: client/src/components/MealEditScreen.tsx; VERIFIED: AGENTS.md] |
| V3 Session Management | Yes | Do not introduce new browser auth headers or session storage; continue existing cookie/session recovery pattern. [VERIFIED: AGENTS.md; VERIFIED: client/src/components/MealEditScreen.tsx] |
| V4 Access Control | Yes | Keep meal reads/writes scoped by existing route/device ownership; if `/api/meals` adds `items[]`, expose only rows already authorized for that meal list. [VERIFIED: server/routes/meals.ts] |
| V5 Input Validation | Yes | Client validates row drafts for recoverability; server strict parser remains final control for shape, positions, finite nonnegative nutrition, and revision checks. [VERIFIED: 76-CONTEXT.md; VERIFIED: server/routes/meals.ts] |
| V6 Cryptography | No new cryptography | Do not hand-roll crypto; Phase 76 does not add crypto behavior. [VERIFIED: 76-CONTEXT.md] |

### Known Threat Patterns for This Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Over-posted grouped mutation body | Tampering | Union client type plus server exact-key parser rejecting scalar/image/nested/extra grouped keys. [VERIFIED: client/src/types.ts; VERIFIED: server/routes/meals.ts] |
| Stale revision replay | Tampering | Required expected revision and structured stale-blocked recovery. [VERIFIED: server/routes/meals.ts; VERIFIED: client/src/components/MealEditScreen.tsx] |
| Unauthorized meal mutation/read | Elevation of Privilege | Keep existing route auth/session boundary and guest-session recovery; do not derive ownership from client-provided raw device IDs. [VERIFIED: AGENTS.md; VERIFIED: server/routes/meals.ts] |
| Misrepresented item media evidence | Information Integrity | Keep `MealItemDetail` media-free and copy tied to whole-meal photo identity. [VERIFIED: client/src/types.ts; VERIFIED: client/src/components/MealEditScreen.tsx; VERIFIED: 76-CONTEXT.md] |
| Item name rendering risk | XSS | Render item names through existing JSX text/input patterns and avoid `dangerouslySetInnerHTML`. [VERIFIED: client/src/components/MealEditScreen.tsx] |

## Sources

### Primary (HIGH confidence)

- `.planning/phases/76-grouped-meal-edit-ui-and-conditional-item-media-decision/76-CONTEXT.md` — Phase boundary, locked decisions, media deferral, validation/recovery model. [VERIFIED: 76-CONTEXT.md]
- `.planning/REQUIREMENTS.md` — GROUP-UI and MEDIA-DECISION requirement definitions. [VERIFIED: .planning/REQUIREMENTS.md]
- `.planning/ROADMAP.md` — Phase 76 dependency on Phase 75 and success criteria. [VERIFIED: .planning/ROADMAP.md]
- `.planning/STATE.md` — v2.6 active state and no-promotion context. [VERIFIED: .planning/STATE.md]
- `.planning/phases/75-grouped-meal-direct-crud-contract/75-CONTEXT.md` — grouped full-list PATCH contract and image preservation. [VERIFIED: 75-CONTEXT.md]
- `.planning/phases/75-grouped-meal-direct-crud-contract/75-RESEARCH.md` and `75-PATTERNS.md` — Phase 75 route/type patterns and client handoff notes. [VERIFIED: 75-RESEARCH.md; VERIFIED: 75-PATTERNS.md]
- `.planning/phases/74-home-meal-edit-entry-and-existing-edit-contract-review/74-CONTEXT.md` and `74-PATTERNS.md` — Home Meal Edit entry and refresh behavior to preserve. [VERIFIED: 74-CONTEXT.md; VERIFIED: 74-PATTERNS.md]
- `AGENTS.md` — project constraints, Yarn-only policy, test framework, and verification matrix. [VERIFIED: AGENTS.md]
- `client/src/components/MealEditScreen.tsx` — existing scalar edit, grouped lock branch, delete path, stale handling, and whole-meal image copy. [VERIFIED: client/src/components/MealEditScreen.tsx]
- `client/src/types.ts`, `client/src/api.ts`, `client/src/meal-edit-refresh.ts`, `client/src/meal-edit-payload.ts` — client DTO, transport, refresh, and payload boundaries. [VERIFIED: client/src/types.ts; VERIFIED: client/src/api.ts; VERIFIED: client/src/meal-edit-refresh.ts; VERIFIED: client/src/meal-edit-payload.ts]
- `server/routes/meals.ts`, `server/services/meal-history.ts` — grouped PATCH parser and meal history projection boundary. [VERIFIED: server/routes/meals.ts; VERIFIED: server/services/meal-history.ts]
- `tests/unit/meal-edit-screen.test.ts`, `tests/unit/api-client.test.ts`, `tests/unit/meal-edit-payload.test.ts`, `tests/unit/meal-edit-refresh.test.ts`, `tests/integration/meals-api.test.ts` — current proof surfaces and gaps. [VERIFIED: tests/unit/meal-edit-screen.test.ts; VERIFIED: tests/unit/api-client.test.ts; VERIFIED: tests/unit/meal-edit-payload.test.ts; VERIFIED: tests/unit/meal-edit-refresh.test.ts; VERIFIED: tests/integration/meals-api.test.ts]
- `package.json`, `node --version`, `yarn --version`, `yarn info` — stack and environment availability. [VERIFIED: package.json; VERIFIED: node --version; VERIFIED: yarn --version; VERIFIED: yarn info]

### Secondary (MEDIUM confidence)

- None used. [VERIFIED: research process]

### Tertiary (LOW confidence)

- Assumption A1 about extracting a small grouped draft helper is a design recommendation, not a verified codebase fact. [ASSUMED]

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH — all stack items are existing project dependencies or installed tools, verified from `package.json`, `node --version`, `yarn --version`, and `yarn info`. [VERIFIED: package.json; VERIFIED: node --version; VERIFIED: yarn --version; VERIFIED: yarn info]
- Architecture: HIGH — key flow is directly traced through existing Meal Edit, API, refresh helper, Phase 75 route, and tests. [VERIFIED: client/src/components/MealEditScreen.tsx; VERIFIED: client/src/api.ts; VERIFIED: client/src/meal-edit-refresh.ts; VERIFIED: server/routes/meals.ts]
- Pitfalls: HIGH — most pitfalls are demonstrated by current tests or locked phase decisions; helper extraction is the only assumed recommendation. [VERIFIED: tests/integration/meals-api.test.ts; VERIFIED: 76-CONTEXT.md; ASSUMED]

**Research date:** 2026-06-03  
**Valid until:** 2026-07-03 for codebase-local architecture; revisit sooner if Phase 75 contract or `/api/meals` DTO behavior changes. [VERIFIED: 75-CONTEXT.md; ASSUMED]
