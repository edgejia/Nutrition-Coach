# Phase 63: SSE Meal-Row Freshness and Affected-Date Invalidation - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md - this log preserves the alternatives considered.

**Date:** 2026-05-18
**Phase:** 63-SSE Meal-Row Freshness and Affected-Date Invalidation
**Areas discussed:** Daily Summary Event Metadata, Same-Day Client Reaction, Historical Affected-Date Invalidation, Malformed/Stale Event Guardrails

---

## Daily Summary Event Metadata

| Option | Description | Selected |
|--------|-------------|----------|
| `affectedDate` only | Smallest contract; tells the client which day may be stale. | |
| `affectedDate` + source | Adds `source: "initial" | "meal_mutation"` as a guardrail. | Yes |
| `affectedDate` + meal freshness hints | Adds changed meal ids or revision hints. | |
| You decide | Agent chooses the smallest contract. | |

**User's choice:** Use `{ summary, affectedDate, source }`.
**Notes:** `source` is a guardrail, not freshness proof. Do not include `summaryOutcome.status`, changed meal ids, or meal revision high-watermarks. Validate the full envelope and require `summary.date === affectedDate`.

---

## Same-Day Client Reaction

| Option | Description | Selected |
|--------|-------------|----------|
| Refetch meals first, then commit summary | Prevents fresher totals beside stale visible rows. | Yes |
| Commit summary immediately, mark meals pending | Faster totals, but needs new visible state. | |
| Commit summary and refetch in parallel | Simpler, but allows a stale-row window. | |
| You decide | Agent chooses the safest behavior. | |

**User's choice:** For mutation-driven same-day SSE events, refetch today's rows before committing the summary.
**Notes:** If refetch fails, preserve prior visible summary and rows. Direct Phase 62 mutation success flows are not retroactively changed. Same-day mutation events use latest-event-wins, and mutation reconcile wins over older initial row-load results.

| Option | Description | Selected |
|--------|-------------|----------|
| `sse.ts` callback dispatches richer event | Parser validates and dispatches; orchestration sits outside transport. | Yes |
| `sse.ts` performs refetch | Centralizes SSE behavior but mixes transport with API/store work. | |
| `store.ts` owns async event action | Single state boundary but imports orchestration into store. | |
| You decide | Agent chooses architecture match. | |

**User's choice:** `sse.ts` validates and dispatches; a coordinator/helper owns reconcile; `store.ts` owns guarded commits.
**Notes:** Planner may share low-coupling primitives with `meal-edit-refresh.ts` only if Phase 62 visible behavior is preserved. Avoid flag-heavy or tightly coupled shared helpers.

---

## Historical Affected-Date Invalidation

| Option | Description | Selected |
|--------|-------------|----------|
| Invalidate historical caches only | Passive affected-date invalidation. | |
| Invalidate plus refresh visible matching surface | Refresh open matching Day Detail or visible History date/week. | Yes |
| Ignore historical SSE events | Protects today but fails roadmap historical invalidation. | |
| You decide | Agent chooses balanced behavior. | |

**User's choice:** Historical events invalidate affected dates and refresh visible matching historical surfaces.
**Notes:** Non-today events never update today's summary or rows. Server must emit historical affected-date events while the publisher remains fan-out only.

| Option | Description | Selected |
|--------|-------------|----------|
| Only exact open Day Detail | Tightest visible-surface scope. | |
| Day Detail plus selected/current-week History | Matches existing History selected-day/current-week behavior. | Yes |
| Any History tab presence | Likely over-fetches. | |
| You decide | Agent chooses minimum visible scope. | |

**User's choice:** Visible means matching open Day Detail, or active History when affected date is selected or in the visible week.
**Notes:** Do not refresh merely because the History tab exists. Non-visible historical dates remain passive invalidation only.

| Option | Description | Selected |
|--------|-------------|----------|
| Same envelope for all dates | Uniform strict wire contract. | Yes |
| Omit summary for historical events | Separate shapes reduce misuse but complicate validation. | |
| Validate then discard summary | Same envelope but explicit non-consumption. | |
| You decide | Agent chooses one contract. | |

**User's choice:** Use one envelope for all dates, but do not consume historical pushed summaries as data.
**Notes:** Historical surfaces refresh through invalidation/refetch. `summary.date === affectedDate` is required.

| Option | Description | Selected |
|--------|-------------|----------|
| Latest-event-wins per affected date | Older visible refreshes cannot overwrite newer results. | Yes |
| Normal refetch ordering | Simpler but allows stale overwrites. | |
| Coalesce repeated events | More complex and not required. | |
| You decide | Agent mirrors same-day invariant. | |

**User's choice:** Latest-event-wins per affected date, without requiring coalescing.
**Notes:** Existing `recordMealMutation` nonce and React effect cleanup patterns already support this for existing History surfaces; matching Day Detail should preserve the invariant.

---

## Malformed/Stale Event Guardrails

| Option | Description | Selected |
|--------|-------------|----------|
| Silent ignore with no state mutation | Follows malformed `goals_update` precedent. | Yes |
| Silent ignore plus dev/debug signal | Adds diagnosis but new client observability path. | |
| Trigger conservative refresh | Defensive but spoofed events can cause network work. | |
| You decide | Agent follows existing precedent. | |

**User's choice:** Invalid events are silently ignored.
**Notes:** Invalid includes parse failure, envelope failure, summary validation failure, invalid source, invalid dates, and `summary.date !== affectedDate`. Invalid events mutate no state and introduce no debug signal.

| Option | Description | Selected |
|--------|-------------|----------|
| Strict local date key only | Match `YYYY-MM-DD`. | |
| Valid calendar date only | Match and calendar-roundtrip local date keys. | Yes |
| Any non-empty string | Too loose. | |
| You decide | Agent chooses current date-key pattern. | |

**User's choice:** `affectedDate` and `summary.date` must be calendar-valid local date keys.
**Notes:** Invalid dates are silently ignored and must not increment `lastMealMutation`.

| Option | Description | Selected |
|--------|-------------|----------|
| Route by date, never through today summary state | Non-today events avoid `setDailySummary`. | Yes |
| Call `setDailySummary` and rely on store guard | Would trigger rollover refresh incorrectly. | |
| Ignore non-today unless History visible | Loses passive invalidation. | |
| You decide | Agent chooses coordinator routing. | |

**User's choice:** The SSE coordinator routes by date. Non-today events must not call `setDailySummary`.
**Notes:** `setDailySummary` triggers rollover refresh on non-today dates, so the store guard is defense in depth only.

| Option | Description | Selected |
|--------|-------------|----------|
| Future valid dates are ignored | Future dates are valid but out of product scope. | Yes |
| Route future dates as historical invalidation | Uniform but creates unavailable-surface churn. | |
| Trigger rollover refresh | Conflates mutation events with clock rollover. | |
| You decide | Agent chooses conservative behavior. | |

**User's choice:** Future valid dates are silently ignored at the SSE coordinator boundary.
**Notes:** Use client-local today as the cutoff. Phase 63 does not change server future-date mutation policy.

---

## Planner Discretion

- Exact SSE reconcile helper module name and placement.
- Exact latest-event-wins mechanics.
- Whether to reuse `history-week.ts` validation logic or add an equivalent non-throwing validator.
- Whether low-coupling primitives can be shared with `meal-edit-refresh.ts` without changing Phase 62 visible behavior.

## Deferred Ideas

- Date-moving meal mutations require separate multi-date emission semantics if introduced later.
- Future-date mutation handling remains out of current product scope.
