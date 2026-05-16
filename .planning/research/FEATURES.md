# Feature Landscape: v2.3 Authoritative Mutation Outcomes and Fresh Meal State

**Domain:** Chat-first nutrition logging data-integrity fixes
**Researched:** 2026-05-17
**Scope:** v2.3 P1 integrity behavior only
**Overall confidence:** HIGH for behavior boundaries from current planning/code/tests; MEDIUM for pending goal proposal storage shape because it is not implemented yet.

## Feature Categories

| Category | User Perspective | System Perspective | Complexity |
|----------|------------------|--------------------|------------|
| Structured goal proposals | A vague request like `我想少吃一點` can produce a concrete recommendation, but `好` only changes goals when it is confirming a backend-owned proposal or the user provides explicit numeric targets. | Store pending goal proposals as structured records with proposal id, target values, updated fields, status, owner device, source turn/message, and expiry/consumption rules. `update_goals` must be authorized from explicit current-turn numbers or a valid proposal id, not raw assistant prose. | High |
| Deterministic failed goal-update outcomes | When goal validation or guard checks reject a request, the reply asks for concrete targets or valid ranges and never says goals were updated. | Validation/guard failures from `update_goals` should map to backend-owned failure copy and `didMutateMeal: false`, no `dailyTargets`, no `goals_update`, and no LLM-authored success-style fallback. | Medium |
| Committed mutation receipts under summary failure | If meal log/update/delete commits but daily summary recompute fails, the user still gets a truthful committed receipt for the mutation. | Mutation tools/routes should recover summary facts from persisted rows or otherwise return committed mutation facts without converting a successful write into generic failure copy. Existing `log_food` has recovery; update/delete routes and chat correction paths need parity. | High |
| Stale chat receipt protection | Old chat receipt cards cannot overwrite a newer edited meal if the user taps an outdated receipt. The UI should either refuse the edit or force a refresh. | Chat receipts must carry enough current-revision identity to PATCH safely. PATCH should require the expected revision/receipt identity or reject stale writes with a deterministic conflict outcome. | High |
| SSE summary and meal-row freshness | When another tab/device changes today's meals, Home/Summary totals and visible meal rows stay consistent. | A `daily_summary` SSE event for today must trigger meal-row refresh or row invalidation, not only update aggregate totals. Malformed or stale SSE payloads remain ignored/non-fatal. | Medium |

## Table Stakes

| Feature | Why Expected | Acceptance Notes | Complexity |
|---------|--------------|------------------|------------|
| Fail-closed ambiguous goal confirmation | Users trust that `好` confirms the exact proposal they just saw, not an LLM reconstruction from chat history. | `好`, `可以`, `ok`, `就這樣`, and similar confirmations do not call `update_goals` unless tied to a valid pending proposal id. If no valid proposal exists, reply asks for numbers or offers a new proposal. | High |
| Proposal-backed goal recommendation lifecycle | Vague goal intent is common; the app needs a safe way to recommend numbers without mutating. | Creating a recommendation persists a pending proposal before it is shown. Proposal has one device owner, concrete full targets, updated fields, expiry/consumed status, and cannot be applied twice. | High |
| Explicit numeric goal update still works | Users who say `卡路里 1800 蛋白質 130` should not be forced into a proposal flow. | Current-turn explicit numeric values within bounds can update immediately and return the deterministic goal receipt. Source-text guard remains exact and narrow. | Medium |
| Backend-owned goal failure copy | Failed guard/validation outcomes are trust-critical because LLM prose can falsely imply success. | Guard failure: no mutation, no target event, deterministic copy such as `我需要具體數字，才能更新每日目標。請提供熱量、蛋白質、碳水或脂肪目標。` Validation failure: deterministic range/field copy. Response must not contain `已更新每日目標` or success synonyms. | Medium |
| Renderer-owned committed receipts | The visible mutation receipt should come from committed facts, not model wording. | Log/update/delete/goals success replies are rendered from `MutationEffects` or equivalent committed facts. LLM final text is skipped or ignored after mutation success. | Medium |
| Post-commit summary failure parity | A recompute failure after DB commit is not a failed mutation from the user's perspective. | For log/update/delete, committed outcome includes mutation kind, affected date, committed meal/deleted snapshot where applicable, and best available summary. If summary publish/recompute fails, mutation receipt still returns 200 on chat success paths where the write committed. | High |
| Stale receipt PATCH conflict | A stale receipt is a correctness bug, not a normal edit. | PATCH from a chat receipt includes expected current revision. If DB current revision differs, return conflict without changing meal facts. Client refreshes or disables editing from that receipt. | High |
| Summary SSE refreshes meal rows | Users should not see totals for one state and meal rows from another. | On valid `daily_summary` for local today, the client updates/accepts totals and triggers `getMeals({ refreshReason: "meal_mutation" })` or invalidates rows until refreshed. Errors are swallowed but leave a visible non-stale-safe state, not mismatched rows. | Medium |
| Existing stale-date guard remains | Date rollover protection already rejects mismatched summary dates. | Summary date mismatch still does not overwrite current summary and may invoke rollover refresh. v2.3 adds same-date row freshness, not a replacement for date guards. | Low |

## Acceptance Boundaries

### GOAL-01: Structured Pending Goal Proposals

- Vague goal-change text without explicit numbers must not mutate goals in the same turn unless a valid pending proposal id is explicitly applied by backend logic.
- A backend proposal must include concrete target values for calories, protein, carbs, and fat, plus the subset of fields being intentionally changed.
- Proposal confirmation must verify device ownership, unexpired status, not-consumed status, and exact proposal id before applying.
- `好` after an LLM-only recommendation with no persisted proposal does not update goals.
- `好` after multiple active proposals does not guess; it asks which proposal or asks for explicit numbers.
- A consumed proposal cannot be replayed by repeating `好`.
- An expired proposal cannot be applied; the reply asks to generate or provide targets again.
- Explicit current-turn numeric updates remain accepted through existing source-text authorization and range validation.
- Test boundaries: unit tests for proposal lifecycle and confirmation matching; integration tests for vague request -> proposal -> `好` apply, `好` without proposal reject, duplicate `好` reject, and explicit numeric update pass.

### GOAL-02: Deterministic Failed `update_goals` Copy

- Validation failures such as out-of-range calories, empty args, unknown fields, or non-finite values return deterministic backend copy.
- Source-text guard failures return deterministic backend copy and never ask the model to invent a success/failure outcome.
- Failed outcomes must have no persisted target changes, no `dailyTargets` response payload, no `goals_update` SSE publish, and no mutation receipt.
- User-visible failure copy must not include implementation terms like `update_goals`, `payload`, `field`, `API`, `PATCH`, or status-code language.
- Copy should be Traditional Chinese and actionable: tell the user what value/range is needed.
- Test boundaries: unit tests for renderer/failure-copy map; integration tests asserting no target mutation and no success phrase for guard and validation failures in JSON and SSE paths.

### MUT-01: Committed Mutation Outcomes Despite Summary Failure

- For `log_food`, existing behavior already recovers summary from persisted meals after recompute failure; keep that contract.
- For chat `update_meal` and `delete_meal`, a successful DB mutation followed by summary recompute failure must still return a committed update/delete receipt from persisted facts or deleted snapshot.
- For direct REST `PATCH /api/meals/:id` and `DELETE /api/meals/:id`, decide explicitly whether the route can return a committed outcome with degraded summary. Current behavior throws after summary failure; v2.3 should either recover from rows or return a structured partial outcome without lying.
- Summary publish failure remains non-fatal after a committed mutation.
- A mutation that did not commit must not return committed receipt copy.
- Test boundaries: force `summaryService.getDailySummary` to throw after each mutation family; assert DB state changed, receipt matches committed facts, and no generic failure/success ambiguity leaks.

### FRESH-01: Stale Chat Receipt Protection

- Chat receipt edit payloads must include authoritative identity: meal id, date key, and expected meal revision id.
- The server must reject PATCH when expected revision does not equal current transaction revision.
- Conflict response should be deterministic and product-facing, for example `這筆餐點已更新，請重新開啟最新紀錄後再修改。`
- Client should not silently retry stale payloads. It should refresh meal rows and make the stale receipt display-only or reopen the latest meal state.
- Deleted meals remain non-editable from old receipts; existing `redactChatReceiptIdentity` behavior is correct after known deletes but does not replace server-side stale protection.
- Test boundaries: create receipt, mutate same meal elsewhere, attempt PATCH from old receipt, assert 409/no overwrite/refresh behavior. Include same-tab and cross-tab-style flows.

### FRESH-02: SSE Daily Summary Freshness With Meal Rows

- Valid same-day `daily_summary` SSE must not leave `dailySummary` newer than `meals`.
- Client should either refresh meals immediately with `refreshReason: "meal_mutation"` or mark `meals` stale until refreshed. Immediate refresh is preferred because existing app surfaces today's rows on Home/Summary.
- If meal refresh fails, keep prior rows but expose state internally as stale so later refresh can recover; do not crash SSE handling.
- Stale-date summaries continue to trigger rollover refresh behavior and must not mutate today's summary.
- Malformed `daily_summary` payloads should be ignored like malformed `goals_update` payloads; current `daily_summary` parsing is less defensive and should be hardened.
- Test boundaries: fake SSE client event dispatch, store tests proving summary+meal refresh coupling, integration test where another connection logs/deletes/updates and the client receives totals plus refreshed rows.

## Dependencies

| Dependency | Required By | Notes |
|------------|-------------|-------|
| Current source-text guard | GOAL-01, GOAL-02 | Keep exact numeric authorization for explicit values; do not expand to older history or approximate values. |
| New pending goal proposal persistence | GOAL-01 | Can live in SQLite through a small service/table or as structured chat metadata if it supports ownership, expiry, consumed status, and proposal id lookup. |
| Deterministic mutation receipt renderer | GOAL-02, MUT-01 | Existing `mutation-receipts.ts` is the right pattern; extend failure rendering separately rather than asking the model. |
| Mutation effects / committed facts | MUT-01 | Existing discriminated union covers log/update/delete/goals but assumes committed summary; may need a degraded-summary representation or recovery helper. |
| Meal current revision identity | FRESH-01 | Chat receipts currently project display fields and route saves receipt references; acceptance requires exposing/requiring revision identity at edit time. |
| Meal PATCH route conflict semantics | FRESH-01 | `server/routes/meals.ts` currently accepts full facts without expected revision; it needs conflict checking before update. |
| Store and SSE refresh boundary | FRESH-02 | `setDailySummary` guards dates only. `connectSSE` currently calls `onSummary` without payload shape validation or meal-row refresh coupling. |
| Existing tests | All | Extend `update-goals-contract`, `chat-goal-update.integration`, `mutation-receipts`, `store`, `sse-client`, `sse`, `chat-api`, `chat-meal-correction`, and `meals-api` rather than adding a new test framework. |

## Out of Scope

| Out of Scope / Anti-Feature | Why Avoid | What to Do Instead |
|-----------------------------|-----------|--------------------|
| Inferring goal confirmation from raw assistant prose | Reintroduces the exact ambiguity v2.3 is meant to remove. | Apply only explicit current-turn numbers or a backend proposal id. |
| Letting the LLM write success or failure copy after `update_goals` validation/guard failure | The model can falsely imply mutation success. | Backend renders deterministic failure copy from failure reason and fields. |
| Treating post-commit summary failure as full mutation failure | User action already changed persistent state; generic failure copy is misleading. | Return committed receipt with recovered/degraded summary facts and log/publish failures as non-fatal. |
| Client-only stale receipt prevention | Old tabs or crafted requests can still overwrite data. | Enforce expected revision on the server and use client refresh/redaction as UX support. |
| Updating summary totals without meal-row freshness | Creates cross-tab contradictions between Home/Summary totals and visible meal cards. | Refresh or invalidate meals whenever valid same-day summary SSE lands. |
| Broad product polish | The milestone is P1 integrity, not visual or copy polish beyond deterministic failure/success messages. | Defer water tracking, monthly history, onboarding animation, motion, and general UI polish. |
| Raw forensic payload capture | Not needed for these integrity fixes and conflicts with the metadata-only trace contract. | Keep routine evidence metadata-only. |
| Staging/main promotion work | Not part of requirements research. | Leave promotion gates to later ship workflow with explicit approval. |

