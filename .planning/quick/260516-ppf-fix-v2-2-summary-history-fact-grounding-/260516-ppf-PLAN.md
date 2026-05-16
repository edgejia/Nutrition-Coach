---
quick_task: 260516-ppf
phase: 260516-ppf-fix-v2-2-summary-history-fact-grounding
plan: 1
type: execute
wave: 1
depends_on: []
files_modified:
  - server/orchestrator/tools.ts
  - server/orchestrator/index.ts
  - tests/unit/tools.test.ts
  - tests/unit/orchestrator.test.ts
  - tests/integration/chat-api.test.ts
  - tests/integration/chat-streaming.test.ts
autonomous: true
requirements:
  - quick-260516-ppf
must_haves:
  truths:
    - "get_daily_summary exposes persisted meal names and per-meal calories from meal rows, not only daily aggregate totals."
    - "A day-level aggregate total can preserve day-total wording only when no fake or mismatched meal-specific facts are claimed."
    - "A named meal claim can be preserved only when the claimed meal name exists in persisted meal facts and any per-meal kcal claim matches that meal within the documented tolerance."
    - "JSON and SSE summary/history replies reject fake meal lists and daily-total-as-single-meal claims before response or history persistence."
  artifacts:
    - path: "server/orchestrator/tools.ts"
      provides: "get_daily_summary result and tool message with persisted meal fact rows"
      contains: "meals"
    - path: "server/orchestrator/index.ts"
      provides: "summary/history no-mutation guard that separates day totals from named-meal kcal facts"
      exports: ["SummaryHistoryFacts", "guardNoMutationLoggingClaim"]
    - path: "tests/unit/tools.test.ts"
      provides: "tool contract regression for persisted meal facts in get_daily_summary"
    - path: "tests/unit/orchestrator.test.ts"
      provides: "guard regressions for fake meal lists and daily-total-as-single-meal claims"
    - path: "tests/integration/chat-api.test.ts"
      provides: "JSON route regression for fake summary/history meal attribution"
    - path: "tests/integration/chat-streaming.test.ts"
      provides: "SSE route regression for fake summary/history meal attribution"
  key_links:
    - from: "server/orchestrator/tools.ts"
      to: "server/services/food-logging.ts"
      via: "get_daily_summary execute calls foodLoggingService.getMealsByDate for the same resolved date"
      pattern: "getMealsByDate"
    - from: "server/orchestrator/tools.ts"
      to: "server/orchestrator/index.ts"
      via: "ToolExecutionResult carries summaryHistoryFacts or equivalent meal facts into orchestrator result state"
      pattern: "summaryHistoryFacts|meals"
    - from: "server/orchestrator/index.ts"
      to: "server/routes/chat.ts"
      via: "existing route guard calls continue receiving summaryHistoryFacts for JSON, drained stream, and SSE final emission"
      pattern: "guardNoMutationLoggingClaim"
---

<objective>
Fix the v2.2 summary/history fact-grounding blocker by making persisted meal facts available through `get_daily_summary`, then tightening the no-mutation guard so aggregate day totals never authorize invented meal names or assigning the whole day total to one named meal.

Purpose: The locked grounding policy says persisted meal records are the only source of meal names and per-meal kcal facts. Daily aggregate totals may support day-total wording only; they cannot validate fake meal lists or wrong per-meal attribution.

Output: A surgical code patch plus unit and integration regressions proving fake meal lists and daily-total-as-single-meal claims are blocked.
</objective>

<execution_context>
@$HOME/.codex/get-shit-done/workflows/execute-plan.md
@$HOME/.codex/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.planning/quick/260516-ppf-fix-v2-2-summary-history-fact-grounding-/260516-ppf-CONTEXT.md
@.planning/quick/260516-nwi-fix-v2-2-pre-promotion-blockers-by-repla/260516-nwi-SUMMARY.md
@server/orchestrator/tools.ts
@server/orchestrator/index.ts
@server/routes/chat.ts
@server/services/summary.ts
@server/services/food-logging.ts
@server/services/meal-history.ts
@tests/unit/tools.test.ts
@tests/unit/orchestrator.test.ts
@tests/integration/chat-api.test.ts
@tests/integration/chat-streaming.test.ts

<locked_decisions>
- D-01: Persisted meal records are the only allowed source for meal names and per-meal kcal facts in summary/history output.
- D-02: Aggregate daily totals can support day-level totals only. They must not authorize invented meal names, fake meal lists, or assigning the full daily total to one meal.
- D-03: Keep the change surgical and add focused regression coverage for fake meal lists and daily-total-as-single-meal claims.
</locked_decisions>

<interfaces>
From `server/services/summary.ts`: `DailySummary` exposes `totalCalories`, `totalProtein`, `totalCarbs`, `totalFat`, `mealCount`, and `date`. It does not include meal names or item rows.

From `server/services/food-logging.ts`: `foodLoggingService.getMealsByDate(deviceId, date)` delegates to meal history and returns persisted rows with `foodName`, `itemCount`, `calories`, macros, image path, loggedAt, and deviceId.

From `server/orchestrator/tools.ts`: `GetDailySummaryResult` currently returns `{ status: "summary", dailySummary, affectedDate? }`, and `ToolExecutionResult` currently carries `dailySummary` but no summary/history meal facts.

From `server/orchestrator/index.ts`: `SummaryHistoryFacts` currently contains optional `dailySummary` plus `meals: Array<{ foodName: string; calories: number }>`; `guardNoMutationLoggingClaim()` is the shared guard used by orchestrator and route paths.

From `server/routes/chat.ts`: JSON, drained non-SSE stream, and SSE final paths already call `guardNoMutationLoggingClaim(..., { summaryHistoryFacts })`. Preserve that wiring and avoid changing SSE event ordering.
</interfaces>
</context>

<source_audit>
## Multi-Source Coverage Audit

| Source | Item | Coverage |
|--------|------|----------|
| GOAL | Fix v2.2 summary/history fact-grounding blocker | Tasks 1-3 |
| CONTEXT D-01 | Persisted meal records are only source for meal names and per-meal kcal | Tasks 1-2 |
| CONTEXT D-02 | Aggregate totals cannot authorize fake meal names/lists or full-day kcal as one meal | Tasks 2-3 |
| CONTEXT D-03 | Surgical change with fake meal list and daily-total-as-single-meal regressions | Tasks 1-3 |
| RESEARCH | None supplied; no external research phase requested | Excluded |
| REQ | Quick task only; no ROADMAP requirement IDs supplied | Covered by `quick-260516-ppf` |
</source_audit>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Extend get_daily_summary with persisted meal facts</name>
  <files>server/orchestrator/tools.ts, tests/unit/tools.test.ts</files>
  <behavior>
    - Test 1: after logging two persisted meals, `get_daily_summary` returns the existing daily aggregate plus a `meals` array containing each persisted `foodName` and meal-level `calories`.
    - Test 2: the `result` / `toolMessage` visible to the model includes persisted meal facts, while `summary` remains the existing macro text format.
    - Test 3: the no-meal case returns `meals: []` and does not invent item names from the aggregate summary.
  </behavior>
  <action>Per D-01, update the `get_daily_summary` contract in `server/orchestrator/tools.ts` so the resolved single-date summary path queries `deps.foodLoggingService.getMealsByDate(deviceId, sameResolvedDate)` and returns persisted meal facts alongside `dailySummary`. Keep `DailySummary` itself unchanged unless the local type system requires a small companion type; do not move this into `summaryService` unless needed. Add a `summaryHistoryFacts` or equivalent field to `ToolExecutionResult` so `executeTool()` can pass `{ dailySummary, meals }` back to the orchestrator without an extra ambiguous aggregate-only source. Preserve the existing `summary` string format `熱量 ...` for log summaries. Update `tests/unit/tools.test.ts` before implementation, using real SQLite and existing service factories, to prove both populated and empty meal fact payloads.</action>
  <verify>
    <automated>node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/tools.test.ts</automated>
  </verify>
  <done>`get_daily_summary` exposes persisted meal fact rows to the LLM/tool result path, existing aggregate summary behavior remains compatible, and unit tests fail without the new meal fact payload.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Tighten summary/history guard semantics</name>
  <files>server/orchestrator/index.ts, tests/unit/orchestrator.test.ts</files>
  <behavior>
    - Test 1: facts for `雞胸肉 450 kcal` and `鮭魚飯 450 kcal` reject `今天已記錄雞胸肉，900 kcal。`.
    - Test 2: facts for the same two meals reject `今天已記錄 2 餐，共 900 kcal，其中包含牛肉飯。`.
    - Test 3: facts for the same two meals preserve pure day-level aggregate wording such as `今天已記錄 2 餐，共 900 kcal。`.
    - Test 4: facts for one matching meal preserve `目前已記錄的餐點有豆腐飯，約 520 kcal。`.
  </behavior>
  <action>Per D-01 and D-02, change `server/orchestrator/index.ts` so named-meal claims and per-meal kcal claims are validated only against persisted `SummaryHistoryFacts.meals`. Remove any fallback that lets a named-meal claim pass solely because the claimed kcal matches `dailySummary.totalCalories`. Keep `SUMMARY_HISTORY_CALORIE_TOLERANCE_KCAL` for approximate comparisons, but apply it to the correct authority: day totals for pure aggregate day-level wording; meal calories for named meal claims. If a reply includes both aggregate wording and claimed meal names, require every claimed name to match persisted meals before the aggregate total can preserve the reply. Wire orchestrator state to use the meal facts returned by `executeTool()` for `get_daily_summary`; retain the existing route result shape and exported `SummaryHistoryFacts` contract. Do not broaden regex extraction beyond the needed claim forms unless a regression requires it.</action>
  <verify>
    <automated>node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/orchestrator.test.ts</automated>
  </verify>
  <done>Unit coverage proves daily totals no longer authorize fake named meals or one-meal attribution, while legitimate aggregate and matching meal-specific summary/history replies still pass.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Add JSON and SSE regression coverage</name>
  <files>tests/integration/chat-api.test.ts, tests/integration/chat-streaming.test.ts</files>
  <behavior>
    - Test 1: JSON `get_daily_summary` with two persisted meals rejects a final reply that assigns the 900 kcal daily total to `雞胸肉`.
    - Test 2: JSON `get_daily_summary` with two persisted meals rejects a fake meal list containing `牛肉飯` even when meal count and total kcal match.
    - Test 3: SSE summary-context stream rejects the daily-total-as-single-meal claim before any visible chunk or persisted assistant history contains the unsafe named-meal text.
    - Test 4: SSE summary-context stream rejects a fake meal list before visible chunks or persisted assistant history contain the fake item.
  </behavior>
  <action>Per D-03, add focused route regressions using the existing `MockLLMProvider`, `buildApp()` fixture, cookie-backed session setup, real SQLite, and existing SSE parsing helpers. Seed persisted meals through `services.foodLoggingService.logFood()`, queue a `get_daily_summary` tool call, then queue unsafe model text. Assert `didLogMeal === false`, `didMutateMeal === false`, unsafe meal names/calorie attribution are absent from the returned reply or SSE chunks, and persisted assistant history matches the guarded final text. Keep these as route-level tests only; do not add a new harness scenario for this quick blocker.</action>
  <verify>
    <automated>node scripts/run-node-with-tz.mjs --import tsx --test tests/integration/chat-api.test.ts tests/integration/chat-streaming.test.ts</automated>
    <automated>yarn tsc --noEmit</automated>
  </verify>
  <done>JSON and SSE integration tests prove fake meal lists and daily-total-as-single-meal claims are blocked before user-visible output and history persistence, and TypeScript passes.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| LLM final text -> route response/history | Untrusted model text may claim facts not supported by persisted meal data. |
| Tool result -> LLM context | Persisted meal facts are intentionally exposed to the model for grounding; only non-secret meal names and nutrition totals are included. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-260516-ppf-01 | Tampering | `guardNoMutationLoggingClaim` | mitigate | Validate claimed names and per-meal kcal against persisted `SummaryHistoryFacts.meals`; do not allow aggregate totals to validate named meal claims. |
| T-260516-ppf-02 | Information Disclosure | `get_daily_summary` tool message | accept | Meal facts are same-device persisted nutrition data already available through summary/history flows; include only foodName and calories needed for grounding. |
| T-260516-ppf-03 | Repudiation | JSON/SSE route outputs | mitigate | Add integration regressions proving unsafe model text is replaced before response/history persistence. |
</threat_model>

<verification>
Run the task-level checks, then run the combined gate for the edited TypeScript paths:

<automated>node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/tools.test.ts tests/unit/orchestrator.test.ts tests/integration/chat-api.test.ts tests/integration/chat-streaming.test.ts</automated>
<automated>yarn test:unit</automated>
<automated>yarn tsc --noEmit</automated>
</verification>

<success_criteria>
- `get_daily_summary` returns persisted meal facts for the resolved day.
- The no-mutation summary/history guard distinguishes day-total authority from named-meal authority.
- Fake meal lists and daily-total-as-single-meal claims are blocked in unit, JSON, and SSE coverage.
- Existing legitimate aggregate and matching meal-specific summary/history replies remain preserved.
- No staging/main promotion, deployment, or release branch action occurs as part of this quick task.
</success_criteria>

<output>
After completion, create `.planning/quick/260516-ppf-fix-v2-2-summary-history-fact-grounding-/260516-ppf-SUMMARY.md`.
</output>
