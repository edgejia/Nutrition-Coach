# Phase 74: Home Meal Edit Entry and Existing Edit Contract Review - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-02
**Phase:** 74-Home Meal Edit Entry and Existing Edit Contract Review
**Areas discussed:** Home row activation, Ineligible meal behavior, Capability docs cleanup

---

## Home Row Activation

| Option | Description | Selected |
|--------|-------------|----------|
| Whole-row activation | Home today meal rows open existing Meal Edit with History-like button semantics and keyboard accessibility. | ✓ |
| Separate chevron/edit affordance | Add a distinct visual edit affordance to Home rows. | |
| Keep Home rows read-only | Do not add Home edit entry in this phase. | |

**User's choice:** Whole-row Home activation, aligned with History meal row button semantics. Do not prioritize a separate chevron/edit affordance.
**Notes:** User verified Home currently renders plain `<article>` rows without `openMealEdit`. Home should use the existing Meal Edit flow and should open grouped meals too when the payload is complete, because History does not filter `itemCount` and `MealEditScreen` already has a grouped-lock branch.

### Grouped Meal Routing

| Option | Description | Selected |
|--------|-------------|----------|
| Open existing grouped-lock screen | Home opens Meal Edit for any complete authoritative meal; grouped meals land on the existing read-only grouped-lock screen. | ✓ |
| Only single-item meals open edit | Home opens Meal Edit only for `itemCount === 1`; grouped rows remain non-interactive until later phases. | |
| Other | Freeform rule. | |

**User's choice:** Open existing grouped-lock screen.
**Notes:** This keeps Home consistent with History and avoids Phase 75-76 grouped direct editing scope.

---

## Ineligible Meal Behavior

| Option | Description | Selected |
|--------|-------------|----------|
| Silent read-only row | Only complete rows get button semantics; incomplete rows stay visually like plain rows. | ✓ |
| Disabled affordance | Incomplete rows show disabled button semantics or disabled styling. | |
| Small visible cannot-edit treatment | Incomplete rows show compact cannot-edit copy or icon. | |

**User's choice:** Silent read-only row.
**Notes:** User verified Home meals from `getMeals` are already guarded as authoritative DTOs and `buildHistoryMealEditPayload()` throws when identity or authoritative fields are missing. Ineligible Home rows should be defensive fallback only, with no fallback edit authority, no disabled control, and no new cannot-edit copy.

---

## Capability Docs Cleanup

| Option | Description | Selected |
|--------|-------------|----------|
| Source-of-truth matrix only, then regenerate docs | Update `client/src/contracts/capability-matrix.ts` for Home and Day Detail, then regenerate/check `docs/capability-matrix.md`. | ✓ |
| Matrix plus adjacent tests only | Update matrix source and tests but leave generated docs stale. | |
| Broader docs sweep | Update matrix, generated docs, and any related docs that mention Home/Day Detail edit entry. | |

**User's choice:** Source-of-truth matrix only, then regenerate docs.
**Notes:** User verified `docs/capability-matrix.md` is generated from `client/src/contracts/capability-matrix.ts`. Do not choose the stale-doc path. Do not broaden beyond the matrix unless implementation finds another explicit Home/Day Detail edit-entry reference.

---

## Plan-Level Notes

- Home-origin Meal Edit close should return naturally to Home through origin handling. Add an explicit Home label such as `返回首頁`, or explicitly accept the generic `返回` label in the plan.
- Use a non-throw eligibility path for Home rows, such as a safe wrapper around `buildHistoryMealEditPayload()` or a can-build helper.
- For Home row accessibility, align with History native button semantics where practical; otherwise use the MessageBubble-style `role="button"` + `tabIndex` + Enter/Space handling.
- Skip a separate after-edit Home cue/highlight; existing `MealEditScreen` and `refreshAfterMealMutation` behavior is sufficient for Phase 74.

## the agent's Discretion

- Exact helper names and file placement for Home edit payload eligibility.
- Exact markup strategy for accessible whole-row activation, as long as the locked semantics are preserved.
- Exact targeted unit/source-contract test placement.

## Deferred Ideas

- Direct grouped meal item editing, adding, and deleting remains Phase 75-76 scope.
- Home-specific post-edit highlight/cue behavior is not part of Phase 74.
