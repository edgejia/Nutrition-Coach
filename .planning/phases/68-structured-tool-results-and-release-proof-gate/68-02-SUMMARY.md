---
phase: 68-structured-tool-results-and-release-proof-gate
plan: 02
subsystem: orchestrator
tags: [tool-results, renderer, node-test, typescript]

requires:
  - phase: 68-structured-tool-results-and-release-proof-gate
    provides: red-first structured clarification tests from Plan 68-01
provides:
  - Structured ToolExecutionResult clarification facts for meal target and historical clarification paths
  - Renderer-owned terminal historical clarification copy
  - Source guard keeping historical rendering and serialized parsing out of orchestrator index
affects: [phase-68, tool-results, historical-date, orchestrator]

tech-stack:
  added: []
  patterns:
    - Narrow ToolClarificationFact union on ToolExecutionResult
    - Historical clarification rendering through mutation-receipts helpers
    - Terminal controlledReply mapping for no-side-effect clarification turns

key-files:
  created:
    - .planning/phases/68-structured-tool-results-and-release-proof-gate/68-02-SUMMARY.md
  modified:
    - server/orchestrator/tools.ts
    - server/orchestrator/mutation-receipts.ts
    - tests/unit/orchestrator.test.ts

key-decisions:
  - "ToolExecutionResult.clarification is the narrow structured boundary for renderer-ready clarification facts."
  - "Historical log and summary clarifications now terminate through controlledReply instead of feeding serialized tool messages into another LLM round."

patterns-established:
  - "Adapter-owned structured facts: executeTool maps raw contract results to ToolClarificationFact before orchestration."
  - "Renderer-owned historical clarification copy lives in mutation-receipts.ts, while index.ts consumes controlledReply only."

requirements-completed: [TARGET-03, PROOF-01]

duration: 5m
completed: 2026-05-29
---

# Phase 68 Plan 02: Structured Tool Result Boundary Summary

**Typed clarification facts now carry meal-target and historical ambiguity results through executeTool with renderer-owned terminal copy.**

## Performance

- **Duration:** 5 min
- **Started:** 2026-05-29T16:18:00Z
- **Completed:** 2026-05-29T16:22:50Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- Added `ToolClarificationFact` and `ToolExecutionResult.clarification` for unresolved `find_meals`, historical `log_food`, historical summary clarification, and summary `multiple_targets`.
- Added historical clarification copy helpers in `server/orchestrator/mutation-receipts.ts`.
- Mapped historical `log_food` and `get_daily_summary` clarification statuses to terminal renderer `controlledReply` results with no mutation facts or second LLM pass.
- Strengthened the orchestrator source guard so `index.ts` stays free of historical renderer helper imports.

## Task Commits

1. **Task 1: Define renderer-ready clarification facts and copy helpers** - `a5ed9d1` (feat)
2. **Task 2: Map historical clarification paths to terminal controlled replies** - `4456ee6` (test)

## Files Created/Modified

- `server/orchestrator/tools.ts` - Adds the structured clarification union, allowlisted candidate projection, and terminal historical controlled-reply mapping.
- `server/orchestrator/mutation-receipts.ts` - Adds renderer-owned historical clarification copy helpers and expands forbidden internal receipt terms.
- `tests/unit/orchestrator.test.ts` - Adds a source guard preventing historical renderer helpers from moving into `index.ts`.
- `.planning/phases/68-structured-tool-results-and-release-proof-gate/68-02-SUMMARY.md` - Records execution, verification, and self-check evidence.

## Decisions Made

- Used `ToolExecutionResult.clarification` as the adapter boundary named by Plan 68-01.
- Kept raw `contractResult` and full service candidates behind `executeTool()`.
- Kept historical clarification rendering in `mutation-receipts.ts`; no `index.ts` rendering or serialized-result parsing was added.

## Verification

- `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/tools.test.ts` - **passed**.
- `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/tools.test.ts tests/unit/orchestrator.test.ts` - **passed**: 105 tests.
- `yarn tsc --noEmit` - **passed**.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

Expected red tests from Plan 68-01 failed before implementation. After the adapter and renderer mapping were added, the targeted tools and orchestrator tests passed.

## Known Stubs

None. Stub scan found only existing empty arrays/objects used as test collectors or local patch accumulators.

## Threat Flags

None. The new structured clarification field is the planned T-68-05/T-68-06 mitigation surface and does not introduce a new endpoint, auth path, file access pattern, or schema boundary.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Plan 68-03 can add JSON/SSE route persistence and no-side-effect integration proof on top of the terminal controlled-reply behavior implemented here.

## Self-Check: PASSED

- Found summary file: `.planning/phases/68-structured-tool-results-and-release-proof-gate/68-02-SUMMARY.md`.
- Found task commits: `a5ed9d1`, `4456ee6`.
- Confirmed plan-level verification passed after both task commits.
- Confirmed the pre-existing modified `68-CONTEXT.md` was not staged or changed by this plan.

---
*Phase: 68-structured-tool-results-and-release-proof-gate*
*Completed: 2026-05-29*
