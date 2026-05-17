# Phase 62: Meal Revision Tokens and Stale Receipt Protection - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md - this log preserves the alternatives considered.

**Date:** 2026-05-17
**Phase:** 62-Meal Revision Tokens and Stale Receipt Protection
**Areas discussed:** Revision Token Surface, Expected Revision Enforcement, Missing Expected Revision Contract, Client Recovery Behavior, Stale Conflict HTTP Shape

---

## Gray Area Selection

| Option | Description | Selected |
|--------|-------------|----------|
| Revision Token Surface | Which DTOs and edit payload sources carry current meal revision identity. | yes |
| Expected Revision Enforcement | Which mutation paths require an expected revision, including stale delete. | yes |
| Client Recovery Behavior | How the client recovers after stale receipt conflicts. | yes |
| Stale Conflict HTTP Shape | Whether stale conflicts use 409, 412, or existing route conflict style. | yes |
| Other | User-defined additional area. | |

**User's choice:** `1, 2, 4, 3 quick-ratify`
**Notes:** User requested a compact ratification pass and added that Q2 should also decide the fail-closed contract for missing `expectedMealRevisionId`; no legacy compatibility exception should be added unless a real rollout need is raised.

---

## Revision Token Surface

| Option | Description | Selected |
|--------|-------------|----------|
| Every edit-capable read/display DTO and edit payload source | Add current revision identity to receipts, meal rows, edit payloads, direct responses, chat payloads, and restorable history receipts. | yes |
| Chat receipts only | Narrower surface, but would leave direct/history edit affordances without a precondition source. | |
| All write inputs carry plain `mealRevisionId` | Rejected because read identity and write precondition should stay distinct. | |

**User's choice:** Edit proposed decision.
**Notes:** Replacement wording locked: add current `mealRevisionId` to every edit-capable read/display DTO and edit payload source: `LoggedMealReceipt`, `MealEntry`, `MealEditPayload`, `/api/meals` rows, direct update responses, chat JSON/SSE `loggedMeal`, and restored history receipts when they can open Meal Edit. Write inputs should carry `expectedMealRevisionId`, not plain `mealRevisionId`.

---

## Expected Revision Enforcement

| Option | Description | Selected |
|--------|-------------|----------|
| Every existing-meal mutation | Require `expectedMealRevisionId` for direct PATCH, direct DELETE, chat/tool update, and chat/tool delete after target resolution. | yes |
| Direct PATCH only | Protects receipt-origin editing but leaves delete and chat/tool paths stale-write capable. | |
| PATCH and DELETE only for direct routes | Leaves chat/tool mutation paths without the same authority boundary. | |

**User's choice:** Edit proposed decision.
**Notes:** Replacement wording locked: require `expectedMealRevisionId` for every authoritative mutation of an existing meal: direct `PATCH`, direct `DELETE`, chat/tool `update_meal`, and chat/tool `delete_meal` after the target meal has been resolved. Meal creation/logging is out of scope because there is no prior revision to protect.

---

## Missing Expected Revision Contract

| Option | Description | Selected |
|--------|-------------|----------|
| Fail closed like stale mismatch | Missing `expectedMealRevisionId` causes deterministic conflict/precondition failure, with no mutation or freshness side effects. | yes |
| Legacy compatibility exception | Allow missing expected revision temporarily for older clients. | |
| Client-only guard | Let the frontend prevent missing expected revisions. | |

**User's choice:** Approve proposed decision.
**Notes:** Missing `expectedMealRevisionId` fails closed with the same deterministic stale/precondition family as stale mismatches: no mutation, no new revision, no summary recompute, no publish. No legacy compatibility exception unless a real rollout need is raised later.

---

## Client Recovery Behavior

| Option | Description | Selected |
|--------|-------------|----------|
| Show stale guidance and refresh/invalidate affected rows | Deterministic Traditional Chinese guidance, stale editor blocked or closed, affected row/date refreshed or invalidated. | yes |
| Keep stale editor open and let user retry | Risks repeated writes from stale form state. | |
| Hide stale edit affordances only | Client-only redaction is useful UX but insufficient as the protection boundary. | |

**User's choice:** Approve proposed decision.
**Notes:** On stale conflict, show deterministic Traditional Chinese stale-record guidance, close or block saving from the stale editor/receipt, and immediately refresh or invalidate the affected meal row/date. If refreshed current facts are available, reopen editing from the fresh row/receipt rather than continuing from stale form state.

---

## Stale Conflict HTTP Shape

| Option | Description | Selected |
|--------|-------------|----------|
| 409 Conflict with stable error codes | Matches existing route conflict style and gives the client deterministic branch points. | yes |
| 412 Precondition Failed | Semantically close but introduces a new public convention. | |
| Generic non-OK error | Too vague for deterministic stale guidance and tests. | |

**User's choice:** Approve proposed decision.
**Notes:** Use `409 Conflict` with structured deterministic error codes such as `MEAL_REVISION_STALE` and `MEAL_REVISION_REQUIRED`.

---

## the agent's Discretion

- Planner may choose exact type/module placement as long as read/display identity stays `mealRevisionId` and write precondition stays `expectedMealRevisionId`.
- Planner may choose whether stale conflict response bodies include refreshed meal facts or affected-date metadata for refetch.
- Planner may choose exact deterministic Traditional Chinese stale guidance copy.

## Deferred Ideas

- Legacy compatibility exception for missing `expectedMealRevisionId`, unless a real rollout need is raised later.
- Broader SSE meal-row freshness and affected-date invalidation, which belongs to Phase 63.
