# 架構

Nutrition Coach 是一個 single-repo TypeScript 全端應用。前端負責使用者互動與狀態呈現，後端負責 session ownership、資料驗證、LLM orchestration、資料持久化與串流回覆。

## 總覽

```text
React/Vite client
  -> client transport and state boundary
  -> Fastify routes
  -> domain services
  -> orchestrator and tool contracts
  -> LLMProvider
  -> OpenAIProvider in runtime / mock providers in tests
  -> SQLite through Drizzle
```

Production-mode runtime 是單一 Fastify process。當 `CLIENT_DIST_DIR` 指向建置後的前端檔案時，Fastify 會用同一個 origin 提供 API 和 `dist/client`。本機開發通常是 Vite 跑在 `localhost:5173`，Fastify 跑在 `localhost:3000`。

## 主要元件

| 元件 | 責任 |
|---|---|
| `client/src/api.ts` | HTTP helpers、DTO normalization、API error mapping |
| `client/src/sse.ts` | Browser `EventSource` transport，接收即時事件 |
| `client/src/store.ts` | Zustand state boundary，管理 device、meals、summaries、messages、navigation |
| `server/app.ts` | 後端 composition root，組裝 config、plugins、DB、services、routes、realtime publisher、orchestrator |
| `server/routes/*.ts` | HTTP/SSE transport、request validation、guest-session checks、upload handling、response shaping |
| `server/services/*.ts` | 可重用的 domain logic 與 persistence logic |
| `server/orchestrator/*` | Prompt construction、LLM rounds、tool contracts、mutation effects、receipts、fallbacks |
| `server/llm/*` | Provider interface、OpenAI implementation、mock providers、provider error metadata |
| `server/db/schema.ts` 和 `drizzle/` | SQLite schema 與 migrations |
| `server/realtime/publisher.ts` | Process-local fan-out，發布 summary 和 goals updates |

## Request Flows

### Onboarding

1. Client 送出 onboarding data 到 `POST /api/device`。
2. `server/routes/device.ts` 驗證輸入，建立或恢復 signed guest session。
3. Device services 將 profile、goal 和 daily target fields 寫入 SQLite。
4. Target generation 透過注入的 `LLMProvider.generateObject` 產生建議目標。
5. Response 回傳 `deviceId`、goal、daily targets，並設定 guest-session cookies。

Browser-facing protected routes 以 signed cookies 作為 ownership 來源，不依賴 raw `deviceId` selectors。

### Meal Logging

1. Client 送出 `POST /api/chat`，可包含文字與圖片。
2. `server/routes/chat.ts` 解析 guest-session ownership、驗證上傳、暫存圖片檔，並開始 SSE-style response。
3. Route 建立 orchestrator hooks，用於 state persistence、fallback behavior 和 sanitized trace metadata。
4. `server/orchestrator/index.ts` 建立對話歷史與 system prompt，呼叫 LLM provider，驗證 tool calls，並呼叫 service-layer mutations。
5. Meal mutations 透過 food logging、meal transactions、correction 和 proposal services 寫入 SQLite。
6. Route 串流 `status`、`chunk`、`done` events，並保存 assistant messages、receipts、proposal cards 和 summary outcomes。

LLM output 必須通過 tool-contract validation 後，才會觸發 persisted state mutation。

### History、Meals、Assets、Proposals

- `GET /api/meals`、`PATCH /api/meals/:id`、`DELETE /api/meals/:id` 管理目前餐點狀態與 revision-safe updates。
- `GET /api/day-snapshot`、`/api/history/*`、`/api/chat/history` 提供 dashboard、history 和 chat 畫面需要的資料。
- `GET /api/assets/:id` 透過 guest-session ownership checks 提供受保護圖片。
- `POST /api/proposals/actions` 套用 backend-created approve / edit / reject actions。
- `GET /api/sse` 使用 cookie-backed guest sessions，因為 browser `EventSource` 不能設定 custom headers。

## LLM Boundary

Runtime 和 tests 使用同一個 provider contract：

```text
route/controller
  -> service or orchestrator
  -> LLMProvider interface
  -> OpenAIProvider in runtime
  -> MockLLMProvider or harness providers in tests
```

主要 LLM paths：

- Chat orchestration 使用 `LLMProvider.chat` / streaming chat rounds 處理 meal logging 和 coaching turns。
- Onboarding target generation 使用 `LLMProvider.generateObject`，搭配 schema hints 和 validation。

LLM output handling：

- Tool call arguments 會先 parse JSON，再透過 Zod-backed tool contracts 驗證。
- Structured target generation 會驗證 JSON parsing、required fields、domain bounds 和 macro/calorie consistency。
- Provider failures、invalid JSON、schema validation failures 和 no-content responses 會轉成 typed failure outcomes。
- Tests 使用 mock providers、harness providers 和 fixtures，不依賴 live OpenAI calls。

## Data Model

SQLite 是 runtime source of truth。資料大致分成這些 domain groups：

- Guest session 與 device profile：使用者目標、每日營養目標、browser session ownership。
- Chat records：user messages、assistant messages、tool transcript records。
- Meals and revisions：餐點交易、餐點 revisions、item-level state、revision-safe updates。
- Assets：uploaded image metadata、ownership references、protected asset access。
- Proposal cards：confirm-first goal、meal numeric、estimate、delete actions。
- Summaries and turn state：daily summary outcomes、active flow state、realtime update facts。

Drizzle schema 定義在 `server/db/schema.ts`，migrations 放在 `drizzle/`。File-backed runtime database 需要先跑 migrations；in-memory test database 可以自動 bootstrap migrations。

## Error Handling

系統傾向使用 controlled failures，而不是直接暴露 raw provider 或 parser details：

- Boot 時會檢查 `TZ=Asia/Taipei`。
- Production-like runtime 會驗證 `GUEST_SESSION_SECRET`。
- LLM provider errors 會包成 metadata-only `LLMProviderError` objects。
- Structured output failures 使用 controlled reasons，例如 `provider_error`、`invalid_json`、`schema_validation`、`no_content`。
- Chat fallback responses 避免暴露 raw prompts、provider payloads、secrets 或 sensitive user content。
- Client DTO guards 會在 mutating state 前拒絕 malformed API/SSE shapes。
- Revision-safe updates 會回傳 stale revision conflicts，而不是覆蓋較新的 state。

## Runtime Dependencies

| 依賴 | 用途 |
|---|---|
| OpenAI API | Meal analysis、coaching、tool-capable chat rounds、target generation |
| SQLite file storage | 本機 persistent app database |
| Local filesystem | Uploaded assets、staging directories、frontend build output |
| Cloudflare Tunnel | 可選的 public access path，用於連到本機 production-mode server |
