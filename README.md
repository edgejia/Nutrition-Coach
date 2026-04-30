# Nutrition Coach

AI 驅動的飲食紀錄與熱量追蹤應用。使用者透過文字或圖片描述吃了什麼，LLM 估算營養、完成記錄，並用 SSE 即時回饋處理狀態與最終回覆。

文件導覽請見 [docs/README.md](docs/README.md)。
Codex project-specific workflow notes are summarized in [docs/codex.md](docs/codex.md)。

## 目前進度

`v1.8 UI refactor` 已於 `2026-04-30` 出貨並封存，目前沒有 active milestone。v1.8 以 `chatgpt/` Claude Design mock 為基準，完成 Home / Chat / History 三個 bottom-tab 核心頁面，以及 Settings、Day Detail、Meal Edit 二級畫面。

產品現在已具備：

- 文字與圖片餐點記錄，含 final-round SSE 串流與明確狀態文字
- 米白紙感、黑色線稿、手寫字體、暖橘 accent 的 sketch-style frontend
- Home dashboard：今日剩餘熱量、macro progress、今日餐點摘要與 Settings 入口
- Chat-only logging：Chat 是唯一記錄入口，支援文字、圖片、問答、修改舊餐點，以及 bubble 內 progressive feedback
- History week strip：週條、selected-day timeline、calorie water level 與 read-only Day Detail snapshot
- Meal Edit：透過現有 canonical meal revision semantics 儲存、刪除與刷新 affected day
- 歷史日期摘要瀏覽、read-only historical snapshot，以及 mutation 後的 `affectedDate` transport
- trusted-protein normalization 與保守估算說明文案
- cookie-backed guest-session browser auth、same-browser resume、tamper fail-closed 與 explicit rebuild recovery
- history meals / search / trends API foundation，含 cursor pagination、current active revisions、SQLite query-plan coverage
- deterministic insight eval harness foundation，含 reusable fixtures、redacted trace artifacts、groundedness / safety assertions
- v1.8 milestone audit passed `28/28`，`yarn release:check` passed on `2026-04-30`
- deployed-domain beta / production smoke 已完成

## 功能

- **對話式記錄**：用自然語言描述你吃了什麼，支援文字與圖片上傳
- **AI 營養分析**：LLM 自動估算卡路里、蛋白質、碳水、脂肪，並以 trusted-protein 規則避免 trace protein 灌高 headline 蛋白質
- **Home dashboard**：今日剩餘熱量、calorie ring、macro progress、今日餐點與 coach CTA
- **Chat-only logging**：所有新增記錄、問題、修正意圖都從 Chat 進入，logged meal bubble 不提供 inline edit/delete 按鈕
- **即時回饋**：SSE 推播與 chat bubble progressive feedback，餐點記錄後即時更新進度
- **歷史日體驗**：支援查看昨天、前天或明確 past date 的 summary / meals，且 historical mutation 不會污染今天的 live dashboard
- **History timeline**：週條以 calorie water level 表示每日熱量比例，selected day 下方用 timeline 呈現餐點
- **Meal Edit**：從 current-day review surface 編輯或刪除既有餐點，沿用 canonical meal revision contract
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
- 新 milestone / feature work 從乾淨的 `feature/*` 分支開始；目前 milestone branch 慣例是 `feature/rNN-vX-Y-dev`，出貨後可 rename 成 `feature/rNN-vX-Y-shipped`。v1.8 的 shipped branch 是 `feature/r13-v1-8-shipped`，下一個 feature / milestone 建議從 `staging` 開 `feature/r14-...`。
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
