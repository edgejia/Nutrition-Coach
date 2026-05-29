# Codebase Concerns

**Analysis Date:** 2026-05-29

## Tech Debt

**Chat route owns too many responsibilities:**
- Issue: `server/routes/chat.ts` combines multipart parsing, upload staging cleanup, durable asset promotion, JSON transport, SSE transport, stop-turn bookkeeping, response sanitization, fallback persistence, summary publication, and LLM trace hooks in one 1,595-line route module.
- Files: `server/routes/chat.ts`, `tests/integration/chat-api.test.ts`, `tests/integration/chat-streaming.test.ts`
- Impact: Small chat changes can regress transport framing, persistence, upload cleanup, fallback semantics, or observability. Review and test cost stays high because behavior is spread across distant branches in the same file.
- Fix approach: Extract route-local modules for multipart parsing, asset lifecycle, SSE event writing, and fallback/receipt projection. Keep `registerChatRoutes()` as the transport boundary and preserve existing integration tests while moving behavior behind focused helpers.

**Orchestrator and tool registry are large shared choke points:**
- Issue: `server/orchestrator/index.ts` and `server/orchestrator/tools.ts` encode proposal state, mutation receipts, fallback behavior, historical date handling, tool authorization, and streaming handoff in large switch-like flows.
- Files: `server/orchestrator/index.ts`, `server/orchestrator/tools.ts`, `tests/unit/orchestrator.test.ts`, `tests/unit/tools.test.ts`
- Impact: Adding or changing one tool can disturb unrelated fallback, receipt, or streaming contracts. Type escape hatches in `toolRegistry` (`ToolContract<any, any>`) reduce compiler protection at the registry boundary.
- Fix approach: Split tool contracts by domain (`log_food`, meal correction, summaries, goals) and expose typed registry adapters. Keep `executeTool()` as the compatibility facade until route and orchestrator call sites are migrated.

**Legacy/unresolved asset compatibility path hides missing durable asset rows:**
- Issue: `createMealTransactionsService()` creates placeholder `assets` rows with `storageKey: unresolved/<id>` and `mimeType: application/octet-stream` when callers pass an `asset:<id>` ref that has no matching asset row.
- Files: `server/services/meal-transactions.ts`, `server/services/assets.ts`, `tests/unit/food-logging.test.ts`, `tests/unit/meal-transactions.test.ts`
- Impact: A missing asset row can become a persisted placeholder instead of failing fast. If that asset is later exposed through `/api/assets/:id`, the metadata exists but the file path may not.
- Fix approach: Require callers to create real assets through `createAssetService()` before meal writes. Keep compatibility only in tests that explicitly seed legacy rows, then remove the unresolved-row fallback.

**No lint or formatter gate is configured:**
- Issue: The repo has `strict` TypeScript and many tests, but no `.eslintrc*`, `eslint.config.*`, `.prettierrc*`, or `biome.json`; `scripts/release-check.mjs` runs `tsc`, `yarn test`, and `yarn build` only.
- Files: `package.json`, `tsconfig.json`, `scripts/release-check.mjs`
- Impact: Unused code, accidental broad `any`, dependency-cycle drift, and formatting churn are caught only by review or focused tests.
- Fix approach: Add a lightweight lint gate that respects ESM `.js` import specifiers and repo test patterns. Include it in `yarn release:check` only after the baseline is clean.

**Development comments contain stale phase references:**
- Issue: `server/config.ts` still says Phase 8 will consume `config.debug`, while structured observability already exists in `server/observability/events.ts`.
- Files: `server/config.ts`, `server/observability/events.ts`
- Impact: Future agents may misread completed architecture as pending work and plan unnecessary observability plumbing.
- Fix approach: Replace phase-era comments with current behavior-only comments when touching adjacent config code.

## Known Bugs

**Settings footer displays stale app/version copy:**
- Symptoms: The Settings screen footer renders `營養教練 · v1.8.2` and `sport · 04/30` even though repository planning and changelog content are beyond that version.
- Files: `client/src/components/GoalSettings.tsx`, `CHANGELOG.md`, `package.json`
- Trigger: Open Settings from the Home screen.
- Workaround: Treat the footer as decorative copy; do not use it as release evidence.

**No production-code TODO/FIXME bug markers detected:**
- Symptoms: Debt-marker scan found no live `TODO`, `FIXME`, `HACK`, or `XXX` markers in `server/`, `client/src/`, `tests/`, or `scripts/` production/test source. Matches are mostly parser sentinel returns, test fixtures, generated planning text, or intentional placeholders.
- Files: `server/`, `client/src/`, `tests/`, `scripts/`
- Trigger: Not applicable.
- Workaround: Use behavioral tests and code review rather than debt markers to identify regressions.

## Security Considerations

**Production can boot with the default guest-session signing secret:**
- Risk: `config.guestSessionSecret` falls back to `dev-guest-session-secret-change-me`; `buildApp()` does not fail closed when `NODE_ENV=production` uses that default.
- Files: `server/config.ts`, `server/app.ts`, `server/services/guest-session.ts`, `README.md`
- Current mitigation: README deployment guidance requires `GUEST_SESSION_SECRET`; cookies are HMAC-signed and `Secure` is enabled in production.
- Recommendations: Add boot-time validation that rejects the default or weak secret whenever `NODE_ENV=production` or secure cookies are enabled.

**Legacy device ID migration is an authorization-sensitive bridge:**
- Risk: `POST /api/device/session` accepts `legacyDeviceId` from the request body and mints signed guest-session cookies if the device exists. Device IDs stored in `localStorage` become bearer-like migration material.
- Files: `server/routes/device.ts`, `client/src/store.ts`, `client/src/api.ts`, `tests/harness/scenarios/guest-session-hardening.ts`
- Current mitigation: Protected data routes use `resolveGuestSession()` and signed cookies; the bridge is isolated to session bootstrap and covered by guest-session hardening tests.
- Recommendations: Keep the migration path narrow. Add telemetry for `establishedBy: "legacy_migration"` and retire or gate the bridge once old localStorage-only clients no longer need it.

**CORS is registered with default policy:**
- Risk: `buildApp()` calls `app.register(cors)` without an explicit origin policy. The app is designed for same-origin Fastify serving, so broad CORS is unnecessary production surface.
- Files: `server/app.ts`, `docs/deploy/railway-beta.md`, `client/src/api.ts`
- Current mitigation: Client requests use same-origin URLs and cookie-backed sessions; cookies are `SameSite=Lax`.
- Recommendations: Configure CORS explicitly for local development and deployed origin(s), or disable it for production same-origin serving.

**Route fallback error redaction relies on caller discipline:**
- Risk: `buildChatRouteFallbackEvent()` includes `errorName` and `errorMessage` fields as provided; redaction happens only when callers use `sanitizeRouteCatchError()`.
- Files: `server/observability/events.ts`, `server/routes/chat.ts`, `tests/unit/observability-events.test.ts`, `tests/integration/chat-api.test.ts`
- Current mitigation: Current chat catch paths pass sanitized errors or omit provider details; provider metadata has its own sanitizer.
- Recommendations: Move `sanitizeRouteErrorText()` into `buildChatRouteFallbackEvent()` so future call sites cannot bypass redaction.

**Uploaded image validation trusts declared MIME after buffering:**
- Risk: `parseMultipartRequest()` accepts `image/jpeg`, `image/png`, and `image/webp` based on multipart MIME, buffers the whole file, then writes it and sends a data URI to the LLM.
- Files: `server/routes/chat.ts`, `client/src/api.ts`, `tests/integration/chat-api.test.ts`, `tests/harness/scenarios/boundary-contracts.ts`
- Current mitigation: Client pre-validates/compresses images, Fastify multipart has a 10 MB parser limit, the route enforces a 5 MB product limit, filenames are generated with UUIDs, and uploads are cleaned on success/failure.
- Recommendations: Validate magic bytes for accepted image types and stream to bounded temp files before base64 conversion.

## Performance Bottlenecks

**Image upload path duplicates large buffers in memory:**
- Problem: Chat uploads call `part.toBuffer()`, write that buffer to disk, and create a base64 data URI from the same bytes for LLM input.
- Files: `server/routes/chat.ts`, `client/src/api.ts`
- Cause: The route must both persist the upload and pass image data to the provider, so a 5 MB upload can temporarily occupy buffer plus base64 memory per request.
- Improvement path: Stream upload validation to disk, enforce size while streaming, and build provider input from the staged file only after validation.

**Asset responses read complete files into memory:**
- Problem: `readOwnedAsset()` loads the entire image with `readFile()` and `/api/assets/:id` sends the bytes directly.
- Files: `server/services/assets.ts`, `server/routes/assets.ts`
- Cause: The asset service returns `bytes` instead of a stream or file handle.
- Improvement path: Return file metadata plus path/stream, send via stream, and add cache headers appropriate for immutable UUID asset IDs.

**History search uses substring LIKE and repeated projection loops:**
- Problem: `searchMeals()` uses `lower(food_name) LIKE lower('%q%')`, paginates through matches until enough nutrition-bounded rows survive, and calls `projectHistoryMeals()` inside the loop.
- Files: `server/services/history-query.ts`, `tests/integration/meal-transaction-query-plan.test.ts`, `tests/integration/history-search-api.test.ts`
- Cause: Normal B-tree indexes cannot optimize leading-wildcard substring search; the query-plan test explicitly treats FTS as separate search work.
- Improvement path: Add an FTS-backed meal item index or normalized search table, then apply nutrition bounds without repeated projection loops.

**Day snapshot can request an effectively unbounded page:**
- Problem: `getDaySnapshot()` calls `getMeals()` with `limit: Number.MAX_SAFE_INTEGER`.
- Files: `server/services/history-query.ts`, `server/routes/history.ts`, `tests/integration/day-snapshot-api.test.ts`
- Cause: The day snapshot API wants all meals for a day and bypasses normal pagination.
- Improvement path: Use a practical per-day cap or a dedicated day-snapshot query that does not encode "all rows" through the paginated API.

**Realtime fan-out is in-memory and per-process:**
- Problem: `RealtimePublisher` keeps `Map<string, FastifyReply[]>` in memory and writes each event synchronously to all open replies for a device.
- Files: `server/realtime/publisher.ts`, `server/routes/sse.ts`, `server/app.ts`
- Cause: The deployment model is one persistent Fastify process.
- Improvement path: Add connection caps/metrics now; use an external pub/sub layer before running more than one web process.

## Fragile Areas

**Chat SSE terminal ordering and stop behavior:**
- Files: `server/routes/chat.ts`, `client/src/api.ts`, `tests/integration/chat-streaming.test.ts`, `tests/unit/chat-stream-contract.test.ts`
- Why fragile: The client expects `start`, `status`, `chunk`, `done`, or `stopped` semantics with a stable `turnId`; route catch paths must still emit terminal `done`, persist fallback messages, publish summaries, and clean assets.
- Safe modification: Change one event shape at a time and update both streaming integration tests and client parser tests. Preserve terminal events on every catch path.
- Test coverage: Strong integration coverage exists, but most assertions are concentrated in very large tests.

**Guest-session recovery spans cookies and localStorage:**
- Files: `server/services/guest-session.ts`, `server/lib/guest-session-resolver.ts`, `server/routes/device.ts`, `client/src/store.ts`, `client/src/components/GuestSessionRecoveryGate.tsx`, `tests/harness/scenarios/guest-session-hardening.ts`
- Why fragile: The active cookie, resume cookie, and legacy `deviceId` localStorage bridge must agree without widening protected-route authorization.
- Safe modification: Keep protected routes on `resolveGuestSession()` only. Treat raw `deviceId` headers/query params as migration-only or test-only inputs.
- Test coverage: Dedicated hardening harness exists; run it for any auth/session change.

**Meal correction target resolution is heuristic-heavy:**
- Files: `server/services/meal-correction.ts`, `server/orchestrator/tools.ts`, `tests/unit/meal-correction.test.ts`, `tests/integration/chat-meal-correction.integration.test.ts`
- Why fragile: Chinese regexes, date recovery, inferred meal periods, pending selections, stale revision recovery, and numeric authority checks interact in one service.
- Safe modification: Add a targeted unit or integration test for each new phrase class before adjusting regexes or evidence tiers.
- Test coverage: Broad tests exist; new natural-language variants still need explicit examples.

**Timezone contract is central to day boundaries:**
- Files: `server/lib/time.ts`, `server/app.ts`, `scripts/run-node-with-tz.mjs`, `scripts/release-check.mjs`, `tests/integration/timezone-guard.integration.test.ts`
- Why fragile: Meal summaries, historical dates, trends, and daily rollover all assume `TZ=Asia/Taipei`; missing TZ blocks boot by design.
- Safe modification: Preserve fail-fast validation and run timezone integration tests when date code changes.
- Test coverage: Good for boot/runtime guard; deployed Railway variable still requires manual smoke confirmation.

**Redacted observability and trace artifacts are privacy-sensitive:**
- Files: `server/observability/events.ts`, `server/orchestrator/llm-trace.ts`, `tests/harness/artifacts.ts`, `tests/unit/llm-chat-trace.test.ts`, `tests/integration/orchestrator.test.ts`
- Why fragile: Logs and harness artifacts must keep operational metadata while excluding device IDs, raw user text, prompts, images, provider payloads, session cookies, and API keys.
- Safe modification: Add negative assertions for any new trace field before emitting it.
- Test coverage: Strong unit coverage exists for current fields; new event types can bypass protection if they do not use the central sanitizers.

## Scaling Limits

**Single-process realtime state:**
- Current capacity: One Node/Fastify process owns all active chat stop controllers and SSE subscribers.
- Limit: Multiple app processes cannot share `activeChatTurns` or `RealtimePublisher` state; stop requests and live summary/goal events only work in the process that owns the connection.
- Scaling path: Add sticky sessions as an interim measure, then move turn state and realtime fan-out to an external coordinator.

**SQLite and local filesystem persistence:**
- Current capacity: One SQLite file and one durable asset directory on the mounted volume.
- Limit: Horizontal writes, cross-region deploys, and object-storage scale are not supported by the current `better-sqlite3` plus local asset service design.
- Scaling path: Keep Railway as a single persistent service or migrate storage behind repository-style services before horizontal deployment.

**Guest-only identity model:**
- Current capacity: Same-browser guest sessions with active and resume cookies.
- Limit: Cross-device continuity, account recovery, backup/restore, and export are not implemented.
- Scaling path: Add an account or export capability behind explicit product/security requirements; keep placeholders disabled until backend support exists.

## Dependencies at Risk

**OpenAI Chat Completions streaming shape:**
- Risk: `OpenAIProvider` depends on Chat Completions chunk semantics for early text streaming, merged tool-call deltas, finish reasons, and provider error metadata.
- Impact: SDK or API behavior changes can break tool-call assembly, stream continuation, fallback classification, or trace metadata.
- Migration plan: Keep provider behavior isolated behind `server/llm/types.ts`; add provider contract tests before upgrading `openai`.

**Native SQLite dependency:**
- Risk: `better-sqlite3` is native and tightly coupled to Node/runtime build compatibility.
- Impact: Railway or local Node upgrades can fail install/build even when TypeScript is unchanged.
- Migration plan: Pin supported Node in deployment docs or add an `.nvmrc`; keep DB access behind services for any later driver migration.

**Fastify multipart buffering:**
- Risk: `@fastify/multipart` is used through route-local buffering rather than a streaming storage adapter.
- Impact: Upload behavior, size-limit errors, and cleanup contracts are easy to regress during dependency upgrades.
- Migration plan: Add focused multipart boundary tests for parser-limit and partial-stream failures before upgrading multipart behavior.

## Missing Critical Features

**Export, backup, restore, and cross-device continuity:**
- Problem: The UI intentionally shows disabled/inert data-management and recovery affordances; there is no backend export/account path.
- Files: `client/src/components/GoalSettings.tsx`, `client/src/components/GuestSessionRecoveryGate.tsx`, `client/src/contracts/capability-matrix.ts`, `docs/capability-matrix.md`
- Blocks: Users cannot preserve data when same-browser guest recovery fails or move data between devices.

**Raw debugger/replay tooling for LLM failures:**
- Problem: Observability captures metadata-only traces; semantic soft-failure capture and raw debugger replay are not implemented.
- Files: `docs/adr/0001-metadata-only-llm-failure-localization.md`, `server/orchestrator/llm-trace.ts`, `server/observability/events.ts`
- Blocks: Deep production forensics for model failures require reproducing with available metadata, not raw prompt/provider replay.

**Automated deployed-domain smoke gate:**
- Problem: `yarn release:check` runs local `tsc`, full tests, and build; real Railway smoke remains a manual checklist.
- Files: `scripts/release-check.mjs`, `docs/deploy/railway-beta.md`, `.codex/skills/nutrition-railway-smoke/SKILL.md`
- Blocks: Same-origin deployment, mounted-volume persistence, and protected asset fetch regressions can pass local release gates until manual smoke runs.

## Test Coverage Gaps

**Harness scenarios are outside `yarn test` and `yarn release:check`:**
- What's not tested: Deterministic harness scenarios such as `boundary-contracts`, `guest-session-hardening`, `meal-image-continuity`, and visual `.mjs` scenarios are not run by the normal local release check.
- Files: `package.json`, `scripts/release-check.mjs`, `tests/harness/scenarios/`
- Risk: Boundary evidence can drift unless the matching `yarn verify:harness -- <scenario>` or artifact README command is run intentionally.
- Priority: High for auth, upload cleanup, SSE ordering, and asset-continuity changes.

**No lint/static-analysis coverage:**
- What's not tested: Import hygiene, unused exports, broad casts, dependency cycles, and formatting consistency.
- Files: `package.json`, `tsconfig.json`, `server/orchestrator/tools.ts`
- Risk: TypeScript and tests catch behavior, but code-quality drift accumulates in large shared files.
- Priority: Medium.

**Production-secret validation is not covered as a boot contract:**
- What's not tested: Production boot with the default `GUEST_SESSION_SECRET` fails closed.
- Files: `server/config.ts`, `server/app.ts`, `tests/integration/timezone-guard.integration.test.ts`
- Risk: A deployment can satisfy timezone and build gates while still using the development guest-session secret.
- Priority: High.

**Search scalability lacks volume/load tests:**
- What's not tested: Large history search ranges with substring queries and nutrition filters under realistic row counts.
- Files: `server/services/history-query.ts`, `tests/integration/history-search-api.test.ts`, `tests/integration/meal-transaction-query-plan.test.ts`
- Risk: Query-plan tests protect against full meal transaction scans, but they do not prove latency under large `meal_revision_items` volume or repeated filtered pagination loops.
- Priority: Medium.

---

*Concerns audit: 2026-05-29*
