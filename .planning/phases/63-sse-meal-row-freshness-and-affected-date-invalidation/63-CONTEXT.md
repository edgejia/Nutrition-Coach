# Phase 63: SSE Meal-Row Freshness and Affected-Date Invalidation - Context

**Gathered:** 2026-05-18
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 63 tightens the realtime `daily_summary` SSE path so users cannot see fresher same-day totals beside stale visible meal rows after cross-tab or cross-device meal mutations. Same-day mutation and reconnect events must reconcile meal rows before showing newer summary totals. Historical affected-date events must invalidate or refresh the right historical surface without touching today's summary or rows. Malformed, stale-date, and future-date events must fail closed without mutating app state.

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
- **D-09:** Overlapping same-day mutation events use latest-event-wins. If a newer mutation-driven event arrives while an older refetch is in flight, older results must not overwrite the newer event's summary/row pair.
- **D-10:** If a valid same-day `meal_mutation` event arrives while the initial meal-row load is still in flight, the mutation reconcile wins. Older initial row-load results must not overwrite rows or summary committed by the newer mutation event.
- **D-11:** First-mount `source: "initial"` events are allowed to run the existing today-date guarded summary commit when meal rows are not loaded yet. `MainLayout`'s initial `getMeals()` remains the row source.
- **D-12:** Reconnect `source: "initial"` events are different when today meal rows are already loaded: treat them as reconnect snapshots and reconcile rows before showing a newer summary. If row refresh fails, keep prior visible summary and rows.

### Client Responsibility Boundary
- **D-13:** `client/src/sse.ts` validates and parses the `daily_summary` envelope, then dispatches a richer callback. It must not perform meal refetches itself.
- **D-14:** A small SSE reconcile coordinator/helper should own refetch-first, latest-wins, and drop-on-failure behavior for SSE-driven same-day events.
- **D-15:** `client/src/store.ts` remains the guarded state commit boundary. It should not own SSE event orchestration.
- **D-16:** Existing non-transport async store actions such as guest-session bootstrap/recovery are not prohibited by this boundary.
- **D-17:** Plan phase may evaluate whether `client/src/meal-edit-refresh.ts` should share primitives with the SSE coordinator or eventually adopt refetch-first ordering. If sharing would require flag-heavy parameterization, increase coupling, or materially change visible Phase 62 behavior, keep paths independent and apply the new coordinator only to the Phase 63 SSE path.
- **D-18:** Phase 62 direct mutation success flows are not retroactively changed. Making direct mutation paths refetch-first is optional cleanup, not required by Phase 63.

### Historical Affected-Date Invalidation
- **D-19:** For valid `affectedDate !== todayKey` events, the client must never update today's summary, refresh today's rows, or invoke the same-day reconcile path.
- **D-20:** Historical events invalidate the affected historical date. If the affected historical date is currently visible, refresh that visible surface; otherwise passive invalidation is enough.
- **D-21:** "Currently visible" means an open Day Detail whose `dateKey` matches `affectedDate`, or the active History screen when `affectedDate` is the selected day or falls within the currently visible history week.
- **D-22:** Do not refresh merely because the History tab exists. Non-visible historical dates remain passive invalidation only.
- **D-23:** Historical event `summary` is validated but not consumed as the data source for historical surfaces in Phase 63. Historical surfaces refresh through affected-date invalidation/refetch.
- **D-24:** Historical visible refreshes use latest-event-wins per `affectedDate`. Older in-flight refresh results must not overwrite newer refresh results for the same visible date.
- **D-25:** Do not require explicit event coalescing in Phase 63.

### Validation And Date Guardrails
- **D-26:** `daily_summary` SSE validation is strict and silent. JSON parse failures, envelope shape failures, recursive `DailySummary` validation failures, invalid `source`, invalid `affectedDate`, invalid `summary.date`, and `summary.date !== affectedDate` are ignored without throwing.
- **D-27:** Invalid events mutate no app state: no `setDailySummary`, no meal-row refresh, no same-day reconcile, no `recordMealMutation`, no historical refresh, and no `lastMealMutation` nonce increment.
- **D-28:** No dev/debug signal is introduced in Phase 63 for invalid frames. This follows the existing `goals_update` SSE precedent.
- **D-29:** `affectedDate` and `summary.date` must be real local date keys. They must match `YYYY-MM-DD` and pass calendar round-trip validation. Impossible dates such as `2026-02-31` are invalid.
- **D-30:** Route by date at the SSE coordinator boundary. Same-day valid events may call `setDailySummary` after required row reconciliation. Valid non-today events must not call `setDailySummary` because that store action triggers rollover refresh when `summary.date !== local today`.
- **D-31:** The existing store-level date guard remains defense in depth, not the primary historical routing mechanism.
- **D-32:** Future valid dates are valid calendar keys but out of current product scope. If `affectedDate > client todayKey`, silently ignore the event with no `setDailySummary`, no `recordMealMutation`, and no `lastMealMutation` increment.
- **D-33:** Phase 63 does not change server future-date mutation policy.

### Server Emission And Scope Assumptions
- **D-34:** Server-side routes must emit historical affected-date `daily_summary` events when meal mutations affect historical dates.
- **D-35:** `server/realtime/publisher.ts` remains fan-out only. Add metadata to events at route/service call sites rather than introducing DB reads into the publisher.
- **D-36:** Date-moving meal mutations are out of current product scope. Current update/correction paths revise meal contents/image and preserve existing `loggedAt`, so each emitted meal-mutation `daily_summary` event can cover exactly one `affectedDate`. If date-moving meal mutations are introduced later, that feature must define multi-date emission semantics separately.

### Planner Discretion
- Planner may choose the exact module name and placement for the SSE reconcile coordinator/helper.
- Planner may choose cancellation, request-token, or nonce mechanics for latest-event-wins as long as older in-flight work cannot overwrite newer event results.
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
- `server/routes/chat.ts` - Publishes same-day summaries after chat meal mutations through `publishSummarySafe(...)`. It already has `affectedDate` in chat terminal payloads and needs route-level publish metadata without breaking chat SSE `status` / `chunk` / `done` ordering.
- `server/routes/meals.ts` - Publishes direct PATCH/DELETE summaries after committed meal mutations. It already derives `affectedDateKey`; Phase 63 should preserve historical affected-date emission instead of gating publish to today only.
- `client/src/sse.ts` - Existing EventSource parser and `goals_update` validation precedent. This is the correct place for strict `daily_summary` envelope validation and silent ignore of invalid frames.
- `client/src/store.ts` - Guarded `setDailySummary` boundary and `recordMealMutation(affectedDate)` nonce mechanism. Do not use `setDailySummary` for historical events because it triggers rollover refresh on non-today dates.
- `client/src/components/MainLayout.tsx` - Wires `connectSSE`, initial `getMeals()`, rollover refresh, and state actions. It is a likely orchestration site for the richer SSE callback and coordinator.
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
- `server/routes/chat.ts`: pass `source: "meal_mutation"` and the committed mutation `affectedDate` into summary publish calls for meal mutation results, while preserving SSE terminal ordering.
- `server/routes/meals.ts`: publish affected-date envelopes for same-day and historical direct meal mutations after commit and summary availability.
- `client/src/types.ts`: add a `DailySummarySSEPayload` or equivalent strict envelope type.
- `client/src/sse.ts`: validate the envelope recursively, validate local date keys, require `summary.date === affectedDate`, silently ignore invalid/future frames, and dispatch a richer callback.
- `client/src/components/MainLayout.tsx` or a nearby helper: coordinate refetch-first, latest-wins, drop-on-failure behavior for same-day mutation/reconnect events and historical visible refresh dispatch.
- `client/src/store.ts`: continue using `setDailySummary` only after same-day routing/reconciliation and `recordMealMutation` only for valid non-future historical invalidation.
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
- Same-day and historical visible refresh both use latest-event-wins.
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
