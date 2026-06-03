# Phase 75: Grouped Meal Direct CRUD Contract - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-03
**Phase:** 75-Grouped Meal Direct CRUD Contract
**Areas discussed:** Public Route Shape, Item identity and ordering, Validation and delete edge cases, Summary/receipt/response shape, Per-item request wire shape

---

## Public Route Shape

| Option | Description | Selected |
|--------|-------------|----------|
| Extend `PATCH /api/meals/:id` | Reuse existing direct route revision, summary, response, and publish wiring. | ✓ |
| Add `/api/meals/:id/items` subroutes | Clear REST item shape, but creates another mutation path. | |
| Full replacement `items[]` only | Simple persistence fit, but needs public route-shape decisions. | |

**User's choice:** Extend existing `PATCH /api/meals/:id`.
**Notes:** Existing direct route already rejects grouped meals today and centralizes expected revision checks, affected-date summary recompute, `summaryOutcome`, and realtime publish.

| Option | Description | Selected |
|--------|-------------|----------|
| `items[]` presence marks grouped update | Existing scalar payload remains legacy single-item shape. | ✓ |
| Add `mode` / `operation` discriminator | More explicit but adds validation surface. | |
| Add operation names inside PATCH | More extensible but moves toward RPC style. | |

**User's choice:** Use `items[]` presence as the grouped update marker.
**Notes:** Scalar fields and `items[]` should be mutually exclusive request shapes.

| Option | Description | Selected |
|--------|-------------|----------|
| Allow `items[]` replacement on any meal | Supports 1 -> many, many -> one, and many -> many. | ✓ |
| Reject unless current item count is greater than 1 | Narrower grouped-only route behavior. | |
| Let planner decide | Leave behavior flexible. | |

**User's choice:** Allow `items[]` replacement on single-item meals too.
**Notes:** The route contract is replacing a meal's ordered item list under `expectedMealRevisionId`, not only editing meals already grouped.

| Option | Description | Selected |
|--------|-------------|----------|
| Current PATCH response shape | `affectedDate`, `summaryOutcome`, optional `dailySummary`, aggregate `meal`. | ✓ |
| Current PATCH plus `meal.items` | Immediate item details for Phase 76. | |
| Let planner decide | Leave response detail flexible. | |

**User's choice:** Return the same minimum shape as current PATCH.
**Notes:** Phase 76 owns item-detail read/refresh behavior. Adding `meal.items` later remains backward-compatible.

---

## Item Identity and Ordering

| Option | Description | Selected |
|--------|-------------|----------|
| Zero-based position within expected revision | Matches current schema/DTOs and revision precondition safety. | ✓ |
| Stable item IDs | Durable across revisions but requires more schema/design work. | |
| No identity, just full list order | Simple but less explicit. | |

**User's choice:** Identify items by zero-based position within the expected revision.
**Notes:** Positions are revision-scoped and not stable across revisions. Stable IDs are deferred.

| Option | Description | Selected |
|--------|-------------|----------|
| Resulting ordered list only | Add/delete/update are inferred from final list. | ✓ |
| Include intent metadata | More explicit but can disagree with submitted list. | |
| Let planner decide | Leave representation flexible. | |

**User's choice:** Represent add/delete only by the resulting ordered `items[]`.
**Notes:** Server validates and persists the resulting list, not a parallel intent description.

| Option | Description | Selected |
|--------|-------------|----------|
| Preserve submitted order exactly | Positions assigned from array index; no reorder. | ✓ |
| Normalize order by food name or rule | Predictable but surprising. | |
| Let planner decide | Leave ordering flexible. | |

**User's choice:** Preserve submitted array order exactly.
**Notes:** No sorting, merging, deduping, or macro/name-based reordering.

| Option | Description | Selected |
|--------|-------------|----------|
| Allow duplicate names | Food name is not item identity. | ✓ |
| Reject duplicate names | Prevents accidents but blocks legitimate separate portions. | |
| Let planner decide | Leave duplicate handling flexible. | |

**User's choice:** Allow duplicate item names.
**Notes:** Item identity is revision-scoped position, not `foodName`/`name`.

---

## Validation and Delete Edge Cases

| Option | Description | Selected |
|--------|-------------|----------|
| Same required fields as item persistence | Nonblank name and finite nonnegative macros. | ✓ |
| Allow partial item patches | Requires merge behavior. | |
| Let planner decide | Leave validation flexible. | |

**User's choice:** Require every submitted request item to include nonblank `name` and finite nonnegative calories, protein, carbs, and fat.
**Notes:** Server maps public `name` to persistence `foodName`. Partial item patches are out of scope.

| Option | Description | Selected |
|--------|-------------|----------|
| Reject empty `items[]` with 400 | Keeps update separate from delete. | ✓ |
| Treat empty list as whole-meal delete | Compact but dangerous. | |
| Let planner decide | Leave behavior flexible. | |

**User's choice:** Reject empty `items[]`.
**Notes:** Whole-meal deletion remains `DELETE /api/meals/:id`.

| Option | Description | Selected |
|--------|-------------|----------|
| Reject mixed scalar plus `items[]` | One request shape per PATCH. | ✓ |
| Prefer `items[]` and ignore scalar fields | Forgiving but hides caller mistakes. | |
| Let planner decide | Leave precedence flexible. | |

**User's choice:** Reject mixed payloads as invalid.
**Notes:** Return `400` rather than silently choosing a shape.

| Option | Description | Selected |
|--------|-------------|----------|
| Preserve existing meal image implicitly | Keeps media semantics out of Phase 75. | ✓ |
| Allow top-level `imageAssetId` with `items[]` | Enables whole-meal image changes but expands contract. | |
| Let planner decide | Leave media behavior flexible. | |

**User's choice:** Do not allow image changes in grouped `items[]` replacement.
**Notes:** Existing update behavior can preserve current revision image when no image input is supplied.

---

## Summary/Receipt/Response Shape

| Option | Description | Selected |
|--------|-------------|----------|
| Exactly like current direct PATCH | Reuse affected-date summary, `summaryOutcome`, and publish behavior. | ✓ |
| Special-case grouped edits | Custom behavior but divergence risk. | |
| Let planner decide | Leave behavior flexible. | |

**User's choice:** Handle grouped replacement exactly like current direct PATCH.
**Notes:** No grouped special cases for summary recompute, degraded outcomes, publish failures, or realtime envelopes.

| Option | Description | Selected |
|--------|-------------|----------|
| No chat receipt/mutation-outcome persistence | Route-only direct CRUD contract. | ✓ |
| Add grouped edit receipt persistence | Broader audit trail but expands scope. | |
| Let planner decide | Leave persistence scope flexible. | |

**User's choice:** No chat receipt or mutation-outcome persistence.
**Notes:** Chat persistence remains owned by chat correction/tool flows.

| Option | Description | Selected |
|--------|-------------|----------|
| Reuse simple current route style | Simple `400` validation response. | ✓ |
| Add field-level validation details | More useful for UI but expands DTO. | |
| Let planner decide | Leave error detail flexible. | |

**User's choice:** Reuse current direct route validation style.
**Notes:** Structured metadata remains for revision conflicts only.

| Option | Description | Selected |
|--------|-------------|----------|
| Identical revision conflict bodies | Existing 409 codes and fields. | ✓ |
| Add grouped-specific conflict codes | More descriptive but unnecessary. | |
| Let planner decide | Leave conflict shape flexible. | |

**User's choice:** Keep revision conflicts identical for scalar and grouped payloads.
**Notes:** No summary recompute or publish side effects for conflicts.

---

## Per-item Request Wire Shape

| Option | Description | Selected |
|--------|-------------|----------|
| Existing flat `MealItemDetail` shape | `{ name, position, calories, protein, carbs, fat }`. | ✓ |
| Persistence-style `foodName` | Matches DB but leaks internal naming. | |
| Nested `nutrition` | Matches some read projections but not desired for writes. | |

**User's choice:** Use existing flat `MealItemDetail`-style public shape.
**Notes:** Server maps `item.name` to persistence `foodName`; request `position` must match zero-based array index.

| Option | Description | Selected |
|--------|-------------|----------|
| Reject aliases/nested forms | Strict public write contract. | ✓ |
| Accept aliases and normalize | More forgiving but hides client mistakes. | |
| Let planner decide | Leave parser strictness flexible. | |

**User's choice:** Reject aliases and nested forms for grouped writes.
**Notes:** Read paths can remain tolerant; write requests fail closed.

---

## the agent's Discretion

- Exact parser/helper names and file placement.
- Exact test names and whether validation helpers are route-local or small shared functions.

## Deferred Ideas

- Stable cross-revision item IDs.
- Detailed field-level validation DTOs.
- Returning `meal.items` from PATCH.
- Whole-meal image changes and item-level photo mapping.
- Direct route edits appearing in chat receipts or compressed-history mutation outcomes.
