# Roadmap: Nutrition Coach

## Milestones

- **v2.0 Logging & Mobile Quality Foundation** - shipped 2026-05-07; archived in [`milestones/v2.0/ROADMAP.md`](milestones/v2.0/ROADMAP.md)
- **v2.1 AI Trust Infrastructure & Logging Reliability** - shipped 2026-05-12; archived in [`milestones/v2.1/ROADMAP.md`](milestones/v2.1/ROADMAP.md)
- **v2.2 LLM Failure Localization Foundation** - shipped 2026-05-15; archived in [`milestones/v2.2/ROADMAP.md`](milestones/v2.2/ROADMAP.md)
- **v2.2 Promotion Blocker Reopen** - active

## Phases

- [x] **Phase 59: Authoritative Summary Facts and SSE Proof** - Backend summary/history replies use persisted facts as the authoritative meal-fact source, and SSE proof drains through stream close before promotion. Completed 2026-05-16.

<details>
<summary>v2.2 LLM Failure Localization Foundation (Phases 55-58) - SHIPPED 2026-05-15</summary>

- [x] Phase 55: Turn Correlation Spine and Frontend Reference Code (4/4 plans) - completed 2026-05-14
- [x] Phase 56: Provider Metadata and Orchestrator Hook Plumbing (4/4 plans) - completed 2026-05-14
- [x] Phase 57: Fallback Event Semantics and Trace v2 Schema (6/6 plans) - completed 2026-05-15
- [x] Phase 58: Localization Proof and Release Gate (4/4 plans) - completed 2026-05-15

</details>

## Phase Details

### Phase 59: Authoritative Summary Facts and SSE Proof

**Goal:** v2.2 promotion is unblocked by deterministic summary/history fact rendering plus machine-checkable SSE ordering proof.

**Depends on:** Phase 58, quick task 260516-ppf

**Requirements:** AUTH-01, AUTH-02, AUTH-03, AUTH-04, STREAM-01, STREAM-02, STREAM-03

**Plans:** 5/5 plans complete

Plans:
**Wave 1**
- [x] 59-01-PLAN.md — Shared deterministic summary/history renderer and advice guard
- [x] 59-04-PLAN.md — Through-close SSE terminal proof and structured artifacts

**Wave 2** *(blocked on Wave 1 completion)*
- [x] 59-02-PLAN.md — Orchestrator plain-reply composition from persisted facts

**Wave 3** *(blocked on Wave 2 completion)*
- [x] 59-03-PLAN.md — JSON, drained-stream, and live SSE route wiring

**Wave 4** *(blocked on Wave 3 completion)*
- [x] 59-05-PLAN.md — Local release-check closure gate with no promotion

**Success Criteria** (what must be TRUE):
1. Persisted meal records are the authoritative backend source for meal names, meal count, day total kcal, and per-meal kcal in summary/history replies.
2. Summary/history final replies are split into a deterministic fact segment plus an optional LLM advice segment.
3. Optional LLM advice cannot introduce concrete persisted meal names, per-meal kcal, macro attribution, meal count, or day total facts.
4. JSON, SSE, and non-SSE final reply paths use the same fact renderer and advice guard.
5. The existing final guard remains as defense-in-depth rather than the primary correctness mechanism.
6. SSE proof drains through stream close and fails if any `chunk` or `status` frame appears after the first `done`.
7. Harness artifacts store structured SSE proof metadata and do not persist raw SSE frame transcripts.

**Implementation Notes:**
- Do not promote to `staging` or `main` as part of this phase.
- Keep product-polish and other authoritative state boundary work out of scope.
- Use the pending blocker note and acceptance checklist as source context:
  - `.planning/todos/pending/v2-2-authoritative-summary-facts-sse-proof.md`
  - `.planning/notes/v2-2-authoritative-summary-facts-acceptance.md`
  - `.planning/notes/v2-2-post-review-blocker-reopened.md`

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 55. Turn Correlation Spine and Frontend Reference Code | v2.2 | 4/4 | Complete | 2026-05-14 |
| 56. Provider Metadata and Orchestrator Hook Plumbing | v2.2 | 4/4 | Complete | 2026-05-14 |
| 57. Fallback Event Semantics and Trace v2 Schema | v2.2 | 6/6 | Complete | 2026-05-15 |
| 58. Localization Proof and Release Gate | v2.2 | 4/4 | Complete | 2026-05-15 |
| 59. Authoritative Summary Facts and SSE Proof | v2.2 blocker | 5/5 | Complete | 2026-05-16 |

## Future Milestone Candidates

- User-flagged semantic failure capture after trigger, retention, privacy, storage, and access-control decisions are made.
- Local-only raw debugger implementation under the sibling raw debugger contract.
- Metadata-only production trace sampling and aggregate failure metrics.
- Product polish beyond the v2.1 trust slice from `docs/research/product-improve.md`.

---
*Last updated: 2026-05-16 after completing Phase 59 local verification*
