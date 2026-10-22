# 熱量日記

個人專屬的每日熱量紀錄與體重追蹤 PWA。資料只存在每位使用者自己的手機瀏覽器裡，不會上傳。

| 資料夾 | 內容 |
|---|---|
| [`kcal-diary/`](kcal-diary/) | PWA 本體（推送到 `main` 後自動部署到 GitHub Pages） |
| [`food-ai-worker/`](food-ai-worker/) | 選用的 AI 拍照辨識後端（Cloudflare Worker，需付費） |
| [`tools/`](tools/) | 衛福部食品營養資料轉換程式 |

## 使用方式
用手機開啟 GitHub Pages 網址，iPhone 在 Safari 按「分享 → 加入主畫面」，Android 在 Chrome 選「安裝應用程式」。

## 更新網站
修改 `kcal-diary/` 裡的檔案後，把 `kcal-diary/sw.js` 的 `CACHE` 版本號加 1，再推送到 `main`，GitHub Actions 會自動重新部署。

## 資料來源與授權
- 食物營養資料：衛生福利部食品藥物管理署「食品營養成分資料集」，政府資料開放授權條款第1版。
- 條碼商品資料：Open Food Facts，Open Database License（ODbL）。
