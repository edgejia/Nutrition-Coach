# AI Orchestrator Meal Transaction Design

整理日期：2026-04-14

## Purpose

這份文件是 Nutrition Coach v2 AI orchestrator 的前導設計文件，不是 implementation spec。

它延伸自 `docs/ai-orchestrator-learning-notes.md` 的核心觀點：下一步不是寫更多 prompt，而是把 LLM 的可用能力、可見工具、狀態、執行規則、錯誤恢復，逐步下沉成後端可驗證的程式結構。

此文件只保留大方向、產品決策、AI 控制邊界與後續規劃切分。具體 table schema、tool args、migration SQL、test harness case、turn state payload，應在後續 implementation specs 中展開。

## Architecture Principles

這份設計不是單純的 food logging schema 改版。核心目標是把 LLM 從「主控者」降成「受控的語意處理器」。

核心原則：

- LLM 不擁有副作用；domain layer 擁有副作用。
- Tool visibility 是 orchestrator policy，不是 prompt 建議。
- Candidates 必須來自 DB；LLM 只能提供 search hints。
- 成功確認、營養數字、summary signal 由程式決定。
- LLM 負責語意理解與教練語氣；不能改寫系統事實。
- TurnTrace 是驗證「AI 是否被正確約束」的主要工具。

這對應 Claude Code 給本專案的主要啟發：tool 不是模型想 call 就 call 的 function，而是由系統授權、驗證、執行、追蹤的能力。

## Two-tier LLM Boundary

v2 會形成兩層 LLM 架構，但兩層責任必須切清楚。

```text
Tier 1: IntentRouter
責任：判斷任務種類與粗略方向，例如 log / summary / update / delete / ambiguous。
不負責：完整 tool arguments、DB candidates、semantic expansion、資料修改。

Tier 2: Tool-using orchestrator
責任：在 TurnPolicy 限制下產生 tool arguments 或 search hints。
不負責：授權副作用、決定 DB candidate 是否可信、改寫成功/失敗狀態。
```

IntentRouter 應保持輕量，不應膨脹成第二個任務 agent。較細的 search hints 可以由 Tier 2 在受限工具面內產生，或未來由 deterministic alias service 產生。無論 hints 由誰產生，最終 candidates 都必須來自 DB。

## Core Product Decisions

### Meal Transaction

一次使用者訊息可以記錄多個食物。

```text
使用者：幫我記錄一顆蘋果一份雞胸肉
```

系統應視為一次 meal transaction，裡面包含多個 food items。`meal` 是交易單位，`items[]` 是資料單位。

這代表：

- 不把多個食物壓成單一 food name 字串。
- 不讓模型呼叫多次獨立 `log_food`。
- 使用一個 batch-style `log_meal(items[])` 表達整筆餐點。
- 多個 items 的寫入採 all-or-nothing。

正確推論順序：

```text
Product decision: 需要保留每樣食物的獨立資料
  -> Schema decision: 使用 items[]，而不是合併字串
  -> Tool design: 使用 log_meal batch tool
  -> Policy consequence: parallel tool calls 不需要開放
```

### Data Model Direction

資料模型方向選雙表，而不是在現有單表加 `meal_group_id`。

概念上：

- `meal_logs` 表示一次餐點交易。
- `meal_items` 表示該餐裡的食物項目。
- `version` 放在 meal transaction 層級，作為 optimistic lock。
- 舊資料可遷移為「一筆舊 meals row -> 一筆 meal log + 一筆 item」。
- 現有 `image_path` 語意較接近整餐來源，初步放在 meal 層。

這裡不展開完整欄位與 migration SQL，留給 schema migration spec。

### Mutation Scope

`log`、`update`、`delete` 都是 domain mutation，不應各自長出不同 AI 流程。

共同流程：

```text
intent -> target resolution -> policy guard -> domain execution -> summary signal -> trace
```

`delete` 應納入 v2 設計，不應等實作中途才補。概念上第一版應偏 soft delete，而不是 chat 直接 hard delete，保留 undo / audit 空間。

### Summary Boundary

meal transaction 的 all-or-nothing 只保證 meal 與 items 的寫入一致性。

summary recomputation / realtime publish 是 post-commit effect，只能在整筆 meal commit 成功後執行。

若 meal transaction 失敗：

- meal 與 items 全部 rollback。
- 不更新 summary。
- 不發送 summary signal。

若 meal commit 成功但 summary recomputation 或 publish 失敗：

- 不 rollback 已完整成功的 meal。
- 不回傳不可靠 summary。
- 不發送假的 summary signal。
- 前端不應自行 optimistic 更新 summary card。

這修正目前已知風險：資料可能已寫入 DB，但 summary recomputation 失敗時，orchestrator 可能把該輪當成未成功。

## Controlled Mutation Workflow

### Log

記錄餐點時，LLM 可以負責語意理解與營養估算，但是否允許記錄、寫入是否成功、summary 是否更新，都由後端決定。

高層流程：

```text
使用者要求記錄 -> IntentRouter 判斷 log_meal -> TurnPolicy 暴露 log_meal -> LLM 產生 items -> ToolContract 驗證 -> domain transaction commit -> summary signal -> reply
```

### Update

修改紀錄前必須先解析 target。LLM 不應直接決定要改哪筆 DB record。

高層流程：

```text
使用者要求修改 -> 判斷 update intent -> find DB candidates -> 解析唯一 target 或要求使用者選擇 -> update domain mutation -> summary signal -> reply
```

### Delete

刪除和更新共用 target resolution。

高層流程：

```text
使用者要求刪除 -> 判斷 delete intent -> find DB candidates -> 解析唯一 target 或要求使用者選擇 -> soft delete domain mutation -> summary signal -> reply
```

Delete 的細節，如 undo、audit 欄位、hard delete 時機，留給 delete workflow spec。

## Target Resolution

Target resolution 是 update / delete 的核心，不是 prompt 任務。

基本規則：

- 找不到候選：請使用者補充日期、餐別或食物線索。
- 找到唯一 exact candidate：可自動套用 mutation。
- 找到多筆 exact candidates：要求使用者從 DB-backed candidates 選擇。
- 只找到 expanded / fuzzy candidates：即使只有一筆，也先要求使用者確認。

候選清單必須由 DB 查詢結果產生。LLM 可以提供 search hints，但不能自行生成候選項。

這也修正 system prompt 對「方式 1 / 方式 2」的禁令邊界：

- 禁止 LLM-generated choices。
- 允許 DB-backed candidate confirmation。

## Pending State

候選確認不能只靠 chat history。history 是文字，會被截斷或壓縮，且 LLM 不應負責從文字裡轉傳 `meal_id` 或 version。

因此 pending candidates 需要 server-owned short-term state。

高層規則：

- pending state 不是讓 HTTP request hang；原本 request 已經結束。
- pending state 只保存「下一輪若使用者回 1，1 對應哪個 DB target」的 mapping。
- pending candidate 在 expiresAt 前有效。
- 如果中間出現非選擇型 user turn，pending candidate 立刻 cancel。
- `lastLoggedMealId` 也應是短期狀態，支援「剛剛那筆」這類 recent update/delete。

具體 table、payload、TTL、cleanup index，留給 turn state implementation spec。

## Tooling Model

### ToolContract

`log_meal`、`find_meals`、`update_meal`、`delete_meal` 不應只是散落在 orchestrator 裡的 if-else。它們應該是正式 ToolContract。

ToolContract 至少要集中描述：

- 模型可見 schema。
- runtime validation。
- 何時 visible。
- 每 turn 呼叫上限。
- duplicate / idempotency guard。
- 執行邏輯。
- 給模型看的 tool result。
- 給使用者看的摘要。

這樣 tool budget、visibility guard、duplicate guard 才有歸屬，不會重新漂回 orchestrator if-else 叢林。

### Single Source of Truth Schema

OpenAI tool parameters 與 runtime validation 必須由同一份 schema 驅動。

概念上：

```text
one schema -> model-facing tool JSON schema
one schema -> runtime parse / validation
one schema -> typed tool args
```

這是避免 schema drift 的關鍵，也呼應 `ai-orchestrator-learning-notes.md` 裡對 Claude Code tool system 的觀察。

### Error Taxonomy

v2 不應只用單一 fatal error 表示所有問題。錯誤類型會決定 recovery strategy，也會決定 harness 要驗證什麼。

高層分類：

- `ModelProtocolError`：LLM 違反 tool policy 或協議。
- `ToolArgsError`：tool arguments 不符合 schema。
- `ToolBusinessRuleError`：domain rule 失敗，例如 target 不唯一或 version conflict。
- `InvariantViolation`：程式 invariant 被破壞。
- `ProviderTransientError`：LLM provider timeout、rate limit、暫時性網路錯誤。

高層原則：

- 模型協議錯誤和參數錯誤可以有限度 retry 或要求澄清。
- domain invariant 和 transaction 失敗必須中止。
- post-commit summary failure 可以回 partial success，但不能產生假的 summary signal。

## Intent Strategy

IntentRouter 採 hybrid 策略。

- 先跑 rule-based detection。
- 明確 match 時不額外呼叫 LLM classifier。
- 規則符合多個 intent、信心不足或完全沒 match 時，才進 LLM classifier。
- trace 記錄 intent 來源，例如 rule、LLM、clarification。

Ambiguous intent 預設不暴露 mutation tools。

```text
ambiguous -> visibleTools = [] -> ask clarification
```

第一版先偏安全。若之後 UX 太保守，再評估是否允許 read-only tools。

## Reply Strategy

Deterministic reply 不代表 AI 教練角色消失。

回覆應拆成兩段：

```text
deterministic receipt:
  程式產生，包含成功/失敗、食物、營養數字、summary、candidate choices。

optional coach tip:
  LLM 產生，僅限受限教練語氣，不得改寫數字、狀態、候選或 tool result。
```

核心原則是：程式負責可信收據，LLM 負責語氣。

## Verification Strategy

TurnTrace 是驗證 AI 是否被正確約束的主要工具。

測試不應只驗證最後 reply，也要驗證：

- 本輪 intent 是怎麼判斷的。
- 模型看到了哪些 tools。
- tool call 是否通過 schema validation。
- mutation 是否由 domain layer 執行。
- 候選選項是否來自 DB。
- pending state 是否被正確消耗或取消。
- summary signal 是否只在安全時發送。
- deterministic receipt 是否沒有被 LLM 改寫。

具體 harness scenarios 留給測試規劃文件。前導文件只定義驗證方向。

## Follow-up Specs

這份文件刻意不展開 implementation details。後續應拆成較小的 specs：

- Schema migration spec：`meal_logs` / `meal_items` / soft delete / version / legacy data migration。
- ToolContract spec：`log_meal`、`find_meals`、`update_meal`、`delete_meal` 的 schema、validation、visibility、budget。
- TurnPolicy spec：intent、visible tools、tool budget、duplicate guard、ambiguous handling。
- TurnState spec：pending candidates、recent mutation pointer、TTL、lazy cleanup。
- Reply spec：deterministic receipt 與 optional coach tip 的邊界。
- Harness spec：TurnTrace events、mutation scenarios、summary failure、candidate confirmation。

## Summary

Nutrition Coach v2 的 AI orchestrator 應該被視為受控 mutation workflow，而不是更聰明的聊天 prompt。

LLM 負責語意理解、營養估算與受限教練語氣；後端負責 intent routing、tool visibility、target resolution、domain mutation、transaction boundary、summary signal、error recovery 與 TurnTrace verification。
