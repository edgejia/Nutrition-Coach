---
phase: 60-goal-proposal-authority-and-rejected-goal-copy
plan: 01
subsystem: backend
tags: [typescript, sqlite, turn-states, goal-proposals, deterministic-copy, node-test]

requires:
  - phase: 59
    provides: "v2.2 local closure and no-promotion baseline"
provides:
  - "Pending goal proposal service over existing turn_states storage"
  - "Deterministic Traditional Chinese proposal, failure, validation, and cancel copy renderers"
  - "Unit proof for proposal lifecycle and exact copy invariants"
affects: [phase-60, goal-authority, mutation-receipts, orchestrator-tools]

tech-stack:
  added: []
  patterns:
    - "Thin domain wrapper over createTurnStateService for one-active expiring state"
    - "Backend-owned copy renderers beside mutation receipts"

key-files:
  created:
    - server/services/goal-proposals.ts
    - tests/unit/goal-proposals.test.ts
  modified:
    - server/orchestrator/mutation-receipts.ts
    - tests/unit/mutation-receipts.test.ts

key-decisions:
  - "Use existing turn_states uniqueness and expiry for one active pending goal proposal per device."
  - "Keep Phase 60 proposal/rejection/cancel copy in backend renderers, not model-authored prose."

patterns-established:
  - "Goal proposal state exports GOAL_PROPOSAL_KIND and GOAL_PROPOSAL_TTL_MS for downstream tool contracts."
  - "Goal copy tests pair exact Traditional Chinese copy with internal-term denylist checks."

requirements-completed: [GOAL-01, GOAL-03, GOAL-04]

duration: 4min
completed: 2026-05-17
---

# Phase 60 Plan 01: Goal Proposal Service and Backend Copy Summary

**Pending goal proposals now persist through expiring turn state, with deterministic Traditional Chinese renderer copy for proposal, fail-closed, validation, and cancel outcomes.**

## Performance

- **Duration:** 4 min
- **Started:** 2026-05-17T00:06:54Z
- **Completed:** 2026-05-17T00:10:29Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- Added `createGoalProposalService(db)` with `putLatest`, `getLatest`, and `clear` over the existing `turn_states` table.
- Encoded one-active-per-device proposal semantics through `GOAL_PROPOSAL_KIND = "goal_proposal"` and a 30-minute TTL.
- Added deterministic proposal, authority failure, validation failure, and cancel copy renderers in `mutation-receipts.ts`.
- Added unit coverage for proposal create, overwrite, expiry, clear, exact copy, success-wording rejection, and internal-term leakage.

## Task Commits

1. **Task 1 RED: goal proposal lifecycle tests** - `a7584a8` (`test`)
2. **Task 1 GREEN: pending goal proposal service** - `1f2d368` (`feat`)
3. **Task 2 RED: goal receipt renderer tests** - `273ce03` (`test`)
4. **Task 2 GREEN: deterministic goal copy renderers** - `f2205f7` (`feat`)

_Note: Both plan tasks were TDD tasks, so each has a RED test commit and a GREEN implementation commit._

## Files Created/Modified

- `server/services/goal-proposals.ts` - Thin pending goal proposal wrapper over `createTurnStateService`.
- `tests/unit/goal-proposals.test.ts` - Real SQLite lifecycle proof for create, overwrite, expiry, and clear.
- `server/orchestrator/mutation-receipts.ts` - Exported goal proposal, authority failure, validation failure, and cancel renderers.
- `tests/unit/mutation-receipts.test.ts` - Exact-copy and forbidden/internal-term proof for the new goal renderers.

## Decisions Made

- Used the existing `turn_states` table rather than adding schema or migration work, preserving the Phase 60 D-05 one-active proposal decision.
- Kept goal rejection and cancel copy in `mutation-receipts.ts` so downstream tool/orchestrator plans can route final replies to backend-owned renderers.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- The full integration suite regenerated tracked `tests/harness/artifacts/image-log-failure/latest/*` evidence files as runtime output. Those generated diffs were restored because this plan did not intentionally refresh harness artifacts.

## Verification

- `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/goal-proposals.test.ts` - passed.
- `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/mutation-receipts.test.ts tests/unit/goal-proposals.test.ts` - passed.
- `yarn tsc --noEmit` - passed.
- `yarn test:unit` - passed, 726 tests.
- `yarn test:integration` - passed, 280 tests.
- `git diff --name-only -- server/db/schema.ts drizzle | wc -l` - returned `0`.

## Known Stubs

None.

## Auth Gates

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Plan 60-02 can wire `propose_goals` and explicit-mode `update_goals` against the service and renderer contracts created here. Plan 60-03 still needs the orchestration-level proof that rejected/canceled paths short-circuit final replies and do not publish `goals_update`.

## Self-Check: PASSED

- Found created service, test, and summary files.
- Found task commits `a7584a8`, `1f2d368`, `273ce03`, and `f2205f7`.

---
*Phase: 60-goal-proposal-authority-and-rejected-goal-copy*
*Completed: 2026-05-17*
