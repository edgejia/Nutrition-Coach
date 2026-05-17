---
gsd_state_version: 1.0
milestone: v2.3
milestone_name: Authoritative Mutation Outcomes and Fresh Meal State
status: executing
stopped_at: Completed 62-02-PLAN.md
last_updated: "2026-05-17T12:26:59.991Z"
last_activity: 2026-05-17
progress:
  total_phases: 5
  completed_phases: 2
  total_plans: 13
  completed_plans: 11
  percent: 85
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-05-17)

**Core value:** 讓記錄比不記錄還要容易--說一句話、傳一張照片，AI 搞定剩下的。
**Current focus:** Phase 62 — meal-revision-tokens-and-stale-receipt-protection

## Current Position

Phase: 62 (meal-revision-tokens-and-stale-receipt-protection) — EXECUTING
Plan: 3 of 4
Status: Ready to execute
Last activity: 2026-05-17

Progress: [█████████░] 85%

## Performance Metrics

**Velocity:**

- Total plans completed in v2.3: 0
- Average duration: —
- Total execution time: —

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 60 | 3 | - | - |
| 61 | 6 | - | - |
| 62 | TBD | — | — |
| 63 | TBD | — | — |
| 64 | TBD | — | — |
| Phase 60 P01 | 215 | 2 tasks | 4 files |
| Phase 60 P02 | 637s | 3 tasks | 9 files |
| Phase 60 P03 | 535s | 3 tasks | 6 files |
| Phase 61 P01 | 4 min | 2 tasks | 5 files |
| Phase 61 P02 | 4 min | 2 tasks | 5 files |
| Phase 61 P05 | 7 min | 2 tasks | 2 files |
| Phase 61 P03 | 5 min | 2 tasks | 4 files |
| Phase 61 P04 | 5 min | 2 tasks | 4 files |
| Phase 61 P06 | 5 min | 3 tasks | 6 files |
| Phase 62 P01 | 9 min | 2 tasks | 15 files |
| Phase 62 P02 | 5min | 2 tasks | 12 files |

## Accumulated Context

### Decisions

Recent decisions affecting current work:

- [Phase 59]: `yarn release:check` was local closure proof only and did not authorize staging or main promotion.
- [v2.3]: Ambiguous goal confirmation must fail closed unless backed by a valid backend proposal id or explicit current-turn numeric targets.
- [v2.3]: Meal mutation commits are authoritative; summary recompute/publish status is a separate freshness outcome.
- [v2.3]: Stale receipt protection must be server-side via expected meal revision checks, with client refresh/redaction as UX support.
- [v2.3]: Integrity proof remains metadata-only; no raw prompt, user text, assistant final text, tool payload, provider body, image data, session material, or database snapshots.
- [Phase 60]: Use existing turn_states uniqueness and expiry for one active pending goal proposal per device.
- [Phase 60]: Keep proposal, rejection, validation, and cancel copy backend-rendered in mutation-receipts.ts.
- [Phase 60]: Use explicit latest_proposal mode with backend consent and active proposal state rather than assistant prose authority.
- [Phase 60]: Return proposal, authority failure, validation failure, and cancel paths with renderer-owned controlledReply metadata.
- [Phase 60]: Controlled goal replies terminate the orchestrator flow before any later model rewrite.
- [Phase 60]: Fastify chat proof uses metadata-only llm-trace final reply facts for renderer-owned goal failures.
- [Phase 61]: Summary availability is represented by the explicit SummaryOutcome union; update/delete services now return committed facts even when summary recompute is recovered or unavailable.
- [Phase 61]: dailySummary compatibility fields are derived only from dailySummaryFromOutcome(summaryOutcome), and publish failure remains outside summaryOutcome.
- [Phase 61]: Meal log/update/delete mutation effects carry summaryOutcome instead of requiring committedSummary.
- [Phase 61]: Goal mutation effects keep the Phase 60 committedSummary behavior and are not migrated to summaryOutcome.
- [Phase 61]: Plan 05 direct PATCH/DELETE meal route responses expose summaryOutcome as summary freshness while committed mutation facts remain authoritative.
- [Phase 61]: Plan 05 direct route dailySummary compatibility fields are derived only from fresh or recovered summaryOutcome.
- [Phase 61]: log_food now uses the shared buildSummaryOutcomeAfterMealCommit helper instead of a private log-only recovery path. — Keeps all meal mutation families on one post-commit summary availability policy.
- [Phase 61]: OrchestratorResult exposes summaryOutcome for meal log/update/delete receipts while keeping update_goals on the Phase 60 committedSummary path. — Preserves the explicit Phase 61 scope boundary for goal mutations.
- [Phase 61]: Chat JSON and SSE terminal payloads now expose summaryOutcome whenever the orchestrator result includes a committed meal mutation outcome. — Keeps JSON, done, and stopped chat payloads aligned with the Phase 61 public summaryOutcome contract.
- [Phase 61]: Meal correction service now uses composition-root summary and food logging dependencies for shared degraded-summary test hooks. — Enables real Fastify update/delete integration proof for recompute and recovery failure without changing runtime policy.
- [Phase 61]: Malformed client summaryOutcome payloads are omitted instead of thrown through parsing.
- [Phase 61]: No visible degraded-summary UI indicator was added in Phase 61.
- [Phase 61]: Client SummaryOutcome matches the public union and is guarded at the transport boundary.
- [Phase 62]: Direct meal revision conflicts use 409 MEAL_REVISION_REQUIRED / MEAL_REVISION_STALE with mealId, affectedDate, and currentMealRevisionId only.
- [Phase 62]: Transaction-service update/delete writes compare expectedMealRevisionId before inserting meal_revisions; direct route conflict branches return before summary recompute or publish.
- [Phase 62]: Server read and chat receipt DTOs expose public mealRevisionId while keeping internal currentRevisionId hidden.
- [Phase 62]: Restored chat receipts expose edit identity only when the persisted receipt revision is still the current active meal revision.

### Pending Todos

None yet for v2.3.

### Blockers/Concerns

- Phase 64 must not include staging or main promotion without explicit current-thread approval.

## Deferred Items

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| proof_hardening | Phase 58 auth-detail denylist omits `401`, `Unauthorized`, and `invalid_request_error` in user-visible fallback assertions | accepted non-blocking debt | v2.2 close |
| proof_hardening | Phase 58 provider-auth-failure-localization failure evidence can persist the matched forbidden snippet on a failing run | accepted non-blocking debt | v2.2 close |
| dependency_review | High advisories in `drizzle-orm`, `fastify`, and transitive `fast-uri` | defer package upgrade and regression gates | v2.2 close |

## Session Continuity

Last session: 2026-05-17T12:26:25.495Z
Stopped at: Completed 62-02-PLAN.md
Resume file: None
