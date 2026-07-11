# 30 分鐘 reviewer tour

這條唯一必讀路徑把 repository 的 portfolio claim、architecture、關鍵決策、可執行證據與已知限制串成同一趟 30 分鐘閱讀；每一站只指定必要範圍，技術事實仍以連結的原始文件與 source 為準。

## 30 分鐘唯一必讀路徑

### S01 · Portfolio claim（3 分鐘）

- **為何讀：** 先把主論點定在可信賴的 LLM 應用工程，而不是把這個 repo 只看成 AI 飲食紀錄功能展示。
- **精讀範圍：** [README「為什麼做這個專案」](../README.md#為什麼做這個專案)，確認 meal logging 是 typed contracts、confirm-first proposals、backend authority、committed receipts 與 deterministic evidence 的具體產品情境。
- **讀完應能回答：** 這個 repo 想證明 trustworthy LLM application engineering，而文字或照片餐點紀錄是讓邊界、授權與驗證問題落地的 setting。
- **下一站：** 進入 [architecture 總覽](architecture.md#總覽)，看這個主張如何分布在系統邊界中。

### S02 · Architecture（6 分鐘）

- **為何讀：** 用一條 browser 到 persistence 的資料路徑建立全端邊界圖，避免把 model output 誤認成系統真相。
- **精讀範圍：** 依序讀 [總覽](architecture.md#總覽)、[主要元件](architecture.md#主要元件)、[Meal Logging](architecture.md#meal-logging)、[LLM Boundary](architecture.md#llm-boundary) 與 [Data Model](architecture.md#data-model)，特別辨識 `server/app.ts` 是 composition root，validated backend facts 與 committed SQLite state 才是 authority。
- **讀完應能回答：** 一次請求如何沿 client transport/store → Fastify routes → services/orchestrator/tool contracts → provider → SQLite 前進，以及組裝依賴與持有資料真相的責任分別在哪裡。
- **下一站：** 用 [Capability Matrix](capability-matrix.md#capability-matrix) 檢查 UI 名稱與實際 wiring 是否誠實對齊。

### S03 · Capability honesty（1 分鐘）

- **為何讀：** 用幾個對照列確認「支援」不是單一模糊標籤，而是可追到 source、client/store、backend 與 handling decision 的聲明。
- **精讀範圍：** 在 [generated Capability Matrix](capability-matrix.md#capability-matrix) 只找 `Guest-session bootstrap`（`supported`）、`Trend and day browsing`（`supported-read-only`）、`Export original records`（`inert-honest-placeholder`），以及 `Cross-device continuity`、`Weekly AI insights`（`hidden-future-scope`）；同時看文件開頭的 canonical typed source、generator 與 `yarn matrix:gen:check` drift 說明，不需掃完整表。
- **讀完應能回答：** 同瀏覽器 bootstrap 與唯讀 browsing 可被誠實宣稱，export 仍是停用 placeholder，跨裝置 continuity 與 weekly insights 仍屬 future scope。
- **下一站：** 讀 [ADR 0001 Context](adr/0001-metadata-only-llm-failure-localization.md#context)，看 operational evidence 如何先守住隱私邊界。

### S04 · Metadata-only observability（1 分鐘）

- **為何讀：** 釐清可定位 hard LLM failures 不等於必須保存敏感內容，observability 本身也是 trust boundary。
- **精讀範圍：** 只讀 ADR 0001 的 [Context](adr/0001-metadata-only-llm-failure-localization.md#context)、[Decision](adr/0001-metadata-only-llm-failure-localization.md#decision) 與 [Consequences](adr/0001-metadata-only-llm-failure-localization.md#consequences)，聚焦 server-side `turnId`、allowlisted failure facts，以及不保存 raw prompts、inputs/transcripts、tool/provider payloads、images、sessions、DB snapshots、SSE frames 或 final reply text 的界線。
- **讀完應能回答：** metadata-only proof 如何連起 route、orchestrator、provider 與 deterministic harness，而不建立 raw evidence 的額外保存責任。
- **下一站：** 接著讀 [ADR 0003 Context](adr/0003-structured-boundaries-and-authoritative-state.md#context)，把可觀測事實接到 authoritative state。

### S05 · Authoritative state（2 分鐘）

- **為何讀：** 看懂 model prose、display strings 與 loose transport payload 為何不能直接成為 persisted 或 UI truth。
- **精讀範圍：** 只讀 ADR 0003 的 [Context](adr/0003-structured-boundaries-and-authoritative-state.md#context)、[Decision](adr/0003-structured-boundaries-and-authoritative-state.md#decision) 與 [Consequences](adr/0003-structured-boundaries-and-authoritative-state.md#consequences)，聚焦 typed/schema validation、backend/transport authority、atomic persisted receipts 與 mutation facts。
- **讀完應能回答：** 為什麼跨邊界資料必須先被驗證，而且只有 committed state 與後端持有的 mutation facts 能宣告變更成功。
- **下一站：** 進入 [ADR 0006 Context](adr/0006-agent-side-effect-policy-taxonomy.md#context)，看 tool request 如何被 guard 成可執行或被阻擋的決策。

### S06 · Guarded side effects（2 分鐘）

- **為何讀：** 把「model 只能提出 request」落到 execute 前的固定 guard order 與 proposal-versus-commit authority。
- **精讀範圍：** 讀 ADR 0006 的 [Context](adr/0006-agent-side-effect-policy-taxonomy.md#context)、[Decision](adr/0006-agent-side-effect-policy-taxonomy.md#decision) 內的 [Guardrail Layering](adr/0006-agent-side-effect-policy-taxonomy.md#guardrail-layering) 與 [Output And Receipt Authority Taxonomy](adr/0006-agent-side-effect-policy-taxonomy.md#output-and-receipt-authority-taxonomy)，再看 [Consequences](adr/0006-agent-side-effect-policy-taxonomy.md#consequences)；用 [`runContract`](../server/orchestrator/tool-contract.ts) 對照 JSON parse → Zod → source-text guard → side-effect policy gate → execute。
- **讀完應能回答：** `update_goals` 等 mutation 為何不能靠 assistant 說「完成」，proposal 必須等 explicit consent，而 receipt 必須來自 committed backend facts。
- **下一站：** 讀 [ADR 0010 Context](adr/0010-nutrition-safety-product-floor.md#context)，看 authority chain 如何再套用產品安全下限。

### S07 · Product safety floor（1 分鐘）

- **為何讀：** 把 1200 kcal/day 的用途限制在清楚、可驗證的 product decision，避免把數字擴張成醫療主張。
- **精讀範圍：** 只讀 ADR 0010 的 [Context](adr/0010-nutrition-safety-product-floor.md#context)、[Decision](adr/0010-nutrition-safety-product-floor.md#decision) 與 [Verification](adr/0010-nutrition-safety-product-floor.md#verification)：它是 conservative non-clinical product floor，not universal or personalized medical advice；通過 floor check 仍不能繞過 source authority、proposal/confirmation、macro credibility、route validation 與其他 guards。
- **讀完應能回答：** 低於 1200 為何 fail closed，而等於或高於 1200 又為何只代表通過其中一層產品檢查。
- **下一站：** 進入 [AI-safety threat model](ai-safety.md#threat-model-trust-and-authority-boundaries)，把四個決策放回完整 case study。

### S08 · AI-safety case study（10 分鐘）

- **為何讀：** 用完整但有邊界的公開敘事，檢查 instruction/data、request/authority、deterministic evidence 與 proof limits 是否形成一致論證。
- **精讀範圍：** 依序讀 [Threat model](ai-safety.md#threat-model-trust-and-authority-boundaries)、[Deterministic safety cases](ai-safety.md#deterministic-safety-cases)、[1200 kcal product safety floor](ai-safety.md#the-1200-kcal-product-safety-floor)、[What the evidence does—and does not—prove](ai-safety.md#what-the-evidencedoesand-does-notprove) 與 [Conclusion](ai-safety.md#conclusion)；這些是 bounded deterministic application evidence，not universal model safety，也不是 clinical proof。
- **讀完應能回答：** untrusted context、model request、guarded execution 與 committed state 如何分工，以及 named cases 能證明和不能證明的範圍。
- **下一站：** 到 [Behavior Matrix Cases](../tests/harness/behavior-matrix.md#cases)，把 case-study claim 追到 CASE-11/12 的 assertion 與 source。

### S09 · Mutation-authority evidence trace（2 分鐘）

- **為何讀：** 用一條短 vertical trace 驗證不可信 tool-shaped 文字不會因外觀像工具呼叫就取得 mutation authority。
- **精讀範圍：** 在 generated Behavior Matrix 只看 [Cases](../tests/harness/behavior-matrix.md#cases)、[Risk Coverage Distribution](../tests/harness/behavior-matrix.md#risk-coverage-distribution) 與 [Risk To Assertion Coverage](../tests/harness/behavior-matrix.md#risk-to-assertion-coverage) 中的 CASE-11/12、`assertNoTrustedToolAuthority`、`assertNoUnauthorizedMutation`；再沿 [CASE-11 source](../tests/harness/cases/case-11-malicious-tool-json.ts) 與 [CASE-12 source](../tests/harness/cases/case-12-unauthorized-goal-update.ts) 追到 [`tool-contract.ts`](../server/orchestrator/tool-contract.ts) 的 guarded runner、[`tools.ts`](../server/orchestrator/tools.ts) 的 registry/dispatch，最後到 [`mutation-effects.ts`](../server/orchestrator/mutation-effects.ts) 的 committed mutation facts，不需讀其他 implementation。
- **讀完應能回答：** CASE-11 如何拒絕 fake tool JSON/numeric authority、CASE-12 如何保留 goals，以及 request observed、execute allowed 與 persisted mutation 各由哪個 evidence 或 backend boundary 判定。
- **下一站：** 以 [known limitations](ai-safety.md#known-limitations-and-future-eval-questions) 收束，避免把 integrity evidence 說成 conversation quality 已解決。

### S10 · Known limits and next directions（2 分鐘）

- **為何讀：** 最後把已證明的 deterministic integrity、仍未解的 conversational quality，以及尚未支援的產品表面分開陳述。
- **精讀範圍：** 讀 [Known limitations and future eval questions](ai-safety.md#known-limitations-and-future-eval-questions) 中 #107 confusion/duplicate proposal、#108 explanation/action mismatch、#109 apply promise without pending state，再回看 [Capability Matrix](capability-matrix.md#capability-matrix) 的 `Guest-session bootstrap`、`Trend and day browsing`、`Export original records`、`Cross-device continuity` 與 `Weekly AI insights` 支援狀態。
- **讀完應能回答：** preserved integrity 不代表 conversational-quality gaps 已修好；目前能宣稱的是 same-browser bootstrap supported 與 read-only browsing，而 export 是 inert-honest-placeholder，cross-device continuity 與 weekly insights 是 hidden-future-scope，不可宣稱 future surfaces 已可用。
- **下一站：** 回到 [portfolio claim](../README.md#為什麼做這個專案) 與 [case-study conclusion](ai-safety.md#conclusion)，用「claim 是否可追到 bounded evidence」作為閱讀終點，不再開另一條路徑。
