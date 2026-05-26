# Phase 65: Tool Contract Alignment and Meal-Period Authority - Context

**Gathered:** 2026-05-27
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 65 aligns `log_food` tool contracts around trusted-protein evidence and persists explicit user meal-period intent as structured meal authority. It must keep `loggedAt` date/timestamp semantics intact, project the new period authority through meal rows and receipts, and expose clean candidate facts for later correction targeting without taking on Phase 67 ranking redesign.

</domain>

<decisions>
## Implementation Decisions

### Trusted Protein Contract
- **D-01:** `protein_sources` is parse-time optional, execution-time guarded, and server-owned. The model may omit it; only backend-normalized facts decide whether trusted protein is persisted or surfaced.
- **D-02:** The prompt contract must stop saying `protein_sources` is always required. It should tell the model to provide `protein_sources` only when credible anchors exist, not to invent weak anchors, not to treat trace foods or generic ingredients as trusted protein, and to omit `protein_sources` when no credible anchor exists.
- **D-03:** Successful log reply copy should mention trusted protein sources only when the backend has counted trusted sources. Raw model `protein_sources` must not drive reply copy.
- **D-04:** Unsupported positive trusted-protein claims should default to commit-and-strip/normalize. Rejection is a rare escape hatch for structural contradictions that cannot be repaired or mapped coherently to the submitted meal.
- **D-05:** Weak anchors, vague names, low-confidence sources, or missing sources are not rejection reasons by themselves. If planning starts enumerating many rejection classes, it is drifting toward the rejected "required and fail closed" policy.
- **D-06:** Downstream code must read trusted-protein authority only from backend-normalized facts. Raw model `protein_sources` is parse-time evidence only; if exposed for debugging, it must be redacted metadata and never authority for reply copy, ranking, or correction reasoning.

### Meal-Period Authority
- **D-07:** `loggedAt` and `mealPeriod` are separate authorities. `loggedAt` remains actual/historical timestamp and date-placement authority; `mealPeriod` carries explicit user meal-category intent for display and correction targeting.
- **D-08:** Missing/null `mealPeriod` means no explicit period authority. Hour-based inference from `loggedAt` is allowed only as legacy/no-authority fallback.
- **D-09:** Historical log synthetic midpoint behavior can continue for `loggedAt` date placement, but explicit meal-period intent must still persist beside it so downstream code does not re-derive intent from synthetic hour.
- **D-10:** Authoritative `mealPeriod` must be grounded in original user/source text with direct meal-category words, such as supported equivalents for `早餐/早飯`, `午餐/午飯`, `晚餐/晚飯`, and `宵夜`.
- **D-11:** Time-of-day phrases such as `早上`, `中午`, or `晚上` may support timestamp/date parsing or fallback inference, but must not become persisted explicit period authority by themselves.
- **D-12:** Tool-provided `meal_period` is parse-time evidence only. If model args conflict with direct source text, source text wins and the backend should normalize rather than fail the log.
- **D-13:** A single `log_food` call represents one meal-level record and can carry at most one authoritative `mealPeriod`. Multi-period user text should be represented by separate meal logs; if one tool call cannot coherently map period to meal, reject or clarify instead of silently applying first-period-wins or nulling the period.
- **D-14:** Meal-category words inside `food_name` or item labels can help map evidence, but cannot create authority unless grounded in original user/source text. Model-authored labels must not manufacture persisted period intent.

### DTO and UI Projection
- **D-15:** Phase 65 should project one backend period field anywhere a meal row or logged-meal receipt is represented: current-day meals, history/day snapshot meals, `loggedMeal` receipts, mutation/update responses, and edit payloads.
- **D-16:** Public client-facing field: `mealPeriod?: "breakfast" | "lunch" | "dinner" | "late_night"`. The enum is authority; Traditional Chinese labels are frontend presentation.
- **D-17:** Do not backfill inferred values into `mealPeriod`, and do not add `inferredMealPeriod` in Phase 65. `mealPeriod` present means explicit backend authority; missing/null means clients may use `loggedAt` fallback for display.
- **D-18:** Home, History, Day Detail, and Summary meal row labels should prefer `mealPeriod` when present and fall back to existing hour-based inference only when missing.
- **D-19:** Direct edit/PATCH flows should carry `mealPeriod` in payloads/responses for projection, but ordinary numeric, name, macro, image, or meal-content edits must preserve existing explicit period when the edit omits it. Changing or clearing period requires an explicit grounded period correction.
- **D-20:** Tests should prove DTO/receipt projection, UI helper preference over `loggedAt`, legacy fallback inference, and edit preservation on omitted `mealPeriod`. Keep proof focused on projection behavior, not summary redesign or exhaustive screen coverage.

### Correction Candidate Handoff
- **D-21:** Phase 65 should expose explicit source-text-backed `mealPeriod` as a clean authority fact distinguishable from `loggedAt` fallback. Phase 67 owns ranking weights, tie-breaking, hard/soft matching, food-label precedence, and clarification behavior.
- **D-22:** Phase 65 should update correction candidate projection at the fact-authority boundary: `MealCorrectionCandidate.mealPeriod` should use persisted explicit `mealPeriod` when available and fall back to `inferMealPeriod(loggedAt)` only for legacy/no-authority rows.
- **D-23:** Correction candidates should carry effective period plus source. `candidate.mealPeriod` can remain the compatibility/effective value, while a companion source field distinguishes explicit authority from inferred fallback.
- **D-24:** Use domain labels `explicit` and `inferred` for the source field. `explicit` means persisted source-text-backed user intent; `inferred` means no explicit authority, effective period came from `loggedAt` fallback.
- **D-25:** Candidate tests should prove explicit lunch with breakfast-hour `loggedAt` yields `mealPeriod="lunch"` and source `"explicit"`, while legacy/no-authority rows infer from `loggedAt` with source `"inferred"`. Full ranking, tie-breaking, hard/soft matching, and clarification tests stay Phase 67.

### the agent's Discretion
- Exact persistence shape is for plan-phase calibration: it may live in meal transaction headers, revisions, projected meal facts, or another additive schema shape as long as the logical authority contract above holds.
- Exact structural-contradiction calibration for trusted-protein rejection is for plan-phase. The default policy must still read as "commit the meal and strip unsupported trust."
- Exact public/internal naming for candidate source may be calibrated in plan-phase, but the domain values should remain `explicit` / `inferred`.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Planning Scope
- `.planning/ROADMAP.md` — Phase 65 goal, success criteria, dependencies, and implementation notes.
- `.planning/REQUIREMENTS.md` — TOOL-01 through TOOL-03 and INTENT-01 through INTENT-03.
- `.planning/PROJECT.md` — v2.4 authority context, carry-forward decisions, privacy constraints, and release boundaries.

### Tool and Prompt Contracts
- `server/orchestrator/tools.ts` — `log_food` Zod schema, JSON schema, `protein_sources`, `meal_period`, historical loggedAt construction, trusted-protein normalization, and tool result shape.
- `server/orchestrator/system-prompt.ts` — current prompt sections requiring `protein_sources` and successful `log_food` reply copy.
- `tests/unit/tools.test.ts` — existing unit coverage for `log_food`, grouped meals, trusted protein, historical meal period, summary outcome, and invalid args.
- `tests/integration/orchestrator.test.ts` — integration coverage for `log_food` validation and reply contracts.

### Meal Period Persistence and Projection
- `server/db/schema.ts` — current meal transaction schema with `loggedAt` and revision tables; likely additive persistence point.
- `server/services/meal-transactions.ts` — revisioned meal writes and edit preservation boundary.
- `server/services/food-logging.ts` — meal logging service used by `log_food` and read surfaces.
- `server/services/meal-display.ts` — current meal display projection used by correction service and likely DTO projection helper.
- `server/lib/historical-date.ts` — historical date intent and `HistoricalMealPeriod` enum.
- `server/routes/meals.ts` — direct PATCH/DELETE response projection and edit preservation behavior.
- `server/routes/history.ts` — history/day row DTO projection.
- `server/routes/day-snapshot.ts` — day snapshot DTO projection.

### Client DTOs and Labels
- `client/src/types.ts` — public client types for `LoggedMealReceipt`, `MealEntry`, and `MealEditPayload`.
- `client/src/api.ts` — client transport guards/normalizers for meal receipts and meal rows.
- `client/src/components/HomeScreen.tsx` — current `getDisplayMealLabel` / `getMealBadge` hour-based helpers.
- `client/src/components/HistoryScreen.tsx` — history row labels using meal timestamps.
- `client/src/components/HistoryDayDetailScreen.tsx` — day detail row display.
- `client/src/components/SummaryDetailScreen.tsx` — summary meal row display.
- `client/src/meal-edit-payload.ts` — edit payload construction and preservation boundary.

### Correction Candidate Handoff
- `server/services/meal-correction.ts` — `MealCorrectionCandidate`, current `inferMealPeriod(loggedAt)`, candidate loading, and Phase 67 handoff surface.
- `tests/unit/meal-correction.test.ts` — existing candidate resolution tests; add narrow authority projection coverage here.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `server/lib/historical-date.ts` already defines `HistoricalMealPeriod = "breakfast" | "lunch" | "dinner" | "late_night"` and historical loggedAt midpoint behavior.
- `server/orchestrator/tools.ts` already has optional Zod `protein_sources` and optional `meal_period`; the JSON schema and prompt are the misaligned required surfaces.
- `server/orchestrator/tools.ts` already normalizes trusted protein into counted/excluded sources and rejects some trusted-protein persistence cases.
- `client/src/components/HomeScreen.tsx` has centralized `getDisplayMealLabel` and `getMealBadge` helpers that can be updated to prefer `mealPeriod`.

### Established Patterns
- Add backend dependencies and services through `server/app.ts`; keep route validation/DTO shaping in `server/routes/*.ts` and persistence/domain logic in `server/services/*.ts`.
- Keep TypeScript imports explicit with `.js` specifiers.
- Tests use Node built-in `node:test`, real SQLite, and injected mock/harness LLM providers.
- Existing v2.3 mutation contracts separate committed mutation facts from summary freshness; Phase 65 should preserve `summaryOutcome` behavior and not reintroduce LLM-authored mutation facts.

### Integration Points
- Persistence likely needs an additive `mealPeriod` field on meal transaction/revision facts so legacy rows can remain null.
- `log_food` execution should ground explicit period from source text and normalize model-provided `meal_period` rather than trusting it directly.
- Read DTOs and receipts should project `mealPeriod` without changing `loggedAt`.
- Direct meal edits should preserve existing `mealPeriod` unless an explicit grounded period correction is implemented.
- `MealCorrectionCandidate` should expose effective `mealPeriod` plus source (`explicit` / `inferred`) without changing Phase 67 ranking policy.

</code_context>

<specifics>
## Specific Ideas

- Repro anchor: `午餐我吃了雞腿便當` logged during a breakfast-hour timestamp should persist/project as lunch while keeping the original `loggedAt`.
- Multi-period anchor: `午餐是雞腿便當，晚餐是沙拉` should become separate meal logs or clarify/reject if represented as one incoherent `log_food` call.
- Trusted-protein prompt copy should read as conditional: provide `protein_sources` only when credible anchors exist; mention trusted protein in successful log reply only when backend-counted trusted sources exist.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 65-Tool Contract Alignment and Meal-Period Authority*
*Context gathered: 2026-05-27*
