---
phase: 60-goal-proposal-authority-and-rejected-goal-copy
plan: 02
subsystem: backend
tags: [typescript, orchestrator, tool-contracts, goal-proposals, deterministic-copy, node-test]

requires:
  - phase: 60
    plan: 01
    provides: "Pending goal proposal service and deterministic goal copy renderers"
provides:
  - "propose_goals non-mutating backend proposal contract"
  - "Explicit update_goals modes for current-turn values and latest active proposal"
  - "Backend consent/cancel predicates and controlled renderer replies"
  - "Prompt routing for backend proposal tools without prompt authority"
affects: [phase-60, goal-authority, orchestrator-tools, system-prompt, mutation-receipts]

tech-stack:
  added: []
  patterns:
    - "ToolContract discriminated mode schema for mutation authority"
    - "Renderer-owned controlledReply metadata for proposal/failure/cancel outcomes"
    - "Current-turn-only source guard invocation for goal numeric overrides"

key-files:
  created: []
  modified:
    - server/app.ts
    - server/orchestrator/index.ts
    - server/orchestrator/tools.ts
    - server/orchestrator/source-text-guard.ts
    - server/orchestrator/system-prompt.ts
    - tests/unit/update-goals-contract.test.ts
    - tests/unit/system-prompt.test.ts
    - tests/unit/orchestrator.test.ts
    - tests/unit/orchestrator-registry.test.ts

key-decisions:
  - "Use explicit mode: latest_proposal with backend consent and active proposal state rather than assistant prose authority."
  - "Return proposal, authority failure, validation failure, and cancel paths with renderer-owned controlledReply metadata for downstream short-circuiting."
  - "Keep shared goal proposal deps optional at low-level test fixture type boundaries while runtime buildApp passes the concrete service."

requirements-completed: [GOAL-01, GOAL-02, GOAL-03, GOAL-04]

duration: 11min
completed: 2026-05-17
---

# Phase 60 Plan 02: Backend Goal Tool Authority Summary

**Goal updates now flow through backend-owned proposal state and explicit mutation modes instead of assistant prose.**

## Performance

- **Duration:** 11 min
- **Started:** 2026-05-17T00:12:58Z
- **Completed:** 2026-05-17T00:23:35Z
- **Tasks:** 3
- **Files modified:** 9

## Accomplishments

- Wired `goalProposalService` through `buildApp()`, orchestrator dependencies, tool dependencies, and test service hooks.
- Added shared `isGoalProposalConsent()` and `isGoalProposalCancel()` predicates in `source-text-guard.ts`.
- Added `propose_goals` as a non-mutating tool contract that stores pending proposals and returns backend-rendered proposal copy without publishing `goals_update`.
- Replaced bare `update_goals` args with explicit `mode: "current_turn_values"` and `mode: "latest_proposal"` contracts.
- Enforced current-turn-only numeric source checking for direct updates and latest-proposal overrides.
- Implemented backend-owned controlled replies for proposal, authority failure, validation failure, and cancel outcomes.
- Updated goal prompt routing so vague target-change intent routes to `propose_goals`, while `update_goals` requires explicit modes.

## Task Commits

1. **Task 1: wire goal proposal service** - `9749197` (`feat`)
2. **Task 2 RED: goal tool authority tests** - `66393f3` (`test`)
3. **Task 2 GREEN: goal proposal/update contracts** - `35bf51c` (`feat`)
4. **Task 3 RED: goal prompt routing tests** - `0b5b704` (`test`)
5. **Task 3 GREEN: backend proposal prompt routing** - `79b4bbd` (`feat`)
6. **Rule 1 fix: update existing orchestrator fixtures** - `e000706` (`fix`)

## Files Created/Modified

- `server/app.ts` - Creates `goalProposalService`, passes it to the orchestrator, and exposes it in `AppServices`.
- `server/orchestrator/index.ts` - Carries `goalProposalService` into tool execution dependencies.
- `server/orchestrator/tools.ts` - Registers `propose_goals`, explicit-mode `update_goals`, controlled replies, validation-copy mapping, and metadata-only summaries.
- `server/orchestrator/source-text-guard.ts` - Exports shared goal proposal consent/cancel predicates.
- `server/orchestrator/system-prompt.ts` - Rewrites the goal update routing section for proposal and explicit mutation modes.
- `tests/unit/update-goals-contract.test.ts` - Proves non-mutation/no-publish, source authority, latest proposal, mixed override, cancel, validation, and privacy invariants.
- `tests/unit/system-prompt.test.ts` - Adds focused goal update section assertions.
- `tests/unit/orchestrator.test.ts` and `tests/unit/orchestrator-registry.test.ts` - Update existing fixtures for the new explicit tool contract.

## Decisions Made

- Used `mode: "latest_proposal"` for active proposal confirmation, matching the Plan 02 design choice and avoiding hidden proposal id handoff.
- Kept direct numeric updates as `mode: "current_turn_values"` and authorized numbers against current user text only.
- Preserved existing broad prompt snapshot protection by normalizing only the goal-update section in legacy byte-for-byte tests, then covering the new section with focused assertions.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Kept new goal proposal dependency optional at shared fixture boundaries**
- **Found during:** Task 1 `yarn tsc --noEmit`
- **Issue:** Existing direct `ToolDeps` and `OrchestratorDeps` test fixtures across unrelated unit tests did not provide the new service.
- **Fix:** Runtime `buildApp()` and goal-contract tests pass the concrete service; shared low-level dependency types allow legacy direct fixtures until they exercise goal proposal behavior.
- **Files modified:** `server/orchestrator/index.ts`, `server/orchestrator/tools.ts`
- **Commit:** `9749197`

**2. [Rule 1 - Bug] Updated existing unit fixtures for the new explicit goal tool contract**
- **Found during:** `yarn test:unit`
- **Issue:** Existing orchestrator and registry tests still expected the old public tool list and bare `update_goals` args.
- **Fix:** Added `propose_goals` to the registry expectation and updated orchestrator fixtures to pass `goalProposalService` plus `mode: "current_turn_values"`.
- **Files modified:** `tests/unit/orchestrator.test.ts`, `tests/unit/orchestrator-registry.test.ts`
- **Commit:** `e000706`

## Issues Encountered

- No schema or migration changes were needed. `git diff --name-only -- server/db/schema.ts drizzle | wc -l` returned `0`.

## Verification

- `git diff --name-only -- server/db/schema.ts drizzle | wc -l` - returned `0`.
- `yarn tsc --noEmit` - passed.
- `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/update-goals-contract.test.ts tests/unit/system-prompt.test.ts tests/unit/goal-proposals.test.ts tests/unit/mutation-receipts.test.ts` - passed, 49 tests.
- `yarn test:unit` - passed, 735 tests.

## Known Stubs

None. Stub-pattern scan found only legitimate test resets and existing null/empty-string guards.

## Auth Gates

None.

## Threat Flags

None. The new LLM tool boundary, consent predicate, publisher boundary, and metadata-only summary constraints were already covered by the plan threat model and tests.

## User Setup Required

None.

## Next Phase Readiness

Plan 60-03 can use `ToolExecutionResult.controlledReply` to short-circuit final replies for rejected, validation, proposal, and cancel paths at the orchestrator/route level.

## Self-Check: PASSED

- Found modified source and test files for the plan.
- Found task commits `9749197`, `66393f3`, `35bf51c`, `0b5b704`, `79b4bbd`, and `e000706`.

---
*Phase: 60-goal-proposal-authority-and-rejected-goal-copy*
*Completed: 2026-05-17*
