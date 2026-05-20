# 更新日誌

## v2.3 - 2026-05-19

### 新增

- 目標變更現在先由後端建立明確提案。使用者只回 `好` 這類簡短確認時，系統只會套用有效的啟用中提案；如果沒有提案，就必須在同一輪訊息裡明確提供新的數字目標。
- 可編輯的餐點與聊天收據現在會帶餐點修訂身分資訊。後端會檢查更新/刪除請求是否基於最新版本，避免舊收據覆蓋較新的餐點資料。
- `daily_summary` SSE 現在使用嚴格 envelope，帶有 `affectedDate` 與 `source`。前端可以用這些資訊重新整理同日餐點列，或讓相符的歷史日期資料失效。
- v2.3 補齊了 metadata-only 證據，涵蓋目標變更權限、已提交的 mutation outcome、過期收據拒絕、SSE freshness，以及 release gate 收尾。

### 變更

- 目標更新失敗或被拒絕時，回覆文案改由後端決定。這些路徑不會改變 targets、不會 publish `goals_update`，也不會讓 LLM 寫出像成功一樣的回覆。
- 餐點記錄、更新、刪除，以及 direct meal `PATCH` / `DELETE` response 現在會透過 `summaryOutcome` 區分「餐點 mutation 已提交」和「summary refresh degraded/unavailable」。
- 同日即時摘要更新會先重新整理餐點列，再提交較新的總計。歷史日期事件只會讓相符的畫面資料失效，不會覆蓋今天的資料。
- 例行完整性證據仍維持 metadata-only，不保存 raw prompts、user text、assistant final text、tool payloads、provider bodies、image data、session material，或 database snapshots。

### 驗證

- v2.3 milestone audit 通過 `17/17` requirements、`5/5` phases、`10/10` cross-phase integrations、`5/5` E2E flows，以及 Phase 60-64 的 Nyquist coverage。
- Audit 留下兩項已接受的 advisory debt，已記錄供後續規劃。
- Phase 64 verification 記錄目標、mutation、過期收據、SSE freshness、artifact privacy、`yarn tsc --noEmit`、`yarn release:check` 證據全部通過。
- v2.3 本機 closeout 期間沒有執行 staging 或 production promotion。

## v2.2 - 2026-05-15

### 新增

- 每個 chat turn 現在有伺服器產生的 `turnId`。同一個 `turnId` 會串起 SSE start/done payloads、JSON responses、route logs、orchestrator child logs、trace facts，以及前端 fallback 參考資訊。
- 使用者看到 fallback/error bubble 時，現在可以看到短參考碼，例如 `引用碼 t-XXXXXXXX`。完整 UUID turn id 仍只留在內部追查用。
- OpenAI provider failure 現在會被整理成 metadata-only 格式，只保留 allowlisted status、provider request id、error class/type/code、operation、model，以及 abort flag。
- Orchestrator 新增 structured `onLLMError` 與 fallback hook payloads，讓 route 可以讀到安全的 provider metadata。
- `llm-trace.v2` harness evidence 新增 metadata-only 的 `llm_error`、`orchestrator_fallback`、`route_fallback`，以及 provider error counts。
- 新增專用的 `provider-auth-failure-localization` harness proof，用來覆蓋 auth-style provider failures。

### 變更

- 聊天完成狀態現在分得出「真的完成」和「走 fallback」兩種情況，對應事件是 `chat_turn_completed` 與 `chat_route_fallback`。
- Route catch logging 現在記錄 sanitized/truncated route error facts，不再依賴空 catch bindings 或 raw thrown messages。
- Provider 串流中途接續失敗時，系統會把它記成 metadata-only 的 `llm_error` route fallback，不會再誤算成成功完成的聊天。
- Auth-style fallback 文案檢查只留在 runtime memory；產生的 release artifacts 只保存 metadata counts 與 booleans，不保存使用者可見的 assistant text。

### 驗證

- v2.2 milestone audit 通過 `20/20` requirements、`4/4` phases、`4/4` integration checks、`4/4` E2E flows，以及 `4/4` Nyquist validation coverage。
- Phase 58 verification 記錄 targeted JSON/SSE integration tests、`provider-auth-failure-localization`、`text-log`、auth trace shape/privacy scans、`yarn tsc --noEmit`、`yarn build`、`yarn test`、`yarn release:check` 全部通過。
- v2.2 closeout 期間沒有執行 staging 或 production promotion。

## v2.1 - 2026-05-12

### 新增

- Chat/logging LLM workflows 新增 active prompt version 與 stable section IDs，方便追查 prompt 版本與段落來源。
- Chat/logging harness runs 現在會產生通用的 redacted `llm-trace.json` artifacts，包含 prompt metadata、workflow sequence、final reply source/shape、latency、round count，以及 tool count。
- 新增共用 AI behavior assertions 與 8-case `behavior-matrix` harness，覆蓋高風險 logging、prompt-injection、medical-boundary，以及 receipt-consistency regressions。
- 成功的記錄、更新、刪除與目標變更，現在用已提交的 `MutationEffects` 產生 deterministic mutation receipt。

### 變更

- 成功 mutation fact replies 改由 renderer 產生，不再直接放行 model 文字；一般非 mutation chat 仍可由 model 產生。
- Onboarding Step 6 改用真實 result/loading/failure/fallback states，不再於真實結果存在前顯示 mock target numbers。
- 聊天收據、餐點編輯、歷史紀錄、日期詳情改用在地化、面向產品的文案，降低使用者在重要信任畫面看到不一致文字的機會。
- `behavior-matrix` evidence 仍與 `yarn release:check` 分離；release promotion 仍取決於本機 release gates，以及真實 Railway staging/production smoke。

### 驗證

- v2.1 milestone audit 通過 `28/28` requirements。
- Phase 50-54 review reports 在 Phase 54 warning fix 後維持 clean。
- Phase 50 與 Phase 54 security reports 關閉所有已記錄 threats，`threats_open: 0`。
- `yarn release:check` 在 staging/main promotion 前通過。
- Railway production deployment `3377daaf-820d-4954-9085-8c822ba43d28` 通過 production 文字聊天、圖片餐點記錄、protected asset fetch、refresh persistence，以及 390px mobile smoke。

## v2.0 - 2026-05-07

### 新增

- 新增 capability matrix 與 source-contract 檢查，明確記錄 Sport UI 哪些 affordances 是 supported、read-only、hidden 或 future-scope。
- 進行中的 AI generation 或 meal analysis 現在可以平順停止，不會讓 Chat 留在不完整狀態。
- 聊天收據、今日餐點列、歷史紀錄、日期詳情、餐點編輯，以及 authorized asset fetches 之間，現在能維持穩定的餐點圖片連續性。
- Grouped meal logging 有了 canonical 語意，包含 item counts、grouped correction routing、grouped 餐點編輯唯讀項目細節，以及 deterministic grouped-meal harness coverage。
- 受控目標與 `log_food` validation failures 現在會輸出 redacted validation diagnostics。
- 歷史紀錄新增 stale-while-revalidate 行為；首頁 dashboard 新增 count-up 與 reduced-motion contracts。

### 變更

- Mobile app shell、Chat composer、compact Chat header、keyboard handling，以及 visual viewport 行為都針對主要 logging flows 做了強化。
- 成功餐點記錄與 mutation replies 改由 normalized server state 投影，不再依賴 model-authored final text。
- `PATCH /api/device/goals` 被記錄為 canonical partial-update route；`PUT /api/device/goals` 仍保留相容性支援。
- 餐點編輯的 whole-photo framing 避免 fixed-ratio clipping，也避免 portrait photos 覆蓋 grouped item rows。

### 驗證

- `yarn release:check` 在 staging promotion 前通過，並在 main promotion 前再次通過。
- Staging smoke 在 `https://nutrition-coach-stagin.up.railway.app/` 通過。
- Production smoke 在 `https://nutrition-coach-production.up.railway.app/` 通過。
- Phase 49 true-stack UAT 使用真實 client/API/SQLite data、沒有 route mocks，通過 7/7 scenarios。
