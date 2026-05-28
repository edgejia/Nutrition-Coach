---
phase: 66-numeric-correction-provenance-guard
plan: 04
subsystem: backend
tags: [orchestrator, proposal-routing, numeric-correction, node-test, tdd]

requires:
  - phase: 66-01
    provides: Current-turn meal numeric authority helper and nested numeric write proof
  - phase: 66-02
    provides: Backend-owned meal numeric proposal state and renderer copy
  - phase: 66-03
    provides: Tool-boundary numeric write enforcement and backend-computed proposal creation
provides:
  - Pre-model proposal decision router for meal proposal approval, cancellation, and cross-kind ambiguity
  - Composition-root mealNumericProposalService wiring
  - Unit and integration proof that stored meal proposals apply without another model round
affects: [phase-66, orchestrator, meal_numeric_correction_proposal, update_meal]

tech-stack:
  added: []
  patterns:
    - Load active backend proposal state before model calls
    - Resolve short approval and cancel text against stored proposal kinds before LLM execution
    - Apply meal numeric proposals through existing expected revision checks

key-files:
  created: []
  modified:
    - server/app.ts
    - server/orchestrator/index.ts
    - server/orchestrator/source-text-guard.ts
    - tests/unit/orchestrator.test.ts
    - tests/integration/chat-goal-update.integration.test.ts

key-decisions:
  - "Bare approval fails closed when active goal and meal proposal kinds coexist."
  - "Meal proposal approval commits only stored backend proposal values through mealCorrectionService.updateMeal with expectedMealRevisionId."
  - "Explicit goal-kind approval reuses the existing update_goals latest_proposal path while leaving active meal proposal state untouched."

patterns-established:
  - "Proposal decision routing happens after saving the user message and before the first model provider call."
  - "Broad cancel clears all active approvable proposal kinds; kind-specific cancel clears only the named kind."

requirements-completed: [CORR-01, CORR-02, CORR-03]

duration: 8m 05s
completed: 2026-05-28T08:19:42Z
---

# Phase 66 Plan 04: Proposal Decision Router Summary

**Pre-model proposal routing for backend-owned meal numeric approvals, cancellation, stale revision rejection, and cross-kind ambiguity**

## Performance

- **Duration:** 8m 05s
- **Started:** 2026-05-28T08:11:37Z
- **Completed:** 2026-05-28T08:19:42Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments

- Added TDD proof for cross-kind proposal ambiguity, broad cancel, kind-specific cancel, stored meal proposal approval, kind-specific goal approval, and stale meal proposal approval.
- Wired `mealNumericProposalService` through `server/app.ts`, `AppServices`, and orchestrator dependencies.
- Added a pre-model decision router that loads active meal and goal proposals before any provider call, then returns renderer-owned terminal replies for cancel, ambiguity, meal approval success, and stale meal approval failure.
- Kept meal proposal approval tied to stored `proposal.updateInput` or stored `proposal.items` plus `proposal.expectedMealRevisionId`; approval text is never parsed for new numeric targets.

## Task Commits

1. **Task 1: Add proposal decision router proof** - `e6eea46` (test)
2. **Task 2: Wire meal proposal service and pre-model decisions** - `7ec8c5b` (feat)

## Files Created/Modified

- `server/app.ts` - Creates `mealNumericProposalService`, exposes it via `AppServices`, and passes it into `createOrchestrator`.
- `server/orchestrator/index.ts` - Routes proposal cancel, ambiguity, and stored meal proposal approval before LLM calls.
- `server/orchestrator/source-text-guard.ts` - Recognizes explicit `套用目標更新` consent for the existing goal proposal path.
- `tests/unit/orchestrator.test.ts` - Adds no-second-LLM proof for cross-kind ambiguity, broad/kind cancel, and meal proposal approval.
- `tests/integration/chat-goal-update.integration.test.ts` - Adds Fastify proof for cross-kind state, kind-specific goal path, and stale meal proposal revision rejection.

## Decisions Made

- Bare `好` with both active proposal kinds returns `renderProposalKindAmbiguityCopy()` and mutates neither proposal.
- Broad `不要` / `取消` clears both active goal and meal proposal state and returns renderer-owned no-update copy.
- Kind-specific meal approval applies only the stored meal proposal through the existing revision precondition path and clears only meal proposal state after success.
- Stale meal proposal approval returns renderer-owned stale guidance without clearing the proposal, so retry state is not consumed by a failed precondition.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Added explicit goal-kind consent vocabulary**
- **Found during:** Task 2 verification
- **Issue:** `套用目標更新` reached the existing `update_goals` latest-proposal path, but `isGoalProposalConsent` did not recognize it, so the goal proposal failed closed instead of applying.
- **Fix:** Added a narrow consent pattern for `套用目標` / `套用每日目標` / `套用目標更新`.
- **Files modified:** `server/orchestrator/source-text-guard.ts`
- **Verification:** Targeted orchestrator/chat-goal tests, `yarn tsc --noEmit`, `yarn test:unit`, and `yarn test:integration` passed.
- **Committed in:** `7ec8c5b`

---

**Total deviations:** 1 auto-fixed (Rule 1)
**Impact on plan:** Required for the planned kind-specific goal approval behavior; no new product surface or dependency was added.

## Issues Encountered

- Task 1 RED initially exposed a test setup issue: the integration suite did not keep the created `deviceId` in scope because prior tests only needed the cookie. The test was corrected before the RED commit, then failed for the intended missing service/router behavior.
- The first GREEN run showed the explicit goal-kind approval phrase was not part of the existing goal consent vocabulary; fixed as documented above.

## Verification

- `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/orchestrator.test.ts tests/integration/chat-goal-update.integration.test.ts` - RED failed before implementation for missing meal proposal app wiring and router behavior; PASS after implementation, 70 tests.
- `yarn tsc --noEmit` - PASS.
- `yarn test:unit` - PASS, 872 tests.
- `yarn test:integration` - PASS, 318 tests.
- Source assertions - PASS: `server/app.ts` creates and passes `mealNumericProposalService`; `server/orchestrator/index.ts` loads active proposals before `llmProvider.chatRound` / `llmProvider.chat`; meal approval uses `proposal.updateInput` and `proposal.expectedMealRevisionId`.

## Known Stubs

None. Stub scan hits were normal empty arrays/strings in test helpers and existing local accumulators, not UI placeholders or unwired data.

## Threat Flags

None. The new proposal-routing and app-composition trust boundaries are covered by T-66-14 through T-66-18 in the plan.

## Authentication Gates

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Plan 66-05 can build final chat integration proof and prompt cleanup on top of guarded direct writes, backend-owned proposal creation, and pre-model proposal decision routing.

## Self-Check: PASSED

- Created summary exists: `.planning/phases/66-numeric-correction-provenance-guard/66-04-SUMMARY.md`
- Task commits exist: `e6eea46`, `7ec8c5b`
- No tracked file deletions were introduced by task commits.

---
*Phase: 66-numeric-correction-provenance-guard*
*Completed: 2026-05-28T08:19:42Z*
