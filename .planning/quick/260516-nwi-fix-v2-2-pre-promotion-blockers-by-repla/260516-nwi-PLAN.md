---
phase: 260516-nwi-fix-v2-2-pre-promotion-blockers-by-repla
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - server/orchestrator/index.ts
  - server/routes/chat.ts
  - tests/unit/orchestrator.test.ts
  - tests/integration/chat-api.test.ts
  - tests/integration/chat-streaming.test.ts
  - tests/harness/sse.ts
  - tests/unit/harness-foundation.test.ts
  - tests/harness/scenarios/image-log-failure.ts
autonomous: true
requirements: [QUICK-NWI-01]
must_haves:
  truths:
    - "No no-mutation reply can claim a meal was recorded unless the referenced meal facts exist in actual summary/history facts."
    - "Empty summary/history facts block all meal-specific 已記錄 / 完成記錄 claims."
    - "Aggregate summary/history replies are preserved only when claimed meal count and calories match actual facts or a documented tolerance."
    - "JSON, non-SSE drained stream, and SSE final emission all use the same fact-grounded guard."
    - "SSE summary-context buffering prevents unsafe text from being emitted before classification."
    - "Harness SSE evidence observes stream close, proves at least one non-empty chunk before first done, and fails if any chunk/status appears after first done."
  artifacts:
    - path: "server/orchestrator/index.ts"
      provides: "Fact-grounded guardNoMutationLoggingClaim contract and summary/history fact extraction"
      contains: "guardNoMutationLoggingClaim"
    - path: "server/routes/chat.ts"
      provides: "JSON, drained-stream, and SSE route wiring that passes actual facts into the shared guard"
      contains: "handleStreamingReply"
    - path: "tests/unit/orchestrator.test.ts"
      provides: "Unit guard regression matrix for empty facts, mismatched names, legitimate meal-specific facts, aggregate match, and aggregate mismatch"
    - path: "tests/integration/chat-api.test.ts"
      provides: "JSON route regressions for fact-grounded summary/history guard behavior"
    - path: "tests/integration/chat-streaming.test.ts"
      provides: "True SSE regressions for fact-grounded guard behavior and no pre-classification leakage"
    - path: "tests/harness/sse.ts"
      provides: "Harness SSE collector that can observe stream close and terminal-event violations"
    - path: "tests/harness/scenarios/image-log-failure.ts"
      provides: "Generated-evidence scenario using the stricter terminal SSE contract"
  key_links:
    - from: "server/orchestrator/index.ts"
      to: "server/routes/chat.ts"
      via: "guard context object containing actual summary/history facts"
      pattern: "guardNoMutationLoggingClaim\\(.*summary"
    - from: "server/routes/chat.ts"
      to: "tests/integration/chat-streaming.test.ts"
      via: "SSE buffered final classification before chunk emission"
      pattern: "summary-context.*stream"
    - from: "tests/harness/sse.ts"
      to: "tests/harness/scenarios/image-log-failure.ts"
      via: "shared collection helper records post-done events and stream close"
      pattern: "collect.*SSE|read.*close"
---

<objective>
Replace the existing regex-based summary/history allowance with fact-grounded validation, and prove the route plus harness SSE contracts before any v2.2 promotion step.

Purpose: The previous guard can preserve fabricated 已記錄 / 完成記錄 claims when model text merely matches an allowlist pattern. This plan makes persisted summary/history facts the authority and tightens harness proof so release evidence cannot pass on a truncated stream.
Output: One focused patch with unit/integration/harness verification and no push, deploy, merge, rebase, fast-forward, or promotion action.
</objective>

<execution_context>
@$HOME/.codex/get-shit-done/workflows/execute-plan.md
@$HOME/.codex/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@AGENTS.md
@.codex/skills/nutrition-gen-test/SKILL.md
@.codex/skills/nutrition-new-harness-scenario/SKILL.md
@.codex/skills/nutrition-verify-change/SKILL.md
@.codex/skills/nutrition-harness-review/SKILL.md
@server/orchestrator/index.ts
@server/routes/chat.ts
@server/services/summary.ts
@tests/unit/orchestrator.test.ts
@tests/integration/chat-api.test.ts
@tests/integration/chat-streaming.test.ts
@tests/harness/sse.ts
@tests/harness/scenarios/image-log-failure.ts

<interfaces>
From `server/services/summary.ts`: `DailySummary` currently exposes `totalCalories`, `totalProtein`, `totalCarbs`, `totalFat`, `mealCount`, and `date`; it does not include meal names/items. The executor must derive meal names/items for guard facts from the tool result/history facts already available in orchestrator/route flow, not from regex topic words alone.

From `server/orchestrator/index.ts`: `guardNoMutationLoggingClaim(reply, didLogMeal, didMutateMeal, context)` currently accepts `{ hasSummaryOrHistoryContext?: boolean }` and allows replies using `SUMMARY_OR_HISTORY_ALLOWED_LOGGING_REFERENCE_PATTERNS`. That constant must be removed or made non-authoritative: regex may detect/parse candidate claims, but final allow decisions must compare against actual facts.

From `server/routes/chat.ts`: `handleStreamingReply()` currently computes `hasSummaryContext`, buffers summary-context no-mutation streams, and calls `guardNoMutationLoggingClaim()` in stopped, final SSE, drained non-SSE stream, and JSON reply paths. Preserve summary-context buffering while passing the same actual fact context to every guard call.

From `tests/harness/sse.ts`: `readStreamUntilEvent()` stops as soon as `event: done` appears. Add or replace with a helper that reads through stream close with a bounded timeout/max read, returns raw text plus parsed ordered events, and lets callers assert no `status` or `chunk` after the first `done`.
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Replace regex allowlist with fact-grounded guard</name>
  <files>server/orchestrator/index.ts, tests/unit/orchestrator.test.ts</files>
  <behavior>
    - Empty summary/history facts plus reply `今天已記錄牛肉飯，650 kcal。` returns the no-mutation fallback.
    - Summary/history facts for `豆腐飯` do not allow reply `今天已記錄牛肉飯，650 kcal。`.
    - Summary/history facts for one `豆腐飯` meal allow meal-specific wording that references `豆腐飯` and its matching calories.
    - Summary/history facts for two meals totaling 900 kcal allow aggregate wording that claims 2 meals and 900 kcal.
    - Summary/history facts for two meals totaling 900 kcal reject aggregate wording that claims a different meal count or calories outside the explicitly documented tolerance.
    - `rg -n "SUMMARY_OR_HISTORY_ALLOWED_LOGGING_REFERENCE_PATTERNS" server/orchestrator/index.ts` returns no direct allow condition; if the symbol remains, it is only used for candidate detection/parsing and not as a final allow gate.
  </behavior>
  <action>First add failing unit coverage around `guardNoMutationLoggingClaim()`. Change the guard context from `hasSummaryOrHistoryContext` to actual fact inputs, for example a small internal type containing `dailySummary` aggregate numbers plus known summary/history meal names/items/calories. Implement parsing only as claim extraction: detect meal-specific claims, aggregate meal-count claims, and aggregate calorie claims, then allow only when extracted claims match the supplied facts. Document any aggregate calorie tolerance as a named constant with a short rationale in `server/orchestrator/index.ts`; do not use broad regex matches as an allow condition. Empty or absent facts must fail closed. Keep successful mutation replies unaffected because `didLogMeal` or `didMutateMeal` short-circuits the no-mutation guard.</action>
  <verify>
    <automated>node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/orchestrator.test.ts</automated>
    <automated>rg -n "SUMMARY_OR_HISTORY_ALLOWED_LOGGING_REFERENCE_PATTERNS" server/orchestrator/index.ts; test $? -ne 0</automated>
  </verify>
  <done>Unit tests prove false no-mutation claims are blocked by facts, legitimate fact-matching summary/history replies are preserved, aggregate mismatch is rejected, and the old regex allowlist is not a direct allow condition.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Reuse the same guard across JSON, drained stream, and SSE</name>
  <files>server/orchestrator/index.ts, server/routes/chat.ts, tests/integration/chat-api.test.ts, tests/integration/chat-streaming.test.ts</files>
  <behavior>
    - JSON `get_daily_summary` with empty summary rejects meal-specific `已記錄` claims.
    - JSON `get_daily_summary` with actual `豆腐飯` facts preserves `目前已記錄的餐點有豆腐飯，約 520 kcal。`.
    - JSON `get_daily_summary` with actual `豆腐飯` facts rejects mismatched `牛肉飯` wording.
    - Non-SSE callers that receive and drain a stream use the same fact-grounded guard before saving history or returning JSON.
    - True SSE summary-context streams do not emit unsafe text before final classification, preserve matching one-meal and multi-meal aggregate wording, and reject aggregate count/calorie mismatches.
  </behavior>
  <action>Pass actual summary/history facts into every `guardNoMutationLoggingClaim()` call in orchestrator and route code. In `server/routes/chat.ts`, keep the summary-context buffering behavior so candidate unsafe tokens are held until final classification, then emit either the fact-approved sanitized reply or the no-mutation fallback. Make the JSON response, persisted assistant history, drained stream JSON response, SSE chunks, and SSE `done` payload agree on `didLogMeal=false` / `didMutateMeal=false` and the final guarded text. Add JSON tests in `tests/integration/chat-api.test.ts` and true streaming tests in `tests/integration/chat-streaming.test.ts` for empty-summary false claims, mismatched meal-name false claims, legitimate one-meal summary wording, legitimate multi-meal aggregate wording, and rejected aggregate count/calorie mismatch.</action>
  <verify>
    <automated>node scripts/run-node-with-tz.mjs --import tsx --test tests/integration/chat-api.test.ts tests/integration/chat-streaming.test.ts</automated>
  </verify>
  <done>All route surfaces use the same fact-grounded guard, unsafe summary-context SSE text never leaks before classification, and JSON/SSE/history outcomes match the actual facts.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Fix harness SSE terminal collection and verification metadata</name>
  <files>tests/harness/sse.ts, tests/unit/harness-foundation.test.ts, tests/harness/scenarios/image-log-failure.ts, .planning/quick/260516-nwi-fix-v2-2-pre-promotion-blockers-by-repla/260516-nwi-SUMMARY.md</files>
  <behavior>
    - Shared harness SSE collection reads until stream close, not merely until the first `done`.
    - The helper reports first `done` index, stream-closed evidence, and any event after first `done`.
    - `image-log-failure` fails on any `chunk` or `status` after first `done`.
    - `image-log-failure` still proves at least one non-empty `chunk` before first `done`.
    - The quick-task SUMMARY records the actual SSE contract as `done` is terminal and stream close is observed; it must not describe a weaker stop-at-done proof.
  </behavior>
  <action>Add a bounded harness helper in `tests/harness/sse.ts` that reads a `ReadableStreamDefaultReader<Uint8Array>` through close and returns raw text, parsed events, `closed: true`, `firstDoneIndex`, `eventsAfterFirstDone`, and `nonEmptyChunkBeforeDone`. Cover the helper in `tests/unit/harness-foundation.test.ts` with passing and failing transcripts, including a chunk/status after done. Update `tests/harness/scenarios/image-log-failure.ts` to use the helper for stream collection and fail when post-done chunk/status events exist while retaining the non-empty chunk-before-done assertion. When execution creates `260516-nwi-SUMMARY.md`, record the commands and the actual contract: stream close observed, done terminal, no chunk/status after first done, and at least one non-empty chunk before done. Do not hand-edit generated files under `tests/harness/artifacts/**`; regenerate them with harness commands.</action>
  <verify>
    <automated>node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/harness-foundation.test.ts</automated>
    <automated>yarn verify:harness -- image-log-failure</automated>
    <automated>yarn verify:harness -- image-log</automated>
    <automated>yarn verify:harness -- protein-trust</automated>
    <automated>yarn test:unit</automated>
    <automated>yarn tsc --noEmit</automated>
    <automated>yarn release:check</automated>
  </verify>
  <done>Harness collection cannot false-pass on truncated SSE evidence, regenerated image-log-failure artifacts prove the terminal stream contract, and the quick-task summary/verification metadata reflects that stronger contract.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| LLM reply -> persisted chat history | Untrusted model text can create false user-visible facts if guard logic is permissive. |
| LLM token stream -> SSE client | Untrusted streamed tokens can reach the client before final response classification. |
| Harness transcript -> release evidence | Weak SSE collection can overstate proof if it stops at `done` without observing stream close or post-done violations. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-NWI-01 | Tampering | `guardNoMutationLoggingClaim` | mitigate | Replace direct regex allowlist with fact comparison against actual summary/history facts; empty facts fail closed. |
| T-NWI-02 | Information Disclosure | `handleStreamingReply` | mitigate | Preserve summary-context buffering and emit only the fact-approved final reply or fallback. |
| T-NWI-03 | Repudiation | `tests/harness/sse.ts` and `image-log-failure` | mitigate | Read to stream close, record terminal evidence, and fail on chunk/status after first done. |
</threat_model>

<verification>
Run the requested checks from the repo root with `yarn` where applicable:
- `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/orchestrator.test.ts tests/unit/harness-foundation.test.ts`
- `node scripts/run-node-with-tz.mjs --import tsx --test tests/integration/chat-api.test.ts tests/integration/chat-streaming.test.ts`
- `yarn verify:harness -- image-log-failure`
- `yarn verify:harness -- image-log`
- `yarn verify:harness -- protein-trust`
- `yarn test:unit`
- `yarn tsc --noEmit`
- `yarn release:check`

Do not push, deploy, merge, rebase, fast-forward, or promote after verification.
</verification>

<source_audit>
| Source | Item | Coverage |
|--------|------|----------|
| GOAL | Replace no-mutation summary/history regex allowlist with fact-grounded validation | Tasks 1 and 2 |
| GOAL | Keep SSE summary-context buffering so unsafe text is not emitted before classification | Task 2 |
| REQ | Remove or disable `SUMMARY_OR_HISTORY_ALLOWED_LOGGING_REFERENCE_PATTERNS` as a direct allow condition | Task 1 |
| REQ | Pass actual dailySummary/history facts into `guardNoMutationLoggingClaim` | Tasks 1 and 2 |
| REQ | Empty summaries block meal-specific 已記錄 / 完成記錄 claims | Tasks 1 and 2 |
| REQ | Preserve meal-specific summary/history replies only when referenced meals/items exist in facts | Tasks 1 and 2 |
| REQ | Preserve aggregate replies only when count/calories match or documented tolerance | Tasks 1 and 2 |
| REQ | Reuse same fact-grounded guard for JSON, non-SSE drained stream, and SSE final emission | Task 2 |
| REQ | Add JSON and true SSE tests for empty-summary, mismatched meal name, one-meal wording, multi-meal aggregate, aggregate mismatch | Task 2 |
| REQ | Fix harness SSE collection for stream close, no chunk/status after first done, and non-empty chunk before done | Task 3 |
| REQ | Update GSD verification metadata to actual SSE contract | Task 3 |
| CONSTRAINT | No push/deploy/merge/rebase/fast-forward/promotion | Verification section and objective |
</source_audit>

<success_criteria>
- Old summary/history regex allowlist is not a direct allow condition.
- False no-mutation meal-recording claims are blocked for empty or mismatched facts.
- Matching one-meal and aggregate summary/history replies are preserved only when supported by facts.
- JSON, drained stream, SSE chunks, SSE done payload, and persisted history agree on guarded output.
- Harness SSE collection observes close and rejects post-done chunk/status events.
- Requested targeted tests, harness scenarios, unit suite, TypeScript gate, and release check pass.
</success_criteria>

<output>
After completion, create `.planning/quick/260516-nwi-fix-v2-2-pre-promotion-blockers-by-repla/260516-nwi-SUMMARY.md`.
</output>
