# 熱量日記：AI 拍照辨識後端

這是一個 Cloudflare Worker。它接收熱量日記 PWA 傳來的食物照片，呼叫 Claude 視覺模型，再回傳食物清單與估計熱量。
AI 的 API 金鑰只存放在 Cloudflare，不會出現在手機或網頁裡。

## 你需要準備
1. **Node.js**（LTS 版）：https://nodejs.org ，用來執行部署工具。
2. **Cloudflare 帳號**（免費）：https://dash.cloudflare.com/sign-up
3. **Anthropic API 金鑰**：到 https://platform.claude.com 註冊、儲值後建立金鑰。
   建議同時在 Console 設定**每月花費上限**，避免意外的費用。

## 部署步驟
在 `food-ai-worker` 資料夾中依序執行：

```bash
npm install
```

```bash
npx wrangler login
```

設定 API 金鑰（會提示你貼上，不會留在檔案中）：
```bash
npx wrangler secret put ANTHROPIC_API_KEY
```

設定存取碼（自己想一組長一點的密碼，之後填進 App 的設定裡，防止別人盜用你的後端）：
```bash
npx wrangler secret put APP_TOKEN
```

部署：
```bash
npx wrangler deploy
```

完成後會顯示網址，例如 `https://food-ai-worker.你的帳號.workers.dev`。

## 在 App 中啟用
1. 打開熱量日記 →「個人設定」→「AI 拍照辨識」。
2. 填入上面的網址與存取碼，按「儲存 AI 設定」。
3. 新增食物 →「拍照」→ 拍照或選照片 →「開始辨識」。

## 正式上線前要改的設定
`wrangler.toml` 中的 `ALLOWED_ORIGINS` 預設只允許本機測試網址 `http://localhost:5173`。
把 PWA 部署到 GitHub Pages 等網址後，要把那個網址加進去（逗號分隔），再執行一次 `npx wrangler deploy`：

```toml
ALLOWED_ORIGINS = "https://你的帳號.github.io,http://localhost:5173"
```

## 模型與費用
| 設定 | 說明 |
|---|---|
| `MODEL = "claude-opus-5-5"`（預設） | 辨識與份量估算最準確。 |
| `MODEL = "claude-haiku-5-5"` | 費用約為 Opus 的 1/40，準確度較低，適合想把費用壓到最低時使用。 |
| `EFFORT` | 思考深度：`low` / `medium`（預設）/ `high`。越高越準，但越慢、越貴。 |

使用 Opus 時，模型偶爾被安全機制誤擋，程式已開啟「自動改用備援模型重跑」（`fallbacks: "default"`），不需另外處理。

## 本機測試
```bash
npx wrangler dev
```
在 `.dev.vars` 檔案中放入 `ANTHROPIC_API_KEY=...` 與 `APP_TOKEN=...`（這個檔案不要上傳到 GitHub），
再把 App 的後端網址設為 `http://localhost:8787`。

## API 格式
**請求**：`POST`，標頭 `X-App-Token: <存取碼>`
```json
{ "image": "data:image/jpeg;base64,...", "note": "飯只吃一半（選填）" }
```
**回應**
```json
{
  "items": [
    { "name": "滷肉飯", "portion": "1 小碗", "grams": 250, "kcal": 400, "protein": 12, "carb": 55, "fat": 15 }
  ],
  "confidence": "medium",
  "note": "份量依碗的大小估計。",
  "model": "claude-opus-5-5"
}
```
發生錯誤時回傳 `{ "error": "中文錯誤訊息" }`，App 會直接顯示給使用者。
