# 隱私權保護、資料治理與免責聲明
# Privacy Policy, Data Governance & Legal Disclaimer

[繁體中文](#繁體中文) | [English](#english)

---

## 繁體中文

### 一、全球隱私法規適用性評估與合規依據

本專案採行**零伺服器儲存架構（Zero-Server Storage Architecture）**。所有計算、視覺化與歷史資料比對均於使用者之個人瀏覽器記憶體及本機沙盒內執行。

#### 1. 香港《個人資料（私隱）條例》（第486章, PDPO）
- **非「資料使用者」**：本工具不設立伺服器端資料庫，不收集受測者之個人身分識別資料（如姓名、身分證號碼、電話或電郵地址）。
- **保障資料原則（DPPs）實踐**：
  - **DPP 1（收集目的及方式）**：僅即時處理完成評估所必需之選項代碼，不涉及身分追蹤。
  - **DPP 2（準確性及保留期間）**：本地草稿及加密結果由使用者本機全權控制；關閉視窗即清除 Session 草稿，加密資料受 30 天 TTL 限制。
  - **DPP 4（資料保安）**：本機持久化資料使用 AES-GCM-256 加密儲存。

#### 2. 歐盟通用數據保障條例（EU GDPR / UK GDPR）
- **預設與設計隱私（Privacy by Design & Default, Art. 25）**：架構本質即杜絕跨境傳輸（Data Transfer）與外部洩漏風險。
- **無資料控制者關係**：本開源專案維護者無法存取、檢視或復原受測者於瀏覽器內產生的任何評測數據。

#### 3. 中華人民共和國《個人信息保護法》（PIPL）
- 本工具不處理個人信息，不涉及敏感個人信息，不觸發境內個人信息向境外提供之安全評估申報義務。

---

### 二、重要法律免責聲明 (Legal Disclaimer)

1. **非心理臨床或精神醫學診斷**：
   本工具依據公開之行為特質模型構建，旨在提供個人工作風格反思與團隊協作溝通指引，**不構成任何心理健康診斷、醫學評估或精神狀態鑑定**。
2. **非獨立僱傭決定依據**：
   受測結果反映的是受測者在面對雙面代價矩陣時的「主觀取捨傾向」，非絕對職能勝任力。組織不得將本工具作為招聘錄用、晉升考核或解僱之唯一裁決依據。
3. **無保證聲明 (AS-IS)**：
   本開源工具依據 MIT 授權條款按「現狀（AS-IS）」提供，不對特定商業目的之適用性提供明示或暗示之擔保。使用者須自行評估結果之適用性。

---

## English

### 1. Global Privacy Framework Compliance

This software operates under a **Zero-Server Storage Architecture**. All computation, statistical normalization, and storage occur strictly within the client's local browser sandbox.

#### 1. Hong Kong Personal Data (Privacy) Ordinance (Cap. 486, PDPO)
- **Data User Exemption**: This tool operates without backend servers or databases. It collects no Personally Identifiable Information (PII) (e.g., legal names, national identification numbers, phone numbers, or emails).
- **Adherence to Data Protection Principles (DPPs)**:
  - **DPP 1**: Minimal behavioral preference metrics are processed strictly for real-time scoring.
  - **DPP 2**: Retention is strictly controlled locally by the end-user.
  - **DPP 4**: All persisted history is encrypted on-device via AES-GCM-256.

#### 2. EU / UK General Data Protection Regulation (GDPR)
- **Privacy by Design and Default (Article 25)**: Because data never exits the client device, risks of cross-border data transfers, processing breaches, or third-party leakage are architecturally eliminated.
- **No Controller Relationship**: The repository maintainers maintain zero access to, possession of, or visibility into user assessment datasets.

#### 3. Mainland China Personal Information Protection Law (PIPL)
- No personal information is collected or processed; cross-border transfer security assessments are non-applicable.

---

### 2. Legal Disclaimer

1. **Non-Clinical & Non-Diagnostic**:
   This tool is designed strictly for workplace behavioral reflection and team alignment. It **does not constitute psychological, psychiatric, or clinical diagnostic evaluations**.
2. **Employment Decision Safeguard**:
   Results represent contextual behavioral trade-offs rather than definitive vocational competence. This tool must not be utilized as the sole deterministic basis for hiring, promotion, disciplinary action, or termination.
3. **AS-IS Warranty Disclaimer**:
   Provided under the MIT License "AS-IS", without warranties of any kind, either express or implied, including fitness for a particular purpose. Users assume full responsibility for the operational application of assessment outputs.
