# Phase 68: Structured Tool Results and Release-Proof Gate - Context

**Gathered:** 2026-05-29
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 68 replaces brittle serialized clarification-result parsing with typed, renderer-owned tool clarification plumbing, then closes v2.4 with targeted local proof and metadata-only release evidence. The phase covers `find_meals`, historical `log_food`, and historical `get_daily_summary` clarification paths; proves carry-forward v2.4 authority behavior; records local closure with `yarn tsc --noEmit` and `yarn release:check`; and explicitly excludes staging/main promotion, Railway smoke, deploy, push, and merge actions.

</domain>

<decisions>
## Implementation Decisions

### Structured Result Boundary
- **D-01:** Keep `runContract()` and contract-specific results behind the existing `executeTool()` adapter. Do not pass raw `contractResult` through to `server/orchestrator/index.ts`.
- **D-02:** Extend `ToolExecutionResult` with explicit typed clarification/status facts the orchestrator needs.
- **D-03:** The new typed field must be a narrow discriminated union for renderer-ready clarification facts, not a `find_meals`-only shape.
- **D-04:** The union must support unresolved `find_meals` facts, historical `log_food` prompt/reason facts, and `get_daily_summary` `needs_clarification` / `multiple_targets` facts including `dateKeys`.
- **D-05:** Candidate facts inside the union must use a renderer-ready allowlisted projection, not full service `MealCorrectionCandidate`.
- **D-06:** Candidate projection should default to stable option number, date/time, display label, and explicit meal-period facts when allowed. Plan-phase may decide whether meal id/revision are needed internally, but they should not become part of the renderer/proof surface by default.
- **D-07:** Renderer/copy helpers remain authoritative for terminal clarification copy. Phase 68 must not add clarification rendering into `server/orchestrator/index.ts`.
- **D-08:** Final terminal clarification text must not come from serialized tool-message reparsing or a second LLM pass.
- **D-09:** Plan-phase may calibrate whether historical prompt text is passed through a thin renderer helper or later moved out of tool contracts, but discussion does not require prompt-building relocation.

### Historical Clarification Behavior
- **D-10:** Historical `log_food` date clarification becomes a renderer-owned terminal reply from typed clarification facts.
- **D-11:** Historical `log_food` ambiguity must not be fed back to the LLM for another pass. Backend date resolution has already determined the date cannot be safely resolved.
- **D-12:** `get_daily_summary` `needs_clarification` becomes a renderer-owned terminal reply from typed prompt/reason facts.
- **D-13:** `get_daily_summary` `multiple_targets` also becomes terminal. It should ask the user to narrow to one date from typed `dateKeys`.
- **D-14:** `multiple_targets` does not introduce multi-date summary aggregation. That would be new feature work outside Phase 68.
- **D-15:** Historical terminal copy should use backend/date-parser prompt and reason facts as source, wrapped by renderer-owned copy helpers.
- **D-16:** Existing `resolveHistoricalDateIntent` prompt text can remain mostly pass-through. `get_daily_summary` `multiple_targets` needs renderer-owned narrow-to-one-date copy because it currently has `dateKeys` but no prompt.
- **D-17:** Terminal historical clarification has a hard no-side-effect invariant: no meal revision, `loggedMeal`, `summaryOutcome`, `daily_summary` publish, success receipt, success-style copy, or second LLM pass.
- **D-18:** Terminal historical clarification should return as a clarification-only turn with `didLogMeal:false`, `didMutateMeal:false`, no `summaryOutcome`, and no logged meal payload.

### Proof Strategy
- **D-19:** Default proof is targeted unit plus integration tests. Add deterministic harness coverage only if plan-phase identifies a specific false-pass risk that normal tests cannot close.
- **D-20:** Unit tests should cover `executeTool()` typed clarification facts, renderer helper output, and orchestrator terminal behavior including `finalReplySource === "renderer"` and no consumed queued follow-up LLM response.
- **D-21:** Integration tests should cover route-visible JSON/SSE behavior and publish suppression where affected.
- **D-22:** Prefer existing suites: `tests/unit/tools.test.ts`, `tests/unit/orchestrator.test.ts`, `tests/integration/chat-meal-correction.integration.test.ts`, plus `tests/integration/chat-api.test.ts` and `tests/integration/chat-streaming.test.ts` only for affected JSON/SSE historical log or summary paths.
- **D-23:** Add one small source guard in the existing source-scan idiom to prevent serialized clarification-result reparsing paths from returning.
- **D-24:** PROOF-01 requires a full phase matrix: structured clarification facts for `find_meals`, historical `log_food`, and `get_daily_summary`; terminal renderer ownership; no second LLM pass; hard no-side-effect invariants; JSON/SSE parity where affected; a source guard against serialized reparsing; carry-forward v2.4 behavior families; and local closure gates.
- **D-25:** Carry-forward behavior families include tool schema alignment, explicit meal-period authority, numeric correction authority, target ranking, and clarification rendering.
- **D-26:** Full matrix means traceability, not duplicate new tests for every old requirement. Existing Phase 65-67 tests may satisfy rows only when they still exercise the refactored Phase 68 path or remain otherwise valid; if prior coverage only proved old plumbing, Phase 68 needs a delta test.
- **D-27:** PROOF-02 closes through a verification record if no harness is needed. Do not create a new manually maintained proof artifact format.
- **D-28:** The verification record should note that no harness artifact was generated because normal tests closed the false-pass risk, that normal test evidence is command/file/status metadata only, and that existing `llm-trace.v2` surfaces remain metadata-only for clarification turns.

### Release Evidence Shape
- **D-29:** Final release-proof evidence belongs in `.planning/phases/68-structured-tool-results-and-release-proof-gate/68-VERIFICATION.md`.
- **D-30:** `68-VERIFICATION.md` must record the PROOF-01 requirement-to-test traceability matrix, PROOF-03 command evidence for `yarn tsc --noEmit` and `yarn release:check`, PROOF-02 no-harness rationale, metadata-only `llm-trace.v2` confirmation, and explicit local-closure scope.
- **D-31:** `yarn release:check` is a final local closure gate after targeted tests pass. It is not a per-plan iteration command and must not be deferred only to a later ship workflow.
- **D-32:** If `yarn release:check` fails, fix the failure and rerun. "Final closure" is a gate position, not a run-exactly-once rule.
- **D-33:** The verification matrix should mark each row as Phase 68 added/changed coverage, relies on still-valid prior coverage, or prior coverage plus Phase 68 delta.
- **D-34:** After local closure evidence is recorded, stop and present the separate ship/promotion workflow as the next step if the user wants promotion.
- **D-35:** Phase 68 local closure must explicitly say no push, merge, deploy, Railway smoke, staging promotion, or main promotion was performed.

### the agent's Discretion
- Exact TypeScript names for the clarification union and discriminants are for plan-phase.
- Exact renderer helper organization and copy normalization are for plan-phase as long as renderer ownership, typed facts, no serialized reparsing, and no second LLM pass remain locked.
- Exact candidate projection type is for plan-phase, with the default constraint that renderer/proof surfaces stay allowlisted and narrow.
- Exact test placement can be calibrated by the planner, but should prefer existing suites unless a new file clearly reduces duplication or fixture complexity.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Planning Scope
- `.planning/ROADMAP.md` - Phase 68 goal, TARGET-03 / PROOF-01 / PROOF-02 / PROOF-03 scope, success criteria, dependency on Phase 67, and implementation notes.
- `.planning/REQUIREMENTS.md` - v2.4 requirement traceability, especially TARGET-03 and PROOF-01 through PROOF-03.
- `.planning/PROJECT.md` - v2.4 authority context, metadata-only privacy constraints, release boundaries, and carry-forward backend-authority decisions.
- `.planning/STATE.md` - Current phase position and accumulated v2.4 decisions.

### Prior Phase Decisions
- `.planning/phases/65-tool-contract-alignment-and-meal-period-authority/65-CONTEXT.md` - Tool schema alignment, explicit meal-period authority, candidate source facts, and metadata-only proof guardrails.
- `.planning/phases/66-numeric-correction-provenance-guard/66-CONTEXT.md` - Numeric correction authority, backend proposal lifecycle, no-mutation/no-success-copy guardrails, and source-text evidence boundary.
- `.planning/phases/67-correction-targeting-and-backend-clarification-rendering/67-CONTEXT.md` - Target ranking, renderer-owned correction clarification, pending selection behavior, stale recovery, and Phase 68 structured-result handoff.

### Tool and Orchestrator Code
- `server/orchestrator/tools.ts` - `ToolExecutionResult`, `executeTool()`, `log_food`, `find_meals`, `get_daily_summary`, `update_meal`, `delete_meal`, controlled replies, and current adapter mapping.
- `server/orchestrator/index.ts` - Tool loop, terminal `controlledReply` short-circuit behavior, mutation receipt assembly, no-second-LLM boundary, and JSON/SSE result fields consumed by routes.
- `server/orchestrator/tool-contract.ts` - `runContract()` contract execution boundary, validation/failure mapping, and raw argument parsing at the tool-call boundary.
- `server/orchestrator/mutation-receipts.ts` - Existing renderer-owned copy helpers for goals, meal numeric guidance, correction-target clarification, and mutation receipts.
- `server/orchestrator/system-prompt.ts` - Prompt guidance that supports but must not enforce backend-owned clarification and correction authority.

### Domain Services and Historical Date Facts
- `server/services/meal-correction.ts` - Candidate loading, pending selection, renderer candidate facts, target clarification, stale recovery, and meal update/delete service behavior.
- `server/lib/historical-date.ts` - Historical date intent resolution and prompt/reason facts for date clarification.
- `server/realtime/publisher.ts` - `daily_summary` publish boundary that terminal clarification paths must not trigger.

### Proof Surfaces
- `tests/unit/tools.test.ts` - Tool contract and `executeTool()` proof surface for structured clarification facts, schema alignment, historical log/summary outcomes, update/delete contracts, and numeric authority.
- `tests/unit/orchestrator.test.ts` - Orchestrator terminal renderer ownership, no-second-LLM proof, mutation receipts, and source-scan idiom for serialized parsing regressions.
- `tests/unit/meal-correction.test.ts` - Candidate ranking, pending selection, explicit/inferred period projection, target clarification, and stale behavior coverage.
- `tests/integration/chat-meal-correction.integration.test.ts` - Route-level correction clarification, no mutation, no summaryOutcome, no `daily_summary` publish, and no LLM rewrite proof.
- `tests/integration/chat-api.test.ts` - JSON chat behavior for historical log/summary paths and metadata-only route proof surfaces.
- `tests/integration/chat-streaming.test.ts` - SSE chat behavior for historical log/summary paths, terminal payloads, and stream parity.
- `tests/unit/verification-artifacts.test.ts` - Existing metadata-only artifact and `llm-trace.v2` privacy proof surfaces.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `server/orchestrator/tools.ts` already defines `ToolExecutionResult` and adapts contract-level results for the orchestrator. Phase 68 should extend this adapter rather than bypass it.
- `server/orchestrator/tools.ts` already maps unresolved `find_meals` to `controlledReply` with reason `meal_target_clarification`.
- `server/orchestrator/tools.ts` already receives structured contract results for historical `log_food` and `get_daily_summary`; those paths need typed terminal clarification plumbing instead of guard/tool-message continuation.
- `server/orchestrator/index.ts` already short-circuits on `controlledReply` and returns renderer final replies without a second LLM pass.
- `server/orchestrator/mutation-receipts.ts` already provides pure renderer/copy helper precedent.
- `server/services/meal-correction.ts` already has renderer-oriented correction-target clarification data and pending selection state.

### Established Patterns
- Tool calls are untrusted model output and must run through Zod validation, source/provenance guards, redacted summaries, and backend-owned service logic before side effects.
- Renderer-owned terminal replies are the established pattern for mutation safety gates and clarification paths where LLM rewriting would create success-style or guessed output risk.
- Routes/services own transport and domain behavior; orchestration should not absorb new clarification rendering responsibilities when renderer helpers can keep copy ownership isolated.
- Tests use Node built-in `node:test`, real SQLite, and injected `MockLLMProvider` or harness providers. Do not add Jest/Vitest.
- Normal traces and generated evidence must remain metadata-only: no raw prompts, user text, assistant final text, raw tool payloads, image data, session material, provider raw payloads, or database snapshots.

### Integration Points
- Add typed clarification facts at the `executeTool()` to `ToolExecutionResult` boundary.
- Update historical `log_food` and `get_daily_summary` adapter mapping so clarification facts become terminal renderer-owned controlled replies.
- Keep `find_meals` renderer-owned terminal clarification behavior intact while replacing any serialized result dependency with typed facts.
- Update route-visible JSON/SSE behavior only where terminal historical clarification changes output flow.
- Record local release proof in `68-VERIFICATION.md` after targeted tests, `yarn tsc --noEmit`, and `yarn release:check`.

</code_context>

<specifics>
## Specific Ideas

- A candidate projection should favor stable option number, date/time, safe display label, and explicit meal-period facts when allowed; full service candidates and nutrition totals should not become the renderer/proof contract.
- `get_daily_summary` `multiple_targets` should render a narrow-to-one-date clarification from typed `dateKeys`, not attempt multi-date aggregation.
- No-second-LLM proof can assert `finalReplySource === "renderer"` and that a queued follow-up LLM response was not consumed.
- No-side-effect proof should assert no `loggedMeal`, no `summaryOutcome`, no `daily_summary` publish, no success receipt, `didLogMeal:false`, and `didMutateMeal:false`.
- If no harness is needed, `68-VERIFICATION.md` should explicitly state that no harness artifact was generated because unit/integration tests closed the false-pass risk.

</specifics>

<deferred>
## Deferred Ideas

None - discussion stayed within Phase 68 scope.

</deferred>

---

*Phase: 68-Structured Tool Results and Release-Proof Gate*
*Context gathered: 2026-05-29*
