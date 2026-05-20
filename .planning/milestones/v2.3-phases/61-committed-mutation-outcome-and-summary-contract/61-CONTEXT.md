# Phase 61: Committed Mutation Outcome and Summary Contract - Context

**Gathered:** 2026-05-17
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 61 creates a shared committed mutation outcome and summary availability contract for meal log, meal update, and meal delete flows. Users must receive authoritative committed mutation facts after SQLite persistence succeeds, even when post-commit daily summary recompute or recovery degrades. The phase covers chat JSON responses, chat stream terminal payloads, and direct `PATCH /api/meals/:id` / `DELETE /api/meals/:id` responses. It does not redesign `/api/sse daily_summary` event freshness, stale meal revision protection, or goal mutation summary behavior.

</domain>

<decisions>
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

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Planning Scope
- `.planning/ROADMAP.md` — Phase 61 goal, success criteria, dependency, and implementation notes.
- `.planning/REQUIREMENTS.md` — MUT-01 through MUT-04 requirements and v2.3 proof/privacy constraints.
- `.planning/PROJECT.md` — v2.3 milestone context, current state, constraints, and key decisions.
- `.planning/STATE.md` — Current workflow position and accumulated v2.3 decisions.
- `.planning/phases/60-goal-proposal-authority-and-rejected-goal-copy/60-CONTEXT.md` — Prior phase decisions around backend-rendered mutation copy, controlled final replies, and committed persistence authority.

### Codebase Maps
- `.planning/codebase/STACK.md` — TypeScript/Fastify/SQLite/Drizzle/OpenAI test/runtime stack and verification commands.
- `.planning/codebase/ARCHITECTURE.md` — Route/service/orchestrator boundaries, mutation receipt architecture, realtime publisher, and testing layers.
- `.planning/codebase/INTEGRATIONS.md` — OpenAI, SQLite, EventSource, guest-session, logging, and metadata-only observability constraints.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `server/orchestrator/mutation-effects.ts`: existing committed mutation facts union already models log/update/delete/goals with `committedSummary`; Phase 61 should remove or loosen the assumption that committed mutation effects always carry a fresh `DailySummary`.
- `server/orchestrator/mutation-receipts.ts`: backend-rendered receipt copy for log/update/delete already consumes committed facts and should remain the user-visible copy authority.
- `server/orchestrator/tools.ts`: `log_food` already catches summary recompute failure and recovers from persisted meals; update/delete currently rely on `mealCorrectionService` results with a required `dailySummary`.
- `server/services/meal-correction.ts`: update/delete commit through `mealTransactionsService`, then call `summaryService.getDailySummary(...)`; this is a key place to introduce shared outcome handling or split commit facts from summary availability.
- `server/routes/meals.ts`: direct `PATCH` / `DELETE` routes currently recompute and publish summaries after commit, then return `dailySummary`; these responses need the same `summaryOutcome` contract and HTTP `200` behavior on committed-but-degraded outcomes.
- `server/routes/chat.ts`: `publishSummarySafe(...)` already treats realtime publish failure as non-fatal route logging; this should remain separate from `summaryOutcome`.
- `tests/integration/chat-api.test.ts`, `tests/integration/chat-streaming.test.ts`, `tests/integration/meals-api.test.ts`, `tests/unit/tools.test.ts`, and `tests/unit/orchestrator.test.ts`: existing coverage proves committed log receipts and direct meal route behavior; extend these rather than adding a new test framework.

### Established Patterns
- Routes own HTTP/SSE transport boundaries and response projection; services own reusable persistence/domain logic; orchestrator/tools own model tool contracts and mutation receipts.
- SQLite mutation commit is the authority. Summary recompute, summary recovery, and realtime publish are post-commit freshness concerns.
- Runtime dependencies are wired through `server/app.ts`; tests use injected services and real SQLite.
- Routine logs/traces must stay metadata-only: no raw prompts, user text, assistant final text, tool raw payloads, provider bodies, image data, session material, or database snapshots.
- `GET /api/sse` relies on cookie-backed guest sessions and is intentionally deferred for Phase 63 freshness behavior.

### Integration Points
- `server/orchestrator/tools.ts`: project tool results for `log_food`, `update_meal`, and `delete_meal` into a shared `summaryOutcome`.
- `server/orchestrator/index.ts`: stop requiring a `DailySummary` for every committed mutation effect; render committed receipts from committed facts even when `summaryOutcome` is unavailable.
- `server/services/meal-correction.ts`: ensure update/delete return committed mutation facts even if summary recompute/recovery degrades.
- `server/routes/meals.ts`: ensure direct `PATCH` and `DELETE` return HTTP `200` with committed facts and `summaryOutcome` when the mutation committed.
- `client/src/api.ts` and any affected store/client consumers: parse `summaryOutcome` safely and treat missing top-level `dailySummary` as summary-unavailable, not mutation failure.

</code_context>

<specifics>
## Specific Ideas

- Preferred public union:
  ```ts
  type SummaryOutcome =
    | { status: "fresh"; dailySummary: DailySummary }
    | { status: "recovered"; dailySummary: DailySummary; reason: "recompute_failed" }
    | { status: "unavailable"; reason: "recompute_failed" };
  ```
- Top-level `dailySummary`, if kept during migration, is a compatibility projection from `summaryOutcome.dailySummary` only.
- Direct `PATCH` / `DELETE` committed degraded responses should remain HTTP `200`.
- `publish_failed` remains non-fatal metadata-only observability and does not enter the mutation response body.

</specifics>

<deferred>
## Deferred Ideas

- Visible degraded-summary UI for unavailable or recovered summaries — future polish/integrity follow-up if product wants it. This is not Phase 63.
- Goal mutation migration to `summaryOutcome` — out of scope for Phase 61; accepted type asymmetry for v2.3 unless a planner finds a purely internal refactor that does not alter Phase 61's public surface.

</deferred>

---

*Phase: 61-Committed Mutation Outcome and Summary Contract*
*Context gathered: 2026-05-17*
