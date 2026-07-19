# 文件地圖

這是 `docs/` 的入口。先分清文件的用途與生命週期，再選閱讀路徑。

## 正式 source-visible 文件

- [系統架構](system-architecture.md)：request flow、LLM flow、data flow 與目前限制
- [Capability Matrix](capability-matrix.md)：由 `client/src/contracts/capability-matrix.ts` 生成，不能手改內容
- [AI safety case](ai-safety-case.md)：bounded application safety evidence 與限制
- [Reviewer tour](reviewer-tour.md)：30 分鐘的架構與 evidence 閱讀路徑
- [Demo runbook](demo-runbook.md)：乾淨 checkout 重建、runtime 檢查與 presenter script

### 決策紀錄

- [`adr/`](adr/)：10 份編號 ADR；每份維持一個主要決策，避免合併後失去決策邊界

### 部署與運維

- [Production runtime](deploy/production-runtime.md)：目前 local production-mode runtime、Cloudflare Tunnel 與 public smoke
- [Storage recovery](deploy/storage-recovery.md)：B01 backup、R05 migration 與 B02 restore gate
- [`deploy/archive/`](deploy/archive/)：Railway baseline 與歷史草稿

### Workflow contracts

- [Planning proof](workflow/planning-proof.md)：planner／checker proof contract
- [Runtime governance](workflow/runtime-governance.md)：lease、provenance、receipt 與 verification-seal contract

## 本機 workflow 文件

以下文件服務 agent 工作流，依 boot contract 保留原檔名與路徑；它們被 `.gitignore` 排除，不是乾淨 checkout 的 source-visible 文件：

- [`codex.md`](codex.md)：Codex routing、GSD 與 just-in-time skills
- [`codex-pr-ci.md`](codex-pr-ci.md)：GitHub issue、PR policy 與 CI runbook
- [`codex-release.md`](codex-release.md)：source release、runtime refresh、smoke 與 closeout guardrails

## 研究與學習材料

[`research/`](research/) 是本機 ignored 的學習、面試與研究材料，不代表目前實作或 roadmap 的唯一正本。

- [`research/guides/`](research/guides/)：合併後的 codebase orientation、backend flow、AI flow 與 code review guides
- [`research/interview/`](research/interview/)：多頁 HTML 面試準備網站
- [`research/notes/`](research/notes/)：方向、logger、backlog、決策與歷史研究
- [`research/notes/archive/`](research/notes/archive/)：明確標示為背景的舊材料

## 本機交接與歸檔

- `.planning/handoffs/`：短期 agent handoff；已移出 `docs/`
- `.planning/docs-archive/2026-07-16/`：本次合併前的原始研究章節，供需要時回溯

## 原則

- ADR、生成文件與被測試固定引用的 workflow contract 保留獨立檔案。
- 學習章節按閱讀主題合併，不再以每個原始碼檔案各自建立一份文件。
- 歷史材料保留，但必須放在 archive 或本機歸檔區，不與 current 文件並列。
- `docs/` 的正式文件不得依賴本機絕對路徑。
