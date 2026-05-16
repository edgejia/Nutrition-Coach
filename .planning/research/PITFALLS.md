# Domain Pitfalls

**Project:** Nutrition Coach v2.3 Authoritative Mutation Outcomes and Fresh Meal State
**Researched:** 2026-05-17
**Scope:** P1 data-integrity risks for structured pending goal proposals, deterministic failed mutation copy, committed mutation outcomes, stale chat receipt protection, and SSE meal-row freshness.
**Overall confidence:** HIGH for repo-specific failure modes; MEDIUM for exact phase sizing until requirements are finalized.

## Failure Modes

### 1. Ambiguous goal confirmation mutates from stale assistant prose

**What goes wrong:** A user says `好`, `可以`, or another ambiguous confirmation and the backend lets `update_goals` run because the model copied numbers from the previous assistant message. Today the guard checks numeric source text against the current user message or immediately previous assistant message, but there is no backend-owned proposal id or pending goal proposal state. Any model-authored recommendation in chat history can become mutation authority.

**Warning signs:**
- `update_goals` succeeds when the current user message has no numeric target and no proposal id.
- The only evidence for the target values is assistant prose.
- A confirmation after an unrelated assistant message still updates goals.
- `turn_states` gains new proposal data but the payload stores raw user/assistant text instead of structured target fields.

**Impact:** False goal updates are hard to audit because the visible conversation looks consensual while the backend never knew which proposal was confirmed.

### 2. Failed `update_goals` validation or guard produces model-authored success-style copy

**What goes wrong:** Controlled validation/guard failures currently return a tool message to the LLM and allow a second model round to write the final reply. Existing tests prove the model usually asks for clarification, but the boundary still depends on model cooperation. A validation/guard failure can therefore say "已更新" even though `deviceService.updateGoals(...)` never ran.

**Warning signs:**
- `success:false` / `executed:false` tool outcomes are followed by `finalReplySource: "model"`.
- Failed goal updates persist an assistant message containing `已更新每日目標`, `已經幫你更新`, or target bullets.
- Hook logs show `goal_update_rejected` but chat response copy sounds successful.

**Impact:** This is the same trust failure class v2.3 is meant to close: user sees success, database remains unchanged.

### 3. Summary recompute failure masks a committed meal mutation

**What goes wrong:** `log_food` already persists first and falls back to `recoverDailySummaryFromPersistedMeals(...)` when `summaryService.getDailySummary(...)` throws. `update_meal`, `delete_meal`, direct `PATCH /api/meals/:id`, and direct `DELETE /api/meals/:id` still recompute summary after the write without local recovery. If recompute throws, the route can fall into generic fallback/error copy even though the meal revision or delete committed.

**Warning signs:**
- Meal revision/deletion exists in SQLite but the response says the request failed.
- `didMutateMeal` is false or absent after a committed update/delete.
- `chat_route_fallback` has `didMutateMeal:false` for an already committed meal mutation.
- Direct meal edit/delete returns 500 after writing a new revision or soft delete.

**Impact:** Users retry, causing duplicate or contradictory mutations. This is highest risk for correction/delete flows because the write is not idempotent.

### 4. Partial success depends on `dailySummary` even when committed facts are available

**What goes wrong:** Several route and orchestrator fallback paths still treat `dailySummary` as the proof object for a successful mutation. For non-log mutations, committed facts are the updated revision id, deleted meal snapshot, affected date, and current meal rows. If the summary is missing, code can throw or degrade to generic copy instead of returning a committed mutation receipt.

**Warning signs:**
- Calls to `requireDailySummaryForLoggedMeal(...)` or equivalent assumptions spread to update/delete.
- `MutationEffects.committedSummary` remains mandatory for all mutation kinds.
- Fallback copy says "請稍後確認今日攝取摘要" without carrying `loggedMeal`, `deletedMeal`, `affectedDate`, or `didMutateMeal:true`.

**Impact:** The app has the committed mutation facts but still reports uncertainty because summary was coupled to receipt generation.

### 5. Old chat receipt overwrites newer meal state

**What goes wrong:** Chat receipts carry `mealId` and meal facts so a user can edit from a bubble. The persisted receipt reference includes `mealRevisionId`, and history projection hides edit identity when that revision is no longer current. The live SSE/chat done payload does not expose revision identity to the client, and direct edit payloads do not submit an expected revision. A stale receipt opened before a newer edit can still PATCH the meal id and overwrite newer facts.

**Warning signs:**
- `PATCH /api/meals/:id` accepts a request from a receipt without an expected revision/current-version check.
- Client payloads built by `buildReceiptMealEditPayload(...)` cannot distinguish stale receipt facts from current meal facts.
- `redactChatReceiptIdentity(...)` only runs after the local edit flow, not after cross-tab/server-side changes.
- No 409/412 conflict response exists for stale meal edit attempts.

**Impact:** A correct newer edit can be silently lost by an older chat bubble or another tab.

### 6. SSE `daily_summary` updates totals without refreshing meal rows

**What goes wrong:** `daily_summary` SSE currently carries only aggregate totals. The store writes `dailySummary`, while visible `meals` are refreshed only when the active chat flow calls `refreshTodayMeals()`. Cross-tab/device mutations can therefore make Home/Summary totals newer than meal rows.

**Warning signs:**
- Another tab logs/deletes/updates a meal and the subscriber sees new totals but old `meals`.
- `connectSSE(...)` has only `onSummary(summary)` with no affected-date/refresh reason contract.
- `setDailySummary(...)` updates state without invalidating or refreshing today meal rows.
- Tests assert the SSE summary frame but not visible row freshness after the frame.

**Impact:** The UI shows internally inconsistent canonical state: totals say one thing, meal rows say another.

### 7. Historical mutation freshness is accidentally treated as today freshness

**What goes wrong:** Both chat and direct meal routes guard `daily_summary` publish to current app date. That is right for Home freshness, but v2.3 must preserve historical affected-date behavior. A historical edit/delete should not overwrite today summary or today meal rows, but it should still invalidate History/Day Detail state for the affected date.

**Warning signs:**
- A historical `affectedDate` triggers `refreshTodayMeals()`.
- Store refresh only has one global `lastMealMutation` nonce and no distinction between today and non-today consumers.
- SSE freshness work updates Home but leaves Day Detail/History stale when a historical correction is open.

**Impact:** Fixing Home/Summary consistency can create History/Day Detail inconsistency.

### 8. Goal proposal state collides with meal selection state

**What goes wrong:** Meal correction already uses `turn_states` with a single `deviceId + kind` upsert and a 15-minute TTL. Adding goal proposals in the same table is reasonable, but reusing the wrong kind, storing only one proposal when multiple assistant recommendations can be active, or not clearing state after confirmation/rejection can let later confirmations apply stale targets.

**Warning signs:**
- Proposal kind names are generic, such as `pending_selection`.
- Confirmation does not consume or expire the proposal.
- New goal proposal does not replace the previous pending goal proposal atomically.
- State payload lacks `proposalId`, `targets`, `createdAt`, `expiresAt`, and source/turn metadata.

**Impact:** Ambiguous confirmations remain ambiguous, just moved from model memory into backend state.

### 9. Observability says "completed" for rejected or partial mutation paths

**What goes wrong:** v2.2 separated `chat_turn_completed` from `chat_route_fallback`. v2.3 can regress that if deterministic rejection copy is treated as a normal completion without an explicit rejected outcome, or if committed partial success is logged as generic fallback with missing `didMutateMeal:true`.

**Warning signs:**
- Rejected goal guard emits `chat_turn_completed` with no rejection fact.
- Committed update/delete plus summary failure emits fallback with `didMutateMeal:false`.
- Trace/hook facts omit whether the failure happened before execution, after commit, or during summary recompute.

**Impact:** Maintainers cannot distinguish false success, legitimate rejection, and committed partial success from logs.

### 10. Privacy regression from proposal and receipt evidence

**What goes wrong:** Goal proposals, stale-write conflicts, and mutation outcome traces are tempting places to store raw chat text, assistant prose, full payloads, or meal snapshots. The project contract forbids raw user input, provider/tool payloads, final assistant text, image data, session material, and database snapshots in routine traces/logs.

**Warning signs:**
- Proposal payload stores raw recommendation prose instead of normalized targets.
- Logs include target numbers, raw current user text, raw tool args, meal names, or full conflict payloads.
- Harness artifacts persist SSE chunks or full assistant text for failed-copy proof.

**Impact:** Data-integrity proof undermines the v2.2 metadata-only privacy boundary.

## Prevention

### Backend-owned goal proposals

- Add a dedicated `turn_states` kind, for example `pending_goal_proposal`, with payload `{ proposalId, targets, createdAt, expiresAt, sourceTurnId? }`.
- Allow ambiguous confirmation to mutate only when it includes or resolves to an active `proposalId`; otherwise return deterministic clarification.
- Keep explicit numeric current-turn updates as a separate path; do not force proposal state when the user says concrete values.
- Consume the pending proposal after success, clear it after explicit rejection/cancel, and replace it atomically when issuing a newer recommendation.
- Store only structured target fields and metadata. Do not store assistant prose or raw user text.

### Deterministic failed goal copy

- Render backend-owned failed `update_goals` copy for `validation` and `guard` outcomes before any second model round can author visible text.
- Give rejected outcomes a stable source such as `finalReplySource: "renderer"` or a new explicit `"rejection"` value; avoid `"model"` for failed mutation boundaries.
- Persist the deterministic assistant message and the controlled tool message, but keep hook/log summaries to field names and failure reason only.
- Maintain the existing unknown-tool/fatal paths separately so real programming errors still fail loudly.

### Committed mutation outcomes independent of summary recompute

- Split mutation effects into "committed facts" and "summary facts". A receipt should be renderable from committed facts alone.
- Extend the `log_food` recovery pattern to `update_meal`, `delete_meal`, direct `PATCH /api/meals/:id`, and direct `DELETE /api/meals/:id`.
- If summary recompute fails after commit, return `didMutateMeal:true`, `affectedDate`, committed receipt/deleted snapshot, and deterministic copy. Include `dailySummary` only if recovered or recompute succeeded.
- Make `summary_publish_failed` and summary recompute failure non-fatal after commit; never let publish/recompute failure change a committed outcome into a generic failure.
- Keep summary recompute failure visible in metadata-only logs/trace facts without raw payloads.

### Stale receipt protection

- Carry current revision identity through the edit contract. Server-side minimum: require an expected revision/version for chat-receipt edit attempts and reject when it does not match `meal_transactions.current_revision_id`.
- Prefer `409 Conflict` or `412 Precondition Failed` for stale writes with deterministic copy: "這筆餐點已有更新，請重新整理後再修改。"
- Update client `LoggedMealReceipt` / `MealEditPayload` to include a non-display `mealRevisionId` when the receipt is current and editable.
- Keep historical/stale receipt display useful but remove edit identity once stale, matching the existing `getMealReceiptForAssistantMessage(...)` projection behavior.
- After any direct or chat mutation for a meal id, redact stale chat receipt edit identity and refresh meal rows for the affected date.

### SSE meal-row freshness

- Treat `daily_summary` SSE as an invalidation signal, not just an aggregate write.
- Add an affected-date-aware refresh callback in the SSE/client boundary: when a current-day `daily_summary` arrives, refresh or invalidate today meal rows before/with summary commit.
- If adding payload fields, keep them minimal: `date` is already in `DailySummary`; no device id or raw meal data is needed.
- Ensure cross-tab subscribers refresh rows after log, update, and delete. The mutating tab can still use its local direct response, but subscriber tabs need SSE-driven invalidation.
- Preserve the current date guard: stale/future summaries should trigger rollover refresh behavior rather than overwrite today state.

### Historical freshness

- Route current-day changes to Home/Summary `meals`; route non-current affected dates to History/Day Detail invalidation.
- Keep `recordMealMutation(affectedDate)` as the bridge for date-specific consumers; do not blindly call `refreshTodayMeals()` for historical updates.
- Add tests with fixed `TZ=Asia/Taipei` and historical dates to prove today totals/rows are not overwritten.

### Observability and privacy

- Add explicit metadata-only outcome categories: `goal_update_rejected`, `mutation_committed_summary_failed`, `stale_receipt_rejected`, and existing `summary_publish_failed`.
- Log field names, mutation kind, boolean committed/recovered flags, affected date class (`today`/`historical`) if needed, and turn id. Do not log target numbers, meal names, raw text, raw tool args, prompt, final assistant text, image data, session material, or full DB snapshots.
- Keep `llm-trace.v2` artifacts metadata-only; failed-copy proof should persist booleans/counts and source classifications, not raw user-visible text.

## Verification

### Goal proposal and failed-copy checks

- `tests/integration/chat-goal-update.integration.test.ts`
  - ambiguous `好` with no active proposal does not mutate and returns deterministic clarification.
  - ambiguous `好` with expired/consumed/wrong proposal id does not mutate.
  - active proposal confirmation mutates exactly the structured targets and consumes state.
  - model attempts `update_goals` from assistant prose only; backend rejects deterministically.
  - validation/guard failure where the next queued model reply says `已更新` still returns backend failure copy.
- `tests/integration/orchestrator.test.ts`
  - hook payloads for rejected goal updates expose only `failureReason` and field names.
  - rejected goal outcome is not model-authored and does not publish `goals_update`.
- Suggested commands:
  - `yarn test:integration`
  - `node scripts/run-node-with-tz.mjs --import tsx --test tests/integration/chat-goal-update.integration.test.ts tests/integration/orchestrator.test.ts`

### Committed mutation outcome checks

- `tests/unit/tools.test.ts`
  - `update_meal` summary recompute failure still returns committed updated revision facts.
  - `delete_meal` summary recompute failure still returns committed deleted meal snapshot.
  - committed facts do not include device id, raw revision internals beyond explicit expected revision/version, or tool names in user-visible copy.
- `tests/unit/orchestrator.test.ts`
  - update/delete receipts survive later fatal tool calls and summary recompute failures.
  - partial success/fallback paths keep `didMutateMeal:true`.
- `tests/integration/chat-streaming.test.ts` and `tests/integration/chat-api.test.ts`
  - JSON and SSE update/delete return deterministic committed receipts when summary recompute fails after commit.
  - route fallback/trace facts classify committed summary failure separately from pre-execution failure.
- `tests/integration/meals-api.test.ts`
  - direct `PATCH`/`DELETE` return committed outcome or deterministic partial-success copy if summary recompute fails.
- Suggested commands:
  - `yarn test:unit`
  - `yarn test:integration`
  - `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/tools.test.ts tests/unit/orchestrator.test.ts`
  - `node scripts/run-node-with-tz.mjs --import tsx --test tests/integration/chat-streaming.test.ts tests/integration/chat-api.test.ts tests/integration/meals-api.test.ts`

### Stale receipt checks

- `tests/integration/meals-api.test.ts`
  - direct edit with matching expected revision succeeds.
  - edit with stale expected revision returns 409/412 and leaves the latest meal unchanged.
  - delete with stale expected revision returns 409/412 if delete is protected by the same contract.
- `tests/unit/store.test.ts`
  - stale receipt redaction preserves display facts but removes edit identity and revision.
  - current receipt edit payload includes expected revision/version.
- `tests/unit/api-client.test.ts`
  - `updateMeal(...)` sends expected revision/version when provided and handles stale conflict copy.
- Suggested commands:
  - `node scripts/run-node-with-tz.mjs --import tsx --test tests/integration/meals-api.test.ts`
  - `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/store.test.ts tests/unit/api-client.test.ts`

### SSE meal-row freshness checks

- `tests/integration/sse.test.ts`
  - after cross-tab log/update/delete, subscriber receives `daily_summary` and client-side handler refreshes rows for that summary date.
  - historical mutation does not publish or overwrite current-day Home rows.
- `tests/unit/store.test.ts`
  - `setDailySummary` plus new invalidation callback preserves date guard and invokes refresh only for current-day summary.
  - mismatched date still triggers rollover/history invalidation without throwing.
- `tests/harness/scenarios/text-log.ts` or a focused new harness scenario
  - prove terminal SSE event, summary freshness, and row freshness from a browser-like flow without persisting raw SSE transcripts.
- Suggested commands:
  - `node scripts/run-node-with-tz.mjs --import tsx --test tests/integration/sse.test.ts tests/unit/store.test.ts`
  - `yarn verify:harness -- text-log`
  - If a new scenario is added: `yarn verify:harness -- fresh-meal-state`

### Final gates

- Any TypeScript edit: `yarn tsc --noEmit`
- Route/service edits: `yarn test:integration`
- Client store/API edits: `yarn test:unit`
- Harness scenario edits: `yarn verify:harness -- <scenario>` and inspect `tests/harness/artifacts/<scenario>/latest/`
- Pre-promotion: `yarn release:check`

## Phase Placement

### Phase 1: Structured goal proposals and deterministic rejected-goal outcomes

**Why first:** This closes false goal success claims before touching broader meal mutation plumbing. It is mostly orchestrator/tool-contract/turn-state work with focused integration tests.

**Include:**
- pending goal proposal state shape and TTL.
- confirmation guard requiring active proposal id or explicit numeric current-turn values.
- deterministic backend copy for `update_goals` validation/guard failures.
- `goals_update` publish only after committed update.

**Avoids:** Ambiguous confirmation mutation, model-authored failed-copy success, stale proposal reuse.

### Phase 2: Committed mutation outcome model for log/update/delete/direct routes

**Why second:** Stale receipt and SSE freshness need a trustworthy committed-outcome contract first.

**Include:**
- decouple committed facts from summary facts.
- summary recompute recovery/fallback for chat update/delete and direct meal patch/delete.
- metadata-only observability for post-commit summary failure.

**Avoids:** Generic failures after committed writes, duplicate retries, false `didMutateMeal:false`.

### Phase 3: Stale receipt write protection

**Why third:** Revision/currentness checks depend on the committed outcome contract and receipt projection.

**Include:**
- expected revision/version in editable receipt payloads.
- server conflict checks for stale PATCH/delete attempts.
- client conflict copy and receipt identity redaction.

**Avoids:** Older chat bubbles overwriting newer meal revisions.

### Phase 4: SSE meal-row freshness and cross-tab consistency

**Why fourth:** Once committed outcomes and stale write rules are stable, wire realtime invalidation across tabs without confusing summary, Home rows, and History rows.

**Include:**
- current-day `daily_summary` as meal-row invalidation signal.
- affected-date-specific invalidation for History/Day Detail.
- cross-tab log/update/delete proof.

**Avoids:** New totals with stale visible meals, historical changes refreshing the wrong date.

### Phase 5: Harness/release proof hardening

**Why last:** The lower layers need to settle before creating durable harness evidence.

**Include:**
- focused harness for authoritative mutation outcomes and fresh meal state if integration coverage is not enough.
- artifact privacy checks: booleans/counts/classifications only, no raw SSE chunks or final assistant text.
- `yarn release:check` and targeted harness commands recorded in phase verification.

**Avoids:** False proof, privacy regression, release gate gaps.
