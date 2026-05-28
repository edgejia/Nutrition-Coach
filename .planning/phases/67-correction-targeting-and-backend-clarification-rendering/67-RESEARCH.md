# Phase 67: Correction Targeting and Backend Clarification Rendering - Research

**Researched:** 2026-05-29  
**Domain:** Backend meal-correction target resolution, renderer-owned clarification copy, Node/Fastify/SQLite test proof  
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### Target Ranking Policy
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

#### Auto-Resolve vs Clarify Threshold
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

#### Clarification Copy and Candidate Labels
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

#### Follow-Up Selection Behavior
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

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within Phase 67 scope. Exact data structures, delayed prompt persistence mechanics, and structured tool-result plumbing are intentionally left for plan-phase / Phase 68 boundaries.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| TARGET-01 | Correction target resolution ranks current-turn, today, recency, explicit food label, and persisted meal-period evidence so ambiguous `那餐` requests surface the most relevant candidates without silently choosing unrelated historical meals. [VERIFIED: .planning/REQUIREMENTS.md] | Implement evidence-tier ranking in `server/services/meal-correction.ts`; current code already loads candidate date, label, item names, `mealPeriod`, and `mealPeriodSource`, but scoring is additive and does not use `mealPeriodSource`. [VERIFIED: codebase grep] |
| TARGET-02 | Multi-candidate correction clarification is backend-rendered with stable numbered options and concise target labels that do not echo the whole user correction request as a meal name. [VERIFIED: .planning/REQUIREMENTS.md] | Move/update correction clarification rendering to backend-owned terminal output; current service builds numbered prompts, while the orchestrator also reparses `find_meals` JSON and can derive labels from raw user text. [VERIFIED: codebase grep] |
</phase_requirements>

## Summary

Phase 67 should be planned as a backend authority phase, not a prompt-tuning phase. `server/services/meal-correction.ts` already owns candidate loading, pending selection state, label/item matching, date resolution, and basic scoring; the planner should replace the current additive score policy with explicit evidence-tier ranking and deterministic tie behavior. [VERIFIED: codebase grep]

The highest-risk implementation detail is the split between service prompts and orchestrator rendering. The service currently produces numbered prompt text from candidates, but the orchestrator also reparses serialized `find_meals` tool output and builds its own clarification reply from the raw user message. That second renderer is exactly where TARGET-02 can regress by echoing correction text as a target label. [VERIFIED: codebase grep]

**Primary recommendation:** use `meal-correction.ts` as the authoritative resolver and clarification-result builder, add renderer-owned controlled replies for `find_meals` clarification/not-found paths, and leave broad structured tool-result plumbing to Phase 68. [VERIFIED: 67-CONTEXT.md]

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|--------------|----------------|-----------|
| Correction target ranking | API / Backend service | Database / Storage | Candidate facts come from SQLite meal rows/revisions, and `createMealCorrectionService().findMeals()` already owns ranking and pending state. [VERIFIED: codebase grep] |
| Resolver-owned mutation authorization | API / Backend tool contract | Database / Storage | `find_meals` seeds `{ mealId, mealRevisionId }` into tool-session state; `update_meal` and `delete_meal` reject unresolved targets and pass the resolver-owned revision to service writes. [VERIFIED: codebase grep] |
| Clarification final copy | API / Backend renderer | Orchestrator tool loop | Phase 67 locks correction clarification as renderer-owned terminal output; current controlled replies already short-circuit model rewriting for numeric guard paths. [VERIFIED: 67-CONTEXT.md; VERIFIED: codebase grep] |
| Follow-up numbered selection | API / Backend service | Database / Storage | Pending selections are stored in `turn_states` through `turnStateService`, and `tryResolvePendingSelection()` currently resolves digit and Chinese ordinal replies. [VERIFIED: codebase grep] |
| Chat transport response shape | API / Backend route | Browser / Client | Route-level assertions already prove no-mutation chat responses and `didMutateMeal` behavior through Fastify `app.inject()` with real SQLite; the client should receive final text rather than own target selection. [VERIFIED: codebase grep] |

## Project Constraints (from AGENTS.md)

- Use `yarn` only; do not use `npm`. [VERIFIED: AGENTS.md]
- Keep TypeScript ESM imports with explicit `.js` specifiers. [VERIFIED: AGENTS.md]
- `server/app.ts` is the backend composition root; new route/service dependencies should be wired there. [VERIFIED: AGENTS.md]
- `server/routes/*.ts` own HTTP/SSE boundaries; `server/services/*.ts` own reusable domain and persistence logic; `server/orchestrator/*` owns tool workflow, prompt construction, tool execution, and fallback behavior. [VERIFIED: AGENTS.md]
- Runtime should use `OpenAIProvider`; tests should use `MockLLMProvider` or harness providers. [VERIFIED: AGENTS.md]
- Preserve `TZ=Asia/Taipei` for day-boundary behavior. [VERIFIED: AGENTS.md]
- Use Node built-in `node:test`; do not introduce Jest or Vitest without explicit migration. [VERIFIED: AGENTS.md]
- Use real SQLite in tests; `:memory:` is acceptable and DB mocking is not. [VERIFIED: AGENTS.md]
- Treat `tests/harness/artifacts/**` as generated evidence; do not hand-edit artifacts. [VERIFIED: AGENTS.md]
- Any `*.ts` edit requires `yarn tsc --noEmit`; `server/routes/*.ts` or `server/services/*.ts` edits require `yarn test:integration`; `tests/unit/*.test.ts` edits require `yarn test:unit`. [VERIFIED: AGENTS.md]
- `server/routes/chat.ts` has strict SSE ordering and summary publish invariants; unresolved or stale correction paths must not publish `daily_summary`. [VERIFIED: AGENTS.md; VERIFIED: Phase 66 verification]
- Before `staging` or `main` promotion, run `yarn release:check`; no Phase 67 planning should imply promotion to `main`. [VERIFIED: AGENTS.md]

## Standard Stack

### Core

| Library / Tool | Version | Purpose | Why Standard |
|----------------|---------|---------|--------------|
| Node.js runtime | v24.14.0 | Runs ESM server/tests and built-in `node:test`. | Available locally and used by package scripts. [VERIFIED: local env; VERIFIED: package.json] |
| TypeScript | 5.9.3 | Types server/orchestrator/service contracts. | Existing repo dependency and required by `yarn tsc --noEmit`. [VERIFIED: yarn list; VERIFIED: AGENTS.md] |
| tsx | 4.21.0 | Executes TypeScript tests/scripts under Node. | Existing package scripts use `--import tsx`. [VERIFIED: yarn list; VERIFIED: package.json] |
| Fastify | 5.8.4 | Chat/API route boundary and integration tests through app injection. | Existing server route stack; Phase 67 route proof should reuse it. [VERIFIED: yarn list; VERIFIED: codebase grep] |
| better-sqlite3 | 11.10.0 | Local SQLite database backing service and integration tests. | Existing persistence adapter; tests already use real `:memory:` SQLite. [VERIFIED: yarn list; VERIFIED: AGENTS.md] |
| Drizzle ORM | 0.39.3 | Typed query builders for meal transactions/revisions. | `meal-correction.ts` already uses Drizzle builders for candidate loading. [VERIFIED: yarn list; VERIFIED: codebase grep] |
| Zod | 4.3.6 | Tool argument runtime validation. | Existing tool contracts use Zod schemas. [VERIFIED: yarn list; VERIFIED: codebase grep] |

### Supporting

| Library / Tool | Version | Purpose | When to Use |
|----------------|---------|---------|-------------|
| `MockLLMProvider` | repo-local | Deterministic orchestrator and route tests. | Use when proving the model cannot override renderer-owned correction clarification or stale/no-mutation behavior. [VERIFIED: codebase grep; VERIFIED: nutrition-gen-test skill] |
| `scripts/run-node-with-tz.mjs` | repo-local | Runs tests with project timezone guard. | Use for targeted unit/integration commands and preserve `TZ=Asia/Taipei`. [VERIFIED: package.json; VERIFIED: AGENTS.md] |
| `createMealCorrectionService()` | repo-local | Candidate loading, ranking, pending selection, update/delete service behavior. | Primary implementation surface for TARGET-01 and follow-up selection. [VERIFIED: codebase grep] |
| `mutation-receipts.ts` renderer helpers | repo-local | Precedent for renderer-owned terminal copy and forbidden implementation terms. | Add correction clarification renderers here or in a nearby renderer module; do not rely on prompt prose. [VERIFIED: codebase grep] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Evidence-tier ranking in `meal-correction.ts` | More prompt instructions in `system-prompt.ts` | Prompt wording cannot enforce backend target authority; current tool contracts already treat model tool calls as untrusted. [VERIFIED: 67-CONTEXT.md; VERIFIED: codebase grep] |
| Renderer-owned controlled reply for `find_meals` clarification | Let the LLM paraphrase after `find_meals` returns candidates | Violates D-32 and risks success-style or raw-correction echo copy. [VERIFIED: 67-CONTEXT.md; VERIFIED: codebase grep] |
| Repo-native unit/integration tests | New harness scenario | Existing service and route tests can prove TARGET-01/TARGET-02 without metadata artifacts; harness should be reserved for cross-boundary proof that unit/integration tests cannot cover. [VERIFIED: nutrition-gen-test skill; VERIFIED: codebase grep] |

**Installation:**
```bash
# No new packages recommended for Phase 67.
```

**Version verification:** Existing stack versions were verified with `yarn list --pattern 'fastify|drizzle-orm|better-sqlite3|tsx|typescript|zod' --depth=0`; no ecosystem registry lookup is required because Phase 67 should not install external packages. [VERIFIED: local env]

## Package Legitimacy Audit

Phase 67 should install no external packages. [VERIFIED: 67-CONTEXT.md; VERIFIED: codebase grep]

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| none | — | — | — | — | not run | Approved: no package install planned |

**Packages removed due to slopcheck [SLOP] verdict:** none.  
**Packages flagged as suspicious [SUS]:** none.  

## Architecture Patterns

### System Architecture Diagram

```text
User correction text
  -> Orchestrator routes intent to find_meals
  -> find_meals contract trims query and calls mealCorrectionService.findMeals()
  -> MealCorrectionService loads active meal candidates from SQLite + current revisions
  -> Date scope filter
      -> ambiguous/multiple date: renderer-owned date clarification, no mutation
      -> single/no explicit date: evidence-tier ranking
  -> Evidence tiers
      -> valid pending selection for same action and not contradicted
      -> explicit food/item-label matches
      -> explicit persisted mealPeriod matches
      -> inferred mealPeriod fallback
      -> recent-reference tie-break only where allowed
  -> Resolver decision
      -> one strongest candidate: return mealId + mealRevisionId
      -> multiple strongest candidates: render <=5 stable numbered options and store same options
      -> no safe candidate: scoped clarification/not-found, no mutation
  -> Tool-session resolvedMealTargets
      -> update_meal/delete_meal may write only with resolver-owned mealId + revision
      -> stale/revision failure: fail closed, no daily_summary publish, no success copy
```

### Recommended Project Structure

```text
server/
├── services/
│   └── meal-correction.ts        # resolver, evidence ranking, pending-selection storage/revalidation
├── orchestrator/
│   ├── tools.ts                  # find_meals controlled result mapping; mutator target preconditions
│   ├── mutation-receipts.ts      # or nearby renderer helper for backend-owned clarification copy
│   ├── index.ts                  # controlled reply short-circuit; avoid LLM rewrite
│   └── system-prompt.ts          # support-only guidance, not enforcement
tests/
├── unit/
│   ├── meal-correction.test.ts   # ranking, pending selection, labels, stale/revalidation service proof
│   ├── tools.test.ts             # resolver-owned id/revision and controlled result proof
│   └── orchestrator.test.ts      # renderer-owned terminal reply proof
└── integration/
    └── chat-meal-correction.integration.test.ts # Fastify + real SQLite route proof
```

### Pattern 1: Evidence-Tier Resolver

**What:** Replace permissive additive score-gap logic with explicit buckets: hard date scope, pending same-action target, label tier, explicit meal-period tier, inferred meal-period tier, then allowed recency tie-breaks. [VERIFIED: 67-CONTEXT.md]

**When to use:** Any `find_meals` update/delete request before mutator tools can run. [VERIFIED: codebase grep]

**Example:**
```typescript
// Source: server/services/meal-correction.ts current findMeals shape + 67-CONTEXT.md decisions.
const scoped = applyExplicitDateScope(candidates, query);
const strongest = selectStrongestEvidenceTier(scoped, query);

if (strongest.kind === "none") return scopedRecoveryOrNotFound(scoped, query);
if (strongest.candidates.length === 1) return resolve(strongest.candidates[0]);

const options = orderWithinTier(strongest.candidates, query).slice(0, 5);
await rememberRenderedOptions(deviceId, action, options);
return clarifyWithRenderedOptions(action, options, strongest.safeLabel);
```

### Pattern 2: Renderer-Owned Terminal Clarification

**What:** Treat `find_meals` `needs_clarification` / not-found results for correction targeting like numeric authority failures: return backend-rendered final copy and stop the model loop. [VERIFIED: 67-CONTEXT.md; VERIFIED: Phase 66 verification]

**When to use:** Multi-candidate update/delete clarification, invalid pending number, date ambiguity, no safe candidate, and stale/deleted follow-up recovery. [VERIFIED: 67-CONTEXT.md]

**Example:**
```typescript
// Source: server/orchestrator/tools.ts controlledReply mapping precedent.
if (toolCall.function.name === "find_meals" && contractResult.status !== "resolved") {
  return {
    result: contractResult.prompt,
    summary: `status: ${contractResult.status}`,
    success: false,
    executed: false,
    failureReason: "guard",
    controlledReply: {
      source: "renderer",
      reason: "meal_target_clarification",
      text: contractResult.prompt,
    },
  };
}
```

### Pattern 3: Rendered Options Are Selection State

**What:** Store the exact option list that was rendered, not a broader candidate pool. Pending follow-up resolution must map only to those rendered options. [VERIFIED: 67-CONTEXT.md]

**When to use:** Multi-candidate clarification and delayed follow-up selection. [VERIFIED: 67-CONTEXT.md]

**Example:**
```typescript
// Source: server/services/meal-correction.ts pending state precedent.
await turnStateService.putState(
  deviceId,
  "meal_target_selection",
  { action, candidates: renderedOptions },
  PENDING_SELECTION_TTL_MS,
);
```

### Anti-Patterns to Avoid

- **Additive score policy as authority:** current score values can let combined weak hints compete with stronger evidence; Phase 67 requires strongest evidence tier first. [VERIFIED: 67-CONTEXT.md; VERIFIED: codebase grep]
- **Raw user target labels in clarification lead-ins:** current `buildCorrectionClarificationReply()` can derive `targetLabel` from `userMessage`; Phase 67 forbids echoing the entire correction request as a meal name. [VERIFIED: 67-CONTEXT.md; VERIFIED: codebase grep]
- **LLM final paraphrase after `find_meals` ambiguity:** current orchestrator can continue the tool loop after non-controlled `find_meals` results; Phase 67 requires renderer-owned terminal output. [VERIFIED: 67-CONTEXT.md; VERIFIED: codebase grep]
- **Auto-retargeting stale/deleted selections by label:** D-46 forbids treating same-label meals as the same update/delete target. [VERIFIED: 67-CONTEXT.md]
- **Calories/macros in target options:** D-24 excludes nutrition facts from clarification options by default. [VERIFIED: 67-CONTEXT.md]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Date parsing for mutation scope | New regex-only date parser | `resolveHistoricalDateIntent()` via `resolveFindMealsTargetDateKey()` | Existing code already handles mutation date intent and previous-date continuity. [VERIFIED: codebase grep] |
| Pending selection persistence | New table or in-memory map | Existing `turnStateService` with `meal_target_selection` kind | Repo already uses turn state for per-device pending flows and TTL. [VERIFIED: codebase grep] |
| Mutation stale safety | New stale-check system | Existing `MealRevisionPreconditionError` path with resolver-owned `mealRevisionId` | Phase 62/66 already verified stale update/delete fail closed without publish. [VERIFIED: Phase 66 verification; VERIFIED: codebase grep] |
| Route proof stubs | Mocked DB or mocked transport | Fastify `app.inject()` with real SQLite and `MockLLMProvider` | Project test skill and AGENTS require real SQLite and existing DI patterns. [VERIFIED: AGENTS.md; VERIFIED: nutrition-gen-test skill] |
| New test framework | Jest/Vitest | Node built-in `node:test` | AGENTS explicitly forbids introducing Jest/Vitest without migration. [VERIFIED: AGENTS.md] |

**Key insight:** the deceptively hard work is not string formatting; it is preserving resolver authority across target ambiguity, follow-up selection, numeric authority, and stale revision checks without giving the model a chance to rewrite or retarget. [VERIFIED: 67-CONTEXT.md; VERIFIED: Phase 66 verification]

## Common Pitfalls

### Pitfall 1: Strong Evidence Hidden by Additive Scores
**What goes wrong:** a newer meal or a period-only meal can beat a food/item-label or explicit-period target if scores are treated as arithmetic rather than tiers. [VERIFIED: 67-CONTEXT.md; VERIFIED: codebase grep]  
**Why it happens:** current `scoreCandidate()` adds date + period + label points and sorts by score/newest; it does not distinguish `mealPeriodSource`. [VERIFIED: codebase grep]  
**How to avoid:** implement named evidence tiers and only apply recency inside the selected tier. [VERIFIED: 67-CONTEXT.md]  
**Warning signs:** tests pass because one candidate has a higher numeric score, not because the strongest evidence level had exactly one candidate. [VERIFIED: codebase grep]

### Pitfall 2: Backend Prompt Exists but Orchestrator Rewrites It
**What goes wrong:** service builds safe numbered prompt text, but orchestrator parses tool JSON and returns a different reply based on raw user text or model copy. [VERIFIED: codebase grep]  
**Why it happens:** `buildClarificationPrompt()` exists in the service, while `buildCorrectionClarificationReply()` in `index.ts` also renders clarification text from parsed `find_meals` JSON. [VERIFIED: codebase grep]  
**How to avoid:** make correction clarification a controlled renderer-owned terminal result at the tool execution boundary. [VERIFIED: 67-CONTEXT.md]  
**Warning signs:** tests queue a second LLM response after `find_meals` ambiguity. [VERIFIED: codebase grep]

### Pitfall 3: Pending Selection Drift
**What goes wrong:** a follow-up number maps to a candidate list that differs from the visible options, or a new explicit target reuses stale pending state. [VERIFIED: 67-CONTEXT.md]  
**Why it happens:** pending state currently stores candidates and resolves digits/labels, but invalid number handling re-shows options without stating valid numbers, and delayed revalidation behavior is not fully expressed. [VERIFIED: codebase grep; VERIFIED: 67-CONTEXT.md]  
**How to avoid:** persist rendered options plus action and enough scope/evidence metadata to rerender or reject safely. [VERIFIED: 67-CONTEXT.md]  
**Warning signs:** broad text like `確認刪除` resolves a pending target without checking whether the visible rendered attributes uniquely identify it. [VERIFIED: 67-CONTEXT.md]

### Pitfall 4: Stale Recovery Becomes Retargeting
**What goes wrong:** after selected target is stale/deleted, code finds a same-label meal and mutates it. [VERIFIED: 67-CONTEXT.md]  
**Why it happens:** recovery wants to be helpful, but update/delete identity is revision-scoped and same-label meals are not the same target. [VERIFIED: 67-CONTEXT.md; VERIFIED: Phase 66 verification]  
**How to avoid:** re-render current scoped options only as choices, never as an auto-selected replacement. [VERIFIED: 67-CONTEXT.md]  
**Warning signs:** stale failure tests assert success after selecting a replacement meal. [VERIFIED: 67-CONTEXT.md]

### Pitfall 5: Over-implementing Phase 68
**What goes wrong:** Phase 67 tries to replace all serialized tool-message parsing with structured result transport. [VERIFIED: .planning/REQUIREMENTS.md]  
**Why it happens:** current `find_meals` returns `toolMessage: JSON.stringify(result)` and `index.ts` reparses it; this is a real smell but TARGET-03 is mapped to Phase 68. [VERIFIED: codebase grep; VERIFIED: .planning/REQUIREMENTS.md]  
**How to avoid:** add the minimum controlled result/copy plumbing needed for Phase 67 while leaving generic structured tool-result cleanup to Phase 68. [VERIFIED: 67-CONTEXT.md; VERIFIED: .planning/REQUIREMENTS.md]

## Code Examples

Verified patterns from current repo sources:

### Existing Candidate Data Shape
```typescript
// Source: server/services/meal-correction.ts
export interface MealCorrectionCandidate {
  mealId: string;
  mealRevisionId: string;
  foodName: string;
  itemNames: string[];
  loggedAt: string;
  dateKey: string;
  mealPeriod: MealPeriod;
  mealPeriodSource: "explicit" | "inferred";
}
```

### Existing Resolver-Owned Tool Session State
```typescript
// Source: server/orchestrator/tools.ts
deps.toolSessionState.resolvedMealTargets = result.status === "resolved"
  ? [{ mealId: result.resolvedMealId, mealRevisionId: result.mealRevisionId }]
  : [];
```

### Existing Controlled Reply Short-Circuit
```typescript
// Source: server/orchestrator/index.ts
if (controlledReply) {
  return {
    reply: controlledReply.text,
    didLogMeal: false,
    didMutateMeal: false,
    finalReplySource: controlledReply.source,
  };
}
```

## State of the Art

| Old Approach | Current / Required Approach | When Changed | Impact |
|--------------|-----------------------------|--------------|--------|
| Model-selected correction target from prose | Backend `find_meals` resolver must choose or clarify before mutation | Phase 62 through Phase 67 | Mutators require resolver-owned `mealId` and `mealRevisionId`. [VERIFIED: Phase 66 verification; VERIFIED: 67-CONTEXT.md] |
| Clock-derived period as implicit authority | Explicit persisted `mealPeriod` outranks inferred `loggedAt` period | Phase 65 handoff, Phase 67 target state | Ranking and rendering must use `mealPeriodSource`. [VERIFIED: .planning/STATE.md; VERIFIED: 67-CONTEXT.md] |
| Model-estimated numeric correction commits | Explicit current-turn numeric evidence or backend-owned proposal only | Phase 66 | Mixed follow-up selection plus numeric update must still pass numeric authority. [VERIFIED: Phase 66 verification; VERIFIED: 67-CONTEXT.md] |
| LLM-authored correction clarification | Backend-rendered terminal clarification for update/delete targeting | Phase 67 target state | Clarification copy cannot be paraphrased, reordered, or success-styled by model. [VERIFIED: 67-CONTEXT.md] |
| Serialized `find_meals` JSON reparsed in orchestrator | Structured tool result transport | Deferred to Phase 68 | Phase 67 should not fully solve TARGET-03. [VERIFIED: .planning/REQUIREMENTS.md; VERIFIED: codebase grep] |

**Deprecated/outdated:**
- Raw correction text as clarification target label: current `index.ts` can derive `targetLabel` from `userMessage`; Phase 67 forbids this. [VERIFIED: codebase grep; VERIFIED: 67-CONTEXT.md]
- Additive score policy as the full resolver decision: current `scoreCandidate()` is not sufficient because it ignores `mealPeriodSource` and does not encode the clean-unique evidence threshold. [VERIFIED: codebase grep; VERIFIED: 67-CONTEXT.md]

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|

**If this table is empty:** All claims in this research were verified or cited — no user confirmation needed.

## Open Questions

1. **How much stale/deleted recovery should Phase 67 implement before Phase 68 structured results?**
   - What we know: D-45 prefers rerendering current scoped options after stale/deleted failures, and D-46 forbids auto-retargeting. [VERIFIED: 67-CONTEXT.md]
   - What's unclear: whether the existing pending-state shape contains enough original scope/evidence metadata to rerender after a stale mutator failure without broader structured result plumbing. [VERIFIED: codebase grep]
   - Recommendation: plan a scoped data-shape addition in `meal-correction.ts`; if full delayed recovery would require generic structured tool-result work, explicitly defer that part to Phase 68 while preserving fail-closed stale behavior. [VERIFIED: 67-CONTEXT.md; VERIFIED: .planning/REQUIREMENTS.md]

2. **Should grouped labels be shortened now?**
   - What we know: D-25 allows full stored-item joins and D-25a says tests currently expect full joined labels. [VERIFIED: 67-CONTEXT.md]
   - What's unclear: whether concise means shortening in this phase or just avoiding raw correction request echoes. [VERIFIED: 67-CONTEXT.md]
   - Recommendation: keep full stored/projected labels unless the planner adds explicit tasks to update assertions and preserve distinguishability. [VERIFIED: 67-CONTEXT.md]

3. **Should invalid number copy live in service or renderer module?**
   - What we know: invalid option should re-show the same options and state valid numbers. [VERIFIED: 67-CONTEXT.md]
   - What's unclear: exact helper placement is discretionary. [VERIFIED: 67-CONTEXT.md]
   - Recommendation: keep selection-state decisions in `meal-correction.ts`, but place reusable Traditional Chinese copy helpers near `mutation-receipts.ts` if multiple orchestrator paths need them. [VERIFIED: AGENTS.md; VERIFIED: codebase grep]

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Node.js | TypeScript execution and `node:test` | yes | v24.14.0 | none needed [VERIFIED: local env] |
| yarn | Project scripts and dependency commands | yes | 1.22.22 | none; npm is forbidden by AGENTS.md [VERIFIED: local env; VERIFIED: AGENTS.md] |
| gsd-sdk | Phase init/context workflow | yes | 1.1.0 | manual file reads already completed [VERIFIED: local env] |
| ctx7 | Optional library docs lookup | no | — | not needed; no new library docs required for this code-only phase [VERIFIED: local env] |
| slopcheck | Package legitimacy audit | not run | — | not needed because no package install is recommended [VERIFIED: local env] |

**Missing dependencies with no fallback:** none. [VERIFIED: local env]  
**Missing dependencies with fallback:** ctx7 is unavailable, but this phase is repo-internal and no external package API research is required. [VERIFIED: local env]

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Node built-in `node:test` under Node v24.14.0 [VERIFIED: package.json; VERIFIED: local env] |
| Config file | none detected for Jest/Vitest; scripts use Node test directly [VERIFIED: package.json; VERIFIED: codebase grep] |
| Quick run command | `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/meal-correction.test.ts tests/unit/tools.test.ts tests/unit/orchestrator.test.ts tests/integration/chat-meal-correction.integration.test.ts` [VERIFIED: package.json; VERIFIED: codebase grep] |
| Full suite command | `yarn test` [VERIFIED: package.json] |

### Phase Requirements -> Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| TARGET-01 | `那餐` / `那筆` recent references prefer allowed current/today/recency without overriding stronger label or period evidence. | unit + integration | `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/meal-correction.test.ts tests/integration/chat-meal-correction.integration.test.ts` | yes; add cases [VERIFIED: codebase grep] |
| TARGET-01 | Food/item label evidence narrows candidates before period/recency hints; unmatched likely food labels do not resolve period-only meals. | unit + integration | `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/meal-correction.test.ts tests/integration/chat-meal-correction.integration.test.ts` | yes; extend existing grouped-item cases [VERIFIED: codebase grep] |
| TARGET-01 | Explicit persisted `mealPeriod` outranks inferred `loggedAt` period; inferred period remains fallback. | unit | `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/meal-correction.test.ts` | yes; add explicit-over-inferred regression [VERIFIED: codebase grep; VERIFIED: 67-CONTEXT.md] |
| TARGET-02 | Multi-candidate clarification includes stable numbered options matching `請直接回覆編號`. | unit + integration | `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/meal-correction.test.ts tests/unit/orchestrator.test.ts tests/integration/chat-meal-correction.integration.test.ts` | yes; strengthen assertions [VERIFIED: codebase grep] |
| TARGET-02 | Clarification labels use backend-derived stored/projected labels or `餐點`, not raw user correction request. | unit + integration | `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/orchestrator.test.ts tests/integration/chat-meal-correction.integration.test.ts` | yes; existing tests cover one grouped-label case, add terminal renderer proof [VERIFIED: codebase grep] |
| TARGET-02 | LLM cannot paraphrase, append success-style text, or reorder backend-rendered clarification. | orchestrator/integration | `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/orchestrator.test.ts tests/integration/chat-meal-correction.integration.test.ts` | yes; add controlled reply tests [VERIFIED: codebase grep] |

### Sampling Rate

- **Per task commit:** run the narrow targeted command for touched tests plus `yarn tsc --noEmit` for TypeScript edits. [VERIFIED: AGENTS.md]
- **Per wave merge:** run `yarn test:unit` after service/orchestrator unit changes, and `yarn test:integration` after route/service behavior changes. [VERIFIED: AGENTS.md]
- **Phase gate:** run `yarn tsc --noEmit` and the targeted unit/integration commands; `yarn release:check` belongs to release/promotion prep or Phase 68 closure. [VERIFIED: AGENTS.md; VERIFIED: .planning/REQUIREMENTS.md]

### Wave 0 Gaps

- [ ] `tests/unit/meal-correction.test.ts` — add explicit-period-over-inferred, period-plus-`那餐` with newer non-matching meal, invalid-number re-show, label-set clarification ordering, and unmatched food label no-fallback proof. [VERIFIED: 67-CONTEXT.md; VERIFIED: codebase grep]
- [ ] `tests/unit/orchestrator.test.ts` — add renderer-owned terminal clarification proof where the LLM attempts to paraphrase or use raw target copy after `find_meals`. [VERIFIED: 67-CONTEXT.md; VERIFIED: codebase grep]
- [ ] `tests/integration/chat-meal-correction.integration.test.ts` — add Fastify route proof for stable numbered backend copy, no mutation, no `summaryOutcome`, no publish, and no raw correction echo. [VERIFIED: 67-CONTEXT.md; VERIFIED: codebase grep]

## Security Domain

### Applicable ASVS Categories

OWASP ASVS is an OWASP project that provides verification requirements for web application technical security controls. [CITED: https://owasp.org/www-project-application-security-verification-standard/] The OWASP Developer Guide index includes V2 Authentication, V3 Session Management, V4 Access Control, V5 Validation/Sanitization/Encoding, and V6 Stored Cryptography categories. [CITED: https://devguide.owasp.org/en/06-verification/01-guides/03-asvs/]

| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V2 Authentication | no direct new auth feature | Preserve existing signed guest-session/device ownership boundaries; do not accept raw `deviceId` selectors for protected browser routes. [VERIFIED: AGENTS.md] |
| V3 Session Management | indirectly | Pending selection is per-device turn state with TTL; do not widen scope across devices or actions. [VERIFIED: codebase grep; VERIFIED: 67-CONTEXT.md] |
| V4 Access Control | yes | `find_meals`, update, and delete must remain device-scoped through service queries and resolver-owned IDs. [VERIFIED: codebase grep] |
| V5 Input Validation | yes | Keep Zod tool schemas for `find_meals`, `update_meal`, `delete_meal`, and validate action/query before service execution. [VERIFIED: codebase grep] |
| V6 Cryptography | no new crypto | Do not introduce custom crypto; Phase 67 should not change signed guest-session handling. [VERIFIED: AGENTS.md] |

### Known Threat Patterns for Nutrition Coach Correction Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Cross-device meal mutation | Elevation of privilege | Keep candidate loading and mutation services scoped to `deviceId`; never trust model-supplied `meal_id` without resolver-owned session state. [VERIFIED: codebase grep] |
| Prompt/model target retargeting | Tampering | Backend resolver owns target selection; renderer-owned copy terminates ambiguity turns. [VERIFIED: 67-CONTEXT.md] |
| Stale revision overwrite | Tampering | Preserve expected meal revision checks and `MealRevisionPreconditionError` fail-closed behavior. [VERIFIED: Phase 66 verification] |
| Data leakage in artifacts/logs | Information disclosure | Keep tests metadata-only and avoid raw prompts/tool payloads in harness artifacts; Phase 67 likely needs no harness artifact. [VERIFIED: .planning/REQUIREMENTS.md; VERIFIED: AGENTS.md] |
| SQL injection via target query | Tampering | Use Drizzle builders and never interpolate user query into raw SQL. [VERIFIED: nutrition-security-review skill; VERIFIED: codebase grep] |

## Sources

### Primary (HIGH confidence)
- `.planning/phases/67-correction-targeting-and-backend-clarification-rendering/67-CONTEXT.md` — locked decisions, discretion areas, deferred boundary. [VERIFIED: local file]
- `.planning/REQUIREMENTS.md` — TARGET-01/TARGET-02 ownership and TARGET-03 Phase 68 boundary. [VERIFIED: local file]
- `.planning/ROADMAP.md` — Phase 67 goal, dependency, success criteria, implementation notes. [VERIFIED: local file]
- `.planning/STATE.md` — active v2.4 decisions and Phase 65/66 carry-forward facts. [VERIFIED: local file]
- `.planning/phases/66-numeric-correction-provenance-guard/66-CONTEXT.md` and `66-VERIFICATION.md` — numeric authority and stale/no-publish dependency evidence. [VERIFIED: local file]
- `AGENTS.md` — repo workflow, architecture, testing, and verification constraints. [VERIFIED: local file]
- `server/services/meal-correction.ts` — candidate data, current scoring, pending state, prompt generation, update/delete service behavior. [VERIFIED: codebase grep]
- `server/orchestrator/tools.ts` — `find_meals`, resolver-owned target state, update/delete preconditions, controlled reply precedent. [VERIFIED: codebase grep]
- `server/orchestrator/index.ts` — current correction clarification rendering and controlled reply short-circuit. [VERIFIED: codebase grep]
- `tests/unit/meal-correction.test.ts`, `tests/unit/orchestrator.test.ts`, `tests/integration/chat-meal-correction.integration.test.ts` — existing proof surfaces and gaps. [VERIFIED: codebase grep]
- OWASP ASVS project page and OWASP Developer Guide ASVS page — security categories and ASVS purpose. [CITED: https://owasp.org/www-project-application-security-verification-standard/; CITED: https://devguide.owasp.org/en/06-verification/01-guides/03-asvs/]

### Secondary (MEDIUM confidence)
- Project skill indexes `nutrition-gen-test`, `nutrition-verify-change`, `nutrition-code-review`, `nutrition-security-review`, `nutrition-new-harness-scenario`, `nutrition-harness-review`, `nutrition-railway-smoke`, `nutrition-milestone-closeout` — repo-specific planning implications for test layer selection and verification. [VERIFIED: local file]

### Tertiary (LOW confidence)
- None.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — verified from `package.json`, `yarn list`, AGENTS.md, and local commands. [VERIFIED: local env; VERIFIED: package.json]
- Architecture: HIGH — current service/orchestrator/tool boundaries are directly visible in code and align with locked Phase 67 decisions. [VERIFIED: codebase grep; VERIFIED: 67-CONTEXT.md]
- Pitfalls: HIGH — each pitfall maps to a current implementation detail or locked decision. [VERIFIED: codebase grep; VERIFIED: 67-CONTEXT.md]

**Research date:** 2026-05-29  
**Valid until:** 2026-06-28 for repo-internal architecture; re-check package/env versions before implementation if dependencies change.
