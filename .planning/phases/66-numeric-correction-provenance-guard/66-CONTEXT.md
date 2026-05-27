# Phase 66: Numeric Correction Provenance Guard - Context

**Gathered:** 2026-05-28
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 66 makes server-side provenance authoritative for chat meal numeric corrections. Users can mutate persisted meal calories or macros only when the current turn supplies explicit final target numbers, or when they explicitly approve an active backend-owned numeric correction proposal computed deterministically from current persisted meal facts. The phase must preserve Phase 62 revision preconditions and Phase 61 summary-outcome behavior, and blocked or clarification-required corrections must not create revisions, publish `daily_summary`, or show LLM-authored success-style copy.

</domain>

<decisions>
## Implementation Decisions

### Numeric Evidence Boundary
- **D-01:** Direct `update_meal` numeric mutation authority comes only from explicit current-turn final target values or explicit approval of an active backend-owned numeric correction proposal.
- **D-02:** Ordinary prior assistant prose is not authoritative. If the previous assistant text contains a number, it can authorize mutation only when that value was also stored as a valid backend-owned proposal and the user approves that proposal.
- **D-03:** Explicit final target values may be written as Arabic numerals, decimals, common Chinese numerals, and unit variants such as `28g`, `28 克`, `500 卡`, or `500 kcal`. Units are normalized; the value must express the final target.
- **D-04:** Relative or broad quantity phrases do not directly authorize numeric patches. Computable phrases such as `半份`, `減半`, `少 20%`, `加 10g`, or `少 10g` may only create deterministic backend proposals from current persisted facts and require later approval.
- **D-05:** Non-computable vague phrases such as `合理一點` or `蛋白質怪怪的` must ask for clarification unless a separately defined deterministic backend estimator exists.
- **D-06:** The guard applies to every numeric nutrition field written by `update_meal`, including top-level `calories` / `protein` / `carbs` / `fat` patch fields and numeric values inside `items[]` replacement payloads. `items[]` must not become a bypass.
- **D-07:** A current-turn explicit meal-level number authorizes a grouped meal total for that field. Phase 66 may keep the existing deterministic proportional distribution across current items. This is a provenance decision only, not a claim that the current protein distribution semantics are nutritionally ideal.

### Vague Correction Response
- **D-08:** Vague non-computable numeric correction requests do not create numeric proposals by default. The backend should return one concise clarification that helps the user continue.
- **D-09:** Clarification copy should offer supported next inputs: an explicit target number, a computable adjustment such as `減半` / `少 20%`, or a simple direction such as `偏高` / `偏低`.
- **D-10:** Direction alone, such as `偏高`, is not enough to synthesize a number. It should prompt for a target number or computable adjustment next.
- **D-11:** Phase 66 computable signals are limited to deterministic math from current persisted facts. Structured item removal/addition (`少一顆蛋`), food-size heuristics (`雞腿比較小`, `飯少一點`), food database defaults, historical medians, and trusted-protein-aware redistribution are deferred.
- **D-12:** Unauthorized model-supplied numeric values must not be echoed as proposals or offered for approval. A blocked value from a tool call remains non-authoritative.
- **D-13:** Blocked unauthorized numeric `update_meal` calls must short-circuit to renderer-owned Traditional Chinese guidance as the terminal final reply. The model must not get a later chance to rewrite the failure into success-style text.
- **D-14:** Blocked or clarification-required numeric corrections must create no new meal revision, publish no `daily_summary`, and show no LLM-authored mutation success copy. Proof form belongs to plan-phase.
- **D-15:** Clarification copy should start by saying the record was not updated, be field-aware when the blocked field is known, use concise Traditional Chinese, and avoid policy-heavy wording about AI estimates, internal guards, persisted facts, tools, or APIs.

### Backend Proposal and Approval Lifecycle
- **D-16:** Phase 66 should introduce deterministic backend-owned numeric correction proposals now, but keep the scope narrow.
- **D-17:** Proposal values must come from deterministic backend computation over current persisted meal facts. They must not originate from LLM tool-call arguments or assistant prose; user approval does not make LLM-originated values authoritative.
- **D-18:** A numeric correction proposal is one active single-use proposal per device, scoped to the resolved meal id and exact expected meal revision.
- **D-19:** The proposal should carry proposal id, meal id, expected revision, backend-computed numeric patch or `items[]` result, affected fields, source operator, created time, and expiry.
- **D-20:** Approval commits only if the active proposal still exists, the user explicitly approves it, and the expected meal revision is still current. Stale proposal approval should reuse the existing Phase 62 meal revision precondition path, not a new proposal-specific stale mechanism.
- **D-21:** Creating a new same-kind numeric correction proposal replaces the previous active meal correction proposal for that device. Successful approval, cancel text, expiry, or replacement clears the proposal.
- **D-22:** Reuse Phase 60-style short approval/cancel wording for numeric correction proposals. Short affirmatives such as `好`, `可以`, `用這個`, `就這樣`, `套用`, or `ok` may commit only when approval rules identify exactly one active backend-owned proposal.
- **D-23:** Cancel phrases such as `不要`, `取消`, `先不用`, `不用`, `不可以`, or `no` take precedence over approval matching.
- **D-24:** Proposal copy should show the target meal, every affected field, before/after numbers, and renderer-owned approval/adjust prompt in concise Traditional Chinese. Use `kcal` for calories and `g` for macros.
- **D-25:** Single-field proposals should show the specific before/after delta. Multi-field proposals should list all affected fields' before/after values so the user knows exactly what approval commits.
- **D-26:** Meal labels in proposal copy must be identifiable, using a single item name or concise combined label for grouped meals when item names are available. Avoid generic labels when item names exist.
- **D-27:** Do not show calculation formulas by default. A short natural operator label such as `減半` is acceptable; formula detail such as `40 x 0.5 = 20` should be omitted unless the user asks how it was calculated.

### Cross-Kind Proposal Ambiguity
- **D-28:** Bare approval can commit only when exactly one active approvable proposal exists for the device. If both a goal proposal and a meal correction proposal are active, bare approval such as `好`, `可以`, `ok`, or `就這樣` must fail closed and mutate neither.
- **D-29:** When multiple proposal kinds are active, backend-rendered copy should ask the user to specify whether they mean the meal correction or the goal update.
- **D-30:** Kind-specific approval phrases may select the proposal kind, such as `套用餐點修改` / `套用餐點修正` for meal correction or `套用目標更新` / `套用每日目標` for goal updates. This selects only the active backend-owned proposal of that kind and must not reconstruct or alter proposal values from prose.
- **D-31:** Creating a meal correction proposal should not clear an active goal proposal, and creating a goal proposal should not clear an active meal correction proposal. Same-kind replacement still applies.
- **D-32:** Broad cancel wording such as `不要`, `取消`, `先不用`, `不用`, or `no` clears all active approvable proposal kinds for the device and returns renderer-owned no-update copy. Kind-specific cancel can clear one kind, such as `取消餐點修改` or `取消目標更新`.

### the agent's Discretion
- Exact internal naming for the meal numeric proposal state is for planning, but it should follow the existing `turn_states` active-state pattern unless the planner finds a concrete reason not to.
- Exact TTL is for planning calibration. It should be short-lived and compatible with Phase 60's latest-proposal precedent.
- Exact renderer copy can be tuned during implementation, but it must preserve the decisions above: record-not-updated first for blocked paths, concrete values first for proposal paths, concise Traditional Chinese, and no internal policy/tool jargon.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Planning Scope
- `.planning/ROADMAP.md` — Phase 66 goal, success criteria, dependency on Phase 65, and implementation notes.
- `.planning/REQUIREMENTS.md` — CORR-01 through CORR-03 and v2.4 out-of-scope boundaries.
- `.planning/PROJECT.md` — v2.4 correction-authority context, carry-forward privacy constraints, release boundaries, and prior proposal-authority decisions.
- `.planning/phases/65-tool-contract-alignment-and-meal-period-authority/65-CONTEXT.md` — Phase 65 authority handoff: raw model fields are evidence, explicit backend facts are authority, and correction candidates carry meal-period provenance.

### Numeric Guard and Tool Contracts
- `server/orchestrator/tools.ts` — `find_meals`, `update_meal`, `update_goals`, proposal precedent, tool schemas, result adapters, and current lack of `update_meal` numeric source guard.
- `server/orchestrator/tool-contract.ts` — source-field guard hook, controlled validation/guard failures, and redacted tool summaries.
- `server/orchestrator/source-text-guard.ts` — current exact numeric source authorization behavior for goals, Chinese numeral normalization, assistant-proposal confirmation handling, and Phase 60 approval/cancel helpers.
- `server/orchestrator/index.ts` — controlled reply short-circuit behavior, tool loop, mutation receipt handling, and prevention point for later LLM rewrite.
- `server/orchestrator/mutation-receipts.ts` — renderer-owned meal mutation receipt style and mutation-kind handling.

### Meal Correction and Revision Behavior
- `server/services/meal-correction.ts` — current `findMeals`, `updateMeal`, candidate state, grouped meal proportional distribution, summary outcome after update/delete, and pending target selection state.
- `server/services/meal-transactions.ts` — revisioned meal writes, current revision preconditions, and stale update/delete behavior.
- `server/services/turn-state.ts` — existing active state storage pattern for proposal-like workflows.

### Proof Surfaces
- `tests/unit/tools.test.ts` — tool contract proof for `find_meals`, `update_meal`, revision identity, stale revision behavior, and summary outcomes.
- `tests/unit/meal-correction.test.ts` — service-level correction target, update/delete, and revision behavior.
- `tests/unit/orchestrator.test.ts` — orchestrator controlled replies, mutation receipts, and proposal precedent tests.
- `tests/integration/chat-streaming.test.ts` — chat SSE update/delete receipt paths, terminal behavior, and JSON/SSE parity surfaces.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `server/orchestrator/source-text-guard.ts` already normalizes Arabic integer runs, common Chinese numerals, and approval/cancel-style phrases for backend-owned goal proposals. Planner must verify or extend decimal handling because Phase 66 decisions accept decimal target values.
- `server/orchestrator/tool-contract.ts` already supports `sourceFields` and controlled guard failure before tool execution, but `update_meal` currently does not declare guarded fields.
- `server/services/meal-correction.ts` already applies top-level numeric meal patches deterministically, including proportional distribution across grouped items.
- `server/services/turn-state.ts` and Phase 60 goal proposal behavior provide the precedent for one active backend-owned proposal per device/kind.

### Established Patterns
- Tool calls are untrusted model output and should run through Zod validation, source/provenance guards, and redacted logging summaries before execution.
- Renderer-owned controlled replies are the correct pattern when mutation authority fails and the final user-facing copy must not be rewritten by the LLM.
- Meal writes must preserve Phase 62 expected revision checks. Proposal approval should feed the existing meal update path with expected revision identity instead of creating a parallel stale-check system.
- Meal mutation side effects must keep Phase 61 semantics: committed mutation facts are authoritative, while `summaryOutcome` represents summary freshness only after an actual commit.

### Integration Points
- Add numeric provenance enforcement at the `update_meal` contract boundary before `mealCorrectionService.updateMeal()` can write a revision.
- Extend tool session or backend state to recognize active numeric correction proposals, approval/cancel text, and cross-kind proposal ambiguity before the model tool loop can produce unsafe mutation claims.
- Renderer copy for blocked corrections and proposals likely belongs near existing mutation/goal renderer helpers, not in prompt text.
- Tests should cover top-level patch, `items[]` replacement, direct explicit numeric updates, relative proposal creation/approval, stale proposal approval, cross-kind ambiguity, broad cancel, and no-mutation side effects.

</code_context>

<specifics>
## Specific Ideas

- Direct allowed examples: `蛋白質改成 28g`, `熱量改 500 卡`, `碳水 45`.
- Direct blocked examples: `蛋白質怪怪的，幫我改合理一點`, `合理一點`, `偏高` without a target or computable adjustment.
- Proposal examples: `減半`, `半份`, `少 20%`, `加 10g`, `少 10g`, computed only from current persisted meal facts.
- Proposal copy should resemble: `我可以把雞腿便當的蛋白質從 40g 調成 20g。回覆「好」套用，或告訴我目標數字。`
- Multi-field proposal copy should list every affected field with before/after values.
- If a goal proposal and meal correction proposal are both active, bare `好` must ask which one; `套用餐點修改` can apply only the meal correction proposal.

</specifics>

<deferred>
## Deferred Ideas

- Grouped-meal protein distribution currently uses existing proportional distribution, but this can conflict with trusted-protein semantics because persisted items do not carry counted-source / trace-source authority. Track trusted-protein-aware correction distribution as a separate follow-up outside Phase 66.
- Structured item removal/addition corrections such as `少一顆蛋` require stronger item/portion semantics before they can become proposal authority.
- Food-size heuristics such as `雞腿比較小` or `飯少一點`, food database defaults, historical medians, and any deterministic nutrition estimator need separate design before they can create backend-owned correction proposals.

</deferred>

---

*Phase: 66-Numeric Correction Provenance Guard*
*Context gathered: 2026-05-28*
