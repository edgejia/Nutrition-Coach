# Phase 60: Goal Proposal Authority and Rejected-Goal Copy - Context

**Gathered:** 2026-05-17
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 60 makes daily target changes backend-authoritative. Users can only change daily targets through explicit current-turn numeric values or a valid backend-owned pending goal proposal, and failed or canceled goal-update paths must return deterministic backend copy without mutating targets or publishing `goals_update`.

</domain>

<decisions>
## Implementation Decisions

### Proposal Creation Authority
- **D-01:** Add a separate `propose_goals` backend tool/contract. It creates structured backend-owned pending goal proposals instead of parsing assistant prose.
- **D-02:** `propose_goals` must replace the current prompt-only ambiguous goal recommendation flow. Ambiguous goal-change intent naturally asks for concrete confirmable target values, and Phase 60 requires those values to become backend-owned pending proposal state.
- **D-03:** `propose_goals` returns deterministic backend-rendered Traditional Chinese proposal copy. The model must not author the user-visible proposal recommendation.
- **D-04:** Keep proposal and mutation responsibilities split: `propose_goals` persists pending proposals and renders proposal copy; `update_goals` remains the mutation path.

### Proposal Identity and Lifecycle
- **D-05:** Allow one active pending goal proposal per device. This matches the existing `turn_states` `(deviceId, kind)` uniqueness pattern and keeps short confirmations like `好` unambiguous.
- **D-06:** A newer `propose_goals` overwrites the previous pending goal proposal for that device.
- **D-07:** Pending goal proposals expire after 30 minutes.
- **D-08:** Any successful `update_goals` target persistence clears pending proposal state, whether the success came from the proposal path or from current-turn explicit numeric values. Clearing follows committed target persistence, not later `goals_update` publish or summary/recompute success; post-persist publish/recompute failure must not leave the proposal available to reapply.
- **D-09:** Validation failure, source guard failure, proposal mismatch, and execution failure must not mutate targets, must not publish `goals_update`, and should not consume the pending proposal for ordinary retryable failures.
- **D-10:** Expired proposals are cleared or treated as unavailable and must not mutate targets.
- **D-11:** Explicit rejection/cancel terms such as `不要`, `取消`, `先不用`, or `no` should clear the active pending proposal.

### Confirmation Matching Rules
- **D-12:** Short consent text may confirm the latest active proposal, but authorization belongs to a backend predicate, not LLM judgment. Candidate consent terms include `好`, `可以`, `幫我更新`, `就這樣`, and `用這組`.
- **D-13:** Reverse/cancel terms such as `不要`, `取消`, `先不用`, and `no` must be excluded from confirmation.
- **D-14:** Proposal-path `update_goals` must require both explicit consent in the current user message and an active non-expired pending proposal. If either condition is missing, fail closed with deterministic copy, no target mutation, and no `goals_update`.
- **D-15:** Do not use empty args to mean proposal confirmation. `update_goals` needs an explicit proposal mode.
- **D-16:** Prefer hidden `proposal_id` for the explicit proposal mode only if planning proves the next-turn LLM can reliably receive and use it without exposing it in user-facing copy.
- **D-17:** If hidden `proposal_id` handoff cannot be proven reliable, use an explicit single-active latest-proposal mode instead of forcing an internal id through a brittle path.
- **D-18:** Explicit current-turn numeric updates override any pending proposal and, on success, clear pending proposal state.
- **D-19:** Mixed confirmation plus edits, such as `好，但蛋白質 130`, should apply the pending proposal values plus explicit current-turn overrides, then clear the proposal after successful mutation.

### Proposal Copy Shape
- **D-20:** Backend-rendered proposal copy must list the exact proposed targets and include clear confirmation/modification instructions.
- **D-21:** Proposal copy must not include LLM-style rationale or success-tone wording. Exact strings are left for planning and tests.

### Rejected-Goal and Cancel Copy
- **D-22:** Proposal/authority failures share one generic deterministic fail-closed copy. This includes missing, expired, consumed, mismatch, replaced/unavailable, and guard-unauthorized proposal states; planning should not infer that each bucket requires a distinct internal reason enum.
- **D-23:** Validation range failures get field-specific deterministic copy. Internal reason granularity, renderer shape, and multi-field range details are left for planning.
- **D-24:** Explicit cancel is a user-cancel path, not part of the rejected-goal failure taxonomy. Cancel clears active pending proposal, does not mutate targets, does not publish `goals_update`, and returns backend deterministic neutral copy saying the proposal was not applied and the user can later provide new numbers or ask for a new recommendation. Exact wording is left to planning.
- **D-25:** Failed `update_goals` authority/proposal/validation paths and explicit cancel paths must directly control the final reply with backend-owned copy. They must not enter a later LLM rewrite round.
- **D-26:** Final reply metadata should identify rejected-goal/cancel copy as renderer/backend-owned rather than model-authored. Whether that is implemented through tool result, orchestrator branch, or route short-circuit is left for planning after inspecting the existing mutation receipt path.

### Proof Expectations
- **D-27:** Phase 60 proof should use exact-copy assertions for three representative deterministic copies: generic proposal/authority fail-closed copy, field-specific validation range copy, and cancel neutral copy.
- **D-28:** Proof must also assert negative invariants: targets unchanged, no `goals_update` publish, final reply is renderer/backend-owned, no LLM-authored success-style prose, and no forbidden internal terms.
- **D-29:** Do not require every internal reason code to have different exact user copy because proposal/authority failures intentionally share generic copy. Test layering, exact files, and macro matrix are left for planning.

### the agent's Discretion
- Planner may choose the exact schema for explicit proposal mode after proving whether hidden `proposal_id` handoff is reliable.
- Planner may choose exact deterministic Traditional Chinese copy strings and renderer shape, as long as the copy invariants above are preserved and tested.
- Planner may choose the implementation location for backend-owned rejected/cancel final replies after inspecting the existing mutation receipt path.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Planning Scope
- `.planning/ROADMAP.md` — Phase 60 goal, success criteria, dependency, and implementation notes.
- `.planning/REQUIREMENTS.md` — GOAL-01 through GOAL-04 requirements and v2.3 proof/privacy constraints.
- `.planning/PROJECT.md` — v2.3 milestone context, current state, constraints, and key decisions.
- `.planning/STATE.md` — Current workflow position and accumulated v2.3 decisions.

### Codebase Maps
- `.planning/codebase/ARCHITECTURE.md` — Route/service/orchestrator boundaries, `turn_states`, tool registry, realtime publisher, and mutation receipt architecture.
- `.planning/codebase/STACK.md` — TypeScript/Fastify/SQLite/Drizzle/OpenAI testing and runtime stack.
- `.planning/codebase/INTEGRATIONS.md` — OpenAI, SQLite, EventSource, guest-session, logging, and metadata-only observability constraints.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `server/services/turn-state.ts` and `server/db/schema.ts` `turn_states` table: existing persisted, expiring, one-per-device-kind state pattern suitable for pending goal proposals.
- `server/orchestrator/tool-contract.ts`: existing controlled validation, guard, execute, and redacted logging runner for tool contracts.
- `server/orchestrator/tools.ts`: current `update_goals` contract, source-field guard, deterministic success receipt, `goals_update` publish, and tool-result mapping.
- `server/orchestrator/mutation-receipts.ts`: existing backend-owned success receipt renderer and forbidden-term checks; rejected/cancel renderers should stay near this pattern or a close sibling.
- `tests/unit/update-goals-contract.test.ts` and `tests/integration/chat-goal-update.integration.test.ts`: existing goal-update coverage to extend for proposal authority, deterministic failed copy, no publish, and final-reply source behavior.

### Established Patterns
- Routes own HTTP/SSE boundaries; services own reusable persistence/domain logic; orchestrator/tools own model tool contracts and mutation outcomes.
- Runtime dependencies are wired through `server/app.ts`; services and routes should receive dependencies rather than constructing them directly.
- Protected browser routes derive ownership from signed guest-session cookies, not raw `deviceId` query params or headers.
- Existing mutation success receipts are backend-rendered and can bypass model-authored final prose; Phase 60 should reuse that authority model for failed/cancel goal copy.
- Routine logs/traces remain metadata-only: no raw prompts, user text, assistant final text, tool raw payloads, provider bodies, image data, session material, or database snapshots.

### Integration Points
- `server/orchestrator/system-prompt.ts`: current prompt-only ambiguous goal recommendation guidance must be updated to prefer `propose_goals`.
- `server/orchestrator/tools.ts`: add `propose_goals`; update `update_goals` to support explicit proposal mode without empty-args inference.
- `server/services/device.ts`: current target mutation boundary remains the final persistence authority for successful `update_goals`.
- `server/realtime/publisher.ts`: no `goals_update` may publish for proposal creation, failed proposal application, validation rejection, or cancel.
- `server/routes/chat.ts` and `server/orchestrator/index.ts`: planner must inspect where backend-owned failed/cancel copy should short-circuit final reply and metadata.

</code_context>

<specifics>
## Specific Ideas

- Preferred tool names: `propose_goals` for proposal creation and `update_goals` for mutation.
- Candidate consent vocabulary: `好`, `可以`, `幫我更新`, `就這樣`, `用這組`.
- Candidate cancel vocabulary: `不要`, `取消`, `先不用`, `no`.
- Pending proposal TTL: 30 minutes.
- Proposal copy must list exact proposed calories, protein, carbs, and fat targets with clear confirm/modify instructions.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 60-Goal Proposal Authority and Rejected-Goal Copy*
*Context gathered: 2026-05-17*
