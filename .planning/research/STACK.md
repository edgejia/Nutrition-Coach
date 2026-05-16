# Technology Stack: v2.3 Authoritative Mutation Outcomes and Fresh Meal State

**Project:** Nutrition Coach
**Research type:** Stack for v2.3 P1 data-integrity fixes
**Researched:** 2026-05-17
**Overall recommendation:** Keep the existing stack. v2.3 needs contract, schema, route, and client-state changes inside the current Fastify + SQLite + TypeScript + React/Zustand architecture; it does not need new runtime dependencies.

## Existing Stack Fit

The current stack is a good fit for the v2.3 integrity work:

| Area | Current stack | Fit for v2.3 |
|------|---------------|--------------|
| Backend HTTP/SSE | Fastify 5, route-owned boundaries | Keep. `server/routes/chat.ts`, `server/routes/device.ts`, `server/routes/meals.ts`, and `server/routes/sse.ts` already own validation, auth/session resolution, response shaping, and SSE framing. |
| Persistence | SQLite via `better-sqlite3` + Drizzle schema/migrations | Keep. Existing transaction/revision tables, `chat_meal_receipts`, and `turn_states` cover the needed integrity primitives. |
| Validation/contracts | Zod 4 + handwritten tool JSON schemas | Keep. `runContract` already distinguishes validation, guard, and execute failures for `update_goals`; extend that path instead of adding another validator. |
| Mutation receipts | Backend renderer in `server/orchestrator/mutation-receipts.ts` | Keep and extend. It already renders deterministic log/update/delete/goals receipts from committed facts. |
| Realtime | Existing `RealtimePublisher` + browser `EventSource` | Keep. Add freshness semantics to `daily_summary`; do not introduce WebSockets or a message broker. |
| Frontend state | React 19 + Zustand 5 | Keep. `client/src/store.ts` is already the single state boundary for summary, meals, receipts, and mutation notices. |
| Tests | Node built-in `node:test`, real SQLite | Keep. Existing unit/integration/harness layout is enough for deterministic proof. |

Package versions checked from `package.json`: Fastify `^5.2.0`, `better-sqlite3` `^11.8.0`, `drizzle-orm` `^0.39.0`, React `^19.0.0`, Vite `^6.2.0`, Zustand `^5.0.0`, Zod `^4.3.6`, TypeScript `^5.7.0`.

## Needed Stack Changes

No new packages are recommended.

Recommended changes are all internal:

1. **Wire a backend goal-proposal state service using the existing `turn_states` table.**
   - Use `server/services/turn-state.ts` or a thin `goal-proposal` service over it.
   - Store one active `pending_goal_proposal` per device with `proposalId`, concrete targets, proposed fields, creation/expiry, and source metadata.
   - This avoids a new table unless v2.3 decides it needs an audit history of expired/rejected proposals. Current requirement only needs active structured pending state.

2. **Extend the `update_goals` tool contract, not the LLM prompt, as the authority boundary.**
   - Current source guard accepts numeric values from the current user message or previous assistant text. That is too weak for ambiguous `好`.
   - Require either explicit current-turn numeric values or a backend proposal confirmation token/id resolved from persisted pending proposal state.
   - Validation/guard failures should return deterministic backend failure copy without giving the model a chance to produce success-style prose.

3. **Separate committed mutation outcome from summary recompute outcome.**
   - Current mutation effects require `committedSummary`; routes and tools often mutate first, then call `summaryService.getDailySummary`.
   - For log/update/delete flows, return a committed mutation receipt from transaction/revision facts even if summary recompute fails.
   - Represent summary recompute as optional or status-bearing output, e.g. `dailySummary?: DailySummary`, `summaryStatus: "fresh" | "unavailable"`.
   - Keep this as TypeScript contract work; no queue, job runner, cache, or event system is needed.

4. **Add optimistic concurrency to meal PATCH using existing meal revision identity.**
   - Server already has `meal_transactions.current_revision_id`, `meal_revisions`, and `chat_meal_receipts.meal_revision_id`.
   - Expose `mealRevisionId` in edit-capable meal DTOs/receipts and require `expectedMealRevisionId` on `PATCH /api/meals/:id`.
   - Reject stale edits with a deterministic conflict response when the submitted revision is not current.
   - This is a DTO/route/service contract change, not a new persistence technology.

5. **Extend `daily_summary` SSE handling to refresh or invalidate meal rows.**
   - Current `daily_summary` events only update summary state; they do not refresh `meals`.
   - Use the existing `getMeals({ refreshReason: "meal_mutation" })` client API after valid today summary events, or mark meal rows stale until refresh completes.
   - Keep `EventSource`; add shape guards similar to `goals_update` before mutating client state.

## Integration Points

| Requirement | Primary files | Integration notes |
|-------------|---------------|-------------------|
| GOAL-01 structured pending proposals | `server/app.ts`, `server/services/turn-state.ts`, `server/orchestrator/tools.ts`, `server/orchestrator/tool-contract.ts`, `server/orchestrator/index.ts` | Wire a proposal service through app/orchestrator deps. Add proposal-aware guard logic for `update_goals`. Do not rely on parsing previous assistant prose. |
| GOAL-02 deterministic failed goal copy | `server/orchestrator/index.ts`, `server/orchestrator/tools.ts`, `server/orchestrator/mutation-receipts.ts` or new small renderer | Controlled `validation`/`guard` outcomes should short-circuit to backend copy. The model can ask clarification only when no failed mutation/guard outcome needs deterministic copy. |
| MUT-01 committed outcomes despite summary failure | `server/orchestrator/tools.ts`, `server/orchestrator/index.ts`, `server/routes/chat.ts`, `server/routes/meals.ts`, `server/services/food-logging.ts`, `server/services/meal-transactions.ts` | Catch summary recompute failures after successful SQLite mutation and return committed facts. `publishSummarySafe` already treats publish failure as non-fatal; mirror that separation for recompute. |
| FRESH-01 stale chat receipt PATCH protection | `server/db/schema.ts`, `server/services/chat.ts`, `server/routes/meals.ts`, `client/src/types.ts`, `client/src/api.ts`, `client/src/meal-edit-payload.ts`, `client/src/components/MealEditScreen.tsx` | Use current revision identity already present in the database. Add `mealRevisionId` to receipt/edit payloads and `expectedMealRevisionId` to update input. Return `409` on stale revision. |
| FRESH-02 SSE meal freshness | `server/realtime/publisher.ts`, `server/routes/sse.ts`, `client/src/sse.ts`, `client/src/store.ts`, `client/src/api.ts` | Keep event name `daily_summary` unless a payload-shape migration is cleaner. Client should refresh/invalidate meals when applying a today summary event so totals and rows cannot diverge. |

## Verification Implications

Use existing commands and add targeted tests around the changed contracts:

| Change area | Minimum verification |
|-------------|----------------------|
| Any TypeScript edit | `yarn tsc --noEmit` |
| Goal proposal/guard contracts | `yarn test:unit -- tests/unit/update-goals-contract.test.ts` is not an existing script shape; use `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/update-goals-contract.test.ts` for targeted proof, then `yarn test:unit` before closeout. |
| Chat goal update integration | `yarn test:integration` or targeted `node scripts/run-node-with-tz.mjs --import tsx --test tests/integration/chat-goal-update.integration.test.ts` |
| Meal PATCH stale protection | Target `tests/integration/meals-api.test.ts`; include stale `expectedMealRevisionId` conflict and fresh revision success. |
| Committed mutation despite summary failure | Add integration tests for chat log/update/delete and REST PATCH/DELETE with a stubbed failing `summaryService.getDailySummary`; verify committed receipt/outcome still returns and DB changed. |
| SSE freshness | Target `tests/unit/sse-client.test.ts`, `tests/unit/store.test.ts`, and `tests/integration/sse.test.ts`; prove a valid `daily_summary` triggers meal refresh or invalidation. |
| Release closure | `yarn release:check` before any staging/main promotion. This is verification only, not promotion approval. |

## Avoid

- Do not add Redux, React Query, RxJS, WebSockets, Redis, BullMQ, a background job worker, or a second validation library.
- Do not add a new database table for goal proposals unless active-proposal overwrite in `turn_states` is proven insufficient. The likely v2.3 shape is one active pending proposal per device with TTL.
- Do not use LLM-authored prose as the source of truth for goal confirmation or mutation success.
- Do not parse previous assistant text to authorize `好`; authorization must come from explicit current-turn numeric values or persisted backend proposal identity.
- Do not make summary recompute part of the mutation commit boundary. SQLite mutation success and summary freshness are separate outcomes.
- Do not let stale chat receipt DTOs PATCH meal facts without comparing revision identity.
- Do not update summary totals from SSE without also refreshing or invalidating the visible meal rows.
- Do not hand-edit generated harness artifacts; regenerate them with the matching harness command if v2.3 adds harness proof.

## Sources

- `.planning/PROJECT.md` and `.planning/STATE.md` for active v2.3 scope and constraints.
- `package.json` for current package versions and scripts.
- `server/app.ts` for backend composition and DI boundaries.
- `server/db/schema.ts` for existing `turn_states`, meal revision, and chat receipt persistence.
- `server/orchestrator/tool-contract.ts`, `server/orchestrator/tools.ts`, and `server/orchestrator/index.ts` for tool validation/guard/execution and mutation receipt flow.
- `server/routes/chat.ts`, `server/routes/device.ts`, `server/routes/meals.ts`, and `server/realtime/publisher.ts` for HTTP/SSE integration boundaries.
- `client/src/store.ts`, `client/src/api.ts`, `client/src/sse.ts`, `client/src/types.ts`, and `client/src/meal-edit-payload.ts` for client state, DTO, and EventSource integration.
