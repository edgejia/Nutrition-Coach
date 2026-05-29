# Phase 66 Source Audit

SOURCE | ID | Feature/Requirement | Plan | Status | Notes
--- | --- | --- | --- | --- | ---
GOAL | — | Users cannot have meal calories or macros changed by model-estimated chat patches unless the current turn supplies explicit numeric evidence or the backend owns an approved estimate/proposal. | 66-01, 66-02, 66-03, 66-04, 66-05 | COVERED | Helper authority, proposal state, tool enforcement, proposal routing, and integration proof.
REQ | CORR-01 | Chat meal numeric fields change only with current-turn explicit numeric evidence or approved backend-owned proposal. | 66-01, 66-03, 66-04, 66-05 | COVERED | Includes top-level and `items[]` numeric fields.
REQ | CORR-02 | Vague requests do not mutate directly; backend returns deterministic clarification or proposal copy. | 66-01, 66-02, 66-03, 66-05 | COVERED | Includes vague, direction-only, and locked relative operator paths.
REQ | CORR-03 | Rejected/clarification-required corrections create no revision, no `daily_summary`, and no LLM-authored success copy. | 66-02, 66-03, 66-04, 66-05 | COVERED | Integration plan proves route/SSE side effects.
RESEARCH | R-01 | Enforce provenance before `mealCorrectionService.updateMeal()`. | 66-01, 66-03 | COVERED | Backend guard is the enforcement point.
RESEARCH | R-02 | Use `turn_states` via a dedicated meal numeric proposal service. | 66-02, 66-04 | COVERED | No new table or package.
RESEARCH | R-03 | Preserve Phase 62 expected revision preconditions for proposal approval. | 66-02, 66-04, 66-05 | COVERED | Stored expected revision feeds existing update path.
RESEARCH | R-04 | Add cross-kind proposal ambiguity routing before model calls. | 66-04, 66-05 | COVERED | Bare approval fails closed when meal and goal proposals coexist.
RESEARCH | R-05 | Keep renderer-owned blocked/proposal copy in `mutation-receipts.ts`. | 66-02, 66-03, 66-04, 66-05 | COVERED | Controlled replies prevent later model rewrite.
RESEARCH | R-06 | Remove prompt instruction that lets the model estimate and directly apply meal correction numbers. | 66-05 | COVERED | Prompt support only; backend guard remains authoritative.
RESEARCH | R-07 | Prove blocked correction no mutation/publish/success-text behavior with automated tests. | 66-05 | COVERED | Uses unit and integration gates from validation strategy.
CONTEXT | D-01 | Direct numeric mutation authority only from current-turn final targets or approved active backend proposal. | 66-01, 66-03 | COVERED | Cited in plan truths and task criteria.
CONTEXT | D-02 | Ordinary prior assistant prose is not authoritative unless stored as backend proposal and approved. | 66-01 | COVERED | Direct helper rejects prior assistant number approval.
CONTEXT | D-03 | Accept Arabic integers/decimals, Chinese compounds/bare digits, and unit variants as explicit final values. | 66-01, 66-05 | COVERED | Helper tests include accepted matrix.
CONTEXT | D-04 | Relative/broad quantity phrases do not directly authorize; only locked deterministic operators trigger proposals. | 66-01, 66-03 | COVERED | Helper classification and proposal tool.
CONTEXT | D-05 | Non-computable vague phrases ask for clarification unless estimator exists. | 66-01, 66-03 | COVERED | Estimator remains out of scope.
CONTEXT | D-06 | Guard applies to top-level nutrition fields and numeric `items[]` values. | 66-01, 66-03 | COVERED | Items bypass proof included.
CONTEXT | D-07 | Current-turn explicit meal-level number authorizes grouped meal total and may keep proportional distribution. | 66-01 | COVERED | Helper accepts grouped total as provenance only.
CONTEXT | D-08 | Vague non-computable requests do not create proposals by default; return concise clarification. | 66-02, 66-03, 66-05 | COVERED | Renderer copy and integration proof.
CONTEXT | D-09 | Clarification offers explicit target, computable adjustment, or direction next. | 66-02, 66-03, 66-05 | COVERED | Copy criteria.
CONTEXT | D-10 | Direction alone is not enough to synthesize a number. | 66-01, 66-03, 66-05 | COVERED | Direction-only tests.
CONTEXT | D-11 | Limit computable signals; defer item add/remove, heuristics, defaults, medians, trusted-protein redistribution. | 66-01, 66-03, 66-05 | COVERED | Explicit deferred scope checks.
CONTEXT | D-12 | Unauthorized model-supplied numbers are not echoed as proposals or offered for approval. | 66-01, 66-03, 66-05 | COVERED | Blocked copy avoids unsafe numbers.
CONTEXT | D-13 | Blocked unauthorized updates short-circuit to renderer-owned Traditional Chinese guidance. | 66-02, 66-03, 66-05 | COVERED | Controlled reply plans.
CONTEXT | D-14 | Blocked/clarification paths create no revision, publish no summary, show no success copy. | 66-02, 66-03, 66-05 | COVERED | Route-level proof.
CONTEXT | D-15 | Clarification starts no-update, is field-aware, concise Traditional Chinese, and avoids internal jargon. | 66-02, 66-05 | COVERED | Renderer denylist and copy criteria.
CONTEXT | D-16 | Introduce deterministic backend-owned numeric correction proposals now, narrow scope. | 66-02, 66-03, 66-05 | COVERED | Proposal service and tool.
CONTEXT | D-17 | Proposal values come from backend computation over persisted facts, never LLM args/prose. | 66-02, 66-03 | COVERED | Proposal tool computes values.
CONTEXT | D-18 | One active single-use proposal per device, scoped to meal id and expected revision. | 66-02, 66-03 | COVERED | Turn-state payload.
CONTEXT | D-19 | Proposal carries id, meal id, expected revision, patch/items, fields, operator, created time, expiry. | 66-02, 66-03 | COVERED | Service payload tests.
CONTEXT | D-20 | Approval commits only active proposal with current expected revision through existing precondition path. | 66-03, 66-04, 66-05 | COVERED | Router applies stored update input.
CONTEXT | D-21 | Same-kind proposal replaces previous; approval/cancel/expiry/replacement clears proposal. | 66-02, 66-04 | COVERED | Lifecycle tests.
CONTEXT | D-22 | Reuse short approval/cancel wording; approval only when one active backend proposal is identified. | 66-04 | COVERED | Router tests.
CONTEXT | D-23 | Cancel phrases take precedence over approval matching. | 66-04, 66-05 | COVERED | Broad cancel first.
CONTEXT | D-24 | Proposal copy shows meal, fields, before/after, approval/adjust prompt, `kcal`/`g`. | 66-02, 66-03 | COVERED | Renderer tests.
CONTEXT | D-25 | Single and multi-field proposals show affected before/after values. | 66-02, 66-03 | COVERED | Renderer tests.
CONTEXT | D-26 | Meal labels use item names or concise combined labels when available. | 66-02, 66-03 | COVERED | Renderer criteria.
CONTEXT | D-27 | Do not show formulas by default; short operator label is acceptable. | 66-02, 66-05 | COVERED | Renderer and prompt criteria.
CONTEXT | D-27a | Proposal creation copy discloses when another proposal kind is active. | 66-02, 66-04, 66-05 | COVERED | Copy and cross-kind routing.
CONTEXT | D-28 | Bare approval commits only when exactly one active approvable proposal exists. | 66-04, 66-05 | COVERED | Both-active fail-closed tests.
CONTEXT | D-29 | Multiple proposal kinds ask user to specify meal correction or goal update. | 66-04, 66-05 | COVERED | Disambiguation renderer.
CONTEXT | D-30 | Kind-specific approval selects active kind without reconstructing values. | 66-04, 66-05 | COVERED | Router uses stored payload.
CONTEXT | D-31 | Creating meal proposal does not clear goal proposal and vice versa. | 66-02, 66-04, 66-05 | COVERED | Distinct turn-state kind.
CONTEXT | D-32 | Broad cancel clears all active approvable proposal kinds; kind-specific cancel clears one. | 66-04, 66-05 | COVERED | Cancel router tests.

No missing source items. Deferred ideas from `66-CONTEXT.md` remain out of scope and are explicitly excluded in plan traceability.
