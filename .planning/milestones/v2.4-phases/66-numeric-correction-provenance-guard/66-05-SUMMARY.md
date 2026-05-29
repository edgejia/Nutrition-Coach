---
phase: 66-numeric-correction-provenance-guard
plan: 05
subsystem: backend
tags: [chat, meal-correction, numeric-authority, system-prompt, sse, node-test]
requires:
  - phase: 66-03
    provides: numeric correction backend guardrails
  - phase: 66-04
    provides: proposal decision routing
provides:
  - Route-level Fastify proof for explicit, vague, relative, stale, and cross-kind meal correction authority
  - SSE terminal no-mutation parity proof for blocked numeric correction attempts
  - Meal correction prompt contract cleanup aligned with backend authority boundaries
  - Phase 66 closure gates across TypeScript, unit, and integration suites
affects: [phase-66, correction-authority, orchestrator-prompt, chat-route, sse]
tech-stack:
  added: []
  patterns:
    - Fastify chat correction tests assert mutation facts and publish side effects, not only assistant text
    - Prompt text remains support-only while backend tool validation and proposal state decide authority
key-files:
  created:
    - .planning/phases/66-numeric-correction-provenance-guard/66-05-SUMMARY.md
  modified:
    - server/orchestrator/system-prompt.ts
    - tests/unit/system-prompt.test.ts
    - tests/integration/chat-meal-correction.integration.test.ts
    - tests/integration/chat-streaming.test.ts
key-decisions:
  - "Route-level correction proof treats backend-rendered no-update copy and no daily_summary publish as the observable authority boundary."
  - "Meal correction prompt guidance now routes explicit final numbers and computable operators only; backend validation/proposal state remain authoritative."
  - "Verification-only Task 3 is recorded with an empty test commit to preserve per-task commit traceability."
patterns-established:
  - "Blocked correction route tests assert revision id unchanged plus no summaryOutcome/dailySummary/publish side effects."
  - "System prompt snapshots normalize changing sections while direct section tests lock the new contract."
requirements-completed: [CORR-01, CORR-02, CORR-03]
duration: 8 min
completed: 2026-05-28T08:31:11Z
---

# Phase 66 Plan 05: Chat Integration Proof and Prompt Cleanup Summary

Route-level chat and SSE tests now prove numeric meal corrections only mutate from explicit backend-authorized authority, while the meal correction prompt no longer asks the model to invent commit-ready nutrition numbers.

## Performance

- **Started:** 2026-05-28T08:23:39Z
- **Completed:** 2026-05-28T08:31:11Z
- **Duration:** 8 min
- **Tasks:** 3
- **Files modified:** 4

## What Changed

- Added Fastify route proof for explicit meal correction, vague no-mutation handling, relative computable proposals, stale approval rejection, and cross-kind confirmation routing.
- Added SSE proof that blocked numeric correction attempts stream the same no-update copy as non-streaming chat and do not emit mutation facts.
- Cleaned the meal correction prompt contract so direct updates require current-turn final numbers, while computable adjustments route through backend proposals.
- Preserved large prompt snapshots by normalizing the changing meal correction section and locking the new section with focused tests.
- Ran the full phase closure gate: TypeScript, unit tests, and integration tests.

## Task Commits

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| 1 | Route-level correction authority proof | `59e1f47` | `tests/integration/chat-meal-correction.integration.test.ts`, `tests/integration/chat-streaming.test.ts` |
| 2 | Meal correction prompt cleanup | `6490bd0` | `server/orchestrator/system-prompt.ts`, `tests/unit/system-prompt.test.ts` |
| 3 | Phase closure gates | `37f164b` | Empty verification commit |

## Decisions Made

- Route-level correction proof treats backend-rendered no-update copy and no `daily_summary` publish as the observable authority boundary.
- Meal correction prompt guidance now routes explicit final numbers and computable operators only; backend validation and proposal state remain authoritative.
- Verification-only Task 3 is recorded with an empty test commit to preserve per-task commit traceability.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Test Bug] Corrected SSE fixture date assertion**

- **Found during:** Task 1
- **Issue:** The first SSE no-mutation assertion read `/api/meals`, which returns current-day rows, while the fixture meal was on `2026-04-19`.
- **Fix:** Switched the assertion to read the fixture date through `foodLoggingService.getMealsByDate`.
- **Files modified:** `tests/integration/chat-streaming.test.ts`
- **Commit:** `59e1f47`

**2. [Rule 1 - Prompt Test Regression] Avoided intake placeholder wording**

- **Found during:** Task 2
- **Issue:** Initial prompt cleanup used `未提供`, which violated existing no-placeholder prompt tests.
- **Fix:** Reworded the guidance to avoid placeholder terminology while preserving the authority rule.
- **Files modified:** `server/orchestrator/system-prompt.ts`, `tests/unit/system-prompt.test.ts`
- **Commit:** `6490bd0`

## Issues Encountered

- RED tests did not expose missing backend behavior because Plans 66-03 and 66-04 had already implemented the underlying guardrails; this plan added route/SSE proof and prompt cleanup.
- Targeted tests caught the fixture-date and prompt-placeholder issues above before task commits.

## Verification

| Command | Result |
| ------- | ------ |
| `node scripts/run-node-with-tz.mjs --import tsx --test tests/integration/chat-meal-correction.integration.test.ts tests/integration/chat-streaming.test.ts` | Passed: 73 tests, 2 suites |
| `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/system-prompt.test.ts && yarn tsc --noEmit` | Passed: 25 prompt tests plus TypeScript |
| `yarn tsc --noEmit && yarn test:unit && yarn test:integration` | Passed: TypeScript, unit suite, and 324 integration tests |

## Known Stubs

None. Stub-pattern scan only found benign test-local empty arrays/strings and existing prompt helper null checks; no UI stubs or unwired data sources were introduced.

## Threat Flags

None. The plan changed tests and prompt guidance only; it introduced no new endpoints, auth paths, file access patterns, schema changes, or trust-boundary surfaces beyond the planned correction authority checks.

## Authentication Gates

None.

## User Setup Required

None.

## Next Phase Readiness

Phase 66 now has backend guardrails, proposal routing, prompt cleanup, and route/SSE proof for numeric meal correction authority. Phase 67 can build follow-up correction targeting or clarification UX against this verified boundary.

## Self-Check: PASSED

- `FOUND: .planning/phases/66-numeric-correction-provenance-guard/66-05-SUMMARY.md`
- `FOUND: 59e1f47`
- `FOUND: 6490bd0`
- `FOUND: 37f164b`
- No tracked file deletions were introduced.
