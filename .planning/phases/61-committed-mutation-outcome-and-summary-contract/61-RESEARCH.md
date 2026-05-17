# Phase 61: Committed Mutation Outcome and Summary Contract - Research

**Researched:** 2026-05-17  
**Domain:** Fastify/TypeScript mutation response contracts, SQLite-backed meal mutations, post-commit summary recovery  
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
## Implementation Decisions

### Summary Outcome Contract
- **D-01:** Add an explicit `summaryOutcome` union for post-commit summary availability:
  ```ts
  type SummaryOutcome =
    | { status: "fresh"; dailySummary: DailySummary }
    | { status: "recovered"; dailySummary: DailySummary; reason: "recompute_failed" }
    | { status: "unavailable"; reason: "recompute_failed" };
  ```
- **D-02:** `summaryOutcome` describes whether the response can include a usable daily summary after the mutation commits. It must not describe realtime fan-out delivery.
- **D-03:** `recovered` must be exposed externally. Recovery is not silent because silent recovery would preserve the current bad coupling around `committedSummary: DailySummary` / `requireDailySummaryForLoggedMeal(...)` and could mislead future freshness logic.
- **D-04:** `publish_failed` must not be part of `summaryOutcome`. Publish failure does not change whether the current response has a usable `dailySummary`; it remains metadata-only observability.

### Public Response Parity
- **D-05:** The same public `summaryOutcome` contract applies to chat JSON responses, chat stream terminal payloads (`done` / `stopped` where applicable), and direct `PATCH` / `DELETE` meal route responses.
- **D-06:** `/api/sse daily_summary` events are excluded from this contract. Phase 63 owns event-arrived summary freshness and meal-row invalidation.
- **D-07:** Keep top-level `dailySummary` temporarily as a derived compatibility field only when `summaryOutcome` is `fresh` or `recovered`. `unavailable` responses must not synthesize a top-level `dailySummary`.
- **D-08:** Client HTTP consumers are in scope only enough to parse and consume `summaryOutcome` safely and avoid treating missing top-level `dailySummary` as mutation failure.

### User-Facing Receipt Copy
- **D-09:** Backend-rendered mutation receipt text stays committed-facts only for `fresh`, `recovered`, and `unavailable` summary outcomes.
- **D-10:** Do not append summary freshness caveats to meal log, update, or delete receipts. A successful mutation should not feel failed solely because summary recompute degraded.
- **D-11:** `summaryOutcome` is the structured degraded-signal channel for chat/direct HTTP clients and tests:
  - `fresh` and `recovered` may expose `dailySummary`.
  - `unavailable` exposes committed mutation facts without `dailySummary`.
  - temporary top-level `dailySummary` is derived only from `summaryOutcome.dailySummary`.
- **D-12:** Phase 61 does not add a visible stale-summary UI indicator. If product later wants visible degraded-summary UX, track it as a separate future polish/integrity follow-up, not as Phase 63 work.

### Recovery Policy
- **D-13:** Use the same recovery policy for every meal mutation family: chat `log_food`, chat `update_meal`, chat `delete_meal`, direct `PATCH`, and direct `DELETE`.
- **D-14:** After the mutation commits, first try the normal `summaryService.getDailySummary(...)` recompute.
- **D-15:** If normal recompute fails, attempt recovery from persisted meals for the affected date.
- **D-16:** If recovery succeeds, return `summaryOutcome.status === "recovered"` with `reason: "recompute_failed"` and the recovered `dailySummary`.
- **D-17:** If recovery also fails, return committed mutation facts with `summaryOutcome.status === "unavailable"` and `reason: "recompute_failed"`.
- **D-18:** This preserves current `log_food` resilience and prevents update/delete/direct routes from drifting into a different degraded-summary behavior.

### HTTP And Scope Boundaries
- **D-19:** Committed direct `PATCH` and `DELETE` responses remain HTTP `200` regardless of `summaryOutcome.status`. Degraded summary availability is represented in the response body, not with HTTP `207` or an error status.
- **D-20:** Do not extend Phase 61 to `update_goals`. Goal summary-outcome migration is out of scope for this phase; any type asymmetry is accepted for v2.3 unless the planner finds a purely internal refactor that does not change the Phase 61 surface.
- **D-21:** Phase 61 only requires publish failure to preserve committed mutation outcome and leave metadata-only observability. Do not mix realtime delivery status into the mutation response contract.

### the agent's Discretion
- Planner may choose the exact helper/module placement for `SummaryOutcome`, summary recovery helpers, and response projection, as long as the public contract and route/tool parity above hold.
- Planner may decide whether compatibility `dailySummary` projection is handled at service/tool boundaries or route projection boundaries, provided it is derived only from `summaryOutcome.dailySummary`.
- Planner may choose the exact metadata-only log/event names for recompute recovery/unavailable and publish failure observability.

### Deferred Ideas (OUT OF SCOPE)
## Deferred Ideas

- Visible degraded-summary UI for unavailable or recovered summaries — future polish/integrity follow-up if product wants it. This is not Phase 63.
- Goal mutation migration to `summaryOutcome` — out of scope for Phase 61; accepted type asymmetry for v2.3 unless a planner finds a purely internal refactor that does not alter Phase 61's public surface.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| MUT-01 | User receives a committed log receipt when meal logging persists even if daily summary recompute or publish fails. | Existing `log_food` persists before recompute and already recovers from persisted meals; planner must convert this to explicit `summaryOutcome` and add unavailable coverage. [VERIFIED: `server/orchestrator/tools.ts:1039`, `server/orchestrator/tools.ts:1045`, `server/orchestrator/tools.ts:1053`, `tests/unit/tools.test.ts:961`] |
| MUT-02 | User receives a committed update receipt when meal editing persists even if daily summary recompute or publish fails. | `mealCorrectionService.updateMeal` commits through `updateTransaction` before recompute, but currently returns required `dailySummary`; planner must split committed facts from summary availability. [VERIFIED: `server/services/meal-correction.ts:676`, `server/services/meal-correction.ts:680`, `server/services/meal-transactions.ts:332`, `server/services/meal-transactions.ts:381`] |
| MUT-03 | User receives a committed delete receipt when meal deletion persists even if daily summary recompute or publish fails. | `mealCorrectionService.deleteMeal` soft-deletes before recompute, but currently returns required `dailySummary`; planner must preserve `deletedMeal` facts on degraded summary. [VERIFIED: `server/services/meal-correction.ts:723`, `server/services/meal-correction.ts:724`, `server/services/meal-transactions.ts:275`, `server/services/meal-transactions.ts:288`] |
| MUT-04 | Direct meal `PATCH` / `DELETE` routes distinguish committed mutation facts from degraded or failed summary refresh status. | Direct routes currently recompute/publish after commit and return `dailySummary`; planner must add body-level `summaryOutcome` while keeping committed degraded responses HTTP `200`. [VERIFIED: `server/routes/meals.ts:160`, `server/routes/meals.ts:169`, `server/routes/meals.ts:180`, `server/routes/meals.ts:214`, `server/routes/meals.ts:220`, `server/routes/meals.ts:229`] |
</phase_requirements>

## Summary

Phase 61 should be planned as a contract extraction and propagation phase, not as a persistence rewrite. SQLite meal mutations already commit through `createTransaction`, `updateTransaction`, and `softDeleteTransaction`; the bug is that several response paths still require post-commit `DailySummary` availability before the user receives the committed mutation outcome. [VERIFIED: `server/services/meal-transactions.ts:181`, `server/services/meal-transactions.ts:332`, `server/services/meal-transactions.ts:275`, `server/routes/meals.ts:169`, `server/services/meal-correction.ts:680`]

The standard implementation should add a shared `SummaryOutcome` projection helper, reuse the existing persisted-meals recovery idea from `log_food`, and route chat JSON, chat SSE terminal payloads, and direct `PATCH`/`DELETE` responses through the same contract. `publishDailySummary` failure must stay a non-fatal metadata-only concern and must not affect `summaryOutcome`. [VERIFIED: `61-CONTEXT.md`, `server/orchestrator/tools.ts:1045`, `server/routes/chat.ts:386`, `server/realtime/publisher.ts:50`]

**Primary recommendation:** Add a shared post-commit summary outcome module and make mutation response DTOs derive `dailySummary` only from `summaryOutcome.status === "fresh" | "recovered"`. [VERIFIED: `61-CONTEXT.md`]

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|--------------|----------------|-----------|
| SQLite meal log/update/delete commit authority | Database / Storage | API / Backend | Meal transactions write durable rows/revisions in SQLite; API/backend should treat those writes as the source of committed facts. [VERIFIED: `server/services/meal-transactions.ts:181`, `server/services/meal-transactions.ts:332`, `server/services/meal-transactions.ts:275`] |
| Summary recompute and persisted-meal recovery | API / Backend | Database / Storage | Summary availability is computed after commit by querying persisted meal state; recovery should live in reusable backend service/helper code. [VERIFIED: `server/services/summary.ts:22`, `server/orchestrator/tools.ts:1047`, `server/orchestrator/tools.ts:1054`] |
| Chat mutation receipt copy | API / Backend | Frontend Server (SSR): — | Receipt copy is backend-rendered in `mutation-receipts.ts`, and Phase 61 explicitly keeps copy committed-facts only. [VERIFIED: `server/orchestrator/mutation-receipts.ts:103`, `61-CONTEXT.md`] |
| HTTP/SSE response projection | API / Backend | Browser / Client | Routes currently shape JSON/SSE payloads; client only needs safe parsing and should not infer mutation failure from missing `dailySummary`. [VERIFIED: `server/routes/chat.ts:944`, `server/routes/chat.ts:1419`, `client/src/api.ts:632`, `61-CONTEXT.md`] |
| Realtime `daily_summary` fan-out | API / Backend | Browser / Client | Existing publisher only fans out events; Phase 61 excludes event freshness and treats publish errors as metadata-only. [VERIFIED: `server/realtime/publisher.ts:27`, `server/realtime/publisher.ts:50`, `server/routes/chat.ts:386`, `61-CONTEXT.md`] |

## Project Constraints (from AGENTS.md)

- Do not develop on `main`; promotion order is `feature/* -> staging -> main`, and `main` promotion requires explicit current-thread approval. [VERIFIED: `AGENTS.md`]
- Before merging to `staging` or `main`, run `yarn release:check`. [VERIFIED: `AGENTS.md`]
- Use `yarn` only for project commands; do not introduce npm-based project workflows. [VERIFIED: `AGENTS.md`]
- Preserve ESM imports with explicit `.js` specifiers for local TypeScript imports. [VERIFIED: `AGENTS.md`, `package.json`]
- Wire backend dependencies through `server/app.ts`; do not instantiate runtime services or LLM clients inside route/service code. [VERIFIED: `AGENTS.md`, `server/app.ts:73`]
- Keep route-owned transport boundaries, service-owned domain/persistence logic, orchestrator-owned model/tool flow, realtime fan-out in `server/realtime/publisher.ts`, and client transport/state in `client/src/api.ts`, `client/src/sse.ts`, and `client/src/store.ts`. [VERIFIED: `AGENTS.md`]
- Preserve signed cookie guest-session ownership for protected browser routes; do not trust raw `deviceId` query params or `x-device-id` headers. [VERIFIED: `AGENTS.md`, `server/routes/meals.ts:69`, `server/routes/chat.ts:873`]
- Keep `TZ=Asia/Taipei` as a boot/test boundary. [VERIFIED: `AGENTS.md`, `server/app.ts:80`, `tests/integration/meals-api.test.ts:1`]
- Use Node built-in `node:test`; do not introduce Jest or Vitest. [VERIFIED: `AGENTS.md`, `package.json`]
- Use real SQLite in tests; `:memory:` is acceptable and DB mocking is not. [VERIFIED: `AGENTS.md`, `tests/integration/meals-api.test.ts:38`]
- Treat `tests/harness/artifacts/**` as generated evidence; do not hand-edit artifacts. [VERIFIED: `AGENTS.md`]
- Route/service edits require `yarn tsc --noEmit` and `yarn test:integration`; unit-test edits require `yarn test:unit`. [VERIFIED: `AGENTS.md`]
- `server/routes/chat.ts` has strict SSE ordering and upload cleanup invariants; Phase 61 should preserve status/chunk/done/stopped sequencing while adding terminal payload fields. [VERIFIED: `AGENTS.md`, `server/routes/chat.ts:904`, `server/routes/chat.ts:944`]

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| TypeScript | Installed `5.9.3`; npm latest `6.0.3`, modified 2026-04-16 | Contract types, discriminated unions, backend/client DTOs | The repo is full-stack TypeScript and already compiles server/client/tests through `yarn tsc --noEmit`. [VERIFIED: `yarn list`, `npm view typescript`, `package.json`] |
| Fastify | Installed `5.8.4`; npm latest `5.8.5`, modified 2026-04-14 | HTTP routes, `app.inject()` integration tests | Route tests should use Fastify injection because Fastify documents `.inject()` as fake HTTP injection that boots plugins and avoids a real server. [VERIFIED: `yarn list`, `npm view fastify`, CITED: `https://github.com/fastify/fastify/blob/main/docs/Guides/Testing.md`] |
| Drizzle ORM | Installed `0.39.3`; npm latest `0.45.2`, modified 2026-05-15 | SQLite query layer and schema access | Existing services use Drizzle/SQLite, so Phase 61 should reuse service queries rather than add another persistence layer. [VERIFIED: `yarn list`, `npm view drizzle-orm`, `server/services/summary.ts:24`] |
| better-sqlite3 | Installed `11.10.0`; npm latest `12.10.0`, modified 2026-05-12 | Synchronous SQLite driver | Existing app/tests use real SQLite through app wiring and `:memory:` DBs. [VERIFIED: `yarn list`, `npm view better-sqlite3`, `tests/integration/meals-api.test.ts:38`] |
| Node built-in `node:test` | Runtime Node `v24.14.0` | Unit/integration test runner | Node docs show `node:test` supports `describe`, `it`, lifecycle hooks, async tests, and mocking; repo scripts already use `node --test`. [VERIFIED: `node --version`, `package.json`, CITED: `https://github.com/nodejs/node/blob/main/doc/api/test.md`] |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| tsx | Installed `4.21.0`; npm latest `4.22.1`, modified 2026-05-17 | Execute TypeScript tests/scripts under Node | Keep existing `node --import tsx --test ...` scripts for Phase 61 tests. [VERIFIED: `yarn list`, `npm view tsx`, `package.json`] |
| zod | Installed `4.3.6`; npm latest `4.4.3`, modified 2026-05-04 | Tool argument schemas | Keep using existing tool-contract validation; `SummaryOutcome` itself can be a TypeScript union unless external runtime validation is needed. [VERIFIED: `yarn list`, `npm view zod`, `server/orchestrator/tools.ts:1`] |
| RealtimePublisher | Local module | Same-origin SSE fan-out | Use only after a usable `dailySummary` exists and keep publish failure outside `summaryOutcome`. [VERIFIED: `server/realtime/publisher.ts:27`, `server/realtime/publisher.ts:50`, `61-CONTEXT.md`] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Shared `SummaryOutcome` helper | Per-route `try/catch` blocks | Duplicates recovery semantics and risks log/update/delete/direct route drift. [VERIFIED: `61-CONTEXT.md`, `server/orchestrator/tools.ts:1047`, `server/routes/meals.ts:169`] |
| HTTP `200` with body-level `summaryOutcome` | HTTP `207` or post-commit `500` | Locked decision requires committed direct route responses to stay `200`; non-200 would make committed mutations feel failed. [VERIFIED: `61-CONTEXT.md`] |
| Existing Node test runner | Jest/Vitest | AGENTS.md forbids introducing Jest/Vitest without explicit migration. [VERIFIED: `AGENTS.md`] |

**Installation:**
```bash
# No new packages recommended for Phase 61.
```

**Version verification:** Versions above were verified with `yarn list --depth=0` for installed package versions and `npm view <package> version time.modified` for npm registry currency. [VERIFIED: yarn/npm registry]

## Architecture Patterns

### System Architecture Diagram

```text
Chat tool call or PATCH/DELETE request
        |
        v
Validate route/tool input + guest session
        |
        v
Commit SQLite mutation
  - log_food -> createTransaction
  - update_meal/PATCH -> updateTransaction
  - delete_meal/DELETE -> softDeleteTransaction
        |
        v
Build committed mutation facts
        |
        v
Try summaryService.getDailySummary(affectedDate)
        |
        +--> success --------------------------+
        |                                      |
        v                                      v
summaryOutcome: fresh                  Project response:
dailySummary included                  - committed receipt/facts
                                       - summaryOutcome
        ^
        |
recompute throws
        |
        v
Recover from persisted meals for affectedDate
        |
        +--> success: summaryOutcome recovered + dailySummary
        |
        +--> failure: summaryOutcome unavailable, no dailySummary
        |
        v
Publish daily_summary only if same-day and usable summary exists
        |
        v
Publish failure logs metadata-only and does not alter response
```

### Recommended Project Structure

```text
server/
├── services/
│   ├── summary-outcome.ts        # shared SummaryOutcome type + recompute/recovery helper
│   ├── meal-correction.ts        # update/delete commit facts call shared helper
│   └── summary.ts                # existing aggregate query remains unchanged
├── orchestrator/
│   ├── tools.ts                  # tool results expose summaryOutcome
│   ├── mutation-effects.ts       # meal effects no longer require committedSummary
│   └── mutation-receipts.ts      # copy remains committed-facts only
└── routes/
    ├── chat.ts                   # JSON/SSE terminal payload projection
    └── meals.ts                  # direct PATCH/DELETE response projection

client/src/
├── types.ts                      # shared client DTO shape for SummaryOutcome
├── api.ts                        # parse summaryOutcome and compatibility dailySummary safely
└── components/MealEditScreen.tsx # do not fail committed mutation if summary unavailable
```

### Pattern 1: Discriminated `SummaryOutcome`

**What:** Use a string-literal discriminated union where `dailySummary` exists only on `fresh` and `recovered`. [VERIFIED: `61-CONTEXT.md`]

**When to use:** Every committed meal mutation response that needs to report post-commit summary availability. [VERIFIED: `61-CONTEXT.md`]

**Example:**
```ts
// Source: Phase 61 CONTEXT.md D-01
export type SummaryOutcome =
  | { status: "fresh"; dailySummary: DailySummary }
  | { status: "recovered"; dailySummary: DailySummary; reason: "recompute_failed" }
  | { status: "unavailable"; reason: "recompute_failed" };

export function dailySummaryFromOutcome(outcome: SummaryOutcome): DailySummary | undefined {
  return outcome.status === "unavailable" ? undefined : outcome.dailySummary;
}
```

### Pattern 2: Post-Commit Summary Outcome Helper

**What:** Put the recompute/recovery/unavailable policy behind one helper so chat tools and direct routes cannot drift. [VERIFIED: `61-CONTEXT.md`, `server/orchestrator/tools.ts:1047`]

**When to use:** Immediately after a SQLite meal mutation commits and after committed facts are available. [VERIFIED: `server/services/meal-transactions.ts:181`, `server/services/meal-transactions.ts:332`, `server/services/meal-transactions.ts:275`]

**Example:**
```ts
// Source: repo pattern from log_food recovery in server/orchestrator/tools.ts:1047-1059
export async function buildSummaryOutcomeAfterMealCommit(input: {
  deviceId: string;
  affectedDate: string;
  summaryService: Pick<ReturnType<typeof createSummaryService>, "getDailySummary">;
  foodLoggingService: Pick<ReturnType<typeof createFoodLoggingService>, "getMealsByDate">;
}): Promise<SummaryOutcome> {
  try {
    return {
      status: "fresh",
      dailySummary: await input.summaryService.getDailySummary(
        input.deviceId,
        new Date(`${input.affectedDate}T12:00:00`),
      ),
    };
  } catch {
    try {
      return {
        status: "recovered",
        reason: "recompute_failed",
        dailySummary: await recoverDailySummaryFromPersistedMeals(input),
      };
    } catch {
      return { status: "unavailable", reason: "recompute_failed" };
    }
  }
}
```

### Pattern 3: Response Projection From Outcome

**What:** Return committed mutation facts and `summaryOutcome`; add top-level `dailySummary` only by projecting from non-unavailable outcomes. [VERIFIED: `61-CONTEXT.md`]

**When to use:** Direct `PATCH`/`DELETE` response bodies and chat JSON/SSE terminal payloads. [VERIFIED: `server/routes/meals.ts:180`, `server/routes/chat.ts:944`, `server/routes/chat.ts:1419`]

**Example:**
```ts
// Source: Phase 61 CONTEXT.md D-05/D-07/D-19
function projectMutationResponse<T extends object>(
  facts: T,
  summaryOutcome: SummaryOutcome,
) {
  const dailySummary = dailySummaryFromOutcome(summaryOutcome);
  return {
    ...facts,
    summaryOutcome,
    ...(dailySummary ? { dailySummary } : {}),
  };
}
```

### Anti-Patterns to Avoid

- **Throwing after commit because summary recompute failed:** This hides an authoritative committed mutation from the user. Use `summaryOutcome.unavailable` instead. [VERIFIED: `61-CONTEXT.md`, `server/routes/meals.ts:169`]
- **Letting `publishDailySummary` determine response success:** Publisher status is not summary availability and must remain metadata-only observability. [VERIFIED: `61-CONTEXT.md`, `server/routes/chat.ts:386`]
- **Adding visible caveats to receipt copy:** Phase 61 explicitly keeps receipt text committed-facts only. [VERIFIED: `61-CONTEXT.md`, `server/orchestrator/mutation-receipts.ts:103`]
- **Updating goal mutations to the same public contract:** Goal migration is out of scope unless it is purely internal and does not change Phase 61 surface. [VERIFIED: `61-CONTEXT.md`]
- **Making client refresh require `dailySummary`:** Client consumers must accept committed mutation responses with unavailable summary and should refresh/redact committed meal state independently where possible. [VERIFIED: `61-CONTEXT.md`, `client/src/components/MealEditScreen.tsx:121`]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| HTTP route testing | Manual server sockets for ordinary PATCH/DELETE assertions | Fastify `app.inject()` | Fastify documents `inject` for fake route requests without starting a server; existing integration tests already use it. [CITED: `https://github.com/fastify/fastify/blob/main/docs/Guides/Testing.md`, VERIFIED: `tests/integration/meals-api.test.ts:280`] |
| Test framework | New Jest/Vitest config | Node built-in `node:test` with `node:assert/strict` | Repo policy and scripts already standardize on Node test. [VERIFIED: `AGENTS.md`, `package.json`, CITED: `https://github.com/nodejs/node/blob/main/doc/api/test.md`] |
| Summary recovery logic | Per-flow duplicated arithmetic | Shared helper using persisted meal reads | `log_food` already demonstrates persisted-meal recovery; Phase 61 requires the same policy across all meal mutation families. [VERIFIED: `server/orchestrator/tools.ts:1054`, `61-CONTEXT.md`] |
| Public response compatibility | Ad hoc optional `dailySummary` checks everywhere | `dailySummaryFromOutcome(summaryOutcome)` projection | Locked decision says top-level `dailySummary` is temporary and derived only from outcome. [VERIFIED: `61-CONTEXT.md`] |
| Realtime delivery status | New `publish_failed` outcome status | Existing non-fatal publish logging | Publish failure does not change summary availability for the current response. [VERIFIED: `61-CONTEXT.md`, `server/routes/chat.ts:403`] |

**Key insight:** The hard boundary is the SQLite commit; summary recompute, recovery, and realtime publish are post-commit freshness/delivery concerns. [VERIFIED: `.planning/STATE.md`, `61-CONTEXT.md`]

## Common Pitfalls

### Pitfall 1: Keeping `committedSummary` Required In Mutation Effects

**What goes wrong:** The orchestrator still calls `requireDailySummaryForLoggedMeal(...)` for every committed mutation, so unavailable summary turns into an exception after commit. [VERIFIED: `server/orchestrator/index.ts:129`, `server/orchestrator/index.ts:968`, `server/orchestrator/index.ts:989`]

**Why it happens:** Current `MutationEffectsBase` requires `committedSummary: DailySummary`. [VERIFIED: `server/orchestrator/mutation-effects.ts:20`]

**How to avoid:** Change meal mutation effects to carry `summaryOutcome` or optional summary projection, while keeping goal effects out of the public Phase 61 contract. [VERIFIED: `61-CONTEXT.md`]

**Warning signs:** Tests still assert every committed mutation has top-level `dailySummary` instead of `summaryOutcome`. [VERIFIED: `tests/integration/chat-streaming.test.ts:3052`, `tests/integration/meals-api.test.ts:249`]

### Pitfall 2: Recovering Summary Only In `log_food`

**What goes wrong:** `log_food` survives recompute failure, but `update_meal`, `delete_meal`, direct `PATCH`, and direct `DELETE` still fail after commit. [VERIFIED: `server/orchestrator/tools.ts:1053`, `server/services/meal-correction.ts:680`, `server/routes/meals.ts:169`]

**Why it happens:** Recovery is currently embedded in the `log_food` tool path instead of a shared post-commit helper. [VERIFIED: `server/orchestrator/tools.ts:1047`]

**How to avoid:** Move recovery into a shared backend helper and call it from all meal mutation families. [VERIFIED: `61-CONTEXT.md`]

**Warning signs:** Tests only cover log recompute failure and do not simulate update/delete/direct recompute failures. [VERIFIED: `tests/unit/tools.test.ts:961`, `tests/integration/chat-streaming.test.ts:3025`]

### Pitfall 3: Treating Publish Failure As Summary Unavailable

**What goes wrong:** A response with a valid summary could be mislabeled degraded because SSE fan-out failed. [VERIFIED: `61-CONTEXT.md`]

**Why it happens:** Direct routes currently publish immediately after recompute and do not catch publisher errors. [VERIFIED: `server/routes/meals.ts:173`, `server/routes/meals.ts:224`]

**How to avoid:** Publish only after projecting a usable summary, wrap publish failures, and log metadata-only names such as `summary_publish_failed`. [VERIFIED: `server/routes/chat.ts:403`, `61-CONTEXT.md`]

**Warning signs:** `summaryOutcome.reason` includes `publish_failed`, or direct route tests expect non-200 on publisher throw. [VERIFIED: `61-CONTEXT.md`]

### Pitfall 4: Breaking Client Direct Mutation UX When `dailySummary` Is Missing

**What goes wrong:** `MealEditScreen` currently calls `refreshAfterMealMutation(..., response.dailySummary)` and can treat a committed mutation without `dailySummary` as a failed save/delete. [VERIFIED: `client/src/components/MealEditScreen.tsx:121`, `client/src/components/MealEditScreen.tsx:151`, `client/src/components/MealEditScreen.tsx:178`]

**Why it happens:** Client types currently require `dailySummary` for direct update/delete responses. [VERIFIED: `client/src/types.ts:100`, `client/src/api.ts:791`]

**How to avoid:** Add a client `SummaryOutcome` type, make direct mutation summary optional through outcome projection, and keep committed mutation side effects separate from summary refresh. [VERIFIED: `61-CONTEXT.md`]

**Warning signs:** Client code branches on missing `dailySummary` by throwing an error after HTTP `200`. [VERIFIED: `client/src/api.ts:791`, `client/src/components/MealEditScreen.tsx:121`]

## Code Examples

### Fastify Integration Test Shape

```ts
// Source: Fastify docs + existing tests/integration/meals-api.test.ts
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
  },
});

assert.equal(updateRes.statusCode, 200);
const body = updateRes.json() as {
  summaryOutcome: SummaryOutcome;
  dailySummary?: DailySummary;
};
assert.equal(body.summaryOutcome.status, "unavailable");
assert.equal(body.dailySummary, undefined);
```

### Existing Log Recovery Precedent

```ts
// Source: server/orchestrator/tools.ts:1047-1059
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

### Publish Failure Isolation

```ts
// Source: server/routes/chat.ts:386-411
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

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Require `DailySummary` on all committed mutation effects | Explicit `SummaryOutcome` discriminates fresh/recovered/unavailable | Phase 61 locked decision, 2026-05-17 | Planner should remove summary-required invariants from meal log/update/delete response flow. [VERIFIED: `61-CONTEXT.md`] |
| Silent log recovery from persisted meals | Externally visible `recovered` status | Phase 61 locked decision, 2026-05-17 | Tests must assert recovered status rather than only top-level `dailySummary`. [VERIFIED: `61-CONTEXT.md`, `tests/unit/tools.test.ts:998`] |
| Summary publish mixed into mutation response timing | Publish failure is metadata-only observability | Phase 61 locked decision, 2026-05-17 | Direct routes need the same non-fatal publish behavior as chat routes. [VERIFIED: `61-CONTEXT.md`, `server/routes/chat.ts:403`] |

**Deprecated/outdated:**
- `requireDailySummaryForLoggedMeal(...)` as a post-commit gate for meal mutations is outdated for Phase 61 because `unavailable` is a valid committed outcome. [VERIFIED: `server/orchestrator/index.ts:129`, `61-CONTEXT.md`]
- Tests that equate committed mutation success with top-level `dailySummary` presence are outdated; they should assert `summaryOutcome` first and compatibility `dailySummary` second. [VERIFIED: `61-CONTEXT.md`, `tests/integration/meals-api.test.ts:249`]

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Recovery from persisted meals can be implemented by reusing or moving the existing `recoverDailySummaryFromPersistedMeals` logic without schema changes. [ASSUMED] | Architecture Patterns | Planner may need a small service helper with additional projection logic if the current helper is private or too coupled to tool types. |
| A2 | Prefer `server/services/summary-outcome.ts` because both routes and orchestrator tools need the same policy. [ASSUMED] | Open Questions | Planner may choose a different placement if imports or domain boundaries make a service helper awkward. |
| A3 | Direct `DELETE` should at minimum return `affectedDate` plus `summaryOutcome`, and should add `deletedMealId` or `deletedMeal` only if needed to make committed facts explicit without disrupting clients. [ASSUMED] | Open Questions | Planner may need to clarify response DTO shape if MUT-04 is interpreted as requiring richer delete facts. |
| A4 | Research validity through 2026-06-16 is sufficient for codebase-local architecture unless dependency upgrades enter scope. [ASSUMED] | Metadata | Planner may need to re-run docs/version checks if stack upgrades become part of the phase. |

## Open Questions

1. **Where should the shared helper live?**
   - What we know: Planner has discretion over helper/module placement, and services own reusable domain/persistence logic. [VERIFIED: `61-CONTEXT.md`, `AGENTS.md`]
   - What's unclear: Whether the cleanest implementation is `server/services/summary-outcome.ts` or a sibling under `server/orchestrator/` plus direct-route adapter. [VERIFIED: `61-CONTEXT.md`]
   - Recommendation: Prefer `server/services/summary-outcome.ts` because both routes and orchestrator tools need the same policy. [ASSUMED]

2. **Should direct `DELETE` include deleted meal facts?**
   - What we know: Chat delete already has `deletedMeal` facts for receipts; direct delete currently returns only `affectedDate` and `dailySummary`. [VERIFIED: `server/services/meal-correction.ts:719`, `server/routes/meals.ts:229`]
   - What's unclear: MUT-04 requires distinction between committed facts and summary status, but does not explicitly require a direct deleted-meal DTO. [VERIFIED: `.planning/REQUIREMENTS.md`]
   - Recommendation: At minimum return `affectedDate` plus `summaryOutcome`; add `deletedMealId` or `deletedMeal` only if it is needed to make committed facts explicit without disrupting clients. [ASSUMED]

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Node.js | Runtime and `node:test` | ✓ | `v24.14.0` | None needed. [VERIFIED: `node --version`] |
| Yarn classic | Project commands | ✓ | `1.22.22` | None; AGENTS requires yarn. [VERIFIED: `yarn --version`, `AGENTS.md`] |
| npm CLI | Registry version verification only | ✓ | path found | Use `yarn list` for installed packages. [VERIFIED: `command -v npm`, `yarn list`] |
| sqlite3 CLI | Optional local DB inspection | ✓ | path found | Use app/test SQLite APIs. [VERIFIED: `command -v sqlite3`] |
| OpenAI API | Live runtime only | Not required for Phase 61 local tests | — | Use `MockLLMProvider` and app fixtures. [VERIFIED: `tests/integration/chat-api.test.ts:13`, `tests/integration/meals-api.test.ts:34`] |

**Missing dependencies with no fallback:** None found for research/planning. [VERIFIED: environment probes]

**Missing dependencies with fallback:** OpenAI live access is not required for planned local integration tests because existing tests inject `MockLLMProvider`. [VERIFIED: `tests/integration/meals-api.test.ts:34`]

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Node built-in `node:test` on Node `v24.14.0`, executed through `tsx 4.21.0`. [VERIFIED: `node --version`, `yarn list`, `package.json`] |
| Config file | None dedicated; scripts live in `package.json`, and tests set `process.env.TZ = "Asia/Taipei"`. [VERIFIED: `package.json`, `tests/integration/meals-api.test.ts:1`] |
| Quick run command | `yarn test:unit` for helper/type projection tests or targeted `node scripts/run-node-with-tz.mjs --import tsx --test <file>` for a single file. [VERIFIED: `package.json`, `AGENTS.md`] |
| Full suite command | `yarn test` for unit + integration; `yarn release:check` before promotion/closure gates. [VERIFIED: `package.json`, `AGENTS.md`] |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| MUT-01 | Chat `log_food` returns committed receipt with `summaryOutcome.recovered` or `summaryOutcome.unavailable` when post-commit summary recompute/recovery degrades. | unit + integration SSE/JSON | `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/tools.test.ts tests/integration/chat-streaming.test.ts tests/integration/chat-api.test.ts` | ✅ extend existing files [VERIFIED: `tests/unit/tools.test.ts`, `tests/integration/chat-streaming.test.ts`, `tests/integration/chat-api.test.ts`] |
| MUT-02 | Chat `update_meal` returns committed update receipt when recompute/publish fails. | unit + integration | `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/meal-correction.test.ts tests/unit/orchestrator.test.ts tests/integration/chat-streaming.test.ts` | ✅ extend existing files [VERIFIED: `tests/unit/meal-correction.test.ts`, `tests/unit/orchestrator.test.ts`, `tests/integration/chat-streaming.test.ts`] |
| MUT-03 | Chat `delete_meal` returns committed delete receipt when recompute/publish fails. | unit + integration | `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/meal-correction.test.ts tests/unit/orchestrator.test.ts tests/integration/chat-streaming.test.ts` | ✅ extend existing files [VERIFIED: `tests/unit/meal-correction.test.ts`, `tests/unit/orchestrator.test.ts`, `tests/integration/chat-streaming.test.ts`] |
| MUT-04 | Direct `PATCH`/`DELETE` return HTTP `200` with committed facts and `summaryOutcome`, and top-level `dailySummary` only when fresh/recovered. | integration + client unit | `node scripts/run-node-with-tz.mjs --import tsx --test tests/integration/meals-api.test.ts tests/unit/api-client.test.ts tests/unit/meal-edit-screen.test.ts` | ✅ extend existing files [VERIFIED: `tests/integration/meals-api.test.ts`, `tests/unit/api-client.test.ts`, `tests/unit/meal-edit-screen.test.ts`] |

### Sampling Rate

- **Per task commit:** `yarn tsc --noEmit` plus the targeted file command for edited route/service/orchestrator/client tests. [VERIFIED: `AGENTS.md`]
- **Per wave merge:** `yarn test:unit` and `yarn test:integration` if both backend and client parsing are touched. [VERIFIED: `package.json`, `AGENTS.md`]
- **Phase gate:** `yarn tsc --noEmit && yarn test && yarn release:check` before `$gsd-verify-work` or milestone release-proof closure. [VERIFIED: `AGENTS.md`, `.planning/REQUIREMENTS.md`]

### Wave 0 Gaps

- [ ] Add or extend a helper-focused unit test for `SummaryOutcome` projection and recovery status shape, likely in `tests/unit/tools.test.ts` or a new `tests/unit/summary-outcome.test.ts`. [VERIFIED: current tests do not contain `summaryOutcome` via `rg`]
- [ ] Extend `tests/integration/meals-api.test.ts` to inject summary recompute failure and publisher failure for direct `PATCH`/`DELETE`. [VERIFIED: `tests/integration/meals-api.test.ts:269`, `tests/integration/meals-api.test.ts:243`]
- [ ] Extend chat JSON/SSE tests to assert `summaryOutcome` parity for log/update/delete terminal payloads. [VERIFIED: `tests/integration/chat-streaming.test.ts:3025`]
- [ ] Extend client API/store/component tests so missing top-level `dailySummary` with committed `summaryOutcome.unavailable` does not throw or show mutation failure. [VERIFIED: `tests/unit/api-client.test.ts:632`, `client/src/components/MealEditScreen.tsx:121`]

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V2 Authentication | yes | Continue signed guest-session cookie resolution in protected routes; do not accept raw device IDs. [VERIFIED: `AGENTS.md`, `server/routes/meals.ts:69`] |
| V3 Session Management | yes | Preserve active/resume cookie handling and same-origin credentials; Phase 61 should not alter session TTL/cookie semantics. [VERIFIED: `server/lib/guest-session-resolver.ts`, `client/src/api.ts:509`] |
| V4 Access Control | yes | Keep route/service calls scoped by resolved `deviceId`; foreign meal update/delete should remain 404/unauthorized. [VERIFIED: `server/routes/meals.ts:69`, `tests/integration/meals-api.test.ts:240`] |
| V5 Input Validation | yes | Keep route body validation and zod-backed tool contracts; add response contract types without weakening request guards. [VERIFIED: `server/routes/meals.ts:28`, `server/orchestrator/tools.ts:1`] |
| V6 Cryptography | no direct change | Existing HMAC-signed guest sessions remain unchanged. [VERIFIED: `.planning/codebase/INTEGRATIONS.md`] |
| V7 Error Handling and Logging | yes | Log summary recovery/unavailable and publish failure as metadata-only; do not log raw user text, tool payloads, provider bodies, image data, sessions, or DB snapshots. [VERIFIED: `AGENTS.md`, `.planning/REQUIREMENTS.md`, `server/routes/chat.ts:403`] |

### Known Threat Patterns for Fastify/SQLite Mutation Responses

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Cross-device meal mutation | Elevation of privilege | Resolve signed guest session and use `deviceId` in service calls; keep foreign records returning not found. [VERIFIED: `server/routes/meals.ts:69`, `tests/integration/meals-api.test.ts:240`] |
| Sensitive data leakage in degraded-summary logs | Information disclosure | Keep logs metadata-only and avoid raw prompt/user/tool/provider/image/session/DB content. [VERIFIED: `AGENTS.md`, `.planning/REQUIREMENTS.md`] |
| False failure after committed mutation | Repudiation / Integrity | Return committed facts plus `summaryOutcome` after SQLite commit; do not turn post-commit summary/publish failures into mutation failures. [VERIFIED: `61-CONTEXT.md`] |
| Stale write protection | Tampering | Out of scope for Phase 61; Phase 62 owns expected revision checks. [VERIFIED: `61-CONTEXT.md`, `.planning/ROADMAP.md`] |

## Sources

### Primary (HIGH confidence)

- `61-CONTEXT.md` - locked Phase 61 decisions, summary outcome contract, parity, recovery, HTTP boundaries. [VERIFIED: local file]
- `.planning/REQUIREMENTS.md` - MUT-01 through MUT-04 and proof/privacy constraints. [VERIFIED: local file]
- `.planning/ROADMAP.md` - Phase 61 goal, success criteria, dependencies, and implementation notes. [VERIFIED: local file]
- `.planning/STATE.md` - current v2.3 decisions and workflow position. [VERIFIED: local file]
- `AGENTS.md` - project-specific architecture, testing, verification, and promotion rules. [VERIFIED: local file]
- `server/orchestrator/tools.ts`, `server/orchestrator/index.ts`, `server/orchestrator/mutation-effects.ts`, `server/orchestrator/mutation-receipts.ts` - current chat/tool mutation flow. [VERIFIED: codebase grep/read]
- `server/services/meal-transactions.ts`, `server/services/meal-correction.ts`, `server/services/summary.ts` - SQLite commit and summary recompute boundaries. [VERIFIED: codebase grep/read]
- `server/routes/chat.ts`, `server/routes/meals.ts`, `server/realtime/publisher.ts` - response projection and publish behavior. [VERIFIED: codebase grep/read]
- `client/src/api.ts`, `client/src/types.ts`, `client/src/components/MealEditScreen.tsx` - client DTO and direct mutation consumption. [VERIFIED: codebase grep/read]
- Fastify Testing Guide - `fastify.inject()` testing behavior. [CITED: `https://github.com/fastify/fastify/blob/main/docs/Guides/Testing.md`]
- Node.js test runner docs - `node:test` API. [CITED: `https://github.com/nodejs/node/blob/main/doc/api/test.md`]
- npm registry - current package versions and modified dates. [VERIFIED: npm registry]

### Secondary (MEDIUM confidence)

- Context7 Fastify and Node documentation extracts from `/fastify/fastify` and `/nodejs/node`; used as docs lookup mirrors for official testing guidance. [VERIFIED: Context7 CLI]

### Tertiary (LOW confidence)

- None. [VERIFIED: source review]

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - installed versions were verified locally and npm registry versions were checked. [VERIFIED: `yarn list`, `npm view`]
- Architecture: HIGH - mutation paths, response projection, and tests were traced in local source. [VERIFIED: codebase grep/read]
- Pitfalls: HIGH - pitfalls map directly to current required-summary coupling and locked Phase 61 decisions. [VERIFIED: `61-CONTEXT.md`, `server/orchestrator/index.ts`, `server/routes/meals.ts`]

**Research date:** 2026-05-17  
**Valid until:** 2026-06-16 for codebase-local architecture; re-check npm/doc versions if dependency upgrades enter scope. [ASSUMED]
