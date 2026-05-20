---
phase: 60-goal-proposal-authority-and-rejected-goal-copy
plan: 03
subsystem: backend
tags: [typescript, orchestrator, fastify, sqlite, goal-proposals, llm-trace, node-test]

requires:
  - phase: 60
    plan: 02
    provides: "propose_goals, explicit update_goals modes, and controlledReply tool metadata"
provides:
  - "Renderer-owned orchestrator short-circuit for goal proposal, validation, authority failure, and cancel replies"
  - "Pre-LLM active proposal cancel handling through shared cancel predicate"
  - "Fastify chat integration proof for proposal creation, confirmation, replay failure, missing proposal, cancel, validation, and no-publish invariants"
  - "Metadata-only llm-trace proof for renderer-owned rejected goal final replies"
affects: [phase-60, goal-authority, chat-route, llm-trace, integration-tests]

tech-stack:
  added: []
  patterns:
    - "ToolExecutionResult.controlledReply returns before second model round"
    - "Pre-LLM cancel preflight clears only active proposals using shared predicate"
    - "Fastify buildApp onServicesReady publisher spy for goals_update no-publish proof"

key-files:
  created:
    - .planning/phases/60-goal-proposal-authority-and-rejected-goal-copy/60-03-SUMMARY.md
  modified:
    - server/orchestrator/index.ts
    - tests/unit/orchestrator.test.ts
    - tests/integration/chat-goal-update.integration.test.ts
    - tests/integration/chat-streaming.test.ts
    - tests/integration/orchestrator.test.ts
    - tests/integration/sse.test.ts

key-decisions:
  - "Controlled goal replies are terminal renderer-owned final replies, not tool messages for later model prose."
  - "Explicit cancel terms are handled before LLM completion only when an active pending proposal exists."
  - "Existing integration fixtures must use explicit update_goals modes after Phase 60; bare args are now invalid."

patterns-established:
  - "Goal proposal/rejection/cancel tests assert finalReplySource renderer, plain_text shape, and no second LLM call."
  - "Chat integration proof spies on RealtimePublisher.publishGoalsUpdate through buildApp service hooks."
  - "Route trace proof uses llmTraceRecorderFactory and asserts metadata-only finalReply facts."

requirements-completed: [GOAL-01, GOAL-02, GOAL-03, GOAL-04]

duration: 8min55s
completed: 2026-05-17T00:35:31Z
---

# Phase 60 Plan 03: Orchestrator Short-Circuiting and Integration Proof Summary

Renderer-owned goal proposal, rejection, validation, and cancel replies now terminate the chat flow before model rewrite, with Fastify no-publish and metadata trace proof.

## Performance

| Metric | Value |
|--------|-------|
| Started | 2026-05-17T00:26:36Z |
| Completed | 2026-05-17T00:35:31Z |
| Duration | 8min55s |
| Tasks | 3/3 |
| Files Modified | 6 |
| Requirements | GOAL-01, GOAL-02, GOAL-03, GOAL-04 |

## What Changed

- Added a controlled-reply terminal path in `server/orchestrator/index.ts` so `propose_goals`, validation failures, rejected confirmations, and missing proposal failures return renderer copy without a second LLM pass.
- Added a pre-LLM cancel preflight using the shared cancel predicate, limited to turns with an active pending proposal.
- Rewrote chat goal integration coverage around explicit `update_goals` modes, active proposal confirmation, replay failure, missing proposal failure, cancel, validation failure, and no-publish/no-mutation invariants.
- Added route-level llm-trace proof that rejected-goal final replies record only metadata facts, not raw user text, renderer copy, proposal JSON, model text, cookies, or provider/database details.
- Updated stale integration fixtures to use explicit `update_goals` modes and the Phase 60 goal proposal service dependency.

## Task Commits

| Task | Commit | Type | Summary |
|------|--------|------|---------|
| 1 RED | eedb5ba | test | Added failing controlled goal reply unit tests. |
| 1 GREEN | a8e857d | feat | Implemented orchestrator controlled-reply short-circuiting and cancel preflight. |
| 2 RED | 20ccee9 | test | Added failing Fastify chat authority and no-publish integration tests. |
| 2 GREEN | 2aaed7f | fix | Marked successful goal updates as mutations in response metadata. |
| 3 | 341ab4c | test | Added metadata-only llm-trace proof for renderer final replies. |
| 3 fixture fix | b4a3ff5 | fix | Updated stale integration fixtures for explicit goal modes and proposal service DI. |

## Decisions Made

- Controlled goal replies are final renderer-owned assistant replies. The orchestrator returns them directly instead of appending tool output and asking the model to rewrite user-facing copy.
- Explicit cancel language is handled before LLM completion only when a pending active proposal exists, preventing normal chat turns from being swallowed by cancel detection.
- Phase 60 fixture code now treats bare `update_goals` arguments as invalid. Tests that intend direct mutation must pass `mode: "current_turn_values"`.
- Renderer metadata in `llm-trace.json` is intentionally limited to source, shape, and structured fields; the final copy and proposal payload remain outside the trace artifact.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Goal update success did not set mutation metadata**
- **Found during:** Task 2 GREEN verification
- **Issue:** The chat response mutated persisted targets but returned `didMutateMeal: false`.
- **Fix:** Set `didMutateMeal = true` when `update_goals` succeeds.
- **Files modified:** `server/orchestrator/index.ts`
- **Commit:** `2aaed7f`

**2. [Rule 1 - Bug] Stale integration fixtures still used the old goal update contract**
- **Found during:** Final integration verification
- **Issue:** Existing chat streaming, SSE, and orchestrator integration tests still used bare `update_goals` arguments or omitted the goal proposal service dependency.
- **Fix:** Added explicit modes, proposal service wiring, and renderer-copy assertions for the new contract.
- **Files modified:** `tests/integration/chat-streaming.test.ts`, `tests/integration/orchestrator.test.ts`, `tests/integration/sse.test.ts`
- **Commit:** `b4a3ff5`

## Issues Encountered

- Full unit/integration runs regenerated tracked `tests/harness/artifacts/image-log-failure/latest/*` evidence. Those generated artifact changes were restored because this plan did not refresh harness evidence.
- The Task 3 trace test initially rejected safe `updatedFields: []` metadata. The test was corrected before commit to allow metadata-only empty field lists while still rejecting raw user and renderer copy leakage.

## Verification

| Command | Result |
|---------|--------|
| `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/orchestrator.test.ts tests/unit/update-goals-contract.test.ts` | RED failed as expected before Task 1 GREEN, then passed 56 tests. |
| `node scripts/run-node-with-tz.mjs --import tsx --test tests/integration/chat-goal-update.integration.test.ts` | RED failed on missing mutation metadata, then passed 7 tests after the fix. |
| `yarn tsc --noEmit && node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/goal-proposals.test.ts tests/unit/mutation-receipts.test.ts tests/unit/update-goals-contract.test.ts tests/unit/system-prompt.test.ts tests/unit/orchestrator.test.ts tests/integration/chat-goal-update.integration.test.ts` | Passed 100 targeted tests after typecheck. |
| `node scripts/run-node-with-tz.mjs --import tsx --test tests/integration/orchestrator.test.ts tests/integration/chat-streaming.test.ts tests/integration/sse.test.ts` | Passed 85 affected integration tests after fixture updates. |
| `yarn tsc --noEmit && yarn test:unit && yarn test:integration` | Passed. Unit: 739 tests. Integration: 280 tests. |

## Known Stubs

None. Stub-pattern scan matched test array initializers, string buffers, and optional defaults only; no UI or runtime stubs were introduced.

## Threat Flags

None. The new controlled-reply and trace surfaces were planned in T-60-08 through T-60-11 and covered by unit and integration tests.

## Auth Gates

None.

## User Setup Required

None.

## Next Phase Readiness

Phase 60 is complete from the execution side. Later phases can depend on renderer-owned mutation outcome patterns, explicit `update_goals` modes, and Fastify proof that rejected goal copy does not publish `goals_update` events or leak payload content into llm-trace artifacts.

## Self-Check: PASSED

- Found summary file at `.planning/phases/60-goal-proposal-authority-and-rejected-goal-copy/60-03-SUMMARY.md`.
- Found task commits `eedb5ba`, `a8e857d`, `20ccee9`, `2aaed7f`, `341ab4c`, and `b4a3ff5` in git history.
- Verified stub scan results were test-only initializers/string buffers and normal optional defaults.
- Confirmed final verification gates passed before summary creation.
