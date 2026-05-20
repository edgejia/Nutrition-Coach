# Phase 60: Goal Proposal Authority and Rejected-Goal Copy - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-17
**Phase:** 60-Goal Proposal Authority and Rejected-Goal Copy
**Areas discussed:** Proposal Creation Authority, Proposal Identity and Lifecycle, Confirmation Matching Rules, Rejected-Goal Copy, Proposal Copy Shape, Proposal Id Handoff Fallback

---

## Proposal Creation Authority

| Option | Description | Selected |
|--------|-------------|----------|
| Dedicated tool | Add a proposal tool/contract so recommendations become structured backend state instead of parsed assistant prose. | ✓ |
| Parse reply | Extract numbers from assistant recommendation text and persist them, with less tool surface but more brittle authority. | |
| Agent decides | Let planning choose the smallest backend-owned approach after deeper code inspection. | |

**User's choice:** Dedicated backend tool/contract.
**Notes:** User chose to replace prompt-only recommendations with `propose_goals` because ambiguous goal-change intent should produce concrete confirmable targets owned by the backend. User also chose backend-rendered proposal copy and a separate `propose_goals` tool from `update_goals`.

---

## Proposal Identity and Lifecycle

| Option | Description | Selected |
|--------|-------------|----------|
| One active proposal per device | Fits existing `turn_states` unique `(deviceId, kind)` pattern and keeps `好` unambiguous. | ✓ |
| Multiple proposals by id | More flexible, but requires disambiguation when the user says only `好`. | |
| Agent decides | Planner chooses after inspecting turn-state and chat history flows. | |

**User's choice:** One active pending goal proposal per device.
**Notes:** New `propose_goals` overwrites old proposals. TTL is 30 minutes. Any successful `update_goals` mutation clears pending proposal state. Validation, guard, mismatch, and ordinary execution failures do not consume proposal state. Expired proposals cannot mutate. Explicit rejection should clear the active proposal.

---

## Confirmation Matching Rules

| Option | Description | Selected |
|--------|-------------|----------|
| Short consent confirms latest pending proposal | `好`, `可以`, `幫我更新`, `就這樣` can apply the single active non-expired proposal. | ✓ |
| Require explicit proposal id | Stronger authority, but unnatural in chat and awkward because there is only one active proposal. | |
| Agent decides | Planner chooses the confirmation grammar. | |

**User's choice:** Short consent can confirm, but backend predicate owns authorization.
**Notes:** Reverse/cancel terms must be excluded. Proposal-path `update_goals` requires explicit current-turn consent and an active non-expired proposal. Empty args must not represent proposal confirmation. `update_goals` needs explicit proposal mode, preferably hidden `proposal_id` only if planner proves reliable hidden handoff. Current-turn numeric updates override and clear pending proposal on success. Mixed confirmation plus edits applies proposal values plus explicit overrides.

---

## Rejected-Goal Copy

| Option | Description | Selected |
|--------|-------------|----------|
| One generic fail-closed message | Proposal/authority failures share safe deterministic copy. | ✓ |
| Reason-specific copy | Different messages for missing, expired, consumed, mismatch, validation range, and cancel. | |
| Agent decides | Planner chooses minimal deterministic copy coverage for tests. | |

**User's choice:** Generic proposal/authority fail-closed copy, with validation range exception.
**Notes:** Validation range failures get field-specific copy. Explicit cancel clears the active proposal and returns neutral backend copy, but is not part of rejected-goal failure taxonomy. Failed/cancel copy directly controls final reply and bypasses later LLM rewriting. Proof should exact-match representative copies and assert targets unchanged, no `goals_update`, renderer/backend-owned final reply, no LLM success-style prose, and no forbidden internal terms.

---

## Proposal Copy Shape

| Option | Description | Selected |
|--------|-------------|----------|
| Minimum backend proposal copy contract | List exact proposed targets and clear confirmation/modification instructions; no LLM-style rationale or success tone. | ✓ |

**User's choice:** Lock minimum content and tone; exact strings left for planning.
**Notes:** Added after the initial four areas were completed.

---

## Proposal Id Handoff Fallback

| Option | Description | Selected |
|--------|-------------|----------|
| Conditional hidden proposal id | Use hidden `proposal_id` only if planner proves reliable next-turn LLM handoff without user exposure. | ✓ |
| Single-active fallback | If hidden handoff cannot be proven, use explicit single-active latest-proposal mode. | ✓ |

**User's choice:** Prefer hidden `proposal_id` only with proof; otherwise fall back to latest active proposal mode.
**Notes:** User explicitly rejected forcing internal ids through a brittle handoff.

---

## the agent's Discretion

- Exact deterministic Traditional Chinese strings are left to planning, with exact-copy representative tests.
- Planner decides the final explicit proposal-mode schema after proving hidden `proposal_id` handoff reliability.
- Planner decides the implementation location for backend-owned failed/cancel final replies after inspecting the existing mutation receipt path.

## Deferred Ideas

None.
