# Codebase Concerns

**Analysis Date:** 2026-05-30

## Tech Debt

**Chat transport mega-boundary:**
- Issue: `server/routes/chat.ts` owns multipart parsing, staged upload cleanup, durable asset promotion, JSON and SSE chat execution, stream token filtering, assistant persistence, terminal clarification persistence, realtime summary publishing, stop-turn state, and observability classification in one 1,595-line module.
- Files: `server/routes/chat.ts`, `server/orchestrator/index.ts`, `server/orchestrator/tools.ts`
- Impact: Small chat changes can regress upload cleanup, SSE terminal events, mutation receipts, trace metadata, or post-commit summary publishing because multiple boundary contracts share local state and duplicated JSON/SSE branches.
- Fix approach: Extract route-local helpers by responsibility: `chat-upload-boundary`, `chat-stream-finalizer`, `chat-mutation-publisher`, and `chat-route-observability`. Keep `registerChatRoutes()` as wiring only and preserve existing integration tests in `tests/integration/chat-api.test.ts`, `tests/integration/chat-streaming.test.ts`, and `tests/integration/sse.test.ts`.

**Orchestrator tool registry size and compatibility adapters:**
- Issue: `server/orchestrator/tools.ts` is a 2,470-line registry plus all tool schemas, validation, execution, structured clarification adapters, privacy redaction, and compatibility wrappers. The exported `toolRegistry` uses `ToolContract<any, any>` casts, and `executeTool()` contains tool-specific result mapping for every contract.
- Files: `server/orchestrator/tools.ts`, `server/orchestrator/tool-contract.ts`, `tests/unit/tools.test.ts`, `tests/unit/orchestrator-registry.test.ts`
- Impact: New tool behavior requires editing a large shared file, increasing regression risk around unrelated tools such as `log_food`, `update_goals`, and `delete_meal`.
- Fix approach: Split one file per contract under `server/orchestrator/tools/`, keep a typed registry assembly file, and move legacy `ToolExecutionResult` adapters into tool-owned adapter functions.

**Correction target resolver complexity:**
- Issue: `server/services/meal-correction.ts` is now a 1,181-line service that owns target candidate loading, evidence-tier ranking, rendered option state, stale-selection recovery, update/delete writes, and summary outcome handling.
- Files: `server/services/meal-correction.ts`, `server/orchestrator/tools.ts`, `server/orchestrator/mutation-receipts.ts`, `tests/unit/meal-correction.test.ts`, `tests/integration/chat-meal-correction.integration.test.ts`
- Impact: Target-ranking fixes can accidentally affect stale revision behavior, rendered clarification copy, pending selection reuse, or update/delete side effects.
- Fix approach: Split target resolution/rendered-option state from mutation write execution when the next correction-targeting feature lands. Keep route-level integration tests around no-mutation/no-publish behavior before moving code.

**Duplicate mutation-outcome handling across chat and REST routes:**
- Issue: Meal mutations flow through chat tools, direct REST routes, direct services, SSE publishing, and client state reconciliation with overlapping summary-outcome and receipt logic.
- Files: `server/routes/chat.ts`, `server/routes/meals.ts`, `server/services/meal-correction.ts`, `server/services/summary-outcome.ts`, `client/src/sse-summary-coordinator.ts`
- Impact: A fix in one path can leave another path behind. Direct `PATCH /api/meals/:id` and chat `update_meal` both need stale revision checks, summary recovery, asset projection, and publish semantics.
- Fix approach: Keep `server/services/summary-outcome.ts` as the shared summary recovery primitive and add shared projection/publish helpers for mutation responses so REST and chat build the same outcome envelopes.

**Special-case migration reconciliation:**
- Issue: `server/db/migrate.ts` has explicit repair logic for a partial `0005_chat_message_status` migration before invoking Drizzle migrations.
- Files: `server/db/migrate.ts`, `drizzle/0005_chat_message_status.sql`, `drizzle/meta/_journal.json`, `tests/unit/db-migrate.test.ts`
- Impact: Migration behavior depends on custom preflight code that future migrations may not account for. Removing or changing it can break upgraded local or deployed databases with partially applied schema.
- Fix approach: Treat `reconcilePartialChatMessageStatusMigration()` as part of the migration contract until all live databases are known to contain the matching journal row; add any future repair logic as explicit, tested migration preflight code.

## Known Bugs

**Streaming fallback reason can be misclassified as hallucination:**
- Symptoms: `handleStreamingReply()` returns `finalReplySource: "fallback"` for both choice-prompt hallucination fallback and no-mutation logging-claim guard fallback, but `handleOrchestratorSSE()` records every streaming fallback source as `route_hallucination` with reason `hallucination_detected`.
- Files: `server/routes/chat.ts`, `server/orchestrator/index.ts`, `tests/integration/chat-streaming.test.ts`, `tests/unit/chat-stream-contract.test.ts`
- Trigger: A streamed model reply without a mutation emits logging-success copy that is replaced by `guardNoMutationLoggingClaim()`; the route records the fallback as hallucination even though the guard fired for a different reason.
- Workaround: Treat `chat_route_fallback.reason` from streaming paths as a coarse signal only. Preserve route behavior, but add a typed fallback reason from `handleStreamingReply()` before relying on observability counts.

**Direct REST goal updates do not fan out `goals_update`:**
- Symptoms: Chat-driven `update_goals` publishes realtime target updates, while direct settings/API updates only update the requester's response and logs.
- Files: `server/routes/device.ts`, `server/orchestrator/tools.ts`, `server/realtime/publisher.ts`, `client/src/components/MainLayout.tsx`
- Trigger: `PATCH /api/device/goals` or `PUT /api/device/goals` updates `devices` through `deviceService.updateGoals()` but `registerDeviceRoutes()` has no `RealtimePublisher` dependency and does not publish `goals_update`.
- Workaround: The active tab that made the REST call updates local state from the HTTP response. Other tabs rely on reload/reconnect until direct-route publishing is added.

## Security Considerations

**Production can run with the development guest-session secret:**
- Risk: `GUEST_SESSION_SECRET` defaults to a fixed string when the environment variable is absent, so signed guest-session cookies are forgeable in any deployed environment that forgets to set the secret.
- Files: `server/config.ts`, `server/services/guest-session.ts`, `.env.example`, `README.md`, `Dockerfile`
- Current mitigation: `.env.example` and `README.md` document `GUEST_SESSION_SECRET` for shared/deployed environments, and cookies use HMAC signatures, `HttpOnly`, `SameSite=Lax`, and `Secure` when `NODE_ENV=production`.
- Recommendations: Fail fast in production when `GUEST_SESSION_SECRET` is missing or equals `dev-guest-session-secret-change-me`; add a release/config test that boots with `NODE_ENV=production` and no secret and expects failure.

**Legacy session migration still trusts raw device IDs:**
- Risk: `POST /api/device/session` can issue signed cookies from a supplied `legacyDeviceId` when no valid cookie exists. A guessed or leaked UUID becomes enough to bind a browser to that device.
- Files: `server/routes/device.ts`, `server/lib/guest-session-resolver.ts`, `server/services/guest-session.ts`, `tests/harness/scenarios/guest-session-hardening.ts`
- Current mitigation: Device IDs are UUIDs, protected routes use signed cookies through `resolveGuestSession()`, and raw `deviceId` headers/query params are not accepted by protected browser routes.
- Recommendations: Keep the legacy migration path isolated to `/api/device/session`, add telemetry for `establishedBy: "legacy_migration"`, and retire or gate it once legacy localStorage users are migrated.

**State-changing routes rely on SameSite cookies without explicit CSRF tokens:**
- Risk: Browser-protected mutation routes use cookie-backed sessions and no request-specific CSRF token. `SameSite=Lax` and same-origin fetch reduce exposure, but the code has no independent CSRF nonce if deployment constraints change.
- Files: `server/services/guest-session.ts`, `server/routes/chat.ts`, `server/routes/meals.ts`, `server/routes/device.ts`, `server/app.ts`
- Current mitigation: Cookies are `HttpOnly` and `SameSite=Lax`; client calls use `credentials: "same-origin"` in `client/src/api.ts`; default CORS does not enable credentialed cross-origin reads.
- Recommendations: Add an origin/host check or CSRF token before broadening CORS, embedding the app cross-site, or introducing non-browser API consumers.

## Performance Bottlenecks

**Image chat path buffers and duplicates upload data in memory:**
- Problem: Multipart image upload calls `part.toBuffer()`, writes the full buffer to staging, creates a base64 data URI for the LLM, copies the staged file into durable assets, and later serves assets by `readFile()`.
- Files: `server/routes/chat.ts`, `server/services/assets.ts`, `client/src/api.ts`
- Cause: The product limit is 5MB, but each accepted image exists as a buffer, staged file, base64 string, durable file, and provider payload during the request.
- Improvement path: Stream MIME sniffing and durable writes where practical, cap concurrent image turns, and keep asset responses streamed instead of reading full files into memory if image sizes or concurrency increase.

**History trend endpoints have unbounded date-range work:**
- Problem: `/api/history/trends` accepts any valid `from` and `to`, creates an in-memory bucket per day, and scans all matching rows for the range.
- Files: `server/routes/history.ts`, `server/services/history-query.ts`, `tests/integration/history-trends-api.test.ts`
- Cause: The route validates date shape and ordering but does not enforce a maximum date span.
- Improvement path: Add a range cap such as 366 or 730 days, return a 400 for larger ranges, and document the cap in client query helpers.

**History search uses wildcard LIKE and post-filter loops:**
- Problem: `searchMeals()` uses `lower(food_name) like lower(%query%)`, then projects meals and applies nutrition bounds in application code until it fills `limit + 1`.
- Files: `server/services/history-query.ts`, `server/routes/history.ts`, `drizzle/0004_history_query_hot_path_indexes.sql`
- Cause: Prefix-free substring search cannot use ordinary indexes, and nutrition filters apply after matched headers are fetched.
- Improvement path: Add SQLite FTS or a normalized search table when history grows beyond local-beta scale; push nutrition aggregate bounds into SQL if search with filters becomes frequent.

**Synchronous SQLite work blocks the Fastify event loop:**
- Problem: The app uses `better-sqlite3`, so DB statements execute synchronously inside async route handlers.
- Files: `server/db/client.ts`, `server/services/food-logging.ts`, `server/services/history-query.ts`, `server/services/meal-transactions.ts`
- Cause: SQLite calls are wrapped by service methods but still run on the Node event loop.
- Improvement path: Keep request-level queries bounded, avoid long history scans, and move heavy analytics or backfills to worker/offline commands before concurrent traffic increases.

## Fragile Areas

**SSE terminal-event and stop-turn invariants:**
- Files: `server/routes/chat.ts`, `client/src/api.ts`, `tests/integration/chat-streaming.test.ts`, `tests/unit/sse-terminal-proof.test.ts`, `tests/harness/scenarios/text-log.ts`
- Why fragile: `event: done` / `event: stopped` emission, stream cleanup, assistant persistence, upload cleanup, and `activeChatTurns` deletion depend on several nested try/catch/finally paths.
- Safe modification: Preserve the invariant that every accepted SSE chat request emits exactly one terminal event and always runs upload and durable-asset cleanup. Run `yarn test:integration` plus the relevant harness scenario after route edits.
- Test coverage: Strong integration coverage exists, but new fallback reasons and stop flows need explicit assertions because observability classification and terminal-event delivery can drift independently.

**Guest-session recovery and legacy migration:**
- Files: `server/routes/device.ts`, `server/lib/guest-session-resolver.ts`, `server/services/guest-session.ts`, `client/src/store.ts`, `client/src/components/GuestSessionRecoveryGate.tsx`
- Why fragile: Active-cookie verification, resume-cookie reissue, localStorage bootstrap, legacy migration, recovery UI, and cookie clearing all interact with the same browser session state.
- Safe modification: Keep route authorization derived from cookies except the explicit legacy migration endpoint. Run `yarn verify:harness -- guest-session-hardening` for session-boundary changes.
- Test coverage: Harness coverage exists for protected route hardening; config fail-fast for missing production `GUEST_SESSION_SECRET` is not covered.

**Timezone-sensitive day boundaries:**
- Files: `server/lib/time.ts`, `server/config.ts`, `scripts/run-node-with-tz.mjs`, `scripts/release-check.mjs`, `client/src/store.ts`, `server/services/summary.ts`
- Why fragile: Daily summaries, historical dates, rollover refresh, and mutation affected dates all depend on `TZ=Asia/Taipei`.
- Safe modification: Keep timezone validation fail-fast on server boot and keep test commands wrapped through `scripts/run-node-with-tz.mjs`.
- Test coverage: `tests/integration/timezone-guard.integration.test.ts` covers guard behavior; deploy-time Railway variables still require manual smoke verification from `docs/deploy/railway-beta.md`.

**Generated harness artifacts and privacy redaction:**
- Files: `tests/harness/artifacts.ts`, `tests/unit/verification-artifacts.test.ts`, `tests/unit/phase64-metadata-sweep.test.ts`, `tests/harness/scenarios/*.ts`, `tests/harness/scenarios/*.mjs`
- Why fragile: Harness artifacts are proof evidence, but they can accidentally persist raw prompts, device IDs, cookies, provider payloads, image data, or SSE transcripts if a scenario bypasses shared redaction helpers.
- Safe modification: Use `tests/harness/artifacts.ts` for all artifact writes and inspect generated `tests/harness/artifacts/<scenario>/latest/` diffs before treating evidence as committable.
- Test coverage: Redaction tests are broad; direct `.mjs` visual harnesses are command-specific and not covered by `yarn verify:harness`.

## Scaling Limits

**Single-process realtime and stop-turn state:**
- Current capacity: One Fastify process with in-memory `RealtimePublisher` subscriptions and a module-level `activeChatTurns` map.
- Limit: Horizontal scaling breaks SSE fan-out and `/api/chat/stop` unless the connection and stop request land on the same process.
- Scaling path: Keep one Railway instance for beta, or introduce sticky sessions plus shared pub/sub and shared turn-control state before multi-instance deployment.

**SQLite plus local filesystem assets assume one mounted volume:**
- Current capacity: One persistent web service with one SQLite database and one durable assets directory.
- Limit: Multiple writers or multiple instances sharing a volume can introduce lock contention and asset consistency issues.
- Scaling path: Move to a managed database and object storage before increasing write concurrency or deploying more than one app instance.

**OpenAI request cost and abuse controls are application-level gaps:**
- Current capacity: Each onboarding target generation and chat turn can call the provider; image turns include base64 image payloads.
- Limit: There is no rate limit, per-session quota, or provider-cost guard in route code.
- Scaling path: Add per-session throttling around `POST /api/chat` and `POST /api/device`, request-size/concurrency limits for image turns, and provider error budget telemetry.

## Dependencies at Risk

**OpenAI Chat Completions API:**
- Risk: `OpenAIProvider` uses `chat.completions.create()` for both non-streaming and streaming tool-call flows and depends on streamed delta/tool-call semantics.
- Impact: Provider SDK or model behavior changes can affect tool-call assembly, streaming token timing, fallback handling, and receipt determinism.
- Migration plan: Keep provider access behind `server/llm/types.ts`; add provider-contract tests before changing model families or SDK major versions.

**better-sqlite3 native module:**
- Risk: Native package compatibility depends on the Node runtime and deployment image.
- Impact: Node upgrades or slim image changes can break install/build or runtime DB access.
- Migration plan: Keep Node 22 pinned in `Dockerfile` and `README.md`; run `yarn release:check` in the deployment-like environment before runtime upgrades.

## Missing Critical Features

**Automated release gate does not include harness scenarios or deployed-domain smoke:**
- Problem: `yarn release:check` runs TypeScript, `yarn test`, and `yarn build`, but deterministic harness scenarios and Railway public-domain smoke remain separate manual gates.
- Blocks: A release can pass the local release gate while missing proof for guest-session hardening, boundary contracts, visual harnesses, or real deployed asset persistence.
- Files: `scripts/release-check.mjs`, `package.json`, `docs/deploy/railway-beta.md`, `tests/harness/run.ts`

**No explicit data retention or cleanup policy:**
- Problem: Chat messages, meal revisions, asset rows, asset files, and generated local databases have no app-level retention or pruning command.
- Blocks: Long-running beta use can grow SQLite and asset storage without operational tooling for user data deletion, old revision pruning, or orphan auditing.
- Files: `server/db/schema.ts`, `server/services/assets.ts`, `server/services/meal-transactions.ts`, `data/.gitkeep`

## Test Coverage Gaps

**Production secret fail-fast:**
- What's not tested: Production boot failure when `GUEST_SESSION_SECRET` is missing or left at the development default.
- Files: `server/config.ts`, `server/app.ts`, `server/services/guest-session.ts`
- Risk: A deployed app can silently use a known signing secret.
- Priority: High

**Direct REST goal-update realtime parity:**
- What's not tested: Cross-tab `goals_update` propagation after `PATCH /api/device/goals` or `PUT /api/device/goals`.
- Files: `server/routes/device.ts`, `server/realtime/publisher.ts`, `tests/integration/device-api.test.ts`, `tests/integration/sse.test.ts`
- Risk: Settings changes can leave other active tabs with stale targets.
- Priority: Medium

**Streaming fallback reason specificity:**
- What's not tested: Distinguishing hallucination fallback from no-mutation logging-claim fallback in SSE observability.
- Files: `server/routes/chat.ts`, `server/orchestrator/index.ts`, `tests/integration/chat-streaming.test.ts`
- Risk: Operational metrics overcount hallucinations and undercount safety guard interventions.
- Priority: Medium

**History range and search stress bounds:**
- What's not tested: Maximum accepted date range, large search result sets with nutrition filters, and trend generation across very large ranges.
- Files: `server/routes/history.ts`, `server/services/history-query.ts`, `tests/integration/history-trends-api.test.ts`, `tests/integration/history-search-api.test.ts`
- Risk: A valid authenticated request can consume excessive CPU/memory on the single Node process.
- Priority: Medium

**Release-gate awareness for harness evidence:**
- What's not tested: Whether changes touching `tests/harness/scenarios/*.ts`, `tests/harness/scenarios/*.mjs`, or boundary-sensitive server paths trigger the right harness commands.
- Files: `scripts/release-check.mjs`, `tests/harness/run.ts`, `tests/harness/scenarios/boundary-contracts.ts`, `tests/harness/scenarios/guest-session-hardening.ts`
- Risk: Local release verification can miss deterministic proof regressions that the project treats as required evidence.
- Priority: Medium

---

*Concerns audit: 2026-05-26*
