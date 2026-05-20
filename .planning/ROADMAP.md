# Roadmap: Nutrition Coach

## Milestones

- **v2.0 Logging & Mobile Quality Foundation** - shipped 2026-05-07; archived in [`milestones/v2.0/ROADMAP.md`](milestones/v2.0/ROADMAP.md)
- **v2.1 AI Trust Infrastructure & Logging Reliability** - shipped 2026-05-12; archived in [`milestones/v2.1/ROADMAP.md`](milestones/v2.1/ROADMAP.md)
- **v2.2 LLM Failure Localization Foundation** - shipped 2026-05-15; archived in [`milestones/v2.2/ROADMAP.md`](milestones/v2.2/ROADMAP.md)
- **v2.2 Promotion Blocker Reopen** - Phase 59 complete 2026-05-16; no staging/main promotion authorized
- **v2.3 Authoritative Mutation Outcomes and Fresh Meal State** - shipped locally 2026-05-20; archived in [`milestones/v2.3-ROADMAP.md`](milestones/v2.3-ROADMAP.md); no staging/main promotion performed

## Current Status

No active milestone is selected.

v2.3 closed the P1 data-integrity risks around backend-owned goal proposal authority, committed mutation receipts, stale meal revision protection, strict `daily_summary` SSE freshness, and metadata-only local release proof. Staging or main promotion remains outside milestone closeout and requires a separate ship workflow with explicit approval.

## Completed v2.3 Scope

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 60. Goal Proposal Authority and Rejected-Goal Copy | v2.3 | 3/3 | Complete | 2026-05-17 |
| 61. Committed Mutation Outcome and Summary Contract | v2.3 | 6/6 | Complete | 2026-05-17 |
| 62. Meal Revision Tokens and Stale Receipt Protection | v2.3 | 5/5 | Complete | 2026-05-17 |
| 63. SSE Meal-Row Freshness and Affected-Date Invalidation | v2.3 | 5/5 | Complete | 2026-05-18 |
| 64. Verification and Release-Proof Hardening | v2.3 | 4/4 | Complete | 2026-05-19 |

Archived phase execution files:

- `.planning/milestones/v2.3-phases/60-goal-proposal-authority-and-rejected-goal-copy/`
- `.planning/milestones/v2.3-phases/61-committed-mutation-outcome-and-summary-contract/`
- `.planning/milestones/v2.3-phases/62-meal-revision-tokens-and-stale-receipt-protection/`
- `.planning/milestones/v2.3-phases/63-sse-meal-row-freshness-and-affected-date-invalidation/`
- `.planning/milestones/v2.3-phases/64-verification-and-release-proof-hardening/`

## Future Milestone Candidates

- Water tracking from the primary logging flow.
- Monthly nutrition history beyond the current affected-date freshness scope.
- Onboarding animation, motion system, and unrelated visual polish.
- User-flagged semantic failure capture after trigger, retention, privacy, storage, and access-control decisions.
- Local-only raw debugger implementation under the sibling raw debugger contract.
- Metadata-only production trace sampling and aggregate failure metrics.
- Accepted v2.3 advisory cleanup: align `log_food` JSON tool schema required fields with the optional `protein_sources` executor contract.

---
*Last updated: 2026-05-20 after v2.3 closeout*
