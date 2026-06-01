# Technology Stack

**Analysis Date:** 2026-06-01
**Last Mapped Commit:** `df5f989b593d494ac44ce3b004307c1c6ada7bec`
**Scope:** `.dockerignore`, `.gitignore`, `CHANGELOG.md`, `Dockerfile`, `README-en.md`, `README.md`, `drizzle/`, `yarn.lock`

## Languages

**Primary:**
- TypeScript 5.x - Full-stack application code is documented in `README.md` and `README-en.md` as a complete TypeScript app with server, client, and tests. The locked compiler in `yarn.lock` resolves `typescript@^5.7.0` to `5.9.3`.

**Secondary:**
- TSX / React JSX - The mobile-first client uses React surfaces under `client/src/components/`, `client/src/App.tsx`, and `client/src/main.tsx` per `README.md` and `README-en.md`; `yarn.lock` resolves React packages to React `19.2.4`.
- JavaScript ESM - Operational commands in `README.md` and `README-en.md` run through Yarn scripts; the scoped lockfile resolves `tsx@^4.19.0` / `tsx@^4.21.0` to `4.21.0` for TypeScript execution.
- SQL - SQLite schema migrations live in `drizzle/*.sql`; Drizzle migration metadata lives in `drizzle/meta/*.json`.
- CSS - Tailwind-backed styling remains part of the Vite client stack; `yarn.lock` resolves `tailwindcss@^4.0.0` and `@tailwindcss/vite` to `4.2.2`.
- Markdown - Product and release documentation in `README.md`, `README-en.md`, and `CHANGELOG.md` define setup, deployment, verification, and release history.

## Runtime

**Environment:**
- Node.js 22+ - Required by `README.md` and `README-en.md`; the production container uses `node:22-bookworm-slim` in `Dockerfile`.
- ESM-oriented Node execution - Development and test commands documented in `README.md` run through Yarn scripts, with TypeScript execution provided by `tsx` from `yarn.lock`.
- Timezone-sensitive runtime - `README.md` and `README-en.md` require `TZ=Asia/Taipei` for daily nutrition boundaries.
- Production process - `Dockerfile` sets `NODE_ENV=production`, exposes port `3000`, and starts with `yarn db:migrate && yarn start`.

**Package Manager:**
- Yarn 1 lockfile - `yarn.lock` is present and is the dependency source used by `Dockerfile`.
- Install command: `yarn install` for local setup in `README.md` / `README-en.md`; `Dockerfile` runs `corepack enable && yarn install --frozen-lockfile`.
- Lockfile: present at `yarn.lock`.

## Frameworks

**Core:**
- Fastify `^5.2.0` - Backend API server documented in `README.md` and `README-en.md`; `yarn.lock` resolves `fastify` to `5.8.4`.
- React `^19.0.0` and React DOM - Mobile-first client documented in `README.md` and `README-en.md`; `yarn.lock` resolves `react` to `19.2.4` and `react-dom` to `19.2.4`.
- Vite `^6.2.0` with `@vitejs/plugin-react` - Client dev/build stack documented in `README.md` / `README-en.md`; `yarn.lock` resolves `vite` to `6.4.1` and `@vitejs/plugin-react` to `4.7.0`.
- Tailwind CSS `^4.0.0` with `@tailwindcss/vite` - Client styling/build integration; `yarn.lock` resolves both Tailwind packages to `4.2.2`.
- Drizzle ORM `^0.39.0` - SQLite persistence documented in `README.md` / `README-en.md`; `yarn.lock` resolves `drizzle-orm` to `0.39.3`, and migrations live under `drizzle/`.
- better-sqlite3 `^11.8.0` - SQLite driver resolved by `yarn.lock` to `11.10.0`.

**Testing:**
- Node built-in test runner - `README.md` and `README-en.md` document `yarn test`, `yarn test:unit`, and `yarn test:integration` with test locations under `tests/unit/`, `tests/integration/`, and `tests/harness/`.
- Deterministic harness runner - `README.md` and `README-en.md` document `yarn verify:harness -- behavior-matrix`, `yarn verify:harness -- guest-session-hardening`, and `yarn verify:harness -- provider-auth-failure-localization`.
- Mock provider boundary - `README.md` and `README-en.md` state that local development calls OpenAI, while tests and some harness flows use mock providers.

**Build/Dev:**
- Docker - `Dockerfile` is the container build recipe: copy `package.json` / `yarn.lock`, install with frozen lockfile, copy the repo, run `yarn build`, then start with migrations plus `yarn start`.
- Vite build - `README.md` and `README-en.md` document `yarn install && yarn build`; deployed Fastify serves `dist/client`.
- Drizzle migrations - `README.md` and `README-en.md` document `yarn db:migrate`; migration files are `drizzle/0000_brainy_rocket_racer.sql` through `drizzle/0008_shiny_stellaris.sql`.
- Release verification - `README.md`, `README-en.md`, and `CHANGELOG.md` document `yarn release:check` as the release gate; recent v2.4 proof records `yarn tsc --noEmit` and `yarn release:check` passing.

## Key Dependencies

**Critical:**
- `openai` `^4.82.0` - OpenAI-backed meal analysis and coaching are documented in `README.md` and `README-en.md`; `yarn.lock` resolves the SDK to `4.104.0`.
- `fastify` `^5.2.0` - API and same-origin service runtime; `yarn.lock` resolves to `5.8.4`.
- `@fastify/multipart` `^9.0.0` - Multipart/image upload support; `yarn.lock` resolves to `9.4.0`.
- `@fastify/static` `^9.1.1` - Same-origin serving for built `dist/client`; `yarn.lock` resolves to `9.1.1`.
- `@fastify/cors` `^11.0.0` - API CORS support; `yarn.lock` resolves to `11.2.0`.
- `better-sqlite3` `^11.8.0` - SQLite driver; `yarn.lock` resolves to `11.10.0`.
- `drizzle-orm` `^0.39.0` - SQLite ORM and schema layer; `yarn.lock` resolves to `0.39.3`.
- `zod` `^4.3.6` - Runtime schema validation dependency; `yarn.lock` resolves to `4.3.6`.
- `zustand` `^5.0.0` - Client state boundary documented in `README.md` and `README-en.md`; `yarn.lock` resolves to `5.0.12`.

**Infrastructure:**
- `tsx` `^4.19.0` / `^4.21.0` - TypeScript runtime execution for scripts/tests; `yarn.lock` resolves to `4.21.0`.
- `drizzle-kit` `^0.31.10` - Migration generation tooling; `yarn.lock` resolves to `0.31.10`.
- `@types/node` `^22.0.0`, `@types/react` `^19.0.0`, and `@types/react-dom` `^19.0.0` - Type support resolved in `yarn.lock`.
- `@vitejs/plugin-react` `^4.4.0` and `@tailwindcss/vite` `^4.0.0` - Vite plugin stack resolved in `yarn.lock`.

## Configuration

**Environment:**
- Local setup copies `.env.example` to `.env` per `README.md` and `README-en.md`; `.env` and `.env.*` are ignored by `.gitignore` and excluded from Docker context by `.dockerignore`.
- Required core env vars documented in `README.md` and `README-en.md`: `OPENAI_API_KEY`, `OPENAI_ORCHESTRATOR_MODEL`, `PORT`, `DB_PATH`, and `TZ`.
- Deployment overrides documented in `README.md` and `README-en.md`: `NODE_ENV`, `GUEST_SESSION_SECRET`, `ASSETS_DIR`, `UPLOADS_STAGING_DIR`, and `CLIENT_DIST_DIR`.
- `GUEST_SESSION_SECRET` is documented as an app-owned random secret, not an external provider credential, in `README.md` and `README-en.md`.
- Docker runtime sets `NODE_ENV=production` in `Dockerfile`; deployment still needs external values for OpenAI, database path, timezone, and guest-session secret per `README.md`.

**Build:**
- Container build config: `Dockerfile`.
- Dependency lock config: `yarn.lock`.
- Database migration config/artifacts: `drizzle/*.sql`, `drizzle/meta/*.json`, and `drizzle/meta/_journal.json`.
- Ignore config: `.gitignore` excludes `node_modules/`, `dist/`, `data/*`, `.planning/`, `.env*`, local DB files, and generated harness artifacts; `.dockerignore` excludes tests, docs, planning/agent state, local DBs, and secret env files from the Docker context.

## Platform Requirements

**Development:**
- Install with `yarn install` from `README.md` / `README-en.md`.
- Create local env with `cp .env.example .env`, then set `OPENAI_API_KEY`, `OPENAI_ORCHESTRATOR_MODEL`, `PORT`, `DB_PATH`, and `TZ`.
- Initialize SQLite with `yarn db:migrate`; `README.md` and `README-en.md` state migrations read `.env` when present, so custom `DB_PATH` applies.
- Run backend with `yarn dev:server` and Vite client with `yarn dev:client`; open `http://localhost:5173`, with API at `http://localhost:3000`.
- Keep `TZ=Asia/Taipei` for daily nutrition boundaries.

**Production:**
- Deployment target: one Fastify process serving both API and `dist/client`, documented in `README.md` and `README-en.md`.
- Container target: `Dockerfile` on Node 22 with `yarn build`, `EXPOSE 3000`, and `CMD ["sh", "-lc", "yarn db:migrate && yarn start"]`.
- Runtime storage: use a persistent volume for SQLite and durable image assets per `README.md` and `README-en.md`; configure `DB_PATH` and `ASSETS_DIR`.
- Hosting guidance: Railway deployment example is referenced from `README.md` and `README-en.md`, while `CHANGELOG.md` records Railway staging/production smoke history and notes v2.4 had no Railway smoke or promotion.
- Before release/promotion, run `yarn release:check`; v2.4 `CHANGELOG.md` records 1,245 tests passed plus frontend build during release proof.

## Project Skill Constraints

- Use `yarn` only; this is required by `AGENTS.md`, reflected in `README.md` / `README-en.md`, and enforced in `Dockerfile`.
- Use Node built-in `node:test`, real SQLite, and mock providers for tests per `AGENTS.md` and the test guidance documented in `README.md` / `README-en.md`.
- Do not hand-edit generated harness artifacts; `.gitignore` excludes `tests/harness/artifacts/` and `tests/harness/tmp/`.
- Do not read or quote `.env` contents; `.gitignore` and `.dockerignore` confirm `.env` / `.env.*` are local secrets, with `.env.example` allowed.

---

*Stack analysis: 2026-06-01*
