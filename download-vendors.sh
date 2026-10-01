#!/usr/bin/env bash
set -euo pipefail

echo "📦 正在下載 vendor 依賴檔案（Chart.js 3.9.1 & Tailwind CSS 2.2.19）..."

mkdir -p vendor

# 下載 Chart.js 3.9.1
curl -sL -o vendor/chart.min.js https://cdn.jsdelivr.net/npm/chart.js@3.9.1/dist/chart.min.js

# 下載 Tailwind CSS 2.2.19
curl -sL -o vendor/tailwind.min.css https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css

echo "✅ Vendor 檔案下載完成！請執行 ./verify.sh 進行 SHA-256 完整性校驗。"
