---
gsd_state_version: 1.0
milestone: v2.4
milestone_name: Correction Authority and Meal Intent Fidelity
status: planning
last_updated: "2026-05-28T18:51:18.574Z"
last_activity: 2026-05-29
progress:
  total_phases: 4
  completed_phases: 2
  total_plans: 13
  completed_plans: 13
  percent: 50
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-05-26)

**Core value:** 讓記錄比不記錄還要容易--說一句話、傳一張照片，AI 搞定剩下的。
**Current focus:** Phase 67 — correction targeting and backend clarification rendering

## Current Position

Phase: 67
Plan: Not started
Status: Ready to plan
Last activity: 2026-05-29

## Performance Metrics

**Velocity:**

- Total plans completed in v2.3: 23
- Average duration: —
- Total execution time: —

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 60 | 3 | - | - |
| 61 | 6 | - | - |
| 62 | 5/5 | — | — |
| 63 | 5 | - | - |
| 64 | 4 | - | - |
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
| Phase 62 P03 | 7 min | 2 tasks | 6 files |
| Phase 62 P04 | 8m 39s | 3 tasks | 12 files |
| Phase 62 P05 | 4m 14s | 3 tasks | 8 files |
| Phase 63 P01 | 4 min | 2 tasks | 4 files |
| Phase 63 P03 | 3m 21s | 2 tasks | 6 files |
| Phase 63 P02 | 7min | 3 tasks | 8 files |
| Phase 63 P04 | 5m 17s | 3 tasks | 6 files |
| Phase 63 P05 | 2m 43s | 3 tasks | 4 files |
| Phase 64 P01 | 2 min | 2 tasks | 1 files |
| Phase 64 P02 | 4 min | 2 tasks | 4 files |
| Phase 64 P03 | 18 min | 2 tasks | 2 files |
| Phase 64 P04 | 3 min | 2 tasks | 2 files |
| Phase 65 P01 | 8min | 2 tasks | 12 files |
| Phase 65 P02 | 3min | 1 task | 5 files |
| Phase 65 P03 | 8min | 2 tasks | 6 files |
| Phase 65 P04 | 5min | 2 tasks | 7 files |
| Phase 65 P08 | 2m 41s | 1 task | 3 files |
| Phase 65 P05 | 9min | 2 tasks | 4 files |
| Phase 65 P06 | 6m 49s | 2 tasks | 5 files |
| Phase 65 P07 | 4m 44s | 2 tasks | 7 files |
| 65 | 8 | - | - |
| Phase 66 P01 | 4m 50s | 2 tasks | 4 files |
| Phase 66 P02 | 4m 49s | 2 tasks | 4 files |
| Phase 66 P03 | 902 | 2 tasks | 9 files |
| Phase 66 P04 | 8m 05s | 2 tasks | 5 files |
| Phase 66 P05 | 8m | 3 tasks | 4 files |
| 66 | 5 | - | - |

## Accumulated Context

### Decisions

Recent decisions affecting current work:

- [Phase 65 Plan 01]: Persist explicit meal period as nullable `meal_transactions.meal_period`, separate from `loggedAt`.
- [Phase 65 Plan 01]: Only direct source-text meal-category words can become explicit meal-period authority.
- [Phase 65 Plan 02]: Keep 0007 additive and nullable even though Drizzle's table-level check generation would rebuild meal_transactions.
- [Phase 65 Plan 02]: Represent the enum constraint in Drizzle schema metadata while using safe column-level SQLite CHECK SQL for the migration.
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
- [Phase 62]: Chat correction tools use resolver-owned resolvedMealTargets objects containing mealId and mealRevisionId; id-only resolved state is rejected.
- [Phase 62]: Meal correction update/delete services no longer synthesize current expected revisions when callers omit expectedMealRevisionId.
- [Phase 62]: 62-04: Client write inputs send expectedMealRevisionId derived from MealEditPayload.mealRevisionId.
- [Phase 62]: 62-04: Receipts without mealRevisionId remain display-only because incomplete edit identity fails closed.
- [Phase 62]: 62-04: Client stale recovery is UX support only; server 409 revision precondition checks remain authoritative.
- [Phase 62]: 62-05: Direct PATCH checks expected revision freshness before grouped item-count rejection.
- [Phase 62]: 62-05: Meal Edit post-commit row refresh is keyed by affectedDate while dailySummary updates remain same-day only.
- [Phase 63]: Plan 01 initial /api/sse daily_summary frames use the strict envelope with affectedDate derived from summary.date.
- [Phase 63]: Plan 01 RealtimePublisher remains fan-out only and temporarily accepts raw DailySummary payloads until mutation publishers migrate in 63-02.
- [Phase 63]: Plan 03 client daily_summary SSE parsing accepts only the strict summary/affectedDate/source envelope.
- [Phase 63]: Plan 03 future calendar-real daily_summary dates pass transport validation and remain coordinator policy.
- [Phase 63]: Plan 03 legacy onSummary remains a nested-summary fallback until MainLayout migrates to the envelope-aware coordinator.
- [Phase 63]: Plan 02 meal mutation routes publish strict affected-date daily_summary envelopes and historical mutation summaries are no longer suppressed by today-only gates.
- [Phase 63]: Plan 02 chat same-day mutation publish derives affectedDate from dailySummary.date when current-day log_food omits explicit affectedDate.
- [Phase 63]: Plan 04 routes MainLayout daily_summary SSE through createSSESummaryCoordinator instead of raw setDailySummary callbacks.
- [Phase 63]: Plan 04 uses one latest-token coordinator guard for same-day SSE reconcile and initial meal row loads.
- [Phase 63]: Plan 05: Day Detail observes lastMealMutation and refetches only when affectedDate exactly matches dateKey.
- [Phase 63]: Plan 05: Historical visible refreshes use getHistoryDaySnapshot and latest-token suppression; pushed historical summaries are not consumed as surface data.
- [Phase 64]: Baseline `yarn release:check` passed and left A/B/C triage empty at baseline.
- [Phase 64]: `64-deferred-items.md` remains uncreated because no routine Bucket C item appeared.
- [Phase 64]: PROOF-03 is not claimed closed by 64-01; closure remains owned by the later Phase 64 closure gate.
- [Phase 64]: PROOF-02 sweep runs before PROOF-01 behavior-test expansion and records metadata only.
- [Phase 64]: Database snapshot evidence in generated artifacts is a blocker; remediation fixed the producer and regenerated affected artifacts.
- [Phase 64]: Markdown tables are sufficient for PROOF-02, so no default machine-readable JSON report was created.
- [Phase 64]: Existing unit/integration evidence closes all five PROOF-01 behavior families under D-05b.
- [Phase 64]: No new PROOF-01 behavior tests were added because no evidence-backed false-pass risk was found.
- [Phase 64]: No harness scenario was created, updated, or cited because no D-34 trigger appeared.
- [Phase 64]: Closure yarn tsc --noEmit passed. — Plan 64-04 closure gate completed successfully.
- [Phase 64]: Closure yarn release:check passed, so no Bucket C exception approval was required. — Plan 64-04 closure release gate was green.
- [Phase 64]: PROOF-03 is satisfied by green local closure gates with no staging or main promotion. — Final verification status links PROOF-03 green to passing local gates only.
- [Phase 65]: protein_sources is optional parse-time evidence in both JSON schema and Zod runtime. — Plan 65-03 aligned the LLM-facing tool contract with runtime validation while preserving backend trusted-protein normalization.
- [Phase 65]: log_food persists mealPeriod only from explicit source text, while raw meal_period remains historical loggedAt evidence. — Plan 65-03 kept raw model meal_period out of persisted authority and used source-text extraction for mealPeriod.
- [Phase 65]: Backend meal row APIs project public mealPeriod only from persisted explicit enum values. — Plan 65-04 omits the field for legacy/no-authority rows instead of deriving from loggedAt.
- [Phase 65]: History routes stay pass-through while history-query owns mealPeriod selection, normalization, and DTO projection. — Plan 65-04 kept route behavior unchanged and updated the service DTO boundary.
- [Phase 65]: Chat JSON/SSE receipts project mealPeriod only from backend loggedMeal authority after enum normalization. — Plan 65-05 keeps public receipt period authority explicit-only and rejects fabricated inferredMealPeriod fields.
- [Phase 65]: Restored chat receipts expose mealPeriod as a display-safe fact even when stale receipts omit edit identity. — Plan 65-05 preserves Phase 62 stale receipt edit protection while allowing structured display facts to restore.
- [Phase 65]: Correction candidates keep mealPeriod as the effective compatibility field and add mealPeriodSource for provenance. — Plan 65-08 completed the INTENT-03 handoff without changing Phase 67 ranking policy.
- [Phase 65]: Explicit persisted mealPeriod is selected from meal_transactions and normalized before falling back to loggedAt inference. — Legacy/no-authority candidates remain available as inferred fallback facts.
- [Phase 65]: Client mealPeriod is an exact four-value public enum; invalid transport values are omitted instead of coerced to fallback labels. — Plan 65-06 preserves explicit backend authority and avoids fabricating fallback mealPeriod values.
- [Phase 65]: Edit payload builders preserve explicit mealPeriod from source DTOs only; loggedAt fallback inference remains display-only and is not serialized as authority. — D-20/D-21 require edit state preservation without manufacturing new period authority.
- [Phase 65]: UI meal-period labels resolve explicit mealPeriod before loggedAt fallback on Home, History, Day Detail, and Summary Detail rows. — Plan 65-07 keeps fallback display-only for legacy/no-authority meals.
- [Phase 66 Plan 01]: Meal numeric direct-write authority is current user text only; previous assistant prose is not accepted by the helper API.
- [Phase 66 Plan 01]: items[] replacement numeric values are diffed against current persisted items and checked with the same field-level evidence as top-level patches.
- [Phase 66]: Plan 02: Meal numeric correction proposals use a distinct meal_numeric_correction_proposal turn-state kind, so meal proposals replace only same-kind meal proposals and can coexist with goal proposals.
- [Phase 66]: Plan 02: Meal numeric proposal payloads carry exactly one backend-computed update shape: either updateInput or items, plus meal id, expected revision, affected before/after fields, operator, createdAt, and expiresAt.
- [Phase 66]: update_meal loads persisted meal facts and authorizes only changed numeric values before writes. — Recorded by Phase 66 Plan 03 summary.
- [Phase 66]: propose_meal_numeric_correction accepts field/operator intent only; backend code computes proposal values from persisted facts. — Recorded by Phase 66 Plan 03 summary.
- [Phase 66]: Success-path chat fixtures now include explicit current-turn numeric evidence because model-estimated meal numbers are blocked. — Recorded by Phase 66 Plan 03 summary.
- [Phase 66 Plan 04]: Bare approval fails closed when active goal and meal proposal kinds coexist.
- [Phase 66 Plan 04]: Meal proposal approval commits only stored backend proposal values through mealCorrectionService.updateMeal with expectedMealRevisionId.
- [Phase 66 Plan 04]: Explicit goal-kind approval reuses the existing update_goals latest_proposal path while leaving active meal proposal state untouched.
- [Phase 66]: Plan 05: Meal correction prompt guidance now routes explicit final numbers and computable operators only; backend validation/proposal state remain authoritative.
- [Phase 66]: Plan 05: Route-level correction proof treats backend-rendered no-update copy and no daily_summary publish as the observable authority boundary.

### Pending Todos

None yet for v2.4.

### Quick Tasks Completed

| Date | Quick Task | Summary |
|------|------------|---------|
| 2026-05-20 | 260520-tqd update_goals post-commit outcome asymmetry | Closed CR-01 by preserving committed goal receipts when post-commit cleanup, `goals_update` publish, or summary lookup fails. |

### Blockers/Concerns

- No current v2.4 planning blockers. Staging/main promotion still requires a separate ship workflow and explicit current-thread approval.

## Deferred Items

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| proof_hardening | Phase 58 auth-detail denylist omits `401`, `Unauthorized`, and `invalid_request_error` in user-visible fallback assertions | accepted non-blocking debt | v2.2 close |
| proof_hardening | Phase 58 provider-auth-failure-localization failure evidence can persist the matched forbidden snippet on a failing run | accepted non-blocking debt | v2.2 close |
| dependency_review | High advisories in `drizzle-orm`, `fastify`, and transitive `fast-uri` | defer package upgrade and regression gates | v2.2 close |
| mutation_outcome | CR-01: committed goal updates can still become failed chat outcomes if post-commit `goals_update` publish or summary lookup throws; Phase 61 left `update_goals` outside the public `summaryOutcome` contract | closed by quick 260520-tqd | v2.3 audit |
| tool_schema | WR-01: `log_food` JSON schema still marks `protein_sources` as required while the Zod/executor contract accepts it as optional | planned in Phase 65 | v2.4 |
| correction_authority | Vague numeric meal corrections can be committed from model estimates without explicit user numeric evidence | planned in Phase 66 | v2.4 |
| meal_intent | Explicit meal-period text can be overridden by `loggedAt` hour heuristics | planned in Phase 65 | v2.4 |
| correction_targeting | Ambiguous correction candidates and clarification copy can be weak or misleading | planned in Phase 67 | v2.4 |

## Session Continuity

Last session: 2026-05-28T18:37:30.680Z
Stopped at: Phase 67 context gathered
Resume file: .planning/phases/67-correction-targeting-and-backend-clarification-rendering/67-CONTEXT.md

## Operator Next Steps

- Run `$gsd-plan-phase 67` to plan correction targeting and backend clarification rendering.
