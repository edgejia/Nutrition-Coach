# Phase 74: Home Meal Edit Entry and Existing Edit Contract Review - Context

**Gathered:** 2026-06-02
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 74 makes Home today meal rows enter the existing Meal Edit flow for eligible meals, using the same public meal identity and revision-safe entry pattern already used by Chat receipts and History meal rows. It also revalidates the current single-item edit/delete contract before grouped behavior expands in later v2.6 phases, and corrects capability metadata that currently claims edit entry support where the component code does not match.

This phase does not add grouped direct item editing, Home-specific post-edit highlight/cue behavior, new server mutation authority, new fallback edit identity, or broader UI polish. Grouped direct edit/add/delete remains Phase 75-76 scope.

</domain>

<decisions>
## Implementation Decisions

### Home Row Activation

- **D-01:** Home today meal rows should use whole-row activation for complete authoritative meals, aligned with History meal row button semantics and keyboard accessibility.
- **D-02:** Do not prioritize adding a separate chevron, edit icon, or secondary edit affordance in Phase 74. The row itself is the affordance.
- **D-03:** Home should open Meal Edit through the existing `openMealEdit` store boundary with a complete `MealEditPayload`; it must not create a parallel Home-specific edit route or state boundary.
- **D-04:** Home should open Meal Edit for any complete authoritative meal, including grouped meals. Grouped meals must land on the existing `MealEditScreen` grouped-lock branch (`itemCount > 1`) and must not gain direct grouped save/edit behavior in Phase 74.
- **D-05:** Home-origin Meal Edit close behavior should naturally return to Home through `openMealEdit(..., "home")` or the existing origin default. Add an explicit Home back label such as `返回首頁` rather than leaving Home-origin edits on the generic `返回` label, unless implementation proves the generic label is intentionally preferred and records that choice in the plan.

### Ineligible Meal Behavior

- **D-06:** Ineligible Home rows are defensive fallbacks, not a normal product state. Current `getMeals` DTO guards already require `id`, `mealRevisionId`, nutrition fields, `itemCount`, and `loggedAt`; the payload builder also rejects missing revision or authority.
- **D-07:** Only Home rows that can build a complete authoritative Meal Edit payload get button semantics.
- **D-08:** Incomplete rows stay silent read-only. Do not show a disabled edit affordance, do not add new cannot-edit copy, and do not manufacture fallback edit authority.
- **D-09:** Planning should include a non-throw eligibility path for Home row rendering, such as a safe wrapper around `buildHistoryMealEditPayload()` or an equivalent can-build helper, so incomplete rows remain silent read-only without bubbling render-time exceptions.

### Existing Edit Contract Review

- **D-10:** Reuse and revalidate the existing single-item edit/delete contract: `MealEditScreen` sends `expectedMealRevisionId`, server revision checks remain authoritative, and `refreshAfterMealMutation` handles post-save/delete refresh.
- **D-11:** Do not add a separate Home post-edit highlight or cue. Existing `MealEditScreen` plus `refreshAfterMealMutation` behavior is sufficient for Phase 74.
- **D-12:** For accessibility, prefer native button semantics for interactive Home meal rows where practical. If the component cannot use a native button wrapper cleanly, use the existing MessageBubble-style `role="button"` + `tabIndex` + Enter/Space handling pattern.

### Capability Metadata Cleanup

- **D-13:** Correct `client/src/contracts/capability-matrix.ts` as the source of truth for Home and Day Detail edit-entry metadata.
- **D-14:** Home capability metadata must stop claiming `openMealEdit` ahead of code, then reflect the new implemented Home edit entry once Phase 74 adds it.
- **D-15:** Day Detail capability metadata must be corrected because `HistoryDayDetailScreen` is intentionally read-only and currently does not expose `openMealEdit`.
- **D-16:** Regenerate/check `docs/capability-matrix.md` from the source matrix after editing. Do not leave generated docs stale.
- **D-17:** Do not run a broader docs sweep unless implementation finds another explicit Home or Day Detail edit-entry reference. Keep the metadata cleanup local to the known generated capability matrix contract.
- **D-18:** When correcting Day Detail capability metadata, preserve the `capability-matrix-contract.test.ts` invariant: component rows with `activeHandler === "present"` require non-empty `handlerMatchers`. If `openMealEdit` is removed from Day Detail, retain a real handler such as `onBack`, or intentionally change the row semantics.
- **D-19:** Do not rely on the source scan alone to prevent over-claimed `handlerMatchers`. Home and Day Detail matrix corrections need direct source review plus `yarn matrix:check`.

### the agent's Discretion

Planner may choose the exact helper name and file placement for the Home eligibility wrapper, the exact row markup as long as accessible activation matches D-01/D-12, exact source-contract test placement, and whether the Home back label is implemented directly in `MealEditScreen` or via a small origin-label helper.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Planning Scope

- `.planning/ROADMAP.md` — Phase 74 goal, success criteria, dependency on v2.5 closeout, and implementation notes for Home edit entry, revision identity, capability docs, and single-item edit/delete proof.
- `.planning/REQUIREMENTS.md` — HOME-EDIT-01, HOME-EDIT-02, and EDIT-BASE-01 requirements.
- `.planning/PROJECT.md` — Current product context, strict authority decisions, privacy constraints, and release/promotion boundaries.
- `.planning/STATE.md` — Current v2.6 position and accumulated carry-forward decisions.

### Prior Phase Context

- `.planning/milestones/v2.5/phases/73-release-security-hardening-and-local-proof-gate/73-CONTEXT.md` — Carry-forward metadata-only local proof and no-promotion constraints.
- `.planning/milestones/v2.5/phases/72-receipt-atomicity-and-structured-history-state/72-CONTEXT.md` — Carry-forward fail-closed receipt/edit identity and no display-string authority principles.
- `.planning/milestones/v2.5/phases/71-authoritative-dto-validation-expansion/71-CONTEXT.md` — Carry-forward strict authoritative DTO validation, no manufactured editable facts, and transport/store boundary policy.

### Codebase Maps

- `.planning/codebase/STRUCTURE.md` — Repo layout, generated matrix script locations, and where command/test infrastructure lives.
- `.planning/codebase/CONVENTIONS.md` — TypeScript, source, generated-doc, and Yarn-only conventions.
- `.planning/codebase/TESTING.md` — Node test runner, timezone wrapper, matrix check commands, and verification matrix.

### Client Edit Entry and State

- `client/src/components/HomeScreen.tsx` — Current Home today row rendering; rows are plain `<article>` elements with no edit activation.
- `client/src/components/HistoryScreen.tsx` — Existing History meal row edit entry using `openMealEdit(buildHistoryMealEditPayload(meal, selectedDateKey), "history")`.
- `client/src/components/MessageBubble.tsx` — Existing Chat receipt edit entry with button semantics fallback pattern and complete receipt payload gating.
- `client/src/components/HistoryDayDetailScreen.tsx` — Current Day Detail read-only surface; capability metadata must match this.
- `client/src/components/MealEditScreen.tsx` — Existing Meal Edit save/delete contract, `expectedMealRevisionId` usage, grouped-lock branch, and origin-specific back labels.
- `client/src/meal-edit-payload.ts` — Existing authoritative edit payload builders and revision/authority rejection behavior.
- `client/src/store.ts` — `openMealEdit`, origin handling, `recordMealMutation`, `setMeals`, and receipt identity redaction state boundaries.
- `client/src/types.ts` — `MealEditPayload`, `MealEntry`, `LoggedMealReceipt`, and origin screen types.
- `client/src/meal-edit-refresh.ts` — Existing mutation refresh helper used by Meal Edit after save/delete.

### Capability Matrix and Proof Surfaces

- `client/src/contracts/capability-matrix.ts` — Source-of-truth capability metadata to update for Home and Day Detail.
- `docs/capability-matrix.md` — Generated capability matrix output to regenerate/check after source changes.
- `tests/unit/home-dashboard-contract.test.ts` — Existing Home source contracts that currently assert meal rows are read-only.
- `tests/unit/history-screen-contract.test.ts` — Existing History source contract for meal row edit entry and payload builder use.
- `tests/unit/history-day-detail-screen.test.ts` — Existing Day Detail source contract for read-only behavior.
- `tests/unit/meal-edit-payload.test.ts` — Existing payload builder proof for revision/authority requirements and grouped item preservation.
- `tests/unit/meal-edit-screen.test.ts` — Existing Meal Edit proof for revision-required handling and mutation refresh behavior.
- `tests/unit/capability-matrix-contract.test.ts` — Capability matrix contract proof.
- `tests/unit/capability-matrix-source-scan.test.ts` — Capability source scan proof.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- `buildHistoryMealEditPayload()` in `client/src/meal-edit-payload.ts`: the best existing Home payload builder candidate because Home meals use the same `MealEntry` shape and must preserve public `mealId`, `mealRevisionId`, nutrition, image, loggedAt, mealPeriod, and grouped items.
- `openMealEdit()` in `client/src/store.ts`: the existing secondary-screen state boundary for Chat and History edit entry.
- `MealEditScreen` grouped-lock branch: existing read-only grouped behavior for `itemCount > 1`, with direct grouped editing deferred.
- `refreshAfterMealMutation()` in `client/src/meal-edit-refresh.ts`: existing post-save/delete refresh path that updates affected meal state and summary surfaces.
- MessageBubble button fallback pattern: useful if Home cannot use native row buttons and needs `role="button"` plus keyboard handling.

### Established Patterns

- Client transport and DTO guards are authoritative before state writes; UI must not invent missing editable identity.
- Server-side expected revision checks remain the mutation authority. Client revision identity only enables the UX handoff.
- History meal rows already open Meal Edit without filtering grouped meals; Meal Edit owns grouped direct-edit blocking.
- Generated docs should be changed through source-of-truth data plus generator/check scripts, not by hand-editing generated Markdown alone.
- Verification remains command-based through Yarn and the Asia/Taipei timezone wrapper.

### Integration Points

- `HomeScreen` should import/reuse the edit payload helper and `openMealEdit`.
- `MealRows` needs an eligibility-aware render path so complete rows become interactive and incomplete rows remain plain read-only rows.
- `MealEditScreen` may need a small origin-label update for Home-origin back copy.
- `client/src/contracts/capability-matrix.ts` must be updated for Home edit support and Day Detail read-only accuracy.
- Targeted unit/source-contract tests should cover Home row activation, ineligible silent fallback, grouped row routing to existing lock screen by payload, capability matrix source updates, and generated matrix freshness.
- Capability matrix planning must account for contract-test invariants directly. In particular, removing `openMealEdit` from Day Detail still needs a truthful non-empty `handlerMatchers` list when `activeHandler` remains `present`, and `yarn matrix:check` is required because source-scan checks do not fully guard against over-claimed handlers.

</code_context>

<specifics>
## Specific Ideas

- Use whole-row Home activation; do not add a separate chevron/edit icon for Phase 74.
- Home grouped rows should open Meal Edit and display the existing grouped-lock state, not become directly editable.
- Ineligible Home rows should look like ordinary read-only rows; no disabled styling and no new “暫不可編輯” copy.
- Prefer an explicit Home-origin Meal Edit back label such as `返回首頁`.
- Run/check the capability matrix via the existing generator/check path after source edits.

</specifics>

<deferred>
## Deferred Ideas

- Direct grouped meal item edit/add/delete remains Phase 75-76 scope.
- Home-specific post-edit highlight/cue behavior is not part of Phase 74; reconsider only as future UX polish if needed.

</deferred>

---

*Phase: 74-Home Meal Edit Entry and Existing Edit Contract Review*
*Context gathered: 2026-06-02*
