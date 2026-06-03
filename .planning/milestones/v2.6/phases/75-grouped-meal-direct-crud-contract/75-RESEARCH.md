# Phase 75: Grouped Meal Direct CRUD Contract - Research

**Researched:** 2026-06-03 [VERIFIED: system date]
**Domain:** Fastify direct meal mutation contract, revisioned SQLite persistence, summary/realtime side effects [VERIFIED: .planning/ROADMAP.md; VERIFIED: server/routes/meals.ts; VERIFIED: server/services/meal-transactions.ts]
**Confidence:** HIGH [VERIFIED: codebase grep; VERIFIED: 75-CONTEXT.md]

<user_constraints>
## User Constraints (from CONTEXT.md)

Source note: The locked decisions, discretion area, and deferred ideas below are copied verbatim from `.planning/phases/75-grouped-meal-direct-crud-contract/75-CONTEXT.md`. [VERIFIED: 75-CONTEXT.md]

### Locked Decisions

### Public Route Shape

- **D-01:** Extend the existing `PATCH /api/meals/:id` route for grouped item-list replacement. Do not add `/items` subroutes in Phase 75.
- **D-02:** A request body containing `items[]` selects the grouped replacement shape. Do not add `mode`, `operation`, or other discriminator fields.
- **D-03:** The existing scalar fields remain the legacy single-item update shape. Scalar update fields and `items[]` are mutually exclusive request shapes.
- **D-04:** `items[]` replacement is allowed for any meal under `expectedMealRevisionId`, including 1 -> many, many -> one, and many -> many revisions. The route contract is "replace this meal's ordered item list," not "only edit meals that are already grouped."
- **D-05:** Successful grouped replacement returns the same minimum shape as current direct PATCH: `affectedDate`, `summaryOutcome`, optional `dailySummary`, and aggregate `meal`.
- **D-06:** Phase 76 owns item-detail read/refresh behavior for grouped editing. Adding `meal.items` to the PATCH response later is a backward-compatible optional expansion, not required in Phase 75.

### Per-item Request Wire Shape

- **D-07:** Grouped request items use the existing flat `MealItemDetail`-style public shape: `{ name, position, calories, protein, carbs, fat }`.
- **D-08:** The server maps public `item.name` to persistence `foodName`. Do not expose per-item `foodName` in the grouped public request body.
- **D-09:** Do not use nested `nutrition` in the grouped write request. Nested/tolerant item normalization remains a read-path projection style, not the write contract.
- **D-10:** The grouped write parser should be strict. Accept only `name`, `position`, `calories`, `protein`, `carbs`, and `fat` per item. Reject aliases, per-item `foodName`, nested `nutrition`, and tolerant normalization in grouped writes.
- **D-11:** Because `position` is included in the public item shape, require each item `position` to exactly match its zero-based array index. Caller mistakes fail closed.
- **D-12:** Phase 75 follows the History/persistence zero-based position contract. Receipt-origin Meal Edit can carry 1-based chat-receipt display positions; those are display values, not write authority. Any caller must submit zero-based contiguous positions and re-base receipt positions client-side before grouped submit because D-11 fails closed when `position` does not match the array index.

### Item Identity and Ordering

- **D-13:** Identify items by zero-based `position` within the expected revision. Positions are revision-scoped and must not be treated as stable across revisions.
- **D-14:** Do not add stable item IDs in Phase 75. Revisit stable item identity only if a later phase needs cross-revision item tracking or partial item operations.
- **D-15:** Add, delete, and update are represented only by the resulting ordered `items[]` list. Add means a new entry appears in the submitted list; delete means a previous revision position is omitted; update means an entry at a revision-scoped position changes.
- **D-16:** Do not include `added`, `deleted`, or other intent metadata in Phase 75. Server validation and persistence use the resulting list only.
- **D-17:** Preserve submitted array order exactly. Server assigns persisted `position` from array index after validation. Do not sort, merge, dedupe, or reorder by name or macros.
- **D-18:** Duplicate item names are allowed. `name`/`foodName` is not item identity and must not drive reject, dedupe, or merge behavior.

### Validation and Edge Cases

- **D-19:** Every submitted grouped request item requires nonblank `name` and finite nonnegative `calories`, `protein`, `carbs`, and `fat`.
- **D-20:** Because this is full-list replacement, do not allow partial item patches or server-side merge behavior.
- **D-21:** Empty `items[]` is a `400` validation error. Grouped replacement must leave at least one item.
- **D-22:** Whole-meal deletion remains `DELETE /api/meals/:id` with its existing revision check, tombstone revision, affected-date summary recompute, `summaryOutcome`, and publish behavior. Do not treat empty item replacement as meal deletion.
- **D-23:** A request containing both `items[]` and scalar update fields such as `foodName`, `calories`, `protein`, `carbs`, or `fat` is invalid and returns `400`.
- **D-24:** Grouped `items[]` replacement cannot change images in Phase 75. Preserve the current meal image implicitly through existing update behavior when no image input is supplied.
- **D-25:** Whole-meal image changes and item-level photo mapping remain outside Phase 75 unless Phase 76 later proves an additive contract is needed.

### Summary, Receipt, and Response Shape

- **D-26:** Grouped `items[]` replacement follows the current direct PATCH summary and publish behavior exactly.
- **D-27:** After the revisioned item-list update commits, compute `affectedDate` from meal `loggedAt`, build `summaryOutcome` through the existing post-commit summary helper, derive optional `dailySummary` only from `summaryOutcome`, and publish through the existing `meal_mutation` daily_summary path only when the usable summary date matches `affectedDate`.
- **D-28:** Do not add grouped special cases for summary recompute, degraded `summaryOutcome`, publish failure handling, or realtime envelopes.
- **D-29:** Do not create chat receipts, assistant messages, compressed-history mutation outcomes, or chat mutation-outcome persistence for Phase 75 direct route edits.
- **D-30:** Grouped validation failures use the current direct route validation style: simple `400`, such as `{ error: "Invalid meal update" }`. Do not add field-level validation detail DTOs in Phase 75.
- **D-31:** Missing or stale `expectedMealRevisionId` returns the existing 409 `MEAL_REVISION_REQUIRED` / `MEAL_REVISION_STALE` body with `mealId`, `affectedDate`, and `currentMealRevisionId` only.
- **D-32:** Revision conflicts have no summary recompute or publish side effects and no grouped-specific conflict codes.

### the agent's Discretion

Planner may choose exact helper names, whether the grouped parser lives beside the current scalar parser or in a small shared route helper, and exact test naming. Planner should preserve the decisions above and prefer extending existing `server/routes/meals.ts` and meal transaction service boundaries over creating a parallel mutation path.

### Deferred Ideas (OUT OF SCOPE)

- Stable cross-revision item IDs are deferred until a later phase needs cross-revision item identity or partial item operations.
- Field-level validation detail DTOs are deferred; Phase 75 keeps current simple direct route validation style.
- `meal.items` in the PATCH response is deferred to Phase 76 or later if avoiding a post-edit refetch becomes important.
- Whole-meal image changes and item-level photo mapping remain outside Phase 75 unless Phase 76 proves an additive contract is required.
- Direct route edits creating chat receipts, assistant messages, or compressed-history mutation outcomes are deferred unless a later phase explicitly expands direct route edits into chat history.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| GROUP-EDIT-01 | Grouped meals support direct item updates for item name, calories, and macros through a validated server contract. [VERIFIED: .planning/REQUIREMENTS.md] | Extend the existing PATCH route parser to accept strict `items[]`; map `name` to `foodName`; reuse `foodLoggingService.updateMeal()`. Serving/quantity is not part of the Phase 75 write shape because D-07/D-10 lock grouped request items to `{ name, position, calories, protein, carbs, fat }`. [VERIFIED: 75-CONTEXT.md; VERIFIED: server/routes/meals.ts; VERIFIED: server/services/food-logging.ts] |
| GROUP-EDIT-02 | Grouped meals support direct item additions without relying on model-authored estimates as committed authority. [VERIFIED: .planning/REQUIREMENTS.md] | Treat add as a full replacement list submitted by the caller; do not create chat receipts or model mutation outcomes. [VERIFIED: 75-CONTEXT.md; VERIFIED: server/services/meal-transactions.ts] |
| GROUP-EDIT-03 | Grouped meals support direct item deletion without deleting the entire meal unless the user chooses a whole-meal delete action. [VERIFIED: .planning/REQUIREMENTS.md] | Delete is represented by omission from nonempty `items[]`; empty list remains `400`, and whole-meal delete stays on existing `DELETE /api/meals/:id`. [VERIFIED: 75-CONTEXT.md; VERIFIED: server/routes/meals.ts] |
| GROUP-EDIT-04 | Grouped direct edits preserve expected meal revision checks, affected-date freshness, `summaryOutcome`, and realtime publish behavior. [VERIFIED: .planning/REQUIREMENTS.md] | Keep the existing post-commit block and conflict handling; transaction service already rejects missing/stale expected revisions before writes. [VERIFIED: server/routes/meals.ts; VERIFIED: server/services/meal-transactions.ts; VERIFIED: tests/integration/meals-api.test.ts] |
</phase_requirements>

## Summary

Phase 75 should be planned as a narrow server-contract expansion, not a new grouped-meal subsystem. [VERIFIED: 75-CONTEXT.md; VERIFIED: .planning/ROADMAP.md] The current `PATCH /api/meals/:id` route already owns guest-session resolution, route validation, expected revision conflict response, summary recompute, `summaryOutcome`, optional `dailySummary`, and `meal_mutation` realtime publish. [VERIFIED: server/routes/meals.ts] The current transaction service already writes a complete ordered item list into a new meal revision, assigns persisted positions from array index, preserves existing image identity when no new image is supplied, and rejects missing/stale expected revisions before update writes. [VERIFIED: server/services/meal-transactions.ts]

Planning should focus on replacing the scalar-only `parseMealUpdateBody()` contract with a discriminated-by-shape parser that accepts exactly one of the legacy scalar shape or the strict grouped `items[]` replacement shape. [VERIFIED: server/routes/meals.ts; VERIFIED: 75-CONTEXT.md] The service call should remain `foodLoggingService.updateMeal()`, passing `items` built from public `{ name, position, calories, protein, carbs, fat }` rows after route validation. [VERIFIED: client/src/types.ts; VERIFIED: server/services/food-logging.ts]

**Primary recommendation:** Extend `server/routes/meals.ts` to parse a strict `items[]` replacement shape, reuse existing revisioned update/summary/publish code, and prove the behavior primarily in `tests/integration/meals-api.test.ts`. [VERIFIED: 75-CONTEXT.md; VERIFIED: tests/integration/meals-api.test.ts]

## Project Constraints (from AGENTS.md)

- Use `yarn` only; do not use npm for repo workflows. [VERIFIED: AGENTS.md]
- Keep changes surgical and avoid unrelated refactors, formatting churn, dependency changes, or cleanup outside Phase 75 scope. [VERIFIED: AGENTS.md]
- `server/routes/*.ts` own HTTP transport boundaries, request validation, auth checks, stream framing, and response shaping. [VERIFIED: AGENTS.md]
- `server/services/*.ts` own reusable domain and persistence logic. [VERIFIED: AGENTS.md]
- `server/app.ts` is the backend composition root for wiring services and route dependencies. [VERIFIED: AGENTS.md]
- The repo is ESM; local TypeScript imports use explicit `.js` specifiers. [VERIFIED: AGENTS.md; VERIFIED: package.json]
- Preserve the DI pattern: runtime uses `OpenAIProvider`; tests use `MockLLMProvider` or harness providers. [VERIFIED: AGENTS.md; VERIFIED: tests/integration/meals-api.test.ts]
- `TZ=Asia/Taipei` matters for day-boundary behavior and must remain in local/test setups. [VERIFIED: AGENTS.md; VERIFIED: scripts/run-node-with-tz.mjs via package.json]
- Use Node built-in `node:test`; do not introduce Jest or Vitest without explicit migration. [VERIFIED: AGENTS.md; VERIFIED: package.json]
- Use real SQLite in tests; `:memory:` is acceptable, but mocked DBs are not. [VERIFIED: AGENTS.md; VERIFIED: tests/integration/meals-api.test.ts]
- For `server/routes/*.ts` or `server/services/*.ts` edits, run `yarn test:integration`; for any TypeScript edit, run `yarn tsc --noEmit`. [VERIFIED: AGENTS.md]
- Before any staging/main promotion, run `yarn release:check`; Phase 75 planning does not authorize staging or main promotion. [VERIFIED: AGENTS.md; VERIFIED: .planning/REQUIREMENTS.md]

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|--------------|----------------|-----------|
| Direct grouped item replacement request validation | API / Backend | Browser / Client | The server route owns user-facing validation and must fail closed for malformed write payloads; Phase 76 client behavior is only caller support. [VERIFIED: AGENTS.md; VERIFIED: 75-CONTEXT.md] |
| Revision authority and conflict response | API / Backend | Database / Storage | `MealRevisionPreconditionError` is thrown from meal transaction checks and converted by the route into the existing structured 409 response. [VERIFIED: server/services/meal-transactions.ts; VERIFIED: server/routes/meals.ts] |
| Ordered item persistence | Database / Storage | API / Backend | `meal_revision_items` stores `revision_id`, `position`, `food_name`, and nutrition fields; the transaction service writes positions from array index in new revisions. [VERIFIED: server/db/schema.ts; VERIFIED: server/services/meal-transactions.ts] |
| Affected-date summary recompute and realtime publish | API / Backend | Realtime transport | The direct route builds `summaryOutcome`, derives `dailySummary`, and publishes `source: "meal_mutation"` after the update commits. [VERIFIED: server/routes/meals.ts] |
| Chat receipts and compressed-history mutation outcomes | API / Backend | Database / Storage | Phase 75 must not touch these for direct route edits; chat receipt/outcome persistence is owned by chat services and route paths, not `server/routes/meals.ts`. [VERIFIED: 75-CONTEXT.md; VERIFIED: server/routes/meals.ts; VERIFIED: server/services/chat.ts via codebase grep] |
| Grouped edit UI and item media behavior | Browser / Client | API / Backend | Phase 76 owns UI/read-refresh behavior and conditional item-media decisions, so Phase 75 should not add UI controls or item photo mapping. [VERIFIED: .planning/ROADMAP.md; VERIFIED: 75-CONTEXT.md] |

## Standard Stack

### Core

| Library / Tool | Version | Purpose | Why Standard |
|----------------|---------|---------|--------------|
| Fastify | `5.8.5` declared; registry latest `5.8.5`, latest publish time `2026-04-14T12:07:12.232Z`. [VERIFIED: package.json; VERIFIED: yarn info fastify] | HTTP route framework for `/api/meals/:id`. [VERIFIED: server/routes/meals.ts] | Existing route tests use `app.inject()` against `buildApp()`, so planner should extend Fastify integration tests instead of adding a new transport harness. [VERIFIED: tests/integration/meals-api.test.ts] |
| Drizzle ORM | `^0.39.0` declared; registry latest `0.45.2`, latest publish time `2026-05-22T07:01:03.828Z`. [VERIFIED: package.json; VERIFIED: yarn info drizzle-orm] | SQLite schema and query builders around meal revisions/items. [VERIFIED: server/db/schema.ts; VERIFIED: server/services/meal-transactions.ts] | Existing transaction service uses Drizzle builders plus one raw prepared query for the mutation guard; Phase 75 does not need schema or ORM changes. [VERIFIED: server/services/meal-transactions.ts] |
| better-sqlite3 | `^11.8.0` declared; registry latest `12.10.0`, latest publish time `2026-05-12T09:58:59.557Z`. [VERIFIED: package.json; VERIFIED: yarn info better-sqlite3] | SQLite runtime used by app/test database paths. [VERIFIED: .planning/codebase/STACK.md; VERIFIED: tests/integration/meals-api.test.ts] | Real SQLite integration tests are the repo standard for route/service behavior. [VERIFIED: AGENTS.md; VERIFIED: tests/integration/meals-api.test.ts] |
| Node built-in test runner | Node `v24.14.0` available locally. [VERIFIED: node -v] | Unit/integration test runner via `node --test`. [VERIFIED: package.json] | Project policy forbids Jest/Vitest migration for this phase and existing tests import `node:test`. [VERIFIED: AGENTS.md; VERIFIED: tests/integration/meals-api.test.ts] |
| TypeScript + tsx | `typescript ^5.7.0`, registry latest `6.0.3`; `tsx ^4.19.0`, registry latest `4.22.4`. [VERIFIED: package.json; VERIFIED: yarn info typescript; VERIFIED: yarn info tsx] | Strict ESM TypeScript execution for server/tests. [VERIFIED: package.json; VERIFIED: tsconfig.json via .planning/codebase/STACK.md] | Repo scripts already run TypeScript tests through `scripts/run-node-with-tz.mjs --import tsx`. [VERIFIED: package.json] |

### Supporting

| Library / Tool | Version | Purpose | When to Use |
|----------------|---------|---------|-------------|
| Yarn | `1.22.22` available locally. [VERIFIED: yarn -v] | Project command runner. [VERIFIED: AGENTS.md; VERIFIED: package.json] | Use for all verification commands; do not add npm workflows. [VERIFIED: AGENTS.md] |
| `gsd-tools` | Available on PATH. [VERIFIED: command -v gsd-tools] | GSD phase metadata lookup and optional commit helper. [VERIFIED: init.phase-op output] | Use only for planning artifact workflow; no runtime dependency. [VERIFIED: init.phase-op output] |
| SQLite CLI | `/usr/bin/sqlite3` available locally. [VERIFIED: command -v sqlite3] | Optional manual DB inspection. [VERIFIED: command availability] | Not needed for normal Phase 75 proof because tests use app services and real SQLite. [VERIFIED: tests/integration/meals-api.test.ts] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Extending `PATCH /api/meals/:id` | New `/api/meals/:id/items` subroutes | Explicitly rejected by D-01; planning must not add subroutes in Phase 75. [VERIFIED: 75-CONTEXT.md] |
| Existing transaction service | New grouped edit service | Adds a parallel mutation path even though `updateTransaction()` already persists full ordered lists under expected revision checks. [VERIFIED: 75-CONTEXT.md; VERIFIED: server/services/meal-transactions.ts] |
| Route-level strict parser | Client-only validation | Server route is the authority for malformed payload rejection and access-control boundaries. [VERIFIED: AGENTS.md; VERIFIED: 75-CONTEXT.md] |
| Integration tests in `meals-api.test.ts` | Browser/UI tests | Phase 76 owns UI; Phase 75 behavior is server route/service persistence and side effects. [VERIFIED: .planning/ROADMAP.md; VERIFIED: 75-CONTEXT.md] |

**Installation:**
```bash
# No new external packages for Phase 75. [VERIFIED: 75-CONTEXT.md; VERIFIED: package.json]
```

**Version verification:** Existing package declarations were checked in `package.json`, and current registry latest versions/times were checked with `yarn info <package> version` and `yarn info <package> time`. [VERIFIED: package.json; VERIFIED: yarn info fastify; VERIFIED: yarn info drizzle-orm; VERIFIED: yarn info better-sqlite3; VERIFIED: yarn info tsx; VERIFIED: yarn info typescript]

## Package Legitimacy Audit

Phase 75 should install no new external packages, so the package legitimacy gate is not applicable. [VERIFIED: 75-CONTEXT.md; VERIFIED: package.json]

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| none | — | — | — | — | Not run | Approved: no install scope. [VERIFIED: 75-CONTEXT.md] |

**Packages removed due to slopcheck [SLOP] verdict:** none. [VERIFIED: no external package recommendation]
**Packages flagged as suspicious [SUS]:** none. [VERIFIED: no external package recommendation]

## Architecture Patterns

### System Architecture Diagram

```text
PATCH /api/meals/:id
  |
  v
resolveGuestSession()
  |-- invalid session --> 401
  v
parse direct update body
  |-- scalar shape --> legacy scalar update path
  |-- strict items[] shape --> grouped full-list replacement path
  |-- mixed / malformed / empty items --> 400 Invalid meal update
  v
foodLoggingService.getMealMutationGuard()/updateMeal()
  |-- missing revision --> 409 MEAL_REVISION_REQUIRED, no summary/publish
  |-- stale/deleted revision --> 409 MEAL_REVISION_STALE, no summary/publish
  v
mealTransactionsService.updateTransaction()
  |
  v
SQLite transaction:
  insert meal_revisions(update)
  insert meal_revision_items ordered by submitted array index
  update meal_transactions.current_revision_id
  preserve imageAssetId if no image input
  |
  v
post-commit route side effects:
  affectedDate = formatLocalDate(updatedMeal.loggedAt)
  buildSummaryOutcomeAfterMealCommit()
  dailySummaryFromOutcome()
  publishDailySummarySafe(source="meal_mutation") only when summary.date == affectedDate
  |
  v
200 { affectedDate, summaryOutcome, optional dailySummary, aggregate meal }
```

All stages above are anchored in existing route/service behavior except the new strict `items[]` parser branch. [VERIFIED: server/routes/meals.ts; VERIFIED: server/services/meal-transactions.ts; VERIFIED: 75-CONTEXT.md]

### Recommended Project Structure

```text
server/
├── routes/meals.ts                 # Extend parser and direct PATCH branch. [VERIFIED: AGENTS.md; VERIFIED: server/routes/meals.ts]
├── services/food-logging.ts        # Reuse updateMeal compatibility projection; avoid new service. [VERIFIED: server/services/food-logging.ts]
├── services/meal-transactions.ts   # Reuse full-list revision transaction; add only if proof reveals a narrow gap. [VERIFIED: server/services/meal-transactions.ts]
└── db/schema.ts                    # No schema change expected. [VERIFIED: server/db/schema.ts; VERIFIED: 75-CONTEXT.md]
tests/
├── integration/meals-api.test.ts   # Primary Phase 75 proof. [VERIFIED: tests/integration/meals-api.test.ts]
└── unit/meal-transactions.test.ts  # Backfill only for ordering/history details route tests cannot inspect cleanly. [VERIFIED: tests/unit/meal-transactions.test.ts]
client/src/
├── types.ts                        # May extend write input types if planner wants compile-time client contract, but UI behavior stays Phase 76. [VERIFIED: client/src/types.ts; VERIFIED: 75-CONTEXT.md]
└── api.ts                          # Avoid Phase 76 UI/media behavior; client transport changes are optional in Phase 75 unless needed by tests/types. [VERIFIED: client/src/api.ts; VERIFIED: 75-CONTEXT.md]
```

### Pattern 1: Shape-based Route Parser

**What:** Parse exactly one update shape: legacy scalar fields or grouped `items[]`; reject mixed bodies and unknown per-item keys for grouped writes. [VERIFIED: 75-CONTEXT.md]

**When to use:** Use inside `server/routes/meals.ts` before any service mutation. [VERIFIED: server/routes/meals.ts]

**Example:**
```typescript
// Source: server/routes/meals.ts parser style + Phase 75 decisions. [VERIFIED: server/routes/meals.ts; VERIFIED: 75-CONTEXT.md]
type ParsedMealUpdate =
  | { kind: "scalar"; expectedMealRevisionId?: string; foodName: string; calories: number; protein: number; carbs: number; fat: number; imageAssetId?: string | null }
  | { kind: "items"; expectedMealRevisionId?: string; items: Array<{ foodName: string; calories: number; protein: number; carbs: number; fat: number }> };

// Planner should require tests for:
// - `items` plus scalar fields => null / 400
// - per-item `foodName` or `nutrition` => null / 400
// - `position !== array index` => null / 400
// - `items.length === 0` => null / 400
```

### Pattern 2: Reuse Post-Commit Summary/Publish Block

**What:** After grouped update commits, run the same direct PATCH summary recompute and publish path already used by scalar updates. [VERIFIED: server/routes/meals.ts; VERIFIED: 75-CONTEXT.md]

**When to use:** Use only after `foodLoggingService.updateMeal()` returns; conflicts and validation failures must return before this block. [VERIFIED: server/routes/meals.ts; VERIFIED: tests/integration/meals-api.test.ts]

**Example:**
```typescript
// Source: server/routes/meals.ts post-commit path. [VERIFIED: server/routes/meals.ts]
const summaryOutcome = await buildSummaryOutcomeAfterMealCommit({
  deviceId,
  affectedDate: affectedDateKey,
  summaryService,
  foodLoggingService,
});
const dailySummary = dailySummaryFromOutcome(summaryOutcome);
publishDailySummarySafe({ publisher, deviceId, dailySummary, summaryOutcome, affectedDate: affectedDateKey, log: request.log });
```

### Pattern 3: Real Fastify + SQLite Integration Proof

**What:** Build the app with `dbPath: ":memory:"`, register a device through `/api/device`, mutate via `app.inject()`, and assert response, side effects, and current meal state. [VERIFIED: tests/integration/meals-api.test.ts]

**When to use:** Use for all user-facing route contracts in Phase 75. [VERIFIED: AGENTS.md; VERIFIED: nutrition-gen-test skill]

**Example:**
```typescript
// Source: tests/integration/meals-api.test.ts fixture pattern. [VERIFIED: tests/integration/meals-api.test.ts]
app = await buildApp({
  dbPath: ":memory:",
  llmProvider: mockLLM,
  uploadsDir,
  assetsDir,
  onServicesReady: (readyServices) => {
    services = readyServices;
  },
});

const res = await app.inject({
  method: "PATCH",
  url: `/api/meals/${meal.id}`,
  headers: { cookie: deviceCookieHeader },
  payload: {
    expectedMealRevisionId: meal.mealRevisionId,
    items: [
      { name: "雞腿", position: 0, calories: 260, protein: 24, carbs: 0, fat: 12 },
    ],
  },
});
```

### Anti-Patterns to Avoid

- **Adding item subroutes:** Violates the locked route decision and creates extra contracts Phase 76 did not ask for. [VERIFIED: 75-CONTEXT.md]
- **Tolerant grouped write normalization:** Client read normalization currently accepts nested `nutrition` and sorts positions, but grouped writes must reject aliases and preserve submitted order. [VERIFIED: client/src/api.ts; VERIFIED: 75-CONTEXT.md]
- **Sorting or deduping items by name:** Persistence identity is revision-scoped zero-based position, and duplicate names are allowed. [VERIFIED: 75-CONTEXT.md; VERIFIED: server/services/meal-transactions.ts]
- **Returning summary fields on conflict:** Existing tests prove revision conflicts have no summary recompute or publish side effects. [VERIFIED: tests/integration/meals-api.test.ts]
- **Creating chat receipts for direct route edits:** Phase 75 explicitly excludes direct route chat receipt/outcome persistence. [VERIFIED: 75-CONTEXT.md]
- **Schema migration for item IDs:** Stable item IDs are deferred; current schema already supports ordered item rows per revision. [VERIFIED: 75-CONTEXT.md; VERIFIED: server/db/schema.ts]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Grouped item persistence | Custom grouped edit repository/service | `foodLoggingService.updateMeal()` -> `mealTransactionsService.updateTransaction()` [VERIFIED: server/services/food-logging.ts; VERIFIED: server/services/meal-transactions.ts] | Existing service already creates a new revision and inserts the full ordered item list. [VERIFIED: server/services/meal-transactions.ts] |
| Revision conflict handling | New grouped conflict codes | Existing `MealRevisionPreconditionError` and `sendMealRevisionConflict()` [VERIFIED: server/routes/meals.ts; VERIFIED: server/services/meal-transactions.ts] | Locked decision requires existing 409 bodies and no grouped-specific conflict codes. [VERIFIED: 75-CONTEXT.md] |
| Summary freshness outcome | New grouped summary response | `buildSummaryOutcomeAfterMealCommit()` + `dailySummaryFromOutcome()` [VERIFIED: server/routes/meals.ts] | Existing direct route response style already separates committed facts from summary availability. [VERIFIED: .planning/STATE.md; VERIFIED: server/routes/meals.ts] |
| Realtime envelope | New grouped SSE payload | Existing `publishDailySummarySafe()` using `source: "meal_mutation"` [VERIFIED: server/routes/meals.ts] | Tests assert the envelope omits summaryOutcome/meal ids and keeps publish failure metadata-only. [VERIFIED: tests/integration/meals-api.test.ts] |
| Input validation library | New Zod schema or field-level DTOs | Small route parser using existing helper style [VERIFIED: server/routes/meals.ts; VERIFIED: 75-CONTEXT.md] | Phase 75 defers field-level validation detail DTOs and should avoid dependency/pattern churn. [VERIFIED: 75-CONTEXT.md] |
| UI grouped editing | New client controls in Phase 75 | Phase 76 UI plan [VERIFIED: .planning/ROADMAP.md] | Phase 75 is server contract only. [VERIFIED: 75-CONTEXT.md] |

**Key insight:** The complicated part is preserving existing authority boundaries while widening one route body shape; persistence, revisioning, summary freshness, and publish behavior already exist. [VERIFIED: server/routes/meals.ts; VERIFIED: server/services/meal-transactions.ts; VERIFIED: 75-CONTEXT.md]

## Common Pitfalls

### Pitfall 1: Letting Tolerant Read Normalization Leak into Writes

**What goes wrong:** A write body with nested `nutrition`, per-item `foodName`, missing positions, or non-contiguous positions gets accepted. [VERIFIED: client/src/api.ts; VERIFIED: 75-CONTEXT.md]
**Why it happens:** `client/src/api.ts` read normalization intentionally tolerates nested `nutrition` and sorts positions for incoming DTOs. [VERIFIED: client/src/api.ts]
**How to avoid:** Implement a strict grouped write parser in `server/routes/meals.ts` and reject any per-item keys outside `name`, `position`, `calories`, `protein`, `carbs`, and `fat`. [VERIFIED: 75-CONTEXT.md]
**Warning signs:** Tests only cover happy-path grouped replacement and do not send aliases, nested nutrition, extra keys, wrong positions, or mixed scalar fields. [VERIFIED: tests/integration/meals-api.test.ts; ASSUMED]

### Pitfall 2: Checking Grouped Shape Before Revision Freshness

**What goes wrong:** Stale callers get validation/grouped errors instead of the existing 409 stale revision body. [VERIFIED: tests/integration/meals-api.test.ts]
**Why it happens:** The current route uses `getMealMutationGuard()` before grouped item-count rejection, preserving stale-first behavior for scalar edits against a now-grouped current revision. [VERIFIED: server/routes/meals.ts; VERIFIED: tests/integration/meals-api.test.ts]
**How to avoid:** Keep expected revision checks inside the service mutation path for grouped writes and keep scalar-on-grouped guard ordering aligned with current tests. [VERIFIED: server/services/meal-transactions.ts; VERIFIED: tests/integration/meals-api.test.ts]
**Warning signs:** A stale grouped `items[]` payload returns `400` or `MEAL_REQUIRES_GROUPED_UPDATE` instead of `MEAL_REVISION_STALE`. [VERIFIED: 75-CONTEXT.md]

### Pitfall 3: Treating Empty `items[]` as Whole-Meal Delete

**What goes wrong:** A grouped replacement request deletes a whole meal or creates a tombstone revision. [VERIFIED: 75-CONTEXT.md]
**Why it happens:** Full-list replacement makes an empty list look like delete intent unless the route fails closed. [VERIFIED: 75-CONTEXT.md]
**How to avoid:** Reject empty `items[]` with the existing simple `400` validation style before service mutation. [VERIFIED: 75-CONTEXT.md; VERIFIED: server/routes/meals.ts]
**Warning signs:** Tests assert `DELETE /api/meals/:id` and empty `items[]` share behavior. [ASSUMED]

### Pitfall 4: Losing Current Meal Image on Grouped Replacement

**What goes wrong:** A grouped item update clears a meal image even though Phase 75 has no image changes. [VERIFIED: 75-CONTEXT.md]
**Why it happens:** Current scalar route passes `imagePath: null`; `updateTransaction()` preserves the existing image when `parseAssetRef(input.imagePath)` is nullish, but route changes could accidentally pass a destructive explicit value if refactored poorly. [VERIFIED: server/routes/meals.ts; VERIFIED: server/services/meal-transactions.ts]
**How to avoid:** For grouped writes, omit image input or pass no new asset ref so `updateTransaction()` keeps `currentRevision.imageAssetId`. [VERIFIED: server/services/meal-transactions.ts; VERIFIED: 75-CONTEXT.md]
**Warning signs:** Post-update GET/history rows lose `imageAssetId` or `imageUrl` after item-only replacement. [VERIFIED: tests/integration/meals-api.test.ts]

### Pitfall 5: Publishing or Recomputing Summary on Failed Writes

**What goes wrong:** Missing/stale revisions, malformed payloads, or grouped validation failures trigger summary recompute or `daily_summary` publish. [VERIFIED: tests/integration/meals-api.test.ts]
**Why it happens:** Side effects are accidentally moved above the service commit or into validation/conflict branches. [VERIFIED: server/routes/meals.ts]
**How to avoid:** Keep summary/publish logic after successful `foodLoggingService.updateMeal()` only. [VERIFIED: server/routes/meals.ts]
**Warning signs:** Conflict tests need to increment summary or publish spies to detect false positives. [VERIFIED: tests/integration/meals-api.test.ts]

## Code Examples

Verified patterns from current codebase sources:

### Existing Conflict Response Shape

```typescript
// Source: server/routes/meals.ts. [VERIFIED: server/routes/meals.ts]
function sendMealRevisionConflict(reply: FastifyReply, error: MealRevisionPreconditionError) {
  return reply.code(409).send({
    error: error.code,
    mealId: error.mealId,
    affectedDate: error.affectedDate,
    currentMealRevisionId: error.currentMealRevisionId,
  });
}
```

### Existing Transaction Full-List Write

```typescript
// Source: server/services/meal-transactions.ts. [VERIFIED: server/services/meal-transactions.ts]
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

### Existing Route Response Minimum Shape

```typescript
// Source: server/routes/meals.ts. [VERIFIED: server/routes/meals.ts]
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
  },
};
```

## State of the Art

| Old Approach | Current Phase 75 Approach | When Changed | Impact |
|--------------|---------------------------|--------------|--------|
| Direct PATCH rejects grouped current meals with `MEAL_REQUIRES_GROUPED_UPDATE`. [VERIFIED: tests/integration/meals-api.test.ts] | Direct PATCH accepts strict `items[]` full-list replacement, while scalar payloads against grouped meals remain unsupported. [VERIFIED: 75-CONTEXT.md] | Phase 75. [VERIFIED: .planning/ROADMAP.md] | Grouped item add/update/delete becomes server-owned without chat correction authority. [VERIFIED: .planning/REQUIREMENTS.md] |
| Chat receipts may expose 1-based display positions. [VERIFIED: 75-CONTEXT.md; VERIFIED: server/services/chat.ts via codebase grep] | Direct grouped writes require zero-based `position` equal to array index. [VERIFIED: 75-CONTEXT.md] | Phase 75. [VERIFIED: 75-CONTEXT.md] | Phase 76 client must rebase receipt-origin positions before submit. [VERIFIED: 75-CONTEXT.md] |
| Read paths tolerate nested `nutrition` and sort item positions. [VERIFIED: client/src/api.ts] | Write path rejects nested `nutrition`, aliases, extra keys, and position mismatch. [VERIFIED: 75-CONTEXT.md] | Phase 75. [VERIFIED: 75-CONTEXT.md] | Planner must separate read DTO normalization from write validation. [VERIFIED: client/src/api.ts; VERIFIED: 75-CONTEXT.md] |

**Deprecated/outdated:**
- The direct grouped edit fallback message "Grouped meals must be corrected through chat." becomes stale for valid grouped `items[]` requests; it may remain only for unsupported scalar-on-grouped payloads. [VERIFIED: tests/integration/meals-api.test.ts; VERIFIED: 75-CONTEXT.md]

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Warning-sign test gaps are framed as expected future planning gaps rather than exhaustively verified absence of every missing assertion. | Common Pitfalls | Planner may need to re-scan tests after any concurrent changes before finalizing Wave 0. |

## Open Questions (RESOLVED)

1. **Should Phase 75 add a client transport type for grouped writes even though UI is Phase 76?**
   - What we know: Phase 75 does not build grouped Meal Edit UI, and Phase 76 owns read/refresh behavior. [VERIFIED: 75-CONTEXT.md]
   - What's unclear: The planner may decide whether `client/src/types.ts` / `client/src/api.ts` should gain a grouped write type now for compile-time contract preparation. [VERIFIED: client/src/types.ts; ASSUMED]
   - Resolution: Keep client transport changes optional and out of Phase 75 unless execution finds a narrow compile-time contract need. Route integration tests are sufficient to prove the server contract without adding UI behavior. [VERIFIED: tests/integration/meals-api.test.ts; VERIFIED: 75-CONTEXT.md]

2. **How much unit-level transaction proof is worth adding?**
   - What we know: `mealTransactionsService.updateTransaction()` already has unit proof for new revision identity, revision preconditions, and mealPeriod preservation. [VERIFIED: tests/unit/meal-transactions.test.ts]
   - What's unclear: Route tests may not inspect `meal_revision_items.position` across all add/delete/order cases unless they query internals or public history detail endpoints. [ASSUMED]
   - Resolution: Plan 03 owns focused transaction unit assertions for persisted position/order/image preservation, while Plan 01/02 keep the public route proof integration-first. [VERIFIED: AGENTS.md; VERIFIED: .planning/phases/75-grouped-meal-direct-crud-contract/75-03-PLAN.md]

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Node.js | TypeScript execution and Node test runner. [VERIFIED: package.json] | yes [VERIFIED: command output] | `v24.14.0` [VERIFIED: node -v] | none needed. [VERIFIED: package.json] |
| Yarn | All repo workflows. [VERIFIED: AGENTS.md] | yes [VERIFIED: command output] | `1.22.22` [VERIFIED: yarn -v] | none; npm is forbidden for repo workflows. [VERIFIED: AGENTS.md] |
| `gsd-tools` | Phase artifact workflow. [VERIFIED: init.phase-op output] | yes [VERIFIED: command -v gsd-tools] | path available; version not queried. [VERIFIED: command availability] | manual artifact write if needed. [ASSUMED] |
| SQLite CLI | Optional manual inspection. [VERIFIED: command availability] | yes [VERIFIED: command -v sqlite3] | path `/usr/bin/sqlite3`; version not queried. [VERIFIED: command availability] | Use test app/services; SQLite CLI is not required for Phase 75 proof. [VERIFIED: tests/integration/meals-api.test.ts] |
| Graphify context | Optional semantic codebase graph. [VERIFIED: graphify status] | no [VERIFIED: graphify status] | disabled. [VERIFIED: graphify status] | Use direct codebase grep/read. [VERIFIED: codebase grep] |

**Missing dependencies with no fallback:** none found for Phase 75 planning. [VERIFIED: environment audit]

**Missing dependencies with fallback:**
- Graphify is disabled; direct code inspection covers the phase scope. [VERIFIED: graphify status; VERIFIED: codebase grep]

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Node built-in `node:test` through Node `v24.14.0`. [VERIFIED: package.json; VERIFIED: node -v; VERIFIED: tests/integration/meals-api.test.ts] |
| Config file | none dedicated; scripts live in `package.json` and use `scripts/run-node-with-tz.mjs`. [VERIFIED: package.json] |
| Quick run command | `yarn test:integration` for route/service edits, plus `yarn tsc --noEmit` for TypeScript edits. [VERIFIED: AGENTS.md; VERIFIED: package.json] |
| Full suite command | `yarn test`; release/promotion gate is `yarn release:check`. [VERIFIED: package.json; VERIFIED: AGENTS.md] |

### Phase Requirements -> Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| GROUP-EDIT-01 | Valid grouped `items[]` update changes names/nutrition and returns aggregate meal + summary outcome. [VERIFIED: .planning/REQUIREMENTS.md; VERIFIED: 75-CONTEXT.md] | integration | `yarn test:integration -- tests/integration/meals-api.test.ts` is not a defined script pattern; use `yarn test:integration` or direct `node scripts/run-node-with-tz.mjs --import tsx --test tests/integration/meals-api.test.ts`. [VERIFIED: package.json] | yes: `tests/integration/meals-api.test.ts`. [VERIFIED: rg] |
| GROUP-EDIT-02 | 1 -> many replacement persists added items without chat receipt/outcome side effects. [VERIFIED: .planning/REQUIREMENTS.md; VERIFIED: 75-CONTEXT.md] | integration | `yarn test:integration` [VERIFIED: package.json] | yes, add cases to existing file. [VERIFIED: tests/integration/meals-api.test.ts] |
| GROUP-EDIT-03 | many -> one and many -> many replacement omit deleted items without whole-meal deletion; empty `items[]` returns 400. [VERIFIED: .planning/REQUIREMENTS.md; VERIFIED: 75-CONTEXT.md] | integration + optional unit | `yarn test:integration`; optional `yarn test:unit` if transaction unit coverage changes. [VERIFIED: package.json; VERIFIED: AGENTS.md] | yes: integration and transaction unit files exist. [VERIFIED: tests/integration/meals-api.test.ts; VERIFIED: tests/unit/meal-transactions.test.ts] |
| GROUP-EDIT-04 | Missing/stale revision conflicts preserve current 409 body and no summary/publish; successful grouped writes preserve affected-date summary/publish behavior. [VERIFIED: .planning/REQUIREMENTS.md; VERIFIED: 75-CONTEXT.md] | integration | `yarn test:integration` [VERIFIED: package.json] | yes; neighboring scalar tests already prove the pattern. [VERIFIED: tests/integration/meals-api.test.ts] |

### Sampling Rate

- **Per task commit:** `yarn tsc --noEmit` plus `yarn test:integration` for `server/routes/meals.ts` or `server/services/*.ts` edits. [VERIFIED: AGENTS.md]
- **Per wave merge:** `yarn test` when grouped route behavior and transaction/service tests change across the wave. [VERIFIED: package.json; VERIFIED: AGENTS.md]
- **Phase gate:** `yarn tsc --noEmit` and targeted tests required by changed paths; `yarn release:check` only before promotion readiness. [VERIFIED: AGENTS.md; VERIFIED: .planning/REQUIREMENTS.md]

### Wave 0 Gaps

- [ ] Add integration tests in `tests/integration/meals-api.test.ts` for valid grouped replacement, 1 -> many, many -> one, many -> many, mixed shape `400`, empty list `400`, invalid item fields `400`, wrong zero-based positions `400`, stale/missing revision side-effect suppression, image preservation, and scalar-on-grouped rejection. [VERIFIED: 75-CONTEXT.md; VERIFIED: tests/integration/meals-api.test.ts]
- [ ] Add focused transaction unit tests in `tests/unit/meal-transactions.test.ts` only if route tests do not directly prove persisted item order/history/image preservation. [VERIFIED: tests/unit/meal-transactions.test.ts; ASSUMED]
- [ ] No new test framework config is needed. [VERIFIED: package.json; VERIFIED: AGENTS.md]

## Security Domain

### Applicable ASVS Categories

OWASP ASVS is an application security verification standard; current OWASP guidance lists categories including V2 Authentication, V3 Session Management, V4 Access Control, V5 Validation/Sanitization/Encoding, and V6 Stored Cryptography. [CITED: https://devguide.owasp.org/en/08-culture-process/04-asvs/]

| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V2 Authentication | yes | Continue resolving signed guest sessions before PATCH/DELETE mutation handling. [VERIFIED: server/routes/meals.ts; VERIFIED: AGENTS.md] |
| V3 Session Management | yes | Keep browser route ownership cookie-backed; do not accept raw `deviceId` query/header authority. [VERIFIED: AGENTS.md; VERIFIED: server/routes/meals.ts] |
| V4 Access Control | yes | Continue service calls under resolved `deviceId`; foreign device mutation returns 404/unauthorized access behavior in existing tests. [VERIFIED: server/routes/meals.ts; VERIFIED: tests/integration/meals-api.test.ts] |
| V5 Validation, Sanitization and Encoding | yes | Strict route parser for `items[]`, finite nonnegative nutrition, nonblank names, exact positions, mutually exclusive shapes. [VERIFIED: 75-CONTEXT.md] |
| V6 Stored Cryptography | no new crypto | Do not add cryptography in Phase 75; preserve existing guest-session signing boundary. [VERIFIED: 75-CONTEXT.md; VERIFIED: AGENTS.md] |

### Known Threat Patterns for Fastify + SQLite Direct Mutation

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Client bypasses UI and sends malformed grouped write | Tampering | Server-owned strict parser; reject aliases, extra keys, nested nutrition, nonfinite/negative numbers, empty list, and wrong positions. [VERIFIED: 75-CONTEXT.md] |
| Cross-device meal mutation | Elevation of privilege / Information disclosure | Resolve signed guest session and call services with resolved `deviceId`, not caller-provided IDs. [VERIFIED: AGENTS.md; VERIFIED: server/routes/meals.ts] |
| Stale revision overwrites newer meal facts | Tampering | Require `expectedMealRevisionId` and return existing `MEAL_REVISION_REQUIRED` / `MEAL_REVISION_STALE` without side effects. [VERIFIED: server/services/meal-transactions.ts; VERIFIED: server/routes/meals.ts] |
| SQL injection through item names | Tampering | Use Drizzle insert values / parameterized queries; do not interpolate item names into raw SQL. [VERIFIED: server/services/meal-transactions.ts] |
| Data leakage in realtime envelopes | Information disclosure | Publish only strict `daily_summary` envelope without `summaryOutcome`, `mealId`, or `mealRevisionId`; existing tests assert these omissions. [VERIFIED: server/routes/meals.ts; VERIFIED: tests/integration/meals-api.test.ts] |
| Privacy leakage in proof artifacts | Information disclosure | Keep proof metadata-only and avoid raw prompts, user text, assistant final text, provider bodies, image data, session material, and database snapshots. [VERIFIED: .planning/REQUIREMENTS.md; VERIFIED: .planning/STATE.md] |

## Sources

### Primary (HIGH confidence)

- `.planning/phases/75-grouped-meal-direct-crud-contract/75-CONTEXT.md` - locked Phase 75 decisions, discretion, deferred scope, canonical refs. [VERIFIED: file read]
- `.planning/REQUIREMENTS.md` - GROUP-EDIT-01 through GROUP-EDIT-04 and v2.6 proof/release constraints. [VERIFIED: file read]
- `.planning/ROADMAP.md` - Phase 75 goal, dependency on Phase 74, implementation notes, Phase 76 boundary. [VERIFIED: file read]
- `.planning/STATE.md` - carry-forward decisions on revision authority, summary outcomes, metadata-only proof, no promotion. [VERIFIED: file read]
- `AGENTS.md` - project commands, architecture, testing, verification, release constraints. [VERIFIED: file read]
- `server/routes/meals.ts` - existing direct PATCH/DELETE route contract, parser style, conflict response, summary/publish behavior. [VERIFIED: codebase grep]
- `server/services/food-logging.ts` - grouped update data, compatibility projection, `updateMeal()` wrapper. [VERIFIED: codebase grep]
- `server/services/meal-transactions.ts` - revision precondition checks, full-list update transaction, item position persistence, image preservation. [VERIFIED: codebase grep]
- `server/db/schema.ts` - `meal_revisions`, `chat_meal_receipts`, `chat_mutation_outcomes`, and `meal_revision_items` schema. [VERIFIED: codebase grep]
- `tests/integration/meals-api.test.ts` - real Fastify/SQLite route proof patterns and existing direct mutation assertions. [VERIFIED: codebase grep]
- `tests/unit/meal-transactions.test.ts` - transaction-level revision/update proof. [VERIFIED: codebase grep]
- `client/src/types.ts` and `client/src/api.ts` - public `MealItemDetail` shape and tolerant read normalization boundary. [VERIFIED: codebase grep]
- `package.json` - scripts and declared package stack. [VERIFIED: file read]

### Secondary (MEDIUM confidence)

- OWASP Developer Guide ASVS page - ASVS category names used for security-domain mapping. [CITED: https://devguide.owasp.org/en/08-culture-process/04-asvs/]
- `yarn info` registry lookups for current latest versions and publish times of existing dependencies. [VERIFIED: yarn info]

### Tertiary (LOW confidence)

- None for implementation-critical recommendations. [VERIFIED: assumptions log]

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - local `package.json`, AGENTS rules, and registry probes confirm the existing stack; no new package recommendation is made. [VERIFIED: package.json; VERIFIED: AGENTS.md; VERIFIED: yarn info]
- Architecture: HIGH - route, service, schema, and tests directly expose the relevant mutation path. [VERIFIED: server/routes/meals.ts; VERIFIED: server/services/meal-transactions.ts; VERIFIED: tests/integration/meals-api.test.ts]
- Pitfalls: HIGH for locked-decision pitfalls and existing-test side effects; MEDIUM for exact Wave 0 gap list because planner should re-scan after any concurrent test changes. [VERIFIED: 75-CONTEXT.md; VERIFIED: tests/integration/meals-api.test.ts; ASSUMED]

**Research date:** 2026-06-03 [VERIFIED: system date]
**Valid until:** 2026-07-03 for codebase-local architecture; re-run registry/doc checks sooner if dependency upgrades enter scope. [ASSUMED]
