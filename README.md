# DISC 行為評估 / DISC Behavioral Assessment

[繁體中文](#繁體中文) | [English](#english)

---

## 繁體中文

**DISC 行為評估（disc-assessment）** 是一套純前端、零伺服器依賴、以密碼學保障私隱的企業級行為偏好探索工具。本系統基於威廉·莫爾頓·馬斯頓（William Moulton Marston）經典雙軸模型構建，採用心理計量學的強制迫選架構（Ipsative Format）與 NNPI 標準化指標，消除傳統問卷的自我美化與社會讚許偏差。

### 核心特點

- **Ipsative 幾何約束模型**：採用 24 組迫選矩陣（[+] 最符合 與 [-] 最不符）。四個維度在標準化後總和恆等於 200（平均中線為 50），客觀呈現約束環境下的相對取捨偏好，非絕對能力評級。
- **雙面代價去偏題庫**：所有選項均包含「正面優勢」與「代價妥協」的對稱結構，有效杜絕「全選優點」的社會讚許性偏差。
- **無伺服器與本機 AES-GCM 加密**：
  - 運算完全於瀏覽器本地沙盒執行，無任何資料傳輸至遠端伺服器。
  - 歷史評估資料採用 Web Crypto API 產生的 256 位元隨機金鑰進行 AES-GCM 加密並存放於本地端（IndexedDB / LocalStorage）。
- **完整雙語介面（i18n）**：支援繁體中文與英文一鍵即時切換，包含題庫、分析報告、主管摘要及雷達圖。
- **無障礙與高效鍵盤流**：支援全鍵盤作答（`Tab` 切換題卡，數字鍵 `1-4` 選最符合，`Q-R` 選最不符），杜絕焦點競爭與重複觸發。
- **時間與行為審計**：整合 Page Visibility API，客觀記錄有效作答時長，辨識反覆糾結題項，且絕不懲罰受測者的深度思考。

---

### 目錄結構

```text
disc-assessment/
├── index.html              # 主頁面（無障礙語意化排版、列印樣式）
├── _headers                # Cloudflare Pages / Netlify 安全回應頭設定
├── package.json            # 模組化宣告與單元測試指令
├── verify.sh               # 跨平台 (macOS/Linux) 程式碼審計與完整性校驗
├── js/
│   ├── app.js              # 核心演算法、AES-GCM 加密與事件流控制器
│   ├── i18n.js             # 繁體中文 / 英文雙語字彙對照表
│   ├── questions.js        # 24 組雙面代價題庫 (含 costType 標註)
│   └── profiles.js         # 16 種風格註冊表 (4 純單一 + 12 有序複合)
└── test/
    └── registry.test.js    # CI/CD 16 種風格完整性單元測試

```

---

### 本地開發與預覽

本專案採用原生 ES 模組（ES Modules），請使用本地 HTTP 伺服器啟動：

```bash
# 1. 複製專案倉庫
git clone [https://github.com/jackylawck/DISC-Assessment.git](https://github.com/jackylawck/DISC-Assessment.git)
cd DISC-Assessment

# 2. 執行完整性與安全自檢
chmod +x verify.sh
./verify.sh

# 3. 執行心理計量風格單元測試
npm test

# 4. 啟動本機伺服器
python3 -m http.server 8000
# 瀏覽器開啟 http://localhost:8000

```

---

### 部署說明與安全標頭邊界

1. **推薦平台（安全響應頭完全原生生效）**：
* 推薦部署至 **Cloudflare Pages** 或 **Netlify**。根目錄的 `_headers` 會自動被邊緣節點解析，原生套用 `Content-Security-Policy`、`X-Frame-Options: DENY` 及 `X-Content-Type-Options: nosniff`。


2. **GitHub Pages 部署注意事項**：
* GitHub Pages 預設會忽略 `_headers` 檔案。若部署於 GitHub Pages，建議啟用 Cloudflare 代理（Proxy 模式），並透過 Cloudflare Transform Rules 注入自訂安全標頭。



---

## English

**DISC Behavioral Assessment (`disc-assessment`)** is an enterprise-grade, privacy-first, zero-server behavioral profiling tool. Built on William Moulton Marston's classical dual-axis behavioral framework, it implements a psychometrically sound **Ipsative forced-choice architecture** and **Normalized Net Preference Index (NNPI)**, eliminating self-inflation and social desirability biases commonly found in conventional Likert-scale surveys.

### Key Features

* **Ipsative Geometric Constraint**: Employs 24 forced-choice matrices (choosing [+] Most and [-] Least). Standardized dimension scores sum constantly to 200 (mean baseline = 50), accurately capturing contextual trade-offs rather than absolute competence.
* **Dual-Cost Debiased Items**: Every item is structured with balanced trade-offs ("benefit + inherent cost"), preventing socially desirable halo effects.
* **Zero-Server & Local AES-GCM Encryption**:
* All metrics, logic, and visualizations are rendered entirely client-side. Zero telemetry or network payloads.
* Retest records are encrypted on-device with AES-GCM-256 via the Web Crypto API, storing isolated keys in IndexedDB.


* **Full Internationalization (i18n)**：Seamless hot-switching between Traditional Chinese (繁體中文) and English across questionnaire items, reports, radar charts, and executive briefs.
* **High-Velocity Accessible Keyboard Flow**: Full WAI-ARIA and keyboard shortcut support (`Tab` to navigate cards, `1-4` for Most, `Q-R` for Least), built with robust unidirectional event dispatching.
* **Cognitive Time Auditing**: Utilizes the Page Visibility API to measure authentic deliberation latency and pinpoint high-tension items without penalizing deliberate reflection.

---

### Project Structure

```text
disc-assessment/
├── index.html              # Main presentation markup with print styles
├── _headers                # Security response headers for Cloudflare/Netlify
├── package.json            # Module specifications and test runners
├── verify.sh               # Cross-platform (macOS/Linux) security verification
├── js/
│   ├── app.js              # Core scoring engine, Web Crypto storage, and controller
│   ├── i18n.js             # Internationalization dictionaries (ZH / EN)
│   ├── questions.js        # 24 dual-cost debiased assessment items
│   └── profiles.js         # 16-profile registry (4 primary + 12 blends)
└── test/
    └── registry.test.js    # CI/CD integrity testing suite

```

---

### Quick Start & Local Preview

This project uses standard ECMAScript Modules (ESM). Run with any local HTTP static server:

```bash
# 1. Clone repository
git clone [https://github.com/jackylawck/DISC-Assessment.git](https://github.com/jackylawck/DISC-Assessment.git)
cd DISC-Assessment

# 2. Run security and static verification
chmod +x verify.sh
./verify.sh

# 3. Run psychometric logic unit tests
npm test

# 4. Launch local development server
python3 -m http.server 8000
# Open http://localhost:8000 in your browser

```

---

### Deployment & Security Boundary Disclosure

1. **Recommended Platforms (Native Header Enforcement)**:
* Deploy to **Cloudflare Pages** or **Netlify**. The `_headers` configuration will be parsed natively, emitting strict security policies (`Content-Security-Policy`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`).


2. **GitHub Pages Deployment Boundary**:
* Native GitHub Pages ignores the `_headers` file. If hosting directly via GitHub Pages, proxying through Cloudflare (Proxied DNS mode) with Cloudflare Transform Rules is recommended to enforce defensive headers at the edge.



---

### License

Distributed under the MIT License. See `LICENSE` for more information.
