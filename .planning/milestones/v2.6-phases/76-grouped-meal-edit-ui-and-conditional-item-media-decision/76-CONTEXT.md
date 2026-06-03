# Phase 76: Grouped Meal Edit UI and Conditional Item Media Decision - Context

**Gathered:** 2026-06-03
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 76 replaces the current grouped Meal Edit read-only branch with a compact item-list editor for grouped meal item CRUD. The UI edits item names and nutrition values through a full internal draft `items[]`, submits the complete ordered list through the Phase 75 grouped `PATCH /api/meals/:id` contract, preserves existing revision authority and post-mutation refresh behavior, and records the product decision that item-level photo mapping is deferred.

This phase does not add item-level media persistence, per-item photo crops, stable cross-revision item IDs, item reordering controls, chat receipts for direct route edits, or a broad Meal Edit visual redesign.

</domain>

<decisions>
## Implementation Decisions

### Media Decision

- **D-01:** Keep whole-meal photo identity only for Phase 76. Item rows edit text and nutrition only; the existing image remains meal-level context and source of truth, not item-level evidence.
- **D-02:** Do not imply per-item crops, item-photo mappings, or per-item media evidence in UI copy or data shape. Existing copy may be kept or lightly refined to make clear that the photo represents the whole meal.
- **D-03:** Defer item-level photo mapping until a later phase creates an explicit persistence, DTO, and evidence contract for it. Phase 75 preserves the whole-meal image when grouped updates omit image input; `MealItemDetail` remains media-free in Phase 76.

### Row Editing Model

- **D-04:** Use compact grouped item summary rows with edit expansion. The editor keeps a full draft `items[]` internally while only one row is expanded for editing on mobile.
- **D-05:** Collapsed rows show item name plus compact macro summary, for example `雞腿 · 340 kcal · P32 · C2 · F18`, so users can scan and verify the whole meal without expanding every row. This is a new compact summary format that preserves the same nutrition facts currently available in the grouped read-only multi-line macro display.
- **D-06:** Expanded rows edit exactly the Phase 75 public item write fields: `name`, `calories`, `protein`, `carbs`, and `fat`. `position` is derived from list order and is not user-editable.
- **D-07:** Show live aggregate calories, protein, carbs, and fat totals computed from the draft `items[]` while editing. Original totals must not remain displayed as if current after draft edits.
- **D-08:** Saving a grouped edit submits the complete ordered draft `items[]`; the UI does not submit partial item operations.

### Add/Delete Behavior

- **D-09:** Place the Add item button below the item list. Adding an item is a list-level draft construction action, not a footer commit action and not a per-row insertion action.
- **D-10:** Tapping Add item creates a new empty draft row, appends it to the end of the visible draft list, and expands it immediately.
- **D-11:** Use row-level delete for item removal. Normal many-to-one or many-to-many cleanup should not ask for confirmation on every item deletion.
- **D-12:** Normal non-final item deletion saves via the grouped full-list PATCH by omitting that item from the resulting non-empty `items[]`. Deleting down to one remaining item is allowed.
- **D-13:** If deleting a row would leave zero items, block the row-level delete and explain that at least one item is required. Do not send empty `items[]`, do not silently convert row delete into a grouped PATCH, and do not silently convert row delete into whole-meal `DELETE`.
- **D-14:** Users who intend to remove the whole meal should use the existing whole-meal Delete action, which continues to call `DELETE /api/meals/:id` with its existing confirmation and revision check.
- **D-15:** Do not include explicit item reordering controls in Phase 76. Preserve existing item order, append new items to the end, and let deletion close gaps.
- **D-16:** On save, rebuild submitted item positions from the visible draft order as contiguous zero-based positions because the backend requires `position === array index`.

### Validation and Recovery

- **D-17:** Use inline per-row or per-field errors plus a top-level save error. Row errors show exactly what to fix; the top-level error explains that the save did not happen.
- **D-18:** Client validation must catch blank item names, blank nutrition fields, non-numeric values, and negative values before submitting. Server validation remains a safety net, not the primary user flow.
- **D-19:** If save is attempted with invalid rows, keep or open the first invalid row, show inline row/field errors, block Save, and show a top-level failed-save message.
- **D-20:** Server validation, stale revision, and generic mutation failures use the top-level error area because they are not necessarily tied to one row.
- **D-21:** Grouped stale revision conflicts reuse the existing stale-blocked Meal Edit recovery: on `MEAL_REVISION_REQUIRED` or `MEAL_REVISION_STALE`, show stale/revision copy, mark the edit stale-blocked, disable Save and Delete, record meal mutation state, refresh today rows if affected date is today, and offer the existing reload/back action.
- **D-22:** After a successful grouped save, reuse `refreshAfterMealMutation` and close Meal Edit. Do not patch the local draft directly into store and do not keep the editor open for continued edits in Phase 76.
- **D-23:** Confirm only when the grouped draft is dirty. Unchanged grouped drafts exit immediately on back/cancel; changed, added, or deleted item drafts ask once before discarding.
- **D-24:** Unauthorized recovery follows the existing Meal Edit pattern: `UNAUTHORIZED` calls `recoverGuestSession()`, without a new visible top-level error decision. Unsupported-state copy can be handled during planning/UI copy without additional product decision.

### the agent's Discretion

Planner may choose exact component/helper names, whether grouped draft parsing stays inside `MealEditScreen` or moves into a small local helper, exact Traditional Chinese field/error copy, and exact test naming. Planner should preserve the existing Meal Edit visual language, use existing transport/store boundaries, and keep the implementation scoped to grouped item editing rather than a wider screen redesign.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Planning Scope

- `.planning/ROADMAP.md` — Phase 76 goal, success criteria, dependency on Phase 75, and implementation notes for compact mobile ergonomics and conditional media decision.
- `.planning/REQUIREMENTS.md` — `GROUP-UI-01`, `GROUP-UI-02`, `GROUP-UI-03`, and `MEDIA-DECISION-01`.
- `.planning/PROJECT.md` — Current product context, authority decisions, privacy constraints, and no-promotion release boundary.
- `.planning/STATE.md` — Current v2.6 position and accumulated carry-forward decisions.
- `.planning/phases/75-grouped-meal-direct-crud-contract/75-CONTEXT.md` — Locked grouped `items[]` full-list replacement contract, strict item shape, zero-based position requirements, image preservation, and Phase 76 handoff.
- `.planning/phases/74-home-meal-edit-entry-and-existing-edit-contract-review/74-CONTEXT.md` — Existing Meal Edit entry, Home/History payload identity, grouped branch handoff, and refresh behavior to preserve.

### Codebase Maps

- `.planning/codebase/CONVENTIONS.md` — TypeScript, source, generated-doc, and Yarn-only conventions.
- `.planning/codebase/STRUCTURE.md` — Repository structure, script locations, and generated artifact conventions.
- `.planning/codebase/STACK.md` — React/Vite/Zustand client stack, Node test runner, timezone, and verification constraints.

### Client Meal Edit and Transport

- `client/src/components/MealEditScreen.tsx` — Existing single-item edit form, grouped read-only branch, whole-meal image copy, stale conflict handling, delete path, and post-mutation refresh usage.
- `client/src/types.ts` — `MealEditPayload`, `MealItemDetail`, `MealEntry`, and current scalar-only `UpdateMealInput` that Phase 76 must expand for grouped writes.
- `client/src/api.ts` — Existing `updateMeal` transport helper, route error handling, `MealRevisionConflictError`, and tolerant read-path item normalization.
- `client/src/meal-edit-refresh.ts` — Shared committed-mutation refresh helper that grouped save should reuse.
- `client/src/meal-edit-payload.ts` — Existing authoritative payload builders that preserve grouped item detail and image identity.

### Proof Surfaces

- `tests/unit/meal-edit-screen.test.ts` — Existing source contract for Meal Edit structure, stale recovery, image framing, grouped lock branch, and no out-of-scope image replacement.
- `tests/unit/meal-edit-payload.test.ts` — Existing proof that grouped item details and image authority survive edit payload building.
- `tests/integration/meals-api.test.ts` — Existing server route proof for grouped item replacement, revision checks, summaryOutcome, and response behavior.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- `MealEditScreen` in `client/src/components/MealEditScreen.tsx`: Provides the current screen shell, header/back labels, single-item field styling, stale conflict handling, whole-meal delete, and grouped read-only item summary markup to evolve.
- `MealEditImageFrame` in `client/src/components/MealEditScreen.tsx`: Already frames images as whole-meal media with copy that can stay or be lightly refined.
- `refreshAfterMealMutation()` in `client/src/meal-edit-refresh.ts`: Existing authoritative post-save/delete refresh path for summary, meals, mutation state, and receipt identity redaction.
- `updateMeal()` in `client/src/api.ts`: Existing direct PATCH transport helper that should accept the grouped item write shape after Phase 76 expands `UpdateMealInput`.
- `MealItemDetail` in `client/src/types.ts`: Existing public item detail vocabulary that matches the Phase 75 per-item write shape `{ name, position, calories, protein, carbs, fat }`; grouped write input also needs a top-level expected revision field.

### Established Patterns

- Meal Edit uses server-side `expectedMealRevisionId` as mutation authority; UI state is support only.
- Stale revision conflicts block continued editing and route the user through reload/back recovery.
- Direct mutation success closes the editor and refreshes through existing DTO/store paths instead of local patching.
- Read paths can normalize item detail, but grouped writes should submit strict, contiguous, zero-based `items[]` because the backend validates `position === array index`.
- The current UI treats persisted images as whole-meal identity, not item evidence.

### Integration Points

- Replace the `payload.itemCount > 1` grouped-lock branch in `MealEditScreen` with a grouped item draft editor.
- Expand `UpdateMealInput` in `client/src/types.ts` and `updateMeal()` call sites to support either the existing scalar shape or the grouped `items[]` shape without mixing them.
- Build grouped save payloads from the visible draft order, assigning contiguous zero-based positions immediately before submit.
- Reuse `handleMealRevisionConflict`, `handleReloadStaleMeal`, `handleDelete`, and `refreshAfterMealMutation` behavior where possible.
- Update `tests/unit/meal-edit-screen.test.ts` to replace grouped-lock expectations with grouped editor expectations, validation behavior, dirty discard handling, and no item-level media implication.
- Update `tests/unit/meal-edit-payload.test.ts` or API/type proof if grouped transport typing or item normalization changes.

</code_context>

<specifics>
## Specific Ideas

- Collapsed item row example: `雞腿 · 340 kcal · P32 · C2 · F18`.
- Only one grouped row should be expanded at a time on mobile.
- Add item creates an empty expanded draft row at the end of the list.
- Final row delete should show copy equivalent to "at least one item is required"; it must not send empty `items[]` or silently become whole-meal Delete. Users remove the whole meal through the existing Delete action.
- Dirty grouped drafts should prompt once before discard on back/cancel; unchanged drafts exit immediately.

</specifics>

<deferred>
## Deferred Ideas

- Item-level photo mapping, crops, or per-item media evidence require a later phase with explicit persistence, DTO, and evidence contracts.
- Explicit item reordering controls are deferred; Phase 76 preserves order, appends new items, and compacts positions on save.
- Stable cross-revision item IDs remain deferred from Phase 75 unless a future phase needs cross-revision item identity or partial item operations.

</deferred>

---

*Phase: 76-Grouped Meal Edit UI and Conditional Item Media Decision*
*Context gathered: 2026-06-03*
