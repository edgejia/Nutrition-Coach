# Phase 63: SSE Meal-Row Freshness and Affected-Date Invalidation - Context

**Gathered:** 2026-05-18
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 63 tightens the realtime `daily_summary` SSE path so users cannot see fresher same-day totals beside stale visible meal rows after cross-tab or cross-device meal mutations. Same-day mutation and reconnect events must reconcile meal rows before showing newer summary totals. Historical affected-date events must invalidate or refresh the right historical surface without touching today's summary or rows. Malformed, calendar-invalid, and future-date events must fail closed without mutating app state; valid historical dates are first-class invalidation targets, not fail-closed cases.

This phase covers the `daily_summary` SSE event envelope, client event validation, same-day SSE reconcile behavior, historical affected-date invalidation, route-level emission changes needed to publish affected-date events, and client-side latest-event-wins protection. It does not redesign Phase 62 direct mutation success flows, does not add visible stale/error UI for reconcile failure, and does not define future date or date-moving meal mutation behavior.

</domain>

<decisions>
## Implementation Decisions

### Daily Summary Event Envelope
- **D-01:** Use one strict envelope for all `daily_summary` SSE events:
  ```ts
  {
    summary: DailySummary;
    affectedDate: string;
    source: "initial" | "meal_mutation";
  }
  ```
- **D-02:** `source` is a guardrail, not freshness proof. It exists only to distinguish first/reconnect snapshots from mutation-driven invalidation.
- **D-03:** `affectedDate` drives same-day or historical routing. It supports same-day reconcile and historical invalidation.
- **D-04:** Do not include `summaryOutcome.status`, changed meal ids, changed meal revision ids, or a `mealRevisionId` high-watermark in Phase 63 `daily_summary` events.
- **D-05:** `summary.date` must equal `affectedDate`. If not, the event is invalid and mutates nothing.

### Same-Day SSE Reconcile
- **D-06:** For `source: "meal_mutation"` and `affectedDate === todayKey`, the client must refetch today's meal rows first, then commit the incoming `summary`.
- **D-07:** If the same-day meal refetch fails, preserve the prior visible summary and rows. Do not show the newer summary beside stale visible rows.
- **D-08:** Same-day reconcile failure is silent from the user's perspective in Phase 63. Do not add a toast, inline stale marker, or new visible error state. Existing unauthorized handling and EventSource reconnect behavior remain the recovery paths.
- **D-09:** Overlapping same-day mutation events use latest-event-wins by client receipt/coordinator request-token order, not server commit order. The envelope intentionally has no revision/high-watermark, so the client must treat the latest accepted event/token as authoritative for UI writes.
- **D-10:** If a valid same-day `meal_mutation` event arrives while the initial meal-row load is still in flight, the mutation reconcile wins. Older initial row-load results must not overwrite rows or summary committed by the newer mutation event.
- **D-11:** The same latest-wins token/guard must cover `MainLayout` initial `getMeals()` versus SSE same-day reconcile. Otherwise the initial load can overwrite fresher SSE rows after the coordinator already committed a newer summary/row pair.
- **D-12:** First-mount and reconnect `source: "initial"` same-day handling is governed by the Initial/Reconnect State Matrix below; do not duplicate those conditions elsewhere.
- **D-13:** Reconnect `source: "initial"` events are different when today meal rows are already loaded: treat them as reconnect snapshots and reconcile rows before showing a newer summary. If row refresh fails, keep prior visible summary and rows.
- **D-14:** Server always sends `source: "initial"` on SSE connection. The client must classify first mount versus reconnect from row-load/coordinator state, not from `source` alone.

### Initial/Reconnect State Matrix
- **D-15:** `source: "initial"` + no loaded today rows + coordinator has not committed any same-day summary or row state yet: run existing guarded same-day summary commit; initial `getMeals()` remains the row source, with token protection against later stale overwrite.
- **D-16:** `source: "initial"` + loaded today rows: treat as reconnect snapshot; refetch rows first, then commit summary, with latest-wins/drop-on-failure semantics.
- **D-17:** `source: "initial"` + initial row load in flight but a newer same-day `meal_mutation` event is received: mutation reconcile wins; the older initial load result must be dropped if stale by token.
- **D-18:** `source: "initial"` + same-day + no loaded today rows because initial `getMeals()` failed or recovery reconnect happened before rows loaded: treat like the no-loaded-rows path. Allow guarded same-day summary commit, let the SSE-triggered/retry refetch become the row recovery path, and apply the same token guard against stale row overwrites.
- **D-19:** `source: "meal_mutation"` + same-day: always use the SSE reconcile path, independent of whether mount-time loading is still active. If no today rows are loaded after initial load failure, the SSE reconcile refetch acts as recovery for the missing rows.

### Client Responsibility Boundary
- **D-20:** `client/src/sse.ts` validates and parses the `daily_summary` envelope shape, recursively validates `summary`, validates calendar-real local date keys, then dispatches a richer callback. It must not perform meal refetches itself.
- **D-21:** A small SSE reconcile coordinator/helper should own future-date ignore, today-versus-historical routing, refetch-first, latest-wins, and drop-on-failure behavior for SSE-driven same-day events.
- **D-22:** `client/src/store.ts` remains the guarded state commit boundary. It should not own SSE event orchestration.
- **D-23:** Existing non-transport async store actions such as guest-session bootstrap/recovery are not prohibited by this boundary.
- **D-24:** Plan phase may evaluate whether `client/src/meal-edit-refresh.ts` should share primitives with the SSE coordinator or eventually adopt refetch-first ordering. If sharing would require flag-heavy parameterization, increase coupling, or materially change visible Phase 62 behavior, keep paths independent and apply the new coordinator only to the Phase 63 SSE path.
- **D-25:** Phase 62 direct mutation success flows are not retroactively changed. Making direct mutation paths refetch-first is optional cleanup, not required by Phase 63.

### Historical Affected-Date Invalidation
- **D-26:** For valid `affectedDate !== todayKey` events, the client must never update today's summary, refresh today's rows, or invoke the same-day reconcile path.
- **D-27:** Historical events invalidate the affected historical date through `recordMealMutation(affectedDate)` / `lastMealMutation` nonce. This is the valid non-future historical SSE invalidation signal.
- **D-28:** Same-day SSE reconcile should use its own coordinator token path rather than `recordMealMutation(affectedDate)`.
- **D-29:** If the affected historical date is currently visible, refresh that visible surface; otherwise passive invalidation is enough.
- **D-30:** "Currently visible" means an open Day Detail whose `dateKey` matches `affectedDate`, or the active History screen when `affectedDate` is the selected day or falls within the currently visible history week.
- **D-31:** Do not refresh merely because the History tab exists. Non-visible historical dates remain passive invalidation only.
- **D-32:** Historical event `summary` is validated but not consumed as the data source for historical surfaces in Phase 63. Historical surfaces refresh through affected-date invalidation/refetch.
- **D-33:** Historical visible refreshes use latest-event-wins per `affectedDate` by client receipt/coordinator request-token order. Older in-flight refresh results must not overwrite newer refresh results for the same visible date.
- **D-34:** Do not require explicit event coalescing in Phase 63.

### Validation And Date Guardrails
- **D-35:** `daily_summary` SSE validation is strict and silent. JSON parse failures, envelope shape failures, recursive `DailySummary` validation failures, invalid `source`, invalid `affectedDate`, invalid `summary.date`, and `summary.date !== affectedDate` are ignored without throwing.
- **D-36:** Invalid events mutate no app state: no `setDailySummary`, no meal-row refresh, no same-day reconcile, no `recordMealMutation`, no historical refresh, and no `lastMealMutation` nonce increment.
- **D-37:** No dev/debug signal is introduced in Phase 63 for invalid frames. This follows the existing `goals_update` SSE precedent.
- **D-38:** `affectedDate` and `summary.date` must be real local date keys. They must match `YYYY-MM-DD` and pass calendar round-trip validation. Impossible dates such as `2026-02-31` are invalid.
- **D-39:** Route by date at the SSE coordinator boundary. Same-day valid events may call `setDailySummary` after required row reconciliation. Valid non-today events must not call `setDailySummary` because that store action triggers rollover refresh when `summary.date !== local today`.
- **D-40:** The existing store-level date guard remains defense in depth, not the primary historical routing mechanism.
- **D-41:** Future valid dates are valid calendar keys but out of current product scope. If `affectedDate > client todayKey`, silently ignore the event with no `setDailySummary`, no `recordMealMutation`, and no `lastMealMutation` increment.
- **D-42:** Future-date ignore is coordinator responsibility after `sse.ts` validates envelope shape and calendar-real date keys. `sse.ts` should dispatch valid future-date envelopes to the coordinator rather than classify product-scope routing itself.
- **D-43:** Phase 63 does not change server future-date mutation policy.

### Server Emission And Scope Assumptions
- **D-44:** Server-side routes must emit historical affected-date `daily_summary` events when meal mutations affect historical dates.
- **D-45:** Current `server/routes/chat.ts` and `server/routes/meals.ts` publish helpers hard-gate `daily_summary` fan-out to today. Phase 63 must remove or replace those today-only gates and add historical affected-date emission; this is not just metadata plumbing over existing historical emission.
- **D-46:** `server/realtime/publisher.ts` remains fan-out only. Add metadata to events at route/service call sites rather than introducing DB reads into the publisher.
- **D-47:** Date-moving meal mutations are out of current product scope. Current update/correction paths revise meal contents/image and preserve existing `loggedAt`, so each emitted meal-mutation `daily_summary` event can cover exactly one `affectedDate`. If date-moving meal mutations are introduced later, that feature must define multi-date emission semantics separately.

### Planner Discretion
- Planner may choose the exact module name and placement for the SSE reconcile coordinator/helper.
- Planner may choose cancellation, request-token, or nonce mechanics for latest-event-wins as long as ordering is based on client receipt/coordinator token order and older in-flight work cannot overwrite newer event results.
- Planner may decide whether to extract/reuse existing `client/src/lib/history-week.ts` date-key parsing logic or add an equivalent non-throwing validator.
- Planner may choose the exact route-level API changes needed to pass `affectedDate` and `source` into `publishDailySummary`, provided the publisher remains fan-out only.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Planning Scope
- `.planning/ROADMAP.md` - Phase 63 goal, success criteria, dependency on Phase 62, UI hint, and implementation notes.
- `.planning/REQUIREMENTS.md` - REAL-01 through REAL-03 and v2.3 proof/privacy constraints.
- `.planning/PROJECT.md` - v2.3 milestone context, current state, constraints, and key decisions.
- `.planning/STATE.md` - Current workflow position and accumulated v2.3 decisions.
- `.planning/phases/62-meal-revision-tokens-and-stale-receipt-protection/62-CONTEXT.md` - Prior phase decisions around `mealRevisionId`, stale conflict recovery, direct mutation row refresh, and server-side stale write authority.
- `.planning/phases/61-committed-mutation-outcome-and-summary-contract/61-CONTEXT.md` - Prior phase decisions separating committed mutation facts, `summaryOutcome`, daily summary availability, and realtime publish delivery.
- `.planning/phases/60-goal-proposal-authority-and-rejected-goal-copy/60-CONTEXT.md` - Prior phase decisions around backend-owned deterministic copy and mutation authority.

### Codebase Maps
- `.planning/codebase/STACK.md` - TypeScript/Fastify/SQLite/Zustand stack and verification commands.
- `.planning/codebase/ARCHITECTURE.md` - Route/service/orchestrator boundaries, client store boundary, realtime publisher, and SSE flow.
- `.planning/codebase/INTEGRATIONS.md` - EventSource, guest-session, SQLite, logging, and metadata-only observability constraints.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `server/realtime/publisher.ts` - Current process-local fan-out for `daily_summary` and `goals_update`. Keep it as fan-out only; widen the payload type instead of adding reads.
- `server/routes/sse.ts` - Sends the initial `daily_summary` event on connection. It should emit the strict envelope with `source: "initial"` and the correct `affectedDate`.
- `server/routes/chat.ts` - Publishes summaries after chat meal mutations through `publishSummarySafe(...)`, but the current helper hard-gates `daily_summary` fan-out to today. It already has `affectedDate` in chat terminal payloads and needs the today-only gate replaced so historical affected-date emission works without breaking chat SSE `status` / `chunk` / `done` ordering.
- `server/routes/meals.ts` - Publishes direct PATCH/DELETE summaries after committed meal mutations, but the current helper hard-gates fan-out to today. It already derives `affectedDateKey`; Phase 63 must remove/replace the today-only gate and add historical affected-date emission.
- `client/src/sse.ts` - Existing EventSource parser and `goals_update` validation precedent. This is the correct place for strict `daily_summary` envelope validation and silent ignore of invalid frames.
- `client/src/store.ts` - Guarded `setDailySummary` boundary and `recordMealMutation(affectedDate)` nonce mechanism. Do not use `setDailySummary` for historical events because it triggers rollover refresh on non-today dates.
- `client/src/components/MainLayout.tsx` - Wires `connectSSE`, initial `getMeals()`, rollover refresh, and state actions. There are two `connectSSE` call sites today: one inside `refreshForRollover` and one in the mount/subscription effect. Coordinator wiring must cover both so rollover reconnect behavior and normal mount behavior do not duplicate or drift.
- `client/src/meal-edit-refresh.ts` - Existing direct mutation refresh helper. It may share low-coupling primitives with the SSE coordinator only if Phase 62 visible behavior remains unchanged.
- `client/src/components/HistoryScreen.tsx` - Uses `lastMealMutation`, selected day, current visible week, cache invalidation, and React effect cleanup patterns that already support latest-event-wins for existing history surfaces.
- `client/src/components/HistoryDayDetailScreen.tsx` - Visible historical day detail currently loads by `dateKey`; Phase 63 should cover the matching open Day Detail refresh case.
- `client/src/lib/history-week.ts` - Existing date-key parsing and current-week helpers; planner may reuse or mirror this for non-throwing SSE date validation.

### Established Patterns
- Routes own HTTP/SSE boundaries, validation, guest-session ownership, response shaping, and publish timing.
- Services own reusable persistence/domain logic. The realtime publisher should not query services or DB.
- Client transport helpers parse and validate untrusted payloads before calling state actions.
- Zustand store actions are the canonical state commit boundary, but transport orchestration belongs outside the store.
- `goals_update` SSE already silently ignores malformed frames; `daily_summary` should follow that precedent.
- `lastMealMutation` with a monotonic nonce is the existing affected-date invalidation signal.
- Routine logs/traces and planning proof must remain metadata-only: no raw prompts, user text, assistant final text, tool raw payloads, provider bodies, image data, session material, or database snapshots.

### Integration Points
- `server/realtime/publisher.ts`: widen `publishDailySummary` to publish a strict envelope while preserving fan-out-only behavior.
- `server/routes/sse.ts`: emit the initial envelope with `source: "initial"` and `affectedDate` matching the summary date.
- `server/routes/chat.ts`: remove/replace the current today-only publish gate, then pass `source: "meal_mutation"` and the committed mutation `affectedDate` into summary publish calls for same-day and historical meal mutation results, while preserving SSE terminal ordering.
- `server/routes/meals.ts`: remove/replace the current today-only publish gate, then publish affected-date envelopes for same-day and historical direct meal mutations after commit and summary availability.
- `client/src/types.ts`: add a `DailySummarySSEPayload` or equivalent strict envelope type.
- `client/src/sse.ts`: validate the envelope recursively, validate local date keys, require `summary.date === affectedDate`, silently ignore invalid frames, and dispatch valid calendar-date envelopes through a richer callback. Future-date ignore belongs to the coordinator.
- `client/src/components/MainLayout.tsx` or a nearby helper: coordinate refetch-first, latest-wins, drop-on-failure behavior for same-day mutation/reconnect events, future-date ignore, and historical visible refresh dispatch. Wire the coordinator consistently through both existing `connectSSE` call sites: the mount/subscription effect and `refreshForRollover`.
- `client/src/store.ts`: continue using `setDailySummary` only after same-day routing/reconciliation. Use `recordMealMutation(affectedDate)` / `lastMealMutation` nonce as the valid non-future historical SSE invalidation signal; same-day SSE reconcile uses the coordinator token path instead.
- `client/src/components/HistoryScreen.tsx` and `client/src/components/HistoryDayDetailScreen.tsx`: preserve selected-day/current-week invalidation semantics and add the matching open Day Detail refresh path if not already covered.

</code_context>

<specifics>
## Specific Ideas

- Preferred event source literals: `"initial"` and `"meal_mutation"`.
- Preferred event envelope:
  ```ts
  {
    summary: DailySummary;
    affectedDate: string;
    source: "initial" | "meal_mutation";
  }
  ```
- `source` must not be treated as freshness proof.
- Historical handling is invalidate/refetch, not pushed-summary consumption.
- Same-day and historical visible refresh both use latest-event-wins by client receipt/coordinator request-token order, not server commit order.
- `recordMealMutation(affectedDate)` / `lastMealMutation` nonce is the valid non-future historical SSE invalidation signal. Same-day SSE reconcile uses its own coordinator token path.
- Server sends `source: "initial"` on every SSE connection, so first mount versus reconnect is client-classified from row-load/coordinator state.
- Silent-ignore means no state mutation and no user-visible error.

</specifics>

<deferred>
## Deferred Ideas

- Date-moving meal mutations - out of current product scope. If introduced later, define multi-date summary emission semantics separately.
- Future-date mutation handling - out of current product scope. Phase 63 silently ignores future valid dates and does not change server future-date mutation policy.

</deferred>

---

*Phase: 63-SSE Meal-Row Freshness and Affected-Date Invalidation*
*Context gathered: 2026-05-18*
