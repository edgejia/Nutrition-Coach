# Codebase Concerns

**Analysis Date:** 2026-06-01
**Last mapped commit:** df5f989b593d494ac44ce3b004307c1c6ada7bec
**Scope:** `.dockerignore`, `.gitignore`, `CHANGELOG.md`, `Dockerfile`, `README-en.md`, `README.md`, `drizzle/`, `yarn.lock`

## Tech Debt

**Docker image relies on runtime migrations:**
- Issue: The container build compiles the app, but `Dockerfile` runs `yarn db:migrate && yarn start` every time the container starts.
- Files: `Dockerfile`, `drizzle/`, `README.md`, `README-en.md`
- Impact: Application boot is coupled to schema migration success. A migration failure prevents startup, and concurrent or repeated deploy starts depend on the migration runner being safe for the deployed SQLite volume.
- Fix approach: Keep `drizzle/` migrations idempotent and deployment-tested. For higher-risk migrations, run `yarn db:migrate` as an explicit release step before starting the web process instead of hiding it inside `CMD`.

**Docker build excludes operational documentation:**
- Issue: `.dockerignore` excludes `docs`, `.planning`, `.codex`, `AGENTS.md`, and `CLAUDE.md`, while `README.md` and `README-en.md` link to `docs/deploy/railway-beta.md`.
- Files: `.dockerignore`, `README.md`, `README-en.md`
- Impact: The runtime image is lean, but deployment/debug guidance is unavailable inside the container. Operators must use repository docs outside the image for Railway setup, smoke checks, and agent-specific release rules.
- Fix approach: Keep docs excluded from the image, but make the minimum runtime requirements explicit in `README.md` and `README-en.md`: persistent volume, required env vars, migrations, and smoke commands.

**Generated planning and harness evidence are intentionally untracked:**
- Issue: `.gitignore` excludes `.planning/`, `tests/harness/artifacts/`, and `tests/harness/tmp/`, while `CHANGELOG.md` records verification summaries rather than generated evidence files.
- Files: `.gitignore`, `CHANGELOG.md`
- Impact: Release evidence can be summarized without the raw artifacts that prove it. This supports privacy and repo hygiene, but future audits depend on accurate changelog and phase metadata.
- Fix approach: Continue keeping generated artifacts out of git. Record command, status, scenario name, and artifact path metadata in committed planning/release docs without committing raw artifact payloads.

**No package-manager version is pinned in scoped files:**
- Issue: `README.md` and `README-en.md` require Yarn, and `Dockerfile` enables Corepack, but the scoped files do not pin a Yarn version.
- Files: `README.md`, `README-en.md`, `Dockerfile`, `yarn.lock`
- Impact: Local and Docker installs depend on the Corepack/Yarn version available in the active Node 22 environment. Lockfile stability reduces risk, but package-manager behavior can still drift.
- Fix approach: Add a package-manager pin in the project manifest or document the expected Yarn major version in the README files. Keep using `yarn install --frozen-lockfile` in `Dockerfile`.

## Known Bugs

**No scoped bug marker found:**
- Symptoms: A scoped scan of `.dockerignore`, `.gitignore`, `CHANGELOG.md`, `Dockerfile`, `README-en.md`, `README.md`, `drizzle/`, and `yarn.lock` found no live `TODO`, `FIXME`, `HACK`, or `XXX` markers.
- Files: `.dockerignore`, `.gitignore`, `CHANGELOG.md`, `Dockerfile`, `README-en.md`, `README.md`, `drizzle/`, `yarn.lock`
- Trigger: Not applicable.
- Workaround: Use behavioral verification and release evidence rather than marker comments to find regressions in these paths.

**Documentation references docs excluded from the Docker context:**
- Symptoms: `README.md` and `README-en.md` link to `docs/deploy/railway-beta.md`, but `.dockerignore` removes `docs` from the build context.
- Files: `README.md`, `README-en.md`, `.dockerignore`
- Trigger: Inspect the built image or try to follow the Railway link from files copied into the image.
- Workaround: Use the repository checkout for deployment documentation, not the built container image.

## Security Considerations

**Default guest-session signing secret remains documented as a fallback:**
- Risk: `README.md` and `README-en.md` document `GUEST_SESSION_SECRET` defaulting to `dev-guest-session-secret-change-me` while also requiring a stable random value for deployment.
- Files: `README.md`, `README-en.md`
- Current mitigation: The README deployment instructions explicitly list `GUEST_SESSION_SECRET` as required for deployed environments and suggest generating it with `openssl rand -hex 32`.
- Recommendations: Keep documentation explicit that the default is development-only. Add or preserve a production boot guard in code so a deployed `NODE_ENV=production` process cannot run with the default secret.

**Secrets are excluded from both git and Docker context:**
- Risk: Environment files are intentionally ignored, so deployments depend on out-of-band secret provisioning.
- Files: `.gitignore`, `.dockerignore`, `README.md`, `README-en.md`
- Current mitigation: `.gitignore` and `.dockerignore` ignore `.env` and `.env.*` while allowing `.env.example`; README setup tells developers to create `.env` locally and lists required variables.
- Recommendations: Keep `.env.example` free of real secrets. Document every production-required variable in README files when new secrets or runtime paths are added.

**OpenAI API key is required for local and deployed app use:**
- Risk: `README.md` and `README-en.md` state local development calls the OpenAI API for real meal analysis and require `OPENAI_API_KEY`.
- Files: `README.md`, `README-en.md`
- Current mitigation: Tests and some harness flows use mock providers, and `.gitignore`/`.dockerignore` exclude environment files.
- Recommendations: Keep test and harness documentation clear about mock providers. Never commit `.env` or raw provider payloads; continue summarizing verification metadata in `CHANGELOG.md` instead of storing sensitive request content.

## Performance Bottlenecks

**Single-process SQLite and durable asset model limits horizontal scaling:**
- Problem: README deployment guidance describes one Fastify process serving the API and `dist/client`, with SQLite and durable assets on a persistent volume.
- Files: `README.md`, `README-en.md`, `Dockerfile`, `drizzle/`
- Cause: The app stores relational data in SQLite migrations under `drizzle/` and image assets in local durable directories such as `ASSETS_DIR`.
- Improvement path: Keep deployments single-process with a persistent volume. Before horizontal scaling, move database and assets behind services that support cross-process coordination and object storage.

**Startup migrations add boot latency and failure surface:**
- Problem: `Dockerfile` runs `yarn db:migrate` before `yarn start`.
- Files: `Dockerfile`, `drizzle/`
- Cause: Schema migration happens in the serving container entrypoint rather than a separate deploy phase.
- Improvement path: For production promotion, run migrations once with release orchestration, then start the app. Keep Docker startup migration only for simple single-instance deployments.

**History query scaling still depends on non-FTS indexes:**
- Problem: `drizzle/0004_history_query_hot_path_indexes.sql` adds hot-path indexes for active meal transactions, but the scoped migrations do not define an FTS search table.
- Files: `drizzle/0004_history_query_hot_path_indexes.sql`, `drizzle/0002_meal_transaction_v2_foundation.sql`
- Cause: The schema optimizes device/date/id access paths, not full-text or substring meal search.
- Improvement path: Add an FTS-backed meal item index or normalized search table if history search latency becomes a product issue at larger row counts.

## Fragile Areas

**Schema history is migration-file ordered and append-only:**
- Files: `drizzle/0000_brainy_rocket_racer.sql`, `drizzle/0001_sleepy_vivisector.sql`, `drizzle/0002_meal_transaction_v2_foundation.sql`, `drizzle/meta/_journal.json`
- Why fragile: Existing deployments depend on the exact migration sequence in `drizzle/meta/_journal.json`. Editing old migration files can desynchronize fresh databases from already-migrated SQLite volumes.
- Safe modification: Add a new numbered migration for schema changes. Do not rewrite existing `drizzle/*.sql` or `drizzle/meta/*.json` files unless intentionally repairing migration history with a documented database procedure.
- Test coverage: Use `yarn db:migrate` against an empty SQLite database and an upgraded copy of an existing database when changing `drizzle/`.

**Backfill migration assumes legacy asset references are well-formed:**
- Files: `drizzle/0002_meal_transaction_v2_foundation.sql`
- Why fragile: The migration converts legacy `image_path` values beginning with `asset:` into `meal_revisions.image_asset_id` and `asset_references` rows. Malformed legacy values can produce references without validating asset existence in the SQL itself.
- Safe modification: Preserve legacy compatibility behavior when changing asset schema. Add repair or validation migrations separately if missing asset rows must be enforced.
- Test coverage: Add migration tests with legacy `meals.image_path` and `chat_messages.image_path` values before changing asset reference backfills.

**Guest-session documentation spans local and production modes:**
- Files: `README.md`, `README-en.md`
- Why fragile: The README tables show development defaults and deployment-only overrides in one place. Future edits can accidentally make production-only variables look optional.
- Safe modification: Keep local defaults and production requirements separated. Treat `NODE_ENV`, `GUEST_SESSION_SECRET`, `DB_PATH`, `TZ`, `ASSETS_DIR`, and `CLIENT_DIST_DIR` as deployment-sensitive fields.
- Test coverage: Documentation-only changes need human review; code changes around these variables need boot/config tests and deployment smoke.

**Ignore rules protect local workflow state:**
- Files: `.gitignore`, `.dockerignore`
- Why fragile: `.planning/`, `.codex/`, `AGENTS.md`, local databases, and generated harness artifacts are intentionally excluded. Removing these entries can leak local workflow policy, raw evidence, or runtime data into commits/build contexts.
- Safe modification: Add narrow exceptions only when a file is intentionally safe and needed. Keep `.env`, `*.db`, `.planning/`, and harness artifact payloads ignored.
- Test coverage: Review `git status --ignored` and Docker build context behavior when changing ignore rules.

## Scaling Limits

**SQLite plus local filesystem persistence:**
- Current capacity: One SQLite database path (`DB_PATH`) and local asset directories (`ASSETS_DIR`, `UPLOADS_STAGING_DIR`) on a persistent volume.
- Limit: Multi-process writes, cross-region deploys, and object-storage scale are outside the documented architecture.
- Scaling path: Keep the Railway-style deployment single-instance, or introduce an external database and object storage behind the existing persistence boundaries before scaling horizontally.

**Single Fastify service deployment:**
- Current capacity: One Node 22 process serves API routes and `dist/client`.
- Limit: Container startup, migration, API serving, and static frontend serving are coupled.
- Scaling path: Split migration execution from web startup first; split static hosting or API scaling only after persistence and session behavior support it.

**Guest-only identity model:**
- Current capacity: Same-browser guest sessions with signed cookies.
- Limit: Cross-device continuity, account recovery, and long-term data portability are not documented as supported features.
- Scaling path: Add account/export requirements before changing persistence or session documentation.

## Dependencies at Risk

**Native SQLite dependency remains a deployment risk:**
- Risk: `yarn.lock` includes native build support packages such as `prebuild-install`, `node-abi`, and platform-specific tooling used by native dependencies.
- Impact: Node or base image upgrades can break native install/build behavior even when TypeScript code is unchanged.
- Migration plan: Keep `Dockerfile` pinned to a supported Node 22 base image. Verify native installs through Docker build before changing Node major versions or SQLite driver dependencies.

**OpenAI SDK behavior is externally controlled:**
- Risk: `yarn.lock` pins `openai` through the lockfile, while README files document OpenAI-backed meal analysis and `OPENAI_ORCHESTRATOR_MODEL`.
- Impact: SDK or model behavior changes can affect meal analysis, streaming, tool calling, or fallback behavior when dependencies are upgraded.
- Migration plan: Treat `yarn.lock` changes involving `openai` as high-risk. Run targeted LLM provider tests, deterministic harnesses, and metadata-only failure localization checks before release.

**Large lockfile updates can hide unrelated dependency movement:**
- Risk: `yarn.lock` is the authoritative dependency snapshot and contains many transitive packages.
- Impact: Broad lockfile churn can obscure security or runtime-impacting upgrades during review.
- Migration plan: Keep dependency upgrades focused. Review `yarn.lock` diffs by package group and run `yarn release:check` after lockfile changes.

## Missing Critical Features

**Automated deployed-domain smoke gate is not part of documented release commands:**
- Problem: README files list `yarn release:check`, while `CHANGELOG.md` separates local release checks from Railway staging/production smoke evidence.
- Files: `README.md`, `README-en.md`, `CHANGELOG.md`
- Blocks: Same-origin serving, mounted-volume persistence, production cookies, and protected asset fetch can pass local release checks and still fail on the deployed domain.

**Backup/export/restore path is not documented:**
- Problem: README deployment guidance requires persistent SQLite and asset storage, but the scoped docs do not document backup, restore, export, or disaster-recovery procedures.
- Files: `README.md`, `README-en.md`, `Dockerfile`
- Blocks: Operators do not have a documented procedure for preserving or moving user data across deployments, volume changes, or host failures.

**Package-manager pin is not visible in scoped documentation:**
- Problem: The README files say to use Yarn and `Dockerfile` uses Corepack, but the scoped files do not document the expected Yarn version.
- Files: `README.md`, `README-en.md`, `Dockerfile`, `yarn.lock`
- Blocks: Reproducible setup depends on the environment’s Corepack resolution unless the project manifest pins `packageManager`.

## Test Coverage Gaps

**Harness scenarios remain outside the normal release command list:**
- What's not tested: README command lists include `yarn release:check` and show example harness commands separately; `CHANGELOG.md` records dedicated harness evidence for specific releases.
- Files: `README.md`, `README-en.md`, `CHANGELOG.md`
- Risk: Boundary scenarios such as guest-session hardening, behavior-matrix, and provider-auth failure localization can drift unless run intentionally for matching changes.
- Priority: High for auth, upload, SSE, LLM fallback, and deployed-domain changes.

**Migration upgrade paths need explicit verification for existing databases:**
- What's not tested: Scoped files show migrations and metadata, but do not show a committed fixture or command proving every migration against a realistic existing production-like SQLite database.
- Files: `drizzle/`, `README.md`, `README-en.md`
- Risk: Fresh database migration can pass while an upgrade from an older volume fails on legacy rows, asset references, or added constraints.
- Priority: High for `drizzle/` changes.

**Docker build does not run tests:**
- What's not tested: `.dockerignore` excludes `tests`, and `Dockerfile` runs `yarn build` but no test command.
- Files: `.dockerignore`, `Dockerfile`, `README.md`, `README-en.md`
- Risk: A container image can build successfully even when unit, integration, or harness checks fail outside Docker.
- Priority: Medium; keep `yarn release:check` as the pre-build gate and use Docker build as packaging verification.

**Production-secret validation coverage is not visible from scoped files:**
- What's not tested: The scoped files document `GUEST_SESSION_SECRET` as required for deployment but do not show a test or boot guard proving the development default is rejected in production.
- Files: `README.md`, `README-en.md`
- Risk: A deployment can follow most README requirements but accidentally run with the development signing secret if runtime validation is missing or regresses.
- Priority: High.

---

*Concerns audit: 2026-06-01*
