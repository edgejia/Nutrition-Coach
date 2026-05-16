# Architecture Research: v2.3 Authoritative Mutation Outcomes and Fresh Meal State

**Project:** Nutrition Coach  
**Researched:** 2026-05-17  
**Scope:** Integration architecture only for pending goal proposals, deterministic mutation/failure copy, summary recompute separation, stale meal receipt protection, and SSE meal-row freshness.

## Current Boundaries

The existing boundaries are already the right shape for v2.3. Keep them.

| Boundary | Current Owner | v2.3 Interpretation |
|----------|---------------|---------------------|
| HTTP and SSE contracts | `server/routes/chat.ts`, `server/routes/device.ts`, `server/routes/meals.ts`, `server/routes/sse.ts` | Routes should authorize via guest-session cookies, shape response DTOs, publish realtime events, and never infer mutation success from assistant prose. |
| Durable meal writes | `server/services/meal-transactions.ts`, wrapped by `food-logging.ts` and `meal-correction.ts` | The transaction/revision model is the authoritative mutation source. Add expected-revision checks here, not in React. |
| Daily summary computation | `server/services/summary.ts` | Summary recompute is a post-commit read concern. It must not decide whether a meal mutation committed. |
| Goal target persistence | `server/services/device.ts` | Device targets remain the only durable target fields. Pending proposals should use `turn_states`, not new target columns. |
| Cross-turn pending state | `server/services/turn-state.ts` | Existing TTL state is the correct storage primitive for pending goal proposals. Add a typed wrapper rather than another generic caller in the orchestrator. |
| Tool validation and execution | `server/orchestrator/tools.ts`, `tool-contract.ts` | Tools must return structured success/failure outcomes. `update_goals` failures should be rendered by backend copy, not followed by LLM-authored success-like prose. |
| Deterministic user-facing receipts | `server/orchestrator/mutation-receipts.ts` | Extend this renderer family for goal proposal/failure copy and summary-recompute warning copy. |
| Realtime fan-out | `server/realtime/publisher.ts` | Publisher should remain a process-local event fan-out. It can carry richer payloads, but should not query DB. |
| Client state boundary | `client/src/store.ts` | Zustand remains the only client write boundary. Add actions for meal-row invalidation/freshness rather than letting components patch arrays ad hoc. |
| Client transport | `client/src/api.ts`, `client/src/sse.ts` | Transport should normalize new DTO fields: `mealRevisionId`, `expectedMealRevisionId`, summary outcome metadata, and `daily_summary` meal invalidation flags. |

## Proposed Data Flows

### 1. Structured pending goal proposals and confirmation

Use a new thin service: `server/services/goal-proposals.ts`.

Recommended storage:
- Backing table: existing `turn_states`.
- State kind: `pending_goal_proposal`.
- Payload: `{ proposalId, targets, proposedFields, createdAt, sourceTurnId? }`.
- TTL: 15 minutes, matching the existing meal-selection pending-state pattern.

Recommended tool flow:

```text
User: "我想少吃一點"
  -> model calls propose_goals({ calories, protein, carbs, fat? })
  -> goalProposalService.createProposal(deviceId, targets)
  -> orchestrator returns deterministic backend proposal copy
  -> no device target mutation

User: "好"
  -> model calls update_goals({ proposal_id })
  -> goalProposalService.consumeProposal(deviceId, proposal_id)
  -> deviceService.updateGoals(deviceId, proposal.targets)
  -> publisher.publishGoalsUpdate()
  -> orchestrator returns deterministic backend success receipt
```

Important contract change: `update_goals` should support exactly two accepted modes:

| Mode | Allowed When | Guard |
|------|--------------|-------|
| Explicit numeric update | Current user message contains numeric target fields | Source-text guard must check the current user message, not previous assistant prose. |
| Proposal confirmation | Tool args contain `proposal_id` matching active persisted pending proposal | `goalProposalService.consumeProposal()` validates id, device, TTL, and clears after success. |

Do not continue the current behavior where `好` can update targets merely because the previous assistant message contained numbers. That makes prior prose the authority. v2.3 needs persisted backend proposal state to be the authority.

### 2. Failed `update_goals` deterministic backend copy

Today `executeTool()` returns controlled failures for `update_goals`, then the orchestrator can continue to a final model reply. That is the risky seam: the LLM can phrase a guard/validation failure like success.

Recommended flow:

```text
update_goals validation/guard/proposal failure
  -> executeTool returns { success:false, executed:false, failureReason, result }
  -> orchestrator detects tool === "update_goals"
  -> renderGoalUpdateFailure(outcome)
  -> return immediately with finalReplySource: "renderer"
  -> didMutateMeal false, dailyTargets omitted
  -> targets remain unchanged
```

Add deterministic copy near the existing receipt renderer, either in `server/orchestrator/mutation-receipts.ts` or a sibling `server/orchestrator/goal-receipts.ts`. Keep this renderer backend-only and structured by reason:

| Failure | User Copy Intent |
|---------|------------------|
| `schema_validation` | Ask for supported numeric target values. |
| `source_text_guard` | Ask for explicit numbers or ask user to confirm the latest pending proposal. |
| `proposal_not_found` / expired | Say the previous proposal expired and ask user to request the change again. |
| `proposal_mismatch` | Say this confirmation cannot be matched to the pending proposal. |
| execute failure before mutation | Say targets were not changed. |

The final reply must not include model-authored success wording after a failed `update_goals` outcome.

### 3. Mutation outcome vs summary recompute failure

Introduce a shared post-commit summary helper so log, update, and delete paths stop duplicating summary handling:

Recommended new module: `server/services/summary-outcome.ts`.

Suggested shape:

```typescript
type SummaryOutcome =
  | { status: "fresh"; summary: DailySummary }
  | { status: "recovered"; summary: DailySummary; reason: "summary_recompute_failed" }
  | { status: "failed"; reason: "summary_recompute_failed" };
```

The helper should first call `summaryService.getDailySummary()`. If that throws, recover from persisted meals through `foodLoggingService.getMealsByDate()` for the affected day. If recovery also fails, return `failed` without throwing.

Then every mutation result should be shaped as:

```text
Committed mutation outcome:
  - kind: log | update | delete | goals
  - committed: true
  - affectedDate
  - meal facts or deleted meal facts or targets
  - summaryOutcome
```

Apply this in:
- `log_food` in `server/orchestrator/tools.ts`, replacing local `recoverDailySummaryFromPersistedMeals()`.
- `mealCorrectionService.updateMeal()` and `deleteMeal()`.
- `server/routes/meals.ts` PATCH/DELETE.
- `server/routes/chat.ts` `publishSummarySafe()` and done payload shaping.

Important ordering boundary:

```text
1. Validate authorization and input.
2. Commit meal transaction/revision or target update.
3. Build committed mutation facts from the write result.
4. Attempt summary recompute/recovery.
5. Render deterministic mutation receipt from committed facts.
6. Publish realtime only if summaryOutcome has a summary for today.
7. Return success with mutation outcome even if summaryOutcome.status === "failed".
```

This preserves user trust: success means the mutation committed; summary freshness is reported separately.

### 4. Stale chat receipt protection before meal PATCH

Use the existing meal revision model as the concurrency token.

Current protection exists only when loading chat history: `chatService.getMealReceiptForAssistantMessage()` withholds `mealId` if the receipt revision is no longer current. That does not protect already-open tabs or already-rendered receipt actions.

Recommended flow:

```text
Server emits meal DTO / loggedMeal receipt with mealRevisionId
  -> client opens meal edit with mealRevisionId
  -> PATCH /api/meals/:id includes expectedMealRevisionId
  -> mealTransactionsService.updateTransaction(..., expectedRevisionId)
  -> DB checks current_revision_id still equals expected
  -> mismatch returns 409 STALE_MEAL_REVISION before writing
  -> client refreshes meals/history and redacts stale chat receipt identity
```

Modified DTOs:
- `LoggedMealReceipt` adds `mealRevisionId`.
- `MealEntry` adds `mealRevisionId`.
- `MealEditPayload` adds `mealRevisionId`.
- `UpdateMealInput` adds `expectedMealRevisionId`.

Backend guard placement:
- Parse `expectedMealRevisionId` in `server/routes/meals.ts`.
- Pass it into `foodLoggingService.updateMeal()`.
- Pass it into `mealTransactionsService.updateTransaction()`.
- Enforce it at the transaction service boundary before inserting a new revision. Prefer a service-owned error like `STALE_MEAL_REVISION` over route-owned revision queries.

Do not rely only on client-side redaction. The server must reject stale PATCH requests.

### 5. SSE daily summary freshness for meal rows and totals

Current `daily_summary` SSE events update totals through `setDailySummary()` but do not refresh meal rows in other tabs. That can leave Home/Summary totals newer than visible meal rows.

Recommended event extension:

```typescript
type DailySummaryEvent = DailySummary & {
  affectedDate?: string;
  mealRowsInvalidated?: true;
};
```

Keep summary fields top-level for compatibility with existing handlers, and add invalidation metadata. Do not make `RealtimePublisher` load meals.

Recommended client flow:

```text
daily_summary event with mealRowsInvalidated === true and date === today
  -> MainLayout handler fetches GET /api/meals?refreshReason=meal_mutation
  -> Zustand commits meals and summary together
  -> if fetch fails, mark meal rows stale instead of silently showing them as fresh
```

Add a store-level action rather than doing this only inside components:

```typescript
applyDailySummaryEvent(event, refreshMeals)
```

Pragmatic implementation can be:
- In `client/src/sse.ts`, parse `DailySummaryEvent`.
- In `MainLayout`, pass an `onSummaryEvent` handler instead of raw `setDailySummary`.
- If `mealRowsInvalidated`, fetch meals first, then call a new store action that commits `{ meals, dailySummary }` together.
- If no invalidation flag, preserve current `setDailySummary()` behavior.

For route publishing:
- Chat meal mutations: `server/routes/chat.ts` should publish daily summary with `mealRowsInvalidated: true` after `done` remains ordered.
- Direct meal PATCH/DELETE: `server/routes/meals.ts` should publish the same invalidation flag when affected day is today.
- Initial `/api/sse` summary frame should not invalidate rows.
- Goal updates should continue to emit only `goals_update`; no `daily_summary` should be emitted for target-only mutations.

## Module Impact

| Module | Change Type | Recommended Change |
|--------|-------------|--------------------|
| `server/app.ts` | Modify | Wire `goalProposalService` if added, pass it into `createOrchestrator()`. No new app-level singleton beyond service factories. |
| `server/services/goal-proposals.ts` | New | Typed wrapper over `createTurnStateService(db)` for create/get/consume/clear pending target proposals. No migration required. |
| `server/services/summary-outcome.ts` | New | Shared helper for summary recompute plus persisted-meal recovery. Used by chat tools, meal correction service, and meal routes. |
| `server/services/meal-transactions.ts` | Modify | Add optional `expectedRevisionId` to update input and throw `STALE_MEAL_REVISION` before writing when current revision differs. |
| `server/services/food-logging.ts` | Modify | Return/project `mealRevisionId` from today meal rows and update responses; pass expected revision into transaction update. |
| `server/services/meal-correction.ts` | Modify | Use `summary-outcome` for update/delete; return committed mutation facts even if summary recompute fails. |
| `server/services/chat.ts` | Modify | Include `mealRevisionId` in logged meal receipts returned to history when current. Existing stale hiding remains valuable. |
| `server/orchestrator/tools.ts` | Modify | Add `propose_goals`; change `update_goals` args to union of explicit numeric targets or `{ proposal_id }`; use proposal service and deterministic failure outcomes. |
| `server/orchestrator/tool-contract.ts` | Modify | Support current-message-only source guarding for explicit target numeric updates, or handle that as `update_goals` custom validation. |
| `server/orchestrator/mutation-effects.ts` | Modify | Add summary outcome metadata or split committed mutation facts from summary outcome. |
| `server/orchestrator/mutation-receipts.ts` | Modify | Add deterministic proposal copy and failed-goal-update copy. Keep forbidden internal terms checks. |
| `server/orchestrator/index.ts` | Modify | Return renderer-owned copy immediately for goal proposal, goal success, and goal failure outcomes; do not ask model for final success/failure prose after authoritative outcomes. |
| `server/routes/chat.ts` | Modify | Include `mealRevisionId` in done `loggedMeal`; publish daily summary invalidation only after terminal chat event; include summary outcome metadata when recompute fails. |
| `server/routes/meals.ts` | Modify | Parse `expectedMealRevisionId`; return 409 stale revision; return committed mutation outcome even when summary recompute fails; publish invalidating summary events. |
| `server/realtime/publisher.ts` | Modify | Allow `publishDailySummary()` to carry `DailySummaryEvent` metadata. Do not add DB dependencies. |
| `server/routes/sse.ts` | Modify | Initial daily summary stays non-invalidating; type can use the richer event payload. |
| `client/src/types.ts` | Modify | Add `mealRevisionId`, `expectedMealRevisionId`, `DailySummaryEvent`, optional `summaryOutcome` metadata. |
| `client/src/api.ts` | Modify | Normalize `mealRevisionId`; send `expectedMealRevisionId`; surface `STALE_MEAL_REVISION` distinctly; parse richer chat/meal mutation responses. |
| `client/src/sse.ts` | Modify | Parse richer `daily_summary` payload safely and pass invalidation metadata to handlers. |
| `client/src/store.ts` | Modify | Add atomic meals+summary commit and stale-meal-row marker/action. Keep date guard behavior. |
| `client/src/components/MainLayout.tsx` | Modify | On invalidating summary event, fetch meals then commit meals and summary together; recover guest session on 401. |
| `client/src/components/MealEditScreen.tsx` | Modify | Include expected revision on PATCH; handle stale 409 by refreshing meals and showing deterministic retry copy. |
| `client/src/components/ChatPanel.tsx` | Modify | When opening a logged meal from chat, carry `mealRevisionId`; on stale update failures, refresh and redact receipt identity. |

## Build Order

1. **Revision tokens and stale PATCH guard**
   - Add `mealRevisionId` to meal/receipt DTOs.
   - Add `expectedMealRevisionId` to PATCH.
   - Enforce stale checks in `mealTransactionsService.updateTransaction()`.
   - This is the lowest-level integrity dependency for FRESH-01.

2. **Shared summary outcome helper**
   - Move the existing log-food summary recovery idea into `server/services/summary-outcome.ts`.
   - Convert log/update/delete code to return committed mutation facts plus summary outcome.
   - This is the prerequisite for MUT-01 and makes later route/orchestrator changes simpler.

3. **Backend deterministic outcome rendering**
   - Extend mutation/goal receipt renderers.
   - Update `orchestrator/index.ts` to return renderer-owned copy for committed mutations and failed `update_goals` outcomes.
   - This closes the LLM-authored success-copy risk before adding proposal semantics.

4. **Pending goal proposals**
   - Add `goal-proposals.ts`.
   - Add `propose_goals`.
   - Change `update_goals` to explicit numeric or proposal id only.
   - Remove previous-assistant numeric prose as confirmation authority.

5. **Realtime meal freshness**
   - Extend `daily_summary` event payload with `mealRowsInvalidated`.
   - Add client SSE/store atomic refresh path.
   - Wire chat and meal routes to publish invalidating events after terminal mutation outcomes.

6. **Client stale/error UX integration**
   - Handle `STALE_MEAL_REVISION`, summary recompute failure metadata, and stale rows.
   - Keep copy deterministic and small; no new product affordance beyond retry/refresh messaging.

7. **Release-gate cleanup**
   - Run targeted integration tests as each boundary lands, then `yarn tsc --noEmit`, `yarn test:integration`, and `yarn release:check` before promotion.

## Test Hooks

| Requirement | Test Location | Hook / Assertion |
|-------------|---------------|------------------|
| GOAL-01 pending proposal required for `好` | `tests/integration/chat-goal-update.integration.test.ts` | Vague request creates proposal but does not mutate; `好` mutates only through matching proposal id/state; expired/mismatched proposal does not mutate. |
| GOAL-02 deterministic failed goal copy | `tests/integration/chat-goal-update.integration.test.ts`, `chat-streaming.test.ts` | Invalid schema, source guard, and proposal failures return backend copy; response/history do not contain LLM success-style text; targets unchanged. |
| MUT-01 committed outcome survives summary failure | `tests/integration/chat-api.test.ts`, `chat-streaming.test.ts`, `meals-api.test.ts` | Stub `summaryService.getDailySummary` to throw after log/update/delete. Assert mutation committed, receipt identifies committed meal/delete, `summaryOutcome.status` is not confused with mutation failure. |
| FRESH-01 stale receipt blocked before PATCH | `tests/integration/meals-api.test.ts` | Open receipt with revision r1, update same meal to r2, then PATCH with expected r1 returns 409 and does not create r3. |
| FRESH-01 current revision accepted | `tests/integration/meals-api.test.ts` | PATCH with current `expectedMealRevisionId` succeeds and returns next `mealRevisionId`. |
| FRESH-02 cross-tab summary invalidates rows | `tests/integration/sse.test.ts` plus client store/unit coverage if available | Meal mutation publishes `daily_summary` with `mealRowsInvalidated`; initial SSE summary does not; goal update does not. |
| FRESH-02 client atomic refresh | client tests or focused component/store test | `daily_summary` invalidation triggers meal refresh before committing the new summary as fresh; failed refresh marks meal rows stale instead of silently leaving old rows. |
| Ordering boundary | `tests/integration/chat-api.test.ts`, `chat-streaming.test.ts` | Chat `done`/`stopped` terminal event is observed before invalidating `daily_summary` publish, preserving current SSE ordering invariants. |
| Privacy/trace safety | existing observability tests | New proposal ids, failure reasons, and summary outcome status are metadata-only; do not log raw user text, tool raw args, target numeric deltas in route logs beyond existing allowlisted summaries. |

## Roadmap Implication

Split the milestone by boundary, not by UI surface. Build the persistence/outcome primitives first, then orchestrator semantics, then realtime/client freshness. The risky part is not adding fields; it is preventing three authorities from disagreeing: DB mutation state, summary recompute state, and assistant copy. The roadmap should keep those separated from the first phase.
