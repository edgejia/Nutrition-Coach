# 更新日誌

## v2.9 - 2026-06-15

### 新增

- 使用者要求「幫我估合理一點」時,meal numeric correction 會建立後端保存的 confirm-first estimate proposal,顯示 before -> after values,並只在使用者明確確認後提交。
- `delete_meal` 改為 confirm-first preview:先顯示後端渲染的餐點描述、日期/餐別、calories 與 macros,確認後才透過 revision-safe delete path 刪除。
- Pending goal、meal numeric、estimate、delete proposals 現在都有結構化 approve / edit-via-new-message / reject affordance,button action 只傳 proposal intent,commit authority 仍在後端。
- Pending proposal 過期、stale 或被 supersede 時會保留 deterministic Traditional Chinese lapse copy,不再靜默消失。
- Home coach advice 與 CTA 現在會依使用者 goal、今日紀錄與剩餘 targets 選擇 copy / next action；missing 或 unknown goal 會安全 fallback 到 maintain。

### 變更

- Confirm-first action reply persistence 改為 single-source backend path,避免 button/typed confirmation 造成重複 assistant reply 或 action event。
- Proposal action mutation、terminal card status、chat action event 與 realtime publish now commit in durable order:domain mutation 和 metadata commit 後才 publish `goals_update` 或 `daily_summary`。
- 模糊餐點數字修正仍 fail closed；只有明確使用者數字、backend-computable relative operator,或後端保存 estimate proposal confirmation 能提交。
- v2.9 closeout 維持本機驗證範圍;沒有 push、merge、deploy、Railway smoke、staging promotion 或 main promotion。

### 驗證

- Phase 88-91 verification 全部通過,涵蓋 estimate confirm-first、delete preview confirmation、structured proposal card/action/lapse behavior,以及 goal-aware coach advice / CTAs。
- Deterministic harness evidence 通過: `estimate-confirm-first` 9/9、`delete-confirm-first` 10/10、`proposal-three-way-confirmation` 10/10；artifact policy remains metadata-only。
- Closeout 前本機 `yarn release:check` 通過:TypeScript、`1,574` node tests、frontend production build 全部 green。Generated proof remains metadata-only.

## v2.8 - 2026-06-12

### 新增

- Tool side-effect policy 現在由後端 tool contract 強制執行,不再依賴 LLM 自述信心;8 個目前註冊的 tool 都分類為 `direct-execute`、`execute-and-report`、`clarify-first` 或 `confirm-first`。
- Confirm-first 提案改用 session-scoped pending state: `turn_states` 以 `(device_id, session_id, kind)` 作為身分邊界,跨 session 確認會 fail closed。
- `log_food` 單品 compatibility shim 已移除; grouped `items[]` 交易成為唯一 canonical meal write path,legacy single-item shape 在 JSON/SSE 都不會建立餐點、收據或 summary 變動。
- 新增 `policy-side-effect-gate` deterministic harness 與 NC-LLM-004 policy taxonomy ADR,per-tool policy table 由 live registry 產生並由 `yarn policy-taxonomy:check` 檢查 drift。
- 320px onboarding 年齡 wheel 新增 tap fallback 並保留 drag;使用者更新年齡後會以新年齡重新產生 daily targets。

### 變更

- 既有 numeric evidence、failed-recognition、target resolution 與 revision precondition guard 改以 registry named rules 表達,行為維持 fail-closed 且 metadata-only。
- Confirm-first commit 只接受後端保存的 proposal id / revision state,並以 atomic one-shot consume 防止重複確認造成二次 mutation。
- Policy gate trace 只保存 tool、policy class、decision、rule/proposal metadata 與 `turnId`,不保存 raw args、user prose、tool payload、provider body 或 session material。
- v2.8 closeout 維持本機驗證範圍;沒有 push、merge、deploy、Railway smoke、staging promotion 或 main promotion。

### 驗證

- Phase 83-87 verification 全部通過,涵蓋 grouped-only `log_food`、session-scoped pending state、tool policy gate、policy harness/taxonomy doc 與 320px onboarding age wheel。
- v2.8 milestone audit 通過 `14/14` scoped requirements、`5/5` phases 與 E2E flow checks;integration 有 1 個非阻塞 proof-quality debt,已由 integration tests 補強並記錄在 milestone audit。
- Closeout 前本機 `yarn release:check` 通過:TypeScript、`1,472` node tests、frontend production build 全部 green。Phase 87 browser harness 重新通過 320x760 tap/drag evidence。

## v2.7 - 2026-06-09

### 新增

- 失敗的圖片辨識現在在 `log_food` 工具邊界就被拒絕,不會建立假的餐點列、收據或 summary 變動欄位;大圖與小圖失敗路徑都顯示一致的 no-save 引導。
- 已刪除的餐點收據現在 fail-closed:無法與目前攝取總量矛盾,後續聊天追問也無法復活已刪除狀態。
- Home 暫存聊天草稿的 retry 與 cancel 現在最多只留一個可見的失敗 artifact,取消會清掉失敗橫幅與其連結的失敗/暫存內容。
- Onboarding 偏好 chip 重複點擊不再重複產生文字,選取狀態更清楚且保留 freeform 輸入。
- History 餐點列改為 detail-first 導覽:點列先進唯讀 Day Detail 並帶入 `targetMealId`,僅在有 authoritative 編輯權限時露出聚焦編輯,刪除仍限制在 Meal Edit 內。

### 變更

- 使用者主動停止的串流改顯示中性的「已停止」狀態文案,真正的失敗仍保留失敗文案;不支援的上傳檔在出現看似成功的附件狀態前就被拒絕。
- 390x844 行動視窗的 Meal Edit 控制項與展開的 Home 快捷動作不再被底部導覽遮擋且維持可點按;餐點 item 編輯/刪除控制項移除英文可見標籤並保留本地化無障礙標籤。
- 空 Chat starter 引導改為精簡、gated、行動端乾淨呈現;History 週標題改用相對標籤區分本週、上週與更早日期範圍。
- v2.7 closeout 維持本機驗證範圍;沒有 push、merge、deploy、Railway smoke、staging promotion 或 main promotion。

### 驗證

- Phase 78-82 verification 全部通過,涵蓋 failed-recognition no-save、deleted receipt integrity、chat draft/stream/upload lifecycle、onboarding 去重、mobile action safety 與 History detail-first navigation。
- v2.7 milestone audit 通過 `17/17` scoped requirements、`5/5` phases、cross-phase integration 與 E2E flow checks;Nyquist validation 為 partial-nonblocking(Phase 81 保留為 planning metadata,非 release blocker)。
- Closeout 前本機 `yarn release:check` 通過:TypeScript、`1,414` node tests、frontend production build 全部 green。Generated proof remains metadata-only.

## v2.6 - 2026-06-04

### 新增

- Home 今日餐點列現在可以直接開啟 Meal Edit，並沿用既有 public meal id / meal revision stale-protection contract。
- Grouped meals 現在支援 direct item-level add、edit、delete，透過嚴格 `items[]` full-list replacement contract 保存新的 meal revision。
- Meal Edit 新增 grouped meal editor，包含 item rows、驗證錯誤、stale conflict recovery、dirty discard，以及 media-free item DTO 邊界。
- History 週切換與日期切換改用 snapshot-backed pending state，避免 cold switch 或 fast click 時出現 disruptive loading jump / pending-copy flicker。

### 變更

- `/api/meals/:id` grouped PATCH 會保留 expected revision checks、affected date freshness、`summaryOutcome` 與 realtime publish path；scalar grouped fallback 仍保留為 unsupported shape。
- `/api/meals` read path 現在回傳 ordered、media-free grouped `items[]`，whole-meal image identity 保持在 meal level。
- Item-level photo mapping、monthly goals/analytics、hydration tracking、motion polish、coaching copy 與 broader infrastructure cleanup 仍明確 deferred。
- v2.6 closeout 維持本機驗證範圍；沒有 push、merge、deploy、Railway smoke、staging promotion 或 main promotion。

### 驗證

- Phase 74-77 verification 全部通過，涵蓋 Home edit entry、grouped CRUD server contract、grouped Meal Edit UI、History loading stabilization、metadata-only proof 與 no-promotion boundary。
- v2.6 milestone audit 通過 `15/15` scoped requirements、`4/4` phases、cross-phase integration 與 E2E flow checks，並確認所有 phase 都有 Nyquist validation artifact。
- Closeout 前本機 `yarn release:check` 重新通過：TypeScript、`1,362` tests、frontend production build 全部 green。Generated proof remains metadata-only.

## v2.5 - 2026-06-02

### 新增

- 後端 LLM provider 新增非串流、schema-backed structured object output contract，runtime OpenAI provider 與測試 provider 共用同一組成功、驗證失敗、provider 失敗與 fallback 語意。
- Onboarding 目標產生改走結構化輸出與 Zod 驗證，無效結果會 fail closed 到既有 deterministic fallback，不會保存 partial 或超界目標。
- 前端 API、SSE 與 Zustand state 寫入前新增 authoritative DTO validation，保護 daily summary、goals、history、day snapshot 與 chat terminal additions。
- 聊天 assistant reply、餐點 receipt identity 與 structured mutation outcome 現在透過原子 persistence 邊界保存；compressed history 改讀 persisted structured facts，不再由 display success copy 推論 tool outcome。
- Production-like runtime 會拒絕缺失、預設或過弱的 `GUEST_SESSION_SECRET`，並將 CORS policy 收斂為本機 Vite allowlist 與 production same-origin serving。

### 變更

- Target-generation failure telemetry 只記錄 sanitized reason，例如 `invalid_json`、`missing_field`、`bounds_failed` 或 `macro_calorie_mismatch`，不保存 raw model output。
- Malformed server payloads 會被 reject、omit 或維持既有 trusted state，而不是被 coerced 成 authoritative UI state。
- Route fallback catch-field redaction 集中到共用 sanitizer，structured events 與 `llm-trace.v2` 都套用同一個 raw-detail omission policy。
- Production dependency baseline 更新 `fastify`、`@fastify/static`，並用 Yarn resolutions 固定 patched `fast-uri` / `brace-expansion` transitive versions。
- v2.5 closeout 維持本機驗證範圍；沒有 push、merge、deploy、Railway smoke、staging promotion 或 main promotion。

### 驗證

- Phase 69-73 verification 全部通過，涵蓋 provider structured output、target generation、DTO guards、receipt/history persistence、compressed history、guest-secret/CORS hardening、fallback redaction，以及 local release proof。
- v2.5 milestone audit 通過 `18/18` scoped requirements、`5/5` phases、cross-phase integration 與 E2E flow checks，並確認所有 phase 都有 Nyquist validation artifact。
- Closeout 前後重新執行 `yarn release:check`；最終結果為 `1,330` tests passing 與 frontend production build passing。證據維持 metadata-only，不保存 raw prompt、user text、assistant final text、tool raw payload、provider body、image data、session material 或 database snapshot。

## v2.4 - 2026-05-30

### 新增

- 餐點記錄現在會保存使用者明確說出的餐別意圖，例如 `午餐`、`晚餐` 或 `宵夜`，並在今日、歷史、聊天收據與編輯 payload 中保留這個結構化事實。
- Chat 餐點數字修正新增後端權限邊界。只有同一輪訊息的明確數字，或使用者核准的後端提案，才能改 calories / macros。
- 模糊餐點修正與多候選目標現在會回傳後端產生的穩定澄清文案，包含可回覆的編號選項。
- `find_meals`、歷史 `log_food`、歷史 `get_daily_summary` 的澄清結果改用結構化 tool result 傳遞，不再依賴重新解析序列化 tool message JSON。

### 變更

- `log_food` 的 LLM JSON schema 與 Zod runtime 對 `protein_sources` 的 optional 行為已對齊，保留既有 trusted-protein 保護。
- 餐點候選排序改用明確日期、目前回合/今日/近期、食物標籤、持久化餐別事實等可解釋證據，避免弱提示靜默選錯歷史餐點。
- 修正失敗、澄清、過期提案與無授權數字路徑都維持 no-mutation、no `daily_summary` publish、no success-style copy。
- v2.4 closeout 仍維持本機驗證範圍；沒有 push、merge、deploy、Railway smoke、staging promotion 或 main promotion。

### 驗證

- Phase 65-68 verification 全部通過，涵蓋 tool schema、明確餐別保存、數字修正權限、目標排序、澄清渲染、結構化 tool-result plumbing。
- Phase 68 release proof 記錄 `yarn tsc --noEmit` 與 `yarn release:check` 通過，`yarn release:check` 共 1,245 tests passed 並完成 frontend build。
- 沒有新增 harness artifact；v2.4 證據維持 command/file/status metadata-only，不保存 raw prompt、user text、assistant final text、tool payload、provider body、image data、session material 或 database snapshot。

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
