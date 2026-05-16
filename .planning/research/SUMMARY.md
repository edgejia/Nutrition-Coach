# v2.3 Research Summary

**Project:** Nutrition Coach
**Milestone:** v2.3 Authoritative Mutation Outcomes and Fresh Meal State
**Researched:** 2026-05-17
**Overall confidence:** HIGH for the repo-specific direction; MEDIUM for exact phase sizing until implementation confirms test and contract blast radius.

## 1. Executive Summary

v2.3 is a focused P1 data-integrity milestone for a chat-first nutrition logger. The product already has the right core shape: Fastify route boundaries, SQLite transaction/revision state, orchestrator tool contracts, deterministic mutation receipt rendering, process-local SSE, and Zustand as the client state boundary. The research conclusion is to close trust gaps inside those existing seams, not to add new infrastructure or broaden product scope.

The recommended approach is to make the backend the authority for every mutation outcome. Ambiguous goal confirmation must resolve to a structured pending proposal or explicit current-turn numeric values. Failed `update_goals` validation/guard outcomes must render backend-owned failure copy. Meal log/update/delete must report committed facts even if daily summary recompute fails. Stale receipt edits must be rejected by server-side revision checks. `daily_summary` SSE must refresh or invalidate meal rows so totals and visible rows cannot diverge.

The main risk is allowing three authorities to disagree: database mutation state, daily summary state, and assistant-visible copy. Mitigation is a phase order that first eliminates goal false-success paths, then creates a shared committed-outcome/summary-outcome contract, then uses that contract for stale receipt protection and realtime freshness. Keep all observability metadata-only; do not store raw user text, assistant prose, tool payloads, meal snapshots, or final reply text in routine logs/traces.

## 2. Stack Additions / No-Adds

No new runtime dependencies are recommended.

Keep:
- **Fastify 5 routes** for HTTP/SSE ownership, request validation, auth/session resolution, response shaping, and terminal SSE ordering.
- **SQLite + better-sqlite3 + Drizzle** for existing `turn_states`, meal transaction/revision state, chat receipts, and deterministic test fixtures.
- **Zod 4 and handwritten tool schemas** for validation. Extend existing `runContract`/tool guards rather than introducing another validator.
- **Orchestrator receipt rendering** in `server/orchestrator/mutation-receipts.ts` or a close sibling for deterministic success, proposal, and failure copy.
- **RealtimePublisher + EventSource** for current process-local fan-out. Add freshness metadata; do not introduce WebSockets, Redis, queues, or brokers.
- **React 19 + Zustand 5** for frontend state. Keep `client/src/store.ts` as the only client write boundary.
- **Node `node:test` + real SQLite** for unit/integration proof. Do not add Jest/Vitest.

Internal additions:
- `server/services/goal-proposals.ts`: typed wrapper over `turn_states` for `pending_goal_proposal` with proposal id, concrete targets, proposed fields, owner device, source metadata, TTL, and consumed/expired behavior.
- `server/services/summary-outcome.ts`: shared helper that separates committed mutation facts from summary recompute/recovery status.
- DTO extensions for `mealRevisionId`, `expectedMealRevisionId`, `summaryOutcome`, and `DailySummaryEvent` invalidation metadata.

## 3. Feature Table Stakes

Must-have v2.3 behavior:
- **Fail-closed ambiguous goal confirmation:** `好`, `可以`, `ok`, and similar confirmations cannot update goals unless the backend resolves them to a valid pending proposal id. No previous assistant prose may authorize mutation.
- **Proposal-backed goal recommendation lifecycle:** vague goal-change intent can create a backend-owned pending proposal with concrete full targets and changed fields, but it does not mutate until valid confirmation.
- **Explicit numeric update path remains:** current-turn numeric values such as calories/protein/carbs/fat can still update immediately if they pass source-text and range validation.
- **Backend-owned goal failure copy:** validation/guard/proposal failures return deterministic Traditional Chinese copy, no `goals_update`, no `dailyTargets`, and no success-style language.
- **Renderer-owned committed receipts:** success copy for log/update/delete/goals comes from committed facts, not final model prose.
- **Post-commit summary failure parity:** log, chat update/delete, and direct meal PATCH/DELETE report committed mutation facts even when summary recompute fails.
- **Stale receipt PATCH conflict:** edit payloads carry expected meal revision; stale writes return deterministic conflict and do not mutate.
- **SSE meal-row freshness:** valid same-day `daily_summary` events refresh or invalidate today meal rows alongside summary totals.

Explicitly defer:
- Water tracking, monthly history, onboarding animation, motion system, visual polish, raw forensic capture, production-accessible snapshots, and any staging/main promotion work.

## 4. Architecture Direction

Preserve current ownership boundaries:
- `server/routes/*.ts`: transport contracts, cookie-backed ownership, SSE framing, response DTOs, and deterministic route errors.
- `server/services/meal-transactions.ts`: authoritative meal transaction/revision writes and stale revision rejection.
- `server/services/summary.ts` plus new `summary-outcome.ts`: summary recompute as post-commit read concern, not mutation authority.
- `server/services/turn-state.ts` plus new `goal-proposals.ts`: short-lived structured cross-turn proposal state.
- `server/orchestrator/tools.ts` and `tool-contract.ts`: structured tool validation/guard/execute outcomes.
- `server/orchestrator/mutation-receipts.ts`: deterministic user-visible success/failure/proposal copy.
- `server/realtime/publisher.ts`: fan-out only; no DB reads.
- `client/src/api.ts`, `client/src/sse.ts`, `client/src/store.ts`: normalize DTOs, parse SSE safely, and commit state atomically.

Key data-flow rules:
- `update_goals` has exactly two accepted modes: explicit current-turn numeric targets, or `{ proposal_id }` validated and consumed by backend proposal state.
- Failed `update_goals` outcomes return immediately from the orchestrator with renderer-owned copy. Do not run another model round for final visible copy.
- Meal mutation order is validate -> commit SQLite write -> build committed facts -> attempt summary recompute/recovery -> render receipt -> publish realtime only if summary exists and applies -> return committed outcome.
- Meal PATCH must compare `expectedMealRevisionId` against `meal_transactions.current_revision_id` before inserting a new revision.
- `daily_summary` SSE for today is an invalidation signal. Client should fetch meals with `refreshReason: "meal_mutation"` or mark rows stale before treating totals as fresh.

## 5. Key Pitfalls

1. **Ambiguous `好` mutates from assistant prose.** Prevent by requiring explicit current-turn numbers or a persisted backend proposal id; never parse previous assistant text as authority.
2. **Failed goal guard/validation gets model-authored success copy.** Prevent by short-circuiting failed `update_goals` outcomes to deterministic renderer copy with `finalReplySource: "renderer"` or equivalent.
3. **Summary recompute failure masks committed meal writes.** Prevent by splitting committed mutation facts from summary outcome and making recompute/publish failures non-fatal after commit.
4. **Old chat receipt overwrites newer meal facts.** Prevent with server-side expected revision checks and deterministic 409/412 conflict behavior; client redaction is UX support, not security.
5. **SSE totals update without row freshness.** Prevent by treating same-day `daily_summary` as meal-row invalidation and committing meals+summary together after refresh.
6. **Historical changes refresh the wrong surface.** Preserve affected-date semantics: today changes refresh Home/Summary rows; historical changes invalidate History/Day Detail.
7. **Privacy regression in new proof/logging.** Store proposal and outcome metadata only; do not log raw text, tool args, meal names, target numbers, final assistant text, provider bodies, session material, or DB snapshots.

## 6. Recommended Requirement Categories

Use these categories when turning research into requirements:

- **GOAL: Authoritative goal proposal and update outcomes**
  - Structured pending goal proposals in `turn_states`.
  - `update_goals` accepts only explicit current-turn numeric values or valid proposal id.
  - deterministic failed goal-update copy.
  - no `goals_update` or target persistence on rejected outcomes.

- **MUTATION: Committed facts independent of summary freshness**
  - shared `SummaryOutcome` helper.
  - log/update/delete/direct route parity.
  - mutation receipts rendered from committed facts.
  - summary recompute/publish failure classified separately from mutation failure.

- **FRESHNESS: Meal revision concurrency and stale receipt protection**
  - `mealRevisionId` exposed in current meal/receipt DTOs.
  - `expectedMealRevisionId` required for edit-capable PATCH flows.
  - stale write conflict copy and client refresh/redaction behavior.

- **REALTIME: SSE summary and meal-row consistency**
  - richer `DailySummaryEvent` metadata such as `mealRowsInvalidated`.
  - valid same-day summary events refresh or invalidate rows.
  - malformed/stale-date summaries remain ignored or routed to existing rollover handling.

- **OBSERVABILITY/PRIVACY: Metadata-only integrity proof**
  - explicit classifications such as `goal_update_rejected`, `mutation_committed_summary_failed`, and `stale_receipt_rejected`.
  - no raw payloads or user-visible final text in routine traces/artifacts.

## 7. Recommended Phase Order

### Phase 1: Goal proposal authority and deterministic rejected-goal copy

**Rationale:** Features and pitfalls identify false goal success as the highest trust risk. This work is mostly bounded to `turn_states`, tool contracts, orchestrator flow, receipt/failure rendering, and goal-update tests. It does not depend on the meal summary/revision primitives.

**Delivers:** pending goal proposals, fail-closed `好`, explicit numeric path preservation, deterministic failed `update_goals` copy, and `goals_update` only after committed target changes.

**Avoids:** ambiguous confirmation mutation, stale proposal reuse, and model-authored success-style copy after rejection.

### Phase 2: Committed mutation outcome and summary-outcome contract

**Rationale:** Architecture recommends outcome-first primitives, and this is the right second phase once goal false-success is closed. Stale receipt and SSE freshness both need a trustworthy distinction between committed mutation facts and summary freshness.

**Delivers:** `summary-outcome.ts`, recovered/degraded summary status, committed log/update/delete/direct route receipts after summary failure, metadata-only classification of post-commit summary failures.

**Avoids:** generic failures after committed writes, duplicate retries, mandatory `committedSummary` coupling, and false `didMutateMeal:false`.

### Phase 3: Meal revision tokens and stale receipt write protection

**Rationale:** This resolves the architecture suggestion to start from revision identity, but places it after the shared outcome model so conflict and success responses have a stable contract. The first task in this phase should still be the low-level revision token plumbing.

**Delivers:** `mealRevisionId` in meal/receipt DTOs, `expectedMealRevisionId` in PATCH input, transaction-service conflict checks, deterministic stale conflict copy, client refresh/redaction after conflict.

**Avoids:** older chat bubbles or tabs overwriting newer meal state.

### Phase 4: SSE meal-row freshness and affected-date invalidation

**Rationale:** Realtime freshness is safest after committed outcomes and stale write rules are stable. This phase is client/store/SSE heavy and must preserve existing ordering invariants in `server/routes/chat.ts`.

**Delivers:** `DailySummaryEvent` invalidation metadata, safe SSE parsing, store action for atomic meals+summary commit or stale marker, current-day row refresh, historical affected-date invalidation.

**Avoids:** Home/Summary totals diverging from visible rows and historical changes refreshing today's surface.

### Phase 5: Verification and release-proof hardening

**Rationale:** Durable harness evidence should come after contracts settle. Do not create broad proof artifacts before the lower-level behavior is stable.

**Delivers:** targeted unit/integration/SSE/store coverage, optional focused harness if integration proof is insufficient, privacy assertions for metadata-only artifacts, final `yarn release:check`.

**Avoids:** false proof, privacy drift, and release gate gaps.

**Research flags:**
- Phase 1 needs careful implementation research in current orchestrator/tool-contract tests because failure copy must bypass a second model round.
- Phase 2 needs focused codebase research before edits because summary handling is duplicated across chat tools, meal correction, and routes.
- Phase 4 needs targeted client/SSE research because ordering and cross-tab behavior are subtle.
- Phase 3 uses well-documented local patterns: existing meal revisions, receipt projection, Fastify route validation, and Zustand/API DTO normalization.

## 8. Verification Strategy

Minimum gates:
- Any TypeScript edit: `yarn tsc --noEmit`.
- Route or service changes: `yarn test:integration`.
- Client store/API/SSE changes: `yarn test:unit`.
- Before promotion only, with explicit approval later: `yarn release:check`.

Targeted tests to plan:
- `tests/integration/chat-goal-update.integration.test.ts`: vague request creates proposal without mutation; `好` mutates only with active proposal; no-proposal/expired/consumed/mismatched confirmation rejects; explicit numeric update still passes.
- `tests/integration/chat-goal-update.integration.test.ts` and `tests/integration/orchestrator.test.ts`: failed `update_goals` validation/guard returns backend copy, no target mutation, no `goals_update`, no success phrase.
- `tests/unit/tools.test.ts`, `tests/integration/chat-api.test.ts`, `tests/integration/chat-streaming.test.ts`, `tests/integration/meals-api.test.ts`: summary recompute failure after log/update/delete/PATCH/DELETE still returns committed facts and DB state changed.
- `tests/integration/meals-api.test.ts`: matching expected revision succeeds; stale expected revision returns 409/412 and does not create a newer revision.
- `tests/unit/store.test.ts`, `tests/unit/api-client.test.ts`, `tests/integration/sse.test.ts`: daily summary invalidation refreshes or marks rows stale, malformed payloads are ignored, stale-date guards remain intact, and historical changes do not overwrite current-day rows.
- Harness proof only if needed: reuse `text-log` or add a focused `fresh-meal-state` scenario, keeping artifacts metadata-only and avoiding raw SSE transcript/final assistant text.

Confidence by area:

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All research points to extending existing repo stack; no dependency gap identified. |
| Features | HIGH | Requirements align with `.planning/PROJECT.md` active v2.3 scope and Notion-derived P1 risks. |
| Architecture | HIGH | Existing boundaries map cleanly to each requirement; proposed modules are thin wrappers/helpers. |
| Pitfalls | HIGH | Failure modes are repo-specific and backed by current route/orchestrator/client patterns. |
| Phase sizing | MEDIUM | Exact split may shift once duplicated summary paths and SSE client tests are touched. |

Gaps to validate during planning:
- Whether one active `pending_goal_proposal` per device is sufficient, or whether multiple proposals must be disambiguated explicitly. Default recommendation: one active proposal, atomically replace older proposal.
- Whether stale delete should require `expectedMealRevisionId` in addition to PATCH. Default recommendation: protect delete with the same revision contract if delete can originate from stale receipt state.
- Whether failed summary recovery can always reconstruct enough receipt facts from persisted meals. Default recommendation: return committed facts plus `summaryOutcome.status: "failed"` if recovery also fails.

Sources synthesized:
- `.planning/research/STACK.md`
- `.planning/research/FEATURES.md`
- `.planning/research/ARCHITECTURE.md`
- `.planning/research/PITFALLS.md`
- `.planning/PROJECT.md`

---
*Research completed: 2026-05-17*
*Ready for requirements: yes*
