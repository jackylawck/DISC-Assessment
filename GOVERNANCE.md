# 治理、合規與技術邊界聲明
# Governance, Compliance & Technical Scope Statement

[繁體中文](#繁體中文) | [English](#english)

---

## 繁體中文

### 一、系統本質與「非人工智能」架構聲明 (Algorithmic Nature & Non-AI Statement)

本專案（`disc-assessment`）屬於**確定性規則評測系統（Deterministic Rule-Based Assessment Tool）**。
- **純數學幾何映射**：評估計分完全基於固定數學公式（強制迫選 Ipsative 幾何守恆模型及標準化淨偏好指標 NNPI），不包含任何機器學習（Machine Learning）、深度神經網絡（Deep Neural Networks）、大語言模型（LLMs）或自主自適應推論演算法。
- **無自主決策權**：本工具不具備自主調整權重或自主訓練之功能，每項輸入之計分結果均具備 100% 可重現性（Deterministic & Explainable）。

#### 相關 AI 法規適用性排除 (Statutory AI Framework Exclusions)：
1. **歐盟《人工智能法案》（EU AI Act）**：
   - 根據 EU AI Act 第 3 條第 (1) 款對「人工智能系統」之定義，本專案因不具備推論、自主性與模型自適應特性，**明確排除於 EU AI Act 之監管範圍外（Out of Scope）**。
   - 本工具非人事招募決定之「高風險 AI 系統（High-Risk AI System）」，僅供個人反思與團隊溝通輔助。
2. **中國國家互聯網信息辦公室（CAC）法規**：
   - 不適用《生成式人工智能服務管理暫行辦法》（無內容生成能力）。
   - 不適用《互聯網信息服務算法推薦管理規定》（無內容推薦、流量分發或演算法定價機制）。
3. **ISO/IEC 42001 (人工智能管理體系, AIMS)**：
   - 不適用於本專案，本專案不宣稱符合 ISO/IEC 42001 標準。

---

### 二、資訊安全與隱私控制矩陣 (ISO/IEC 27001 & ISO/IEC 27701 Alignment)

本專案雖然為無伺服器架構，但在客戶端工程實作上全面對標 **ISO/IEC 27001 (資訊安全)** 與 **ISO/IEC 27701 (隱私資訊)** 之控制原則：

| 控制領域 | 對標標準條款 | 本專案實作機制 | 審計驗證依據 |
| :--- | :--- | :--- | :--- |
| **靜態資料保護** | ISO 27001 A.8.24 (密碼學)<br>ISO 27701 7.4.1 | 採用瀏覽器原生 Web Crypto API 生成真隨機 256 位元金鑰，進行 AES-GCM-256 本機加密儲存。 | `js/app.js` (SecureStorage 模組) |
| **資料最小化** | ISO 27701 7.2.8<br>GDPR Art. 5(1)(c) | 零個人識別資料（Zero PII）。系統不設立使用者登入，不收集姓名、IP 或聯絡方式。 | 純客戶端運行架構 |
| **軟體供應鏈安全** | ISO 27001 A.8.30<br>ISO 27001 A.8.9 | 第三方相依（Chart.js、Tailwind）本地託管於 `vendor/`，消除外部 CDN 注入風險，並以硬編碼 SHA-256 雜湊鎖定。 | `verify.sh` 自動化校驗 |
| **輸入/輸出安全** | ISO 27001 A.8.28 (安全編碼) | 全面淘汰 `innerHTML` 拼接，全面採用 `textContent` 與原生 `createElement`，杜絕 DOM XSS。 | 靜態代碼稽核通過 |
| **資料保存與銷毀** | ISO 27701 7.4.7<br>PDPO 保留原則 | 本地加密資料設定 30 天存活期（TTL），過期自動銷毀；提供一鍵重設與清除功能。 | `SecureStorage.getItem()` |

---

## English

### 1. Deterministic Nature & Non-AI Scope Exclusion

This software (`disc-assessment`) is a **deterministic, rule-based psychometric exploration tool**.
- **Mathematical Determinism**: Scoring calculations rely strictly on immutable arithmetic equations (Ipsative geometric constraint and Normalized Net Preference Index - NNPI). It incorporates **no Machine Learning (ML), neural networks, large language models (LLMs), or adaptive statistical inference**.
- **Zero Algorithmic Autonomy**: The system possesses zero autonomous learning capability. Given identical inputs, outputs are 100% deterministic, transparent, and auditable.

#### Regulatory AI Exclusions:
1. **EU Artificial Intelligence Act (EU AI Act)**:
   - Pursuant to Article 3(1) of the EU AI Act, this software lacks the requisite autonomy and inference capabilities, and is hereby explicitly declared **OUT OF SCOPE**.
   - It is not an automated high-risk employment decision system; it serves solely as an individual and team communication aid.
2. **Cyberspace Administration of China (CAC) Regulations**:
   - Out of scope under the *Interim Measures for the Management of Generative AI Services* (no generative capability).
   - Out of scope under the *Provisions on the Management of Algorithmic Recommendations* (no algorithmic recommendation, profiling, or feed-filtering).
3. **ISO/IEC 42001 (AIMS)**:
   - Does not apply. No certification claim under ISO/IEC 42001 is asserted.

---

### 2. Information Security & Privacy Controls (ISO/IEC 27001 & ISO 27701 Alignment)

This project strictly adheres to **Privacy by Design** and security best practices aligned with **ISO/IEC 27001** and **ISO/IEC 27701**:

- **Cryptography & Data-at-Rest (ISO 27001 A.8.24)**: Client-side storage is secured via the Web Crypto API using cryptographically random 256-bit AES-GCM encryption.
- **Data Minimisation (ISO 27701 7.2.8 & GDPR Art. 5)**: Zero Personally Identifiable Information (PII) is processed or requested. No tracking, user logins, or telemetry.
- **Software Supply Chain Integrity (ISO 27001 A.8.30)**: Vendor libraries (`Chart.js`, `Tailwind`) are vendor-hosted locally. Build-time integrity is locked with verifiable SHA-256 checksums (`verify.sh`).
- **Secure Coding (ISO 27001 A.8.28)**: Complete eradication of dynamic `innerHTML` in favor of declarative, safe DOM construction (`createElement`, `textContent`) preventing DOM-based XSS.
- **Storage Limitation & TTL (ISO 27701 7.4.7)**: Local encrypted records enforce a strict 30-day Time-To-Live (TTL) auto-purge policy.
