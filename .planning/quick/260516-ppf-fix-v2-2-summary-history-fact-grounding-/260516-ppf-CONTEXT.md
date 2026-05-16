# Quick Task 260516-ppf: Fix v2.2 summary/history fact-grounding blocker - Context

**Gathered:** 2026-05-16
**Status:** Ready for planning

<domain>
## Task Boundary

Fix v2.2 summary/history fact-grounding blocker: extend get_daily_summary with persisted meal facts, prevent aggregate totals from authorizing fake meal names or wrong per-meal kcal attribution, and add regression coverage for fake meal lists and daily-total-as-single-meal claims.

</domain>

<decisions>
## Implementation Decisions

### Grounding Policy
- Persisted meal records are the only allowed source for meal names and per-meal kcal facts in summary/history output.
- Aggregate daily totals can support day-level totals only. They must not authorize invented meal names, fake meal lists, or assigning the full daily total to one meal.

### Agent Discretion
- Follow existing Nutrition Coach service, orchestrator, and test patterns.
- Keep the change surgical and add focused regression coverage for fake meal lists and daily-total-as-single-meal claims.

</decisions>

<specifics>
## Specific Ideas

No extra implementation requirements beyond the locked grounding policy above.

</specifics>

<canonical_refs>
## Canonical References

No external specs - requirements fully captured in decisions above.

</canonical_refs>
