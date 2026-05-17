# Phase 62: Meal Revision Tokens and Stale Receipt Protection - Research

**Researched:** 2026-05-17  
**Domain:** Fastify/TypeScript optimistic concurrency for SQLite-backed meal revisions, chat receipts, and client stale-conflict UX  
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
## Implementation Decisions

### Revision Token Surface
- **D-01:** Add current `mealRevisionId` to every edit-capable read/display DTO and edit payload source: `LoggedMealReceipt`, `MealEntry`, `MealEditPayload`, `/api/meals` rows, direct update responses, chat JSON/SSE `loggedMeal`, and restored history receipts when they can open Meal Edit.
- **D-02:** Write inputs must carry `expectedMealRevisionId`, not plain `mealRevisionId`. This keeps read/display identity distinct from the write precondition contract.

### Expected Revision Enforcement
- **D-03:** Require `expectedMealRevisionId` for every authoritative mutation of an existing meal: direct `PATCH`, direct `DELETE`, chat/tool `update_meal`, and chat/tool `delete_meal` after the target meal has been resolved.
- **D-04:** Meal creation/logging is out of scope for expected revision enforcement because there is no prior revision to protect. Creation/logging request bodies must not accept `expectedMealRevisionId`.
- **D-05:** Apply the expected-revision contract to stale deletes as well as stale edits. A stale delete must not remove a newer meal state. This resolves the `STATE.md` stale-delete planning concern.

### Missing Or Stale Expected Revision Contract
- **D-06:** Missing `expectedMealRevisionId` fails closed with the same deterministic stale/precondition family as stale mismatches: no mutation, no new revision, no summary recompute, and no publish.
- **D-07:** Do not add a legacy compatibility exception for missing expected revisions unless a real rollout need is raised later. If such a need appears, it is a separate rollout decision, not the default Phase 62 behavior.
- **D-08:** Stale expected revisions must be rejected before the meal transaction write boundary creates a new revision.

### Stale Conflict HTTP Shape
- **D-09:** Missing `expectedMealRevisionId` must return `409 { error: "MEAL_REVISION_REQUIRED", ... }`.
- **D-10:** Stale expected revision mismatch must return `409 { error: "MEAL_REVISION_STALE", ... }`.
- **D-11:** The client must branch on the stable `error` string and show deterministic Traditional Chinese stale-record guidance. Exact user-facing copy is left for planning and tests.
- **D-12:** Existing route conventions already use `409` with a stable `error` string, for example `server/routes/meals.ts` returns `error: "MEAL_REQUIRES_GROUPED_UPDATE"` for grouped meal edit conflicts. Phase 62 should extend that body shape rather than introduce a separate `412` public convention.

### Client Recovery Behavior
- **D-13:** On stale conflict, the client should show deterministic Traditional Chinese stale-record guidance, close or block saving from the stale editor/receipt, and immediately refresh or invalidate the affected meal row/date.
- **D-14:** This recovery is a direct client reaction to the 409 response, via refetch or local invalidation; new SSE meal-row freshness behavior remains Phase 63.
- **D-15:** If refreshed current facts are available, the user should reopen Meal Edit from the fresh row or receipt rather than continuing from stale form state.
- **D-16:** Client-side refresh/redaction is UX support only. Server-side expected revision checks remain the authority.

### the agent's Discretion
- Planner may choose exact field placement and type names as long as read/display identity stays `mealRevisionId` and write precondition stays `expectedMealRevisionId`.
- Planner may decide whether stale conflict response bodies include refreshed meal facts directly or only enough affected-date metadata for the client to refetch, provided the client refreshes or invalidates affected rows.
- Planner may choose exact deterministic Traditional Chinese stale guidance copy and test fixture wording.

### Deferred Ideas (OUT OF SCOPE)
## Deferred Ideas

- Legacy compatibility exception for missing `expectedMealRevisionId` - deferred unless a real rollout need is raised later.
- Broader same-day and historical `/api/sse daily_summary` meal-row freshness and affected-date invalidation - Phase 63.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| FRESH-01 | User-facing meal and chat receipt DTOs carry current meal revision identity for edit-capable receipts. | `meal_transactions.currentRevisionId` is already loaded in meal history and chat receipt lookup paths, but `/api/meals`, legacy day snapshot projection, client `MealEntry`, `LoggedMealReceipt`, and `MealEditPayload` omit `mealRevisionId`. [VERIFIED: `.planning/REQUIREMENTS.md`, `server/services/meal-history.ts:29`, `server/services/chat.ts:67`, `server/routes/meals.ts:123`, `server/routes/day-snapshot.ts:36`, `client/src/types.ts:8`, `client/src/types.ts:67`, `client/src/types.ts:82`] |
| FRESH-02 | User cannot overwrite newer meal facts from an older chat receipt; stale expected revisions are rejected without mutation. | `updateTransaction` and `softDeleteTransaction` currently read the active row then insert a new revision without comparing an expected revision; this is the boundary that must fail before `meal_revisions` insert or `meal_transactions` update. [VERIFIED: `.planning/REQUIREMENTS.md`, `server/services/meal-transactions.ts:260`, `server/services/meal-transactions.ts:275`, `server/services/meal-transactions.ts:306`, `server/services/meal-transactions.ts:332`] |
| FRESH-03 | User sees deterministic stale-record guidance and the client refreshes or invalidates affected meal rows after a stale receipt conflict. | `client/src/api.ts` currently throws a generic `Error(error)` for non-OK update responses, and `MealEditScreen` currently maps unknown save/delete errors to generic copy; conflict handling must preserve stable `error` codes and run refresh/invalidation. [VERIFIED: `.planning/REQUIREMENTS.md`, `client/src/api.ts:205`, `client/src/api.ts:828`, `client/src/api.ts:839`, `client/src/components/MealEditScreen.tsx:121`, `client/src/components/MealEditScreen.tsx:153`, `client/src/components/MealEditScreen.tsx:181`] |
</phase_requirements>

## Summary

Phase 62 should be planned as an optimistic concurrency contract across storage, server DTOs, tool mutation contracts, and client edit flows. The authoritative read identity already exists as `meal_transactions.currentRevisionId`, and mutation results already expose `mealRevisionId` for some internal/chat paths; the gap is that edit-capable public DTOs and write requests do not consistently carry or enforce the revision token. [VERIFIED: `server/db/schema.ts:55`, `server/services/food-logging.ts:22`, `server/orchestrator/tools.ts:95`, `server/routes/meals.ts:123`, `client/src/types.ts:67`]

The storage check belongs in `server/services/meal-transactions.ts`, because both direct routes and chat/tool correction services commit through `updateTransaction` or `softDeleteTransaction`. Plan the work so missing and stale `expectedMealRevisionId` errors return before inserting a new `meal_revisions` row, before updating `meal_transactions.currentRevisionId`, and before any summary recompute or realtime publish. [VERIFIED: `62-CONTEXT.md`, `server/services/meal-transactions.ts:260`, `server/services/meal-transactions.ts:306`, `server/routes/meals.ts:201`, `server/routes/meals.ts:264`, `server/services/meal-correction.ts:692`, `server/services/meal-correction.ts:736`]

**Primary recommendation:** Implement a shared meal revision precondition error contract in `meal-transactions`, thread `expectedMealRevisionId` through direct and chat/tool mutation paths, then propagate `mealRevisionId` through all edit-capable read DTOs and client edit payloads with explicit stale-conflict UX. [VERIFIED: `62-CONTEXT.md`, `AGENTS.md`]

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|--------------|----------------|-----------|
| Current meal revision identity | Database / Storage | API / Backend | `meal_transactions.currentRevisionId` is the durable pointer to the latest active revision; API/services project it as public `mealRevisionId`. [VERIFIED: `server/db/schema.ts:55`, `server/services/meal-history.ts:29`, `server/services/chat.ts:67`] |
| Expected revision compare-and-write | API / Backend | Database / Storage | `meal-transactions` owns update/delete revision writes, so it must compare expected vs current before inserting a new revision. [VERIFIED: `62-CONTEXT.md`, `server/services/meal-transactions.ts:260`, `server/services/meal-transactions.ts:306`] |
| Direct meal edit/delete HTTP contract | API / Backend | Browser / Client | `server/routes/meals.ts` owns request parsing, status codes, conflict bodies, and post-commit summary/publish timing. [VERIFIED: `AGENTS.md`, `server/routes/meals.ts:141`, `server/routes/meals.ts:237`] |
| Chat/tool update/delete target freshness | API / Backend | LLM Orchestration | `find_meals` resolves targets before `update_meal`/`delete_meal`, but current tool session state stores only ids; it needs revision identity to pass expected revisions. [VERIFIED: `server/orchestrator/tools.ts:1126`, `server/orchestrator/tools.ts:1253`, `server/orchestrator/tools.ts:1326`] |
| Stale conflict guidance and row refresh | Browser / Client | API / Backend | The client must branch on stable 409 error codes and refresh/invalidate affected meal rows, but server checks remain authoritative. [VERIFIED: `62-CONTEXT.md`, `client/src/api.ts:205`, `client/src/components/MealEditScreen.tsx:121`] |

## Project Constraints (from AGENTS.md)

- Do not develop on `main`; promotion order is `feature/* -> staging -> main`, and `main` promotion requires explicit current-thread approval. [VERIFIED: `AGENTS.md`]
- Before merging to `staging` or `main`, run `yarn release:check`. [VERIFIED: `AGENTS.md`]
- Use `yarn` only for project commands; do not introduce npm-based project workflows. [VERIFIED: `AGENTS.md`]
- Preserve ESM imports with explicit `.js` specifiers for local TypeScript imports. [VERIFIED: `AGENTS.md`, `package.json`]
- Wire backend dependencies through `server/app.ts`; services/routes should use existing dependency injection and must not instantiate runtime LLM clients. [VERIFIED: `AGENTS.md`, `server/app.ts`]
- Keep route-owned transport boundaries, service-owned domain/persistence logic, orchestrator-owned model/tool flow, realtime fan-out in `server/realtime/publisher.ts`, and client transport/state in `client/src/api.ts`, `client/src/sse.ts`, and `client/src/store.ts`. [VERIFIED: `AGENTS.md`]
- Preserve signed cookie guest-session ownership for protected browser routes; do not trust raw `deviceId` query params or `x-device-id` headers. [VERIFIED: `AGENTS.md`, `server/routes/meals.ts:104`, `server/routes/chat.ts:873`]
- Keep `TZ=Asia/Taipei` as a boot/test boundary. [VERIFIED: `AGENTS.md`, `server/lib/time.ts`, `scripts/run-node-with-tz.mjs`]
- Use Node built-in `node:test`; do not introduce Jest or Vitest. [VERIFIED: `AGENTS.md`, `package.json`]
- Use real SQLite in tests; `:memory:` is acceptable and DB mocking is not. [VERIFIED: `AGENTS.md`, `tests/unit/meal-transactions.test.ts:17`]
- Treat `tests/harness/artifacts/**` as generated evidence and do not hand-edit artifacts. [VERIFIED: `AGENTS.md`]
- Route/service edits require `yarn tsc --noEmit` and `yarn test:integration`; unit-test edits require `yarn test:unit`. [VERIFIED: `AGENTS.md`]
- `server/routes/chat.ts` has strict SSE status/chunk/done ordering and upload cleanup invariants; Phase 62 should not alter SSE ordering while adding receipt fields. [VERIFIED: `AGENTS.md`, `server/routes/chat.ts:947`, `server/routes/chat.ts:1027`]

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| TypeScript | Installed `5.9.3`; npm latest `6.0.3`, modified 2026-04-16 | DTO contracts, error types, request/response payloads | The repo is full-stack TypeScript with `yarn tsc --noEmit` as the type gate. [VERIFIED: `yarn list`, `npm view typescript`, `package.json`] |
| Fastify | Installed `5.8.4`; npm latest `5.8.5`, modified 2026-04-14 | Direct meal routes, chat routes, integration tests | Fastify `.inject()` is documented for fake HTTP requests without starting a real server and ensures plugins are booted before testing. [VERIFIED: `yarn list`, `npm view fastify`, CITED: `https://github.com/fastify/fastify/blob/main/docs/Guides/Testing.md`] |
| Drizzle ORM | Installed `0.39.3`; npm latest `0.45.2`, modified 2026-05-15 | SQLite schema/query layer | Existing services use Drizzle and raw indexed SQL only for hot-path lookup; Phase 62 should reuse the existing persistence boundary. [VERIFIED: `yarn list`, `npm view drizzle-orm`, `server/services/meal-transactions.ts:119`] |
| better-sqlite3 | Installed `11.10.0`; npm latest `12.10.0`, modified 2026-05-12 | SQLite driver for app/tests | Existing tests use real SQLite `:memory:` via `createDb`; do not mock DB writes for concurrency proof. [VERIFIED: `yarn list`, `npm view better-sqlite3`, `tests/unit/meal-transactions.test.ts:17`] |
| Node built-in `node:test` | Runtime Node `v24.14.0` | Unit and integration test runner | Node docs cover `describe`, `it`, `beforeEach`, async tests, and mocking without Jest/Vitest. [VERIFIED: `node --version`, `package.json`, CITED: `https://github.com/nodejs/node/blob/main/doc/api/test.md`] |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| tsx | Installed `4.21.0`; npm latest `4.22.1`, modified 2026-05-17 | Execute TypeScript tests/scripts | Keep existing `node scripts/run-node-with-tz.mjs --import tsx --test ...` commands. [VERIFIED: `yarn list`, `npm view tsx`, `package.json`] |
| zod | Installed `4.3.6`; npm latest `4.4.3`, modified 2026-05-04 | Tool argument schemas | Use for `expected_meal_revision_id` in `update_meal`/`delete_meal`; Zod 4 docs recommend `z.strictObject()` over deprecated `.strict()` for new schemas, but existing code still uses `.strict()` compatibly. [VERIFIED: `yarn list`, `npm view zod`, `server/orchestrator/tools.ts:459`, CITED: `https://zod.dev/v4/changelog`] |
| Zustand | Installed `5.0.12`; npm latest `5.0.13`, modified 2026-05-05 | Client store and conflict recovery actions | Zustand `create` actions receive `set`/`get`, matching the existing `client/src/store.ts` action style. [VERIFIED: `yarn list`, `npm view zustand`, `client/src/store.ts:134`, CITED: `https://github.com/pmndrs/zustand/blob/main/docs/reference/apis/create.md`] |
| React | Installed `19.2.4`; npm latest `19.2.6`, modified 2026-05-08 | Meal edit and receipt UI | Existing UI is React; no new UI framework is needed. [VERIFIED: `yarn list`, `npm view react`, `client/src/components/MealEditScreen.tsx`] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Transaction-service precondition check | Route-only stale check | Route-only checks would not protect chat/tool update/delete and could race before transaction insert. [VERIFIED: `62-CONTEXT.md`, `server/services/meal-transactions.ts:260`, `server/services/meal-transactions.ts:306`] |
| Stable `409` error strings | HTTP `412` with a different body shape | Locked decisions require `409` and existing route conventions already branch on stable `error` strings. [VERIFIED: `62-CONTEXT.md`, `server/routes/meals.ts:168`] |
| Extend existing `node:test` suites | Add Jest/Vitest or browser-only tests | AGENTS.md forbids new test frameworks without migration; existing unit/integration files cover the relevant boundaries. [VERIFIED: `AGENTS.md`, `tests/unit/meal-transactions.test.ts`, `tests/integration/meals-api.test.ts`] |

**Installation:**
```bash
# No new packages recommended for Phase 62.
```

**Version verification:** Installed versions were verified with `yarn list --depth=0 --pattern ...`; current registry versions and modified timestamps were verified with `npm view <package> version time.modified` for research only. [VERIFIED: yarn/npm registry]

## Architecture Patterns

### System Architecture Diagram

```text
Edit-capable read path
  /api/meals, /api/day-snapshot, /api/history/days, chat JSON/SSE/history receipt
        |
        v
Project current storage identity as mealRevisionId
        |
        v
Client normalizes MealEntry / LoggedMealReceipt
        |
        v
MealEditPayload keeps mealRevisionId
        |
        v
Direct save/delete sends expectedMealRevisionId
        |
        v
Route parses body/query precondition
        |
        v
meal-transactions compares expected vs current
        |
        +--> missing/stale -> throw typed revision error
        |                   -> route returns 409 stable error
        |                   -> no new revision, no summary, no publish
        |                   -> client shows stale guidance + refresh/invalidate
        |
        +--> current -> insert meal_revisions row
                    -> update meal_transactions.currentRevisionId
                    -> recompute summaryOutcome
                    -> publish same-day summary if available
                    -> return updated meal with new mealRevisionId

Chat/tool path
  find_meals resolves mealId + current mealRevisionId
        |
        v
  toolSessionState stores resolved target identity
        |
        v
  update_meal/delete_meal passes expectedMealRevisionId
        |
        v
  same meal-transactions compare-and-write boundary
```

### Recommended Project Structure

```text
server/
├── services/
│   ├── meal-transactions.ts      # authoritative expected revision comparison
│   ├── food-logging.ts           # direct compatibility update/delete signatures
│   ├── meal-correction.ts        # chat/tool target identity and mutation threading
│   ├── meal-history.ts           # current day / day snapshot mealRevisionId projection
│   ├── history-query.ts          # history day/search mealRevisionId projection where edit-capable
│   └── chat.ts                   # restored receipt mealRevisionId projection
├── routes/
│   ├── meals.ts                  # 409 conflict shape, direct request parsing, post-commit only summary/publish
│   ├── day-snapshot.ts           # legacy day snapshot DTO projection
│   └── chat.ts                   # JSON/SSE loggedMeal projection
└── orchestrator/
    └── tools.ts                  # expected_meal_revision_id tool contracts + resolved target state

client/src/
├── types.ts                      # MealEntry/LoggedMealReceipt/MealEditPayload/UpdateMealInput/Delete options
├── api.ts                        # normalization + conflict error class/code preservation
├── meal-edit-payload.ts          # read mealRevisionId -> edit payload
├── store.ts                      # stale receipt redaction/refresh actions
└── components/MealEditScreen.tsx # deterministic stale guidance + blocked stale save/delete
```

### Pattern 1: Typed Revision Precondition Errors

**What:** Define a narrow backend error shape for missing vs stale expected revisions and map it at route/tool boundaries. [VERIFIED: `62-CONTEXT.md`, `server/routes/meals.ts:194`]

**When to use:** Every existing-meal update/delete mutation before `meal_revisions` insert. [VERIFIED: `62-CONTEXT.md`, `server/services/meal-transactions.ts:275`, `server/services/meal-transactions.ts:332`]

**Example:**
```ts
// Source: repo pattern in server/routes/meals.ts + Phase 62 CONTEXT.md
export class MealRevisionPreconditionError extends Error {
  constructor(
    readonly code: "MEAL_REVISION_REQUIRED" | "MEAL_REVISION_STALE",
    readonly mealId: string,
    readonly currentMealRevisionId?: string,
  ) {
    super(code);
  }
}

function assertExpectedRevision(existing: MealTransactionRow, expectedMealRevisionId?: string) {
  if (!expectedMealRevisionId) {
    throw new MealRevisionPreconditionError("MEAL_REVISION_REQUIRED", existing.id, existing.currentRevisionId);
  }
  if (expectedMealRevisionId !== existing.currentRevisionId) {
    throw new MealRevisionPreconditionError("MEAL_REVISION_STALE", existing.id, existing.currentRevisionId);
  }
}
```

### Pattern 2: Read Identity vs Write Preconditions

**What:** Public read DTOs expose `mealRevisionId`; mutation inputs send `expectedMealRevisionId`. [VERIFIED: `62-CONTEXT.md`]

**When to use:** Any edit-capable meal row, receipt, or edit payload. [VERIFIED: `62-CONTEXT.md`, `client/src/meal-edit-payload.ts:60`, `client/src/meal-edit-payload.ts:79`]

**Example:**
```ts
// Source: Phase 62 CONTEXT.md D-01/D-02 + client/src/meal-edit-payload.ts pattern
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
}

await updateMeal(payload.mealId, {
  ...parsedDraft,
  imageAssetId: payload.imageAssetId ?? null,
  expectedMealRevisionId: payload.mealRevisionId,
});
```

### Pattern 3: Route Conflict Returns Before Side Effects

**What:** Direct routes should return `409` conflict bodies immediately when the service throws precondition errors. [VERIFIED: `62-CONTEXT.md`, `server/routes/meals.ts:168`]

**When to use:** `PATCH /api/meals/:id` and `DELETE /api/meals/:id`. [VERIFIED: `server/routes/meals.ts:141`, `server/routes/meals.ts:237`]

**Example:**
```ts
// Source: existing server/routes/meals.ts catch pattern + Phase 62 CONTEXT.md D-09/D-10
} catch (error) {
  if (error instanceof MealRevisionPreconditionError) {
    return reply.code(409).send({
      error: error.code,
      mealId: error.mealId,
      currentMealRevisionId: error.currentMealRevisionId,
    });
  }
  if (error instanceof Error && error.message === "MEAL_NOT_FOUND") {
    return reply.code(404).send({ error: "Meal not found" });
  }
  throw error;
}
```

### Anti-Patterns to Avoid

- **Client-only stale protection:** A hidden/disabled stale receipt can improve UX, but it does not prevent stale writes from another tab, chat/tool path, or crafted request. [VERIFIED: `.planning/REQUIREMENTS.md`, `62-CONTEXT.md`]
- **Checking revision after insert:** A stale error after `meal_revisions` insert would still create a newer revision and violate FRESH-02. [VERIFIED: `62-CONTEXT.md`, `server/services/meal-transactions.ts:275`, `server/services/meal-transactions.ts:332`]
- **Using `mealRevisionId` as a write field:** Locked decisions reserve `mealRevisionId` for read/display identity and `expectedMealRevisionId` for write preconditions. [VERIFIED: `62-CONTEXT.md`]
- **Leaving tool target state as meal ids only:** `resolvedMealIds` cannot satisfy the expected revision contract for chat/tool update/delete. [VERIFIED: `server/orchestrator/tools.ts:1253`, `server/orchestrator/tools.ts:1326`]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Optimistic concurrency check | UI-only stale flags or ad hoc route reads | `meal-transactions` compare against `currentRevisionId` before write | Covers direct and chat/tool mutation callers at the single revision write boundary. [VERIFIED: `62-CONTEXT.md`, `server/services/meal-transactions.ts:260`, `server/services/meal-transactions.ts:306`] |
| HTTP test harness | Manual server startup for route tests | Fastify `app.inject()` | Fastify docs support fake injection and existing tests already use `buildApp()` fixtures. [CITED: `https://github.com/fastify/fastify/blob/main/docs/Guides/Testing.md`, VERIFIED: `tests/integration/meals-api.test.ts:31`] |
| Client conflict parsing | Plain `Error(message)` only | A typed/client error code or preserved `error` field from JSON response | FRESH-03 requires deterministic branching on stable `MEAL_REVISION_*` strings. [VERIFIED: `62-CONTEXT.md`, `client/src/api.ts:205`] |
| Chat correction target freshness | LLM-provided revision guesses | Resolver-owned `mealRevisionId` from `find_meals` candidate/current row | The model should not invent revision identity; resolver reads current DB state. [VERIFIED: `server/services/meal-correction.ts:342`, `server/orchestrator/tools.ts:1126`] |

**Key insight:** The revision token is not a UI freshness hint; it is a server-side write precondition that must be carried from authoritative read DTO to mutation input and verified at the persistence boundary. [VERIFIED: `62-CONTEXT.md`, `.planning/REQUIREMENTS.md`]

## Common Pitfalls

### Pitfall 1: Exposing `mealRevisionId` Only On Chat Success Receipts

**What goes wrong:** Fresh chat receipts may be protected, but home/history/day-detail direct edit rows still save without an expected revision. [VERIFIED: `server/routes/chat.ts:415`, `server/routes/meals.ts:123`, `client/src/types.ts:82`]

**Why it happens:** `ToolExecutionResult.loggedMeal` already has `mealRevisionId`, so the implementation can appear done while route/client DTOs still omit the field. [VERIFIED: `server/orchestrator/tools.ts:95`, `server/routes/chat.ts:415`]

**How to avoid:** Add `mealRevisionId` to `MealHistoryEntry`, `/api/meals`, `/api/day-snapshot`, history day/search DTOs where they can feed edit payloads, chat JSON/SSE `loggedMeal`, restored chat history receipts, and client normalizers. [VERIFIED: `62-CONTEXT.md`, `server/services/meal-history.ts:12`, `server/routes/day-snapshot.ts:36`, `server/services/history-query.ts:20`, `server/services/chat.ts:116`, `client/src/api.ts:729`]

**Warning signs:** `buildHistoryMealEditPayload(...)` or `buildReceiptMealEditPayload(...)` can return a payload without `mealRevisionId`. [VERIFIED: `client/src/meal-edit-payload.ts:60`, `client/src/meal-edit-payload.ts:79`]

### Pitfall 2: Summary Recompute Runs After A Rejected Write

**What goes wrong:** A stale request could fail but still refresh summaries or publish realtime updates, creating false evidence of a committed mutation. [VERIFIED: `62-CONTEXT.md`, `server/routes/meals.ts:201`, `server/routes/meals.ts:264`]

**Why it happens:** Current direct routes recompute/publish immediately after `foodLoggingService.updateMeal/deleteMeal`; conflict handling must return from the catch before those post-commit blocks. [VERIFIED: `server/routes/meals.ts:181`, `server/routes/meals.ts:201`, `server/routes/meals.ts:254`, `server/routes/meals.ts:264`]

**How to avoid:** Make precondition errors throw before commit and map them to 409 in the existing `try/catch`; do not call `buildSummaryOutcomeAfterMealCommit` or `publishDailySummarySafe` for those errors. [VERIFIED: `62-CONTEXT.md`, `server/routes/meals.ts:194`]

**Warning signs:** Tests see a new `meal_revisions` row, changed `currentRevisionId`, `summaryOutcome`, or publish call after missing/stale expected revision. [VERIFIED: `server/services/meal-transactions.ts:275`, `server/services/meal-transactions.ts:332`]

### Pitfall 3: Chat Tool Path Cannot Supply Expected Revision

**What goes wrong:** Direct UI saves become protected, but `update_meal`/`delete_meal` tool calls still mutate by meal id only. [VERIFIED: `62-CONTEXT.md`, `server/orchestrator/tools.ts:1260`, `server/orchestrator/tools.ts:1331`]

**Why it happens:** `toolSessionState` currently stores `resolvedMealIds: string[]`, and `MealCorrectionCandidate` does not include `mealRevisionId`. [VERIFIED: `server/orchestrator/tools.ts:34`, `server/services/meal-correction.ts:28`]

**How to avoid:** Extend `MealCorrectionCandidate` with `mealRevisionId`, store resolved target identities in tool session state, extend `update_meal`/`delete_meal` schemas with `expected_meal_revision_id` only if the tool contract should make the field explicit, and have backend resolver state supply it so the LLM does not invent it. [VERIFIED: `62-CONTEXT.md`, `server/services/meal-correction.ts:342`, `server/orchestrator/tools.ts:1213`]

**Warning signs:** Tests still set `toolSessionState: { resolvedMealIds: [created.id] }` without a revision token. [VERIFIED: `tests/unit/tools.test.ts:1207`, `tests/unit/tools.test.ts:1270`, `tests/unit/tools.test.ts:1311`]

### Pitfall 4: Stale Conflict Loses The Stable Error Code In The Client

**What goes wrong:** The route returns `MEAL_REVISION_STALE`, but `MealEditScreen` only sees a generic `Error` and shows generic failure copy. [VERIFIED: `client/src/api.ts:205`, `client/src/components/MealEditScreen.tsx:153`, `client/src/components/MealEditScreen.tsx:181`]

**Why it happens:** `getResponseErrorMessage` extracts `body.error` into `Error.message`, but there is no typed stale conflict object or affected-date metadata. [VERIFIED: `client/src/api.ts:205`, `client/src/api.ts:847`]

**How to avoid:** Add a small client error class or typed result that preserves `error`, `mealId`, `affectedDate`, and optional current meal facts; `MealEditScreen` should branch on `MEAL_REVISION_REQUIRED`/`MEAL_REVISION_STALE`, show deterministic Traditional Chinese guidance, close/block the stale editor, and call row refresh/invalidation. [VERIFIED: `62-CONTEXT.md`, `client/src/components/MealEditScreen.tsx:121`]

**Warning signs:** User-facing copy remains `"餐點暫時無法儲存，請稍後再試。"` for stale revision conflicts. [VERIFIED: `client/src/components/MealEditScreen.tsx:159`, `client/src/components/MealEditScreen.tsx:185`]

## Code Examples

Verified patterns from current sources:

### Existing Direct Route Conflict Shape

```ts
// Source: server/routes/meals.ts:167-171
if (itemCount > 1) {
  return reply.code(409).send({
    error: "MEAL_REQUIRES_GROUPED_UPDATE",
    message: "Grouped meals must be corrected through chat.",
  });
}
```

### Current Write Boundary That Needs Precondition Input

```ts
// Source: server/services/meal-transactions.ts:306-320
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
  const revisionNumber = existing.currentRevisionNumber + 1;
  const revisionId = `${existing.id}:r${revisionNumber}`;
}
```

### Existing Client Refresh After Committed Mutation

```ts
// Source: client/src/components/MealEditScreen.tsx:121-130
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

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Mutate existing meals by `mealId` only | Require `expectedMealRevisionId` and compare it to current revision before write | Phase 62 locked decision, 2026-05-17 | Planner must add a write precondition to direct and chat/tool update/delete paths. [VERIFIED: `62-CONTEXT.md`] |
| Hide old chat receipts by omitting `mealId`/`dateKey` when receipt revision is no longer current | Expose current `mealRevisionId` on edit-capable receipts and reject stale expected revisions server-side | Phase 62 locked decision, 2026-05-17 | Existing display-only redaction remains UX support, not the authority. [VERIFIED: `server/services/chat.ts:112`, `client/src/store.ts:146`, `62-CONTEXT.md`] |
| History responses intentionally avoided raw revision fields | Public edit-capable DTOs should expose `mealRevisionId`, while still avoiding internal `currentRevisionId` and raw revision metadata | Phase 62 locked decision, 2026-05-17 | Update tests that deny `currentRevisionId`/raw metadata without blocking public `mealRevisionId`. [VERIFIED: `tests/integration/history-api.test.ts:96`, `62-CONTEXT.md`] |

**Deprecated/outdated:**
- `resolvedMealIds` as the only chat target authority is outdated for Phase 62 because it lacks revision identity. [VERIFIED: `server/orchestrator/tools.ts:1253`, `62-CONTEXT.md`]
- `UpdateMealInput` without `expectedMealRevisionId` is outdated for existing meal edits. [VERIFIED: `client/src/types.ts:96`, `62-CONTEXT.md`]
- Direct route delete without a body/query precondition is outdated because stale deletes must fail closed. [VERIFIED: `server/routes/meals.ts:237`, `62-CONTEXT.md`]

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Research validity through 2026-06-16 is sufficient for codebase-local architecture unless dependency upgrades enter scope. [ASSUMED] | Metadata | Planner may need to re-run docs/version checks if stack upgrades become part of the phase. |
| A2 | Prefer a minimal stale conflict body with `{ error, mealId, affectedDate, currentMealRevisionId }` plus client refetch before adding full refreshed meal facts to the response. [ASSUMED] | Open Questions | If client refetch is too slow or lacks enough row context, planner may choose refreshed facts in the 409 body. |
| A3 | Resolver-owned `{ mealId, mealRevisionId }` in `toolSessionState` is safer than relying on the model to provide `expected_meal_revision_id`. [ASSUMED] | Open Questions | If tool contract visibility is required for traceability, planner may expose the field in schema while still validating against resolver-owned state. |

## Open Questions

1. **Should stale conflict bodies include refreshed meal facts or only invalidation metadata?**
   - What we know: Context explicitly allows either refreshed facts or enough affected-date metadata for the client to refetch. [VERIFIED: `62-CONTEXT.md`]
   - What's unclear: The exact response body is left to planning. [VERIFIED: `62-CONTEXT.md`]
   - Recommendation: Prefer `{ error, mealId, affectedDate, currentMealRevisionId }` plus client refetch first; include full refreshed meal facts only if tests show it materially simplifies deterministic UI. [ASSUMED]

2. **Should the LLM tool schema expose `expected_meal_revision_id` or should backend resolver state supply it internally?**
   - What we know: Write inputs must carry `expectedMealRevisionId`, and `find_meals` is the backend resolver before tool mutation. [VERIFIED: `62-CONTEXT.md`, `server/orchestrator/tools.ts:1126`]
   - What's unclear: The planner may choose exact field placement and type names. [VERIFIED: `62-CONTEXT.md`]
   - Recommendation: Store resolver-owned `{ mealId, mealRevisionId }` in `toolSessionState` and pass it as `expectedMealRevisionId`; do not rely on the model to author the revision token. [VERIFIED: `server/orchestrator/tools.ts:1253`, ASSUMED]

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Node.js | Runtime and `node:test` | yes | `v24.14.0` | None needed. [VERIFIED: `node --version`] |
| Yarn classic | Project commands | yes | `1.22.22` | None; AGENTS requires yarn. [VERIFIED: `yarn --version`, `AGENTS.md`] |
| npm CLI | Registry version verification only | yes | path found | Use `yarn list` for installed versions. [VERIFIED: `command -v npm`, `yarn list`] |
| sqlite3 CLI | Optional local DB inspection | yes | path found | Use app/test SQLite APIs for automated proof. [VERIFIED: `command -v sqlite3`, `tests/unit/meal-transactions.test.ts`] |
| Context7 CLI fallback | Documentation lookup | yes | `ctx7@latest` via `npx --yes` | Use official docs URLs directly if unavailable. [VERIFIED: Context7 CLI output] |
| OpenAI API | Live runtime only | Not required for local Phase 62 tests | — | Use `MockLLMProvider` and app fixtures. [VERIFIED: `tests/integration/meals-api.test.ts:15`, `tests/integration/meals-api.test.ts:31`] |

**Missing dependencies with no fallback:** None found for research/planning. [VERIFIED: environment probes]

**Missing dependencies with fallback:** Live OpenAI access is not required for planned local unit/integration tests because existing tests inject `MockLLMProvider`. [VERIFIED: `tests/integration/meals-api.test.ts:15`, `tests/integration/meals-api.test.ts:31`]

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Node built-in `node:test` on Node `v24.14.0`, executed through `tsx 4.21.0`. [VERIFIED: `node --version`, `yarn list`, `package.json`] |
| Config file | None dedicated; scripts live in `package.json`, and test commands run through `scripts/run-node-with-tz.mjs`. [VERIFIED: `package.json`] |
| Quick run command | `node scripts/run-node-with-tz.mjs --import tsx --test <target files>` for focused tests. [VERIFIED: `package.json`, `AGENTS.md`] |
| Full suite command | `yarn test`; phase/release closure also needs `yarn release:check` when required by workflow. [VERIFIED: `package.json`, `AGENTS.md`, `.planning/REQUIREMENTS.md`] |

### Phase Requirements -> Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| FRESH-01 | `/api/meals`, direct update response, chat JSON/SSE `loggedMeal`, restored chat history receipts, and edit payload builders expose `mealRevisionId` wherever edit can start. | integration + unit | `node scripts/run-node-with-tz.mjs --import tsx --test tests/integration/meals-api.test.ts tests/integration/chat-api.test.ts tests/integration/chat-streaming.test.ts tests/unit/api-client.test.ts tests/unit/meal-edit-payload.test.ts` | yes, extend existing files. [VERIFIED: listed test files] |
| FRESH-02 | Current expected revisions allow update/delete; missing/stale expected revisions reject without new revision, meal mutation, summary recompute, or publish. | unit + integration | `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/meal-transactions.test.ts tests/unit/food-logging.test.ts tests/unit/meal-correction.test.ts tests/unit/tools.test.ts tests/integration/meals-api.test.ts tests/integration/chat-meal-correction.integration.test.ts` | yes, extend existing files. [VERIFIED: listed test files] |
| FRESH-03 | Client branches on `MEAL_REVISION_REQUIRED`/`MEAL_REVISION_STALE`, shows deterministic Traditional Chinese guidance, closes/blocks stale editor, and refreshes or invalidates affected rows. | unit/component-source + api unit | `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/api-client.test.ts tests/unit/meal-edit-screen.test.ts tests/unit/store.test.ts` | yes, extend existing files. [VERIFIED: listed test files] |

### Sampling Rate

- **Per task commit:** `yarn tsc --noEmit` plus targeted `node scripts/run-node-with-tz.mjs --import tsx --test ...` for changed route/service/orchestrator/client tests. [VERIFIED: `AGENTS.md`]
- **Per wave merge:** `yarn test:unit` and `yarn test:integration` when both backend and client surfaces are touched. [VERIFIED: `package.json`, `AGENTS.md`]
- **Phase gate:** `yarn tsc --noEmit && yarn test && yarn release:check` before release-proof closure or `$gsd-verify-work`. [VERIFIED: `.planning/REQUIREMENTS.md`, `AGENTS.md`]

### Wave 0 Gaps

- [ ] Add `mealRevisionId` assertions to `tests/integration/meals-api.test.ts` for `GET /api/meals`, `PATCH /api/meals/:id` response meal, and expected revision success/missing/stale conflicts. [VERIFIED: `tests/integration/meals-api.test.ts:121`, `tests/integration/meals-api.test.ts:181`]
- [ ] Add transaction-service unit tests proving missing/stale update/delete creates no new revision and leaves `currentRevisionId` unchanged. [VERIFIED: `tests/unit/meal-transactions.test.ts`, `server/services/meal-transactions.ts:275`, `server/services/meal-transactions.ts:332`]
- [ ] Extend `tests/unit/tools.test.ts` and `tests/unit/meal-correction.test.ts` so `find_meals` resolves revision identity and `update_meal`/`delete_meal` pass expected revisions. [VERIFIED: `tests/unit/tools.test.ts:1207`, `tests/unit/meal-correction.test.ts:90`]
- [ ] Extend `tests/integration/chat-api.test.ts` / `tests/integration/chat-streaming.test.ts` to assert JSON/SSE/restored history receipt `mealRevisionId` and stale chat/tool conflicts do not emit mutation receipts. [VERIFIED: `tests/integration/chat-api.test.ts:1776`, `server/routes/chat.ts:947`]
- [ ] Extend `tests/unit/api-client.test.ts`, `tests/unit/meal-edit-payload.test.ts`, `tests/unit/meal-edit-screen.test.ts`, and `tests/unit/store.test.ts` for client normalization, expected revision request bodies, and stale guidance/refresh behavior. [VERIFIED: listed tests, `client/src/api.ts:839`, `client/src/meal-edit-payload.ts:60`, `client/src/components/MealEditScreen.tsx:153`]
- [ ] Update history/day snapshot tests if those surfaces become edit sources in this phase, while continuing to deny internal `currentRevisionId` and raw revision metadata. [VERIFIED: `tests/integration/history-api.test.ts:96`, `server/routes/day-snapshot.ts:36`, `server/services/history-query.ts:20`]

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V2 Authentication | yes | Continue signed guest-session cookie resolution in protected routes. [VERIFIED: `AGENTS.md`, `server/routes/meals.ts:104`] |
| V3 Session Management | yes | Preserve active/resume cookie behavior; Phase 62 should not alter cookie TTL or EventSource auth. [VERIFIED: `AGENTS.md`, `server/lib/guest-session-resolver.ts`] |
| V4 Access Control | yes | Keep mutations scoped by resolved `deviceId`; foreign meal updates/deletes must still return not found/unauthorized. [VERIFIED: `server/services/meal-transactions.ts:113`, `tests/integration/meals-api.test.ts:222`] |
| V5 Input Validation | yes | Validate required `expectedMealRevisionId` on route and tool inputs; reject missing/stale with stable 409 error strings. [VERIFIED: `62-CONTEXT.md`, `server/routes/meals.ts:154`, `server/orchestrator/tools.ts:459`] |
| V6 Cryptography | no direct change | Existing HMAC-signed guest sessions remain unchanged. [VERIFIED: `.planning/codebase/INTEGRATIONS.md`] |
| V7 Error Handling and Logging | yes | Stale conflict logs/responses must stay metadata-only and must not include raw user text, prompts, tool payloads, provider bodies, image data, sessions, or DB snapshots. [VERIFIED: `AGENTS.md`, `.planning/REQUIREMENTS.md`] |

### Known Threat Patterns for Fastify/SQLite Revision Preconditions

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Lost update from stale receipt | Tampering | Compare `expectedMealRevisionId` with `currentRevisionId` at transaction-service write boundary. [VERIFIED: `62-CONTEXT.md`, `server/services/meal-transactions.ts:113`] |
| Cross-device stale token reuse | Elevation of privilege | Fetch active transaction by `{ deviceId, transactionId }` before comparing revision; do not resolve by revision id alone. [VERIFIED: `server/services/meal-transactions.ts:113`] |
| Information disclosure through conflict body | Information disclosure | Return stable error and minimal metadata; do not expose internal `currentRevisionId` field names or raw revision history. [VERIFIED: `62-CONTEXT.md`, `tests/integration/history-api.test.ts:96`] |
| Forged client-side success after conflict | Repudiation / Integrity | Client stale guidance must be driven by server 409 response; no client-only stale protection is authoritative. [VERIFIED: `.planning/REQUIREMENTS.md`, `62-CONTEXT.md`] |

## Sources

### Primary (HIGH confidence)

- `62-CONTEXT.md` - locked Phase 62 decisions, error codes, client behavior, deferred Phase 63 scope. [VERIFIED: local file]
- `.planning/REQUIREMENTS.md` - FRESH-01 through FRESH-03 and proof/privacy constraints. [VERIFIED: local file]
- `.planning/ROADMAP.md` - Phase 62 goal, success criteria, dependency, and implementation notes. [VERIFIED: local file]
- `.planning/STATE.md` - v2.3 stale-receipt and stale-delete decisions. [VERIFIED: local file]
- `AGENTS.md` - project architecture, commands, testing, and promotion rules. [VERIFIED: local file]
- `server/services/meal-transactions.ts`, `server/services/food-logging.ts`, `server/services/meal-correction.ts`, `server/services/meal-history.ts`, `server/services/chat.ts`, `server/services/history-query.ts` - revision storage, projection, and mutation boundaries. [VERIFIED: codebase grep/read]
- `server/routes/meals.ts`, `server/routes/chat.ts`, `server/routes/day-snapshot.ts`, `server/routes/history.ts` - HTTP/SSE DTO and conflict response boundaries. [VERIFIED: codebase grep/read]
- `client/src/types.ts`, `client/src/api.ts`, `client/src/meal-edit-payload.ts`, `client/src/store.ts`, `client/src/components/MealEditScreen.tsx`, `client/src/components/MessageBubble.tsx` - client DTO normalization, edit payload, stale UX, and receipt affordances. [VERIFIED: codebase grep/read]
- Fastify Testing Guide - `fastify.inject()` testing behavior. [CITED: `https://github.com/fastify/fastify/blob/main/docs/Guides/Testing.md`]
- Node.js test runner docs - `node:test` API. [CITED: `https://github.com/nodejs/node/blob/main/doc/api/test.md`]
- Zustand `create` docs - store actions and `set`/`get` pattern. [CITED: `https://github.com/pmndrs/zustand/blob/main/docs/reference/apis/create.md`]
- Zod v4 changelog - `z.strictObject()` recommendation for new strict object schemas. [CITED: `https://zod.dev/v4/changelog`]
- npm registry - current package versions and modified dates. [VERIFIED: npm registry]

### Secondary (MEDIUM confidence)

- Context7 CLI docs extracts for `/fastify/fastify`, `/nodejs/node`, `/pmndrs/zustand`, and `/websites/zod_dev_v4`; used as documentation lookup mirrors for official sources. [VERIFIED: Context7 CLI]

### Tertiary (LOW confidence)

- None. [VERIFIED: source review]

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - installed package versions and npm registry versions were checked in this session. [VERIFIED: `yarn list`, `npm view`]
- Architecture: HIGH - revision identity, DTO projection, and mutation paths were traced in local source. [VERIFIED: codebase grep/read]
- Pitfalls: HIGH - pitfalls map directly to current code gaps and Phase 62 locked decisions. [VERIFIED: `62-CONTEXT.md`, `server/services/meal-transactions.ts`, `client/src/api.ts`]

**Research date:** 2026-05-17  
**Valid until:** 2026-06-16 for codebase-local architecture; re-check npm/doc versions if dependency upgrades enter scope. [ASSUMED]
