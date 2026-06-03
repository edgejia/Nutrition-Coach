---
phase: 74-home-meal-edit-entry-and-existing-edit-contract-review
plan: 01
subsystem: client-ui
tags: [react, zustand, meal-edit, node-test, typescript]

requires:
  - phase: 71-authoritative-dto-validation-expansion
    provides: "Fail-closed MealEntry authority and history edit payload validation"
  - phase: 62-meal-revision-tokens-and-stale-receipt-protection
    provides: "Public mealRevisionId edit identity and server-side stale revision protection"
provides:
  - "Nullable Home/History meal edit payload eligibility helper"
  - "Home today meal rows open existing Meal Edit flow for complete authoritative meals"
  - "Silent read-only Home row fallback for incomplete meal authority"
  - "Source-contract proof for Home row native button semantics and fallback behavior"
affects: [home, meal-edit, client-ui, phase-74]

tech-stack:
  added: []
  patterns:
    - "Home edit entry uses buildMealEditPayloadIfComplete before calling openMealEdit(payload, \"home\")"
    - "Interactive Home row CSS is scoped to native button rows via .home-sport-meal-row[type=\"button\"]"

key-files:
  created:
    - .planning/phases/74-home-meal-edit-entry-and-existing-edit-contract-review/74-01-SUMMARY.md
  modified:
    - client/src/meal-edit-payload.ts
    - client/src/components/HomeScreen.tsx
    - client/src/app.css
    - tests/unit/meal-edit-payload.test.ts
    - tests/unit/home-dashboard-contract.test.ts

key-decisions:
  - "Home rows use the existing Meal Edit store boundary rather than a Home-specific edit route."
  - "Incomplete Home rows remain ordinary read-only articles with no disabled affordance or fallback edit identity."
  - "Complete grouped Home rows enter Meal Edit and rely on the existing grouped-lock branch."

patterns-established:
  - "Nullable edit payload helper preserves the throwing history builder while giving Home a non-throw render path."
  - "Source-contract tests lock eligible button semantics, Home origin, and silent ineligible fallback."

requirements-completed: [HOME-EDIT-01]

duration: 5min
completed: 2026-06-02
---

# Phase 74 Plan 01: Home Meal Edit Entry Summary

**Home today rows now enter the existing revision-safe Meal Edit flow for complete meals while incomplete rows stay silent and read-only.**

## Performance

- **Duration:** 5 min
- **Started:** 2026-06-02T15:10:07Z
- **Completed:** 2026-06-02T15:14:37Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments

- Added `buildMealEditPayloadIfComplete()` as a nullable wrapper around the existing History payload builder.
- Wired complete Home meal rows to native `<button type="button">` controls that call `openMealEdit(editPayload, "home")`.
- Kept incomplete Home rows on the existing read-only `article.home-sport-meal-row` path with no disabled copy, icon, chevron, or Home-only edit route.
- Added focused unit/source-contract proof for payload authority, grouped item preservation, Home row semantics, and scoped interactive CSS.

## Task Commits

1. **Task 1 RED: Nullable payload helper coverage** - `fb905c7` (test)
2. **Task 1 GREEN: Nullable payload helper** - `9b614cc` (feat)
3. **Task 2 RED: Home row edit contract coverage** - `42fbadd` (test)
4. **Task 2 GREEN: Home row edit entry** - `75313d7` (feat)

**Plan metadata:** pending final docs commit

## Files Created/Modified

- `client/src/meal-edit-payload.ts` - Added the nullable eligibility helper while preserving `buildHistoryMealEditPayload()` throwing behavior.
- `client/src/components/HomeScreen.tsx` - Added Home meal row payload eligibility, native button activation for complete rows, and Home-origin Meal Edit routing.
- `client/src/app.css` - Added button-only Home row hover, active, and focus-visible styling without changing read-only article affordance.
- `tests/unit/meal-edit-payload.test.ts` - Added helper proof for complete rows, missing revision/core authority, and grouped item/image/date/mealPeriod preservation.
- `tests/unit/home-dashboard-contract.test.ts` - Replaced the read-only Home row contract with eligible/ineligible source proof while preserving existing Home content and Chat handoff assertions.

## Decisions Made

- Used the existing History payload builder as the authority source, with a narrow nullable wrapper for Home rendering.
- Kept Home row activation as whole-row native buttons instead of adding a separate edit icon or chevron.
- Left grouped direct editing deferred; grouped rows now route to existing Meal Edit grouped-lock behavior.

## Deviations from Plan

None - plan executed exactly as written.

**Total deviations:** 0 auto-fixed.
**Impact on plan:** No scope changes.

## Issues Encountered

None.

## Known Stubs

None. Stub-pattern scan found only pre-existing placeholder CSS selectors, test fixture empty strings, and existing null guards; no UI-facing stub, mock data source, or placeholder behavior was introduced.

## Threat Flags

None. The plan touched the existing Home UI to Zustand edit-state boundary described in the threat model and did not add network endpoints, auth paths, file access patterns, schema changes, or new server trust boundaries.

## Authentication Gates

None.

## Verification

- `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/meal-edit-payload.test.ts` - passed, 15 tests
- `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/home-dashboard-contract.test.ts tests/unit/meal-edit-payload.test.ts` - passed, 23 tests
- `yarn tsc --noEmit` - passed
- `yarn test:unit` - passed, 984 tests

## Next Phase Readiness

HOME-EDIT-01 is ready for follow-up contract review. Plan 74-02 can revalidate the existing Meal Edit save/delete behavior without needing a new Home-specific edit state, and Plan 74-03 can align capability metadata with real Home handler evidence.

## TDD Gate Compliance

- RED commit present before Task 1 GREEN: `fb905c7`
- GREEN commit present for Task 1: `9b614cc`
- RED commit present before Task 2 GREEN: `42fbadd`
- GREEN commit present for Task 2: `75313d7`
- No refactor-only commit was needed.

## Self-Check: PASSED

- Confirmed summary and all key modified files exist.
- Confirmed task commits `fb905c7`, `9b614cc`, `42fbadd`, and `75313d7` exist in git history.
- Confirmed no tracked files were deleted by task commits.

---
*Phase: 74-home-meal-edit-entry-and-existing-edit-contract-review*
*Completed: 2026-06-02*
