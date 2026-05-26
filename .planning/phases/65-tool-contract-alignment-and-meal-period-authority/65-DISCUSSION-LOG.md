# Phase 65: Tool Contract Alignment and Meal-Period Authority - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-27
**Phase:** 65-Tool Contract Alignment and Meal-Period Authority
**Areas discussed:** protein_sources trust behavior, meal period vs timestamp authority, display and DTO projection, correction-targeting handoff

---

## protein_sources Trust Behavior

| Option | Description | Selected |
|--------|-------------|----------|
| Optional but guarded | Keep optional in schema/Zod and let server guard trusted-protein persistence. | |
| Required and fail closed | Require `protein_sources` everywhere and reject missing/weak anchors. | |
| Optional with retry first | Retry once for anchors, then allow omission. | |
| Other | Parse-time optional, execution-time guarded, server-owned trusted protein. | yes |

**User's choice:** `protein_sources` should be parse-time optional, execution-time guarded, and server-owned.
**Notes:** The prompt must be adjusted so the model provides `protein_sources` only when credible anchors exist and successful log copy mentions trusted protein only when backend-counted sources exist. Unsupported positive trusted-protein claims default to commit-and-strip, with rare rejection only for structural contradictions.

---

## Meal Period vs Timestamp Authority

| Option | Description | Selected |
|--------|-------------|----------|
| Separate meal-period authority plus original timestamp | Keep `loggedAt` semantics and persist explicit `mealPeriod` separately. | yes |
| Move the timestamp to lunch time | Shift `loggedAt` to make current display inference work. | |
| Display-only override | Store no structured authority; override selected labels only. | |

**User's choice:** Persist separate authorities: `loggedAt` for timestamp/date placement and `mealPeriod` for explicit meal-category intent.
**Notes:** Only source-text-backed direct meal-category words create explicit authority. Time-of-day phrases do not. Source text wins over model args. One `log_food` call can carry at most one explicit period, and model-authored meal/item labels cannot create authority unless grounded in source text.

---

## Display and DTO Projection

| Option | Description | Selected |
|--------|-------------|----------|
| All meal row DTOs and UI row labels | Project one backend field across meal rows, receipts, mutation responses, and edit payloads; UI prefers it with fallback. | yes |
| API/DTO only for now | Expose backend facts but defer UI labels. | |
| UI only where the repro is visible | Fix the visible current-day repro and defer other surfaces. | |

**User's choice:** Project `mealPeriod` across all meal row DTOs and logged-meal/mutation/edit payloads; update UI row labels to prefer it.
**Notes:** Public client field is `mealPeriod?: "breakfast" | "lunch" | "dinner" | "late_night"`. Missing/null means no explicit authority, so clients can infer by `loggedAt` for display. Direct edit/PATCH omissions must preserve existing period authority. Tests should cover DTO/receipt projection, UI helper preference, legacy fallback, and edit preservation.

---

## Correction-Targeting Handoff

| Option | Description | Selected |
|--------|-------------|----------|
| Expose explicit period as authority fact only | Phase 65 exposes the clean fact; Phase 67 owns ranking policy. | yes |
| Implement ranking boost now | Start preferring persisted period in candidate scoring immediately. | |
| Hard-match by period now | Only consider matching period candidates. | |

**User's choice:** Phase 65 should expose the clean authority fact and update candidate projection at the fact-authority boundary, without Phase 67 ranking redesign.
**Notes:** `MealCorrectionCandidate.mealPeriod` should use persisted explicit `mealPeriod` when available and fall back to `inferMealPeriod(loggedAt)` only for legacy/no-authority rows. Carry an additional source field with values `explicit` / `inferred`. Tests should prove effective period and source; ranking weights, tie-breaking, hard/soft matching, food-label precedence, and clarification behavior remain Phase 67.

---

## the agent's Discretion

- Exact persistence shape for `mealPeriod` is left to plan-phase, as long as the logical authority contract is preserved.
- Exact structural contradiction calibration for trusted-protein rejection is left to plan-phase, with commit-and-strip as the default behavior.
- Exact field naming may be calibrated, but source domain labels should remain `explicit` / `inferred`.

## Deferred Ideas

None.
