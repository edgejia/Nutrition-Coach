---
last_mapped_commit: 782a04005f8f328f7f86ac589eb1253060471b5f
---

# Coding Conventions

**Analysis Date:** 2026-06-01

## Naming Patterns

**Files:**
- Use kebab-case for executable Node scripts under `scripts/`: `scripts/run-node-with-tz.mjs`, `scripts/release-check.mjs`, `scripts/generate-capability-matrix-doc.mjs`, `scripts/generate-behavior-matrix-doc.mjs`, and `scripts/phase45-mobile-evidence.mjs`.
- Use numbered immutable Drizzle migration files under `drizzle/`: `drizzle/0000_brainy_rocket_racer.sql` through `drizzle/0008_shiny_stellaris.sql`.
- Keep generated Drizzle snapshot names aligned with migration sequence numbers in `drizzle/meta/`: `drizzle/meta/0008_snapshot.json` corresponds to `drizzle/0008_shiny_stellaris.sql`.
- Preserve generated Drizzle tag names recorded in `drizzle/meta/_journal.json`, such as `0008_shiny_stellaris`.

**Functions:**
- Use camelCase for JavaScript helpers in scoped scripts: `escapeCell`, `renderReferenceList`, `renderMarkdown`, and `riskDistributionRows` in `scripts/generate-capability-matrix-doc.mjs` and `scripts/generate-behavior-matrix-doc.mjs`.
- Keep side-effect entrypoint code at the bottom of `.mjs` scripts after helper definitions, as in `scripts/release-check.mjs` and `scripts/generate-capability-matrix-doc.mjs`.
- Use explicit verb names for command helpers: `runGit`, `readGitLines`, `resolveBaseRef`, `collectChangedFiles`, `runStep`, and `validateTimezoneContract` in `scripts/release-check.mjs`.

**Variables:**
- Use ALL_CAPS for environment variables and constants that represent process-level configuration: `OPENAI_API_KEY`, `OPENAI_ORCHESTRATOR_MODEL`, `PORT`, `DB_PATH`, `TZ`, `NODE_ENV`, `GUEST_SESSION_SECRET`, `ASSETS_DIR`, `UPLOADS_STAGING_DIR`, and `CLIENT_DIST_DIR` in `.env.example`; `REQUIRED_TZ`, `YARN_BIN`, `DRY_RUN_FLAG`, `OUTPUT_PATH`, `SOURCE_PATH`, and `CHECK_FLAG` in `scripts/*.mjs`.
- Use camelCase for local script variables: `baseInfo`, `changedFiles`, `touchesServerBoundary`, `nextContent`, `currentContent`, and `expectedFailureCount` in `scripts/release-check.mjs` and generator scripts.
- Use snake_case for SQL table, column, index, and constraint names: `chat_mutation_outcomes`, `assistant_message_id`, `chat_mutation_outcomes_action_check`, and `chat_mutation_outcomes_device_action_date_idx` in `drizzle/0008_shiny_stellaris.sql`.
- Use explicit ownership and identity names in migrations: `device_id`, `owner_type`, `owner_id`, and `asset_id` in `drizzle/0002_meal_transaction_v2_foundation.sql`.

**Types:**
- TypeScript is strict and ESM-oriented in `tsconfig.json`; future TypeScript code included by `tsconfig.json` should keep explicit types at module boundaries and satisfy `strict: true`.
- Imported TypeScript data used by scripts should expose named values that describe their domain: `capabilityMatrix` from `client/src/contracts/capability-matrix.ts` in `scripts/generate-capability-matrix-doc.mjs` and `BEHAVIOR_MATRIX_CASES` from `tests/harness/behavior-matrix.ts` in `scripts/generate-behavior-matrix-doc.mjs`.
- SQL literals that encode domain states should stay constrained in migrations. `chat_mutation_outcomes.action` is constrained to `log_food`, `update_meal`, `delete_meal`, and `update_goals` in `drizzle/0008_shiny_stellaris.sql`.

## Code Style

**Formatting:**
- No Prettier, Biome, or ESLint configuration is present in the scoped paths. Preserve the observed style: two-space JavaScript/TypeScript indentation, semicolons, double quotes, and trailing commas in multiline literals.
- Keep scoped scripts as ESM `.mjs` files with a shebang when directly executable, as in `scripts/run-node-with-tz.mjs` and `scripts/release-check.mjs`.
- Use Node built-in module specifiers with the `node:` prefix: `node:child_process`, `node:process`, and `node:fs/promises` in `scripts/*.mjs`.
- SQL migrations use tab-indented column definitions and explicit `--> statement-breakpoint` separators, as shown in `drizzle/0002_meal_transaction_v2_foundation.sql` and `drizzle/0008_shiny_stellaris.sql`.
- Changelog entries use Traditional Chinese headings and section structure in `CHANGELOG.md`: version heading, `### 新增`, `### 變更`, and `### 驗證`.

**Linting:**
- Not detected in scoped paths. Quality checks are command-driven through `package.json` scripts rather than a linter config.
- Use `yarn tsc --noEmit` as the primary TypeScript static gate; it is defined by the `typescript` dependency and referenced by `scripts/release-check.mjs`.
- Do not introduce Jest, Vitest, ESLint, Prettier, or formatter-only churn without an explicit migration. `package.json` uses Node's test runner scripts and has no Jest/Vitest dependencies.

## Import Organization

**Order:**
1. Node built-ins first, using `node:` specifiers as in `scripts/release-check.mjs`.
2. External package imports next, as in `drizzle.config.ts` importing `defineConfig` from `drizzle-kit`.
3. Local TypeScript/data imports last, using explicit relative paths and extensions as in `scripts/generate-capability-matrix-doc.mjs` and `scripts/generate-behavior-matrix-doc.mjs`.

**Path Aliases:**
- Not detected in scoped files. `tsconfig.json` does not define `paths`; use relative imports.
- Local TypeScript imports from `.mjs` scripts may include `.ts` extensions when executed through `node --import tsx`, as in `scripts/generate-capability-matrix-doc.mjs`.

## Error Handling

**Patterns:**
- CLI scripts should fail closed with non-zero exits. `scripts/run-node-with-tz.mjs` exits with the child process status or `1`; `scripts/release-check.mjs` exits immediately when a verification step fails.
- Use narrow `try`/`catch` blocks for expected optional git state. `scripts/release-check.mjs` catches failed git commands in `readGitLines`, `hasGitRef`, and `resolveBaseRef`, then falls back to available refs or working-tree changes.
- Check-mode generators should compare generated output exactly and exit `1` with a clear message when files are stale. This pattern is used in `scripts/generate-capability-matrix-doc.mjs` and `scripts/generate-behavior-matrix-doc.mjs`.
- Migrations should encode data integrity directly with constraints, foreign keys, unique indexes, and filtered indexes. Examples include `chat_mutation_outcomes_action_check` in `drizzle/0008_shiny_stellaris.sql` and `asset_refs_owner_uq` in `drizzle/0002_meal_transaction_v2_foundation.sql`.
- Runtime configuration examples must use placeholders only. `.env.example` documents required keys without storing real secret values.

## Logging

**Framework:** `console` for scoped scripts.

**Patterns:**
- Prefix release-gate output with `[release-check]` in `scripts/release-check.mjs`.
- Log high-signal command state: diff base, number of changed files, timezone contract, step labels, and final pass/fail in `scripts/release-check.mjs`.
- Generator scripts should stay quiet on success and print only actionable stale-file errors in `--check` mode, as in `scripts/generate-capability-matrix-doc.mjs` and `scripts/generate-behavior-matrix-doc.mjs`.
- Changelog verification notes should record commands, status, and privacy boundaries without embedding raw prompts, provider bodies, image data, session material, or database snapshots, following `CHANGELOG.md`.

## Comments

**When to Comment:**
- Use comments in `.env.example` to explain operationally important configuration, such as the `TZ=Asia/Taipei` day-boundary contract and optional deployment overrides.
- Prefer self-documenting helper names in scripts over inline comments; `scripts/release-check.mjs` and generator scripts are mostly comment-free.
- Avoid adding comments to generated Drizzle snapshots under `drizzle/meta/`; treat `drizzle/meta/*.json` as generated schema state.

**JSDoc/TSDoc:**
- Not detected in scoped files. Continue using direct function names and plain script structure for scoped `.mjs` utilities.

## Function Design

**Size:** Keep script helpers small and single-purpose. `scripts/release-check.mjs` separates git access, base-ref resolution, changed-file collection, timezone validation, and Yarn step execution.

**Parameters:** Prefer explicit parameters over process globals inside helpers where practical. `runGit(args)`, `readGitLines(args)`, `resolveBaseRef(argv)`, and `runStep(label, args)` in `scripts/release-check.mjs` take the data they operate on.

**Return Values:** Return structured values when downstream logic needs multiple fields. `resolveBaseRef(argv)` returns `{ ref, mergeBase }` or `null` in `scripts/release-check.mjs`; `renderMarkdown()` returns complete deterministic Markdown strings in generator scripts.

## Module Design

**Exports:** Scoped scripts are executable modules and do not export public APIs. Keep reusable script behavior local unless another scoped command needs it.

**Barrel Files:** Not detected in scoped paths. Do not add barrel files for `scripts/` or `drizzle/`.

**Generated and Ignored Files:**
- Treat `drizzle/meta/*.json` and `drizzle/meta/_journal.json` as Drizzle-generated schema state; update them through `yarn db:generate` from `package.json`.
- `scripts/generate-capability-matrix-doc.mjs` writes `docs/capability-matrix.md` from `client/src/contracts/capability-matrix.ts`; use `yarn matrix:gen:check` to verify it.
- `scripts/generate-behavior-matrix-doc.mjs` writes `tests/harness/behavior-matrix.md` from `tests/harness/behavior-matrix.ts`; use `yarn behavior-matrix:gen:check` to verify it.
- Do not read or commit secret-bearing env files. `.env.example` is safe template content; real `.env` files are outside this mapping scope and must remain private.

## Architecture Constraints From Local Skills

- Use `yarn` only. `package.json` defines all scoped commands through Yarn-compatible scripts.
- Preserve `TZ=Asia/Taipei`. `.env.example`, `scripts/run-node-with-tz.mjs`, and `scripts/release-check.mjs` all enforce or document this contract.
- Use Node built-in `node:test` rather than Jest/Vitest. `package.json` test scripts call `node scripts/run-node-with-tz.mjs --import tsx --test ...`.
- Keep SQLite migrations under Drizzle control. `drizzle.config.ts` outputs to `./drizzle` and reads `DB_PATH` with a local default.

---

*Convention analysis: 2026-06-01*
