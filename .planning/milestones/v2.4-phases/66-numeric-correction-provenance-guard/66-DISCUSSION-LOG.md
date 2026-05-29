# Phase 66: Numeric Correction Provenance Guard - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-28
**Phase:** 66-Numeric Correction Provenance Guard
**Areas discussed:** Numeric Evidence Boundary, Vague Correction Response, Backend Proposal/Approval Lifecycle, Cross-Kind Proposal Ambiguity

---

## Numeric Evidence Boundary

| Question | Options Considered | User's Choice |
|----------|--------------------|---------------|
| What should authorize a numeric meal correction for calories, protein, carbs, or fat? | Exact current-turn numeric value only; Current turn plus approved backend proposal; Also allow assistant prior-turn suggestions; Other | Current turn plus approved backend-owned proposal |
| Which numeric forms should count as explicit numeric evidence? | Exact target numbers only; Exact numbers plus simple relative math; Broad quantity language; Other | Other: explicit final target values only for direct mutation; computable relative phrases can create proposals |
| Should the guard apply only to whole-meal numeric patch fields, or also to items replacement payloads? | All numeric meal fields including `items`; Top-level patch only; Different rules by field; Other | All numeric meal fields, including `items[]` |
| When a user gives one explicit final meal-level number for a grouped meal, how should backend apply it? | Keep existing proportional distribution; Require item-level numbers; Create proposal for grouped meals; Other | Keep existing proportional distribution |

**Notes:** Prior assistant prose must not authorize mutation unless it was stored as a backend-owned proposal. Relative and broad quantity language cannot directly mutate. `items[]` replacement must not bypass the guard. Existing grouped-meal proportional distribution is acceptable for Phase 66 provenance, while trusted-protein-aware distribution is deferred.

**Supersession notes:** The earlier "exact target numbers only" option was superseded by keeping backend-owned deterministic proposals as a live authority branch. The "exact numbers plus simple relative math" option was narrowed: relative/computable phrases do not mutate directly; they can only create backend-computed proposals from the locked operator set. Broad quantity language and assistant prose authority remain rejected.

---

## Vague Correction Response

| Question | Options Considered | User's Choice |
|----------|--------------------|---------------|
| For vague numeric correction requests, what should the backend do by default? | Ask for explicit numbers; Offer deterministic proposal when computable; Always offer a proposal; Other | Offer deterministic proposal only when computable, otherwise clarify |
| What should count as a computable signal for a backend-owned proposal in Phase 66? | Only deterministic math from current facts; Math plus structured item removal/addition; Food-size heuristics; Other | Only deterministic math from current persisted facts |
| For blocked direct tool calls where the model tried `update_meal` with unauthorized numbers, what user-facing copy should win? | Backend renderer copy immediately; Tool failure goes back to model; Silent no-op with generic fallback; Other | Backend renderer copy immediately |
| What should the clarification copy optimize for? | Actionable correction input; Policy explanation; Minimal refusal; Other | Actionable correction input |

**Notes:** Non-computable vague requests should not create proposals. Clarification copy should say the record was not updated, offer supported next steps, avoid internal policy/tool language, and must not echo unauthorized model-supplied values as proposals.

**Supersession notes:** "Always offer a proposal" was rejected after the computable-signal discussion. Structured item removal/addition and food-size heuristics were explicitly deferred rather than included as proposal triggers. The final proposal-trigger set is only half / reduce by percentage / add or subtract N units from current persisted facts.

---

## Backend Proposal/Approval Lifecycle

| Question | Options Considered | User's Choice |
|----------|--------------------|---------------|
| Should Phase 66 introduce backend-owned numeric correction proposals now? | Introduce deterministic proposals now; Guard only, no proposals yet; Design types only; Other | Introduce deterministic proposals now |
| How should an active numeric correction proposal be scoped and consumed? | One active proposal per device, single-use; One active proposal per meal; Stateless approval token; Other | One active proposal per device, single-use |
| Which approval/cancel wording should apply to numeric correction proposals? | Reuse Phase 60-style short approval/cancel; Require numbered or explicit phrase approval; Field-specific approval; Other | Reuse Phase 60-style short approval/cancel |
| What should proposal copy disclose before approval? | Target meal, fields, before/after numbers, and approval prompt; Only new values; Calculation details; Other | Target meal, every affected field, before/after numbers, and approval prompt |

**Notes:** Proposal values must come from backend deterministic computation, not LLM tool-call args or assistant prose. Proposal approval must use the existing meal revision precondition path for staleness. Proposal copy should use kcal/g and omit formulas by default.

**Supersession notes:** "Guard only" and "design types only" were rejected because deterministic proposal approval is part of the selected authority path. "One active proposal per meal" and stateless approval tokens were rejected in favor of the existing active-state/latest-proposal pattern. TTL remains planner-calibrated, but the final lifecycle decision supersedes open-ended ambiguity: active proposals are single-use, same-kind replacement applies, stale approval reuses meal revision preconditions, and cancel/expiry/replacement clear state.

---

## Cross-Kind Proposal Ambiguity

| Question | Options Considered | User's Choice |
|----------|--------------------|---------------|
| If both a goal proposal and meal correction proposal are active, what should bare approval like `好` apply to? | Fail closed and ask which proposal; Latest surfaced proposal wins; Creating one clears the other; Other | Fail closed and ask which proposal |
| What should explicit approval look like when multiple proposal kinds are active? | Kind-specific phrases; Numbered disambiguation; Require cancelling one first; Other | Kind-specific phrases |
| Should creating a meal correction proposal affect existing goal proposals? | Keep other proposal kinds active; Clear goal proposal when meal proposal is created; Clear meal proposal when goal proposal is created; Other | Keep other proposal kinds active |
| What should cancel wording do when multiple proposal kinds are active? | Bare cancel clears all active proposal kinds; Bare cancel fails closed too; Bare cancel clears latest surfaced only; Other | Bare cancel clears all active proposal kinds |

**Notes:** Bare approval is safe only when exactly one active approvable proposal exists. Kind-specific approval selects the proposal kind without reconstructing values from prose. Cross-kind proposal state should not be silently discarded, but broad cancel can clear all active proposal kinds because cancel is no-mutation.

**Supersession notes:** Latest-created/latest-surfaced proposal winning was rejected as too weak for mutation authority. Cross-kind clearing on proposal creation was rejected because it silently discards user-visible pending state. The final ambiguity rule supersedes both: cross-kind proposals can coexist; bare approval fails closed when more than one approvable proposal kind is active; kind-specific approval selects a kind; broad cancel clears all active proposal kinds.

## the agent's Discretion

- Exact TTL and internal names for numeric correction proposal state, within the locked single-use active-state lifecycle.
- Exact renderer copy wording within the locked behavioral constraints.
- Exact test split between unit and integration coverage, subject to the repo verification matrix.

## Artifact Tightening Notes

- Planning must update `server/orchestrator/system-prompt.ts` because the current meal correction prompt still allows model-selected reasonable numeric corrections to be directly applied.
- Planning must resolve how approved stored numeric correction proposals enter the current `update_meal` write path, because today `update_meal` depends on `find_meals` seeding `resolvedMealTargets`.
- Planning must explicitly cover decimals and bare Chinese-digit evidence if they remain accepted, because the current source-text guard is narrower than the accepted evidence matrix.
- Exact approval/cancel vocabulary should follow or reuse the existing Phase 60 consent/cancel helpers, including `用這組`.
- Proposal creation copy should tell the user when another proposal kind is also active, so bare approval will require disambiguation.

## Deferred Ideas

- Trusted-protein-aware grouped correction distribution.
- Structured item removal/addition proposal authority.
- Food-size heuristics, food database defaults, historical medians, and deterministic estimator design for future correction proposals.
