# ADR 0002: Correction Authority and Meal Intent

## Status

Accepted for v2.4.

## Context

Nutrition Coach can mutate persisted meal facts through LLM tool calls. Before v2.4, two authority gaps remained: explicit meal-period wording could be overridden by clock-derived heuristics, and vague chat corrections could change calories or macros from model-estimated values.

The product needs correction flows to stay easy, but persisted facts must come from evidence the backend can defend.

## Decision

- Persist explicit meal-period intent in `meal_transactions.meal_period` as nullable structured authority, separate from `loggedAt`.
- Treat clock-derived meal period as display fallback only when no persisted authority exists.
- Allow chat numeric meal corrections only when the current user turn provides explicit numeric evidence or the user approves a backend-owned proposal.
- Render ambiguous correction targets and historical tool clarifications from backend-owned structured facts.
- Carry clarification facts through `ToolExecutionResult.clarification` instead of reparsing serialized tool-message JSON in the orchestrator.

## Consequences

- Meal rows, history, receipts, and edit payloads can preserve explicit user intent without manufacturing authority for legacy rows.
- Vague requests such as "make the protein more reasonable" fail closed into clarification or proposal copy rather than committing model estimates.
- Correction target selection is more verbose internally because it must retain evidence tier, candidate facts, rendered options, and stale-selection checks.
- The orchestrator tool registry remains large; v2.4 makes the authority boundary safer but increases pressure to split tool contracts into smaller modules later.

## Verification

v2.4 Phase 65-68 verification covers schema/runtime alignment, explicit meal-period persistence/projection, numeric correction authority, target ranking, backend clarification rendering, structured tool-result plumbing, metadata-only evidence, and local release gates.
