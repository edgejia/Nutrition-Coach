# 家用 Server 部署（Windows + WSL2）

把 Nutrition Coach 部署到一台常開的 Windows 電腦上，讓手機隨時都能使用。Windows 保持原樣，app 跑在 WSL2 的 Ubuntu 裡，再透過 Cloudflare Tunnel 對外提供 HTTPS。

這份是個人自用的精簡流程。[Production runtime](production-runtime.md) 和 [Storage recovery](storage-recovery.md) 記錄的是過去的多道核准流程，自用 server 不需要照那套走。

## 架構

```text
手機 ──HTTPS──> Cloudflare（Access 登入）──Tunnel──> cloudflared（WSL）──> Fastify :3000（WSL）
                                                                     └─> SQLite＋照片（~/nutrition-data）
```

- Tunnel 由家裡的機器主動往外連，不需要固定 IP，也不用在路由器開 port。
- Cloudflare Access 擋在最前面，只有你的 email 能通過。**這一步不能省**：app 本身沒有帳號系統，沒有 Access 的話，任何知道網址的人都能用你的 OpenAI API key。

以下 `<user>` 代表 WSL 裡的 Linux 使用者名稱，`<win-user>` 代表 Windows 使用者資料夾名稱，`<hostname>` 代表你的網域，例如 `nutrition.example.com`。

## 1. Windows 準備

### 1.1 安裝 WSL2 與 Ubuntu

用「以系統管理員身分執行」開 PowerShell：

```powershell
wsl --install -d Ubuntu-24.04
```

重開機後，Ubuntu 會要求你設定 Linux 使用者名稱和密碼。完成後確認版本：

```powershell
wsl --version
wsl -l -v
```

`wsl -l -v` 裡 `Ubuntu-24.04` 的 VERSION 應該是 `2`。

### 1.2 啟用 systemd

在 Ubuntu 裡：

```bash
sudo tee /etc/wsl.conf >/dev/null <<'EOF'
[boot]
systemd=true
EOF
```

回到 PowerShell 重啟 WSL：

```powershell
wsl --shutdown
```

再開一次 Ubuntu，確認 `systemctl is-system-running` 會回應（`running` 或 `degraded` 都可以）。

### 1.3 讓 WSL 不要閒置關機

在 Windows 建立 `C:\Users\<win-user>\.wslconfig`：

```ini
[wsl2]
memory=8GB
vmIdleTimeout=-1
```

`memory=8GB` 限制 WSL 最多用一半的 RAM，Windows 才不會變慢。改完之後執行 `wsl --shutdown` 讓設定生效。

### 1.4 開機自動啟動 WSL

WSL 預設要有人打開它才會啟動。用系統管理員 PowerShell 建立一個開機排程，讓它在沒有登入的情況下也會啟動：

```powershell
$action   = New-ScheduledTaskAction -Execute "wsl.exe" -Argument "-d Ubuntu-24.04 --exec sleep infinity"
$trigger  = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit 0 -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -AllowStartIfOnBatteries
Register-ScheduledTask -TaskName "NutritionCoachWSL" -Action $action -Trigger $trigger -Settings $settings `
  -User $env:USERNAME -Password (Read-Host "Windows 登入密碼") -RunLevel Highest
```

如果 Windows 是用 Microsoft 帳號登入，密碼要輸入 Microsoft 帳號的密碼，不是 PIN。

**驗證**：全部設定完成後（第 4 步之後），重開機、**不要登入**，用手機打開 `https://<hostname>`。如果打不開，改用備案：用 `netplwiz` 設定開機自動登入，再把排程的觸發條件改成「登入時」。

### 1.5 電源與更新

用系統管理員 PowerShell 關閉睡眠和休眠：

```powershell
powercfg /change standby-timeout-ac 0
powercfg /change hibernate-timeout-ac 0
```

另外建議：

- 在 BIOS 把「Restore on AC Power Loss」設為 `Power On`，停電恢復後會自動開機。
- 在 Windows Update 設定「使用時段」。更新造成的重開機會由 1.4 的排程自動恢復。

## 2. Ubuntu 環境

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y build-essential python3 git sqlite3 curl unzip
```

`build-essential` 和 `python3` 是編譯 `better-sqlite3` native 模組需要的；`sqlite3` CLI 用在備份。

安裝 Node 22（CI 用的版本；Node 24 下 `better-sqlite3` 會 crash）與 yarn：

```bash
curl -fsSL https://fnm.vercel.app/install | bash
source ~/.bashrc
fnm install 22
fnm default 22
corepack enable
COREPACK_ENABLE_DOWNLOAD_PROMPT=0 yarn -v
```

`yarn -v` 應該顯示 `1.22.x`。再確認之後 systemd 會用到的路徑存在：

```bash
ls ~/.local/share/fnm/aliases/default/bin/
```

裡面應該有 `node` 和 `yarn`。

## 3. 安裝 app

### 3.1 Clone 與資料目錄

```bash
git clone https://github.com/edgejia/Nutrition-Coach.git ~/nutrition-coach
mkdir -p ~/nutrition-data/assets ~/nutrition-data/uploads-staging
chmod 700 ~/nutrition-data
```

資料放在 checkout 外面，重新 clone 或切換版本都不會動到資料。`yarn start` 也會要求 checkout 裡沒有任何未追蹤的檔案，所以不要在 checkout 裡放其他東西。

**所有東西都要放在 WSL 自己的檔案系統（`~/`），不要放在 `/mnt/c/`。** 跨到 Windows 磁碟會很慢，SQLite 的檔案鎖也可能出問題。

### 3.2 設定 `.env`

先產生 session secret：

```bash
openssl rand -hex 32
```

建立 `~/nutrition-coach/.env`（已被 `.gitignore` 排除）：

```bash
NODE_ENV=production
PORT=3000
DB_PATH=/home/<user>/nutrition-data/nutrition.db
ASSETS_DIR=/home/<user>/nutrition-data/assets
UPLOADS_STAGING_DIR=/home/<user>/nutrition-data/uploads-staging
CLIENT_DIST_DIR=./dist/client
TZ=Asia/Taipei
GUEST_SESSION_SECRET=<剛才產生的值>
OPENAI_API_KEY=<你的 OpenAI API key>
OPENAI_ORCHESTRATOR_MODEL=gpt-5.4-mini
```

```bash
chmod 600 ~/nutrition-coach/.env
```

- `GUEST_SESSION_SECRET` 設定後不要再改，改了之後手機上的登入 cookie 會全部失效。
- `NODE_ENV=production` 會自動開啟 secure cookie，所以只能透過 HTTPS（Tunnel）使用，直接連 `http://localhost:3000` 會無法保持登入狀態。

### 3.3 建置

```bash
cd ~/nutrition-coach
yarn install --frozen-lockfile
yarn db:migrate
yarn build
```

`yarn db:migrate` 會自己讀 `.env`，把資料庫建在 `DB_PATH`。

### 3.4 systemd 服務

server 本身不會讀 `.env`，由 systemd 的 `EnvironmentFile` 注入。建立 `/etc/systemd/system/nutrition-coach.service`：

```ini
[Unit]
Description=Nutrition Coach
After=network-online.target
Wants=network-online.target

[Service]
User=<user>
WorkingDirectory=/home/<user>/nutrition-coach
EnvironmentFile=/home/<user>/nutrition-coach/.env
Environment=PATH=/home/<user>/.local/share/fnm/aliases/default/bin:/usr/local/bin:/usr/bin:/bin
ExecStart=/home/<user>/.local/share/fnm/aliases/default/bin/yarn start
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now nutrition-coach
systemctl status nutrition-coach
curl -s http://localhost:3000/api/runtime-provenance
```

最後一行應該回傳包含 `sourceSha` 的 JSON。看 log：

```bash
journalctl -u nutrition-coach -f
```

## 4. Cloudflare

### 4.1 Tunnel

在 Cloudflare Zero Trust dashboard：

1. **Networks → Tunnels → Create a tunnel**，類型選 `Cloudflared`，取個名字，例如 `nutrition-home`。
2. 環境選 **Debian / 64-bit**，照 dashboard 顯示的指令在 Ubuntu 裡安裝 `cloudflared`，並執行它給的 `sudo cloudflared service install <token>`。這一步會把 `cloudflared` 裝成 systemd 服務，開機自動啟動。
3. **Public Hostname** 設定 `<hostname>` 指向 `http://localhost:3000`。

如果 Mac 上還有舊的 tunnel 綁著同一個 hostname，要先在 dashboard 移除那條路由或刪掉舊 tunnel。

### 4.2 Access（只允許你自己）

1. **Access → Applications → Add an application → Self-hosted**。
2. Application domain 填 `<hostname>`；Session duration 建議設 `1 month`，手機才不會常常要重新登入。
3. Policy：Action 選 `Allow`，規則選 `Emails`，填你自己的 email。
4. 登入方式用預設的 **One-time PIN**（寄驗證碼到 email）即可。

完成後用手機打開 `https://<hostname>`：先出現 Cloudflare 的 email 驗證頁，通過後進入 app。

## 5. 每日備份

資料庫和照片只存在這台電腦上。備份放到 Windows 的 OneDrive 資料夾，OneDrive 會自動同步到雲端，硬碟壞了也不會全部遺失。

先建立目錄 `mkdir -p ~/bin`，再建立 `~/bin/nutrition-backup.sh`：

```bash
#!/usr/bin/env bash
set -euo pipefail

DATA=/home/<user>/nutrition-data
DEST=/mnt/c/Users/<win-user>/OneDrive/NutritionBackups
STAMP=$(date +%Y%m%d-%H%M)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# 用 SQLite 的 online backup 取得一致的快照，server 不用停。
sqlite3 "$DATA/nutrition.db" ".backup '$TMP/nutrition.db'"
sqlite3 "$TMP/nutrition.db" "PRAGMA integrity_check;" | grep -qx ok

tar -czf "$TMP/nutrition-$STAMP.tar.gz" -C "$TMP" nutrition.db -C "$DATA" assets
mkdir -p "$DEST"
cp "$TMP/nutrition-$STAMP.tar.gz" "$DEST/"

# 保留最近 30 天。
find "$DEST" -name 'nutrition-*.tar.gz' -mtime +30 -delete
echo "backup ok: nutrition-$STAMP.tar.gz"
```

```bash
chmod +x ~/bin/nutrition-backup.sh
~/bin/nutrition-backup.sh
```

手動跑一次確認成功後，設定每天凌晨 3:30 自動備份：

```bash
(crontab -l 2>/dev/null; echo "30 3 * * * /home/<user>/bin/nutrition-backup.sh >> /home/<user>/nutrition-data/backup.log 2>&1") | crontab -
```

### 還原

```bash
sudo systemctl stop nutrition-coach
mkdir -p /tmp/restore && tar -xzf /mnt/c/Users/<win-user>/OneDrive/NutritionBackups/nutrition-<STAMP>.tar.gz -C /tmp/restore
rm -f ~/nutrition-data/nutrition.db-wal ~/nutrition-data/nutrition.db-shm
cp /tmp/restore/nutrition.db ~/nutrition-data/nutrition.db
cp -a /tmp/restore/assets/. ~/nutrition-data/assets/
sudo systemctl start nutrition-coach
```

## 6. 更新 app

`main` 有新版本時：

```bash
~/bin/nutrition-backup.sh
cd ~/nutrition-coach
git pull --ff-only
yarn install --frozen-lockfile
yarn db:migrate
yarn build
sudo systemctl restart nutrition-coach
```

先備份再 migrate，出問題時可以用上面的步驟還原。

## 疑難排解

| 症狀 | 檢查 |
|---|---|
| 手機打不開 | `systemctl status nutrition-coach cloudflared`；dashboard 裡 tunnel 狀態是否為 Healthy |
| 重開機後沒恢復 | 工作排程器裡 `NutritionCoachWSL` 的上次執行結果；改用 1.4 的自動登入備案 |
| 服務一直重啟 | `journalctl -u nutrition-coach -n 100`；常見原因是 `.env` 缺值或 `GUEST_SESSION_SECRET` 太短 |
| `better-sqlite3` 相關錯誤 | `node -v` 必須是 22；在 checkout 裡執行 `yarn install --force` 重新編譯 |
| `yarn start` 報 source 不乾淨 | checkout 裡有未追蹤的檔案，用 `git status` 找出來移走 |
