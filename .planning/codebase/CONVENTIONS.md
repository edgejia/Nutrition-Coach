---
last_mapped_commit: df5f989b593d494ac44ce3b004307c1c6ada7bec
---

# Coding Conventions

**Analysis Date:** 2026-06-01

## Naming Patterns

**Files:**
- Use kebab-case for multi-word TypeScript modules and tests. Existing examples referenced by scoped docs include `server/lib/guest-session-resolver.ts`, `client/src/components/ChatPanel.tsx`, `server/routes/chat.ts`, `server/orchestrator/tool-contract.ts`, and `tests/harness/scenarios/provider-auth-failure-localization.ts` in `README.md` and `README-en.md`.
- Use numbered, immutable Drizzle migration files under `drizzle/`: `drizzle/0000_brainy_rocket_racer.sql` through `drizzle/0008_shiny_stellaris.sql`.
- Keep migration snapshot names aligned with migration sequence numbers in `drizzle/meta/`: `drizzle/meta/0008_snapshot.json` corresponds to `drizzle/0008_shiny_stellaris.sql`.
- Use generated Drizzle tag names as migration filenames unless creating a deliberate hand-authored follow-up. The journal in `drizzle/meta/_journal.json` records tags such as `0008_shiny_stellaris`.

**Functions:**
- Use camelCase for commands and code symbols mentioned in documentation: `buildApp()` in `server/app.ts`, `createDb()` in `server/db/client.ts`, and `EventSource` handling in `client/src/sse.ts`.
- Preserve service and route naming from the architecture guide in `README.md`: route modules live under `server/routes/`, domain services under `server/services/`, and orchestrator behavior under `server/orchestrator/`.

**Variables:**
- Use ALL_CAPS for environment variable names in docs and config examples: `OPENAI_API_KEY`, `OPENAI_ORCHESTRATOR_MODEL`, `PORT`, `DB_PATH`, `TZ`, `NODE_ENV`, `GUEST_SESSION_SECRET`, `ASSETS_DIR`, `UPLOADS_STAGING_DIR`, and `CLIENT_DIST_DIR` in `README.md` and `README-en.md`.
- Keep migration table, column, index, and constraint names snake_case in SQL: `chat_mutation_outcomes`, `assistant_message_id`, `chat_mutation_outcomes_action_check`, and `chat_mutation_outcomes_device_action_date_idx` in `drizzle/0008_shiny_stellaris.sql`.
- Use explicit owner and identity field names for persisted ownership boundaries: `device_id`, `owner_type`, `owner_id`, and `asset_id` in `drizzle/0002_meal_transaction_v2_foundation.sql`.

**Types:**
- TypeScript types remain PascalCase by established repo convention. Scoped docs reference type-owning modules such as `server/orchestrator/tool-contract.ts`, `server/llm/errors.ts`, and `server/observability/events.ts`.
- SQL literals that encode domain states should stay constrained close to the migration that introduces them. Example: `chat_mutation_outcomes.action` is constrained to `log_food`, `update_meal`, `delete_meal`, and `update_goals` in `drizzle/0008_shiny_stellaris.sql`.

## Code Style

**Formatting:**
- No Prettier, Biome, or ESLint configuration is present in the scoped paths. Maintain the existing repo style documented by current maps: two-space TypeScript indentation, semicolons, double quotes, and trailing commas for multiline literals.
- SQL migrations use tab-indented column definitions and explicit `--> statement-breakpoint` separators, as shown in `drizzle/0002_meal_transaction_v2_foundation.sql` and `drizzle/0008_shiny_stellaris.sql`.
- README command examples use fenced `bash` blocks and concise prose. Keep bilingual docs aligned between `README.md` and `README-en.md` when changing public setup, commands, environment variables, deployment, or test guidance.
- Changelog entries use Traditional Chinese headings and section structure in `CHANGELOG.md`: version heading, `### 新增`, `### 變更`, and `### 驗證`.

**Linting:**
- Not detected in scoped paths. Quality checks are command-driven rather than linter-driven.
- Use `yarn tsc --noEmit` as the primary TypeScript static gate; it is listed in `README.md`, `README-en.md`, and AGENTS guidance.
- Do not introduce Jest, Vitest, ESLint, Prettier, or formatter-only churn without an explicit migration. `yarn.lock` confirms `typescript`, `tsx`, Drizzle, Fastify, Vite, and OpenAI packages, but no Jest or Vitest test framework entries are required by the current documented workflow.

## Import Organization

**Order:**
1. Node and external runtime imports first in source files, following existing map guidance.
2. Local runtime imports next, using explicit `.js` specifiers for TypeScript ESM.
3. Type-only imports use `import type` and stay near related runtime imports.
4. Dynamic imports are acceptable where runtime ordering matters, especially `TZ=Asia/Taipei` boot behavior.

**Path Aliases:**
- Not detected from scoped files. Continue using relative imports with explicit `.js` specifiers for local TypeScript modules.
- The repo is deployed as ESM TypeScript. `Dockerfile` builds with `yarn build` and starts with `yarn start`, so source changes must remain compatible with the existing ESM build path.

## Error Handling

**Patterns:**
- Keep public failure documentation metadata-only. `README.md`, `README-en.md`, and `CHANGELOG.md` repeatedly state that hard LLM/chat failure localization uses redacted metadata and must not persist raw prompts, user text, provider bodies, image data, session material, or database snapshots.
- Treat guest-session and asset ownership as boundary-sensitive. Scoped docs point to `server/lib/guest-session-resolver.ts`, `server/routes/device.ts`, and SQL ownership tables in `drizzle/0002_meal_transaction_v2_foundation.sql`.
- For migrations, prefer explicit constraints and indexes rather than relying on application-only validation. Examples: `chat_mutation_outcomes_action_check` and indexes in `drizzle/0008_shiny_stellaris.sql`.

## Logging

**Framework:** Fastify/Pino for runtime logging; console output for scripts and command-line gates.

**Patterns:**
- Runtime and artifact logs must stay metadata-only. `CHANGELOG.md` v2.2 through v2.4 records this as a release invariant for LLM traces, provider failures, and release proof.
- Generated verification evidence should record command/file/status metadata, not raw user-visible or provider payload content. This is called out in `CHANGELOG.md`.
- Docker builds exclude tests and planning/local notes through `.dockerignore`, so deployment logging and runtime observability must not depend on `.planning/`, `docs/`, or `tests/` being present in the image.

## Comments

**When to Comment:**
- Comment migration intent only when SQL is not self-evident, especially backfills and ownership boundaries. `drizzle/0002_meal_transaction_v2_foundation.sql` uses readable SQL structure instead of inline commentary for backfill behavior.
- In README files, keep explanations user-facing and operational. `README.md` and `README-en.md` explain what the command does before listing shell commands.
- Avoid adding comments to generated Drizzle snapshots under `drizzle/meta/`; treat those JSON files as generated schema state.

**JSDoc/TSDoc:**
- Not applicable in the scoped files. Existing TypeScript guidance from prior maps remains: use targeted JSDoc for reusable test fixtures, CLI runners, and non-obvious public helpers.

## Function Design

**Size:** Keep route, service, and orchestrator behavior in the owning modules documented by `README.md`: `server/routes/chat.ts`, `server/services/*`, and `server/orchestrator/*`.

**Parameters:** Prefer explicit environment and deployment configuration names in docs. `README.md` and `README-en.md` list `PORT`, `DB_PATH`, `TZ`, `ASSETS_DIR`, `UPLOADS_STAGING_DIR`, and `CLIENT_DIST_DIR` with their purposes.

**Return Values:** Use structured results for boundary behavior. `CHANGELOG.md` v2.4 notes structured tool results for `find_meals`, historical `log_food`, and historical `get_daily_summary`; keep future changes aligned with that pattern.

## Module Design

**Exports:** Preserve direct ownership by file. Scoped docs direct readers to concrete files such as `server/routes/chat.ts`, `server/orchestrator/tools.ts`, `server/orchestrator/mutation-effects.ts`, `client/src/store.ts`, and `client/src/sse.ts`.

**Barrel Files:** Not detected in scoped paths. Continue importing from owning files rather than adding broad central barrels.

**Generated and Ignored Files:**
- Do not hand-edit generated or local evidence directories ignored by `.gitignore`: `.planning/`, `tests/harness/artifacts/`, `tests/harness/tmp/`, `dist/`, `output/`, `data/*`, `server/uploads/`, and local database files.
- Do not read or commit secret-bearing files. `.gitignore` and `.dockerignore` exclude `.env` and `.env.*` while preserving `!.env.example`.
- Docker context excludes `tests`, `docs`, `.planning`, `.codex`, `.claude`, `.worktrees`, local notes, logs, databases, and browser/tool cache through `.dockerignore`. Production code must not require those paths at runtime.

## Architecture Constraints From Local Skills

- Use `yarn` only. README setup, Dockerfile install, and release commands all use Yarn: `README.md`, `README-en.md`, and `Dockerfile`.
- Preserve `TZ=Asia/Taipei` for daily nutrition boundaries. It is documented as a required core variable in `README.md` and `README-en.md`.
- Keep local development and production startup separate: local dev uses `yarn dev:server` and `yarn dev:client`; Docker production runs `yarn db:migrate && yarn start` in `Dockerfile`.
- Keep tests and harness artifacts outside Docker production images. `.dockerignore` excludes `tests`, while `.gitignore` excludes generated harness artifacts.

---

*Convention analysis: 2026-06-01*
