# Roadmap: Nutrition Coach

## Milestones

- **v2.0 Logging & Mobile Quality Foundation** - shipped 2026-05-07; archived in [`milestones/v2.0/ROADMAP.md`](milestones/v2.0/ROADMAP.md)
- **v2.1 AI Trust Infrastructure & Logging Reliability** - shipped 2026-05-12; archived in [`milestones/v2.1/ROADMAP.md`](milestones/v2.1/ROADMAP.md)
- **v2.2 LLM Failure Localization Foundation** - shipped 2026-05-15; archived in [`milestones/v2.2/ROADMAP.md`](milestones/v2.2/ROADMAP.md)
- **v2.2 Promotion Blocker Reopen** - Phase 59 complete 2026-05-16; no staging/main promotion authorized
- **v2.3 Authoritative Mutation Outcomes and Fresh Meal State** - shipped locally 2026-05-20; archived in [`milestones/v2.3-ROADMAP.md`](milestones/v2.3-ROADMAP.md); no staging/main promotion performed
- **v2.4 Correction Authority and Meal Intent Fidelity** - active; planned from Notion BUG / FEATURE board on 2026-05-26; no staging/main promotion authorized

## Current Status

Active milestone: **v2.4 Correction Authority and Meal Intent Fidelity**.

v2.4 extends the v2.3 authoritative-boundary work into correction safety and meal intent fidelity. The milestone closes the remaining P2 Notion board risks where model-authored estimates or clock-derived heuristics can still influence committed meal facts: numeric chat corrections without explicit evidence, explicit meal-period intent being overwritten by `loggedAt` hour, weak correction candidate ranking, backend clarification rendering gaps, and serialized tool-result parsing.

Planning is based on `feature/v2-4-dev`, which matches `origin/staging` as of 2026-05-26. `origin/staging` is ahead of `origin/main`; staging/main promotion remains outside this roadmap and requires a separate ship workflow with explicit approval.

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

## Active v2.4 Scope

**Phase Numbering:**
- Integer phases continue from the previous milestone: 65, 66, 67, 68.
- Decimal phases are reserved for urgent insertions, if needed later.

- [x] **Phase 65: Tool Contract Alignment and Meal-Period Authority** - Align `log_food` schema/runtime contracts and persist explicit meal-period intent as structured meal fact authority.
- [x] **Phase 66: Numeric Correction Provenance Guard** - Prevent chat corrections from committing model-estimated calories/macros unless backed by explicit user numeric evidence or an approved backend-owned estimate/proposal. (completed 2026-05-28)
- [x] **Phase 67: Correction Targeting and Backend Clarification Rendering** - Improve correction candidate ranking and canonical clarification copy so ambiguous edits surface stable numbered options instead of silently choosing weak targets. (gap-closure plan added 2026-05-29) (completed 2026-05-29)
- [ ] **Phase 68: Structured Tool Results and Release-Proof Gate** - Remove serialized clarification-result parsing, prove v2.4 behavior with targeted tests and metadata-only evidence, and close local release gates.

## Phase Details

### Phase 65: Tool Contract Alignment and Meal-Period Authority
**Goal**: Meal logging tool contracts are internally consistent, and explicit user meal-period intent becomes persisted structured authority instead of display-only wording.
**Depends on**: v2.3 closeout
**Requirements**: TOOL-01, TOOL-02, TOOL-03, INTENT-01, INTENT-02, INTENT-03
**Success Criteria** (what must be TRUE):
  1. `log_food` JSON schema and Zod executor agree on `protein_sources` required/optional behavior, with trusted-protein regressions still green.
  2. A user logging `午餐我吃了雞腿便當` in the morning sees the meal stored and projected as lunch rather than breakfast.
  3. Current-day and historical meal row DTOs expose meal period from persisted structured facts when available.
  4. Correction candidate scoring can use persisted meal-period facts without treating `loggedAt` hour as higher authority than user intent.
**Plans**: 8 plans
Plans:
**Wave 1**
- [x] 65-01-PLAN.md — Persistence and service foundation for explicit meal-period authority.

**Wave 2** *(blocked on Wave 1 completion)*
- [x] 65-02-PLAN.md — Blocking Drizzle migration generation and nullable SQL verification.

**Wave 3** *(blocked on Wave 2 completion)*
- [x] 65-03-PLAN.md — `log_food` contract alignment, prompt update, and source-text period persistence.
- [x] 65-04-PLAN.md — Backend current-day, day snapshot, and history meal row projection.
- [x] 65-08-PLAN.md — Correction candidate effective meal period plus explicit/inferred source handoff.

**Wave 4** *(blocked on Wave 3 completion)*
- [x] 65-05-PLAN.md — Chat JSON/SSE and restored logged-meal receipt projection.

**Wave 5** *(blocked on Wave 4 completion)*
- [x] 65-06-PLAN.md — Client DTO normalization and edit payload preservation.

**Wave 6** *(blocked on Wave 5 completion)*
- [x] 65-07-PLAN.md — UI meal-period label preference on touched meal row surfaces.
**Implementation Notes:**
- Keep changes scoped to existing Fastify/SQLite/orchestrator boundaries.
- Prefer additive persistence/DTO changes that preserve existing `loggedAt` date semantics.
- Use `nutrition-gen-test` for unit/integration coverage and `nutrition-verify-change` for final command selection.

### Phase 66: Numeric Correction Provenance Guard
**Goal**: Users cannot have meal calories or macros changed by model-estimated chat patches unless the current turn supplies explicit numeric evidence or the backend owns an approved estimate/proposal.
**Depends on**: Phase 65
**Requirements**: CORR-01, CORR-02, CORR-03
**Success Criteria** (what must be TRUE):
  1. Explicit numeric correction text such as `蛋白質改成 28g` can update the resolved meal through existing revision checks.
  2. Vague requests such as `蛋白質怪怪的，幫我改合理一點` do not mutate meal calories/macros directly.
  3. Rejected or clarification-required numeric corrections do not create a new meal revision, do not publish `daily_summary`, and do not show success-style text.
  4. Backend-rendered guidance explains the needed numeric input or proposal step in concise Traditional Chinese.
**Plans**: 5 plans
Plans:
**Wave 1**
- [x] 66-01-PLAN.md — Wave 0 meal numeric authority helper and explicit evidence proof.
- [x] 66-02-PLAN.md — Wave 0 backend-owned meal proposal state and renderer copy.
- [x] 66-03-PLAN.md — Tool-boundary update_meal enforcement and proposal creation.

**Wave 2** *(blocked on Wave 1 completion)*
- [x] 66-04-PLAN.md — Pre-model proposal approval, cancel, and cross-kind ambiguity routing.

**Wave 3** *(blocked on Wave 2 completion)*
- [x] 66-05-PLAN.md — Chat integration proof and prompt contract cleanup.
**Implementation Notes:**
- Treat server-side provenance as authoritative; prompts and client UI can support but cannot enforce the boundary alone.
- Keep expected meal revision checks from v2.3 intact.
- If a backend-owned estimator/proposal is introduced, define its approval lifecycle explicitly before allowing commit.

### Phase 67: Correction Targeting and Backend Clarification Rendering
**Goal**: Ambiguous correction requests surface the right candidate set and use stable backend-rendered clarification copy.
**Depends on**: Phase 66
**Requirements**: TARGET-01, TARGET-02
**Success Criteria** (what must be TRUE):
  1. `那餐` / `那筆` style correction requests prefer current-turn and today-recency evidence before older historical candidates.
  2. Explicit food-label evidence outranks weak meal-period-only hints when selecting or narrowing candidates.
  3. Multi-candidate clarification always includes stable numbered options that match the instruction to reply with a number.
  4. Clarification labels use concise meal labels or `餐點`, not the entire user correction request.
**Plans**: 7 plans
Plans:
**Wave 0**
- [x] 67-01-PLAN.md — Red-first validation coverage for resolver ranking and backend-rendered clarification.

**Wave 1** *(blocked on Wave 0 completion)*
- [x] 67-02-PLAN.md — Evidence-tier resolver ranking and exact rendered-option pending selection.

**Wave 2** *(blocked on Wave 1 completion)*
- [x] 67-03-PLAN.md — Backend correction clarification renderer and controlled `find_meals` tool replies.

**Wave 3** *(blocked on Wave 2 completion)*
- [x] 67-04-PLAN.md — Orchestrator terminal renderer wiring and support-only prompt alignment.

**Wave 4** *(blocked on Wave 3 completion)*
- [x] 67-05-PLAN.md — Delayed selection revalidation, stale fail-closed handling, and Fastify route proof.

**Wave 5** *(blocked on Wave 4 completion)*
- [x] 67-06-PLAN.md — Final local validation gates and `67-VALIDATION.md` status update.

**Wave 6** *(blocked on Wave 5 completion)*
- [x] 67-07-PLAN.md — TARGET-01 gap closure for explicit-date candidate loading and residual Latin food-label evidence.
**Implementation Notes:**
- Build on `server/services/meal-correction.ts` candidate scoring and pending selection state.
- Preserve deterministic no-mutation behavior for unresolved targets.
- Add route-level integration coverage with real SQLite and `MockLLMProvider`.

### Phase 68: Structured Tool Results and Release-Proof Gate
**Goal**: Tool clarification results flow through structured orchestrator fields, and v2.4 closes with targeted local proof plus metadata-only artifact discipline.
**Depends on**: Phase 67
**Requirements**: TARGET-03, PROOF-01, PROOF-02, PROOF-03
**Success Criteria** (what must be TRUE):
  1. `find_meals`, historical `log_food`, and historical `get_daily_summary` clarification paths no longer require reparsing serialized tool-message JSON in the orchestrator.
  2. Targeted tests cover tool schema alignment, explicit meal-period logging, numeric correction authority, target ranking, clarification rendering, and structured tool-result plumbing.
  3. Any generated harness or proof artifacts remain metadata-only and exclude raw sensitive payloads.
  4. Local closure runs `yarn tsc --noEmit` and `yarn release:check` with no staging or main promotion.
**Plans**: 4 plans
Plans:
**Wave 1**
- [ ] 68-01-PLAN.md — Red-first unit proof for typed clarification facts and terminal renderer behavior.

**Wave 2** *(blocked on Wave 1 completion)*
- [ ] 68-02-PLAN.md — Structured `ToolExecutionResult` clarification union, renderer helpers, and `executeTool()` mapping.

**Wave 3** *(blocked on Wave 2 completion)*
- [ ] 68-03-PLAN.md — JSON/SSE terminal clarification persistence, no-side-effect, and carry-forward integration proof.

**Wave 4** *(blocked on Wave 3 completion)*
- [ ] 68-04-PLAN.md — Metadata-only verification record and local release-proof closure gates.
**Implementation Notes:**
- Prefer typed `ToolExecutionResult` fields over ad hoc parsing.
- Add harness coverage only if unit/integration tests cannot prove a boundary without false-pass risk.
- Keep Railway smoke and branch promotion out of scope unless a later ship workflow receives explicit approval.

## Progress

**Execution Order:**
Phases execute in numeric order: 65 -> 66 -> 67 -> 68.

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 65. Tool Contract Alignment and Meal-Period Authority | v2.4 | 8/8 | Complete    | 2026-05-27 |
| 66. Numeric Correction Provenance Guard | v2.4 | 5/5 | Complete    | 2026-05-28 |
| 67. Correction Targeting and Backend Clarification Rendering | v2.4 | 7/7 | Complete    | 2026-05-29 |
| 68. Structured Tool Results and Release-Proof Gate | v2.4 | 0/4 | Pending | — |

## Future Milestone Candidates

- Water tracking from the primary logging flow.
- Monthly nutrition history beyond the current affected-date freshness scope.
- Onboarding animation, motion system, and unrelated visual polish.
- User-flagged semantic failure capture after trigger, retention, privacy, storage, and access-control decisions.
- Local-only raw debugger implementation under the sibling raw debugger contract.
- Metadata-only production trace sampling and aggregate failure metrics.
- Richer Markdown/coaching copy after correction authority is safe.
- Broader Meal Edit grouped-item and item-photo workflows.

---
*Last updated: 2026-05-26 after v2.4 milestone initialization*
