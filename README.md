# Threads Auto Publisher

每日自動喺 Threads 發佈文章嘅 MVP。系統會喺香港時間 09:00 和 17:00 先根據編輯方向 call OpenRouter 生成新草稿，再送 Telegram approval；得到 approval 後先喺 12:00 和 20:00 發佈。

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

## 4. 每日審批同自動發佈

已經有 GitHub Actions workflow：`.github/workflows/daily-threads-post.yml`。

預設每日香港時間：

- 12:00 左右：送 15:00 post 到 Telegram approval
- 14:00 左右：送 17:00 post 到 Telegram approval
- 16:00 左右：送 19:00 post 到 Telegram approval
- 18:00 左右：送 21:00 post 到 Telegram approval
- 每 15 分鐘檢查一次到期 post；只要 Telegram 已 approve，而且該 slot 未發佈，就會補發。

GitHub Actions schedule 可能會延遲或被略過，所以 workflow 用輪詢式設計：cron 每 15 分鐘跑一次，並避開每小時 00 分；程式再按香港時間判斷邊個 approval 或 publish 動作到期。即使你遲咗 approve，系統都會喺下一次輪詢補發，而唔會只限於原本固定 45 分鐘嘅窗口。

Approval 前會先用 `data/editor-briefs.json` 和 `data/brand-guide.json` call OpenRouter 生成新草稿，寫入 `data/posts.json`，再送 Telegram。若你按 `Revise` 或回覆修改方向，系統會再 call OpenRouter 修正一次，然後重新送 approval。

你需要喺 GitHub repo settings 加 secrets：

- `THREADS_ACCESS_TOKEN`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`
- `OPENROUTER_API_KEY`
- `OPENROUTER_MODEL`，可選，預設 `openai/gpt-5.4-mini`
- `ENABLE_TRENDS_CONTEXT`，可選，預設 `true`
- `GOOGLE_TRENDS_RSS_URL`，可選，預設 `https://trends.google.com/trending/rss?geo=HK`
- `GOOGLE_TRENDS_LIMIT`，可選，預設 `10`

生成草稿時，系統會讀取香港 Google Trends RSS，將 trending keywords 交俾 AI 判斷。只有當 trend 可以自然連到保險銷售、入行心理、AI 工作流、信任、風險、收入不穩、家庭責任或銷售系統時，先會用入文章；如果唔相關，就會忽略，避免硬抽水。
- `THREADS_USER_ID`，可選，預設 `me`
- `THREADS_API_VERSION`，可選，預設 `v1.0`

Telegram setup:

1. 在 Telegram 找 `@BotFather`，建立 bot，取得 bot token。
2. 對新 bot 發 `/start`。
3. 本機 `.env` 填 `TELEGRAM_BOT_TOKEN=...`。
4. 跑：

```bash
npm run telegram:chat-id
```

5. 將輸出入面嘅 `id` 放入 GitHub Secret `TELEGRAM_CHAT_ID`。

Telegram 收到 approval message 後，可以直接撳：

```text
Approve
```

或者：

```text
Reject
```

如果想改文，撳 `Revise`，或者回覆：

```text
REVISE 這篇太硬銷，改得更神秘、更像講中心事
```

`Revise` 會用 AI 根據你嘅修改方向重寫，然後重新送一條 Telegram approval message。

舊格式仍然支援：

```text
APPROVE 2026-04-25-1200
REJECT 2026-04-25-1200
```

## 5. 內容格式

本地 JSON 或 Google Sheet 都用同一組欄位：

```json
{
  "id": "unique-id",
  "date": "2026-04-25",
  "slot": "12:00",
  "text": "要發佈嘅內容",
  "status": "ready"
}
```

`slot` 用 `12:00` 或 `20:00`。注意：Threads 一般文字 post 建議保持 500 字或以下。要做長文 thread、圖片、Google Sheet 或 Notion 內容庫，可以喺呢個基礎上加 adaptor。

## 6. 編輯內容提案

呢個 branch 加咗一個簡單編輯 brief：

```bash
npm run editor:ideas
```

內容方向放喺 `data/editor-briefs.json`；品牌定位、語氣、禁用位放喺 `data/brand-guide.json`。每日 approval 前會按呢兩個檔案自動生成新草稿，再寫入 `data/posts.json`。

## 7. Google Sheet 內容庫

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
