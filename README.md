# Threads Auto Publisher

每日自動喺 Threads 發佈一篇文章嘅 MVP。內容可以放喺 `data/posts.json`，或者用 Google Sheet 發佈成 CSV。系統會揀日期等於今日、狀態係 `ready`、而且未發佈過嘅文章。

## 1. 本地測試

```bash
npm run post:dry-run
```

Dry run 只會顯示將會發佈邊篇，唔會 call Threads API。

## 2. 設定 Threads API

1. 去 Meta for Developers 建立 Threads use case app。
2. 用 OAuth 取得 Threads user access token。
3. 複製 `.env.example` 做 `.env`，填入：

```bash
THREADS_ACCESS_TOKEN=...
THREADS_USER_ID=me
THREADS_API_VERSION=v1.0
TIME_ZONE=Asia/Hong_Kong
DRY_RUN=false
```

`THREADS_USER_ID` 可以先用 `me`。正式多帳號管理時先改成指定 user id。

### OAuth helper

`.env` 加入：

```bash
THREADS_APP_ID=...
THREADS_APP_SECRET=...
THREADS_REDIRECT_URI=https://ck-keepgrowing.github.io/threads-auto-publisher/callback/
```

生成授權連結：

```bash
npm run token:url
```

登入 Threads 並授權後，瀏覽器會跳到 callback page 並顯示 `code`。複製嗰段 code，然後：

```bash
npm run token:exchange -- "PASTE_CODE_HERE"
```

輸出嘅 long-lived token 就係 GitHub Secret `THREADS_ACCESS_TOKEN`。

Useful public URLs for Meta app settings:

- Privacy policy: `https://ck-keepgrowing.github.io/threads-auto-publisher/privacy/`
- Data deletion: `https://ck-keepgrowing.github.io/threads-auto-publisher/data-deletion/`
- OAuth callback: `https://ck-keepgrowing.github.io/threads-auto-publisher/callback/`

## 3. 發佈

```bash
npm run post:today
```

成功後會寫入 `data/published.json`，失敗會寫入 `data/errors.json`。GitHub Actions 會將呢兩個 log commit 返 repo，用嚟避免同一日 rerun 時重複發佈。

## 4. 每日自動發佈

已經有 GitHub Actions workflow：`.github/workflows/daily-threads-post.yml`。

預設每日香港時間 09:00 發佈。你需要喺 GitHub repo settings 加 secrets：

- `THREADS_ACCESS_TOKEN`
- `THREADS_USER_ID`，可選，預設 `me`
- `THREADS_API_VERSION`，可選，預設 `v1.0`

## 5. 內容格式

本地 JSON 或 Google Sheet 都用同一組欄位：

```json
{
  "id": "unique-id",
  "date": "2026-04-25",
  "text": "要發佈嘅內容",
  "status": "ready"
}
```

注意：Threads 一般文字 post 建議保持 500 字或以下。要做長文 thread、圖片、Google Sheet 或 Notion 內容庫，可以喺呢個基礎上加 adaptor。

## 6. Google Sheet 內容庫

Sheet 第一行用以下欄位：

```text
id,date,text,status
```

然後將 Sheet 發佈為 CSV，設定：

```bash
CONTENT_SOURCE=google_sheet_csv
GOOGLE_SHEET_CSV_URL=https://docs.google.com/spreadsheets/d/e/.../pub?output=csv
```

如果用 GitHub Actions，就將 `CONTENT_SOURCE` 同 `GOOGLE_SHEET_CSV_URL` 加入 repo secrets。
