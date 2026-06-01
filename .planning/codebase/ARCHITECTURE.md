<!-- refreshed: 2026-06-01 -->
<!-- last_mapped_commit: 782a04005f8f328f7f86ac589eb1253060471b5f -->
# Architecture

**Analysis Date:** 2026-06-01

**Scope:** Incremental remap limited to `.env.example`, `CHANGELOG.md`, `drizzle/`, `drizzle.config.ts`, `package.json`, `scripts/`, and `tsconfig.json`.

## System Overview

```text
┌─────────────────────────────────────────────────────────────┐
│                Project command and config layer              │
│ `package.json`, `tsconfig.json`, `.env.example`              │
└───────────────┬───────────────────────────────┬─────────────┘
                │                               │
                ▼                               ▼
┌───────────────────────────────┐   ┌─────────────────────────┐
│  Verification and evidence CLI │   │  Drizzle migration CLI  │
│  `scripts/*.mjs`               │   │  `drizzle.config.ts`    │
└───────────────┬───────────────┘   └────────────┬────────────┘
                │                                │
                ▼                                ▼
┌─────────────────────────────────────────────────────────────┐
│             Generated documents and SQLite schema            │
│ `docs/*`, `tests/harness/*`, `drizzle/*.sql`                 │
└─────────────────────────────────────────────────────────────┘
```

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| Package command registry | Defines all repo-visible dev, build, migration, verification, matrix, and release commands | `package.json` |
| TypeScript compiler boundary | Compiles server, tests, client source, and Vite config as strict ESM TypeScript | `tsconfig.json` |
| Environment contract | Documents required and optional runtime variables without storing real secrets | `.env.example` |
| Drizzle Kit config | Points Drizzle generation at the server schema, SQLite dialect, migration output folder, and default DB path | `drizzle.config.ts` |
| Migration history | Stores replayable SQLite schema evolution and Drizzle snapshots | `drizzle/*.sql`, `drizzle/meta/*.json` |
| Timezone runner | Forces command execution under the project day-boundary timezone | `scripts/run-node-with-tz.mjs` |
| Release gate | Runs timezone validation, TypeScript, tests, and frontend build for promotion readiness | `scripts/release-check.mjs` |
| Capability matrix generator | Renders docs from the client capability matrix source and supports sync checking | `scripts/generate-capability-matrix-doc.mjs` |
| Behavior matrix generator | Renders harness behavior matrix docs and supports sync checking | `scripts/generate-behavior-matrix-doc.mjs` |
| Mobile evidence capture | Uses a real browser CDP session to capture mobile surface screenshots and audit JSON | `scripts/phase45-mobile-evidence.mjs` |
| Product history | Records milestone behavior, architecture, privacy, and verification contracts that guide scoped architecture decisions | `CHANGELOG.md` |

## Pattern Overview

**Overall:** Script-orchestrated TypeScript monolith with Drizzle-managed SQLite migrations, strict ESM compilation, repo-native release gates, generated documentation matrices, and metadata-only verification evidence.

**Key Characteristics:**
- Use `yarn` scripts in `package.json` as the public command surface. Do not add parallel `npm` workflows.
- Keep TypeScript as ESM with `"type": "module"` in `package.json` and `module` / `target` set to `ES2022` in `tsconfig.json`.
- Generate database migrations through Drizzle Kit using `drizzle.config.ts`; commit both `drizzle/*.sql` and `drizzle/meta/*.json`.
- Preserve `TZ=Asia/Taipei` through `scripts/run-node-with-tz.mjs`; `scripts/release-check.mjs` fails if the timezone contract is missing.
- Treat matrix markdown as generated output from typed sources. Use the script `--check` mode before committing matrix changes.
- Treat `scripts/phase45-mobile-evidence.mjs` output as operator-run visual evidence using synthetic in-browser data, not production data.

## Layers

**Command Layer:**
- Purpose: Provide one stable interface for development, migration, build, test, harness, matrix, and release workflows.
- Location: `package.json`.
- Contains: `dev:server`, `dev:client`, `build`, `db:generate`, `db:migrate`, `test`, `test:unit`, `test:integration`, `verify:harness`, matrix generation/check scripts, and `release:check`.
- Depends on: `node`, `yarn`, `tsx`, `vite`, `drizzle-kit`, and project scripts under `scripts/`.
- Used by: Developers, GSD verification workflows, local release checks, and deployment/promotion procedures.

**Compiler and Runtime Contract Layer:**
- Purpose: Keep source compiled under strict TypeScript and explicit ESM assumptions.
- Location: `tsconfig.json`, `package.json`.
- Contains: `strict: true`, `moduleResolution: "bundler"`, `jsx: "react-jsx"`, `resolveJsonModule: true`, `declaration: true`, and include globs for `server/**/*.ts`, `tests/**/*.ts`, `client/src/**/*.ts`, `client/src/**/*.tsx`, and `client/vite.config.ts`.
- Depends on: TypeScript `^5.7.0` and `tsx`.
- Used by: `yarn tsc --noEmit`, `yarn test*`, `yarn verify:harness`, matrix generators, and development commands.

**Environment Configuration Layer:**
- Purpose: Define safe, documented runtime inputs without committing real secrets.
- Location: `.env.example`.
- Contains: `OPENAI_API_KEY`, `OPENAI_ORCHESTRATOR_MODEL`, `PORT`, `DB_PATH`, `TZ`, and optional deployment overrides for `NODE_ENV`, `GUEST_SESSION_SECRET`, `ASSETS_DIR`, `UPLOADS_STAGING_DIR`, and `CLIENT_DIST_DIR`.
- Depends on: Consumers loading `.env` through `node --env-file=.env` in `package.json` scripts.
- Used by: `yarn dev:server`, `yarn release:check`, `yarn db:migrate`, and production-like server startup.

**Persistence Migration Layer:**
- Purpose: Persist product state in SQLite through source-controlled schema evolution.
- Location: `drizzle/`, `drizzle.config.ts`.
- Contains: SQL migrations `drizzle/0000_brainy_rocket_racer.sql` through `drizzle/0008_shiny_stellaris.sql`, snapshots `drizzle/meta/0000_snapshot.json` through `drizzle/meta/0008_snapshot.json`, and journal `drizzle/meta/_journal.json`.
- Depends on: Drizzle Kit configured in `drizzle.config.ts`, `drizzle-orm`, and `better-sqlite3`.
- Used by: `yarn db:generate` and `yarn db:migrate`.

**Verification Script Layer:**
- Purpose: Run deterministic local quality gates and release checks with the correct timezone.
- Location: `scripts/run-node-with-tz.mjs`, `scripts/release-check.mjs`.
- Contains: A timezone wrapper and a release workflow that gathers changed files, resolves a git diff base, validates `TZ=Asia/Taipei`, then runs `yarn tsc --noEmit`, `yarn test`, and `yarn build`.
- Depends on: Git, Yarn, Node child processes, and the scripts in `package.json`.
- Used by: `yarn test`, `yarn test:unit`, `yarn test:integration`, `yarn verify:harness`, and `yarn release:check`.

**Generated Documentation Layer:**
- Purpose: Render machine-checkable markdown documentation from typed sources.
- Location: `scripts/generate-capability-matrix-doc.mjs`, `scripts/generate-behavior-matrix-doc.mjs`.
- Contains: Markdown renderers with `--check` modes for `docs/capability-matrix.md` and `tests/harness/behavior-matrix.md`.
- Depends on: `client/src/contracts/capability-matrix.ts` and `tests/harness/behavior-matrix.ts`.
- Used by: `yarn matrix:gen`, `yarn matrix:gen:check`, `yarn matrix:check`, `yarn behavior-matrix:gen`, and `yarn behavior-matrix:gen:check`.

**Visual Evidence Layer:**
- Purpose: Capture mobile viewport evidence against a reachable app using a real browser and synthetic state.
- Location: `scripts/phase45-mobile-evidence.mjs`.
- Contains: Browser discovery, CDP launch/session control, synthetic API/store state injection, viewport screenshots, screenshot byte validation, layout audit checks, manifest output, and visual audit JSON output.
- Depends on: Microsoft Edge or Google Chrome, a reachable Vite dev URL that can import `/src/store.ts`, and local filesystem output under `output/playwright/`.
- Used by: Operator-run mobile visual audits.

## Data Flow

### Database Migration Path

1. Schema changes are authored in the server schema source referenced by `drizzle.config.ts` at `./server/db/schema.ts`.
2. `yarn db:generate` in `package.json` invokes `drizzle-kit generate --config=drizzle.config.ts`.
3. Drizzle writes SQL migrations under `drizzle/` and metadata under `drizzle/meta/`.
4. `yarn db:migrate` in `package.json` runs the server migration runner with `node --import tsx server/db/migrate.ts`.
5. The configured SQLite path defaults to `process.env.DB_PATH ?? "./data/nutrition.db"` in `drizzle.config.ts`.

### Release Verification Path

1. `yarn release:check` in `package.json` runs `node scripts/run-node-with-tz.mjs --env-file=.env scripts/release-check.mjs`.
2. `scripts/run-node-with-tz.mjs` spawns the requested Node process with `TZ=Asia/Taipei`.
3. `scripts/release-check.mjs` resolves a base ref from `--base=...`, the first positional arg, `origin/main`, or `main`.
4. `scripts/release-check.mjs` collects changed tracked, staged, and untracked files, then validates that `process.env.TZ` is exactly `Asia/Taipei`.
5. Unless `--dry-run` is present, `scripts/release-check.mjs` runs `yarn tsc --noEmit`, `yarn test`, and `yarn build`.
6. If changed files include `server/routes/` or `server/services/`, `scripts/release-check.mjs` prints a note that `yarn test` includes integration coverage.

### Test Command Path

1. `yarn test`, `yarn test:unit`, `yarn test:integration`, and `yarn verify:harness` in `package.json` all enter through `scripts/run-node-with-tz.mjs`.
2. The wrapper sets `TZ=Asia/Taipei` and delegates to Node with `--import tsx`.
3. Unit and integration scripts use the Node built-in test runner via `--test`.
4. Harness verification runs `tests/harness/run.ts` with any scenario args supplied after `yarn verify:harness --`.

### Generated Matrix Path

1. `yarn matrix:gen` imports `capabilityMatrix` from `client/src/contracts/capability-matrix.ts` in `scripts/generate-capability-matrix-doc.mjs`.
2. The generator sorts rows by surface and affordance, escapes markdown table cells, and writes `docs/capability-matrix.md`.
3. `yarn matrix:gen:check` compares rendered output to the current markdown and exits nonzero on drift.
4. `yarn matrix:check` runs source-scan/unit contracts and then `yarn matrix:gen:check`.
5. `yarn behavior-matrix:gen` imports `BEHAVIOR_MATRIX_CASES` from `tests/harness/behavior-matrix.ts` in `scripts/generate-behavior-matrix-doc.mjs`.
6. The behavior generator writes cases, risk distribution, assertion coverage, and expected failures to `tests/harness/behavior-matrix.md`; `--check` enforces sync.

### Mobile Evidence Path

1. An operator runs `node scripts/phase45-mobile-evidence.mjs --base-url http://127.0.0.1:5173`.
2. The script requires a reachable base URL and an installed Microsoft Edge or Google Chrome binary.
3. The script launches a headless browser with remote debugging, injects synthetic API responses and Zustand store state, and captures predefined surfaces across mobile viewports.
4. Each screenshot must exceed `10000` bytes and pass a byte-diversity check.
5. Layout audits reject horizontal overflow and too-little rendered text.
6. The script writes PNGs, `phase45-manifest.json`, and `phase45-visual-audit.json` under the configured output directory.

**State Management:**
- Durable schema state is represented by `drizzle/*.sql` and `drizzle/meta/*.json`.
- Runtime database path is controlled by `DB_PATH` from `.env.example` and `drizzle.config.ts`.
- Command execution state is transient except generated documentation and visual evidence output.
- `scripts/phase45-mobile-evidence.mjs` uses synthetic browser-local state and does not read `.env`, raw database files, private logs, or production user data.

## Key Abstractions

**Yarn Script Surface:**
- Purpose: Keep developer and workflow commands discoverable and consistent.
- Examples: `package.json`.
- Pattern: Add new repo commands under `scripts` and compose them from existing script wrappers when timezone or TypeScript loading matters.

**Timezone Wrapper:**
- Purpose: Centralize `TZ=Asia/Taipei` for tests, harnesses, and release checks.
- Examples: `scripts/run-node-with-tz.mjs`, `scripts/release-check.mjs`.
- Pattern: Run Node-based tests and harnesses through `scripts/run-node-with-tz.mjs`; fail release if the timezone is missing or wrong.

**Drizzle Migration Set:**
- Purpose: Make SQLite schema evolution replayable and reviewable.
- Examples: `drizzle/0000_brainy_rocket_racer.sql`, `drizzle/0008_shiny_stellaris.sql`, `drizzle/meta/_journal.json`.
- Pattern: Generated SQL plus matching snapshots are committed; runtime database files are not the source of truth.

**Revisioned Meal Persistence:**
- Purpose: Preserve meal identity and immutable revisions for edits, deletes, and receipts.
- Examples: `drizzle/0002_meal_transaction_v2_foundation.sql`, `drizzle/0007_violet_living_lightning.sql`.
- Pattern: `meal_transactions` stores identity/current revision; `meal_revisions` and `meal_revision_items` store versioned content; `meal_period` stores explicit meal-period intent.

**Chat Mutation Audit Records:**
- Purpose: Attach structured mutation outcomes to assistant messages.
- Examples: `drizzle/0006_colossal_selene.sql`, `drizzle/0008_shiny_stellaris.sql`.
- Pattern: Store unique assistant-message receipts/outcomes indexed by device and action/date.

**Generated Matrix Docs:**
- Purpose: Make product capability and behavior coverage auditable without hand-maintaining tables.
- Examples: `scripts/generate-capability-matrix-doc.mjs`, `scripts/generate-behavior-matrix-doc.mjs`.
- Pattern: Source arrays are authoritative; markdown is rendered and checked for drift.

**Synthetic Visual Evidence Harness:**
- Purpose: Capture mobile UI proof without using production data.
- Examples: `scripts/phase45-mobile-evidence.mjs`.
- Pattern: Inject synthetic API/store state, capture fixed surfaces/viewports, reject blank/overflowing output, and write manifest/audit evidence.

## Entry Points

**Local Backend Development:**
- Location: `package.json`
- Triggers: `yarn dev:server`
- Responsibilities: Run `server/index.ts` with `.env`, `tsx`, and watch mode.

**Local Client Development:**
- Location: `package.json`
- Triggers: `yarn dev:client`
- Responsibilities: Run Vite using `client/vite.config.ts`.

**Production Build:**
- Location: `package.json`
- Triggers: `yarn build`
- Responsibilities: Build the client bundle using Vite config under `client/`.

**Database Generation:**
- Location: `package.json`, `drizzle.config.ts`
- Triggers: `yarn db:generate`
- Responsibilities: Generate SQLite migrations under `drizzle/` from the configured server schema.

**Database Migration:**
- Location: `package.json`
- Triggers: `yarn db:migrate`
- Responsibilities: Run `server/db/migrate.ts` through `tsx`.

**Release Gate:**
- Location: `scripts/release-check.mjs`
- Triggers: `yarn release:check`
- Responsibilities: Validate timezone, run TypeScript, run full tests, and build the frontend.

**Capability Matrix Gate:**
- Location: `scripts/generate-capability-matrix-doc.mjs`
- Triggers: `yarn matrix:gen`, `yarn matrix:gen:check`, `yarn matrix:check`
- Responsibilities: Generate/check `docs/capability-matrix.md` from typed capability data.

**Behavior Matrix Gate:**
- Location: `scripts/generate-behavior-matrix-doc.mjs`
- Triggers: `yarn behavior-matrix:gen`, `yarn behavior-matrix:gen:check`
- Responsibilities: Generate/check `tests/harness/behavior-matrix.md` from typed harness behavior cases.

**Mobile Evidence Capture:**
- Location: `scripts/phase45-mobile-evidence.mjs`
- Triggers: `node scripts/phase45-mobile-evidence.mjs --base-url <url>`
- Responsibilities: Capture mobile screenshots and JSON audit evidence using synthetic data.

## Architectural Constraints

- **Threading:** Scoped scripts run as single Node processes and delegate subprocesses through `spawnSync`, `spawn`, or browser CDP. No worker thread architecture is present in the scoped files.
- **Global state:** `scripts/run-node-with-tz.mjs` intentionally mutates child process environment by setting `TZ=Asia/Taipei`; `scripts/phase45-mobile-evidence.mjs` intentionally writes browser-local synthetic state for capture setup.
- **Circular imports:** Not detected in the scoped files; source trees outside the specified prefixes were not scanned.
- **ESM:** `package.json` sets `"type": "module"` and all scoped scripts use ESM `import` syntax.
- **Timezone:** `scripts/release-check.mjs` must see `TZ=Asia/Taipei`; run tests, harnesses, and release checks through `scripts/run-node-with-tz.mjs`.
- **Secrets:** `.env.example` is safe documentation. Do not read real `.env` files or commit real secret values.
- **Persistence:** `drizzle.config.ts` defaults to `./data/nutrition.db`; schema changes must flow through Drizzle migrations, not direct runtime DB edits.
- **Evidence privacy:** `CHANGELOG.md` and `scripts/phase45-mobile-evidence.mjs` preserve metadata-only or synthetic-data evidence practices.

## Anti-Patterns

### Bypassing Yarn Scripts

**What happens:** Tests, harnesses, matrix checks, or release gates are run through ad hoc commands that omit the wrapper or script composition.
**Why it's wrong:** `package.json` centralizes the expected command graph, and several commands rely on `scripts/run-node-with-tz.mjs` for `TZ=Asia/Taipei`.
**Do this instead:** Add or invoke commands through `package.json`; use `scripts/run-node-with-tz.mjs` for Node tests and harnesses that depend on day boundaries.

### Hand-Editing Generated Matrix Markdown

**What happens:** `docs/capability-matrix.md` or `tests/harness/behavior-matrix.md` is edited directly.
**Why it's wrong:** `scripts/generate-capability-matrix-doc.mjs` and `scripts/generate-behavior-matrix-doc.mjs` treat typed sources as authoritative and provide `--check` drift detection.
**Do this instead:** Change `client/src/contracts/capability-matrix.ts` or `tests/harness/behavior-matrix.ts`, then run the matching generator from `package.json`.

### Skipping Drizzle Metadata

**What happens:** A migration SQL file is committed without the matching `drizzle/meta/*.json` snapshot or journal entry.
**Why it's wrong:** `drizzle/meta/_journal.json` is the ordered migration source for Drizzle replay.
**Do this instead:** Generate migrations with `yarn db:generate` so `drizzle/*.sql`, `drizzle/meta/*_snapshot.json`, and `drizzle/meta/_journal.json` stay aligned.

### Treating Visual Evidence as Production Data Capture

**What happens:** Mobile screenshots are captured with real user data, production DB snapshots, private logs, or `.env` material.
**Why it's wrong:** `scripts/phase45-mobile-evidence.mjs` explicitly injects synthetic API/store data and writes a privacy policy into the manifest.
**Do this instead:** Use a local reachable app URL and the script's synthetic state path; keep outputs under the configured evidence directory.

### Weakening Release Timezone Validation

**What happens:** `scripts/release-check.mjs` is run directly without `TZ=Asia/Taipei`, or the timezone check is removed.
**Why it's wrong:** Day-boundary behavior is a product contract documented in `.env.example` and enforced by the release gate.
**Do this instead:** Run `yarn release:check`, `yarn test`, `yarn test:unit`, `yarn test:integration`, and `yarn verify:harness` through the package scripts.

## Error Handling

**Strategy:** Fail fast at script boundaries, keep generated output drift detectable, and preserve privacy-safe evidence.

**Patterns:**
- `scripts/release-check.mjs` exits immediately with a nonzero status when timezone validation or a Yarn gate fails.
- `scripts/run-node-with-tz.mjs` returns the delegated Node process status.
- `scripts/generate-capability-matrix-doc.mjs` and `scripts/generate-behavior-matrix-doc.mjs` exit nonzero when `--check` detects stale markdown.
- `scripts/phase45-mobile-evidence.mjs` throws for missing `--base-url`, unreachable apps, missing browser binaries, blank/undersized screenshots, and horizontal overflow.

## Cross-Cutting Concerns

**Logging:** Scoped scripts use console output for operator-facing progress and failures, including `[release-check]` labels in `scripts/release-check.mjs`.

**Validation:** `scripts/release-check.mjs` validates timezone and command status; matrix generators validate markdown sync; `scripts/phase45-mobile-evidence.mjs` validates reachability, browser availability, viewport rendering, screenshot size, byte diversity, and horizontal overflow.

**Authentication:** The scoped files only document auth-sensitive environment inputs in `.env.example`, including `OPENAI_API_KEY` and optional `GUEST_SESSION_SECRET`; implementation files outside the requested paths were not scanned.

**Persistence:** Drizzle migration files under `drizzle/` are the source-controlled persistence history. `drizzle.config.ts` maps generation to SQLite and the default `DB_PATH`.

**Verification:** Use `package.json` scripts for TypeScript, tests, harnesses, matrix checks, and release readiness. `CHANGELOG.md` records completed milestone proof in metadata-only terms.

---

*Architecture analysis: 2026-06-01*
