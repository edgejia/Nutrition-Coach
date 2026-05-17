# Phase 62: Meal Revision Tokens and Stale Receipt Protection - Context

**Gathered:** 2026-05-17
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 62 makes existing-meal edits and deletes revision-aware. Edit-capable meal receipts and meal display DTOs must expose the current meal revision identity, while mutation requests for existing meals must supply an `expectedMealRevisionId`. The server must reject missing or stale expected revisions without mutating the meal, creating a newer revision, recomputing summaries, or publishing realtime updates. The client must show deterministic stale-record guidance and refresh or invalidate affected meal rows after a stale conflict.

This phase covers chat receipt edit affordances, direct meal edit/delete flows, chat/tool update/delete flows after a meal target is resolved, and client DTO/state normalization needed for those paths. Meal creation/logging is out of scope because there is no prior revision to protect. Broader `/api/sse daily_summary` meal-row freshness belongs to Phase 63.

</domain>

<decisions>
## Implementation Decisions

### Revision Token Surface
- **D-01:** Add current `mealRevisionId` to every edit-capable read/display DTO and edit payload source: `LoggedMealReceipt`, `MealEntry`, `MealEditPayload`, `/api/meals` rows, direct update responses, chat JSON/SSE `loggedMeal`, and restored history receipts when they can open Meal Edit.
- **D-02:** Write inputs must carry `expectedMealRevisionId`, not plain `mealRevisionId`. This keeps read/display identity distinct from the write precondition contract.

### Expected Revision Enforcement
- **D-03:** Require `expectedMealRevisionId` for every authoritative mutation of an existing meal: direct `PATCH`, direct `DELETE`, chat/tool `update_meal`, and chat/tool `delete_meal` after the target meal has been resolved.
- **D-04:** Meal creation/logging is out of scope for expected revision enforcement because there is no prior revision to protect.
- **D-05:** Apply the expected-revision contract to stale deletes as well as stale edits. A stale delete must not remove a newer meal state.

### Missing Or Stale Expected Revision Contract
- **D-06:** Missing `expectedMealRevisionId` fails closed with the same deterministic stale/precondition family as stale mismatches: no mutation, no new revision, no summary recompute, and no publish.
- **D-07:** Do not add a legacy compatibility exception for missing expected revisions unless a real rollout need is raised later. If such a need appears, it is a separate rollout decision, not the default Phase 62 behavior.
- **D-08:** Stale expected revisions must be rejected before the meal transaction write boundary creates a new revision.

### Stale Conflict HTTP Shape
- **D-09:** Use `409 Conflict` with a structured deterministic error code such as `MEAL_REVISION_STALE` or `MEAL_REVISION_REQUIRED`.
- **D-10:** Keep stale conflict responses stable enough for the client to branch on the code and show deterministic Traditional Chinese stale-record guidance. Exact copy is left for planning and tests.
- **D-11:** Existing route conventions already use `409` for grouped meal edit conflicts, so Phase 62 should extend that conflict style rather than introduce a separate `412` public convention.

### Client Recovery Behavior
- **D-12:** On stale conflict, the client should show deterministic Traditional Chinese stale-record guidance, close or block saving from the stale editor/receipt, and immediately refresh or invalidate the affected meal row/date.
- **D-13:** If refreshed current facts are available, the user should reopen Meal Edit from the fresh row or receipt rather than continuing from stale form state.
- **D-14:** Client-side refresh/redaction is UX support only. Server-side expected revision checks remain the authority.

### the agent's Discretion
- Planner may choose exact field placement and type names as long as read/display identity stays `mealRevisionId` and write precondition stays `expectedMealRevisionId`.
- Planner may decide whether stale conflict response bodies include refreshed meal facts directly or only enough affected-date metadata for the client to refetch, provided the client refreshes or invalidates affected rows.
- Planner may choose exact deterministic Traditional Chinese stale guidance copy and test fixture wording.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Planning Scope
- `.planning/ROADMAP.md` - Phase 62 goal, success criteria, dependency, UI hint, and implementation notes.
- `.planning/REQUIREMENTS.md` - FRESH-01 through FRESH-03 requirements, explicit server-side stale protection requirement, and v2.3 proof/privacy constraints.
- `.planning/PROJECT.md` - v2.3 milestone context, current state, constraints, and key decisions.
- `.planning/STATE.md` - Current workflow position and accumulated v2.3 decisions, including stale delete as a planning concern.
- `.planning/phases/61-committed-mutation-outcome-and-summary-contract/61-CONTEXT.md` - Prior phase decisions separating committed meal mutation facts from summary freshness and keeping publish failure outside `summaryOutcome`.
- `.planning/phases/60-goal-proposal-authority-and-rejected-goal-copy/60-CONTEXT.md` - Prior phase decisions around backend-owned deterministic copy and fail-closed mutation authority.

### Codebase Maps
- `.planning/codebase/STACK.md` - TypeScript/Fastify/SQLite/Drizzle/Zustand stack and path-triggered verification commands.
- `.planning/codebase/ARCHITECTURE.md` - Route/service/orchestrator boundaries, client store boundary, realtime publisher, and meal transaction schema context.
- `.planning/codebase/INTEGRATIONS.md` - SQLite, EventSource, guest-session, logging, and metadata-only observability constraints.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `server/services/meal-transactions.ts` - Authoritative transaction/revision write boundary. `meal_transactions.currentRevisionId` and `currentRevisionNumber` already provide the current revision identity needed for compare-and-write checks.
- `server/services/food-logging.ts` - Compatibility projection already exposes `mealRevisionId` on meal entries returned from log/update paths.
- `server/services/meal-correction.ts` - Chat/tool update/delete paths resolve target meals, apply patches, and call the transaction service. This is the key chat mutation integration point for `expectedMealRevisionId`.
- `server/routes/meals.ts` - Direct `PATCH` and `DELETE` route boundary owns request parsing, 409 conflict shaping, summary recompute/publish timing, and response projection.
- `server/db/schema.ts` - `meal_transactions`, `meal_revisions`, `meal_revision_items`, and `chat_meal_receipts` already store revision identity and receipt-to-revision associations.
- `client/src/types.ts`, `client/src/api.ts`, `client/src/meal-edit-payload.ts`, and `client/src/store.ts` - Client DTO, normalization, edit payload, and state boundaries that need `mealRevisionId` read identity and `expectedMealRevisionId` write preconditions.
- `client/src/components/MessageBubble.tsx` - Receipt edit affordance currently opens Meal Edit from `message.loggedMeal`; stale receipt behavior should connect through this payload path.

### Established Patterns
- Routes own HTTP boundaries, validation, guest-session ownership, status codes, and response shaping.
- Services own reusable persistence/domain logic. The transaction service is the right place to ensure stale writes fail before a new revision is inserted.
- Orchestrator tools own model tool contracts and should not hand-roll meal mutation side effects outside `server/orchestrator/tools.ts`.
- SQLite mutation commit is authoritative. Summary recompute and realtime publish happen only after a successful mutation and must not run for missing or stale expected revisions.
- Routine logs/traces and planning proof must stay metadata-only: no raw prompts, user text, assistant final text, tool raw payloads, provider bodies, image data, session material, or database snapshots.

### Integration Points
- `server/services/meal-transactions.ts`: add expected revision comparison for update and soft delete before inserting the next revision.
- `server/services/food-logging.ts`: thread optional expected revision parameters from public update/delete callers to transaction methods.
- `server/services/meal-correction.ts`: require and pass expected revision for chat/tool update and delete mutations after target resolution.
- `server/orchestrator/tools.ts`: extend `update_meal` and `delete_meal` tool schemas/results as needed so resolved meal targets carry expected revision identity.
- `server/routes/meals.ts`: parse `expectedMealRevisionId`, fail closed when missing or stale, return `409` structured conflict bodies, and ensure no summary/publish side effects run on conflicts.
- `server/routes/chat.ts`: preserve chat JSON/SSE `loggedMeal` revision identity in terminal payloads and restored assistant receipts.
- `client/src/api.ts`: normalize `mealRevisionId` on meals/receipts and send `expectedMealRevisionId` for update/delete requests.
- `client/src/meal-edit-payload.ts`: include read-side `mealRevisionId` in edit payloads and map it to write-side `expectedMealRevisionId` when saving.
- `client/src/store.ts`: refresh or invalidate affected meal rows after stale conflicts without treating client-only state as the authority.

</code_context>

<specifics>
## Specific Ideas

- Prefer public read/display identity named `mealRevisionId`.
- Prefer public write precondition named `expectedMealRevisionId`.
- Preferred stale/missing conflict family: `409 Conflict` with codes similar to `MEAL_REVISION_STALE` and `MEAL_REVISION_REQUIRED`.
- Deterministic stale guidance should be Traditional Chinese and should direct the user to refresh/use the latest meal row.

</specifics>

<deferred>
## Deferred Ideas

- Legacy compatibility exception for missing `expectedMealRevisionId` - deferred unless a real rollout need is raised later.
- Broader same-day and historical `/api/sse daily_summary` meal-row freshness and affected-date invalidation - Phase 63.

</deferred>

---

*Phase: 62-Meal Revision Tokens and Stale Receipt Protection*
*Context gathered: 2026-05-17*
