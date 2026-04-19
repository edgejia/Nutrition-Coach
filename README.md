# Nutrition Coach

AI 驅動的飲食紀錄與熱量追蹤應用。透過對話方式記錄餐點，LLM 自動分析營養成分，即時更新每日進度。

## 功能

- **對話式記錄**：用自然語言描述你吃了什麼，支援文字與圖片上傳
- **AI 營養分析**：LLM 自動估算卡路里、蛋白質、碳水、脂肪（保守估算隱藏熱量）
- **即時儀表板**：SSE 推播，餐點記錄後即時更新進度條
- **目標設定**：設定每日營養目標，追蹤達成率
- **匿名裝置認證**：無需帳號，以裝置 ID 識別使用者

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
部署時請使用持久化主機與掛載磁碟，並維持 `TZ=Asia/Taipei`、`DB_PATH`、`ASSETS_DIR`、`UPLOADS_STAGING_DIR`、`CLIENT_DIST_DIR` 的一致設定。詳細的 Railway baseline 請見 [`docs/deploy/railway-beta.md`](docs/deploy/railway-beta.md)。

## 測試

```bash
# 所有測試
yarn test

# 只跑 unit tests
yarn test:unit

# 只跑 integration tests
yarn test:integration
```

## 專案結構

```
├── client/          # React 前端
│   └── src/
│       ├── components/  # UI 元件（Dashboard, ChatPanel, Onboarding 等）
│       ├── store.ts     # Zustand 狀態管理
│       ├── api.ts       # API client
│       └── sse.ts       # SSE 即時更新
├── server/          # Fastify 後端
│   ├── routes/      # API 路由（device, chat, sse）
│   ├── services/    # 業務邏輯
│   ├── orchestrator/ # LLM 對話流程
│   ├── llm/         # LLM provider（OpenAI / mock）
│   └── db/          # Drizzle schema & client
└── tests/
    ├── unit/        # Unit tests
    └── integration/ # Integration tests
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
