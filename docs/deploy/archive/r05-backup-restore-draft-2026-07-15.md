# R05 前 Production DB Backup／Restore Contract（歷史草稿，已由 tracked implementation 取代）

建立：2026-07-15（Fable 5，回應 workflow-review-handoff P1-2／Gate 0 item 4）
狀態：**SUPERSEDED DRAFT — 不再是操作 authority**。Workflow-hardening goal 已將 contract 收斂為 tracked `docs/deploy/storage-recovery.md`、`scripts/workflow/production-recovery.mjs` 與 real-WAL non-production rehearsal。正式 runbook 改採 runtime quiescence、`better-sqlite3` online backup、private manifest／public receipt 分離、row-content/tree digests 與 quarantine restore。本歷史草稿中的 `VACUUM INTO`、entry-count 與 `.planning` receipt 建議不得繼續採用。本文件與 tracked implementation 都不授權任何 production 操作；production adoption／B01／R05／B02／R06 仍各需 maintainer 明確裁決。
位置：原本是 ignored 的本機交接草稿；目前移到 `docs/deploy/archive/`，仍不得視為操作 authority。正式 runbook 是 [`storage-recovery.md`](../storage-recovery.md)。

## 1. 目的與範圍

在任何 production `yarn db:migrate`（Phase 115 R05 或未來任何 milestone 的同類動作）之前，建立一個**獨立授權**的 recovery gate，使「migration 成功但 runtime boot／smoke 失敗」或「migration 中途失敗」時，有已驗證的還原路徑。

保護對象（對齊 `docs/deploy/production-runtime.md` Environment 的 stable storage 類別）：

- SQLite database（`DB_PATH` 類別，例 `./data/nutrition.db`，含 WAL 狀態）
- durable assets（`ASSETS_DIR` 類別）
- uploads staging（`UPLOADS_STAGING_DIR` 類別）

不在範圍：`dist/client`（可由 source 重建）、source checkout（由 git 管理）、`.env`（secrets 不進 backup evidence，只驗證存在性）。

## 2. 授權模型（gate 分離）

| Gate | 動作 | 授權 |
|---|---|---|
| B01 backup | 建立 snapshot ＋ 驗證 backup integrity | 獨立 fresh approval，**不**隱含在 R05 approval 中 |
| R05 migrate | `yarn db:migrate` | 既有 115-02 approval tuple；bundle 必須額外列出 `backup_completed` 與 `restore_ready` 兩個 boolean |
| B02 restore | 以 snapshot 覆蓋 production storage | 獨立 fresh approval；**永不**與 B01 或 R05 綁在同一個核准裡 |

對齊 handoff P1-2：「不把 restore 默認綁入同一個 migration approval」。B02 是破壞性動作（覆蓋現行 DB），授權語意等級與 R05 相同。

## 3. B01 Backup 程序（建議實作）

前提：與 115-02 相同的工具紀律 — 只用專案既有 `better-sqlite3`，不新增依賴。

1. **DB snapshot**：對 live DB 執行 `VACUUM INTO '<backup>/nutrition-pre-r05.db'`。
   - `VACUUM INTO` 產生單檔、無 WAL 殘留的 consistent snapshot，可在連線存在時執行，不依賴先停 runtime。
   - 不使用裸 `cp`：WAL mode 下裸複製 `.db` 而漏掉 `-wal` 會得到不一致快照。
2. **assets／uploads snapshot**：`cp -R`（或 `rsync -a`）兩個目錄到 backup 目的地。
3. **backup 目的地**：runtime checkout **之外**的 stable local 路徑（`./data` 位於 checkout 內；備份放同一 checkout 內會被未來 checkout 操作波及），命名 `<dest>/<UTC-timestamp>-pre-r05-<sha8>/`。實際路徑屬 transient metadata，不寫進任何 evidence。

## 4. B01 Backup 驗證（非空話的 integrity check）

對 snapshot（非 live DB）執行，全部通過才允許 R05 進入 approval：

1. 以 `better-sqlite3` readonly 開啟 snapshot：`PRAGMA integrity_check` 結果恰為 `ok`；`PRAGMA foreign_key_check` 回傳 0 列。
2. durable table row counts 與 live DB 當下 prestate 逐表相等（沿用 115-02 Task 1 的 12 張 durable table 清單；`turn_states` 同樣排除）。
3. `__drizzle_migrations` journal rows（`created_at`,`hash`）與 live DB 完全一致。
4. assets／uploads 備份目錄的 recursive entry count 與來源一致。
5. 產出 **metadata-only backup receipt**（`.planning` phase artifact）：只含 `backup_id`（timestamp+sha8）、observation time（Asia/Taipei）、上述四項 boolean、`intended_source_sha`。禁止 paths、rows、filenames、counts、hashes（counts/hashes 只在 reducer 記憶體內比較，同 115-02 慣例）。

## 5. B02 Restore 程序與 operator decision tree

### 觸發情境 → 決策

| 情境 | 預設路徑 | 理由 |
|---|---|---|
| R05 migration 指令失敗（exit ≠ 0） | 先診斷；DB integrity 仍 `ok` 且 journal 未前進 → 不 restore，修復後重走 B01+R05 | Drizzle migration 整體包在交易語意內時，失敗通常未落地 |
| R05 成功但 R06 boot 失敗 | **forward-fix 優先**（source 問題居多）；若 30 分鐘內無法定位且需要回舊 runtime → B02 | 新 schema＋舊 source 不保證相容，restore 是回到「舊 schema＋舊 SHA」的成對操作 |
| R06 成功但 smoke 失敗 | forward-fix 優先；資料未受損則不動 DB | smoke 失敗多半非 DB 問題 |
| 發現 row values 被錯誤改寫 | 立即停止 runtime → B02 | 唯一資料真實性受損的情境 |

**批准者**：maintainer 本人（單人維護現況）；每次 B02 都是 fresh exact approval。

**restore 目標**：`backup_id` 對應的 snapshot ＋ **backup 當時 production 正在服務的 source SHA**（成對還原，不得只還原 DB）。因此 B01 receipt 的 `intended_source_sha` 欄位之外，還必須記錄 `pre_refresh_runtime_sha`（backup 當下 production 實際 SHA；可由 `GET /api/runtime-provenance` 唯讀取得）。

### B02 步驟

1. fresh approval 綁定 `backup_id` 與還原目標 SHA。
2. graceful stop 現行 runtime。
3. 移開（不刪除）現行 `nutrition.db`／`-wal`／`-shm` 至隔離目錄；以 snapshot 檔案放回 `DB_PATH`。
4. 僅當 assets／uploads 受損時同法還原該目錄。
5. checkout 還原目標 SHA → `yarn install --frozen-lockfile` → `yarn build` → `yarn start`。
6. 驗證：boot 無 TZ／secret 錯誤、`/api/runtime-provenance` 回傳還原目標 SHA、localhost 基本 shell/API 可用。
7. 產出 metadata-only restore receipt（restore time、`backup_id`、目標 SHA、驗證 booleans）。

## 6. Rehearsal（核准後、R05 前必做一次）

在非 production 環境演練（scratch 目錄 + dev DB 副本或 harness fixture DB）：

1. B01：snapshot ＋ 四項驗證全過。
2. 對副本跑 `yarn db:migrate` 成功。
3. 模擬 boot 失敗情境（毋需真實壞掉，走 decision tree 到 B02 分支即可）。
4. B02：以 snapshot 還原副本，確認舊 schema 可被舊 source 正常開啟（readonly integrity check + journal rows 回到 pre-migration 狀態）。
5. 演練證據 metadata-only，路徑不落盤。

## 7. 對 Phase 115 的影響（需 maintainer 裁決）

- 115-02 的 approval tuple／checkpoint schema 目前沒有 backup 欄位。最小侵入做法：B01 作為**獨立前置 plan**（例如 115-05，wave 排在 115-02 之前），其 receipt 成為 115-02 Task 1 的 read_first 輸入；115-02 Task 2 的 safe bundle 增列 `backup_completed`／`restore_ready` 兩行顯示值。這需要 replan（`gsd-plan-phase` 修訂），不是本草稿能自行決定的。
- 或者：接受 handoff P1-2 建議但延到 v3.4.1 之後，Phase 115 R05 依現計畫執行（風險：本次 migration 無 restore path，僅有 0009 一類的已知 migration 時風險較低，但 handoff 已明確反對此路徑）。

## 8. Open Questions（核准前需回答）

1. backup 目的地的 stable 路徑類別放哪裡（checkout 外的哪個位置）？
2. `pre_refresh_runtime_sha` 目前 production 在跑的 SHA 是什麼？（Phase 114 preflight 分類過 candidate runtime，但 sanitized route 未留 SHA）
3. B01 是否如第 7 節建議以獨立 plan 插入 Phase 115，還是 milestone 後補？
4. 本 contract 核准後正式版放 tracked `docs/deploy/`（會 drift pinned baseline，需 source-selection decision）還是先留 local？
