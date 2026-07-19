# 更新日誌

## v3.4 - Unreleased

### 變更

- 正式終止 v3.4.1 原五階段 runtime/demo 計畫，保留一頁 postmortem 與 source release、runtime safety and refresh、public validation 三個 deployment gates；Phase 114–118 不恢復或繼續，五分鐘 timed demo 不再是第四個 gate。
- Repository Recalibration Stage 2 修復 signed `release:check` 的完整 gate-run writer fence、release child 的 `GIT_*` allowlist，以及 privacy-bounded gate failure diagnostics；每項均有舊行為會失敗的 deterministic regression proof。
- Repository Recalibration Stage 3 移除已完成 hardening episode 專用的 pilot seed、workflow telemetry、Phase 115 R03 reducer、runtime parity matrix 與 readiness/resume contract；保留 release-check、lease/writer fence、receipt、state-check、planning closeout、tree fingerprint、artifact provenance/seal、plan-proof 與 production recovery。
- Home 營養卡片現在由明確的 entry/update/replay intent、Zustand 狀態與單一時間軸驅動；冷啟動、手動重新整理、返回 Home、餐點編修與 SSE 更新會依來源選擇 replay 或 delta，並維持可測試的同步動畫與 scroll-to-top 邊界。
- 新增公開英文 AI-safety case study `docs/ai-safety-case.md`，以 AS-01 到 AS-18 claim/evidence contract 對應 CASE-09 到 CASE-17 的 deterministic instruction/authority 與 nutrition-safety 邊界；這是既有證據的公開敘事，不是 runtime safety-system 變更。
- ADR 0010 將 1200 kcal/day 記錄為 conservative、non-clinical product safety floor，並明確排除 universal medical advice 或 personalized clinical recommendation 的解讀。
- 公開文件以相同四欄結構誠實揭露 #107、#108、#109 的 conversational-quality gaps，保留 deterministic guard 與 future eval 問題的界線，不在本 phase 提出修復或 eval framework。
- 新增公開 `docs/reviewer-tour.md` 十站／30 分鐘 reviewer path，並同步 README 與 README-en 的三段式 portfolio narrative；這是既有 architecture 與 AI-safety 證據的導覽層，不是 runtime 或 safety-policy 變更。
- Phase 113 新增 `docs/demo-runbook.md` 的 DEMO-02 named-tunnel runbook handoff 與 DEMO-04 五分鐘固定 script；這只記錄 source 文件，未表示已合併 `main`、刷新 runtime、變更 tunnel、通過 public smoke、關閉 #54 或通過 live semantic demo。
- Source-attested build wrapper 現在只會發佈所選 committed snapshot 產生的 substantive client shell；無效輸出、取消、timeout 或 source drift 都會保留既有 publication，frozen adversarial matrix 也以精確註冊／執行計數和 missing／stale manifest timeout 變體形成可執行證據。
- `release:check` 現在以 allowlisted structured receipt 保存第一個 failing gate 與實際 process termination，並以前後 workspace fingerprint 阻止 gate 執行期間的 evidence drift；raw child output、private path 與舊式 output-text locator 不會成為分類來源。
- 新增 non-GSD workflow-hardening 工具與 contract，涵蓋 storage recovery、state／verification freshness、signed closeout journal、planning-proof lint、runtime lease／artifact provenance、parity 與 privacy-bounded telemetry；這些控制不會自行解除 Temporary GSD Maintenance Pause，也不授權 Phase 115、production、merge 或 deploy。
- Workflow contract tests 不再讀取 Git ignored 的本機 runbook／skill，改由 tracked deployment、workflow、release-check、ignore policy、planning-proof 與 state-check source 提供 clean-clone 可重現的契約證據。
- Runtime parity checker 不再執行或載入 installed GSD core，而是先驗證 single-link byte snapshot／closed digest manifest，再以 inert JSON literal parser 讀取 generated registry projection；activation 後的 planner/checker bindings 與空 finding baseline 也已更新至 tracked matrix。
- `release:check` 的 full-test child 現在明確以 `NODE_ENV=test` 執行，避免 production-mode `.env` 把測試 fixture 誤判為 deployed runtime；其他 generated-doc 與 frontend build gates 仍保留既有 release 環境。
- Deployment authority 現在一致固定為 PR-ready → human merge → post-merge local archive → separate runtime refresh，且 runtime lane 依序為 B01 recovery readiness → R05 migration → R06 build/start；Tunnel mutation 與 public smoke 仍是獨立 gate。

### 驗證

- Phase 110 的 reducer、timeline、store trigger 與 UI contract 測試通過，固定人工 visual checklist 也完成 10/10；主觀畫面判斷沿用已核准證據，未在收尾階段自行重做 browser 驗收。
- 新增 dependency-free Node contract，檢查 AS-01 到 AS-18、CASE-09 到 CASE-17、標題與 Mermaid/table 結構、literal test-title evidence、公開連結與 private-path exclusion。
- Phase 111 的 machine gates 包含 AI-safety quick contract、named unit/integration evidence regressions、`yarn tsc --noEmit`、`yarn test:unit`、behavior-matrix drift/harness 檢查與 final `yarn release:check`；release、merge、tag、tunnel 與 production action 仍是分開授權的後續 gate。
- Phase 112 的 dependency-free reviewer-tour contract 鎖定十個問題、tour-to-source 一 hop／README-to-source 兩 hop 邊界，並搭配 capability 與 behavior generated-doc checks；通過只代表文件契約與 drift gate，不是 runtime、safety-policy 或 release completion 聲明。
- Phase 113 的 dependency-free demo contract 鎖定 named-tunnel SSE authority、固定 script 與上述 source-only non-claim boundary；focused contract 與 `yarn tsc --noEmit` 通過仍未表示已合併 `main`、刷新 runtime、變更 tunnel、通過 public smoke、關閉 #54 或通過 live semantic demo。
- Phase 113.1 的 fresh verifier 通過 5/5 must-haves，focused source-wrapper 測試通過 43/43、demo contract 通過 27/27、TypeScript 檢查通過；ASVS Level 2 security audit 關閉 10/10 threats，`threats_open: 0`。
- v3.4 milestone audit 通過 12/12 requirements、5/5 phases、13/13 integration connections 與 5/5 source flows；Phase 113 的歷史 `gaps_found` 由 Phase 113.1 的 BUILD-01 精確關閉，未改寫或豁免原始 verifier 證據。
- Workflow-hardening focused fixtures 會拒絕 known receipt misclassification、frozen state drift、stale dependency seal、closeout recurrence／directory false-pass、planner proof false-pass、lease/provenance replay與 telemetry escape overclaim；核准的 exact ruleset canary behavioral proof 已於 2026-07-16 完成並清理，maintainer 同日以 exact R1 決策解除 Temporary GSD Maintenance Pause 並 reconcile `.planning` state；pilot、production migration、runtime refresh、Tunnel 與 public smoke 仍未執行。
- Workflow integrity closure 的 hostile-core marker negative control、post-activation wiring check、live runtime parity、本機 full suite `2494/2494` 與 no-local clean-clone release gate 已通過；GitHub required check 仍以實際 PR gate 結果為準。

## v3.3 - 2026-07-05

### 變更

- LLM system prompt 現在明確定義指令階層、隱私揭露邊界與 untrusted user data 處理方式；profile、history、image text、tool-like text 與使用者輸入會被視為較低優先序資料，而不是工具授權來源。
- Internal disclosure refusal contract 覆蓋 hidden prompt、tool/schema、provider payload、stack/debug trace 與 backend internals，並保留 reply sanitizer 作為 final defense，不把 sanitizer 當成主要政策來源。
- Behavior matrix 新增 named adversarial cases，涵蓋 profile injection、prompt/tool disclosure、malicious tool JSON、unauthorized goal update、history/tool-like injection，以及 nutrition-safety cases；generated docs 與 artifacts 維持 metadata-only。
- Nutrition safety boundary 新增 disordered eating、extreme restriction、very-low-calorie、rapid weight-loss 與 punitive exercise handling；低熱量目標變更會經過 prompt、tool、manual route、proposal action 與 client proposal-state 多層 guard。
- Goal proposal 與 UAT-21 gap closure 強化 active proposal authority、target signature、latest-only actionability、macro/calorie consistency、question-form non-mutation、baseline-aware copy、applied receipt copy，以及 duplicate-equivalent proposal guard。
- `yarn release:check` 現在也檢查 capability matrix 與 behavior matrix generated-doc drift；舊 visual scenario 檔頭補上可重跑的 evidence command。

### 驗證

- Phase 106-109 驗證全部通過：Instruction Boundary `16/16`、Internal Disclosure `15/15`、Adversarial Harness `21/21`、Nutrition Safety `52/52`。
- v3.3 milestone audit 通過 `12/12` requirements、`4/4` phases、`4/4` integration checks 與 `4/4` flow checks；open-artifact audit 沒有 open debug、quick、thread、todo、seed、UAT、verification 或 context items。
- UAT-21 最終 live closure 已完成：2026-07-05 pending-proposal replay 保留同一張 1200 kcal active card，兩次 `啥` 沒有新增 proposal card 或 apply claim；剩餘 conversational-quality 項目轉交 GitHub #107、#108、#109 的 future eval-based work。
- 非阻塞 warning 保留為明確 disposition：CASE-14 harness artifact 未觀察 queued unsafe `update_goals` tool path，但 unit/integration tests 覆蓋真實 guard；UI review polish recommendations 不阻塞 source release。
- 收尾階段的 `yarn release:check` 通過：Asia/Taipei timezone contract、TypeScript、`2,032` 個 Node tests、capability / behavior matrix generated-doc drift checks，以及 frontend production build。
- v3.3 source wrap 不代表 `main` merge、tag movement、Cloudflare Tunnel change、public smoke 或 production runtime refresh；這些仍需要分開明確授權。

## v3.2 - 2026-06-27

### 變更

- Next-meal 與 compact coach guidance 會先使用後端持有的 planning facts，再產生 assistant advice；剩餘熱量與 macros 因此能形成具體餐點結構，且 model prose 不會和 deterministic mutation receipts 互相矛盾。
- 餐點修正與 routing guardrails 會阻止近期類似修正的 follow-up 重複建立餐點紀錄，讓運動與非食物請求維持不產生 mutation，並允許明確的 photo-analysis、menu、reference prompts 在不自動記錄餐點的情況下回答。
- Mobile web navigation 會把已驗證使用者的 Android Back 行為留在 app shell 內，並為 Home、History、onboarding 與 pre-shell 路徑加入下拉重新整理與復原介面；onboarding Back 收尾證據改由 metadata-only Round 7e logger 記錄。
- History 週導覽會延後顯示 pending feedback，並移除 pending-divider 閃爍，避免畫面在 week strip、stats、hero 與 timeline 之間產生視覺跳動。
- v3.2 regression 證據索引六個 demo scenarios，涵蓋 coach planning、correction routing、unsupported-domain routing、photo-analysis boundaries、Android/mobile navigation 與 History transition polish，且不新增 production/runtime side effects。

### 驗證

- Phase 102-105 驗證通過，`10/10` scoped requirements 均已滿足，所有 active phase validation/security artifacts 也都存在。
- 確定性證據包含目標式 unit/integration coverage、`meal-intent-routing` harness scenario、metadata-only Android logger evidence，以及 metadata-only History visual smoke。
- v3.2 milestone audit 通過 `10/10` requirements、`4/4` phases、`4/4` integration checks 與 `6/6` selected demo-regression flows；Home refresh animation polish 已延後到 GitHub issues #93、#94、#95。
- 收尾階段的 `yarn release:check` 通過：Asia/Taipei timezone contract、TypeScript、`1,844` 個 Node tests，以及 frontend production build。
- v3.2 收尾後僅達到 source/PR 準備完成狀態；沒有執行 `main` merge、tag movement、Cloudflare Tunnel change、public smoke 或 production runtime refresh。

## v3.1 - 2026-06-23

### 變更

- Source docs 定義 production-equivalent runtime 的支援邊界：單一 Fastify process、單一 SQLite database path、穩定的本機 asset directories、request-local upload staging，以及 process-local SSE fan-out；ADR 0007 也記錄任何 multi-instance claim 前必須滿足的前置條件。
- Runtime numeric config 會在 `buildApp()` startup 期間驗證 `PORT`、`GUEST_SESSION_TTL_SECONDS` 與 `GUEST_SESSION_RESUME_TTL_SECONDS`，並透過 `app.runtimeConfig` 暴露設定；不安全或超出範圍的數值會在 listen/session 建構前被拒絕。
- ADR 0008 記錄目前 OpenAI Provider Chat Completions compatibility baseline，涵蓋 SDK/model path、tool calling、image input、streaming、structured output、abort handling 與 metadata-only error normalization。
- `yarn deps:audit` 新增 Yarn-only dependency advisory evidence；ADR 0009 記錄 advisory triage、deferral、release-blocking rules，以及目前 `drizzle-orm` / transitive `form-data` 的處置。
- `yarn native:check` 新增 deterministic Sharp 與 file-backed `better-sqlite3` native compatibility evidence；文件也說明 native evidence 只代表 source-readiness。

### 驗證

- Phase 98-101 驗證通過：Runtime Boundary & Config Fail-Fast `9/9`、OpenAI Provider Compatibility `8/8`、Dependency Advisory Policy `12/12`、Native Dependency Compatibility Gates `14/14`。
- 四個 phase 的 Nyquist validation 均符合要求，沒有缺少 validation artifacts。
- 收尾 source-readiness checks 通過：`yarn deps:audit` 找到 ADR 0009 已記錄的兩個預期 high runtime advisories，`yarn native:check` 通過 `6/6` tests，`yarn release:check` 通過 TypeScript、`1,741` 個 Node tests 與 Vite production build。
- v3.1 收尾後僅達到 PR/source 準備完成狀態；除了 PR #84 授權外，沒有執行 `main` merge authorization、tag movement、Cloudflare Tunnel change、public smoke 或 production runtime refresh。

## v3.0.1 - 2026-06-21

### 變更

- Protected browser/API routes 共用同一個 cookie-derived ownership boundary；raw `deviceId`、query、body 與 `x-device-id` selectors 會 fail closed，避免 protected handlers 使用不可信 ownership。
- Guest-session cookies 帶有 server-side session version；logout/session reset 會提升 device session epoch，讓被複製或過期前的 resume cookies 可在自然到期前失效。
- Streaming reply sanitization 對 finalized replies 與 emitted SSE chunks 使用同一套 shared policy，避免 split `(n/n)` counters 在相鄰 stream chunks 間外洩。
- Browser `/api/sse` clients 只在永久 `EventSource.CLOSED` 後透過既有 guest-session recovery path 復原；暫時的 `CONNECTING` 狀態交由瀏覽器處理。
- Chat fallback/error stream terminals 會發出 authoritative `done.replyText`，前端會取代 provisional partial text，而不是附加重複 fallback copy。
- `daily-rollover` harness 證據會斷言目前 Asia/Taipei SSE date 的精確值，不再接受任意字串。

### 驗證

- Phase 95-97 驗證通過：Ownership Boundary PreHandler `22/22`、Guest Session Revocation `21/21`、Streaming/SSE Terminal Proof `21/21`。
- v3.0.1 milestone audit 通過 `11/11` scoped requirements、`3/3` phases、`5/5` integration checks、`5/5` E2E flows，Nyquist coverage 也符合要求。
- `guest-session-hardening` 與 `daily-rollover` 的 deterministic harness evidence 通過；產生的 artifacts 維持 metadata-only。
- 收尾 pre-check 通過，僅剩暫時性的 `.planning/research/.cache` hygiene 需在 archive 時清理。
- `yarn release:check` 通過：TypeScript、`1,710` 個 Node tests 與 frontend production build。
- v3.0.1 收尾後僅達到 source/PR 準備完成狀態；沒有執行 `main` merge、tag movement、Cloudflare Tunnel change、public smoke 或 production runtime refresh。

## v2.10 - 2026-06-18

### 變更

- Protected browser routes 以 signed guest-session cookie 作為 ownership authority，不再接受 raw `legacyDeviceId`、`x-device-id` 或 `deviceId` selector 來擴大讀寫範圍。
- Deployed-like runtime 會拒絕 missing/default/short `GUEST_SESSION_SECRET`，避免 guest-session HMAC fallback 變成可偽造 session；dev/test legacy migration 仍保留。
- Mutation receipts 由 committed backend facts 驅動：沒有實際 mutation 的 turn 不會產生 log/update/delete/goal 成功文案；delete 也必須有 committed delete fact 才能說已刪除。
- Multi-item meal receipt 的 public `position` 保留 persisted 0-based contract，讓 receipt 內每個 item 都能回到 strict edit payload。
- Confirm-first proposal 在 non-precondition failure 後會保留為 retryable；重複確認已處理的 proposal 會回傳 deterministic idempotent copy，不會 double mutate。
- `README-en.md` 補齊 v2.5-v2.10 期間的 structured LLM output、DTO guard、confirm-first proposal、Home/History/Meal Edit 與 coach advice 架構摘要。
- PR 檢查新增 issue-first / changelog / local `.planning/**` policy gate，並在 GitHub Actions pull request path 執行。

### 驗證

- Phase 92-94 驗證全部通過：Ownership & Session Integrity `4/4`、Mutation Truthfulness `5/5`、Confirm-First Integrity `20/20`。
- `guest-session-hardening` deterministic harness 通過，ownership-bypass 與 receipt guard evidence 維持 metadata-only。
- 收尾前本機 `yarn release:check` 通過：TypeScript、`1,625` 個 Node tests 與 frontend production build。
- v2.10 收尾維持本機驗證範圍；沒有 push、merge、deploy、Railway smoke、staging promotion 或 main promotion。

## v2.9 - 2026-06-15

### 新增

- 使用者要求「幫我估合理一點」時，meal numeric correction 會建立後端保存的 confirm-first estimate proposal，顯示 before -> after values，並只在使用者明確確認後提交。
- `delete_meal` 改為 confirm-first preview：先顯示後端渲染的餐點描述、日期/餐別、calories 與 macros，確認後才透過 revision-safe delete path 刪除。
- Pending goal、meal numeric、estimate、delete proposals 都有結構化 approve / edit-via-new-message / reject affordance；button action 只傳 proposal intent，commit authority 仍在後端。
- Pending proposal 過期、stale 或被 supersede 時會保留 deterministic Traditional Chinese lapse copy，不再靜默消失。
- Home coach advice 與 CTA 會依使用者 goal、今日紀錄與剩餘 targets 選擇 copy / next action；missing 或 unknown goal 會安全 fallback 到 maintain。

### 變更

- Confirm-first action reply persistence 改為 single-source backend path，避免 button/typed confirmation 造成重複 assistant reply 或 action event。
- Proposal action mutation、terminal card status、chat action event 與 realtime publish 會依 durable order 提交：domain mutation 和 metadata commit 完成後，才 publish `goals_update` 或 `daily_summary`。
- 模糊餐點數字修正仍 fail closed；只有明確使用者數字、backend-computable relative operator，或後端保存的 estimate proposal confirmation 能提交。
- v2.9 收尾維持本機驗證範圍；沒有 push、merge、deploy、Railway smoke、staging promotion 或 main promotion。

### 驗證

- Phase 88-91 驗證全部通過，涵蓋 estimate confirm-first、delete preview confirmation、structured proposal card/action/lapse behavior，以及 goal-aware coach advice / CTAs。
- Deterministic harness evidence 通過：`estimate-confirm-first` `9/9`、`delete-confirm-first` `10/10`、`proposal-three-way-confirmation` `10/10`；artifact policy 維持 metadata-only。
- 收尾前本機 `yarn release:check` 通過：TypeScript、`1,574` 個 Node tests 與 frontend production build。產生的證據維持 metadata-only。

## v2.8 - 2026-06-12

### 新增

- Tool side-effect policy 由後端 tool contract 強制執行，不再依賴 LLM 自述信心；8 個目前註冊的 tool 都分類為 `direct-execute`、`execute-and-report`、`clarify-first` 或 `confirm-first`。
- Confirm-first 提案改用 session-scoped pending state：`turn_states` 以 `(device_id, session_id, kind)` 作為身分邊界，跨 session 確認會 fail closed。
- `log_food` 單品 compatibility shim 已移除；grouped `items[]` 交易成為唯一 canonical meal write path，legacy single-item shape 在 JSON/SSE 都不會建立餐點、收據或 summary 變動。
- 新增 `policy-side-effect-gate` deterministic harness 與 NC-LLM-004 policy taxonomy ADR；per-tool policy table 由 live registry 產生，並由 `yarn policy-taxonomy:check` 檢查 drift。
- 320px onboarding 年齡 wheel 新增 tap fallback 並保留 drag；使用者更新年齡後會以新年齡重新產生 daily targets。

### 變更

- 既有 numeric evidence、failed-recognition、target resolution 與 revision precondition guard 改以 registry named rules 表達；行為維持 fail-closed 且 metadata-only。
- Confirm-first commit 只接受後端保存的 proposal id / revision state，並以 atomic one-shot consume 防止重複確認造成二次 mutation。
- Policy gate trace 只保存 tool、policy class、decision、rule/proposal metadata 與 `turnId`，不保存 raw args、user prose、tool payload、provider body 或 session material。
- v2.8 收尾維持本機驗證範圍；沒有 push、merge、deploy、Railway smoke、staging promotion 或 main promotion。

### 驗證

- Phase 83-87 驗證全部通過，涵蓋 grouped-only `log_food`、session-scoped pending state、tool policy gate、policy harness/taxonomy doc 與 320px onboarding age wheel。
- v2.8 milestone audit 通過 `14/14` scoped requirements、`5/5` phases 與 E2E flow checks；integration 有 1 個非阻塞證據品質 debt，已由 integration tests 補強並記錄在 milestone audit。
- 收尾前本機 `yarn release:check` 通過：TypeScript、`1,472` 個 Node tests 與 frontend production build。Phase 87 browser harness 重新通過 320x760 tap/drag evidence。

## v2.7 - 2026-06-09

### 新增

- 失敗的圖片辨識會在 `log_food` 工具邊界被拒絕，不會建立假的餐點列、收據或 summary 變動欄位；大圖與小圖失敗路徑都顯示一致的 no-save 引導。
- 已刪除的餐點收據會 fail closed：無法與目前攝取總量矛盾，後續聊天追問也無法復活已刪除狀態。
- Home 暫存聊天草稿的 retry 與 cancel 最多只留一個可見的失敗 artifact；取消會清掉失敗橫幅與其連結的失敗/暫存內容。
- Onboarding 偏好 chip 重複點擊不再重複產生文字，選取狀態更清楚且保留 freeform 輸入。
- History 餐點列改為 detail-first 導覽：點列先進唯讀 Day Detail 並帶入 `targetMealId`，僅在有 authoritative 編輯權限時露出聚焦編輯，刪除仍限制在 Meal Edit 內。

### 變更

- 使用者主動停止的串流改顯示中性的「已停止」狀態文案，真正的失敗仍保留失敗文案；不支援的上傳檔會在出現看似成功的附件狀態前被拒絕。
- 390x844 行動視窗的 Meal Edit 控制項與展開的 Home 快捷動作不再被底部導覽遮擋，且維持可點按；餐點 item 編輯/刪除控制項移除英文可見標籤，並保留在地化無障礙標籤。
- 空 Chat starter 引導改為精簡、gated、行動端乾淨呈現；History 週標題改用相對標籤區分本週、上週與更早日期範圍。
- v2.7 收尾維持本機驗證範圍；沒有 push、merge、deploy、Railway smoke、staging promotion 或 main promotion。

### 驗證

- Phase 78-82 驗證全部通過，涵蓋 failed-recognition no-save、deleted receipt integrity、chat draft/stream/upload lifecycle、onboarding 去重、mobile action safety 與 History detail-first navigation。
- v2.7 milestone audit 通過 `17/17` scoped requirements、`5/5` phases、cross-phase integration 與 E2E flow checks；Nyquist validation 為 partial-nonblocking，Phase 81 保留為 planning metadata，並非 release blocker。
- 收尾前本機 `yarn release:check` 通過：TypeScript、`1,414` 個 Node tests 與 frontend production build。產生的證據維持 metadata-only。

## v2.6 - 2026-06-04

### 新增

- Home 今日餐點列可以直接開啟 Meal Edit，並沿用既有 public meal id / meal revision stale-protection contract。
- Grouped meals 支援 direct item-level add、edit、delete，透過嚴格 `items[]` full-list replacement contract 保存新的 meal revision。
- Meal Edit 新增 grouped meal editor，包含 item rows、驗證錯誤、stale conflict recovery、dirty discard，以及 media-free item DTO 邊界。
- History 週切換與日期切換改用 snapshot-backed pending state，避免 cold switch 或 fast click 時出現 disruptive loading jump / pending-copy flicker。

### 變更

- `/api/meals/:id` grouped PATCH 保留 expected revision checks、affected date freshness、`summaryOutcome` 與 realtime publish path；scalar grouped fallback 仍保留為 unsupported shape。
- `/api/meals` read path 回傳 ordered、media-free grouped `items[]`，whole-meal image identity 保持在 meal level。
- Item-level photo mapping、monthly goals/analytics、hydration tracking、motion polish、coaching copy 與 broader infrastructure cleanup 明確 deferred。
- v2.6 收尾維持本機驗證範圍；沒有 push、merge、deploy、Railway smoke、staging promotion 或 main promotion。

### 驗證

- Phase 74-77 驗證全部通過，涵蓋 Home edit entry、grouped CRUD server contract、grouped Meal Edit UI、History loading stabilization、metadata-only 證據與 no-promotion boundary。
- v2.6 milestone audit 通過 `15/15` scoped requirements、`4/4` phases、cross-phase integration 與 E2E flow checks，並確認所有 phase 都有 Nyquist validation artifact。
- 收尾前本機 `yarn release:check` 重新通過：TypeScript、`1,362` 個 tests 與 frontend production build。產生的證據維持 metadata-only。

## v2.5 - 2026-06-02

### 新增

- 後端 LLM provider 新增非串流、schema-backed structured object output contract；runtime OpenAI provider 與測試 provider 共用同一組成功、驗證失敗、provider 失敗與 fallback 語意。
- Onboarding 目標產生改走 structured output 與 Zod 驗證；無效結果會 fail closed 到既有 deterministic fallback，不會保存 partial 或超界目標。
- 前端 API、SSE 與 Zustand state 寫入前新增 authoritative DTO validation，保護 daily summary、goals、history、day snapshot 與 chat terminal additions。
- 聊天 assistant reply、餐點 receipt identity 與 structured mutation outcome 透過原子 persistence 邊界保存；compressed history 改讀 persisted structured facts，不再由 display success copy 推論 tool outcome。
- Production-like runtime 會拒絕缺失、預設或過弱的 `GUEST_SESSION_SECRET`，並將 CORS policy 收斂為本機 Vite allowlist 與 production same-origin serving。

### 變更

- Target-generation failure telemetry 只記錄 sanitized reason，例如 `invalid_json`、`missing_field`、`bounds_failed` 或 `macro_calorie_mismatch`，不保存 raw model output。
- Malformed server payloads 會被 reject、omit 或維持既有 trusted state，而不是被 coerced 成 authoritative UI state。
- Route fallback catch-field redaction 集中到共用 sanitizer，structured events 與 `llm-trace.v2` 都套用同一個 raw-detail omission policy。
- Production dependency baseline 更新 `fastify`、`@fastify/static`，並用 Yarn resolutions 固定 patched `fast-uri` / `brace-expansion` transitive versions。
- v2.5 收尾維持本機驗證範圍；沒有 push、merge、deploy、Railway smoke、staging promotion 或 main promotion。

### 驗證

- Phase 69-73 驗證全部通過，涵蓋 provider structured output、target generation、DTO guards、receipt/history persistence、compressed history、guest-secret/CORS hardening、fallback redaction，以及 local release 證據。
- v2.5 milestone audit 通過 `18/18` scoped requirements、`5/5` phases、cross-phase integration 與 E2E flow checks，並確認所有 phase 都有 Nyquist validation artifact。
- 收尾前後重新執行 `yarn release:check`；最終結果為 `1,330` 個 tests passing 與 frontend production build passing。證據維持 metadata-only，不保存 raw prompt、user text、assistant final text、tool raw payload、provider body、image data、session material 或 database snapshot。

## v2.4 - 2026-05-30

### 新增

- 餐點記錄會保存使用者明確說出的餐別意圖，例如「午餐」、「晚餐」或「宵夜」，並在今日、歷史、聊天收據與編輯 payload 中保留這個結構化事實。
- Chat 餐點數字修正新增後端權限邊界。只有同一輪訊息的明確數字，或使用者核准的後端提案，才能改 calories / macros。
- 模糊餐點修正與多候選目標會回傳後端產生的穩定澄清文案，包含可回覆的編號選項。
- `find_meals`、歷史 `log_food`、歷史 `get_daily_summary` 的澄清結果改用結構化 tool result 傳遞，不再依賴重新解析序列化 tool message JSON。

### 變更

- `log_food` 的 LLM JSON schema 與 Zod runtime 已對齊 `protein_sources` 的 optional 行為，並保留既有 trusted-protein 保護。
- 餐點候選排序改用明確日期、目前回合/今日/近期、食物標籤、持久化餐別事實等可解釋證據，避免弱提示靜默選錯歷史餐點。
- 修正失敗、澄清、過期提案與無授權數字路徑都維持 no-mutation、no `daily_summary` publish、no success-style copy。
- v2.4 收尾仍維持本機驗證範圍；沒有 push、merge、deploy、Railway smoke、staging promotion 或 main promotion。

### 驗證

- Phase 65-68 驗證全部通過，涵蓋 tool schema、明確餐別保存、數字修正權限、目標排序、澄清渲染、結構化 tool-result plumbing。
- Phase 68 release 證據記錄 `yarn tsc --noEmit` 與 `yarn release:check` 通過；`yarn release:check` 共 `1,245` 個 tests 通過，並完成 frontend build。
- 沒有新增 harness artifact；v2.4 證據維持 command/file/status metadata-only，不保存 raw prompt、user text、assistant final text、tool payload、provider body、image data、session material 或 database snapshot。

## v2.3 - 2026-05-19

### 新增

- 目標變更先由後端建立明確提案。使用者只回「好」這類簡短確認時，系統只會套用有效的啟用中提案；如果沒有提案，就必須在同一輪訊息裡明確提供新的數字目標。
- 可編輯的餐點與聊天收據帶有餐點修訂身分資訊。後端會檢查更新/刪除請求是否基於最新版本，避免舊收據覆蓋較新的餐點資料。
- `daily_summary` SSE 使用嚴格 envelope，帶有 `affectedDate` 與 `source`。前端可以用這些資訊重新整理同日餐點列，或讓相符的歷史日期資料失效。
- v2.3 補齊 metadata-only 證據，涵蓋目標變更權限、已提交的 mutation outcome、過期收據拒絕、SSE freshness，以及 release gate 收尾。

### 變更

- 目標更新失敗或被拒絕時，回覆文案由後端決定。這些路徑不會改變 targets、不會 publish `goals_update`，也不會讓 LLM 寫出像成功一樣的回覆。
- 餐點記錄、更新、刪除，以及 direct meal `PATCH` / `DELETE` response 透過 `summaryOutcome` 區分「餐點 mutation 已提交」和「summary refresh degraded/unavailable」。
- 同日即時摘要更新會先重新整理餐點列，再提交較新的總計。歷史日期事件只會讓相符的畫面資料失效，不會覆蓋今天的資料。
- 例行完整性證據維持 metadata-only，不保存 raw prompts、user text、assistant final text、tool payloads、provider bodies、image data、session material 或 database snapshots。

### 驗證

- v2.3 milestone audit 通過 `17/17` requirements、`5/5` phases、`10/10` cross-phase integrations、`5/5` E2E flows，以及 Phase 60-64 的 Nyquist coverage。
- Audit 留下兩項已接受的 advisory debt，已記錄供後續規劃。
- Phase 64 verification 記錄目標、mutation、過期收據、SSE freshness、artifact privacy、`yarn tsc --noEmit`、`yarn release:check` 證據全部通過。
- v2.3 本機收尾期間沒有執行 staging 或 production promotion。

## v2.2 - 2026-05-15

### 新增

- 每個 chat turn 都有伺服器產生的 `turnId`。同一個 `turnId` 會串起 SSE start/done payloads、JSON responses、route logs、orchestrator child logs、trace facts，以及前端 fallback 參考資訊。
- 使用者看到 fallback/error bubble 時，可以看到短參考碼，例如 `引用碼 t-XXXXXXXX`。完整 UUID turn id 仍只留在內部追查用。
- OpenAI provider failure 會被整理成 metadata-only 格式，只保留 allowlisted status、provider request id、error class/type/code、operation、model，以及 abort flag。
- Orchestrator 新增 structured `onLLMError` 與 fallback hook payloads，讓 route 可以讀到安全的 provider metadata。
- `llm-trace.v2` harness evidence 新增 metadata-only 的 `llm_error`、`orchestrator_fallback`、`route_fallback`，以及 provider error counts。
- 新增專用的 `provider-auth-failure-localization` harness 證據，用來覆蓋 auth-style provider failures。

### 變更

- 聊天完成狀態分得出「真的完成」和「走 fallback」兩種情況，對應事件是 `chat_turn_completed` 與 `chat_route_fallback`。
- Route catch logging 記錄 sanitized/truncated route error facts，不再依賴空 catch bindings 或 raw thrown messages。
- Provider 串流中途接續失敗時，系統會把它記成 metadata-only 的 `llm_error` route fallback，不會再誤算成成功完成的聊天。
- Auth-style fallback 文案檢查只留在 runtime memory；產生的 release artifacts 只保存 metadata counts 與 booleans，不保存使用者可見的 assistant text。

### 驗證

- v2.2 milestone audit 通過 `20/20` requirements、`4/4` phases、`4/4` integration checks、`4/4` E2E flows，以及 `4/4` Nyquist validation coverage。
- Phase 58 verification 記錄 targeted JSON/SSE integration tests、`provider-auth-failure-localization`、`text-log`、auth trace shape/privacy scans、`yarn tsc --noEmit`、`yarn build`、`yarn test`、`yarn release:check` 全部通過。
- v2.2 收尾期間沒有執行 staging 或 production promotion。

## v2.1 - 2026-05-12

### 新增

- Chat/logging LLM workflows 新增 active prompt version 與 stable section IDs，方便追查 prompt 版本與段落來源。
- Chat/logging harness runs 會產生通用的 redacted `llm-trace.json` artifacts，包含 prompt metadata、workflow sequence、final reply source/shape、latency、round count，以及 tool count。
- 新增共用 AI behavior assertions 與 8-case `behavior-matrix` harness，覆蓋高風險 logging、prompt-injection、medical-boundary，以及 receipt-consistency regressions。
- 成功的記錄、更新、刪除與目標變更會用已提交的 `MutationEffects` 產生 deterministic mutation receipt。

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
- 進行中的 AI generation 或 meal analysis 可以平順停止，不會讓 Chat 留在不完整狀態。
- 聊天收據、今日餐點列、歷史紀錄、日期詳情、餐點編輯，以及 authorized asset fetches 之間，能維持穩定的餐點圖片連續性。
- Grouped meal logging 有了 canonical 語意，包含 item counts、grouped correction routing、grouped 餐點編輯唯讀項目細節，以及 deterministic grouped-meal harness coverage。
- 受控目標與 `log_food` validation failures 會輸出 redacted validation diagnostics。
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
- Phase 49 true-stack UAT 使用真實 client/API/SQLite data，沒有 route mocks，通過 `7/7` scenarios。
