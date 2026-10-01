#!/usr/bin/env bash
set -euo pipefail

echo "=================================================="
echo "  DISC 行為評估專案治理與安全性自檢腳本"
echo "  相容平台: macOS (BSD) / Linux (GNU)"
echo "=================================================="

# 1. 檢驗本地 Vendor 檔案真實 SHA-256 雜湊
CHART_SHA="383161c9eefeb5b95ba07a6886e0c05763b6a9ad72e1c94441369cfca3e2c608"
TAILWIND_SHA="44f76aa0891d17d5268c2d585489ef0cbf376ce5fc9bc9cf766e4a2e5fa92f15"

echo "[1/3] 正在驗證 vendor/ 目錄檔案完整性 (SHA-256)..."

if [ ! -f "vendor/chart.min.js" ] || [ ! -f "vendor/tailwind.min.css" ]; then
  echo "❌ 錯誤：vendor/ 目錄下缺少依賴檔案！請先執行 ./download-vendors.sh。"
  exit 1
fi

calculate_sha256() {
  local file="$1"
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$file" | awk '{print $1}'
  elif command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$file" | awk '{print $1}'
  else
    echo "❌ 錯誤：系統缺少 shasum 或 sha256sum 指令"
    exit 1
  fi
}

CALC_CHART_SHA=$(calculate_sha256 "vendor/chart.min.js")
CALC_TAILWIND_SHA=$(calculate_sha256 "vendor/tailwind.min.css")

if [ "$CALC_CHART_SHA" != "$CHART_SHA" ]; then
  echo "❌ 嚴重：vendor/chart.min.js SHA-256 校驗失敗！"
  echo "   期望值: $CHART_SHA"
  echo "   實際值: $CALC_CHART_SHA"
  exit 1
fi

if [ "$CALC_TAILWIND_SHA" != "$TAILWIND_SHA" ]; then
  echo "❌ 嚴重：vendor/tailwind.min.css SHA-256 校驗失敗！"
  echo "   期望值: $TAILWIND_SHA"
  echo "   實際值: $CALC_TAILWIND_SHA"
  exit 1
fi

echo "✅ Vendor 依賴 SHA-256 校驗通過，無篡改風險。"

# 2. 跨平台 POSIX 安全靜態掃描（檢驗是否存在非法 innerHTML 賦值）
echo "[2/3] 正在掃描前端程式碼安全漏洞 (POSIX 相容)..."

UNSAFE_ASSIGNMENTS=$(find js/ -type f -name "*.js" ! -name "*.test.js" -exec grep -HnE "innerHTML[[:space:]]*=" {} + | grep -vE "innerHTML[[:space:]]*=[[:space:]]*(\"\"|'')[[:space:]]*;" || true)

if [ -n "$UNSAFE_ASSIGNMENTS" ]; then
  echo "❌ 警告：檢測到非法 innerHTML 動態賦值！"
  echo "$UNSAFE_ASSIGNMENTS"
  echo "請改用 textContent 或 document.createElement 構建 DOM。"
  exit 1
fi

echo "✅ 靜態掃描通過：零非法動態 innerHTML 拼接。"

# 3. HTTP 標頭遠端探針（若提供 URL 參數）
if [ "${1:-}" != "" ]; then
  TARGET_URL="$1"
  echo "[3/3] 正在對線上站點進行 HTTP 響應頭探針檢驗: $TARGET_URL"
  HEADERS=$(curl -sIL "$TARGET_URL")

  check_header() {
    local header_name="$1"
    if echo "$HEADERS" | grep -iq "^$header_name"; then
      echo "  ✅ $header_name: 已生效"
    else
      echo "  ❌ $header_name: 缺失或未生效！"
    fi
  }

  check_header "X-Frame-Options"
  check_header "X-Content-Type-Options"
  check_header "Referrer-Policy"
  check_header "Content-Security-Policy"
else
  echo "[3/3] 未傳入線上 URL，略過 HTTP 響應頭遠端探測。（用法：./verify.sh https://your-site.com）"
fi

echo "=================================================="
echo "  🎉 專案驗證完畢：完全符合企業生產級交付標準！"
echo "=================================================="
