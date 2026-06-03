# Phase 74: Home Meal Edit Entry and Existing Edit Contract Review - Research

**Researched:** 2026-06-02
**Domain:** React client edit-entry routing, meal revision safety, capability matrix contract
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

## Implementation Decisions

### Home Row Activation

- **D-01:** Home today meal rows should use whole-row activation for complete authoritative meals, aligned with History meal row button semantics and keyboard accessibility.
- **D-02:** Do not prioritize adding a separate chevron, edit icon, or secondary edit affordance in Phase 74. The row itself is the affordance.
- **D-03:** Home should open Meal Edit through the existing `openMealEdit` store boundary with a complete `MealEditPayload`; it must not create a parallel Home-specific edit route or state boundary.
- **D-04:** Home should open Meal Edit for any complete authoritative meal, including grouped meals. Grouped meals must land on the existing `MealEditScreen` grouped-lock branch (`itemCount > 1`) and must not gain direct grouped save/edit behavior in Phase 74.
- **D-05:** Home-origin Meal Edit close behavior should naturally return to Home through `openMealEdit(..., "home")` or the existing origin default. Add an explicit Home back label such as `返回首頁` rather than leaving Home-origin edits on the generic `返回` label, unless implementation proves the generic label is intentionally preferred and records that choice in the plan.

### Ineligible Meal Behavior

- **D-06:** Ineligible Home rows are defensive fallbacks, not a normal product state. Current `getMeals` DTO guards already require `id`, `mealRevisionId`, nutrition fields, `itemCount`, and `loggedAt`; the payload builder also rejects missing revision or authority.
- **D-07:** Only Home rows that can build a complete authoritative Meal Edit payload get button semantics.
- **D-08:** Incomplete rows stay silent read-only. Do not show a disabled edit affordance, do not add new cannot-edit copy, and do not manufacture fallback edit authority.
- **D-09:** Planning should include a non-throw eligibility path for Home row rendering, such as a safe wrapper around `buildHistoryMealEditPayload()` or an equivalent can-build helper, so incomplete rows remain silent read-only without bubbling render-time exceptions.

### Existing Edit Contract Review

- **D-10:** Reuse and revalidate the existing single-item edit/delete contract: `MealEditScreen` sends `expectedMealRevisionId`, server revision checks remain authoritative, and `refreshAfterMealMutation` handles post-save/delete refresh.
- **D-11:** Do not add a separate Home post-edit highlight or cue. Existing `MealEditScreen` plus `refreshAfterMealMutation` behavior is sufficient for Phase 74.
- **D-12:** For accessibility, prefer native button semantics for interactive Home meal rows where practical. If the component cannot use a native button wrapper cleanly, use the existing MessageBubble-style `role="button"` + `tabIndex` + Enter/Space handling pattern.

### Capability Metadata Cleanup

- **D-13:** Correct `client/src/contracts/capability-matrix.ts` as the source of truth for Home and Day Detail edit-entry metadata.
- **D-14:** Home capability metadata must stop claiming `openMealEdit` ahead of code, then reflect the new implemented Home edit entry once Phase 74 adds it.
- **D-15:** Day Detail capability metadata must be corrected because `HistoryDayDetailScreen` is intentionally read-only and currently does not expose `openMealEdit`.
- **D-16:** Regenerate/check `docs/capability-matrix.md` from the source matrix after editing. Do not leave generated docs stale.
- **D-17:** Do not run a broader docs sweep unless implementation finds another explicit Home or Day Detail edit-entry reference. Keep the metadata cleanup local to the known generated capability matrix contract.
- **D-18:** When correcting Day Detail capability metadata, preserve the `capability-matrix-contract.test.ts` invariant: component rows with `activeHandler === "present"` require non-empty `handlerMatchers`. If `openMealEdit` is removed from Day Detail, retain a real handler such as `onBack`, or intentionally change the row semantics.
- **D-19:** Do not rely on the source scan alone to prevent over-claimed `handlerMatchers`. Home and Day Detail matrix corrections need direct source review plus `yarn matrix:check`.

### the agent's Discretion

Planner may choose the exact helper name and file placement for the Home eligibility wrapper, the exact row markup as long as accessible activation matches D-01/D-12, exact source-contract test placement, and whether the Home back label is implemented directly in `MealEditScreen` or via a small origin-label helper.

### Deferred Ideas (OUT OF SCOPE)

- Direct grouped meal item edit/add/delete remains Phase 75-76 scope.
- Home-specific post-edit highlight/cue behavior is not part of Phase 74; reconsider only as future UX polish if needed.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| HOME-EDIT-01 | Home today meal rows open the Meal Edit page for eligible meals, using the same public meal identity and revision-safe edit entry pattern as Chat and History. | Use `HomeScreen` row rendering plus `buildHistoryMealEditPayload(meal, todayDateKey)` and `openMealEdit(payload, "home")`; existing History and Chat entry paths prove the intended contract. [VERIFIED: codebase grep] |
| HOME-EDIT-02 | Home edit entry updates stale capability documentation or matrix claims so code and docs agree on where Meal Edit can be opened. | Update `client/src/contracts/capability-matrix.ts`, run `yarn matrix:gen`, and verify with `yarn matrix:check`; generated `docs/capability-matrix.md` is currently out of semantic alignment for Home and Day Detail. [VERIFIED: codebase grep] |
| EDIT-BASE-01 | Existing single-item edit/delete behavior is revalidated before grouped meal direct editing expands the contract. | Keep `MealEditScreen` save/delete, `expectedMealRevisionId`, `refreshAfterMealMutation`, route 409 revision errors, and grouped-lock coverage green with focused unit plus integration checks. [VERIFIED: codebase grep] |
</phase_requirements>

## Summary

Phase 74 is a client routing and contract-revalidation phase, not a server mutation expansion. [VERIFIED: 74-CONTEXT.md] The planner should route Home eligible today rows through the same edit payload and `openMealEdit` store boundary used by History, with complete public `mealId` and `mealRevisionId` identity carried into `MealEditScreen`. [VERIFIED: codebase grep]

Current code already has the authoritative edit contract: `buildHistoryMealEditPayload()` throws on missing revision or missing core meal authority, `MealEditScreen` sends `expectedMealRevisionId` to PATCH/DELETE, and server routes return `MEAL_REVISION_REQUIRED` / `MEAL_REVISION_STALE` before summary recompute or publish. [VERIFIED: codebase grep] Home is the missing entry surface: rows are still plain `<article>` elements and the Home unit source contract currently asserts they stay read-only. [VERIFIED: codebase grep]

Capability metadata is stale in two directions: the matrix currently claims Home meal rows use `openMealEdit` even though Home code does not, and Day Detail claims `openMealEdit` even though the component and tests intentionally keep it read-only. [VERIFIED: codebase grep] The planner should include a matrix source update, generated Markdown regeneration, and `yarn matrix:check` as first-class tasks. [VERIFIED: package.json]

**Primary recommendation:** implement a small non-throwing Home edit-payload eligibility helper, render eligible Home rows as native buttons that call `openMealEdit(payload, "home")`, update Home/Day Detail capability matrix rows and generated docs, then run targeted unit, matrix, integration, and TypeScript checks. [VERIFIED: codebase grep]

## Project Constraints (from AGENTS.md)

- Use `yarn` only; do not use `npm`. [VERIFIED: AGENTS.md]
- Keep TypeScript ESM imports with explicit `.js` specifiers for local source imports. [VERIFIED: AGENTS.md]
- `server/app.ts` is the backend composition root; this phase should not need new server wiring. [VERIFIED: AGENTS.md]
- `server/routes/*.ts` own HTTP validation and auth checks; server-side revision checks must remain authoritative. [VERIFIED: AGENTS.md]
- `client/src/store.ts` is the single Zustand state boundary; `client/src/api.ts` owns REST transport helpers. [VERIFIED: AGENTS.md]
- Use Node built-in `node:test`, not Jest or Vitest. [VERIFIED: AGENTS.md]
- Use real SQLite for integration tests; do not mock the DB. [VERIFIED: AGENTS.md]
- Preserve `TZ=Asia/Taipei` in test and day-boundary workflows. [VERIFIED: AGENTS.md]
- Any `*.ts` edit requires `yarn tsc --noEmit`; unit test edits require `yarn test:unit`; route/service edits require `yarn test:integration`; capability matrix edits require the matrix check path. [VERIFIED: AGENTS.md]
- Do not promote, merge, push, or otherwise touch `main` without explicit current-thread production approval. [VERIFIED: AGENTS.md]

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Home row edit entry | Browser / Client | — | It changes row affordance and calls the existing Zustand secondary-screen boundary; no new route is required. [VERIFIED: codebase grep] |
| Meal edit payload construction | Browser / Client | API / Backend | Client must carry public identity for UX, but server revision checks remain authoritative. [VERIFIED: codebase grep] |
| Single-item save/delete stale protection | API / Backend | Database / Storage | PATCH/DELETE enforce expected revision through transaction-service checks before mutation and summary work. [VERIFIED: codebase grep] |
| Grouped meal direct-edit lock | Browser / Client | API / Backend | `MealEditScreen` blocks grouped form editing, while PATCH also rejects grouped direct edits when attempted. [VERIFIED: codebase grep] |
| Capability matrix truth | Client contract docs | Scripts / Generated docs | `capability-matrix.ts` is source, `generate-capability-matrix-doc.mjs` renders `docs/capability-matrix.md`. [VERIFIED: codebase grep] |
| Focused validation | Test runner / scripts | — | Commands are package scripts using Node test runner and the timezone wrapper. [VERIFIED: package.json] |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| React | `^19.0.0` | Client component rendering for Home, History, Chat, and Meal Edit. [VERIFIED: package.json] | Existing app stack; no new UI framework should be introduced. [VERIFIED: package.json] |
| Zustand | `^5.0.0` | `openMealEdit`, secondary-screen state, meals, summaries, and mutation notices. [VERIFIED: package.json] | Existing store boundary explicitly owns client state transitions. [VERIFIED: AGENTS.md] |
| TypeScript | `^5.7.0` | Static gate for client/server/test code. [VERIFIED: package.json] | Required for all TS edits through `yarn tsc --noEmit`. [VERIFIED: AGENTS.md] |
| Node built-in test runner | Node `v24.14.0` local runtime | Unit and integration tests. [VERIFIED: command output] | Existing repo test scripts use `node --test` through `tsx` and TZ wrapper. [VERIFIED: package.json] |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Fastify | `5.8.5` | Existing server route layer for `/api/meals`. [VERIFIED: package.json] | Revalidate, not redesign, direct meal PATCH/DELETE behavior. [VERIFIED: codebase grep] |
| better-sqlite3 | `^11.8.0` | Real SQLite test and runtime persistence. [VERIFIED: package.json] | Integration tests for meal route contracts should continue using real DB fixtures. [VERIFIED: AGENTS.md] |
| Drizzle ORM | `^0.39.0` | Persistence layer used by services. [VERIFIED: package.json] | No migration is expected in Phase 74; keep existing transaction services. [VERIFIED: codebase grep] |
| tsx | `^4.19.0` | Runs TypeScript tests and generator scripts. [VERIFIED: package.json] | Needed for `yarn test:*`, `yarn matrix:*`, and `node --import tsx`. [VERIFIED: package.json] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Existing `buildHistoryMealEditPayload()` | New Home-specific payload builder | Avoid: duplicates revision/authority rules and risks Home-only authority drift. [VERIFIED: 74-CONTEXT.md] |
| Native `<button>` Home row | `role="button"` wrapper | Use fallback only if markup constraints make native button impractical; native button gives keyboard activation without custom key handling. [VERIFIED: 74-CONTEXT.md] |
| Existing capability generator | Manual docs edit | Avoid: `docs/capability-matrix.md` is generated and check-mode compares exact output. [VERIFIED: codebase grep] |

**Installation:** No package installation is required for this phase. [VERIFIED: package.json]

## Package Legitimacy Audit

No new external packages are recommended or required. [VERIFIED: package.json]

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| none | — | — | — | — | not run | No install planned. [VERIFIED: package.json] |

**Packages removed due to slopcheck [SLOP] verdict:** none. [VERIFIED: package.json]
**Packages flagged as suspicious [SUS]:** none. [VERIFIED: package.json]

## Architecture Patterns

### System Architecture Diagram

```text
HomeScreen today meal rows
  -> for each MealEntry, attempt non-throwing edit payload build
     -> complete payload?
        -> yes: native row button
             -> openMealEdit(payload, "home")
             -> store.secondaryScreen = { screen: "mealEdit", origin: "home", payload }
             -> MealEditScreen
                -> itemCount > 1?
                   -> yes: existing grouped-lock UI; no direct save/delete
                   -> no: existing save/delete form
                       -> PATCH/DELETE /api/meals/:id with expectedMealRevisionId
                       -> server getMealMutationGuard / softDeleteTransaction
                       -> current revision matches?
                          -> yes: commit mutation, summaryOutcome, publish, refreshAfterMealMutation
                          -> no/missing: 409 revision conflict, no summary/publish, stale UI refresh support
        -> no: render same read-only Home row with no disabled affordance

Capability matrix update
  -> edit client/src/contracts/capability-matrix.ts
  -> yarn matrix:gen
  -> docs/capability-matrix.md exact generated output
  -> yarn matrix:check
```

### Recommended Project Structure

```text
client/src/
├── components/
│   ├── HomeScreen.tsx              # Add Home row edit entry and ineligible fallback.
│   └── MealEditScreen.tsx          # Add Home-origin back label if not helperized elsewhere.
├── meal-edit-payload.ts            # Prefer adding safe Home/History can-build wrapper here if shared.
├── contracts/
│   └── capability-matrix.ts        # Correct Home and Day Detail source-of-truth rows.
docs/
└── capability-matrix.md            # Regenerate from source; do not hand-author.
tests/
└── unit/
    ├── home-dashboard-contract.test.ts
    ├── meal-edit-payload.test.ts
    ├── meal-edit-screen.test.ts
    └── capability-matrix-*.test.ts
```

### Pattern 1: Existing History Meal Edit Entry

**What:** History renders meal rows as native buttons and calls `openMealEdit(buildHistoryMealEditPayload(meal, selectedDateKey), "history")`. [VERIFIED: codebase grep]
**When to use:** Use as the Home row semantic and payload model. [VERIFIED: 74-CONTEXT.md]
**Example:**

```typescript
function onMealOpen(meal: MealEntry) {
  openMealEdit(buildHistoryMealEditPayload(meal, selectedDateKey), "history");
}
```

Source: `client/src/components/HistoryScreen.tsx`. [VERIFIED: codebase grep]

### Pattern 2: Receipt Edit Eligibility Is Fail-Closed

**What:** Chat receipts call `buildReceiptMealEditPayload()` and only become actionable when the payload is complete. [VERIFIED: codebase grep]
**When to use:** Home should use the same idea through a non-throwing wrapper so render never crashes on defensive incomplete rows. [VERIFIED: 74-CONTEXT.md]
**Example:**

```typescript
const canEdit = editPayload !== null && onOpenMealEdit !== undefined;
```

Source: `client/src/components/MessageBubble.tsx`. [VERIFIED: codebase grep]

### Pattern 3: Mutation Refresh Is Shared

**What:** After save/delete, `MealEditScreen` calls `refreshAfterMealMutation()` with `redactChatReceiptIdentity`, `recordMealMutation`, `setDailySummary`, `getMeals`, and `setMeals`. [VERIFIED: codebase grep]
**When to use:** Do not add Home-specific post-edit refresh or highlight behavior in Phase 74. [VERIFIED: 74-CONTEXT.md]

### Anti-Patterns to Avoid

- **Parallel Home edit route/state:** Do not introduce a Home-specific edit route or separate state boundary; use `openMealEdit`. [VERIFIED: 74-CONTEXT.md]
- **Throwing from Home row render:** Do not call the throwing payload builder inline without a guard; incomplete fallback rows must stay silent read-only. [VERIFIED: 74-CONTEXT.md]
- **Manufacturing edit identity:** Do not invent `mealRevisionId` or derive authority from display labels, timestamps, or chat text. [VERIFIED: 74-CONTEXT.md]
- **Direct grouped edits in Phase 74:** Do not add grouped item save/add/delete UI or server contract; grouped rows should reach the existing lock. [VERIFIED: 74-CONTEXT.md]
- **Manual generated docs edits only:** Do not edit `docs/capability-matrix.md` without updating source and running generator/check. [VERIFIED: codebase grep]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Meal edit payload authority | New Home-only DTO mapper | `buildHistoryMealEditPayload()` plus a safe wrapper | Existing builder already enforces public id, revision, nutrition, item count, loggedAt, items, image, and mealPeriod rules. [VERIFIED: codebase grep] |
| Secondary-screen navigation | New route or local component state | `useStore().openMealEdit(payload, "home")` | Store already owns `secondaryScreen` and origin. [VERIFIED: codebase grep] |
| Stale protection | Client-only stale validation | Server `expectedMealRevisionId` checks | `meal-transactions.ts` throws required/stale errors against current revision. [VERIFIED: codebase grep] |
| Post-mutation refresh | Home-specific refresh/highlight | `refreshAfterMealMutation()` | Existing helper handles receipt redaction, mutation notices, daily summary, and today meal reload. [VERIFIED: codebase grep] |
| Capability docs | Ad hoc Markdown updates | `capability-matrix.ts` + `yarn matrix:gen` | Generator owns docs output and check-mode detects drift. [VERIFIED: codebase grep] |

**Key insight:** Phase 74 should wire an additional entry affordance into an existing authoritative contract, not create a new edit contract. [VERIFIED: 74-CONTEXT.md]

## Common Pitfalls

### Pitfall 1: Home Metadata Claims Support Before Code Does

**What goes wrong:** The capability matrix claims Home `openMealEdit`, but `HomeScreen` rows are still plain articles. [VERIFIED: codebase grep]
**Why it happens:** Matrix rows can reference store actions that exist globally, even when the audited component does not actually call them. [VERIFIED: codebase grep]
**How to avoid:** Update Home source and matrix together; run `yarn matrix:check`. [VERIFIED: package.json]
**Warning signs:** `home-dashboard-contract.test.ts` still asserts `<article key={meal.id} className="home-sport-meal-row">` and no meal-row button. [VERIFIED: codebase grep]

### Pitfall 2: Day Detail Over-Claims Edit Entry

**What goes wrong:** The generated matrix says Day Detail has `openMealEdit`, but `HistoryDayDetailScreen` tests reject edit/delete/save/correction controls and `openMealEdit`. [VERIFIED: codebase grep]
**Why it happens:** The matrix row included `openMealEdit` in `handlerMatchers` and `storeAction`, but the component is intentionally read-only. [VERIFIED: codebase grep]
**How to avoid:** Remove Day Detail edit handoff claims while preserving a real `handlerMatchers` value such as `onBack` if `activeHandler` remains `present`. [VERIFIED: 74-CONTEXT.md]
**Warning signs:** `capability-matrix-contract.test.ts` fails because `activeHandler === "present"` component rows require non-empty `handlerMatchers`. [VERIFIED: codebase grep]

### Pitfall 3: Inline Builder Exceptions Break Home Rendering

**What goes wrong:** Calling `buildHistoryMealEditPayload()` directly inside JSX for every row can throw on defensive incomplete rows. [VERIFIED: codebase grep]
**Why it happens:** The builder intentionally throws `MEAL_REVISION_REQUIRED` or `MEAL_AUTHORITY_REQUIRED` for incomplete History rows. [VERIFIED: codebase grep]
**How to avoid:** Add a non-throw helper that returns `MealEditPayload | null`, then branch eligible rows to button markup and ineligible rows to unchanged article markup. [VERIFIED: 74-CONTEXT.md]
**Warning signs:** Render code has `buildHistoryMealEditPayload(meal, ...)` without `try`/eligibility handling. [ASSUMED]

### Pitfall 4: Treating Grouped Home Rows As Editable

**What goes wrong:** A grouped Home meal opens an editable single-form save path or delete controls in Phase 74. [VERIFIED: 74-CONTEXT.md]
**Why it happens:** Grouped rows are complete authoritative meals, so they should open Meal Edit, but `MealEditScreen` must own the grouped lock. [VERIFIED: 74-CONTEXT.md]
**How to avoid:** Pass grouped payloads through unchanged; `MealEditScreen` already branches on `payload.itemCount > 1` before rendering the form. [VERIFIED: codebase grep]
**Warning signs:** New grouped item inputs, add/delete controls, or direct grouped PATCH contract appear in Phase 74 diffs. [VERIFIED: 74-CONTEXT.md]

### Pitfall 5: Relying On Client Revision Identity As Authority

**What goes wrong:** Tests prove only that Home passes `mealRevisionId`, but not that server-side stale checks remain green. [VERIFIED: 74-CONTEXT.md]
**Why it happens:** Home navigation is UX support; actual stale protection is route/service/database behavior. [VERIFIED: 74-CONTEXT.md]
**How to avoid:** Keep meals integration tests for missing/stale expected revisions and grouped rejection in the phase validation set. [VERIFIED: codebase grep]
**Warning signs:** Plan omits `tests/integration/meals-api.test.ts` focused route contract checks. [ASSUMED]

## Code Examples

### Safe Home Eligibility Wrapper

```typescript
export function buildMealEditPayloadIfComplete(meal: MealEntry, dateKey: string): MealEditPayload | null {
  try {
    return buildHistoryMealEditPayload(meal, dateKey);
  } catch {
    return null;
  }
}
```

Source pattern: `buildHistoryMealEditPayload()` throws for incomplete rows, while Chat uses nullable receipt payloads for eligibility. [VERIFIED: codebase grep]

### Home Row Button Target

```tsx
<button
  key={meal.id}
  type="button"
  className="home-sport-meal-row"
  aria-label={`編輯 ${getDisplayMealLabel(meal.mealPeriod, meal.loggedAt)} ${meal.foodName}`}
  onClick={() => openMealEdit(payload, "home")}
>
  {/* existing thumbnail, meta, title, macros, calories */}
</button>
```

Source pattern: History row button uses the same accessible label shape and native button semantics. [VERIFIED: codebase grep]

### Existing Server Revision Guard

```typescript
if (!expected) {
  throw new MealRevisionPreconditionError({
    code: "MEAL_REVISION_REQUIRED",
    mealId: existing.id,
    affectedDate,
    currentMealRevisionId: existing.currentRevisionId,
  });
}
```

Source: `server/services/meal-transactions.ts`. [VERIFIED: codebase grep]

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Meal edit without public revision identity | Public `mealRevisionId` required for direct client edits and receipts | v2.3 / Phase 62 carry-forward [VERIFIED: STATE.md] | Home must carry revision identity into Meal Edit. [VERIFIED: 74-CONTEXT.md] |
| Client-side stale support as authority | Server-side expected revision checks are authoritative | v2.3 / Phase 62 carry-forward [VERIFIED: STATE.md] | Home entry tests are not enough; server route contract must stay green. [VERIFIED: STATE.md] |
| Capability docs as static claims | Source matrix plus generated Markdown check | Existing `matrix:gen` / `matrix:check` scripts [VERIFIED: package.json] | Update `capability-matrix.ts` first, then regenerate docs. [VERIFIED: codebase grep] |
| Grouped direct edits in single form | Grouped Meal Edit lock with Chat correction handoff | Current `MealEditScreen` [VERIFIED: codebase grep] | Phase 74 should preserve grouped lock until Phase 75-76. [VERIFIED: 74-CONTEXT.md] |

**Deprecated/outdated:**
- Home rows as permanently read-only: current source tests assert this, but Phase 74 supersedes that contract for eligible meals. [VERIFIED: 74-CONTEXT.md]
- Day Detail matrix edit handoff: current component is read-only and tests reject `openMealEdit`, so metadata must stop claiming it. [VERIFIED: codebase grep]

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Render code with a throwing builder but no guard could crash Home. | Common Pitfalls | If React error boundaries mask it, impact may be lower, but the non-throw helper is still required by D-09. |
| A2 | Planner should include the meals integration route contract checks if server files are not edited. | Common Pitfalls | If no server path is touched, executor might prefer unit/source checks only; EDIT-BASE-01 still asks for revalidation. |

## Open Questions (RESOLVED)

1. **Exact helper placement**
   - What we know: `buildHistoryMealEditPayload()` is in `client/src/meal-edit-payload.ts`, and Home needs a non-throw eligibility path. [VERIFIED: codebase grep]
   - Resolved decision: Add a reusable nullable helper in `client/src/meal-edit-payload.ts` named `buildMealEditPayloadIfComplete(meal, dateKey)`, implemented by wrapping `buildHistoryMealEditPayload()` and returning `null` for missing revision/core authority rather than throwing during Home render.
   - Why: The Phase 74 plans need direct helper coverage in `tests/unit/meal-edit-payload.test.ts`, and keeping the helper next to the throwing builder avoids a Home-only authority rule.

2. **Home back label implementation shape**
   - What we know: `MealEditScreen` currently maps chat/history origins to `返回對話` / `返回歷史` and defaults to `返回`. [VERIFIED: codebase grep]
   - Resolved decision: Update `MealEditScreen.tsx` back-label logic with an inline Home branch: `origin === "home" ? "返回首頁"`.
   - Why: This is the smallest change that satisfies D-05 and keeps the existing chat/history/default label structure intact; no separate origin-label helper is required for Phase 74.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Node.js | TypeScript, tests, scripts | yes | `v24.14.0` | none needed. [VERIFIED: command output] |
| Yarn | All repo commands | yes | `1.22.22` | none; npm is forbidden. [VERIFIED: command output] |
| git | Status/diff and optional GSD commit | yes | `2.50.1` | none needed. [VERIFIED: command output] |
| ripgrep | Codebase research/search | yes | `15.1.0` | shell `grep` if unavailable. [VERIFIED: command output] |
| gsd-tools | Phase metadata and optional commit | yes | CLI present | Manual file path fallback. [VERIFIED: command output] |

**Missing dependencies with no fallback:** none found. [VERIFIED: command output]
**Missing dependencies with fallback:** none found. [VERIFIED: command output]

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Node built-in `node:test` through `tsx`; local Node `v24.14.0`. [VERIFIED: package.json] |
| Config file | none; scripts live in `package.json`. [VERIFIED: package.json] |
| Quick run command | `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/home-dashboard-contract.test.ts tests/unit/meal-edit-payload.test.ts tests/unit/meal-edit-screen.test.ts tests/unit/meal-edit-refresh.test.ts` [VERIFIED: package.json] |
| Full suite command | `yarn test` plus `yarn matrix:check`; use `yarn release:check` only for promotion/release readiness. [VERIFIED: package.json] |

### Phase Requirements -> Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| HOME-EDIT-01 | Eligible Home rows call `openMealEdit(payload, "home")` with complete payload and accessible whole-row activation. | unit/source contract | `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/home-dashboard-contract.test.ts tests/unit/meal-edit-payload.test.ts` | yes, update needed. [VERIFIED: codebase grep] |
| HOME-EDIT-01 | Grouped Home rows open Meal Edit and remain locked by `payload.itemCount > 1`. | unit/source contract | `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/home-dashboard-contract.test.ts tests/unit/meal-edit-screen.test.ts` | yes, update/add assertions. [VERIFIED: codebase grep] |
| HOME-EDIT-02 | Home and Day Detail capability matrix rows match implemented source, and docs are regenerated. | unit/generated-doc check | `yarn matrix:check` | yes. [VERIFIED: package.json] |
| EDIT-BASE-01 | Single-item save/delete still send expected revision and refresh through shared helper. | unit/source contract | `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/meal-edit-screen.test.ts tests/unit/meal-edit-refresh.test.ts` | yes. [VERIFIED: codebase grep] |
| EDIT-BASE-01 | Server rejects missing/stale revision and rejects grouped direct PATCH. | integration | `node scripts/run-node-with-tz.mjs --import tsx --test tests/integration/meals-api.test.ts` | yes. [VERIFIED: codebase grep] |
| All | TypeScript after client/test edits. | static | `yarn tsc --noEmit` | command exists. [VERIFIED: package.json] |

### Sampling Rate

- **Per task commit:** run the focused unit command for changed client/test files, `yarn matrix:check` after matrix edits, and `yarn tsc --noEmit` after any TS edit. [VERIFIED: AGENTS.md]
- **Per wave merge:** run `node scripts/run-node-with-tz.mjs --import tsx --test tests/integration/meals-api.test.ts` plus focused unit checks. [VERIFIED: package.json]
- **Phase gate:** `yarn tsc --noEmit`, focused unit/source checks, `yarn matrix:check`, and `tests/integration/meals-api.test.ts` green before `$gsd-verify-work`. [VERIFIED: AGENTS.md]

### Wave 0 Gaps

- [ ] `tests/unit/home-dashboard-contract.test.ts` currently asserts Home rows stay read-only; update it to assert eligible button semantics and ineligible silent fallback. [VERIFIED: codebase grep]
- [ ] `tests/unit/meal-edit-payload.test.ts` can add nullable safe-wrapper coverage if the helper lands in `meal-edit-payload.ts`. [ASSUMED]
- [ ] `tests/unit/capability-matrix-contract.test.ts` may need expectation adjustments only if Day Detail row semantics change beyond matcher content. [VERIFIED: codebase grep]
- [ ] `docs/capability-matrix.md` must be regenerated with `yarn matrix:gen` after matrix source edits. [VERIFIED: codebase grep]

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V2 Authentication | yes | Existing signed guest-session route protection remains on `/api/meals`; no Home client bypass. [VERIFIED: codebase grep] |
| V3 Session Management | yes | `resolveGuestSession()` in meal routes and cookie-backed client fetches continue to own session state. [VERIFIED: codebase grep] |
| V4 Access Control | yes | Food logging service calls are device-scoped; integration tests cover foreign/unauthenticated route behavior. [VERIFIED: codebase grep] |
| V5 Input Validation | yes | Client payload builder and API DTO guards validate shape; server route parses and validates PATCH/DELETE payloads. [VERIFIED: codebase grep] |
| V6 Cryptography | no new crypto | Do not alter guest-session signing or add cryptographic code in Phase 74. [VERIFIED: 74-CONTEXT.md] |

### Known Threat Patterns for This Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Stale meal overwrite | Tampering | Server-side `expectedMealRevisionId` checks in `meal-transactions.ts`; client identity is UX support only. [VERIFIED: codebase grep] |
| Cross-device meal mutation | Elevation of Privilege | `resolveGuestSession()` plus device-scoped service queries; keep integration tests green. [VERIFIED: codebase grep] |
| Fabricated edit identity | Tampering | Nullable/throwing payload builders reject missing public revision and core authority. [VERIFIED: codebase grep] |
| Generated docs over-claim active handlers | Repudiation / Integrity | Source matrix tests plus generator check ensure docs match source contracts. [VERIFIED: package.json] |

## Sources

### Primary (HIGH confidence)

- `AGENTS.md` - project workflow, architecture, conventions, and verification matrix. [VERIFIED: AGENTS.md]
- `.planning/phases/74-home-meal-edit-entry-and-existing-edit-contract-review/74-CONTEXT.md` - locked Phase 74 decisions. [VERIFIED: 74-CONTEXT.md]
- `.planning/phases/74-home-meal-edit-entry-and-existing-edit-contract-review/74-UI-SPEC.md` - UI interaction/copy/visual contract. [VERIFIED: 74-UI-SPEC.md]
- `.planning/ROADMAP.md` and `.planning/REQUIREMENTS.md` - phase goal, success criteria, and requirement IDs. [VERIFIED: planning docs]
- `client/src/components/HomeScreen.tsx` - current Home row implementation. [VERIFIED: codebase grep]
- `client/src/components/HistoryScreen.tsx` - existing History edit entry. [VERIFIED: codebase grep]
- `client/src/components/MessageBubble.tsx` - existing Chat receipt edit gating. [VERIFIED: codebase grep]
- `client/src/meal-edit-payload.ts` - payload authority and revision requirements. [VERIFIED: codebase grep]
- `client/src/components/MealEditScreen.tsx` - save/delete/stale/grouped-lock behavior. [VERIFIED: codebase grep]
- `client/src/contracts/capability-matrix.ts`, `docs/capability-matrix.md`, and `scripts/generate-capability-matrix-doc.mjs` - matrix source and generator. [VERIFIED: codebase grep]
- `server/routes/meals.ts` and `server/services/meal-transactions.ts` - server revision and grouped rejection contracts. [VERIFIED: codebase grep]
- `tests/unit/*.test.ts` and `tests/integration/meals-api.test.ts` listed above - existing proof surfaces. [VERIFIED: codebase grep]
- `package.json` - dependency versions and verification commands. [VERIFIED: package.json]

### Secondary (MEDIUM confidence)

- `.planning/codebase/STRUCTURE.md`, `.planning/codebase/CONVENTIONS.md`, `.planning/codebase/TESTING.md` - local codebase map refreshed 2026-06-01. [CITED: local planning docs]

### Tertiary (LOW confidence)

- None. External web search was not needed because this phase is codebase-contract work with no new library or API selection. [VERIFIED: codebase grep]

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - versions and commands came from `package.json` and local command probes. [VERIFIED: package.json]
- Architecture: HIGH - relevant paths are explicit in Phase 74 context and confirmed in source. [VERIFIED: codebase grep]
- Pitfalls: HIGH - major pitfalls map to current source/test drift or locked decisions; two implementation-shape claims are marked `[ASSUMED]`. [VERIFIED: codebase grep]

**Research date:** 2026-06-02
**Valid until:** 2026-07-02 for this codebase-contract phase, unless Home/Meal Edit/capability matrix files change first. [ASSUMED]
