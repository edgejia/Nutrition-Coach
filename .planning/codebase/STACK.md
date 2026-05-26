# Technology Stack

**Analysis Date:** 2026-05-26

## Languages

**Primary:**
- TypeScript 5.9.3 - Full-stack application source under `server/**/*.ts`, `client/src/**/*.ts`, `client/src/**/*.tsx`, and `tests/**/*.ts`; configured by `tsconfig.json` and locked in `yarn.lock`.
- TSX / React JSX - Client UI components under `client/src/components/*.tsx`, with `jsx: "react-jsx"` configured in `tsconfig.json`.

**Secondary:**
- JavaScript / MJS - Workflow and verification scripts under `scripts/*.mjs` and browser harness scenarios under `tests/harness/scenarios/*.mjs`.
- SQL - Drizzle-generated SQLite migrations under `drizzle/*.sql`.
- Markdown - Product, deployment, and research documentation under `README.md`, `docs/deploy/railway-beta.md`, and `docs/research/**`.

## Runtime

**Environment:**
- Node.js 22+ - Required by `README.md` and used by the Docker image `node:22-bookworm-slim` in `Dockerfile`.
- ESM runtime - `package.json` sets `"type": "module"`; local TypeScript imports use explicit `.js` specifiers such as `server/index.ts` importing `./app.js`.
- Timezone-sensitive runtime - `server/lib/time.ts` enforces `TZ=Asia/Taipei`, and `scripts/run-node-with-tz.mjs` wraps tests with the same timezone.

**Package Manager:**
- Yarn - All scripts are defined in `package.json`, and repo guidance in `AGENTS.md` requires `yarn` only.
- Lockfile: present at `yarn.lock`.
- Corepack - `Dockerfile` runs `corepack enable` before `yarn install --frozen-lockfile`.

## Frameworks

**Core:**
- Fastify 5.8.4 - HTTP API server and same-origin static shell in `server/app.ts`.
- React 19.2.4 - Mobile-first client UI under `client/src/App.tsx`, `client/src/main.tsx`, and `client/src/components/**`.
- Vite 6.4.1 - Client dev/build tool configured by `client/vite.config.ts`.
- Drizzle ORM 0.39.3 - SQLite schema and query layer in `server/db/schema.ts`, `server/db/client.ts`, and `server/services/*.ts`.
- better-sqlite3 11.10.0 - Synchronous SQLite driver used by `server/db/client.ts` and `server/db/migrate.ts`.
- OpenAI SDK 4.104.0 - LLM provider implementation in `server/llm/openai.ts`.
- Zustand 5.0.12 - Client state boundary in `client/src/store.ts`.
- Tailwind CSS 4.2.2 - Client styling pipeline through `@tailwindcss/vite` in `client/vite.config.ts` and CSS under `client/src/app.css`.

**Testing:**
- Node built-in test runner - `package.json` runs `node --test` through `scripts/run-node-with-tz.mjs`; tests live under `tests/unit/*.test.ts` and `tests/integration/*.test.ts`.
- tsx 4.21.0 - TypeScript execution for dev server, migrations, tests, and harness commands in `package.json`.
- Deterministic harness - Scenario runner in `tests/harness/run.ts`, scenarios under `tests/harness/scenarios/*.ts`, and generated evidence under `tests/harness/artifacts/**`.
- React server rendering tests - Component contracts use `react-dom/server` in files such as `tests/unit/assistant-markdown.test.ts` and `tests/unit/onboarding-stepper-ui.test.ts`.

**Build/Dev:**
- Vite dev server - `yarn dev:client` runs `vite dev --config client/vite.config.ts`, with `/api` proxied to `http://localhost:3000`.
- Fastify dev server - `yarn dev:server` runs `node --env-file=.env --import tsx --watch server/index.ts`.
- Client production build - `yarn build` writes `dist/client` from `client/vite.config.ts`.
- TypeScript gate - `yarn tsc --noEmit` uses `tsconfig.json`.
- Drizzle Kit 0.31.10 - `yarn db:generate` uses `drizzle.config.ts`; `yarn db:migrate` runs `server/db/migrate.ts`.
- Release gate - `yarn release:check` runs `scripts/release-check.mjs` through `scripts/run-node-with-tz.mjs`.

## Key Dependencies

**Critical:**
- `fastify` 5.8.4 - Owns API routing, request lifecycle, logging, and static shell serving in `server/app.ts`.
- `@fastify/cors` 11.2.0 - Registered in `server/app.ts` for cross-origin local development.
- `@fastify/multipart` 9.4.0 - Registered in `server/app.ts` and used by `server/routes/chat.ts` for text/image chat uploads.
- `@fastify/static` 9.1.1 - Serves `dist/client` from `server/app.ts` when `CLIENT_DIST_DIR` contains `index.html`.
- `openai` 4.104.0 - Backs `OpenAIProvider` in `server/llm/openai.ts`, including streaming chat completions and tool calls.
- `drizzle-orm` 0.39.3 - Defines tables in `server/db/schema.ts` and powers service queries in `server/services/*.ts`.
- `better-sqlite3` 11.10.0 - Opens SQLite databases, enables WAL and foreign keys, and supports `:memory:` tests in `server/db/client.ts`.
- `zod` 4.3.6 - Validates orchestrator tool arguments in `server/orchestrator/tools.ts` and tool contracts in `server/orchestrator/tool-contract.ts`.
- `react` 19.2.4 and `react-dom` 19.2.4 - Render the client app from `client/src/main.tsx`.
- `zustand` 5.0.12 - Centralizes client application state in `client/src/store.ts`.

**Infrastructure:**
- `@vitejs/plugin-react` 4.7.0 - Enables React support in `client/vite.config.ts`.
- `@tailwindcss/vite` 4.2.2 - Integrates Tailwind 4 with Vite in `client/vite.config.ts`.
- `typescript` 5.9.3 - Strict TypeScript compilation configured in `tsconfig.json`.
- `tsx` 4.21.0 - Runtime TypeScript loader for `server/index.ts`, `server/db/migrate.ts`, tests, and harness scripts.
- `drizzle-kit` 0.31.10 - Migration generation configured by `drizzle.config.ts`.
- `@types/node`, `@types/react`, `@types/react-dom`, and `@types/better-sqlite3` - Type packages declared in `package.json`.

## Configuration

**Environment:**
- Runtime configuration is centralized in `server/config.ts`; add new server env reads there unless the value is a bootstrap or CLI exception.
- Required operational env vars are documented in `README.md`: `OPENAI_API_KEY`, `OPENAI_ORCHESTRATOR_MODEL`, `PORT`, `DB_PATH`, and `TZ`.
- Deployment overrides are documented in `README.md` and `docs/deploy/railway-beta.md`: `NODE_ENV`, `GUEST_SESSION_SECRET`, `ASSETS_DIR`, `UPLOADS_STAGING_DIR`, and `CLIENT_DIST_DIR`.
- Guest-session env controls live in `server/config.ts`: `GUEST_SESSION_SECRET`, `GUEST_SESSION_COOKIE_NAME`, `GUEST_SESSION_RESUME_COOKIE_NAME`, `GUEST_SESSION_TTL_SECONDS`, `GUEST_SESSION_RESUME_TTL_SECONDS`, and `GUEST_SESSION_COOKIE_SECURE`.
- Logging env is read in `server/index.ts` through `LOG_LEVEL`; debug mode is read in `server/config.ts` through `DEBUG`.
- `.env` and `.env.example` files are present at the repo root; treat them as environment configuration files and do not quote secret contents.
- `yarn dev:server` loads `.env` via Node `--env-file=.env`; `server/db/migrate.ts` loads `.env` for the CLI migration path when the file exists.
- Timezone must be explicit: `server/lib/time.ts` fails boot unless `config.tz` equals `Asia/Taipei`.

**Build:**
- `package.json` defines all app, database, test, harness, matrix, and release scripts.
- `tsconfig.json` targets ES2022, uses ES2022 modules, `moduleResolution: "bundler"`, `strict: true`, `declaration: true`, and includes server, client, test, and Vite config TypeScript files.
- `client/vite.config.ts` sets `root: "client"`, `/api` proxy to `http://localhost:3000`, and `build.outDir: "../dist/client"`.
- `drizzle.config.ts` sets SQLite dialect, schema path `./server/db/schema.ts`, migration output `./drizzle`, and database URL from `DB_PATH` with fallback `./data/nutrition.db`.
- `Dockerfile` installs dependencies with `yarn install --frozen-lockfile`, runs `yarn build`, exposes port `3000`, and starts with `yarn db:migrate && yarn start`.

## Platform Requirements

**Development:**
- Use Node.js 22+ and Yarn, as documented in `README.md`.
- Run the API server with `yarn dev:server` on port `3000`; it boots `server/index.ts` and injects `OpenAIProvider`.
- Run the client with `yarn dev:client`; `client/vite.config.ts` proxies API traffic to the Fastify server.
- Initialize SQLite with `yarn db:migrate`; application boot through `server/db/client.ts` validates required tables for file-backed databases.
- Preserve `TZ=Asia/Taipei` for local dev, tests, and harnesses; `scripts/run-node-with-tz.mjs` enforces it for test commands.
- Use `MockLLMProvider` from `server/llm/mock.ts` or harness providers under `tests/harness/**` for tests instead of real OpenAI calls.

**Production:**
- Deployment target is a single persistent web service, documented for Railway in `docs/deploy/railway-beta.md`.
- The production process serves API and built client from one Fastify app: `server/app.ts` registers `@fastify/static` against `CLIENT_DIST_DIR`.
- Persistent storage requirements are one SQLite file at `DB_PATH` and durable image assets at `ASSETS_DIR`; Railway baseline uses a mounted volume at `/app/data`.
- Runtime start path is `yarn db:migrate && yarn start`, as declared in `Dockerfile`, `README.md`, and `docs/deploy/railway-beta.md`.
- Production cookies become secure when `NODE_ENV=production` or `GUEST_SESSION_COOKIE_SECURE=true`, controlled by `server/config.ts`.

---

*Stack analysis: 2026-05-26*
