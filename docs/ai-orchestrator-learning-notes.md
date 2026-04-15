# AI Orchestrator Learning Notes

整理日期：2026-04-13

## 背景

這份文件整理了 `Nutrition-Coach` 與 Claude Code source code 對照後，對「如何更穩定地操控 AI」最值得吸收的工程結論。重點不是複製 Claude Code 的完整架構，而是挑出最適合目前專案規模、且能直接降低 LLM 漂移與流程失控風險的做法。

## 目前專案已經做對的事

- 已經有 `LLMProvider` abstraction，模型供應商與 orchestrator 有基本解耦。
- 已經有 `orchestrator/` 對話迴圈，而不是把 LLM 直接塞進 route。
- 已經有 `MAX_ROUNDS = 3`，能防止無限 tool loop。
- 已經有 `MockLLMProvider`、streaming fake、integration tests、verification harness。
- system prompt 已經寫得夠具體，尤其有明確規則禁止「方式1 / 方式2」這種錯誤流程。
- `log_food` 已經有重要 invariant：成功記錄必須伴隨 fresh `dailySummary`。

這代表目前架構是好的起點，問題不在「要不要重做」，而在「怎麼把現有 AI 約束從 prompt 往程式結構下沉」。

## 最值得納入的 6 件事

### 1. 把 tool 定義升級成正式 contract

目前 `toolDefinitions` 只有給模型看的 schema，真正執行規則散在 `executeTool()` 與 orchestrator 裡。

建議改成每個 tool 至少包含：

- `inputSchema`
- `validateInput`
- `execute`
- `visibleWhen(context)`
- `maxCallsPerTurn`
- `idempotencyKey`
- `userFacingSummary`
- `modelResult`

目標是把「tool 長什麼樣」「tool 何時可用」「tool 怎麼執行」集中在同一個地方，避免規格漂移。

### 2. 分開「模型可見工具」與「工具可執行性」

目前每輪都把同一組 `toolDefinitions` 傳給模型。這在流程簡單時可行，但一旦狀態變多，模型會一直看到其實不該再出現的工具。

建議新增 `getTurnTools(context)`：

- 詢問今日攝取時，只暴露 `get_daily_summary`
- 圖片/餐點記錄流程，才暴露 `log_food`
- 一旦本輪已成功 `log_food`，後續回合不再暴露 `log_food`

這比只靠 system prompt 說「不要再問」更穩。

### 3. 加入程式級 protocol state，不只靠 prompt 與 regex 補救

目前已有 `CHOICE_PROMPT_PATTERN` 與 hallucination recovery，這是好的防線，但本質上仍是文字層補丁。

建議把 turn state 顯式化，例如：

- `stage: "collecting" | "logged" | "finalizing"`
- `usedTools: string[]`
- `mealLoggedThisTurn: boolean`
- `forbiddenBehaviors: string[]`

這樣 `log_food` 一旦成功，就可以在程式邏輯上禁止任何再次確認、重新選方法、再度要求使用者選擇。

### 4. 用同一份 schema 驅動 OpenAI tool 宣告與 runtime 驗證

目前工具 schema 和 runtime validation 是兩份：

- 給模型看的 JSON schema 在 `toolDefinitions`
- 真正驗證在 `executeTool()` 內用手寫 `typeof` / `Number.isFinite`

建議改成 single source of truth，例如用 Zod：

- 由同一份 schema 產生 OpenAI tool parameters
- runtime 直接 parse
- validation error 轉成一致的 error taxonomy

這可以大幅降低 schema drift。

### 5. 補上 tool budget、duplicate guard、明確的 call policy

`MAX_ROUNDS = 3` 很重要，但還不夠。

建議再加：

- 同一 turn `log_food` 最多 1 次
- 同一 turn `get_daily_summary` 最多 1 次
- 相同 `tool + args` 不可重複執行
- 明確禁止 parallel tool calls

這會比單純限制回合數更精準，也比較容易 debug。

### 6. 建立錯誤 taxonomy 與 recovery table

目前已有 `FatalToolError`，是好的開始，但可以再往下拆：

- `ModelProtocolError`
- `ToolArgsError`
- `ToolBusinessRuleError`
- `InvariantViolation`
- `ProviderTransientError`

然後由 orchestrator 對每種錯誤採固定 recovery：

- 回退給使用者
- 可重試
- 可保留 partial success
- 必須中止並告警

這會讓 fallback 行為更可預測，也更容易被 harness 驗證。

## 我最推薦優先做的 3 件事

### P1. 建立 `ToolContract`

先把 `toolDefinitions` 與 `executeTool()` 整合成結構化工具定義。這件事會直接改善：

- schema drift
- tool policy 散落
- tool-specific tests 不夠集中

### P2. 建立 `TurnPolicy`

在每輪 completion 前算出：

- 這輪模型能看到哪些 tools
- 哪些 tools 已達呼叫上限
- 哪些工具因 state 被禁用

這是把控制從 prompt 下沉到程式的核心一步。

### P3. 建立 `TurnTrace`

把每輪的關鍵決策存成結構化 trace：

- round index
- visible tools
- chosen tool calls
- validation result
- fallback reason
- partial success reason

這能讓 harness 從「驗結果」升級到「驗過程」。

## 目前專案中的一個風險訊號

repo 裡仍可看到舊的 `analyze_food` 痕跡，表示 tool surface 曾經變動，且 history / tests / integration 還留有舊概念。這不是大問題，但它說明了：

- tool contract 尚未完全成為 single source of truth
- LLM 流程規則與測試知識有分散風險

如果接下來功能再加深，這類漂移會更明顯。

## 建議的 v2 演進方向

### Phase 1: 結構收斂

- 建立 `ToolContract`
- 把 schema 與 execute 整合
- 統一 tool error taxonomy

### Phase 2: 流程控制

- 導入 `TurnPolicy`
- 加上 per-tool budget
- 加上 duplicate guard
- 顯式禁止不該再出現的 tool

### Phase 3: 可觀測性

- 建立 `TurnTrace`
- 讓 harness 驗證 trace
- 把 fallback / hallucination recovery 原因結構化

### Phase 4: Prompt 瘦身

當上面幾層完成後，再把 prompt 裡那些其實應該由程式保證的限制逐步移除，只保留真正需要模型理解的產品語義。

## 一句話總結

你現在的系統已經有「AI orchestration」的骨架；下一步最值得學 Claude Code 的，不是更多 prompt engineering，而是把 AI 的可用能力、可見工具、執行規則、錯誤恢復，逐步變成程式裡可驗證的結構。
