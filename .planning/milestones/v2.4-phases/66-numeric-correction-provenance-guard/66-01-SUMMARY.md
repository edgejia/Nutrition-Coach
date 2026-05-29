---
phase: 66-numeric-correction-provenance-guard
plan: 01
subsystem: backend
tags: [orchestrator, numeric-authority, node-test, tdd]

requires:
  - phase: 65-tool-contract-alignment-and-meal-period-authority
    provides: explicit meal-period authority and correction candidate provenance handoff
provides:
  - Pure helper contract for meal numeric evidence extraction and authorization
  - Classification for vague, direction-only, and locked relative numeric correction text
  - Unit proof that top-level and items[] numeric writes require current-turn evidence
affects: [phase-66, update_meal, correction-authority]

tech-stack:
  added: []
  patterns:
    - Pure orchestrator helper with current-turn-only meal numeric authority
    - Node built-in node:test coverage for backend authority boundaries

key-files:
  created:
    - server/orchestrator/meal-numeric-authority.ts
    - tests/unit/meal-numeric-authority.test.ts
  modified:
    - server/orchestrator/source-text-guard.ts
    - tests/unit/source-text-guard.test.ts

key-decisions:
  - "Meal numeric direct-write authority is current user text only; previous assistant prose is not accepted by the helper API."
  - "items[] replacement numeric values are diffed against current persisted items and checked with the same field-level evidence as top-level patches."

patterns-established:
  - "Meal numeric authorization returns discriminated failure reasons for unauthorized values, vague text, direction-only text, and relative proposal candidates."
  - "Numeric source normalization supports decimals and bare Chinese digit unit targets while preserving the existing goal source guard confirmation path."

requirements-completed: [CORR-01, CORR-02]

duration: 4m 50s
completed: 2026-05-28
---

# Phase 66 Plan 01: Meal Numeric Authority Helper Summary

**Current-turn meal numeric authority helper with explicit evidence extraction, relative correction classification, and nested items[] bypass proof**

## Performance

- **Duration:** 4m 50s
- **Started:** 2026-05-28T07:34:21Z
- **Completed:** 2026-05-28T07:39:11Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- Added `authorizeMealNumericUpdate`, `extractMealNumericEvidence`, and `classifyMealNumericAdjustment` as a pure Wave 0 backend authority contract.
- Proved current-turn explicit numeric evidence authorizes only matching meal fields, while previous assistant numbers, vague text, direction-only text, and relative operators cannot directly authorize writes.
- Extended numeric source normalization for decimal values and bare Chinese digit unit targets without removing existing goal-source confirmation behavior.

## Task Commits

1. **Task 1: Add Wave 0 authority helper proof** - `24ed96b` (test)
2. **Task 2: Implement meal numeric authority helper** - `f9eadb2` (feat)

## Files Created/Modified

- `server/orchestrator/meal-numeric-authority.ts` - Pure helper for field evidence extraction, adjustment classification, and top-level/items[] numeric authorization.
- `server/orchestrator/source-text-guard.ts` - Numeric normalization now emits decimal values and bare Chinese digit unit targets.
- `tests/unit/meal-numeric-authority.test.ts` - Unit proof for explicit evidence, prior-assistant rejection, vague/relative classification, and items[] numeric guard coverage.
- `tests/unit/source-text-guard.test.ts` - Regression cases for decimal and bare Chinese digit numeric normalization.

## Decisions Made

- Meal numeric direct-write authority is current user text only; the helper API does not accept `previousAssistantMessage`.
- Existing `checkSourceFields` behavior remains unchanged for goal proposal confirmation, while meal-specific authorization uses the new helper.
- Grouped/nested `items[]` replacement payloads are treated as numeric diffs against current items, preventing nested model-supplied values from bypassing authority checks.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- TypeScript rejected indexing the success/failure union by `reason`; fixed with an extracted failure-reason type before the implementation commit.
- A shell source-assertion pattern for the literal `items[]` path was too strict; the code path was verified by tests and source inspection.

## Verification

- `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/meal-numeric-authority.test.ts tests/unit/source-text-guard.test.ts` - PASS
- `yarn tsc --noEmit` - PASS
- `yarn test:unit` - PASS, 852 tests
- Source assertions - PASS: exports present, helper has no `previousAssistantMessage`, all four numeric nutrition fields are named, and nested `items[]` numeric replacements are traversed.

## Known Stubs

None.

## Authentication Gates

None.

## Next Phase Readiness

Plan 66-02 can build backend-owned meal numeric proposal state on top of this helper. Plan 66-03 can wire the helper into `update_meal` enforcement without changing the helper contract.

## Self-Check: PASSED

- Created files exist: `server/orchestrator/meal-numeric-authority.ts`, `tests/unit/meal-numeric-authority.test.ts`
- Task commits exist: `24ed96b`, `f9eadb2`
- No tracked file deletions were introduced by task commits.

---
*Phase: 66-numeric-correction-provenance-guard*
*Completed: 2026-05-28*
