---
last_mapped_commit: 782a04005f8f328f7f86ac589eb1253060471b5f
---

# Codebase Concerns

**Analysis Date:** 2026-06-01
**Scope:** `.env.example`, `CHANGELOG.md`, `drizzle/`, `drizzle.config.ts`, `package.json`, `scripts/`, `tsconfig.json`

## Tech Debt

**Release gate excludes harness and matrix checks by default:**
- Issue: `yarn release:check` runs TypeScript, `yarn test`, and `yarn build`, but it does not run `yarn matrix:check`, `yarn behavior-matrix:gen:check`, or any `yarn verify:harness -- <scenario>` command.
- Files: `package.json`, `scripts/release-check.mjs`, `scripts/generate-capability-matrix-doc.mjs`, `scripts/generate-behavior-matrix-doc.mjs`, `CHANGELOG.md`
- Impact: Capability matrix drift, behavior matrix drift, and deterministic harness regressions can pass the normal release gate unless a phase explicitly adds those commands. `CHANGELOG.md` shows several releases rely on separate metadata-only harness evidence.
- Fix approach: Keep `scripts/release-check.mjs` as the core local gate, but add phase-specific verification checklists for matrix and harness-sensitive changes. Consider a higher-cost `release:full` script if those checks should be standardized before promotion.

**Dependency versions are semver ranges without a package-manager pin:**
- Issue: `package.json` uses caret ranges for runtime and dev dependencies and does not declare a `packageManager` field.
- Files: `package.json`
- Impact: `yarn.lock` controls current installs, but fresh dependency updates can pull broad minor/patch movement, and Corepack cannot infer a project-pinned Yarn version from `package.json`.
- Fix approach: Add a `packageManager` pin to `package.json` and keep dependency updates focused. Treat `better-sqlite3`, `drizzle-orm`, `drizzle-kit`, `openai`, `fastify`, `vite`, and React major/minor movement as review-sensitive.

**Drizzle config depends on a server schema outside the migration scope:**
- Issue: `drizzle.config.ts` points schema generation at `./server/db/schema.ts` while generated SQL and snapshots live under `drizzle/`.
- Files: `drizzle.config.ts`, `drizzle/`, `package.json`
- Impact: Migration generation can drift if `server/db/schema.ts` changes without regenerating and committing matching `drizzle/*.sql` and `drizzle/meta/*.json` files. This scoped remap did not inspect `server/db/schema.ts`, so the configured source of truth is intentionally outside the requested path set.
- Fix approach: When changing persistence schema, review both `server/db/schema.ts` and `drizzle/` together, run `yarn db:generate` only intentionally, and verify the resulting migration against empty and upgraded SQLite databases.

**Generated documentation scripts encode output paths directly:**
- Issue: Matrix generators hard-code `docs/capability-matrix.md` and `tests/harness/behavior-matrix.md`.
- Files: `scripts/generate-capability-matrix-doc.mjs`, `scripts/generate-behavior-matrix-doc.mjs`, `package.json`
- Impact: Moving docs or harness directories requires script edits and package script updates in lockstep. The check mode fails only after rendering content against the hard-coded target.
- Fix approach: Keep these paths stable, or add explicit CLI flags for output paths before reorganizing `docs/`, `tests/harness/`, or matrix source files.

## Known Bugs

**No scoped bug marker found:**
- Symptoms: A scoped scan of `.env.example`, `CHANGELOG.md`, `drizzle/`, `drizzle.config.ts`, `package.json`, `scripts/`, and `tsconfig.json` found no live `TODO`, `FIXME`, `HACK`, or `XXX` markers.
- Files: `.env.example`, `CHANGELOG.md`, `drizzle/`, `drizzle.config.ts`, `package.json`, `scripts/`, `tsconfig.json`
- Trigger: Not applicable.
- Workaround: Use behavioral verification, migration checks, release evidence, and phase-specific harness runs rather than marker comments to find regressions in these paths.

**Mobile evidence script rejects non-Vite packaged app flows:**
- Symptoms: `scripts/phase45-mobile-evidence.mjs` requires a base URL that can import `/src/store.ts`, and its help text recommends `yarn dev:client`.
- Files: `scripts/phase45-mobile-evidence.mjs`
- Trigger: Run the script against a built same-origin app that does not expose `/src/store.ts`.
- Workaround: Use the script with the Vite dev server for deterministic UI evidence. Use separate Railway or production smoke procedures for packaged deployment behavior.

## Security Considerations

**Environment template is tracked, but env contents must remain secret:**
- Risk: `.env.example` is in scope and contains placeholder/template values, while actual `.env` files are secret-bearing and must not be read or committed.
- Files: `.env.example`, `package.json`, `scripts/run-node-with-tz.mjs`, `scripts/release-check.mjs`
- Current mitigation: Runtime scripts use `--env-file=.env` for local server and release checks, while `scripts/run-node-with-tz.mjs` preserves `process.env` and forces `TZ=Asia/Taipei`.
- Recommendations: Keep `.env.example` limited to names, placeholders, and safe defaults. Never include real `OPENAI_API_KEY`, guest-session secrets, database snapshots, or deployed host credentials in tracked env templates or generated evidence.

**Release check inherits the full environment:**
- Risk: `scripts/run-node-with-tz.mjs` forwards all environment variables to child commands after setting `TZ=Asia/Taipei`.
- Files: `scripts/run-node-with-tz.mjs`, `package.json`
- Current mitigation: Child process stdio is inherited, but the wrapper itself does not print environment values.
- Recommendations: Avoid adding debug logging of `process.env` to release, test, matrix, or harness scripts. Keep provider payload and secret redaction requirements in tests and generated artifacts.

**Mobile evidence script writes operator-provided URLs into artifacts:**
- Risk: `scripts/phase45-mobile-evidence.mjs` writes `baseUrl` and output metadata to `phase45-manifest.json`. A production or private URL passed to `--base-url` becomes part of generated evidence.
- Files: `scripts/phase45-mobile-evidence.mjs`
- Current mitigation: The manifest declares synthetic in-browser API responses and synthetic local store data only; the script does not read `.env`, raw databases, private logs, production user data, or provider payloads.
- Recommendations: Keep `--base-url` values non-sensitive in shared artifacts. Do not commit generated `output/playwright/` evidence if it includes private hosts or unreleased environment details.

**Provider and session privacy are enforced by evidence policy, not by changelog content:**
- Risk: `CHANGELOG.md` records that releases keep raw prompts, user text, assistant final text, tool payloads, provider bodies, image data, session material, and database snapshots out of committed evidence.
- Files: `CHANGELOG.md`, `scripts/generate-behavior-matrix-doc.mjs`, `scripts/phase45-mobile-evidence.mjs`
- Current mitigation: Release notes describe metadata-only evidence, and the Phase 45 mobile evidence manifest states synthetic data only.
- Recommendations: Preserve metadata-only evidence when adding new generators or changelog entries. Generated reports should store command/status/counts/paths rather than raw user or provider content.

## Performance Bottlenecks

**Release check always runs full tests and frontend build:**
- Problem: `scripts/release-check.mjs` runs `yarn tsc --noEmit`, `yarn test`, and `yarn build` regardless of changed file type.
- Files: `scripts/release-check.mjs`, `package.json`
- Cause: The release gate prioritizes predictable promotion readiness over path-sensitive speed.
- Improvement path: Keep `release:check` comprehensive for merge and promotion gates. Use narrower commands such as `yarn test:unit`, `yarn test:integration`, `yarn matrix:check`, or `yarn behavior-matrix:gen:check` during development before the final gate.

**Mobile screenshot evidence is intentionally serial and browser-bound:**
- Problem: `scripts/phase45-mobile-evidence.mjs` captures 22 screenshots across surfaces and mobile viewport sizes using a real browser over CDP.
- Files: `scripts/phase45-mobile-evidence.mjs`
- Cause: The script loops through targets and viewports sequentially and waits for page setup, rendering, inspection, screenshot capture, and byte checks for each case.
- Improvement path: Preserve serial execution for deterministic evidence unless runtime becomes a bottleneck. If parallelizing, isolate browser targets and keep the blank-capture, overflow, and manifest checks intact.

**History query scaling still depends on non-FTS indexes:**
- Problem: `drizzle/0004_history_query_hot_path_indexes.sql` adds hot-path indexes for active meal transactions, but scoped migrations do not define a full-text search table.
- Files: `drizzle/0004_history_query_hot_path_indexes.sql`, `drizzle/0002_meal_transaction_v2_foundation.sql`
- Cause: The schema optimizes device/date/id access paths, not substring or full-text meal search.
- Improvement path: Add an FTS-backed meal item index or normalized search table if history search latency becomes a product issue at larger row counts.

## Fragile Areas

**Schema history is migration-file ordered and append-only:**
- Files: `drizzle/0000_brainy_rocket_racer.sql`, `drizzle/0001_sleepy_vivisector.sql`, `drizzle/0002_meal_transaction_v2_foundation.sql`, `drizzle/0003_aspiring_masque.sql`, `drizzle/0004_history_query_hot_path_indexes.sql`, `drizzle/0005_chat_message_status.sql`, `drizzle/0006_colossal_selene.sql`, `drizzle/0007_violet_living_lightning.sql`, `drizzle/0008_shiny_stellaris.sql`, `drizzle/meta/_journal.json`
- Why fragile: Existing deployments depend on the exact migration sequence in `drizzle/meta/_journal.json`. Editing old migration files can desynchronize fresh databases from already-migrated SQLite volumes.
- Safe modification: Add a new numbered migration for schema changes. Do not rewrite existing `drizzle/*.sql` or `drizzle/meta/*.json` files unless intentionally repairing migration history with a documented database procedure.
- Test coverage: Use `yarn db:migrate` against an empty SQLite database and an upgraded copy of an existing database when changing `drizzle/`.

**Backfill migration assumes legacy asset references are well-formed:**
- Files: `drizzle/0002_meal_transaction_v2_foundation.sql`
- Why fragile: The migration converts legacy `image_path` values beginning with `asset:` into `meal_revisions.image_asset_id` and `asset_references` rows without validating asset existence in the SQL itself.
- Safe modification: Preserve legacy compatibility behavior when changing asset schema. Add repair or validation migrations separately if missing asset rows must be enforced.
- Test coverage: Add migration tests with legacy `meals.image_path` and `chat_messages.image_path` values before changing asset reference backfills.

**Mutation outcome schema stores typed actions plus semi-structured goal fields:**
- Files: `drizzle/0008_shiny_stellaris.sql`
- Why fragile: `action` has a CHECK constraint, but `updated_goal_fields` is stored as text. Runtime code must keep serialization, parsing, and action-specific nullable columns aligned with this migration.
- Safe modification: Add new action values through a new migration and update runtime validators, tests, matrix documentation, and changelog evidence together.
- Test coverage: Run integration tests for chat mutation receipts and goal updates after changing mutation outcome persistence.

**Timezone enforcement depends on wrapper usage:**
- Files: `scripts/run-node-with-tz.mjs`, `scripts/release-check.mjs`, `package.json`
- Why fragile: Test and release scripts use `scripts/run-node-with-tz.mjs`, but scripts such as `yarn db:migrate`, `yarn matrix:gen`, `yarn behavior-matrix:gen`, and `yarn start` do not go through that wrapper.
- Safe modification: Use the wrapper for date-sensitive tests and release gates. Preserve `TZ=Asia/Taipei` in commands that validate day-boundary behavior.
- Test coverage: Date-boundary changes need `yarn tsc --noEmit`, the relevant unit/integration tests through `scripts/run-node-with-tz.mjs`, and any matching harness scenario.

**Visual evidence script is coupled to current CSS selectors and Zustand store shape:**
- Files: `scripts/phase45-mobile-evidence.mjs`
- Why fragile: The script inspects selectors such as `.sp-chat-textarea`, `.screen-bottom-bar`, `.sp-meal-edit-footer`, `.sp-meal-edit-save`, `.sp-onboarding-primary`, `.screen-shell`, and `.app-viewport`, and it directly imports `client/src/store.ts`.
- Safe modification: Update the evidence script in the same change as UI selector/store-shape changes. Keep assertions for body text, horizontal overflow, fixed-bar overlap, bottom occlusion, keyboard-safe layout, non-empty screenshots, and manifest output.
- Test coverage: Run the script against `yarn dev:client` after mobile shell, chat composer, onboarding, history, settings, or meal edit UI changes.

## Scaling Limits

**SQLite migration configuration is single-database-path oriented:**
- Current capacity: `drizzle.config.ts` reads `DB_PATH` or falls back to `./data/nutrition.db`.
- Limit: Multi-instance migrations and cross-process SQLite writes are outside this scoped migration configuration.
- Scaling path: Keep deployments single-writer unless an external database replaces the local SQLite path behind the existing persistence boundary.

**Release verification is local-machine oriented:**
- Current capacity: `scripts/release-check.mjs` validates local TypeScript, Node tests, and Vite build.
- Limit: Deployed-domain smoke, mounted volume behavior, production cookies, and protected asset fetches are not represented in `scripts/release-check.mjs`.
- Scaling path: Keep Railway staging/production smoke as a separate promotion requirement, as reflected by `CHANGELOG.md` release evidence.

**Mobile evidence assumes installed desktop browsers on macOS-style paths:**
- Current capacity: `scripts/phase45-mobile-evidence.mjs` searches `/Applications/Microsoft Edge.app/...` and `/Applications/Google Chrome.app/...`.
- Limit: Linux CI, containerized runners, and machines without those browser installs cannot run the script as written.
- Scaling path: Add a configurable browser path or Playwright-managed browser mode before making this evidence script a portable CI gate.

## Dependencies at Risk

**Native SQLite dependency remains a deployment risk:**
- Risk: `package.json` depends on `better-sqlite3`, which uses native bindings.
- Impact: Node, platform, or base-image changes can break native install/build behavior even when TypeScript code is unchanged.
- Migration plan: Verify installs and migration execution before changing Node major versions or `better-sqlite3`. Keep SQLite-related lockfile changes focused and review native build output.

**OpenAI SDK behavior is externally controlled:**
- Risk: `package.json` depends on `openai`, while `CHANGELOG.md` records provider failure localization, fallback behavior, metadata-only traces, and model workflow evidence.
- Impact: SDK or model behavior changes can affect meal analysis, streaming, tool calling, fallback metadata, or provider error shape.
- Migration plan: Treat `openai` dependency movement as high-risk. Run targeted provider tests, deterministic harnesses, and metadata-only failure localization checks before release.

**Drizzle ORM and Kit must stay schema-compatible:**
- Risk: `package.json` pins `drizzle-orm` and `drizzle-kit` by semver range, while migrations and snapshots are generated under `drizzle/`.
- Impact: Generator output, snapshot format, or SQLite DDL rendering can change during dependency updates.
- Migration plan: Review generated `drizzle/*.sql` and `drizzle/meta/*.json` diffs carefully after Drizzle updates. Run migration checks against empty and upgraded databases before committing.

**Frontend major versions are current and tightly coupled to build tooling:**
- Risk: `package.json` uses React 19, Vite 6, Tailwind 4, and `@vitejs/plugin-react` 4.
- Impact: Build behavior, JSX transform behavior, CSS output, and dev-server import behavior can affect `yarn build`, matrix scripts, and `scripts/phase45-mobile-evidence.mjs`.
- Migration plan: Keep frontend dependency updates grouped by toolchain and verify `yarn build`, mobile evidence, and matrix generation after upgrades.

## Missing Critical Features

**No script-level migration verification command exists in scoped package scripts:**
- Problem: `package.json` includes `db:generate` and `db:migrate`, but no dedicated migration test command for empty and upgraded SQLite databases.
- Files: `package.json`, `drizzle.config.ts`, `drizzle/`
- Blocks: Migration changes require manual setup to prove both fresh installs and existing-volume upgrades.

**No portable CI mode for mobile visual evidence:**
- Problem: `scripts/phase45-mobile-evidence.mjs` uses hard-coded macOS browser paths and direct CDP wiring.
- Files: `scripts/phase45-mobile-evidence.mjs`
- Blocks: The Phase 45 screenshot evidence cannot become a reliable CI gate across Linux containers or machines without Edge/Chrome in `/Applications`.

**Release gate does not encode deployed-domain smoke requirements:**
- Problem: `scripts/release-check.mjs` ends at local build success, while `CHANGELOG.md` records separate staging/production smoke evidence for deployed behavior.
- Files: `scripts/release-check.mjs`, `CHANGELOG.md`
- Blocks: Same-origin serving, mounted-volume persistence, production cookies, protected asset fetch, and mobile deployed-domain behavior can pass local release checks and still fail after deployment.

**Env template safety is not machine-checked in scoped scripts:**
- Problem: `.env.example` is present, but scoped scripts do not provide a check that it contains only placeholders and complete variable names.
- Files: `.env.example`, `package.json`, `scripts/`
- Blocks: New required variables can be omitted from `.env.example`, or unsafe example values can be added without a dedicated guard.

## Test Coverage Gaps

**Migration upgrade paths need explicit verification for existing databases:**
- What's not tested: Scoped files show migrations and metadata, but do not show a committed fixture or package script proving every migration against a realistic existing production-like SQLite database.
- Files: `drizzle/`, `drizzle.config.ts`, `package.json`
- Risk: Fresh database migration can pass while an upgrade from an older volume fails on legacy rows, asset references, added constraints, or new nullable/required column behavior.
- Priority: High for `drizzle/` changes.

**Matrix generators are outside `yarn release:check`:**
- What's not tested: `scripts/release-check.mjs` does not run `yarn matrix:check` or `yarn behavior-matrix:gen:check`.
- Files: `scripts/release-check.mjs`, `scripts/generate-capability-matrix-doc.mjs`, `scripts/generate-behavior-matrix-doc.mjs`, `package.json`
- Risk: Generated Markdown can drift from `client/src/contracts/capability-matrix.ts` or `tests/harness/behavior-matrix.ts` while release checks still pass.
- Priority: Medium; high for capability, behavior, UI affordance, or harness coverage changes.

**Harness scenarios remain outside the normal release command list:**
- What's not tested: `package.json` exposes `yarn verify:harness`, but `scripts/release-check.mjs` does not invoke any harness scenario.
- Files: `package.json`, `scripts/release-check.mjs`, `CHANGELOG.md`
- Risk: Boundary scenarios such as behavior matrix, provider-auth failure localization, guest-session hardening, upload cleanup, and SSE ordering can drift unless run intentionally for matching changes.
- Priority: High for auth, upload, SSE, LLM fallback, and deployed-domain changes.

**Mobile visual evidence script has no package script wrapper:**
- What's not tested: `scripts/phase45-mobile-evidence.mjs` exists but is not exposed through `package.json`.
- Files: `scripts/phase45-mobile-evidence.mjs`, `package.json`
- Risk: Operators may miss or mistype the command, and the script is easy to omit from phase verification despite being high-value for mobile UI regressions.
- Priority: Medium for mobile UI changes.

---

*Concerns audit: 2026-06-01*
