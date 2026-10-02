import { questionsData } from './questions.js';
import { PROFILE_REGISTRY } from './profiles.js';
import { translations } from './i18n.js';

const APP_VERSION = "v3.3.0-enterprise";
const METHODOLOGY_CODE = "NNPI-2026-Rev10";
const STORAGE_KEY = "disc_eval_secure_v4";
const STORAGE_TTL_DAYS = 30;

let currentLang = 'zh'; // 'zh' | 'en'
let timeAuditor = null;
const userAnswers = {};
let chartInstance = null;
let isPrinting = false;
let latestEvaluation = null;

// --- Web Crypto API：真隨機 AES-GCM 安全儲存 ---
class SecureStorage {
  static async getDeviceKey() {
    return new Promise((resolve) => {
      const req = indexedDB.open("DISC_SECURE_STORE", 1);
      req.onupgradeneeded = (e) => {
        e.target.result.createObjectStore("keys");
      };
      req.onsuccess = (e) => {
        const db = e.target.result;
        const tx = db.transaction("keys", "readwrite");
        const store = tx.objectStore("keys");
        const getReq = store.get("local_aes_key");

        getReq.onsuccess = async () => {
          if (getReq.result) {
            resolve(getReq.result);
          } else {
            const newKey = await crypto.subtle.generateKey(
              { name: "AES-GCM", length: 256 },
              false,
              ["encrypt", "decrypt"]
            );
            const putTx = db.transaction("keys", "readwrite");
            putTx.objectStore("keys").put(newKey, "local_aes_key");
            resolve(newKey);
          }
        };
      };
      req.onerror = () => resolve(null);
    });
  }

  static async setItem(key, data) {
    try {
      const keyObj = await this.getDeviceKey();
      if (!keyObj) {
        sessionStorage.setItem(key, JSON.stringify(data));
        return;
      }
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const payload = JSON.stringify({ data, expiresAt: Date.now() + STORAGE_TTL_DAYS * 86400000 });
      const ciphertext = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv },
        keyObj,
        new TextEncoder().encode(payload)
      );

      const packed = {
        iv: Array.from(iv),
        cipher: Array.from(new Uint8Array(ciphertext))
      };
      localStorage.setItem(key, JSON.stringify(packed));
    } catch (e) {
      console.warn("SecureStorage setItem fallback", e);
    }
  }

  static async getItem(key) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const { iv, cipher } = JSON.parse(raw);
      const keyObj = await this.getDeviceKey();
      if (!keyObj) return null;

      const decrypted = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: new Uint8Array(iv) },
        keyObj,
        new Uint8Array(cipher)
      );

      const parsed = JSON.parse(new TextDecoder().decode(decrypted));
      if (Date.now() > parsed.expiresAt) {
        localStorage.removeItem(key);
        return null;
      }
      return parsed.data;
    } catch (e) {
      localStorage.removeItem(key);
      return null;
    }
  }
}

// --- 時間與行為審計引擎 ---
class TimeAuditor {
  constructor(totalQuestions = 24) {
    this.total = totalQuestions;
    this.startTime = Date.now();
    this.lastActiveTime = Date.now();
    this.hiddenAt = null;
    this.accumulatedPauseMs = 0;
    this.firstAnswerTimes = {};
    this.lastAnswerTimes = {};
    this.revisionCounts = {};
    this.previousChoices = {};
    this.hadLongPause = false;
    this.pauseDurationMinutes = 0;

    this._boundHandlers = null;
    this.setupVisibilityTracking();
  }

  setupVisibilityTracking() {
    const handleInactivityStart = () => {
      if (!this.hiddenAt) this.hiddenAt = Date.now();
    };

    const handleInactivityEnd = () => {
      if (this.hiddenAt) {
        const awayMs = Date.now() - this.hiddenAt;
        if (awayMs > 5000) {
          this.accumulatedPauseMs += awayMs;
          this.hadLongPause = true;
          this.pauseDurationMinutes = Math.round(this.accumulatedPauseMs / 60000);
        }
        this.hiddenAt = null;
      }
      this.lastActiveTime = Date.now();
    };

    const handleVisibilityChange = () => {
      if (document.hidden) handleInactivityStart();
      else handleInactivityEnd();
    };

    this._boundHandlers = {
      visibilityChange: handleVisibilityChange,
      blur: handleInactivityStart,
      focus: handleInactivityEnd
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("blur", handleInactivityStart);
    window.addEventListener("focus", handleInactivityEnd);
  }

  destroy() {
    if (!this._boundHandlers) return;
    document.removeEventListener("visibilitychange", this._boundHandlers.visibilityChange);
    window.removeEventListener("blur", this._boundHandlers.blur);
    window.removeEventListener("focus", this._boundHandlers.focus);
    this._boundHandlers = null;
  }

  recordAnswer(qIdx, type, dim) {
    const now = Date.now();
    if (!this.firstAnswerTimes[qIdx]) {
      this.firstAnswerTimes[qIdx] = now;
      this.revisionCounts[qIdx] = 0;
      this.previousChoices[qIdx] = {};
    }

    if (!this.previousChoices[qIdx]) {
      this.previousChoices[qIdx] = {};
    }

    const prevChoice = this.previousChoices[qIdx][type];
    if (prevChoice !== undefined && prevChoice !== dim) {
      this.revisionCounts[qIdx] = (this.revisionCounts[qIdx] || 0) + 1;
    }

    this.previousChoices[qIdx][type] = dim;
    this.lastAnswerTimes[qIdx] = now;
    this.lastActiveTime = now;
  }

  audit() {
    const rawElapsed = Date.now() - this.startTime;
    const effectiveElapsedMs = Math.max(1000, rawElapsed - this.accumulatedPauseMs);
    const elapsedSeconds = Math.round(effectiveElapsedMs / 1000);
    const avgPerQuestion = elapsedSeconds / this.total;

    const chronologicalFirstTimes = Object.entries(this.firstAnswerTimes)
      .map(([qIdx, time]) => ({ qIdx: Number(qIdx), time }))
      .sort((a, b) => a.time - b.time);

    let hasRushedPattern = false;

    if (chronologicalFirstTimes.length >= 8) {
      const rawIntervals = [];
      for (let i = 1; i < chronologicalFirstTimes.length; i++) {
        rawIntervals.push(chronologicalFirstTimes[i].time - chronologicalFirstTimes[i - 1].time);
      }

      const validIntervals = rawIntervals.filter(i => i < 180000);
      const safeIntervals = validIntervals.length >= 6 ? validIntervals : rawIntervals;

      const baselineCutoff = Math.floor(safeIntervals.length * 0.75);
      const baselineIntervals = safeIntervals.slice(0, baselineCutoff);
      const sortedBaseline = [...baselineIntervals].sort((a, b) => a - b);
      const medianBaseline = sortedBaseline[Math.floor(sortedBaseline.length / 2)] || 2500;

      const tailIntervals = safeIntervals.slice(-3);
      const tailAvg = tailIntervals.reduce((a, b) => a + b, 0) / tailIntervals.length;
      if (tailAvg < Math.max(1000, medianBaseline * 0.25)) {
        hasRushedPattern = true;
      }
    }

    const conflictedQuestions = Object.entries(this.revisionCounts)
      .filter(([, count]) => count >= 4)
      .map(([qIdx]) => Number(qIdx) + 1);

    if (avgPerQuestion < 1.0) {
      return {
        level: 'RED',
        isReliable: false,
        elapsedSeconds,
        hadLongPause: this.hadLongPause,
        pauseMinutes: this.pauseDurationMinutes,
        conflictedQuestions,
        msgKey: 'auditRed'
      };
    }

    if (avgPerQuestion < 2.0 || hasRushedPattern) {
      return {
        level: 'YELLOW',
        isReliable: true,
        elapsedSeconds,
        hadLongPause: this.hadLongPause,
        pauseMinutes: this.pauseDurationMinutes,
        conflictedQuestions,
        msgKey: 'auditYellow'
      };
    }

    return {
      level: 'GREEN',
      isReliable: true,
      elapsedSeconds,
      hadLongPause: this.hadLongPause,
      pauseMinutes: this.pauseDurationMinutes,
      conflictedQuestions,
      msgKey: null
    };
  }
}

// --- 語言熱切換函數（100% 同步所有元件） ---
function setLanguage(lang) {
  currentLang = lang;
  const t = translations[lang];

  // 1. 更新靜態標題與文字
  const setElemText = (id, text) => {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  };

  setElemText("html-title", t.appTitle);
  setElemText("header-title", t.headerTitle);
  const descEl = document.getElementById("header-desc");
  if (descEl) {
    descEl.innerHTML = t.headerDesc.replace('[+]', '<strong>[+]</strong>').replace('[-]', '<strong>[-]</strong>');
  }

  setElemText("keyboard-tip-text", t.keyboardTip);
  setElemText("submit-btn", t.submitBtn);
  setElemText("chart-note", t.chartNote);
  setElemText("dos-title", t.dosTitle);
  setElemText("donts-title", t.dontsTitle);
  setElemText("cost-title", t.costTitle);
  setElemText("print-btn", t.printBtn);
  setElemText("retake-btn", t.retakeBtn);

  // 2. 重新渲染題目清單與導航（保留既有勾選）
  renderQuestions();
  populateJumpSelector();
  updateProgressUI();
  setVersionStamps();

  // 3. 若已在結果畫面，即時重繪雙語結果與圖表
  if (latestEvaluation) {
    renderResultView(latestEvaluation, timeAuditor.audit(), null);
  }
}

function setVersionStamps() {
  const printStamp = document.getElementById("report-stamp-print");
  const footerStamp = document.getElementById("report-stamp-footer");
  const t = translations[currentLang];
  const dateStr = new Date().toLocaleDateString(currentLang === 'zh' ? 'zh-HK' : 'en-US');
  const stampText = `${t.systemVersion}：${APP_VERSION} ｜ ${t.methodologyBase}：${METHODOLOGY_CODE} ｜ ${t.generatedDate}：${dateStr}`;

  if (printStamp) printStamp.textContent = stampText;
  if (footerStamp) footerStamp.textContent = stampText;
}

// --- 頁面初始化 ---
document.addEventListener("DOMContentLoaded", async () => {
  await initAssessment();
});

async function initAssessment() {
  const restored = checkSavedDraft();

  if (restored) {
    showRestoreBanner(restored);
  } else {
    if (timeAuditor) timeAuditor.destroy();
    timeAuditor = new TimeAuditor(questionsData.length);
  }

  document.getElementById("skeleton-loader").classList.add("hidden");
  document.getElementById("questions-list").classList.remove("hidden");

  // 讀取當前下拉選單預設值
  const langSel = document.getElementById("lang-select");
  if (langSel) {
    currentLang = langSel.value || 'zh';
  }

  setLanguage(currentLang);
  await setupHistoryNotice();
  bindGlobalEvents();
}

function bindGlobalEvents() {
  const langSel = document.getElementById("lang-select");
  if (langSel) {
    langSel.addEventListener("change", (e) => {
      setLanguage(e.target.value);
    });
  }

  document.getElementById("submit-btn").addEventListener("click", handleSubmit);
  document.getElementById("retake-btn").addEventListener("click", handleSoftReset);
  document.getElementById("print-btn").addEventListener("click", handlePrintWithCanvasFix);
  document.getElementById("jump-select").addEventListener("change", handleJumpToQuestion);

  document.addEventListener("keydown", handleCardKeydown);
}

// 鍵盤單向事件流
function handleCardKeydown(e) {
  const active = document.activeElement;
  if (!active || !active.hasAttribute("data-qidx")) return;

  const qIdx = Number(active.getAttribute("data-qidx"));
  const options = questionsData[qIdx].options;

  const mostKeys = { "1": 0, "2": 1, "3": 2, "4": 3 };
  const leastKeys = { "q": 0, "w": 1, "e": 2, "r": 3, "Q": 0, "W": 1, "E": 2, "R": 3 };

  if (mostKeys[e.key] !== undefined) {
    e.preventDefault();
    const optIdx = mostKeys[e.key];
    const targetDim = options[optIdx].d;
    const radio = document.querySelector(`input[name="most_${qIdx}"][value="${targetDim}"]`);
    if (radio) radio.click();
  } else if (leastKeys[e.key] !== undefined) {
    e.preventDefault();
    const optIdx = leastKeys[e.key];
    const targetDim = options[optIdx].d;
    const radio = document.querySelector(`input[name="least_${qIdx}"][value="${targetDim}"]`);
    if (radio) radio.click();
  }
}

function handlePrintWithCanvasFix() {
  if (isPrinting) return;
  isPrinting = true;

  const canvas = document.getElementById("discChart");
  const chartWrapper = document.getElementById("chart-wrapper");
  if (!canvas || !chartWrapper) {
    window.print();
    isPrinting = false;
    return;
  }

  const printImg = document.createElement("img");
  printImg.src = canvas.toDataURL("image/png");
  printImg.id = "discChart-print-img";
  printImg.className = "w-full max-h-80 object-contain hidden print:block mx-auto";

  chartWrapper.appendChild(printImg);
  canvas.classList.add("print:hidden");

  let isCleaned = false;
  const cleanup = () => {
    if (isCleaned) return;
    isCleaned = true;
    isPrinting = false;
    printImg.remove();
    canvas.classList.remove("print:hidden");
    window.removeEventListener("afterprint", cleanup);
  };

  window.addEventListener("afterprint", cleanup);
  setTimeout(cleanup, 15000);

  window.print();
}

function checkSavedDraft() {
  try {
    const raw = sessionStorage.getItem("disc_progress_draft");
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.answers === "object") return parsed;
  } catch (e) {
    sessionStorage.removeItem("disc_progress_draft");
  }
  return null;
}

function showRestoreBanner(draft) {
  const answeredCount = Object.values(draft.answers).filter(a => a && a.most && a.least).length;
  const banner = document.getElementById("restore-banner");
  if (!banner) return;

  const t = translations[currentLang];
  banner.innerHTML = "";
  const container = document.createElement("div");
  container.className = "flex flex-col sm:flex-row sm:items-center justify-between gap-3";

  const textDiv = document.createElement("div");
  textDiv.textContent = t.restoreText(answeredCount, questionsData.length);

  const btnDiv = document.createElement("div");
  btnDiv.className = "flex gap-2 flex-shrink-0";

  const btnResume = document.createElement("button");
  btnResume.className = "px-3 py-1 bg-green-600 text-white rounded font-medium text-xs hover:bg-green-700 transition";
  btnResume.textContent = t.btnResume;
  btnResume.onclick = () => {
    applyRestoredDraft(draft);
    banner.classList.add("hidden");
  };

  const btnDiscard = document.createElement("button");
  btnDiscard.className = "px-3 py-1 bg-gray-200 text-gray-700 rounded font-medium text-xs hover:bg-gray-300 transition";
  btnDiscard.textContent = t.btnDiscard;
  btnDiscard.onclick = () => {
    sessionStorage.removeItem("disc_progress_draft");
    if (timeAuditor) timeAuditor.destroy();
    timeAuditor = new TimeAuditor(questionsData.length);
    renderQuestions();
    updateProgressUI();
    banner.classList.add("hidden");
  };

  btnDiv.appendChild(btnResume);
  btnDiv.appendChild(btnDiscard);
  container.appendChild(textDiv);
  container.appendChild(btnDiv);
  banner.appendChild(container);
  banner.classList.remove("hidden");
}

function applyRestoredDraft(draft) {
  Object.assign(userAnswers, draft.answers);
  if (timeAuditor) timeAuditor.destroy();
  timeAuditor = new TimeAuditor(questionsData.length);

  timeAuditor.firstAnswerTimes = draft.firstTimes || {};
  timeAuditor.lastAnswerTimes = draft.lastTimes || {};
  timeAuditor.revisionCounts = draft.revisions || {};
  timeAuditor.previousChoices = draft.previousChoices || {};
  timeAuditor.startTime = draft.startTime || Date.now();
  timeAuditor.accumulatedPauseMs = draft.accumulatedPauseMs || 0;

  const awayMs = Date.now() - (draft.lastActiveTime || Date.now());
  if (awayMs > 5000) {
    timeAuditor.accumulatedPauseMs += awayMs;
    timeAuditor.hadLongPause = true;
    timeAuditor.pauseDurationMinutes = Math.round(timeAuditor.accumulatedPauseMs / 60000);
  }

  renderQuestions();
  updateProgressUI();
}

function persistProgress() {
  try {
    sessionStorage.setItem("disc_progress_draft", JSON.stringify({
      answers: userAnswers,
      firstTimes: timeAuditor.firstAnswerTimes,
      lastTimes: timeAuditor.lastAnswerTimes,
      revisions: timeAuditor.revisionCounts,
      previousChoices: timeAuditor.previousChoices,
      startTime: timeAuditor.startTime,
      accumulatedPauseMs: timeAuditor.accumulatedPauseMs,
      lastActiveTime: Date.now()
    }));
  } catch (e) {
    console.warn("草稿保存受限", e);
  }
}

// 題目渲染：依 currentLang 輸出純中文或純英文
function renderQuestions() {
  const container = document.getElementById("questions-list");
  if (!container) return;
  container.innerHTML = "";
  const t = translations[currentLang];

  questionsData.forEach((q, idx) => {
    const card = document.createElement("div");
    card.id = `q-card-${idx}`;
    card.setAttribute("data-qidx", idx);
    card.setAttribute("tabindex", "0");
    card.setAttribute("role", "group");
    card.setAttribute("aria-label", t.questionNum(idx));

    const isComplete = userAnswers[idx]?.most && userAnswers[idx]?.least;
    card.className = `p-5 rounded-2xl border transition duration-150 keyboard-focus bg-white shadow-sm ${
      isComplete 
        ? 'border-green-300 bg-green-50 bg-opacity-30' 
        : 'border-gray-200 hover:border-gray-300'
    }`;

    const headerRow = document.createElement("div");
    headerRow.className = "flex items-center justify-between mb-3 border-b border-gray-100 pb-2.5";

    const titleSpan = document.createElement("span");
    titleSpan.className = "font-bold text-gray-800 text-sm";
    titleSpan.textContent = t.questionNum(idx);

    const legendDiv = document.createElement("div");
    legendDiv.className = "flex gap-4 text-xs font-bold";

    const mostLabel = document.createElement("span");
    mostLabel.className = "w-16 text-center text-blue-600";
    mostLabel.textContent = t.mostLabel;

    const leastLabel = document.createElement("span");
    leastLabel.className = "w-16 text-center text-red-500";
    leastLabel.textContent = t.leastLabel;

    legendDiv.appendChild(mostLabel);
    legendDiv.appendChild(leastLabel);
    headerRow.appendChild(titleSpan);
    headerRow.appendChild(legendDiv);
    card.appendChild(headerRow);

    q.options.forEach((opt, optIdx) => {
      const isMost = userAnswers[idx]?.most === opt.d;
      const isLeast = userAnswers[idx]?.least === opt.d;

      const row = document.createElement("div");
      row.className = "flex items-center justify-between py-2.5 border-b border-gray-50 last:border-0 hover:bg-gray-50 rounded-lg px-2 transition";

      const textWrap = document.createElement("div");
      textWrap.className = "text-sm text-gray-700 pr-3 flex-1 leading-relaxed";
      // 依語言嚴格純淨輸出
      textWrap.textContent = currentLang === 'zh' ? opt.zh : opt.en;

      const actionWrap = document.createElement("div");
      actionWrap.className = "flex gap-4 flex-shrink-0";

      // Most Radio
      const mostBox = document.createElement("label");
      mostBox.className = "w-16 flex justify-center cursor-pointer p-1.5";
      const mostInput = document.createElement("input");
      mostInput.type = "radio";
      mostInput.name = `most_${idx}`;
      mostInput.value = opt.d;
      mostInput.checked = isMost;
      mostInput.tabIndex = -1;
      mostInput.className = "accent-blue-600 h-4 w-4 cursor-pointer";
      mostInput.setAttribute("aria-label", t.mostAria(idx + 1, optIdx + 1));
      mostInput.onchange = () => handleOptionSelect(idx, "most", opt.d);
      mostBox.appendChild(mostInput);

      // Least Radio
      const leastBox = document.createElement("label");
      leastBox.className = "w-16 flex justify-center cursor-pointer p-1.5";
      const leastInput = document.createElement("input");
      leastInput.type = "radio";
      leastInput.name = `least_${idx}`;
      leastInput.value = opt.d;
      leastInput.checked = isLeast;
      leastInput.tabIndex = -1;
      leastInput.className = "accent-red-500 h-4 w-4 cursor-pointer";
      leastInput.setAttribute("aria-label", t.leastAria(idx + 1, optIdx + 1));
      leastInput.onchange = () => handleOptionSelect(idx, "least", opt.d);
      leastBox.appendChild(leastInput);

      actionWrap.appendChild(mostBox);
      actionWrap.appendChild(leastBox);

      row.appendChild(textWrap);
      row.appendChild(actionWrap);
      card.appendChild(row);
    });

    container.appendChild(card);
  });
}

function handleOptionSelect(qIdx, type, dim) {
  if (!userAnswers[qIdx]) userAnswers[qIdx] = {};

  const otherType = type === "most" ? "least" : "most";
  if (userAnswers[qIdx][otherType] === dim) {
    userAnswers[qIdx][otherType] = null;
    const radios = document.getElementsByName(`${otherType}_${qIdx}`);
    radios.forEach(r => { if (r.value === dim) r.checked = false; });
  }

  userAnswers[qIdx][type] = dim;

  if (timeAuditor) {
    timeAuditor.recordAnswer(qIdx, type, dim);
  }

  updateSingleCardHighlight(qIdx);
  persistProgress();
  updateProgressUI();
}

function updateSingleCardHighlight(idx) {
  const card = document.getElementById(`q-card-${idx}`);
  if (!card) return;
  const isComplete = userAnswers[idx]?.most && userAnswers[idx]?.least;
  if (isComplete) {
    card.className = "p-5 rounded-2xl border transition duration-150 keyboard-focus bg-green-50 bg-opacity-30 border-green-300 shadow-sm";
  } else {
    card.className = "p-5 rounded-2xl border transition duration-150 keyboard-focus bg-white border-gray-200 hover:border-gray-300 shadow-sm";
  }
}

function updateProgressUI() {
  const total = questionsData.length;
  let done = 0;
  for (let i = 0; i < total; i++) {
    if (userAnswers[i]?.most && userAnswers[i]?.least) done++;
  }

  const pct = Math.round((done / total) * 100);
  const t = translations[currentLang];
  document.getElementById("progress-text").textContent = t.progressText(done, total, pct);
  document.getElementById("progress-bar").style.width = `${pct}%`;
  document.getElementById("submit-btn").disabled = (done !== total);
}

function populateJumpSelector() {
  const selector = document.getElementById("jump-select");
  if (!selector) return;
  selector.innerHTML = "";
  const defOpt = document.createElement("option");
  defOpt.value = "";
  defOpt.textContent = translations[currentLang].jumpPlaceholder;
  selector.appendChild(defOpt);

  questionsData.forEach((_, idx) => {
    const opt = document.createElement("option");
    opt.value = idx;
    opt.textContent = translations[currentLang].questionNum(idx);
    selector.appendChild(opt);
  });
}

function handleJumpToQuestion(e) {
  const val = e.target.value;
  if (val === "") return;
  const targetCard = document.getElementById(`q-card-${val}`);
  if (targetCard) {
    targetCard.scrollIntoView({ behavior: "smooth", block: "center" });
    targetCard.focus();
  }
  e.target.value = "";
}

async function handleSubmit() {
  const submitBtn = document.getElementById("submit-btn");
  submitBtn.disabled = true;
  submitBtn.textContent = translations[currentLang].analyzingBtn;

  setTimeout(async () => {
    const auditResult = timeAuditor.audit();
    latestEvaluation = runComprehensiveEvaluation();

    const previousResult = await SecureStorage.getItem(STORAGE_KEY);
    await SecureStorage.setItem(STORAGE_KEY, latestEvaluation);
    sessionStorage.removeItem("disc_progress_draft");

    renderResultView(latestEvaluation, auditResult, previousResult);
    submitBtn.textContent = translations[currentLang].submitBtn;
  }, 300);
}

function runComprehensiveEvaluation() {
  const total = questionsData.length;
  const raw = { D: 0, I: 0, S: 0, C: 0 };

  Object.values(userAnswers).forEach(ans => {
    if (ans.most) raw[ans.most] += 1;
    if (ans.least) raw[ans.least] -= 1;
  });

  const normalized = {};
  for (const [k, v] of Object.entries(raw)) {
    normalized[k] = Number((((v + total) / (2 * total)) * 100).toFixed(2));
  }

  const ranked = Object.entries(normalized).sort(([, a], [, b]) => b - a);
  const [first, second] = ranked;
  const deltaS = Number((first[1] - second[1]).toFixed(3));
  const isExactTie = (first[1] === second[1]);

  let categoryKey = "CLEAR_SINGLE";
  if (isExactTie || deltaS <= 2.083) {
    categoryKey = "CO_DOMINANT";
  } else if (deltaS <= 6.250) {
    categoryKey = "ACCENT";
  } else if (deltaS <= 8.333) {
    categoryKey = "STRONG_PRIMARY";
  }

  const isBlend = (categoryKey === "CO_DOMINANT" || categoryKey === "ACCENT");
  const profileKey = isBlend ? `${first[0]}${second[0]}` : first[0];

  const profileData = PROFILE_REGISTRY[profileKey] || PROFILE_REGISTRY[first[0]];
  const OPPOSITE_PAIRS = new Set(["DS", "SD", "IC", "CI"]);
  const pairCode = `${first[0]}${second[0]}`;
  const isTension = OPPOSITE_PAIRS.has(pairCode);

  const costAnalysis = analyzeCostTolerance(userAnswers, questionsData);

  return {
    raw,
    normalized,
    ranked,
    deltaS,
    categoryKey,
    profileKey,
    profileData,
    isTension,
    pairCode,
    costAnalysis,
    timestamp: Date.now()
  };
}

function analyzeCostTolerance(userAnswers, questions) {
  const costScores = { social: 0, professional: 0, internal: 0, efficiency: 0 };

  questions.forEach((q, idx) => {
    const chosenDim = userAnswers[idx]?.most;
    if (chosenDim) {
      const opt = q.options.find(o => o.d === chosenDim);
      if (opt && opt.costType) costScores[opt.costType]++;
    }
  });

  const sorted = Object.entries(costScores).sort(([, a], [, b]) => b - a);
  const [topType, topCount] = sorted[0];
  const [, secondCount] = sorted[1];
  const [lowestType, lowestCount] = sorted[sorted.length - 1];

  const isSignificant = (topCount - secondCount >= 2);

  return {
    distribution: costScores,
    isSignificant,
    highestCostType: topType,
    highestCount: topCount,
    lowestCostType: lowestType,
    lowestCount: lowestCount
  };
}

function formatPauseDuration(minutes) {
  if (currentLang === 'zh') {
    if (minutes < 60) return `約 ${minutes} 分鐘`;
    const hours = Math.floor(minutes / 60);
    return `約 ${hours} 小時 ${minutes % 60} 分鐘`;
  } else {
    if (minutes < 60) return `approx. ${minutes} mins`;
    const hours = Math.floor(minutes / 60);
    return `approx. ${hours}h ${minutes % 60}m`;
  }
}

function renderResultView(res, auditResult, previousResult) {
  document.getElementById("quiz-container").classList.add("hidden");
  const resultBox = document.getElementById("result-container");
  resultBox.classList.remove("hidden");
  const t = translations[currentLang];

  // 1. 信度提示
  const warningContainer = document.getElementById("quality-warning");
  warningContainer.innerHTML = "";
  let hasWarning = false;

  if (auditResult.msgKey) {
    const p1 = document.createElement("div");
    p1.textContent = t[auditResult.msgKey];
    warningContainer.appendChild(p1);
    hasWarning = true;
  }
  if (auditResult.hadLongPause) {
    const p2 = document.createElement("div");
    p2.className = "mt-1 text-xs text-gray-500";
    p2.textContent = t.pauseNotice(formatPauseDuration(auditResult.pauseMinutes));
    warningContainer.appendChild(p2);
    hasWarning = true;
  }

  if (hasWarning) {
    warningContainer.className = auditResult.level === "RED"
      ? "p-4 bg-red-50 border border-red-300 rounded-xl text-red-900 text-sm print:hidden"
      : "p-4 bg-yellow-50 border border-yellow-300 rounded-xl text-yellow-900 text-sm print:hidden";
    warningContainer.classList.remove("hidden");
  } else {
    warningContainer.classList.add("hidden");
  }

  // 2. 深度斟酌題項提示
  const conflictBox = document.getElementById("conflict-notice");
  conflictBox.innerHTML = "";
  if (auditResult.conflictedQuestions && auditResult.conflictedQuestions.length > 0) {
    const strong = document.createElement("strong");
    strong.textContent = t.conflictNoticePrefix;
    const span = document.createElement("span");
    span.textContent = t.conflictNoticeBody(auditResult.conflictedQuestions.join('、'));
    conflictBox.appendChild(strong);
    conflictBox.appendChild(span);
    conflictBox.classList.remove("hidden");
  } else {
    conflictBox.classList.add("hidden");
  }

  // 3. 雙層 rAF 繪製圖表
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      renderRadarChart(res.normalized);
    });
  });

  // 4. 四階梯差異化文案與主管版摘要
  renderProfileContent(res);
  renderExecutiveSummary(res);

  // 5. 代價分析
  renderCostInsights(res.costAnalysis);

  // 6. 對極張力說明
  const tensionBox = document.getElementById("tension-notice");
  tensionBox.textContent = "";
  if (res.isTension) {
    tensionBox.textContent = t.tensionExplanation(res.pairCode);
    tensionBox.classList.remove("hidden");
  } else {
    tensionBox.classList.add("hidden");
  }

  // 7. 歷史比較卡片
  renderHistoryDiff(res.normalized, previousResult);

  window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderExecutiveSummary(res) {
  const container = document.getElementById("executive-summary");
  if (!container) return;
  container.innerHTML = "";
  const t = translations[currentLang];

  const h3 = document.createElement("h3");
  h3.className = "text-base font-extrabold text-gray-900 border-b border-gray-300 pb-2 mb-3";
  h3.textContent = t.execSummaryTitle;

  const grid = document.createElement("div");
  grid.className = "grid grid-cols-1 md:grid-cols-3 gap-3 text-xs leading-relaxed";

  const p = res.profileData;
  const title = currentLang === 'zh' ? p.titleZh : p.titleEn;
  const cat = t.categories[res.categoryKey];
  const dos = currentLang === 'zh' ? p.dosZh : p.dosEn;
  const boundaryLabel = t.costTypes[res.costAnalysis.lowestCostType];

  const card1 = document.createElement("div");
  card1.className = "p-3 bg-gray-100 rounded-lg";
  card1.innerHTML = `<span class="block font-semibold text-gray-700">${t.execCoreStyle}</span><span class="text-gray-900 font-bold">${title}</span><span class="text-gray-500 block mt-0.5">（${cat}）</span>`;

  const card2 = document.createElement("div");
  card2.className = "p-3 bg-gray-100 rounded-lg";
  card2.innerHTML = `<span class="block font-semibold text-green-800">${t.execKeyDo}</span><span class="text-gray-700">${dos[0]}</span>`;

  const card3 = document.createElement("div");
  card3.className = "p-3 bg-gray-100 rounded-lg";
  card3.innerHTML = `<span class="block font-semibold text-red-800">${t.execBoundary}</span><span class="text-gray-700">${boundaryLabel}</span>`;

  grid.appendChild(card1);
  grid.appendChild(card2);
  grid.appendChild(card3);
  container.appendChild(h3);
  container.appendChild(grid);
}

function renderProfileContent(res) {
  const titleElem = document.getElementById("profile-title");
  const descElem = document.getElementById("profile-desc");
  const dosList = document.getElementById("profile-dos");
  const dontsList = document.getElementById("profile-donts");
  const t = translations[currentLang];

  const p = res.profileData;
  const title = currentLang === 'zh' ? p.titleZh : p.titleEn;
  const desc = currentLang === 'zh' ? p.descZh : p.descEn;
  const dos = currentLang === 'zh' ? p.dosZh : p.dosEn;
  const donts = currentLang === 'zh' ? p.dontsZh : p.dontsEn;

  titleElem.textContent = `${title} · ${t.categories[res.categoryKey]}`;

  descElem.innerHTML = "";
  const mainDesc = document.createElement("p");
  mainDesc.className = "leading-relaxed";
  mainDesc.textContent = desc;
  descElem.appendChild(mainDesc);

  if (res.categoryKey === "STRONG_PRIMARY") {
    const secondary = res.ranked[1][0];
    const secDiv = document.createElement("div");
    secDiv.className = "mt-3 pt-3 border-t border-gray-200 text-xs text-gray-600";
    secDiv.innerHTML = t.strongPrimaryAccent(res.ranked[0][0], secondary, t.dims[secondary]);
    descElem.appendChild(secDiv);
  }

  dosList.innerHTML = "";
  dos.forEach(item => {
    const li = document.createElement("li");
    li.textContent = `✓ ${item}`;
    dosList.appendChild(li);
  });

  dontsList.innerHTML = "";
  donts.forEach(item => {
    const li = document.createElement("li");
    li.textContent = `✕ ${item}`;
    dontsList.appendChild(li);
  });
}

function renderCostInsights(cost) {
  const container = document.getElementById("cost-summary");
  container.innerHTML = "";
  const t = translations[currentLang];

  const topLabel = t.costTypes[cost.highestCostType];
  const lowestLabel = t.costTypes[cost.lowestCostType];

  const titleP = document.createElement("p");
  titleP.className = "font-bold text-yellow-900";
  titleP.textContent = cost.isSignificant ? `${t.primaryCostTolerated}: ${topLabel}` : t.costBalanced;

  const subP = document.createElement("p");
  subP.className = "text-xs text-yellow-800 mt-1";
  subP.textContent = cost.isSignificant
    ? t.costToleratedDesc(cost.highestCount)
    : t.costBalancedDesc;

  const boundaryDiv = document.createElement("div");
  boundaryDiv.className = "mt-3 pt-3 border-t border-yellow-200 border-opacity-60 text-xs text-yellow-900";
  const bStrong = document.createElement("strong");
  bStrong.textContent = t.boundaryTitle;
  const bText = document.createTextNode(` ${lowestLabel} (${cost.lowestCount} ${currentLang === 'zh' ? '次' : 'times'})`);
  boundaryDiv.appendChild(bStrong);
  boundaryDiv.appendChild(bText);

  container.appendChild(titleP);
  container.appendChild(subP);
  container.appendChild(boundaryDiv);
}

function renderRadarChart(norm) {
  const ctx = document.getElementById("discChart").getContext("2d");
  if (chartInstance) chartInstance.destroy();
  const t = translations[currentLang];

  chartInstance = new Chart(ctx, {
    type: "radar",
    data: {
      labels: [t.dims.D, t.dims.I, t.dims.S, t.dims.C],
      datasets: [
        {
          label: t.chartLegend,
          data: [norm.D, norm.I, norm.S, norm.C],
          borderColor: "#2563eb",
          backgroundColor: "rgba(37, 99, 235, 0.25)",
          borderWidth: 2.5,
          pointBackgroundColor: "#2563eb",
          pointRadius: 4.5
        },
        {
          label: t.chartBaseline,
          data: [50, 50, 50, 50],
          borderColor: "#94a3b8",
          borderDash: [4, 4],
          borderWidth: 1.5,
          fill: false,
          pointRadius: 0
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        r: {
          min: 0,
          max: 100,
          ticks: { stepSize: 20, display: true, backdropColor: "transparent" }
        }
      }
    }
  });
}

async function setupHistoryNotice() {
  const prev = await SecureStorage.getItem(STORAGE_KEY);
  const noticeElem = document.getElementById("history-notice");
  if (prev && noticeElem) {
    const t = translations[currentLang];
    const dateStr = new Date(prev.timestamp).toLocaleDateString(currentLang === 'zh' ? 'zh-HK' : 'en-US');
    noticeElem.innerHTML = "";
    const span = document.createElement("span");
    span.textContent = t.historyNotice(dateStr);
    noticeElem.appendChild(span);
    noticeElem.classList.remove("hidden");
  }
}

function renderHistoryDiff(currentNorm, prev) {
  const diffBox = document.getElementById("history-diff-box");
  if (!diffBox) return;
  const t = translations[currentLang];

  if (!prev || !prev.normalized) {
    diffBox.classList.add("hidden");
    return;
  }

  const ageInDays = (Date.now() - prev.timestamp) / (1000 * 60 * 60 * 24);
  const lastDate = new Date(prev.timestamp).toLocaleDateString(currentLang === 'zh' ? 'zh-HK' : 'en-US');

  diffBox.innerHTML = "";

  if (ageInDays > 90) {
    const expireNote = document.createElement("div");
    expireNote.className = "p-3 bg-gray-100 rounded-lg text-xs text-gray-500 leading-relaxed";
    expireNote.textContent = t.historyExpired(lastDate, Math.round(ageInDays));
    diffBox.appendChild(expireNote);
    diffBox.classList.remove("hidden");
    return;
  }

  const title = document.createElement("h3");
  title.className = "font-bold text-gray-700 text-xs mb-3";
  title.textContent = t.historyDiffTitle(lastDate);
  diffBox.appendChild(title);

  const grid = document.createElement("div");
  grid.className = "grid grid-cols-4 gap-2 text-center text-xs";

  ["D", "I", "S", "C"].forEach(dim => {
    const diffVal = (currentNorm[dim] - prev.normalized[dim]).toFixed(1);
    const num = Number(diffVal);
    const color = num > 0 ? "text-green-700 bg-green-50 border-green-200" : num < 0 ? "text-red-700 bg-red-50 border-red-200" : "text-gray-600 bg-gray-50 border-gray-200";

    const box = document.createElement("div");
    box.className = "p-2.5 bg-white border border-gray-200 rounded-lg";
    const dimSpan = document.createElement("span");
    dimSpan.className = "block text-gray-500 mb-1";
    dimSpan.textContent = dim;

    const badge = document.createElement("span");
    badge.className = `px-2 py-1 rounded border ${color} font-mono font-bold`;
    badge.textContent = num >= 0 ? `+${diffVal}` : diffVal;

    box.appendChild(dimSpan);
    box.appendChild(badge);
    grid.appendChild(box);
  });

  diffBox.appendChild(grid);
  diffBox.classList.remove("hidden");
}

function handleSoftReset() {
  const t = translations[currentLang];
  if (!confirm(t.retakeConfirm)) {
    return;
  }

  sessionStorage.removeItem("disc_progress_draft");
  Object.keys(userAnswers).forEach(k => delete userAnswers[k]);

  if (timeAuditor) timeAuditor.destroy();
  timeAuditor = new TimeAuditor(questionsData.length);

  document.getElementById("result-container").classList.add("hidden");
  document.getElementById("quiz-container").classList.remove("hidden");

  renderQuestions();
  updateProgressUI();
  setupHistoryNotice();

  window.scrollTo({ top: 0, behavior: "smooth" });
}
