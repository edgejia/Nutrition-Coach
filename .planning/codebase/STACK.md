---
last_mapped_commit: 782a04005f8f328f7f86ac589eb1253060471b5f
---

# Technology Stack

**Analysis Date:** 2026-06-01
**Scope:** `.env.example`, `CHANGELOG.md`, `drizzle/`, `drizzle.config.ts`, `package.json`, `scripts/`, `tsconfig.json`

## Languages

**Primary:**
- TypeScript 5.x - Full-stack source is compiled under `tsconfig.json`; scoped includes cover `server/**/*.ts`, `tests/**/*.ts`, `client/src/**/*.ts`, `client/src/**/*.tsx`, and `client/vite.config.ts`. `package.json` declares `typescript` `^5.7.0`.

**Secondary:**
- TSX / React JSX - `tsconfig.json` sets `jsx` to `react-jsx`; `package.json` declares `react` `^19.0.0` and `react-dom` `^19.0.0`.
- JavaScript ESM - `package.json` sets `"type": "module"` and uses ESM `.mjs` operational scripts in `scripts/generate-capability-matrix-doc.mjs`, `scripts/generate-behavior-matrix-doc.mjs`, `scripts/phase45-mobile-evidence.mjs`, `scripts/release-check.mjs`, and `scripts/run-node-with-tz.mjs`.
- SQL - SQLite migrations live in `drizzle/*.sql`; Drizzle metadata snapshots live in `drizzle/meta/*.json`.
- Markdown generation - `scripts/generate-capability-matrix-doc.mjs` writes `docs/capability-matrix.md`; `scripts/generate-behavior-matrix-doc.mjs` writes `tests/harness/behavior-matrix.md`.
- Chinese Markdown release notes - `CHANGELOG.md` records milestone changes, verification, Railway smoke evidence, and release constraints.

## Runtime

**Environment:**
- Node.js ESM runtime - `package.json` scripts run Node directly with `--import tsx` for TypeScript entry points such as `server/index.ts`, `server/db/migrate.ts`, and `tests/harness/run.ts`.
- TypeScript execution - `tsx` `^4.19.0` is declared in `package.json` and is used by `dev:server`, `db:migrate`, `start`, `test`, `test:unit`, `test:integration`, `verify:harness`, and matrix-generation scripts.
- Timezone contract - `.env.example` sets `TZ=Asia/Taipei`; `scripts/run-node-with-tz.mjs` forces `TZ=Asia/Taipei` for test and harness commands; `scripts/release-check.mjs` fails unless runtime `process.env.TZ` is exactly `Asia/Taipei`.
- Local env loading - `package.json` uses `node --env-file=.env` for `dev:server` and `node scripts/run-node-with-tz.mjs --env-file=.env scripts/release-check.mjs` for `release:check`.

**Package Manager:**
- Yarn - All scoped lifecycle scripts in `package.json` are written for Yarn, and `scripts/release-check.mjs` shells out to `yarn` or `yarn.cmd`.
- Lockfile: not in this incremental-remap scope. Do not infer installed resolved versions from scoped files.

## Frameworks

**Core:**
- Fastify `^5.2.0` - API/server framework declared in `package.json`.
- React `^19.0.0` and `react-dom` `^19.0.0` - Client UI dependencies declared in `package.json`.
- Vite `^6.2.0` with `@vitejs/plugin-react` `^4.4.0` - Client dev/build tooling exposed through `package.json` scripts `dev:client` and `build`.
- Tailwind CSS `^4.0.0` with `@tailwindcss/vite` `^4.0.0` - Styling/build integration declared in `package.json`.
- Drizzle ORM `^0.39.0` - SQLite ORM declared in `package.json`; migration generation is configured in `drizzle.config.ts`.
- better-sqlite3 `^11.8.0` - SQLite driver declared in `package.json`.
- Zustand `^5.0.0` - Client state dependency declared in `package.json`.
- Zod `^4.3.6` - Runtime validation dependency declared in `package.json`; `CHANGELOG.md` notes LLM JSON schema and Zod runtime alignment for `log_food` behavior.

**Testing:**
- Node built-in test runner - `package.json` uses `node ... --test` for `test`, `test:unit`, `test:integration`, and `matrix:check`.
- TypeScript test execution - `package.json` routes Node test commands through `scripts/run-node-with-tz.mjs --import tsx`.
- Deterministic harness runner - `package.json` exposes `verify:harness` as `node scripts/run-node-with-tz.mjs --import tsx tests/harness/run.ts`.
- Release verification - `package.json` exposes `release:check`; `scripts/release-check.mjs` runs `yarn tsc --noEmit`, `yarn test`, and `yarn build` after validating timezone.

**Build/Dev:**
- Server watch mode - `package.json` `dev:server` runs `node --env-file=.env --import tsx --watch server/index.ts`.
- Client dev server - `package.json` `dev:client` runs `vite dev --config client/vite.config.ts`.
- Client build - `package.json` `build` runs `vite build --config client/vite.config.ts`.
- Database migration generation - `package.json` `db:generate` runs `drizzle-kit generate --config=drizzle.config.ts`.
- Database migration application - `package.json` `db:migrate` runs `node --import tsx server/db/migrate.ts`.
- Production start command - `package.json` `start` runs `node --import tsx server/index.ts`.
- Matrix generators - `package.json` exposes `matrix:gen`, `matrix:gen:check`, `matrix:check`, `behavior-matrix:gen`, and `behavior-matrix:gen:check`; implementations live in `scripts/generate-capability-matrix-doc.mjs` and `scripts/generate-behavior-matrix-doc.mjs`.

## Key Dependencies

**Critical:**
- `openai` `^4.82.0` - OpenAI SDK dependency declared in `package.json`; `.env.example` requires `OPENAI_API_KEY` and `OPENAI_ORCHESTRATOR_MODEL`.
- `fastify` `^5.2.0` - Backend API runtime declared in `package.json`.
- `@fastify/multipart` `^9.0.0` - Multipart upload support declared in `package.json`.
- `@fastify/static` `^9.1.1` - Static asset/client serving support declared in `package.json`; `.env.example` includes `CLIENT_DIST_DIR`.
- `@fastify/cors` `^11.0.0` - CORS support declared in `package.json`.
- `better-sqlite3` `^11.8.0` - SQLite runtime dependency declared in `package.json`.
- `drizzle-orm` `^0.39.0` - Database abstraction declared in `package.json`; migrations are under `drizzle/`.
- `zod` `^4.3.6` - Runtime validation dependency declared in `package.json`.
- `zustand` `^5.0.0` - Client state management dependency declared in `package.json`.

**Infrastructure:**
- `tsx` `^4.19.0` - TypeScript runtime loader declared in `package.json` and used across server, migration, tests, harness, and generation commands.
- `drizzle-kit` `^0.31.10` - Migration generation tool declared in `package.json` and configured by `drizzle.config.ts`.
- `typescript` `^5.7.0` - Compiler declared in `package.json`; strict settings live in `tsconfig.json`.
- `vite` `^6.2.0`, `@vitejs/plugin-react` `^4.4.0`, `tailwindcss` `^4.0.0`, and `@tailwindcss/vite` `^4.0.0` - Client build stack declared in `package.json`.
- `@types/node` `^22.0.0`, `@types/react` `^19.0.0`, `@types/react-dom` `^19.0.0`, and `@types/better-sqlite3` `^7.6.0` - Type packages declared in `package.json`.

## Configuration

**Environment:**
- `.env.example` is the committed environment template for local/deployed configuration.
- Required values in `.env.example`: `OPENAI_API_KEY`, `OPENAI_ORCHESTRATOR_MODEL`, `PORT`, `DB_PATH`, and `TZ`.
- Optional deployment overrides in `.env.example`: `NODE_ENV`, `GUEST_SESSION_SECRET`, `ASSETS_DIR`, `UPLOADS_STAGING_DIR`, and `CLIENT_DIST_DIR`.
- `drizzle.config.ts` reads `process.env.DB_PATH` and falls back to `./data/nutrition.db`.
- `scripts/release-check.mjs` requires `TZ=Asia/Taipei` before running release gates.
- `scripts/run-node-with-tz.mjs` injects `TZ=Asia/Taipei` for child Node processes.

**Build:**
- TypeScript config: `tsconfig.json` targets `ES2022`, emits ESM, uses `moduleResolution: "bundler"`, enables `strict`, `esModuleInterop`, `resolveJsonModule`, declarations, and React JSX transform.
- Drizzle config: `drizzle.config.ts` sets `dialect: "sqlite"`, `schema: "./server/db/schema.ts"`, and `out: "./drizzle"`.
- Migration artifacts: `drizzle/0000_brainy_rocket_racer.sql` through `drizzle/0008_shiny_stellaris.sql`, with metadata in `drizzle/meta/_journal.json` and `drizzle/meta/0008_snapshot.json`.
- Release gate implementation: `scripts/release-check.mjs` collects changed files from Git, validates timezone, runs `yarn tsc --noEmit`, runs `yarn test`, notes route/service integration relevance, and runs `yarn build`.
- Visual evidence tooling: `scripts/phase45-mobile-evidence.mjs` drives a headless installed Chrome/Edge over CDP, writes screenshots/manifest/audit files, and requires a reachable Vite-style `--base-url`.

## Platform Requirements

**Development:**
- Use Yarn commands from `package.json`; do not use npm for repo workflows.
- Populate `.env` from `.env.example` without committing secret values.
- Keep `TZ=Asia/Taipei`; test, integration, harness, and release commands rely on `scripts/run-node-with-tz.mjs` and `scripts/release-check.mjs`.
- Use `yarn dev:server` for the Fastify/Node server and `yarn dev:client` for the Vite client.
- Use `yarn db:migrate` after setting `DB_PATH`; use `yarn db:generate` when schema changes require a Drizzle migration under `drizzle/`.

**Production:**
- Runtime configuration comes from environment variables represented by `.env.example`.
- SQLite storage is file-based through `DB_PATH`; durable image and staging directories are controlled by `ASSETS_DIR` and `UPLOADS_STAGING_DIR`.
- `NODE_ENV=production` is the deployment mode signal for secure session behavior.
- `CLIENT_DIST_DIR` points Fastify/static serving at the built Vite client directory.
- `CHANGELOG.md` records Railway staging and production smoke history for v2.0 and production smoke evidence for v2.1; v2.4 explicitly records no push, merge, deploy, Railway smoke, staging promotion, or main promotion.

## Project Skill Constraints

- Use Yarn-only workflows; this is reinforced by `package.json` and `scripts/release-check.mjs`.
- Use Node built-in `node:test`; `package.json` does not declare Jest or Vitest.
- Use real SQLite/Drizzle rather than mocked database layers for persistence-facing tests; scoped migrations under `drizzle/` define the durable schema.
- Preserve `TZ=Asia/Taipei`; `.env.example`, `scripts/run-node-with-tz.mjs`, and `scripts/release-check.mjs` make this a release-blocking contract.
- Keep generated matrix docs synchronized through `yarn matrix:gen:check` and `yarn behavior-matrix:gen:check` when the source matrices change.

---

*Stack analysis: 2026-06-01*
