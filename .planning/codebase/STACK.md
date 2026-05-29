# Technology Stack

**Analysis Date:** 2026-05-29

## Languages

**Primary:**
- TypeScript 5.7 - Full-stack application code in `server/**/*.ts`, `client/src/**/*.ts`, `client/src/**/*.tsx`, and `tests/**/*.ts`; configured by `tsconfig.json`.

**Secondary:**
- TSX / React JSX - Client UI components in `client/src/components/**/*.tsx`, `client/src/App.tsx`, and `client/src/main.tsx`; enabled through `jsx: "react-jsx"` in `tsconfig.json`.
- JavaScript ESM - Operational scripts and browser harnesses in `scripts/*.mjs` and `tests/harness/scenarios/*.mjs`.
- SQL - Drizzle-generated SQLite migrations in `drizzle/*.sql`; schema source of truth is `server/db/schema.ts`.
- CSS - Tailwind-backed application stylesheet in `client/src/app.css`, processed by `@tailwindcss/vite` in `client/vite.config.ts`.
- Markdown - Product, deployment, ADR, and workflow docs in `README.md`, `docs/deploy/railway-beta.md`, `docs/adr/*.md`, and `.planning/**`.

## Runtime

**Environment:**
- Node.js 22+ - Required by `README.md`; production image uses `node:22-bookworm-slim` in `Dockerfile`.
- Local shell runtime observed as Node `v24.14.0` with Yarn `1.22.22`; keep app compatibility anchored to Node 22 because `Dockerfile`, `@types/node`, and `README.md` define that target.
- ESM modules - `package.json` sets `"type": "module"`; local TypeScript imports use explicit `.js` specifiers as enforced by project guidance in `AGENTS.md`.
- Timezone-sensitive runtime - `server/lib/time.ts`, `scripts/run-node-with-tz.mjs`, and `scripts/release-check.mjs` require `TZ=Asia/Taipei`.

**Package Manager:**
- Yarn 1.22.22 - Use `yarn` only; scripts are defined in `package.json`, and `yarn.lock` is a Yarn v1 lockfile.
- Lockfile: present at `yarn.lock`.
- No `packageManager` field is defined in `package.json`; `Dockerfile` enables Corepack and runs `yarn install --frozen-lockfile`.

## Frameworks

**Core:**
- Fastify `^5.2.0` - Backend HTTP composition, routing, logging, multipart handling, and static serving; app root is `server/app.ts`.
- React `^19.0.0` and React DOM `^19.0.0` - Client UI application in `client/src/App.tsx` and `client/src/components/**/*.tsx`.
- Vite `^6.2.0` with `@vitejs/plugin-react` `^4.4.0` - Client dev server and production build configured by `client/vite.config.ts`.
- Tailwind CSS `^4.0.0` with `@tailwindcss/vite` `^4.0.0` - CSS processing for `client/src/app.css` through `client/vite.config.ts`.
- Drizzle ORM `^0.39.0` - SQLite schema and query builder in `server/db/schema.ts`, `server/services/*.ts`, and `server/db/client.ts`.
- better-sqlite3 `^11.8.0` - Synchronous SQLite driver used by `server/db/client.ts`, `server/db/migrate.ts`, integration tests, and harness fixtures.

**Testing:**
- Node built-in test runner - `package.json` uses `node --test` through `scripts/run-node-with-tz.mjs`; test files live under `tests/unit/*.test.ts` and `tests/integration/*.test.ts`.
- Node `assert/strict` - Assertion library used throughout `tests/unit/*.test.ts` and `tests/integration/*.test.ts`.
- `tsx` `^4.19.0` - TypeScript execution for tests, server dev, migrations, and harness commands in `package.json`.
- Deterministic harness runner - `tests/harness/run.ts` executes `tests/harness/scenarios/*.ts` and writes generated evidence under `tests/harness/artifacts/**`.
- Browser/visual harness scripts - `tests/harness/scenarios/*.mjs` and `scripts/phase45-mobile-evidence.mjs` use local browser/CDP flows and generated screenshot evidence without adding a Playwright package dependency.

**Build/Dev:**
- TypeScript compiler `^5.7.0` - `yarn tsc --noEmit` is the TypeScript gate from `AGENTS.md`.
- Vite build - `yarn build` emits the client bundle to `dist/client` through `client/vite.config.ts`.
- Drizzle Kit `^0.31.10` - `yarn db:generate` reads `drizzle.config.ts` and writes migrations under `drizzle/`.
- Node env-file support - `yarn dev:server` uses `node --env-file=.env --import tsx --watch server/index.ts`; `server/db/migrate.ts` loads `.env` when present.
- Docker - `Dockerfile` installs dependencies, builds the Vite client, exposes port `3000`, then runs `yarn db:migrate && yarn start`.

## Key Dependencies

**Critical:**
- `openai` `^4.82.0` - Runtime LLM provider in `server/llm/openai.ts`; inject through `OpenAIProvider` only at `server/index.ts` / `server/app.ts` boundaries.
- `fastify` `^5.2.0` - Owns API and same-origin app serving in `server/app.ts`.
- `@fastify/multipart` `^9.0.0` - Handles chat image uploads in `server/app.ts` and `server/routes/chat.ts`; route-level limit is 5 MB while parser limit is 10 MB.
- `@fastify/static` `^9.1.1` - Serves `dist/client` from `server/app.ts` when `CLIENT_DIST_DIR` contains `index.html`.
- `@fastify/cors` `^11.0.0` - Registered in `server/app.ts` for dev/API access.
- `better-sqlite3` `^11.8.0` - Database connection, WAL mode, foreign keys, and migration runner in `server/db/client.ts` and `server/db/migrate.ts`.
- `drizzle-orm` `^0.39.0` - Persistence layer used by `server/services/*.ts` and `server/db/schema.ts`.
- `zod` `^4.3.6` - Tool contract validation in `server/orchestrator/tool-contract.ts` and `server/orchestrator/tools.ts`.
- `zustand` `^5.0.0` - Client state boundary in `client/src/store.ts`.

**Infrastructure:**
- `tsx` `^4.19.0` - Runtime transpilation for server dev, tests, migrations, and harness scripts in `package.json`.
- `drizzle-kit` `^0.31.10` - Migration generation through `drizzle.config.ts`.
- `@types/node` `^22.0.0`, `@types/react` `^19.0.0`, and `@types/react-dom` `^19.0.0` - Type support for Node 22 and React 19.
- `@vitejs/plugin-react` `^4.4.0` and `@tailwindcss/vite` `^4.0.0` - Vite plugin stack in `client/vite.config.ts`.

## Configuration

**Environment:**
- Central server env reads live in `server/config.ts`; add new server env vars there instead of scattering `process.env` reads.
- Required runtime env vars are documented in `README.md`: `OPENAI_API_KEY`, `OPENAI_ORCHESTRATOR_MODEL`, `PORT`, `DB_PATH`, and `TZ`.
- Deployment env vars are documented in `docs/deploy/railway-beta.md`: `DB_PATH=/app/data/nutrition.db`, `ASSETS_DIR=/app/data/assets`, `UPLOADS_STAGING_DIR=/tmp/nutrition-uploads`, `CLIENT_DIST_DIR=/app/dist/client`, and `TZ=Asia/Taipei`.
- `.env` and `.env.example` are present; do not read or quote `.env*` contents. `README.md` documents the names and defaults that future code should use.
- Guest-session configuration lives in `server/config.ts`: `GUEST_SESSION_SECRET`, `GUEST_SESSION_COOKIE_NAME`, `GUEST_SESSION_RESUME_COOKIE_NAME`, `GUEST_SESSION_TTL_SECONDS`, `GUEST_SESSION_RESUME_TTL_SECONDS`, `GUEST_SESSION_COOKIE_SECURE`, and `NODE_ENV`.
- Logging config is passed from `server/index.ts`; `LOG_LEVEL` defaults to `info`, and authorization headers are redacted.

**Build:**
- TypeScript config: `tsconfig.json` targets `ES2022`, uses `moduleResolution: "bundler"`, enables `strict`, and includes `server/**/*.ts`, `client/src/**/*.ts`, `client/src/**/*.tsx`, and `tests/**/*.ts`.
- Client build config: `client/vite.config.ts` sets root `client`, proxies `/api` to `http://localhost:3000` in dev, and builds to `dist/client`.
- Database config: `drizzle.config.ts` uses SQLite, schema `server/db/schema.ts`, migrations output `drizzle/`, and `DB_PATH` fallback `./data/nutrition.db`.
- Docker config: `Dockerfile` is the production container recipe; no `railway.json` is present.
- Lint/format config: no `.eslintrc*`, `eslint.config.*`, `.prettierrc*`, or `biome.json` detected in the repo root.

## Platform Requirements

**Development:**
- Install with `yarn install` from `package.json` / `yarn.lock`.
- Create local env from `.env.example` without committing secrets; `.gitignore` excludes `.env`, `.env.*`, databases, `dist/`, `data/*`, and generated harness artifacts.
- Run migrations with `yarn db:migrate` before booting file-backed SQLite; `server/db/client.ts` fails fast if required tables are missing.
- Start backend with `yarn dev:server` on port `3000` and frontend with `yarn dev:client` on Vite port `5173`; `client/vite.config.ts` proxies `/api` to Fastify.
- Preserve `TZ=Asia/Taipei` for day-boundary correctness; `server/lib/time.ts` blocks boot when runtime timezone is missing or wrong.
- Use `MockLLMProvider` from `server/llm/mock.ts` in tests and harnesses; runtime LLM wiring uses `OpenAIProvider` in `server/index.ts`.

**Production:**
- Deployment target: one persistent Railway web service with one public domain and one mounted volume, documented in `docs/deploy/railway-beta.md`.
- Production command path: `Dockerfile` and `docs/deploy/railway-beta.md` both require `yarn db:migrate && yarn start` after `yarn build`.
- Runtime storage: mount `/app/data` for SQLite and durable assets; `docs/deploy/railway-beta.md` sets `DB_PATH` and `ASSETS_DIR` under that volume.
- Serve frontend same-origin from Fastify by building `dist/client`; `server/app.ts` serves `CLIENT_DIST_DIR` only when `index.html` exists.
- Before promotion to `staging` or `main`, run `yarn release:check` per `AGENTS.md` and `docs/codex.md`.
- Public beta smoke must run against the real Railway domain per `docs/deploy/railway-beta.md`; localhost build smoke is not equivalent.

## Project Skill Constraints

- Use `nutrition-verify-change` rules from `.codex/skills/nutrition-verify-change/SKILL.md` to choose gates: any `*.ts` edit needs `yarn tsc --noEmit`, route/service edits need `yarn test:integration`, and promotion prep needs `yarn release:check`.
- Use `nutrition-gen-test` rules from `.codex/skills/nutrition-gen-test/SKILL.md`: Node built-in `node:test`, real SQLite, `MockLLMProvider`, explicit `.js` imports, and `buildApp()`-based DI.
- Use `nutrition-security-review` rules from `.codex/skills/nutrition-security-review/SKILL.md` for upload, session, API key, validation, and SQLite query changes.
- Use `nutrition-railway-smoke` rules from `.codex/skills/nutrition-railway-smoke/SKILL.md` when deployment verification depends on Railway, real browser session continuity, or persisted assets.

---

*Stack analysis: 2026-05-29*
