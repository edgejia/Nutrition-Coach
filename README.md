# Nutrition Coach

AI 驅動的飲食紀錄與熱量追蹤應用。使用者透過文字或圖片描述吃了什麼，LLM 估算營養、完成記錄，並用 SSE 即時回饋處理狀態與最終回覆。

文件導覽請見 [docs/README.md](docs/README.md)。
Codex project-specific workflow notes are summarized in [docs/codex.md](docs/codex.md)。

## 目前進度

`v2.1 AI Trust Infrastructure & Logging Reliability` 已於 `2026-05-12` 出貨並封存，目前沒有 active milestone。v2.1 在 v2.0 logging/mobile foundation 上完成 prompt identity、redacted LLM trace、AI behavior regression matrix、deterministic mutation receipts、focused product-trust copy cleanup，以及 staging / production Railway smoke。

產品現在已具備：

- 文字與圖片餐點記錄，含 final-round SSE 串流、明確狀態文字與可停止的 in-progress AI 回覆
- 深色 performance / training-app Sport UI shell，含 lime accent、metric typography、compact dashboard density
- Home dashboard：今日熱量 hero、calorie ring、macro progress、coach CTA、今日餐點摘要與 Settings 入口
- Chat-only logging：Chat 是唯一記錄入口，支援文字、圖片、問答、grouped correction handoff，以及 bubble 內 progressive feedback
- History week strip：週條、selected-day hero、weekly stats、timeline 與 read-only Day Detail snapshot
- Meal Edit：透過 canonical meal revision semantics 儲存、刪除與刷新 affected day，並保留 meal-level whole-photo framing
- 歷史日期摘要瀏覽、read-only historical snapshot，以及 mutation 後的 `affectedDate` transport
- grouped meal transaction semantics、trusted-protein normalization、保守估算與 concise Traditional Chinese coaching copy
- cookie-backed guest-session browser auth、same-browser resume、tamper fail-closed 與 explicit rebuild recovery
- history meals / search / trends API foundation，含 cursor pagination、current active revisions、SQLite query-plan coverage
- validation observability：controlled validation failures 會輸出 redacted structured diagnostics，不洩漏 user text、prompt、image path、device ID 或 numeric target values
- deterministic harness foundation，含 reusable fixtures、redacted `llm-trace.json` artifacts、behavior matrix、grouped meal canonical proof、image continuity proof
- successful log/update/delete/goal mutation facts 由 committed mutation effects deterministic renderer 產生，避免 model passthrough 寫出不可信 receipt facts
- Onboarding Step 6、Chat receipt、Meal Edit、History / Day Detail 已移除最直接的 mock/internal-language trust issues
- v2.1 milestone audit passed `28/28`，`yarn release:check` passed before staging/main promotion
- staging / production deployed-domain smoke 已完成

## 功能

- **對話式記錄**：用自然語言描述你吃了什麼，支援文字與圖片上傳
- **AI 營養分析**：LLM 自動估算卡路里、蛋白質、碳水、脂肪，並以 trusted-protein 規則避免 trace protein 灌高 headline 蛋白質
- **AI trust evidence**：chat/logging harness 可輸出 redacted `llm-trace.json`，記錄 prompt metadata、round/tool/fallback sequence、final reply source/shape、latency 與 counts
- **Deterministic receipts**：成功的新增、更新、刪除與目標更新 receipt facts 由 committed mutation effects renderer 產生
- **Home dashboard**：今日剩餘熱量、calorie ring、macro progress、今日餐點與 coach CTA
- **Chat-only logging**：所有新增記錄、問題、修正意圖都從 Chat 進入，grouped meal correction 以 Chat handoff 處理
- **即時回饋**：SSE 推播與 chat bubble progressive feedback，餐點記錄後即時更新進度
- **歷史日體驗**：支援查看昨天、前天或明確 past date 的 summary / meals，且 historical mutation 不會污染今天的 live dashboard
- **History timeline**：週條以 calorie ratio 表示每日熱量比例，selected day 下方用 timeline 呈現餐點
- **Meal Edit**：從 supported review surface 編輯或刪除既有餐點，沿用 canonical meal revision contract；grouped meals 保持 read-only item detail 並導向 Chat 修正
- **目標設定**：設定每日營養目標，追蹤達成率
- **訪客工作階段**：無需帳號，使用 cookie-backed guest session 維持同瀏覽器 continuity 與 recovery flow

## 技術架構

| 層級 | 技術 |
|------|------|
| Frontend | React 19, Zustand, Tailwind CSS v4, Vite |
| Backend | Fastify, TypeScript |
| Database | SQLite (Drizzle ORM, better-sqlite3) |
| AI | OpenAI API（單一 LLM 模型，用於 orchestrator 對話與 target generation） |
| Real-time | Server-Sent Events (SSE) |

## 快速開始

### 1. 安裝依賴

```bash
yarn install
```

### 2. 設定環境變數

```bash
cp .env.example .env
```

編輯 `.env`，填入你的 OpenAI API Key：

```
OPENAI_API_KEY=your-api-key-here
OPENAI_ORCHESTRATOR_MODEL=gpt-5-nano
PORT=3000
DB_PATH=./data/nutrition.db
TZ=Asia/Taipei
```

### 3. 啟動開發伺服器

開兩個 terminal 分別執行：

```bash
# Terminal 1：後端
yarn dev:server

# Terminal 2：前端
yarn dev:client
```

前端預設跑在 `http://localhost:5173`，後端跑在 `http://localhost:3000`。

## 生產 / beta 部署

```bash
yarn install
yarn build
yarn db:migrate
yarn start
```

beta / production 會由同一個 Fastify 進程同時提供 API 與 `dist/client`。
部署時請使用持久化主機與掛載磁碟，並維持 `TZ=Asia/Taipei`、`DB_PATH`、`ASSETS_DIR`、`UPLOADS_STAGING_DIR`、`CLIENT_DIST_DIR` 的一致設定。public beta smoke 應在 real deployed domain 上執行，不以 localhost build smoke 取代。詳細的 Railway baseline 請見 [`docs/deploy/railway-beta.md`](docs/deploy/railway-beta.md)。

## Git / release workflow

- `main` 是 Railway production branch；不要直接在 `main` 上做 active development。
- `staging` 是 Railway testing branch，只用於 deploy verification 與 smoke checks。
- 新 milestone / feature work 從乾淨的 `feature/*` 分支開始；目前 milestone branch 慣例是 `feature/rNN-vX-Y-dev`，出貨後可 rename 成 `feature/rNN-vX-Y-shipped`。
- Release promotion 順序固定為 `feature/* -> staging -> main`。
- merge 或 promote 到 `staging` / `main` 前必須先跑 `yarn release:check`。

## 測試

```bash
# 所有測試
yarn test

# 只跑 unit tests
yarn test:unit

# 只跑 integration tests
yarn test:integration

# release gate
yarn release:check

# deterministic harness
yarn verify:harness -- protein-trust
yarn verify:harness -- guest-session-hardening
yarn verify:harness -- insight-eval
yarn verify:harness -- grouped-meal-canonical
yarn verify:harness -- meal-image-continuity
yarn verify:harness -- behavior-matrix
```

## 專案結構

```
├── client/            # React 前端與 Vite 設定
│   └── src/
│       ├── components/  # UI 元件（Home, Chat, History, Meal Edit, Onboarding 等）
│       ├── store.ts     # Zustand 狀態管理
│       ├── api.ts       # API client
│       └── sse.ts       # SSE 即時更新
├── server/            # Fastify 後端
│   ├── routes/        # HTTP / SSE transport boundary
│   ├── services/      # 業務邏輯與 persistence
│   ├── orchestrator/  # LLM 對話流程、tool contract、fallback
│   ├── llm/           # LLM provider（OpenAI / mock）
│   ├── realtime/      # SSE publisher
│   └── db/            # Drizzle schema & client
├── drizzle/           # SQL migrations 與 schema snapshots
├── scripts/           # release / workflow scripts
├── docs/              # 部署與文件索引
├── data/              # 本地 SQLite、資產與 upload staging（git 只保留 .gitkeep）
├── .planning/         # GSD 規劃、milestone archive、codebase intel
├── .claude/           # legacy Claude prompts / hooks / review profiles kept for migration
└── tests/
    ├── unit/          # Unit tests
    ├── integration/   # Integration tests
    └── harness/       # deterministic scenario verification + redacted artifacts
```

## 環境變數

| 變數 | 說明 | 預設值 |
|------|------|--------|
| `OPENAI_API_KEY` | OpenAI API 金鑰 | 必填 |
| `OPENAI_ORCHESTRATOR_MODEL` | 對話 LLM 模型 | `gpt-5-nano` |
| `PORT` | 後端埠號 | `3000` |
| `DB_PATH` | SQLite 資料庫路徑 | `./data/nutrition.db` |
| `ASSETS_DIR` | 持久化圖片資產目錄 | `./data/assets` |
| `UPLOADS_STAGING_DIR` | 上傳暫存目錄 | `./data/uploads-staging` |
| `CLIENT_DIST_DIR` | 前端建置輸出目錄 | `./dist/client` |
| `TZ` | 時區（影響每日統計邊界） | `Asia/Taipei` |
