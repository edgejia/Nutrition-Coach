# Phase 76: Grouped Meal Edit UI and Conditional Item Media Decision - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-03
**Phase:** 76-Grouped Meal Edit UI and Conditional Item Media Decision
**Areas discussed:** Media decision, Row editing model, Add/delete behavior, Validation and recovery

---

## Media Decision

| Option | Description | Selected |
|--------|-------------|----------|
| Keep whole-meal photo only | Item rows edit text/nutrition; the existing image remains meal-level context and no item-photo mapping is implemented. | yes |
| Add lightweight item-photo hints | Keep stored photo meal-level, but allow copy or visual grouping suggesting all items came from the same photo. | |
| Implement item-level photo mapping now | Add per-row photo association or crop/mapping authority with persistence, DTO, UI, and evidence work. | |
| Other | Freeform media decision. | |

**User's choice:** Keep whole-meal photo only for Phase 76.

**Notes:** The current Meal Edit copy already says the photo is an `整餐照片`, `MealItemDetail` has no media field, and Phase 75 preserves the whole-meal image when grouped updates omit image input. Phase 76 may keep or lightly refine copy, but must not imply per-item crops or mappings. Item-level photo mapping remains deferred unless a later phase creates explicit persistence, DTO, and evidence contracts.

---

## Row Editing Model

| Option | Description | Selected |
|--------|-------------|----------|
| Always expanded rows | Show editable name, calories, protein, carbs, and fat for every item directly in the list. | |
| Summary rows with edit expansion | Keep compact rows and expand one row for full editing while maintaining a full internal draft `items[]`. | yes |
| Separate item edit panel | Tap a row to edit that item in a focused panel or sheet. | |
| Other | Freeform row model. | |

**User's choice:** Summary rows with edit expansion.

**Notes:** The server contract does not require every item field to be visible at once. The UI can keep a full draft `items[]`, expand only one row at a time on mobile, and still save the complete ordered list.

| Option | Description | Selected |
|--------|-------------|----------|
| Item name + compact macro summary | Collapsed row shows enough nutrition detail for scanning, such as `雞腿 · 340 kcal · P32 · C2 · F18`. | yes |
| Item name + calories only | Cleaner row, but hides macros. | |
| Item name only | Most compact, but weak for nutrition verification. | |
| Other | Freeform collapsed row content. | |

**User's choice:** Show item name plus compact macro summary.

**Notes:** This is a new compact summary format that preserves the same nutrition facts currently available in the grouped read-only multi-line macro display. It avoids forcing unnecessary expand/collapse interactions.

| Option | Description | Selected |
|--------|-------------|----------|
| Show live aggregate totals from the draft | Recompute whole-meal calories, protein, carbs, and fat as item drafts change. | yes |
| Show original totals only until save | Simpler, but misleading once edits are pending. | |
| Hide aggregate totals in the editor | Focuses on items but weakens whole-meal verification. | |
| Other | Freeform totals behavior. | |

**User's choice:** Show live aggregate totals computed from the draft `items[]`.

**Notes:** Live totals reinforce that grouped save commits a complete ordered item list and lets users verify the meal-level result before committing.

| Option | Description | Selected |
|--------|-------------|----------|
| Name + calories + protein + carbs + fat | Exactly matches the Phase 75 public item write shape. | yes |
| Nutrition only, name read-only | Reduces accidental identity drift, but blocks normal item identity fixes. | |
| Name and calories only, macros read-only | Simpler, but conflicts with grouped direct edit requirements. | |
| Other | Freeform editable fields. | |

**User's choice:** Expanded rows edit name, calories, protein, carbs, and fat.

**Notes:** `position` remains list/order-derived and not user-editable.

---

## Add/Delete Behavior

| Option | Description | Selected |
|--------|-------------|----------|
| Add button below the item list | Clear list-level draft construction action. | yes |
| Add button in the footer beside Save | Always visible, but mixes draft construction with commit actions. | |
| Add from each row | Allows insertion near a row, but adds clutter and overemphasizes position. | |
| Other | Freeform add affordance. | |

**User's choice:** Place Add item below the item list.

**Notes:** The footer should stay focused on Cancel/Save, and each row should stay focused on editing or deleting that row.

| Option | Description | Selected |
|--------|-------------|----------|
| Row-level delete with special handling for the final item | Fast normal cleanup while preventing invalid empty-list updates. | yes |
| Row-level delete always asks for confirmation | Safer but heavy for repeated edits. | |
| Delete only through an expanded row | Cleaner collapsed rows, but hides an important CRUD action. | |
| Other | Freeform delete behavior. | |

**User's choice:** Row-level delete, but block final-item deletion.

**Notes:** Normal non-final item deletion still saves via grouped full-list PATCH by omitting that item from the resulting non-empty `items[]`. Deleting down to one item is allowed. If deleting a row would leave zero items, do not send empty `items[]`, do not silently convert row delete into grouped PATCH, and do not silently convert row delete into whole-meal `DELETE`. Block the row-level delete with copy explaining that at least one item is required; whole-meal removal uses the existing Delete action and `DELETE /api/meals/:id`.

| Option | Description | Selected |
|--------|-------------|----------|
| Empty row expanded immediately | Creates a clear task and lets validation block save until required fields are filled. | yes |
| Prefilled placeholder name with zero nutrition | Faster to create, but risks committing placeholder data. | |
| Ask for item name first, then create row | More guided, but adds a step without solving nutrition entry. | |
| Other | Freeform new-row behavior. | |

**User's choice:** Add creates a new empty draft row and expands it immediately.

**Notes:** Placeholder names and zero nutrition should not be prefilled because zero values are technically valid.

| Option | Description | Selected |
|--------|-------------|----------|
| No explicit reordering controls | Preserve existing order, append new items, and compact positions on save. | yes |
| Simple up/down controls | Allows order correction with bounded UI. | |
| Drag-and-drop reordering | Direct on touch, but larger UI/test surface. | |
| Other | Freeform ordering behavior. | |

**User's choice:** Do not include explicit item reordering controls.

**Notes:** Preserve existing item order, append newly added items to the end, and rebuild submitted positions from visible draft order as contiguous zero-based positions because the backend requires `position === array index`.

---

## Validation and Recovery

| Option | Description | Selected |
|--------|-------------|----------|
| Inline per-row errors plus a top-level save error | Row fields show what to fix; top-level error explains save did not happen. | yes |
| Top-level error only | Simpler, but hard to act on in a multi-row form. | |
| Inline errors only | Good for field fixes, but weak for server/revision failures. | |
| Other | Freeform error placement. | |

**User's choice:** Use inline per-row errors plus a top-level save error.

**Notes:** Server validation, stale revision, and generic mutation failures use the top-level error area. Unauthorized follows the existing Meal Edit pattern: `UNAUTHORIZED` calls `recoverGuestSession()`, without a new visible top-level error decision.

| Option | Description | Selected |
|--------|-------------|----------|
| Keep invalid row expanded and block Save | Makes the required fix visible and prevents invalid `items[]` submission. | yes |
| Allow Save and rely on server validation | Server protects data, but UX feels like a failed commit. | |
| Collapse invalid rows but show summary markers | More compact, but hides exact fixes. | |
| Other | Freeform invalid-row behavior. | |

**User's choice:** Keep or open the invalid row and block Save.

**Notes:** Client validation should catch blank fields, non-numeric values, and negative values before submission. Server validation remains a safety net.

| Option | Description | Selected |
|--------|-------------|----------|
| Reuse existing stale-blocked recovery | Top-level stale copy, disabled Save/Delete, mutation state, today-row refresh, and reload/back action. | yes |
| Auto-replace the draft with latest meal data | Faster recovery, but risks discarding unsaved edits. | |
| Keep editing allowed after warning | Flexible, but conflicts with expected revision authority. | |
| Other | Freeform stale conflict behavior. | |

**User's choice:** Reuse existing stale-blocked recovery for grouped edits.

**Notes:** A stale draft must not remain editable as if it can still commit.

| Option | Description | Selected |
|--------|-------------|----------|
| Reuse `refreshAfterMealMutation` and close Meal Edit | Matches current single-item behavior and refreshes through authoritative DTO paths. | yes |
| Patch local draft/result into store without refetch | Faster, but risks diverging from DTO normalization. | |
| Stay on Meal Edit and refetch current meal into editor | Useful for continued edits, but adds state handling. | |
| Other | Freeform post-save behavior. | |

**User's choice:** Reuse `refreshAfterMealMutation` and close Meal Edit after successful grouped save.

**Notes:** Do not locally patch grouped item details from the PATCH response; Phase 75 only guarantees aggregate meal data, so item details may require normal `getMeals` refresh.

| Option | Description | Selected |
|--------|-------------|----------|
| Confirm only when grouped draft is dirty | Unchanged drafts exit immediately; changed, added, or deleted item drafts ask once before discard. | yes |
| Always confirm back/cancel from grouped edit | Safer, but annoying when the user only viewed the editor. | |
| Never confirm; back/cancel always discards | Matches current simple behavior, but riskier for multi-row edits. | |
| Other | Freeform dirty-state behavior. | |

**User's choice:** Confirm only when grouped draft is dirty.

**Notes:** Grouped edits can contain multiple row changes, additions, and deletions, so accidental discard has higher loss than current single-item editing.

---

## the agent's Discretion

- Exact component/helper names.
- Exact Traditional Chinese field labels and validation copy.
- Exact test names and whether grouped draft helpers stay local to `MealEditScreen` or move into a small helper module.

## Deferred Ideas

- Item-level photo mapping, crops, or per-item media evidence require a later phase with explicit persistence, DTO, and evidence contracts.
- Explicit item reordering controls are deferred from Phase 76.
- Stable cross-revision item IDs remain deferred from Phase 75.
