# Phase 67: Correction Targeting and Backend Clarification Rendering - Context

**Gathered:** 2026-05-29
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 67 makes backend correction target resolution and clarification rendering authoritative for ambiguous update/delete requests. It defines how the backend ranks candidates, when it can safely auto-resolve, how it renders numbered clarification options, and how follow-up selections behave. The phase builds on Phase 66's mutation authority guard: no meal update/delete may happen until the backend resolver returns a resolver-owned meal id plus revision identity, and unresolved or stale selections must fail closed without `daily_summary` publish or success-style copy.

</domain>

<decisions>
## Implementation Decisions

### Target Ranking Policy
- **D-01:** Explicit date is a hard scope filter. If the user explicitly says a date, candidates outside that date are excluded before ranking.
- **D-02:** Within the scoped candidate set, rank by evidence strength first. Recency is only a tie-breaker among otherwise comparable candidates, not a standalone tier that can override stronger target evidence.
- **D-03:** Valid pending/resolved correction target evidence is strongest only when it is for the same action and is not contradicted by new user text.
- **D-04:** Any non-matching explicit target evidence cancels pending/resolved target state and re-runs targeting. This includes food/item label mismatch, explicit date mismatch, explicit mealPeriod mismatch, and different mutation action.
- **D-05:** Food/item-label evidence is one tier. A match on the projected meal label or any stored item name counts as explicit food/item-label evidence.
- **D-06:** If exactly one candidate matches food/item evidence within scope, it may resolve. If multiple grouped meals share the matched item, clarify unless stronger scoping evidence separates them.
- **D-07:** Explicit persisted `mealPeriod` is stronger than inferred `loggedAt` period. Inferred period remains valid fallback evidence and can auto-resolve when it is the clean unique match.
- **D-08:** Pure recency must not override a matching meal-period word. Within period-matching candidates, prefer explicit source over inferred source, then newest.
- **D-08a:** D-07/D-08 describe the Phase 67 target state, not current behavior. Current scoring does not use `mealPeriodSource`; plan-phase must change ranking/scoring and add tests for explicit-period-over-inferred-period behavior.
- **D-09:** Add regression proof for a period word plus `那餐` where a newer non-matching meal exists: the resolver should select the matching period candidate, not the newest meal overall.

### Auto-Resolve vs Clarify Threshold
- **D-10:** The LLM may infer operation intent and pass the user's target query to the backend, but the backend resolver owns target selection. The LLM must not choose one meal from a candidate list.
- **D-11:** Mutators may only mutate after the resolver returns a resolved target with resolver-owned meal id and revision identity.
- **D-12:** Auto-resolve only when the strongest applicable evidence level has exactly one candidate. If multiple candidates tie at that strongest level, return `needs_clarification` with numbered options.
- **D-13:** Preserve deterministic recent-reference shorthand. If the user says `剛剛`, `那筆`, or `那餐` with no stronger conflicting target evidence, the backend may resolve to the unique newest candidate allowed by the locked ranking policy.
- **D-14:** Do not use recency to break ambiguity when the user did not provide a recent-reference phrase.
- **D-15:** After date scope, explicit persisted period matches are considered before inferred period matches. A unique explicit or inferred period match may auto-resolve; multiple matches clarify unless the user also gave a recent-reference word.
- **D-16:** If the user says period plus recent-reference, such as `午餐那餐`, apply the recent-reference carve-out inside the period-matched set. Resolve the newest lunch candidate, not the newest meal overall.
- **D-17:** Unsupported period words such as `下午茶` or `點心` must not be coerced into another period. Clarify instead.
- **D-18:** If the user provides food/item-label evidence and one or more candidates match it, narrow to that label-matched candidate set first. Period and recent-reference hints may only rank or break ties inside the label-matched set.
- **D-19:** If the user provides a likely food/item label but no candidate matches it, do not fall back to period or recency to resolve another meal. Return clarification or not-found.
- **D-20:** When clarification is needed, render at most five numbered options chosen from the strongest matched evidence level and ordered by the locked ranking/tie-break rules. Do not mix weaker evidence-level candidates into the clarification list when stronger tied candidates exist.
- **D-21:** Pending numbered selection must correspond exactly to the rendered options.

### Clarification Copy and Candidate Labels
- **D-22:** Numbered correction clarification options include stable number, date, time, concise stored meal label or projected grouped meal label, and an explicit meal-period label only when `mealPeriodSource === "explicit"`.
- **D-23:** Do not render inferred meal-period labels. If the period only comes from `loggedAt` inference, omit it rather than presenting a clock-derived guess as fact.
- **D-24:** Do not include calories or macros in correction clarification options by default. Clarification is for target selection, not nutrition review.
- **D-25:** Grouped meal labels must come from stored meal/items, not from the user's correction request. Later shortening such as first items plus `等 N 項` is allowed only if enough identity remains to distinguish candidates.
- **D-25a:** Full stored-item joins remain valid under D-25. If plan-phase introduces truncated grouped labels, it must intentionally update integration assertions that currently expect full joined labels.
- **D-26:** Use a safe target-aware lead-in only when the label is backend-derived from matched stored evidence, such as `我找到多筆可能符合「滷蛋」的餐點，請直接回覆編號：`.
- **D-27:** If no safe backend-derived target label exists, fall back to direct copy such as `我找到多筆可能要修改/刪除的餐點，請直接回覆編號：`.
- **D-28:** Always include `請直接回覆編號`. Never echo raw correction text or model-rewritten phrases as the target label, and do not use phrases like `中午雞腿便當` as if they were stored meal labels.
- **D-29:** No-safe-candidate paths remain fail-closed but scoped. If date is ambiguous or multiple dates are requested, ask for one date first.
- **D-30:** If there is a clear single-date scope and the backend cannot safely resolve the target, use that scoped date to help recovery. If the date has meals, show a numbered confirmation list from that date. If it has no meals, say no meals are recorded for that date.
- **D-31:** Do not show weak cross-date nearest candidates, do not imply mutation succeeded, and keep recovery actionable: the user can reply with a number or provide more date/food detail.
- **D-32:** Correction target clarification is renderer-owned terminal output. The backend-rendered clarification copy is the final reply for that turn; the LLM must not paraphrase, polish, reorder, or append success-style text.
- **D-33:** Renderer-owned terminal output applies to update/delete correction targeting. Non-mutating search or summary clarification can keep a separate policy outside Phase 67.

### Follow-Up Selection Behavior
- **D-34:** A follow-up resolves pending selection only when it unambiguously maps to one rendered option.
- **D-35:** Allowed mappings include a valid shown number or ordinal (`1`, `第二個`, `第2筆`), an exact safe stored/projected label or item label that uniquely matches one rendered option, or a rendered attribute such as earlier/later/explicit period when it uniquely identifies one rendered option.
- **D-36:** Broad natural-language guessing, references to attributes not shown in the options, or label/attribute replies that match multiple rendered options do not resolve.
- **D-37:** Ambiguous replies re-show the same numbered options. New explicit target evidence or action changes cancel pending selection and re-run targeting.
- **D-38:** Invalid number while the rendered selection is still known re-shows the same numbered options and states the valid numbers. Do not treat the invalid number as a fresh target query.
- **D-39:** Delayed replies should not be blindly discarded because time passed. If the previous rendered numbered clarification can still be recovered and the selected option can be revalidated, honor the selection.
- **D-40:** Delayed-selection revalidation must happen before mutation: selected meal still exists, original action still matches, and stale/revision safety checks pass.
- **D-41:** If the selected option is stale or no longer valid, do not mutate. Re-render current scoped options or ask for fresh target evidence. If the prior numbered clarification cannot be recovered, ask the user to restate date/period/food detail.
- **D-42:** Mixed selection plus mutation details is allowed, but target resolution and mutation authorization are separate gates. Example: `2，蛋白質改 28g` may resolve option 2, then update only if current-turn numeric authority and stale/revision guards pass.
- **D-43:** If mixed follow-up text gives vague numeric intent such as `2，蛋白質改合理一點`, the target may resolve but must not directly mutate. It should enter a non-mutating clarification/proposal flow, and any generated proposal value is pending confirmation, not a committed mutation.
- **D-44:** After a valid selection resolves but the write fails because the meal is stale, changed, or deleted, fail closed: no mutation, no `daily_summary` publish, and no success-style copy.
- **D-45:** Prefer re-rendering current scoped options after stale/deleted selection failures. If no safe current candidates remain, say the previously selected meal is no longer available and ask for fresh date/period/food detail.
- **D-46:** Never auto-retarget by label. A same-label meal is not the same target for update/delete.
- **D-46a:** D-45 is a target-state change from current stale behavior, which is fail-closed with generic stale copy / `MEAL_REVISION_STALE`. Adopting D-45 requires updating or adding stale/deleted recovery tests. Re-rendering current candidates from the recoverable original scope is allowed, but the backend must not preselect or auto-retarget a same-label replacement. If the original scope cannot be recovered, ask for fresh target evidence.

### the agent's Discretion
- Exact data structures, stored pending-selection shape, recovery plumbing for delayed visible prompts, and structured tool-result mechanics are for plan-phase. The product behavior above is locked; the implementation path is not.
- Exact copy strings can be tuned during implementation as long as renderer-owned terminal output, stable numbering, safe backend-derived labels, no raw correction echo, and no success-style copy remain intact.
- Exact scoring implementation is for plan-phase, but it must express the locked evidence ordering and clean-unique threshold rather than a permissive score-gap policy.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Planning Scope
- `.planning/ROADMAP.md` — Phase 67 goal, TARGET-01/TARGET-02 scope, success criteria, dependency on Phase 66, and implementation notes.
- `.planning/REQUIREMENTS.md` — TARGET-01 through TARGET-02 and out-of-scope boundaries; TARGET-03 remains Phase 68 structured tool-result work.
- `.planning/PROJECT.md` — v2.4 correction-authority context, privacy constraints, release boundaries, and carry-forward backend-authority decisions.
- `.planning/phases/65-tool-contract-alignment-and-meal-period-authority/65-CONTEXT.md` — explicit vs inferred `mealPeriod` authority and Phase 67 candidate-ranking handoff.
- `.planning/phases/66-numeric-correction-provenance-guard/66-CONTEXT.md` — numeric mutation authority, backend proposal lifecycle, and no-mutation/no-success-copy guardrails.

### Correction Targeting and Rendering Code
- `server/services/meal-correction.ts` — current candidate loading, `mealPeriodSource`, scoring, pending selection, clarification prompt, selection parsing, and meal update/delete service behavior.
- `server/orchestrator/tools.ts` — `find_meals`, `update_meal`, `delete_meal`, `propose_meal_numeric_correction`, tool-session resolved target state, and controlled result handling.
- `server/orchestrator/index.ts` — current correction clarification reply parsing/rendering, tool loop behavior, and terminal reply control points.
- `server/orchestrator/system-prompt.ts` — model-facing historical correction rules that must align with backend-owned target resolution and renderer-owned clarification.
- `server/orchestrator/mutation-receipts.ts` — renderer-owned copy precedent for mutation/proposal/failure paths.

### Proof Surfaces
- `tests/unit/meal-correction.test.ts` — service-level candidate ranking, grouped item matching, pending selection, explicit/inferred period projection, and stale behavior coverage.
- `tests/unit/tools.test.ts` — resolver-owned meal id/revision contract, update/delete preconditions, numeric authority guard, and proposal tool behavior.
- `tests/unit/orchestrator.test.ts` — controlled replies, correction clarification rendering, and no LLM rewrite proof surfaces.
- `tests/integration/chat-meal-correction.integration.test.ts` — route-level correction targeting, grouped meal ambiguity, update/delete receipt behavior, proposal paths, and real SQLite mutation proof.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `server/services/meal-correction.ts` already returns `MealCorrectionCandidate` with `foodName`, `itemNames`, `mealPeriod`, `mealPeriodSource`, `loggedAt`, date key, meal id, and revision id.
- `server/services/meal-correction.ts` already has pending selection state and numbered reply parsing for digit and Chinese ordinal forms.
- `server/orchestrator/tools.ts` already stores resolver-owned `{ mealId, mealRevisionId }` in tool session state after `find_meals`, and update/delete contracts depend on that state.
- Phase 66 added numeric authority/proposal behavior that can be reused after a selected target resolves but numeric details remain vague.

### Established Patterns
- Tool calls are untrusted model output. Backend tool contracts and services own validation, target authority, revision identity, and redacted summaries.
- Renderer-owned terminal replies are the correct pattern for mutation safety gates where the LLM must not rewrite backend decisions into success-style prose.
- Meal writes must preserve Phase 62 expected revision checks and Phase 61 summary-outcome semantics. Clarification and stale selection failures must not publish `daily_summary`.
- Public meal period authority from Phase 65 distinguishes explicit persisted source from inferred legacy fallback; Phase 67 should use that source distinction in ranking and rendering.

### Integration Points
- Candidate ranking and clarification-list construction connect primarily through `mealCorrectionService.findMeals()`.
- Renderer-owned correction clarification likely belongs near existing orchestrator correction clarification handling and mutation receipt helpers, but exact structure is for plan-phase.
- Follow-up selection behavior connects to pending selection state, rendered option recovery, resolver-owned target identity, and stale revision preconditions.
- Prompt changes should support the backend contract but cannot be the enforcement mechanism.

</code_context>

<specifics>
## Specific Ideas

- Example ranking regression: today has inferred lunch at 12:00 and inferred dinner at 19:00; user says `把午餐那餐刪掉`; target should be lunch, not newest dinner.
- Example period-plus-recent behavior: with two lunch candidates, `午餐那餐` resolves the newest lunch candidate, not the newest meal overall.
- Example label scope behavior: `剛剛的雞腿` must not jump to a newer `雞胸肉`; `中午雞腿便當的滷蛋` must not jump to an unrelated lunch candidate.
- Example no-label-match behavior: `中午鴨腿便當` with no `鴨腿` candidate should clarify/not-found rather than resolving a period-only lunch candidate.
- Example invalid number recovery: if options are `1` and `2`, reply `3` should re-show the same options and say valid numbers are `1` or `2`.
- Example delayed reply recovery: if the visible numbered prompt can be recovered and option `2` still revalidates, honor `2`; if stale, re-render current scoped options.
- Example mixed follow-up: `2，蛋白質改 28g` resolves option 2 then may update only if numeric authority and revision checks pass; `2，蛋白質改合理一點` resolves target but must not directly mutate.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within Phase 67 scope. Exact data structures, delayed prompt persistence mechanics, and structured tool-result plumbing are intentionally left for plan-phase / Phase 68 boundaries.

</deferred>

---

*Phase: 67-Correction Targeting and Backend Clarification Rendering*
*Context gathered: 2026-05-29*
