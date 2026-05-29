---
phase: 67-correction-targeting-and-backend-clarification-rendering
plan: 04
subsystem: orchestrator
tags: [meal-correction, renderer-owned-copy, system-prompt, node-test, backend-authority]

requires:
  - phase: 67-03
    provides: backend-rendered find_meals controlled replies for unresolved correction targets
provides:
  - Terminal orchestrator handling for renderer-owned correction target clarification
  - Removal of legacy raw-user-message correction clarification rendering
  - Model-facing support guidance aligned with backend-owned correction target authority
affects: [phase-67, TARGET-01, TARGET-02, correction-targeting, backend-clarification-rendering]

tech-stack:
  added: []
  patterns: [controlled ToolExecutionResult replies as terminal final responses, support-only prompt guidance]

key-files:
  created:
    - .planning/phases/67-correction-targeting-and-backend-clarification-rendering/67-04-SUMMARY.md
  modified:
    - server/orchestrator/index.ts
    - server/orchestrator/system-prompt.ts
    - tests/unit/orchestrator.test.ts
    - tests/unit/system-prompt.test.ts

key-decisions:
  - "Correction target clarification is final only through find_meals controlledReply; the orchestrator no longer reparses serialized find_meals JSON or derives target labels from userMessage."
  - "The meal correction prompt is support-only: it routes update/delete targeting through find_meals, preserves user target terms in query, and forbids model candidate selection or backend clarification rewrites."
  - "Mixed numbered selections and numeric edits keep target resolution separate from numeric authority; vague numeric text such as 合理一點 still cannot directly call update_meal."

patterns-established:
  - "Use source assertions to keep legacy raw-message correction renderers out of the orchestrator."
  - "Prompt tests pin backend authority wording without relying on prompt prose as the enforcement layer."

requirements-completed: [TARGET-01, TARGET-02]

duration: 4m 50s
completed: 2026-05-29
---

# Phase 67 Plan 04: Orchestrator Terminal Clarification Summary

**Correction target clarification now terminates through backend renderer copy, with prompt guidance supporting backend-owned target selection and numeric authority.**

## Performance

- **Duration:** 4m 50s
- **Started:** 2026-05-28T20:19:56Z
- **Completed:** 2026-05-28T20:24:46Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- Removed the legacy orchestrator path that parsed `find_meals` JSON and built correction clarification copy from raw `userMessage`.
- Strengthened orchestrator tests proving backend-rendered correction clarification is final after one LLM call, with `finalReplySource: "renderer"`, `finalReplyShape: "plain_text"`, no mutation, and no raw correction echo.
- Updated meal correction prompt guidance so the model preserves target words in `find_meals.query`, never chooses from candidate lists, never rewrites backend clarification, and mutates only after backend target resolution.
- Added prompt tests for Phase 67 D-10, D-11, D-12, D-18, D-19, D-32, D-33, D-42, and D-43 while preserving Phase 66 numeric authority boundaries.

## Task Commits

1. **Task 1 RED: Add failing orchestrator renderer cleanup proof** - `e542c33` (test)
2. **Task 1 GREEN: Remove legacy correction clarification renderer** - `d2c0cc8` (feat)
3. **Task 2 RED: Add failing prompt authority assertions** - `5663a34` (test)
4. **Task 2 GREEN: Align correction prompt with backend authority** - `d2f9c20` (feat)

## Files Created/Modified

- `server/orchestrator/index.ts` - Removed raw correction target parsing, serialized `find_meals` reparsing, and the fallback correction clarification return path.
- `server/orchestrator/system-prompt.ts` - Reworked meal correction guidance around backend-owned target selection, terminal backend clarification, and separated numeric authority.
- `tests/unit/orchestrator.test.ts` - Added source assertion against legacy correction renderers and strengthened one-call renderer-owned clarification assertions.
- `tests/unit/system-prompt.test.ts` - Added Phase 67 prompt authority assertions for backend target ownership, no rewrite, and mixed-selection numeric boundaries.
- `.planning/phases/67-correction-targeting-and-backend-clarification-rendering/67-04-SUMMARY.md` - This execution summary.

## Decisions Made

- Removed the legacy renderer outright instead of leaving it unreachable, because the Phase 67 source acceptance criterion explicitly forbids raw `userMessage` correction label construction in `index.ts`.
- Kept prompt wording as guidance only. Enforcement remains in `find_meals` controlled replies, resolver-owned target identity, numeric authority checks, and mutator preconditions.
- Kept the existing prompt snapshot compatibility helper by normalizing the meal correction section in legacy byte-for-byte tests.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- Task 1 behavior was already mostly green after Plan 67-03 controlled replies, so the RED step added a source assertion that failed on the remaining legacy raw-message renderer.
- Task 2 required a small wording adjustment after the first GREEN attempt because the prompt said the same concept but did not match the test's `最強.*證據.*唯一` proof phrase.

## Verification

- `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/orchestrator.test.ts` - passed, 55/55.
- `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/system-prompt.test.ts` - passed, 28/28.
- `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/orchestrator.test.ts tests/unit/system-prompt.test.ts` - passed, 83/83.
- `yarn tsc --noEmit` - passed.
- `yarn test:unit` - passed, 896/896.

## Acceptance Criteria

- `server/orchestrator/index.ts` no longer contains `buildCorrectionClarificationReply`, `extractUserCorrectionTarget`, `formatCorrectionCandidate`, `parseCorrectionToolResult`, or `correctionClarificationReply`.
- Ambiguous correction with rendered options returns backend renderer copy after one LLM call and does not consume the queued model success/echo response.
- Prompt guidance includes `find_meals` before mutation, forbids model candidate selection and backend clarification rewrites, and preserves the Phase 66 rule that vague numeric intent such as `合理一點` cannot directly call `update_meal`.

## Known Stubs

None. Stub-pattern scan found only existing test queue initializers, typed accumulator initialization, and existing nullable/empty-string intake guards; no UI-flowing placeholder or mock data source was introduced.

## Threat Flags

None. The plan modified existing orchestrator and prompt surfaces only and introduced no new network endpoints, auth paths, file access patterns, or schema changes.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Plan 67-05 can build on terminal renderer-owned clarification without legacy raw-message fallback behavior in the orchestrator. Prompt guidance is aligned with backend resolver authority, while enforcement remains in service/tool/orchestrator code.

## Self-Check: PASSED

- Found `server/orchestrator/index.ts`, `server/orchestrator/system-prompt.ts`, `tests/unit/orchestrator.test.ts`, and `tests/unit/system-prompt.test.ts` on disk.
- Found task commits `e542c33`, `d2c0cc8`, `5663a34`, and `d2f9c20` in git history.
- Verified no tracked files were deleted by task commits.
- Verified targeted tests, TypeScript, and unit suite were green.

---
*Phase: 67-correction-targeting-and-backend-clarification-rendering*
*Completed: 2026-05-29*
