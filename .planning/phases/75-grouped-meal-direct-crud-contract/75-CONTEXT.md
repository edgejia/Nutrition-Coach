# Phase 75: Grouped Meal Direct CRUD Contract - Context

**Gathered:** 2026-06-03
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 75 adds a server-owned direct grouped meal item CRUD contract by extending the existing direct meal update route. The contract lets a caller replace a meal's ordered item list under `expectedMealRevisionId`, so grouped meals can be updated directly without chat correction. This phase preserves existing revision authority, affected-date summary recompute, `summaryOutcome`, realtime publish behavior, and direct route response style.

This phase does not build grouped Meal Edit UI controls, add item-level photo mapping, create chat receipts, persist direct route edits into chat mutation outcomes, add stable cross-revision item IDs, or introduce detailed field-level validation DTOs.

</domain>

<decisions>
## Implementation Decisions

### Public Route Shape

- **D-01:** Extend the existing `PATCH /api/meals/:id` route for grouped item-list replacement. Do not add `/items` subroutes in Phase 75.
- **D-02:** A request body containing `items[]` selects the grouped replacement shape. Do not add `mode`, `operation`, or other discriminator fields.
- **D-03:** The existing scalar fields remain the legacy single-item update shape. Scalar update fields and `items[]` are mutually exclusive request shapes.
- **D-04:** `items[]` replacement is allowed for any meal under `expectedMealRevisionId`, including 1 -> many, many -> one, and many -> many revisions. The route contract is "replace this meal's ordered item list," not "only edit meals that are already grouped."
- **D-05:** Successful grouped replacement returns the same minimum shape as current direct PATCH: `affectedDate`, `summaryOutcome`, optional `dailySummary`, and aggregate `meal`.
- **D-06:** Phase 76 owns item-detail read/refresh behavior for grouped editing. Adding `meal.items` to the PATCH response later is a backward-compatible optional expansion, not required in Phase 75.

### Per-item Request Wire Shape

- **D-07:** Grouped request items use the existing flat `MealItemDetail`-style public shape: `{ name, position, calories, protein, carbs, fat }`.
- **D-08:** The server maps public `item.name` to persistence `foodName`. Do not expose per-item `foodName` in the grouped public request body.
- **D-09:** Do not use nested `nutrition` in the grouped write request. Nested/tolerant item normalization remains a read-path projection style, not the write contract.
- **D-10:** The grouped write parser should be strict. Accept only `name`, `position`, `calories`, `protein`, `carbs`, and `fat` per item. Reject aliases, per-item `foodName`, nested `nutrition`, and tolerant normalization in grouped writes.
- **D-11:** Because `position` is included in the public item shape, require each item `position` to exactly match its zero-based array index. Caller mistakes fail closed.
- **D-12:** Follow the Meal Edit/History zero-based item detail contract for grouped writes. Some chat receipt projections use `name` with 1-based display positions; those are not the Phase 75 write contract.

### Item Identity and Ordering

- **D-13:** Identify items by zero-based `position` within the expected revision. Positions are revision-scoped and must not be treated as stable across revisions.
- **D-14:** Do not add stable item IDs in Phase 75. Revisit stable item identity only if a later phase needs cross-revision item tracking or partial item operations.
- **D-15:** Add, delete, and update are represented only by the resulting ordered `items[]` list. Add means a new entry appears in the submitted list; delete means a previous revision position is omitted; update means an entry at a revision-scoped position changes.
- **D-16:** Do not include `added`, `deleted`, or other intent metadata in Phase 75. Server validation and persistence use the resulting list only.
- **D-17:** Preserve submitted array order exactly. Server assigns persisted `position` from array index after validation. Do not sort, merge, dedupe, or reorder by name or macros.
- **D-18:** Duplicate item names are allowed. `name`/`foodName` is not item identity and must not drive reject, dedupe, or merge behavior.

### Validation and Edge Cases

- **D-19:** Every submitted grouped request item requires nonblank `name` and finite nonnegative `calories`, `protein`, `carbs`, and `fat`.
- **D-20:** Because this is full-list replacement, do not allow partial item patches or server-side merge behavior.
- **D-21:** Empty `items[]` is a `400` validation error. Grouped replacement must leave at least one item.
- **D-22:** Whole-meal deletion remains `DELETE /api/meals/:id` with its existing revision check, tombstone revision, affected-date summary recompute, `summaryOutcome`, and publish behavior. Do not treat empty item replacement as meal deletion.
- **D-23:** A request containing both `items[]` and scalar update fields such as `foodName`, `calories`, `protein`, `carbs`, or `fat` is invalid and returns `400`.
- **D-24:** Grouped `items[]` replacement cannot change images in Phase 75. Preserve the current meal image implicitly through existing update behavior when no image input is supplied.
- **D-25:** Whole-meal image changes and item-level photo mapping remain outside Phase 75 unless Phase 76 later proves an additive contract is needed.

### Summary, Receipt, and Response Shape

- **D-26:** Grouped `items[]` replacement follows the current direct PATCH summary and publish behavior exactly.
- **D-27:** After the revisioned item-list update commits, compute `affectedDate` from meal `loggedAt`, build `summaryOutcome` through the existing post-commit summary helper, derive optional `dailySummary` only from `summaryOutcome`, and publish through the existing `meal_mutation` daily_summary path only when the usable summary date matches `affectedDate`.
- **D-28:** Do not add grouped special cases for summary recompute, degraded `summaryOutcome`, publish failure handling, or realtime envelopes.
- **D-29:** Do not create chat receipts, assistant messages, compressed-history mutation outcomes, or chat mutation-outcome persistence for Phase 75 direct route edits.
- **D-30:** Grouped validation failures use the current direct route validation style: simple `400`, such as `{ error: "Invalid meal update" }`. Do not add field-level validation detail DTOs in Phase 75.
- **D-31:** Missing or stale `expectedMealRevisionId` returns the existing 409 `MEAL_REVISION_REQUIRED` / `MEAL_REVISION_STALE` body with `mealId`, `affectedDate`, and `currentMealRevisionId` only.
- **D-32:** Revision conflicts have no summary recompute or publish side effects and no grouped-specific conflict codes.

### the agent's Discretion

Planner may choose exact helper names, whether the grouped parser lives beside the current scalar parser or in a small shared route helper, and exact test naming. Planner should preserve the decisions above and prefer extending existing `server/routes/meals.ts` and meal transaction service boundaries over creating a parallel mutation path.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Planning Scope

- `.planning/ROADMAP.md` — Phase 75 goal, success criteria, dependency on Phase 74, and implementation notes for grouped direct CRUD.
- `.planning/REQUIREMENTS.md` — GROUP-EDIT-01 through GROUP-EDIT-04, plus Phase 76/77 boundaries that keep UI and media decisions out of Phase 75.
- `.planning/PROJECT.md` — Current product context, authority decisions, privacy constraints, and no-promotion release boundary.
- `.planning/STATE.md` — Current v2.6 position and accumulated carry-forward decisions.
- `.planning/phases/74-home-meal-edit-entry-and-existing-edit-contract-review/74-CONTEXT.md` — Phase 74 decisions to reuse existing Meal Edit/direct route authority and keep grouped direct editing for Phase 75/76.

### Codebase Maps

- `.planning/codebase/STACK.md` — Yarn, TypeScript, Fastify, SQLite, Node test runner, and timezone verification constraints.
- `.planning/codebase/ARCHITECTURE.md` — Existing command, persistence, revisioned meal, generated docs, and verification patterns.
- `.planning/codebase/INTEGRATIONS.md` — SQLite storage, same-origin API, SSE/publish, and metadata-only evidence constraints.

### Direct Meal Route and Services

- `server/routes/meals.ts` — Existing direct `PATCH /api/meals/:id` and `DELETE /api/meals/:id` route contracts, parser style, revision conflict response, summaryOutcome helper, and realtime publish path.
- `server/services/food-logging.ts` — Existing `GroupedMealUpdateData`, `updateMeal`, aggregate compatibility projection, and service wrapper around meal transactions.
- `server/services/meal-transactions.ts` — Revision precondition checks, current item loading, mutation guard, full-list update transaction, image preservation, and revision/item persistence.
- `server/db/schema.ts` — `meal_revisions` and `meal_revision_items` schema, including `position` and non-null nutrition fields.

### Client and Public Item DTOs

- `client/src/types.ts` — Public `MealItemDetail` shape with `name`, `position`, `calories`, `protein`, `carbs`, and `fat`; current `UpdateMealInput` scalar shape.
- `client/src/api.ts` — Existing tolerant read-path item normalization and current scalar `updateMeal` transport boundary; grouped write parsing should be stricter than this read normalization.

### Existing Proof Surfaces

- `tests/integration/meals-api.test.ts` — Existing direct route integration tests for grouped rejection, revision conflicts, summaryOutcome, affected-date publish, image validation, and route DTOs.
- `tests/unit/meal-transactions.test.ts` — Existing transaction-level proof for full-list revision writes, revision preconditions, item positions, delete tombstones, and image/reference behavior.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- `server/routes/meals.ts`: Current direct PATCH route already centralizes parse/validate, expected revision checks, summary recompute, `summaryOutcome`, response shaping, and `daily_summary` publish.
- `foodLoggingService.updateMeal()` in `server/services/food-logging.ts`: Already accepts grouped update data and projects aggregate meal compatibility fields.
- `mealTransactionsService.updateTransaction()` in `server/services/meal-transactions.ts`: Already creates a new revision and writes a complete ordered item list, preserving the current image when no image input is supplied.
- `mealTransactionsService.getCurrentItemsForMutation()` / `getMealMutationGuard()`: Existing read/check helpers can support validation and conflict-safe pre-mutation behavior if needed.
- `MealItemDetail` in `client/src/types.ts`: Existing public item wire vocabulary for grouped details.

### Established Patterns

- Server-side expected revision checks are authoritative; client state and UI are only support.
- Direct meal route validation currently returns simple route-level errors, while revision conflicts use structured 409 bodies.
- Summary availability is represented by `summaryOutcome`; compatible `dailySummary` fields derive only from usable summary outcomes.
- Realtime publish failure is non-fatal and metadata-only; publish failure must not appear in response bodies.
- Revisioned meal persistence stores each update as a new complete item list, not as partial item operations.
- Read paths may tolerate or normalize projections, but this Phase 75 write contract should fail closed.

### Integration Points

- Extend `parseMealUpdateBody()` or replace it with a parser that distinguishes exactly one of the scalar update shape or grouped `items[]` shape.
- Map grouped public request items from `{ name, position, calories, protein, carbs, fat }` to `MealTransactionItemInput` with persistence `foodName`.
- Remove or bypass the current grouped edit rejection only for valid `items[]` replacement payloads; keep scalar grouped updates rejected or migrated according to the final parser design.
- Reuse the existing post-commit block in `server/routes/meals.ts` for affected-date summary recompute, `summaryOutcome`, optional `dailySummary`, publish, and aggregate meal response.
- Add real SQLite integration coverage in `tests/integration/meals-api.test.ts` for valid replacement, 1 -> many, many -> one, invalid mixed shape, invalid item fields, empty list, stale/missing revision, no summary/publish on conflicts, image preservation, and unchanged chat persistence.
- Add transaction/service unit coverage only where route tests cannot prove item ordering, revision history, and image preservation clearly enough.

</code_context>

<specifics>
## Specific Ideas

- The grouped write item shape should be flat and public: `{ name, position, calories, protein, carbs, fat }`.
- Request `position` must match zero-based array index because submitted array order is canonical and positions are included only as a caller sanity check.
- Accepted item order is deterministic: submitted array index becomes persisted `meal_revision_items.position`.
- Phase 76 should add or use an item-detail read/refresh path for grouped edit UI instead of relying on Phase 75 PATCH to return item details.

</specifics>

<deferred>
## Deferred Ideas

- Stable cross-revision item IDs are deferred until a later phase needs cross-revision item identity or partial item operations.
- Field-level validation detail DTOs are deferred; Phase 75 keeps current simple direct route validation style.
- `meal.items` in the PATCH response is deferred to Phase 76 or later if avoiding a post-edit refetch becomes important.
- Whole-meal image changes and item-level photo mapping remain outside Phase 75 unless Phase 76 proves an additive contract is required.
- Direct route edits creating chat receipts, assistant messages, or compressed-history mutation outcomes are deferred unless a later phase explicitly expands direct route edits into chat history.

</deferred>

---

*Phase: 75-Grouped Meal Direct CRUD Contract*
*Context gathered: 2026-06-03*
