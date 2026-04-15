# Discuss Patch Roadmap

整理日期：2026-04-14

## Purpose

這份文件整理目前討論後的 v1.2 roadmap patch 方向：如何在不擴大 v1.2 範圍的前提下，吸收 `docs/ai-orchestrator-meal-transaction-design.md` 的核心概念。

結論是：v1.2 不直接實作完整 meal transaction v2 (`docs/ai-orchestrator-meal-transaction-design.md`)。`meal_logs` / `meal_items` schema migration、`log_meal(items[])`、chat-driven meal update/delete、pending candidates、`turn_states`、完整 TurnTrace harness matrix，應延後到後續 milestone。

v1.2 的定位仍是「日常體驗與可觀測性強化」，但 Phase 8 與 Phase 10 會成為未來受控 AI workflow 的地基。

## Core Direction

從 `ai-orchestrator-meal-transaction-design.md` 吸收的原則：

- LLM 不擁有副作用；domain layer 擁有副作用。
- Tool visibility 是 orchestrator policy，不只是 prompt 建議。
- 成功確認、營養數字、summary signal 由程式決定。
- LLM 可以負責語意理解與教練語氣，但不能改寫系統事實。
- ToolContract、runtime validation、structured observability、TurnTrace 是後續演進的基礎。

v1.2 不做完整架構重建，只挑最小可落地的前置 patch：

- Phase 7：集中 config boundary。
- Phase 8：structured logging + lifecycle hooks + chat route helper extraction。
- Phase 9：summary rollover + summary signal boundary。
- Phase 10：以 chat-driven goal update 作為第一個 controlled mutation 試點。

## Phase 7 Patch

原 Phase 7 仍維持「Chat Polish and Boundary Cleanup」。

原範圍：

- chat 重新開啟時定位到最新訊息。
- image-only meal upload 不再包多餘 bubble。
- `PUT /api/device/goals` malformed body 回 controlled `400`。
- README / `.env.example` production static hosting 與 OpenAI model env vars 說明修正。

建議加的小型 patch：

```text
建立 server/config.ts，集中 env/default config。
```

理由：

- Phase 7 本來就要修 README / `.env.example` / OpenAI model env vars 不一致。
- 集中 config 可以讓 model default、DB path、port、timezone、debug flag 有單一來源。
- Phase 8 的 logger debug flag 可直接使用 config boundary。

Scope guard：

- 只做 config read/default/validation 集中化。
- 不順手重構 OpenAI provider 架構。
- 不引入 deployment 行為改動。

## Phase 8 Patch

原 Phase 8 是「Structured Observability Foundation」。這個 phase 是 v1.2 和後續 AI workflow 的關鍵交叉點。

調整後定位：

```text
Structured Observability + Lifecycle Hooks
```

建議保留原目標：

- structured logger。
- default redaction。
- route / service / LLM round / tool call / upload cleanup / summary publish / goal update logs。
- debug detail behind explicit env flag。

新增兩個小型 patch：

### 1. Orchestrator Lifecycle Hooks

不要只在 orchestrator 裡散落 `logger.info()`。先定義最小 lifecycle hooks，讓 production 掛 structured logger，test 掛 spy hooks。

建議 hook 粒度：

```text
onLLMStart
onLLMEnd
onToolReceived
onToolResult
onFallback
```

`onToolResult` 需要能表達：

- validation 是否通過。
- tool 是否真的執行。
- failure reason。
- redacted tool summary。

這樣 Phase 10 新增 `update_goals` 時，不需要再重新在 orchestrator 裡插 log。

### 2. Chat Route Helper Extraction

不在 v1.2 做 event bus，但 Phase 8 應順手拆 chat route helper，避免 route 在加 log 後繼續膨脹。

動機：chat route 目前約 390 行，混合 request parsing、orchestrator call、JSON/SSE response、summary publish、upload cleanup 等多個 concern；Phase 8 加 structured log 後會更胖。

建議只做函式層級分離，不做新架構：

- parse / validate request。
- run orchestrator。
- respond JSON。
- respond SSE。
- publish summary safely。
- cleanup upload。

Scope guard：

- 不引入 Domain Event Bus 作為 Phase 8 必做項。
- 不改變現有 HTTP / SSE contract。
- 不把 hooks 做成完整 plugin/event system。

## Phase 9 Patch

原 Phase 9 是「Daily Summary Rollover」。

調整後定位：

```text
Daily Summary Rollover + Summary Signal Boundary
```

原目標保持：

- Daily summary 依 `TZ=Asia/Taipei` 本地日曆日 rollover。
- App 開著跨午夜時切到新一天 summary，不需手動 reload。
- 補 midnight before / after deterministic tests。

從前導設計吸收的概念：

```text
summary 是 domain read / signal，不是 LLM 生成的事實。
```

Phase 9 應補強：

- summary signal 只在可信狀態發送。
- 前端不應依賴不可靠的 optimistic summary update。
- 跨午夜後 summary 的日期邊界必須明確，避免不同日的 meal 污染彼此 summary。

Scope guard：

- 不依賴 Domain Event Bus。
- 若 Phase 8 hooks 已存在，可以用 hook/log 補 observability。
- 不引入 meal transaction 雙表 migration。

## Phase 10 Patch

原 Phase 10 是「Chat-Driven Goal Updates」。

建議改名或重新定位為：

```text
First Controlled Chat Mutation: Goal Updates
```

原因：goal update 是很適合練習 controlled mutation workflow 的小型場景。它有永久副作用，但不需要 meal target resolution、pending candidates、schema migration。

Phase 10 應導入最小版受控 AI workflow：

- 最小 ToolContract。
- Zod runtime validation。
- prompt instruction。
- 最小 source-text business guard。
- lifecycle hook observability。
- deterministic receipt。

`deterministic receipt` 指由程式產生的可信回覆片段，包含成功/失敗狀態、更新後的目標數字等不可讓 LLM 自由改寫的事實。

## Phase 10 ToolContract Scope

不要一開始複製 Claude Code 完整 tool abstraction。v1.2 只需要最小 ToolContract。

建議欄位：

```text
name
description
parameters
execute
logSummary
```

延後：

- `visibleWhen(context)`。
- `maxCallsPerTurn`。
- 完整 prompt injection registry。
- plugin-style tool loader。

理由：

- v1.2 只有少量 tools。
- Tool visibility 先留在 orchestrator / TurnPolicy 層。
- 避免為了未來 5-6 個工具，現在過早抽象。

## Phase 10 Ambiguous Goal Strategy

最終收斂策略：

```text
Phase 10.0 採 B+：
prompt instruction + Zod runtime validation + minimal source-text business guard + lifecycle hook observability
```

### Prompt Instruction

`update_goals` tool description / system prompt 必須明確說明：

```text
只有使用者自己提供具體數值時才能呼叫 update_goals。
模糊語句如「我想吃少一點」「想增加蛋白質」必須先追問，不可替使用者推算永久目標。
```

### Zod Runtime Validation

ToolContract 的 `parameters` schema 同時作為：

- model-facing tool schema。
- runtime validation。
- typed tool args。

它可以擋掉：

- `{ calories: "少一點" }`
- `{}`
- `{ protein: -10 }`

### Source-text Business Guard

Zod 擋不住「LLM 自己猜一個合法數字」。

Zod 是 schema guard，負責擋型別或範圍不合法的參數；source-text business guard 是語意授權 guard，負責擋「格式合法但使用者沒有明確授權」的永久 mutation。

例子：

```text
使用者：我想吃少一點
LLM：呼叫 update_goals({ calories: 1500 })
```

`1500` 對 Zod 是合法數字，但對產品語意是不合法 mutation，因為使用者沒有明確授權具體數字。

因此 Phase 10.0 加最小 business guard：

```text
若 tool args 包含 calories / protein / carbs / fat 的數值，
使用者原文中也必須出現對應明確數字；
否則 reject 並追問確認。
```

範例：

- 「幫我把熱量改成 1800」-> 可執行。
- 「蛋白質改 150g」-> 可執行。
- 「我想吃少一點」-> 不執行，追問。
- 「幫我調低一點熱量」-> 不執行，追問。

### Observability And Upgrade Path

Phase 10 hooks 應記錄：

- `onToolReceived`：LLM 是否嘗試呼叫 `update_goals`。
- `onToolResult`：Zod validation 是否通過。
- `onToolResult`：business guard 是否拒絕。

升級判斷：

- Zod 擋住的錯誤：無害誤觸發，先觀測即可。
- Zod 放行但 business guard 擋住的猜數字：需要觀測。
- 若猜數字案例頻繁發生：Phase 10.1 升級到 TurnPolicy gate，在模糊語境下不暴露 mutation tool。

## Explicitly Out Of v1.2 Scope

以下不放進 v1.2：

- 完整 meal transaction schema migration。
- `meal_logs` / `meal_items` 雙表實作。
- `log_meal(items[])` 取代 `log_food`。
- chat-driven meal update/delete。
- `find_meals` target resolution。
- pending candidates / `turn_states`。
- soft delete meal workflow。
- Domain Event Bus。
- 完整 TurnTrace harness matrix。

## Adjusted v1.2 Shape

```text
Phase 7: Chat Polish and Boundary Cleanup
  原 scope + 小型 server/config.ts。

Phase 8: Structured Observability + Lifecycle Hooks
  structured logger + redaction + lifecycle hooks + chat route helper extraction。

Phase 9: Daily Summary Rollover + Summary Signal Boundary
  跨午夜 summary + summary signal 可信邊界。

Phase 10: First Controlled Chat Mutation: Goal Updates
  最小 ToolContract + prompt instruction + Zod validation + source-text business guard + deterministic receipt。
```

## Summary

v1.2 不應直接實作完整 meal transaction v2，但應該開始鋪「受控 AI workflow」的基礎。

Phase 8 是 observability / lifecycle hooks 地基。Phase 10 是第一個 controlled mutation 試點。這樣 v1.2 仍維持日常體驗與可觀測性強化的目標，也能自然銜接後續 meal log / update / delete 的 v2 架構。
