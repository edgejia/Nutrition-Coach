# Roadmap: Nutrition Coach

## Milestones

- **v2.0 Logging & Mobile Quality Foundation** - shipped 2026-05-07; archived in [`milestones/v2.0/ROADMAP.md`](milestones/v2.0/ROADMAP.md)
- **v2.1 AI Trust Infrastructure & Logging Reliability** - shipped 2026-05-12; archived in [`milestones/v2.1/ROADMAP.md`](milestones/v2.1/ROADMAP.md)
- **v2.2 LLM Failure Localization Foundation** - shipped 2026-05-15; archived in [`milestones/v2.2/ROADMAP.md`](milestones/v2.2/ROADMAP.md)
- **v2.2 Promotion Blocker Reopen** - Phase 59 complete 2026-05-16; no staging/main promotion authorized
- **v2.3 Authoritative Mutation Outcomes and Fresh Meal State** - active planning

## Overview

v2.3 closes the remaining P1 data-integrity risks before returning to product polish. The milestone makes backend-committed mutation facts authoritative across goal updates, meal log/update/delete receipts, stale chat receipt edits, and `daily_summary` SSE freshness, while preserving metadata-only proof and the existing Fastify, SQLite, orchestrator, realtime, and Zustand boundaries.

## Phases

**Phase Numbering:**
- Integer phases (60, 61, 62): Planned milestone work
- Decimal phases (60.1, 60.2): Urgent insertions, if needed later

- [x] **Phase 60: Goal Proposal Authority and Rejected-Goal Copy** - Ambiguous goal confirmations can only mutate through backend-owned proposals or explicit current-turn numeric targets. (completed 2026-05-17)
- [x] **Phase 61: Committed Mutation Outcome and Summary Contract** - Meal log/update/delete flows return committed mutation facts even when summary recompute or publish degrades. (completed 2026-05-17)
- [x] **Phase 62: Meal Revision Tokens and Stale Receipt Protection** - Edit-capable receipts carry revision identity and stale receipt writes fail closed with refresh guidance. (completed 2026-05-17)
- [x] **Phase 63: SSE Meal-Row Freshness and Affected-Date Invalidation** - Summary SSE updates cannot make totals fresher than visible meal rows. (completed 2026-05-18)
- [ ] **Phase 64: Verification and Release-Proof Hardening** - v2.3 integrity behavior is proven with targeted tests, metadata-only evidence, and local release gates.

## Phase Details

### Phase 60: Goal Proposal Authority and Rejected-Goal Copy
**Goal**: Users can only change daily targets through explicit current-turn numeric values or a valid backend-persisted goal proposal, and rejected goal updates produce deterministic backend copy.
**Depends on**: Phase 59
**Requirements**: GOAL-01, GOAL-02, GOAL-03, GOAL-04
**Success Criteria** (what must be TRUE):
  1. User can ask for a goal-change recommendation and receive a concrete proposal without daily targets changing yet.
  2. User confirmation text such as `好` changes goals only when it confirms a valid unexpired backend proposal or includes explicit current-turn numeric target values.
  3. User cannot apply expired, consumed, mismatched, or missing proposals; the backend returns deterministic Traditional Chinese guidance and leaves targets unchanged.
  4. Failed `update_goals` validation or guard outcomes do not publish `goals_update`, do not persist targets, and do not show LLM-authored success-style copy.
**Plans**: 3 plans
Plans:
**Wave 1**
- [x] 60-01-PLAN.md — Goal proposal service and deterministic backend copy foundation

**Wave 2** *(blocked on Wave 1 completion)*
- [x] 60-02-PLAN.md — `propose_goals` and explicit-mode `update_goals` tool contracts

**Wave 3** *(blocked on Wave 2 completion)*
- [x] 60-03-PLAN.md — Orchestrator short-circuiting and integration proof

**Implementation Notes:**
- Keep proposal state in the existing turn-state/SQLite pattern, likely through a thin `server/services/goal-proposals.ts` wrapper.
- Preserve route-owned validation and orchestrator-owned tool outcome flow; do not authorize mutation from prior assistant prose.
- Renderer-owned copy should live near `server/orchestrator/mutation-receipts.ts` or a close sibling.

### Phase 61: Committed Mutation Outcome and Summary Contract
**Goal**: Users receive authoritative committed outcomes for meal log, update, and delete mutations even when post-commit summary refresh fails or degrades.
**Depends on**: Phase 60
**Requirements**: MUT-01, MUT-02, MUT-03, MUT-04
**Success Criteria** (what must be TRUE):
  1. User receives a committed log receipt when meal logging persists, even if daily summary recompute or publish fails afterward.
  2. User receives a committed update receipt when meal editing persists, even if daily summary recompute or publish fails afterward.
  3. User receives a committed delete receipt when meal deletion persists, even if daily summary recompute or publish fails afterward.
  4. Direct meal `PATCH` and `DELETE` responses distinguish committed mutation facts from degraded or failed summary refresh status.
**Plans**: 6 plans
Plans:
**Wave 1**
- [x] 61-01-PLAN.md — Shared summary outcome helper and service committed-facts foundation

**Wave 2** *(blocked on Wave 1 completion)*
- [x] 61-02-PLAN.md — Meal mutation effect and receipt contract decoupling
- [x] 61-05-PLAN.md — Direct PATCH/DELETE summaryOutcome route contract

**Wave 3** *(blocked on Wave 2 plan 61-02 completion)*
- [x] 61-03-PLAN.md — Chat tool and orchestrator summaryOutcome propagation

**Wave 4** *(blocked on Wave 3 completion)*
- [x] 61-04-PLAN.md — Chat JSON/SSE response projection and integration proof

**Wave 5** *(blocked on Wave 4 and plan 61-05 completion)*
- [x] 61-06-PLAN.md — Client parsing, direct mutation consumption, and final gate

**Implementation Notes:**
- Add a shared summary-outcome contract rather than duplicating degraded-summary handling across chat tools and direct routes.
- Keep SQLite mutation commit as the authority; summary recompute/publish is a post-commit freshness concern.
- Route/service edits should plan integration coverage using real SQLite and existing Fastify `app.inject()` patterns.

### Phase 62: Meal Revision Tokens and Stale Receipt Protection
**Goal**: Users cannot overwrite newer meal facts from older chat receipts because every edit-capable receipt carries revision identity and stale writes fail closed.
**Depends on**: Phase 61
**Requirements**: FRESH-01, FRESH-02, FRESH-03
**Success Criteria** (what must be TRUE):
  1. User-facing meal and chat receipt DTOs expose current meal revision identity wherever the receipt can start an edit.
  2. User edits from a current receipt can update the meal with the expected revision contract.
  3. User edits from an older receipt are rejected without mutating the meal or creating a newer revision.
  4. User sees deterministic stale-record guidance in the chat receipt view, and affected meal rows refresh or invalidate after the conflict.
**Plans:** 5/5 plans complete
Plans:
**Wave 1**
- [x] 62-01-PLAN.md — Direct transaction preconditions and meal route conflict contract
- [x] 62-02-PLAN.md — Server read DTO and chat receipt revision identity projection

**Wave 2** *(blocked on Wave 1 plan 62-01 completion)*
- [x] 62-03-PLAN.md — Chat/tool expected revision threading for update and delete

**Wave 3** *(blocked on Wave 1 and Wave 2 completion)*
- [x] 62-04-PLAN.md — Client edit payload, stale conflict guidance, and recovery

**Wave 4** *(gap closure; blocked on Wave 3 completion)*
- [x] 62-05-PLAN.md — Stale PATCH ordering and same-day refresh without dailySummary
**UI hint**: yes

**Implementation Notes:**
- Use `server/services/meal-transactions.ts` as the authoritative revision check boundary.
- Extend DTO normalization through `client/src/api.ts` and `client/src/store.ts` without relying on client-only stale protection.
- Use `409` deterministic conflict behavior with stable error strings, aligned with existing route conventions.

### Phase 63: SSE Meal-Row Freshness and Affected-Date Invalidation
**Goal**: Users cannot see fresher daily totals beside stale same-day meal rows after realtime summary updates.
**Depends on**: Phase 62
**Requirements**: REAL-01, REAL-02, REAL-03
**Success Criteria** (what must be TRUE):
  1. Same-day `daily_summary` SSE events include enough freshness metadata for the client to refresh or invalidate affected meal rows.
  2. Home/Summary views do not accept newer daily totals while leaving visible same-day meal rows stale without marking or refreshing them.
  3. Malformed or stale-date `daily_summary` events preserve existing guards and do not overwrite current-day rows incorrectly.
  4. Historical affected-date events invalidate the right historical surface without incorrectly refreshing today's rows.
**Plans**: 5 plans
Plans:
**Wave 1**
- [x] 63-01-PLAN.md — Backend initial `daily_summary` envelope and fan-out contract
- [x] 63-03-PLAN.md — Client strict `daily_summary` envelope parsing and date validation

**Wave 2** *(blocked on Wave 1 dependencies)*
- [x] 63-02-PLAN.md — Chat and direct mutation affected-date envelope emission
- [x] 63-04-PLAN.md — Same-day SSE reconcile coordinator and MainLayout race guard

**Wave 3** *(blocked on Wave 2 plan 63-04 completion)*
- [x] 63-05-PLAN.md — Historical visible-surface affected-date refresh
**UI hint**: yes

**Implementation Notes:**
- Preserve `server/routes/chat.ts` SSE ordering invariants around `status`, `chunk`, and `done`.
- Keep `server/realtime/publisher.ts` as fan-out only; add metadata to events rather than DB reads in the publisher.
- Centralize client SSE handling in `client/src/sse.ts` and state commits in `client/src/store.ts`.

### Phase 64: Verification and Release-Proof Hardening
**Goal**: v2.3 integrity behavior has targeted local proof, privacy-preserving evidence, and release-gate closure without staging or main promotion.
**Depends on**: Phase 63
**Requirements**: PROOF-01, PROOF-02, PROOF-03
**Success Criteria** (what must be TRUE):
  1. Targeted unit and integration tests prove goal proposal authority, deterministic failed goal copy, summary-failure committed outcomes, stale receipt rejection, and SSE meal-row freshness.
  2. Any harness or artifact evidence remains metadata-only and excludes raw prompts, user text, assistant final text, tool payloads, provider bodies, image data, session material, and database snapshots.
  3. Local closure runs `yarn tsc --noEmit` and `yarn release:check`.
  4. No staging or main promotion occurs as part of v2.3 roadmap, verification, or release-proof work.
**Plans**: 4 plans
Plans:
**Wave 1**
- [x] 64-01-PLAN.md — Baseline release gate and A/B/C triage record

**Wave 2** *(blocked on Wave 1 completion)*
- [x] 64-02-PLAN.md — PROOF-02 metadata-only sweep and artifact privacy proof

**Wave 3** *(blocked on Wave 2 completion)*
- [x] 64-03-PLAN.md — PROOF-01 evidence coverage and false-pass gap decision

**Wave 4** *(blocked on Wave 3 completion)*
- [ ] 64-04-PLAN.md — Closure TypeScript/release gates and final verification status

**Implementation Notes:**
- Use `nutrition-gen-test` for route/service/orchestrator/store coverage planning and `nutrition-verify-change` for final gate selection.
- Add a focused harness scenario only if unit/integration evidence cannot prove the boundary without false-pass risk.
- Keep Railway smoke and branch promotion out of scope unless a later ship workflow receives explicit approval.

## Progress

**Execution Order:**
Phases execute in numeric order: 60 -> 61 -> 62 -> 63 -> 64

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 59. Authoritative Summary Facts and SSE Proof | v2.2 blocker | 5/5 | Complete | 2026-05-16 |
| 60. Goal Proposal Authority and Rejected-Goal Copy | v2.3 | 3/3 | Complete    | 2026-05-17 |
| 61. Committed Mutation Outcome and Summary Contract | v2.3 | 6/6 | Complete    | 2026-05-17 |
| 62. Meal Revision Tokens and Stale Receipt Protection | v2.3 | 5/5 | Complete   | 2026-05-17 |
| 63. SSE Meal-Row Freshness and Affected-Date Invalidation | v2.3 | 5/5 | Complete    | 2026-05-18 |
| 64. Verification and Release-Proof Hardening | v2.3 | 3/4 | In Progress|  |

## Future Milestone Candidates

- Water tracking from the primary logging flow.
- Monthly nutrition history beyond the current affected-date freshness scope.
- Onboarding animation, motion system, and unrelated visual polish.
- User-flagged semantic failure capture after trigger, retention, privacy, storage, and access-control decisions.
- Local-only raw debugger implementation under the sibling raw debugger contract.
- Metadata-only production trace sampling and aggregate failure metrics.

---
*Last updated: 2026-05-17 after Phase 62 gap-closure execution*
