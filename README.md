# Nutrition Coach

[English](README-en.md)

Nutrition Coach 是一個 AI 飲食紀錄 app：使用者用文字描述餐點，也可以附上照片，系統會透過 LLM 估算營養、寫入結構化餐點紀錄，並用 SSE 即時串流處理狀態與回覆。

這個 repo 是完整的 TypeScript full-stack app：

- React + Vite mobile-first client
- Fastify API server
- SQLite persistence with Drizzle ORM
- OpenAI-backed meal analysis and goal-aware coaching
- Server-Sent Events：串流 chat status、partial reply、final receipt
- Cookie-backed guest session：不需要註冊帳號也能維持同瀏覽器紀錄
- Metadata-only failure localization：hard LLM/chat failure 可用 user-reportable reference code 和 redacted harness trace 追查，不保存 raw prompt / user / provider payload

## 需求

- Node.js 22+
- Yarn
- OpenAI API key

本機開發會真的呼叫 OpenAI API 做餐點分析；測試和部分 harness 會使用 mock provider。

## 這個 Repo 適合參考什麼

- 文字 / 圖片飲食紀錄：`server/orchestrator/*`, `server/routes/chat.ts`
- LLM tool calling 與結構化 mutation commit：`server/orchestrator/tools.ts`, `server/orchestrator/tool-contract.ts`, `server/orchestrator/mutation-effects.ts`
- Schema-backed structured LLM output 與 onboarding target fallback：`server/llm/types.ts`, `server/llm/openai.ts`, `server/services/target-generation.ts`
- Authoritative DTO validation：`client/src/dto-guards.ts`, `client/src/api.ts`, `client/src/sse.ts`, `client/src/store.ts`
- SSE streaming chat UX：`server/routes/chat.ts`, `client/src/sse.ts`, `client/src/components/ChatPanel.tsx`
- 餐點修正權限：明確數字或後端提案才可改 calories / macros，使用者要求「估合理值」時會走 confirm-first estimate proposal
- Confirm-first proposal UX：goal、meal numeric、estimate、delete proposal 都有 approve / edit-via-new-message / reject affordance 與 deterministic lapse copy
- Goal-aware coach advice / CTAs：Home coaching copy and next actions follow the user's goal and today's logged state
- 明確餐別意圖：使用者說 `午餐` / `晚餐` / `宵夜` 時，餐別會以結構化欄位保存，不再被當下時間推論覆蓋
- Atomic chat receipt / structured history state：`server/services/chat.ts`, `server/services/chat-mutation-outcomes.ts`
- Metadata-only chat failure localization：`server/llm/errors.ts`, `server/observability/events.ts`, `tests/harness/scenarios/provider-auth-failure-localization.ts`
- Home / History / Meal Edit 餐點編輯：Home 今日餐點列、History snapshot rows，以及 grouped meal item add/edit/delete 都走 revision-safe edit identity
- 不依賴帳號系統的 signed-cookie guest session：`server/routes/device.ts`, `server/lib/guest-session-resolver.ts`
- SQLite-backed full-stack app 單一 Fastify service 部署：`server/app.ts`, `server/db/*`, `drizzle/`
- AI behavior / receipt / boundary deterministic harness：`tests/harness/`

## 產品流程

1. 使用者完成輕量 onboarding，取得每日營養目標。
2. 使用者在 Chat 用文字、照片或兩者一起記錄餐點。
3. Orchestrator 估算 calories / macros，寫入 meal record，並透過 SSE 串流進度。
4. Home 更新今日熱量、macros 和餐點列表。
5. History 顯示 read-only daily snapshots 和 trends，切換週或日期時保留穩定版面並用 snapshot facts 解鎖 rows / detail / edit。
6. 使用者可以從 Home、History 或既有餐點 detail / edit screens 編輯或刪除餐點；grouped meals 支援 item-level add / edit / delete。
7. Chat 修正餐點時，後端會先解析目標餐點和數字來源；使用者要求估合理值會產生後端保存的 confirm-first estimate proposal，而不是直接寫入模型估計值。
8. Chat 刪除餐點會先顯示後端渲染的 delete preview proposal；確認後才透過 revision-safe delete path 寫入。
9. Pending proposals 會以結構化 approve / edit / reject UI 呈現；過期、被取代或 stale 時顯示 deterministic Traditional Chinese lapse copy。
10. Home coach advice 和 CTA 會依照使用者 goal、今日餐點與剩餘 targets 選擇下一步。

## 快速開始

安裝依賴：

```bash
yarn install
```

建立本機環境檔：

```bash
cp .env.example .env
```

至少設定：

```bash
OPENAI_API_KEY=your-api-key-here
OPENAI_ORCHESTRATOR_MODEL=gpt-5.4-mini
PORT=3000
DB_PATH=./data/nutrition.db
TZ=Asia/Taipei
```

初始化本機 SQLite schema：

```bash
yarn db:migrate
```

`yarn db:migrate` 會在 `.env` 存在時讀取它，所以自訂 `DB_PATH` 也會套用到 migration。

開兩個 terminal 啟動 app：

```bash
# Terminal 1: API server
yarn dev:server

# Terminal 2: Vite client
yarn dev:client
```

打開 `http://localhost:5173`。API server 預設在 `http://localhost:3000`。

## 架構導覽

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

幾個主要入口：

- `server/routes/chat.ts`：streaming chat boundary
- `server/orchestrator/*`：model prompts、tool calls、fallback behavior、receipt generation
- `server/services/*`：persistence 與 domain logic
- `client/src/store.ts`：client state boundary
- `GET /api/sse`：使用 cookie-backed guest session，因為 browser `EventSource` 不能設定 custom headers

## 常用指令

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

進階 deterministic AI / boundary harness 放在 `tests/harness/`。例如：

```bash
yarn verify:harness -- behavior-matrix
yarn verify:harness -- guest-session-hardening
yarn verify:harness -- provider-auth-failure-localization
```

## 環境變數

本機開發通常只需要這些 core variables：

| Variable | Purpose | Default |
|---|---|---|
| `OPENAI_API_KEY` | OpenAI API key | Required |
| `OPENAI_ORCHESTRATOR_MODEL` | Chat orchestrator 使用的模型 | `gpt-5.4-mini` |
| `PORT` | Fastify port | `3000` |
| `DB_PATH` | SQLite database path | `./data/nutrition.db` |
| `TZ` | 每日營養統計邊界使用的 process timezone | `Asia/Taipei` |

部署時才常需要的 overrides：

| Variable | Purpose | Default |
|---|---|---|
| `NODE_ENV` | 設為 `production` 時會啟用 secure guest-session cookies | unset |
| `GUEST_SESSION_SECRET` | shared / deployed environments 用來簽 guest-session cookies 的 app-owned random secret | `dev-guest-session-secret-change-me` |
| `ASSETS_DIR` | 持久化圖片資產目錄 | `./data/assets` |
| `UPLOADS_STAGING_DIR` | request-local upload staging 目錄 | `./data/uploads-staging` |
| `CLIENT_DIST_DIR` | Fastify serving 的 frontend build 目錄 | `./dist/client` |

`GUEST_SESSION_SECRET` 不是外部 provider credential；部署者可以用 `openssl rand -hex 32` 產生一個穩定隨機值。Production-like runtime 會拒絕缺失、預設或少於 32 字元的值。

## 部署

Build client：

```bash
yarn install && yarn build
```

Run migrations and start server：

```bash
yarn db:migrate && yarn start
```

部署環境中，單一 Fastify process 會同時提供 API 與 `dist/client`。請使用有持久化 volume 的 host 存放 SQLite 和 durable assets，並設定 `NODE_ENV=production`、`OPENAI_API_KEY`、`OPENAI_ORCHESTRATOR_MODEL`、`DB_PATH`、`TZ`、`GUEST_SESSION_SECRET`。Railway 設定範例可參考 [docs/deploy/railway-beta.md](docs/deploy/railway-beta.md)。

## 公開文件

- [Railway deployment example](docs/deploy/railway-beta.md)
- [Capability matrix](docs/capability-matrix.md)
