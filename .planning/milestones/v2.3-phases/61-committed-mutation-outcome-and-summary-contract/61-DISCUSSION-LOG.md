# Phase 61: Committed Mutation Outcome and Summary Contract - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-17
**Phase:** 61-Committed Mutation Outcome and Summary Contract
**Areas discussed:** Summary outcome shape, Chat and direct route parity, User-visible degraded copy, Recovery behavior

---

## Summary Outcome Shape

| Option | Description | Selected |
|--------|-------------|----------|
| `summaryOutcome` object | Explicit union for fresh/recovered/unavailable summary availability. | ✓ |
| Nullable `dailySummary` plus status | Smaller change, but easier to misuse `dailySummary` alone. | |
| Recovered summary only | Preserve current recovery behavior but hide degradation. | |
| Agent decides | Let planner choose the conservative contract. | |

**User's choice:** Use an explicit `summaryOutcome` union:

```ts
type SummaryOutcome =
  | { status: "fresh"; dailySummary: DailySummary }
  | { status: "recovered"; dailySummary: DailySummary; reason: "recompute_failed" }
  | { status: "unavailable"; reason: "recompute_failed" };
```

**Notes:** `recovered` must be externally visible to break the current incorrect coupling around `committedSummary: DailySummary` / `requireDailySummary...`. `publish_failed` is not part of `summaryOutcome`; it is realtime delivery observability and does not affect whether the current response has a usable summary.

---

## Chat And Direct Route Parity

| Option | Description | Selected |
|--------|-------------|----------|
| Same public contract everywhere | Chat JSON, chat stream terminal payloads, and direct meal routes all expose `summaryOutcome`. | ✓ |
| Same internal contract, different public shape | Services/tools use `summaryOutcome`, but routes expose different shapes. | |
| Direct routes explicit first, chat minimal | Direct `PATCH`/`DELETE` expose `summaryOutcome`; chat mostly preserves existing payloads. | |
| Agent decides | Bias toward the smallest change that avoids contract drift. | |

**User's choice:** Same public contract for chat JSON, chat stream terminal payloads, and direct `PATCH` / `DELETE` responses.

**Notes:** `/api/sse daily_summary` is excluded. Client HTTP consumers are in Phase 61 scope only enough to consume `summaryOutcome` safely; full SSE row freshness stays Phase 63. Keep top-level `dailySummary` temporarily as a derived compatibility field for fresh/recovered only.

---

## User-Visible Degraded Copy

| Option | Description | Selected |
|--------|-------------|----------|
| Same committed receipt only | User sees the committed mutation facts; structured payload carries degradation. | ✓ |
| Receipt plus soft freshness note for unavailable only | Adds a mild caveat only when no summary is available. | |
| Receipt plus explicit note for recovered and unavailable | More transparent, but makes successful mutations feel broken. | |
| Agent decides | Keep copy focused on committed facts unless visible guidance is required. | |

**User's choice:** User-facing mutation receipt remains committed-facts only for fresh, recovered, and unavailable outcomes.

**Notes:** Do not append summary freshness caveats. `summaryOutcome` is the structured degraded-signal channel for chat/direct HTTP clients and tests. Phase 61 does not add visible stale-summary UI; client work is limited to parsing/consuming `summaryOutcome` safely and avoiding treating missing `dailySummary` as mutation failure. Visible unavailable-state UI is not deferred to Phase 63; it would be a separate future follow-up.

---

## Recovery Behavior

| Option | Description | Selected |
|--------|-------------|----------|
| Attempt recovery for all meal mutation families | Normal recompute first, persisted-meals recovery second, unavailable if both fail. | ✓ |
| Preserve recovery only for `log_food` | Smaller implementation, but inconsistent behavior. | |
| No recovery | Mark unavailable on first recompute failure. | |
| Agent decides | Choose the path that removes duplicated degraded-summary handling. | |

**User's choice:** Use the same recovery policy for every meal mutation family.

**Notes:** After the mutation commits, try normal summary recompute first; if that fails, attempt persisted-meals recovery. Recovery success is distinguishable from fresh summary through `summaryOutcome`. If recovery also fails, return committed mutation facts with `summaryOutcome.status === "unavailable"`.

---

## Additional Locked Notes

- Committed direct `PATCH` / `DELETE` responses remain HTTP `200` regardless of `summaryOutcome.status`; degraded summary is represented in the response body, not via `207` or an error status.
- Do not extend Phase 61 to `update_goals`. Goals summary-outcome migration is out of scope for this phase; any type asymmetry is accepted for v2.3 unless a planner finds a purely internal refactor that does not change the Phase 61 surface.

## the agent's Discretion

- Exact helper/module placement for `SummaryOutcome`, recovery helpers, response projection, and metadata-only observability names.

## Deferred Ideas

- Visible degraded-summary UI for unavailable/recovered summaries belongs to a future polish/integrity follow-up if desired.
- Goal mutation migration to `summaryOutcome` is out of scope for Phase 61.
