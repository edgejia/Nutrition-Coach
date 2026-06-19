# Nutrition Coach

[繁體中文](README.md)

Nutrition Coach is an AI meal logging app: describe what you ate, optionally attach a photo, and get a structured nutrition log with live streaming feedback.

The repo is a full-stack TypeScript app:

- React + Vite mobile-first client
- Fastify API server
- SQLite persistence with Drizzle ORM
- OpenAI-backed meal analysis and coaching
- Server-Sent Events for streaming chat status, partial replies, and final receipts
- Cookie-backed guest sessions, so the app works without account signup
- Metadata-only failure localization for hard LLM/chat failures, including user-reportable fallback reference codes and redacted harness traces

## Requirements

- Node.js 22+
- Yarn
- An OpenAI API key

Local development calls the OpenAI API for real meal analysis. Tests and some harness flows use mock providers.

## What You Can Reuse

- Text and image meal logging: `server/orchestrator/*`, `server/routes/chat.ts`
- LLM tool calling with structured mutation commits: `server/orchestrator/tools.ts`, `server/orchestrator/tool-contract.ts`, `server/orchestrator/mutation-effects.ts`
- SSE streaming chat UX: `server/routes/chat.ts`, `client/src/sse.ts`, `client/src/components/ChatPanel.tsx`
- Meal correction authority: explicit numbers or backend-owned proposals are required before calories/macros can change
- Explicit meal-period intent: words like lunch, dinner, or late-night snack are stored as structured facts instead of being overridden by clock-hour inference
- Metadata-only chat failure localization: `server/llm/errors.ts`, `server/observability/events.ts`, `tests/harness/scenarios/provider-auth-failure-localization.ts`
- Signed-cookie guest sessions without a full account system: `server/routes/device.ts`, `server/lib/guest-session-resolver.ts`
- SQLite-backed full-stack app deployed as one Fastify service: `server/app.ts`, `server/db/*`, `drizzle/`
- Deterministic harnesses for AI behavior, receipts, and boundary contracts: `tests/harness/`

## Product Flow

1. A user completes lightweight onboarding and receives daily nutrition targets.
2. The user logs food in Chat using text, a photo, or both.
3. The orchestrator estimates calories and macros, writes the meal record, and streams progress over SSE.
4. Home updates today's calories, macros, and meal list.
5. History shows read-only daily snapshots and trends.
6. Users can edit or delete existing meals from the meal detail/edit screens.
7. Chat corrections resolve the target meal and numeric evidence server-side; vague requests do not directly commit model-estimated values.

## Quick Start

Install dependencies:

```bash
yarn install
```

Create your local environment file:

```bash
cp .env.example .env
```

Set at least:

```bash
OPENAI_API_KEY=your-api-key-here
OPENAI_ORCHESTRATOR_MODEL=gpt-5.4-mini
PORT=3000
DB_PATH=./data/nutrition.db
TZ=Asia/Taipei
```

Initialize the local SQLite schema:

```bash
yarn db:migrate
```

`yarn db:migrate` reads `.env` when it exists, so a custom `DB_PATH` applies to migrations too.

Run the app in two terminals:

```bash
# Terminal 1: API server
yarn dev:server

# Terminal 2: Vite client
yarn dev:client
```

Open `http://localhost:5173`. The API runs on `http://localhost:3000`.

## How It Works

```text
client/src/
  components/     React screens and product surfaces
  store.ts        Zustand state boundary
  api.ts          HTTP client helpers
  sse.ts          SSE transport helpers

server/
  app.ts          Fastify composition root
  routes/         HTTP and SSE transport boundaries
  services/       Domain logic and SQLite-backed persistence
  orchestrator/   LLM workflow, tool contracts, fallback behavior
  llm/            OpenAI and mock LLM providers
  realtime/       SSE fan-out
  db/             Drizzle schema, client, and migrations

tests/
  unit/           Pure logic and contract tests
  integration/    Routes, services, SSE, and orchestrator boundaries
  harness/        Deterministic scenario verification and redacted artifacts
```

Key entry points:

- `server/routes/chat.ts`: streaming chat boundary
- `server/orchestrator/*`: model prompts, tool calls, fallback behavior, and receipt generation
- `server/services/*`: persistence and domain logic
- `client/src/store.ts`: client state boundary
- `GET /api/sse`: uses cookie-backed guest sessions because browser `EventSource` cannot set custom headers

## Commands

```bash
# TypeScript check
yarn tsc --noEmit

# Unit tests
yarn test:unit

# Integration tests
yarn test:integration

# Full test suite
yarn test

# Release gate
yarn release:check
```

Advanced deterministic AI and boundary harnesses live under `tests/harness/`. For example:

```bash
yarn verify:harness -- behavior-matrix
yarn verify:harness -- guest-session-hardening
yarn verify:harness -- provider-auth-failure-localization
```

## Environment Variables

Local development normally only needs these core variables:

| Variable | Purpose | Default |
|---|---|---|
| `OPENAI_API_KEY` | OpenAI API key | Required |
| `OPENAI_ORCHESTRATOR_MODEL` | Model used by the chat orchestrator | `gpt-5.4-mini` |
| `PORT` | Fastify port | `3000` |
| `DB_PATH` | SQLite database path | `./data/nutrition.db` |
| `TZ` | Process timezone for daily nutrition boundaries | `Asia/Taipei` |

Deployment-only overrides:

| Variable | Purpose | Default |
|---|---|---|
| `NODE_ENV` | Set to `production` to enable secure guest-session cookies | unset |
| `GUEST_SESSION_SECRET` | App-owned random secret for signing guest-session cookies in shared/deployed environments | `dev-guest-session-secret-change-me` |
| `ASSETS_DIR` | Durable image asset directory | `./data/assets` |
| `UPLOADS_STAGING_DIR` | Request-local upload staging directory | `./data/uploads-staging` |
| `CLIENT_DIST_DIR` | Frontend build directory served by Fastify | `./dist/client` |

`GUEST_SESSION_SECRET` is not an external provider credential. Generate a stable random value for deployment, for example with `openssl rand -hex 32`.

## Deploying

Build the client:

```bash
yarn install && yarn build
```

Run migrations and start the server:

```bash
yarn db:migrate && yarn start
```

In a deployed environment, one Fastify process serves both the API and `dist/client`. Use persistent storage for SQLite and durable assets, and set `NODE_ENV=production`, `OPENAI_API_KEY`, `OPENAI_ORCHESTRATOR_MODEL`, `DB_PATH`, `TZ`, and `GUEST_SESSION_SECRET`. The current production runtime is a local production-mode server exposed through Cloudflare Tunnel; see [docs/deploy/cloudflare-tunnel.md](docs/deploy/cloudflare-tunnel.md). The Railway baseline is archived as historical context.

## Public Docs

- [Cloudflare Tunnel production runtime](docs/deploy/cloudflare-tunnel.md)
- [Archived Railway deployment baseline](docs/deploy/railway-beta.md)
- [Capability matrix](docs/capability-matrix.md)
