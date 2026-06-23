# ADR 0006: Agent Side-Effect Policy Taxonomy

**Status:** Accepted
**Date:** 2026-06-12
**Milestone:** v2.8 Agent Side-Effect Policy Foundation
**Requirement:** NC-LLM-004 / DOC-01

## Context

Nutrition Coach lets the LLM call backend tools that may read data, create helper state, propose pending changes, or commit meal and goal mutations. Phase 85 moved the side-effect decision out of model prose and into static tool contract metadata plus a tool-boundary policy gate.

The implemented policy needs durable documentation because future tool work can otherwise confuse base side-effect class with named guard or escalation rules. The most important example is `update_goals latest_proposal`: its base class is `direct-execute`, while its latest-proposal mode has a named confirm-first escalation rule. It is not base `confirm-first`.

Routine policy evidence remains metadata-only. This ADR must not rely on raw prompt text, user input, full transcripts, tool arguments, provider payloads, image data, session material, final assistant text, or database snapshots.

## Decision

Document the implemented side-effect policy taxonomy in this ADR and generate the per-tool class table from `server/orchestrator/tools.ts`. The generated table is bounded by `policy-taxonomy-table:start` and `policy-taxonomy-table:end` markers and is checked by `yarn policy-taxonomy:check`.

### Guardrail Layering

Tool execution uses this implemented order:

1. JSON parse rejects invalid tool argument JSON before validation or execution.
2. Zod validation rejects malformed argument shapes.
3. Source-text guard rejects configured numeric authority fields when required evidence is absent from the current user message or allowed prior assistant clarification.
4. Side-effect policy gate evaluates the tool's base class and named rules before `execute`.
5. Execute runs only after the previous guards allow the call; FatalToolError maps to controlled non-executed outcomes where applicable.

This order means the policy gate observes typed arguments after schema and source authority checks, and no domain mutation has run before the side-effect decision is made.

### Output And Receipt Authority Taxonomy

The app treats backend-validated facts as authoritative and treats assistant prose as presentation only:

- Read outcomes, such as summaries, come from backend services and can be reported without mutation.
- Meal log, update, and delete receipts are authoritative only when they include committed backend mutation facts and current revision identity.
- Goal receipts are authoritative only after backend target updates commit.
- Proposal copy is not a commit receipt. It is a pending backend proposal that requires later explicit consent and one-shot consume before mutation.
- Clarification copy is a terminal renderer-owned question or guidance path. It may create narrow helper state only where the tool contract permits it, but it is not a meal, goal, summary, or publish mutation.
- Trace and harness facts are metadata-only policy evidence. They may include `tool`, `policyClass`, `decision`, `ruleId`, optional `proposalId`, and `turnId`, but not raw payloads or session material.

### Per-Tool Reversal Paths

- `log_food` is `execute-and-report`: persistence runs before the receipt, while historical ambiguity, failed recognition, and trusted-protein failures reverse to no-save controlled outcomes.
- `get_daily_summary` is `direct-execute`: read-only summary queries execute directly, while ambiguous historical date requests reverse to clarification without summary publish side effects.
- `find_meals` is `clarify-first`: ambiguous targets reverse to deterministic clarification; resolved targets may write session-scoped target-selection helper state but never mutate meals/goals/summaries.
- `propose_goals` is `confirm-first`: it writes pending proposal authority and reverses the commit into a later confirmation step.
- `update_goals` is `direct-execute`: current-turn numeric values execute directly when source authority passes. `latest_proposal` escalates through the named confirm-first rule and consumes backend proposal state before mutation.
- `propose_meal_numeric_correction` is `confirm-first`: it writes pending meal numeric proposal authority and reverses the commit into a later confirmation step.
- `update_meal` is `direct-execute`: it requires a resolved target, numeric authority for changed numeric fields, and a current revision precondition before commit.
- `delete_meal` is `confirm-first`: setup requires a resolved target and current revision, writes a pending delete proposal, and only a later explicit confirmation consumes that proposal before deleting.

### Classification Rationale

The four base classes describe the default side-effect profile of the registered tool, while named rules describe guard, clarification, setup, or escalation behavior inside that tool.

- `direct-execute` covers read-only tools and guarded direct mutation tools whose required authority is already present in the current turn or resolved backend state.
- `execute-and-report` covers tools that commit a domain mutation and then report the committed result.
- `clarify-first` covers tools that must ask a deterministic question before any domain mutation when target authority is ambiguous.
- `confirm-first` covers setup/proposal tools whose output becomes backend authority for a later explicit confirmation commit.

Named rules preserve important behavior without splitting model-facing tool names. In particular, `update_goals latest_proposal` is base `direct-execute` with named confirm-first rule escalation, not base `confirm-first`.

### Session-Expiry Semantics

Pending goal, meal numeric, and meal delete proposals are scoped by device, session, kind, proposal id, and, for meal mutation approvals, expected meal revision. Pending approval expires or fails closed like existing pending-state TTL behavior; expired or missing pending state is treated as no pending proposal and users must restate or repropose.

Wrong session, wrong proposal id, expired state, wrong expected revision, stale one-shot state, or duplicate confirmation cannot return proposal payload authority.

### Generated Per-Tool Table

<!-- policy-taxonomy-table:start -->

Generated from server/orchestrator/tools.ts.

| Tool | Base class | Named rules / rationale | Notes |
|---|---|---|---|
| `delete_meal` | `confirm-first` | delete_meal_setup_only: Writes pending delete proposal authority but does not mutate meals.<br>delete_meal_requires_resolved_target: Delete proposal setup requires a same-turn resolved target before writing pending helper state.<br>delete_meal_revision_precondition_guard: Delete proposal setup requires the resolved target revision to remain current. | Named rules: delete_meal_setup_only (allowed), delete_meal_requires_resolved_target (blocked), delete_meal_revision_precondition_guard (blocked) |
| `find_meals` | `clarify-first` | find_meals_target_clarification: Ambiguous update/delete targets return renderer-owned clarification instead of mutating meals.<br>find_meals_pending_selection_helper_state: May write session-scoped pending target-selection metadata, never meal, goal, or summary mutations. | Named rules: find_meals_target_clarification (blocked), find_meals_pending_selection_helper_state (allowed) |
| `get_daily_summary` | `direct-execute` | get_daily_summary_historical_date_clarification: Ambiguous or multi-date summary queries return controlled clarification without publish side effects. | Named rules: get_daily_summary_historical_date_clarification (blocked) |
| `log_food` | `execute-and-report` | log_food_failed_recognition_no_save: Failed image recognition returns a renderer-owned no-save reply without meal or summary mutation.<br>log_food_historical_date_clarification: Historical date ambiguity returns one controlled clarification without meal or summary mutation.<br>log_food_trusted_protein_basis_guard: Unsupported trusted-protein inputs fail closed before persistence. | Named rules: log_food_failed_recognition_no_save (blocked), log_food_historical_date_clarification (blocked), log_food_trusted_protein_basis_guard (blocked) |
| `plan_next_meal` | `direct-execute` | plan_next_meal_authoritative_current_facts: Computes current planning facts from authenticated-device summary and target services.<br>plan_next_meal_no_mutation: Returns planning facts only and does not mutate meals, goals, proposals, receipts, or cards. | Named rules: plan_next_meal_authoritative_current_facts (allowed), plan_next_meal_no_mutation (allowed) |
| `propose_goals` | `confirm-first` | propose_goals_setup_only: Writes pending proposal authority but does not mutate device goals. | Named rules: propose_goals_setup_only (allowed) |
| `propose_meal_estimate` | `confirm-first` | propose_meal_estimate_setup_only: Writes bounded model-estimate proposal authority but does not mutate meals.<br>propose_meal_estimate_requires_resolved_target: Estimate proposal setup requires a same-turn resolved target before writing pending helper state.<br>propose_meal_estimate_bounds_validation: Model-estimated numeric values must pass strict field presence, uniqueness, and single-field bounds before persistence. | Named rules: propose_meal_estimate_setup_only (allowed), propose_meal_estimate_requires_resolved_target (blocked), propose_meal_estimate_bounds_validation (blocked) |
| `propose_meal_numeric_correction` | `confirm-first` | propose_meal_numeric_correction_setup_only: Writes pending proposal authority but does not mutate meals.<br>propose_meal_numeric_correction_requires_resolved_target: Proposal setup requires a same-turn resolved target before writing pending helper state. | Named rules: propose_meal_numeric_correction_setup_only (allowed), propose_meal_numeric_correction_requires_resolved_target (blocked) |
| `update_goals` | `direct-execute` | update_goals_current_turn_source_guard: Current-turn target updates require source-text evidence for numeric fields.<br>update_goals_latest_proposal_confirm_first: Latest-proposal commits escalate to confirm-first proposal authorization.<br>update_goals_latest_proposal_cancel: Latest-proposal cancellation may clear pending proposal state without committing goals. | Named rules: update_goals_current_turn_source_guard (blocked), update_goals_latest_proposal_confirm_first (blocked), update_goals_latest_proposal_cancel (allowed) |
| `update_meal` | `direct-execute` | update_meal_requires_resolved_target: Direct meal updates require a same-turn resolved target.<br>update_meal_numeric_authority_guard: Numeric changes must pass current-turn source authority before write.<br>update_meal_revision_precondition_guard: Direct meal updates require the resolved target revision to remain current. | Named rules: update_meal_requires_resolved_target (blocked), update_meal_numeric_authority_guard (blocked), update_meal_revision_precondition_guard (blocked) |

<!-- policy-taxonomy-table:end -->

## Consequences

- Documentation drift in the per-tool table fails `yarn policy-taxonomy:check`.
- Future registry changes must update source metadata first, then regenerate the ADR table.
- Base class and named rule escalation remain visually separate, reducing the risk of reclassifying tools by accident.
- The ADR documents implemented behavior only; it does not add chat-session UI, new policy classes, new trace payload fields, or runtime policy changes beyond the recorded tool-policy behavior.

## Verification

Use these commands and artifacts to verify the taxonomy and proof remain current:

- `yarn verify:harness -- policy-side-effect-gate`
- `tests/harness/artifacts/policy-side-effect-gate/latest/`
- `yarn policy-taxonomy:check`

The harness artifact path is generated local evidence. The ADR links to the path and commands only; it does not embed raw transcripts, payloads, session material, image data, or database snapshots.
