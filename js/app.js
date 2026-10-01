import { questionsData } from './questions.js';
import { PROFILE_REGISTRY } from './profiles.js';

const APP_VERSION = "v3.2.0-verified";
const METHODOLOGY_CODE = "NNPI-2026-Rev9";
const STORAGE_KEY = "disc_eval_secure_v3";
const STORAGE_TTL_DAYS = 30;

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
    let rushReason = "";

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
        rushReason = "末尾題項節奏急促加速";
      }

      let accelStreak = 0;
      for (let i = 1; i < safeIntervals.length; i++) {
        if (safeIntervals[i] < safeIntervals[i - 1] * 0.70) {
          accelStreak++;
          if (accelStreak >= 3) {
            hasRushedPattern = true;
            rushReason = "後半段出現連續遞增急躁作答模式";
            break;
          }
        } else {
          accelStreak = 0;
        }
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
        warningZh: `【低信度警告】有效作答時長僅 ${elapsedSeconds} 秒（平均每題不足 1 秒）。作答速度極快，結果可能未經充分審思，僅供粗略參考。`
      };
    }

    if (avgPerQuestion < 2.0 || hasRushedPattern) {
      const detail = hasRushedPattern ? rushReason : '整體作答均速偏快';
      return {
        level: 'YELLOW',
        isReliable: true,
        elapsedSeconds,
        hadLongPause: this.hadLongPause,
        pauseMinutes: this.pauseDurationMinutes,
        conflictedQuestions,
        warningZh: `【提示】偵測到${detail}（有效耗時 ${elapsedSeconds} 秒）。建議將結果作為即時直覺反思。`
      };
    }

    return {
      level: 'GREEN',
      isReliable: true,
      elapsedSeconds,
      hadLongPause: this.hadLongPause,
      pauseMinutes: this.pauseDurationMinutes,
      conflictedQuestions,
      warningZh: null
    };
  }
}

// --- 狀態管理 ---
let timeAuditor = null;
const userAnswers = {};
let chartInstance = null;
let isPrinting = false;

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
    renderQuestions();
    updateProgressUI();
  }

  document.getElementById("skeleton-loader").classList.add("hidden");
  document.getElementById("questions-list").classList.remove("hidden");

  populateJumpSelector();
  await setupHistoryNotice();
  setVersionStamps();
  bindGlobalEvents();
}

function setVersionStamps() {
  const printStamp = document.getElementById("report-stamp-print");
  const footerStamp = document.getElementById("report-stamp-footer");
  const stampText = `系統版本：${APP_VERSION} ｜ 方法論基準：${METHODOLOGY_CODE} ｜ 產出日期：${new Date().toLocaleDateString()}`;

  if (printStamp) printStamp.textContent = stampText;
  if (footerStamp) footerStamp.textContent = stampText;
}

function bindGlobalEvents() {
  document.getElementById("submit-btn").addEventListener("click", handleSubmit);
  document.getElementById("retake-btn").addEventListener("click", handleSoftReset);
  document.getElementById("print-btn").addEventListener("click", handlePrintWithCanvasFix);
  document.getElementById("jump-select").addEventListener("change", handleJumpToQuestion);

  document.addEventListener("keydown", handleCardKeydown);
}

// 單向點擊驅動事件流
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

  banner.innerHTML = "";
  const container = document.createElement("div");
  container.className = "flex flex-col sm:flex-row sm:items-center justify-between gap-3";

  const textDiv = document.createElement("div");
  const strong = document.createElement("span");
  strong.className = "font-bold";
  strong.textContent = "偵測到上次未完成的進度：";
  const desc = document.createElement("span");
  desc.textContent = `已填寫 ${answeredCount} / ${questionsData.length} 題。請問是否繼續？`;
  textDiv.appendChild(strong);
  textDiv.appendChild(desc);

  const btnDiv = document.createElement("div");
  btnDiv.className = "flex gap-2 flex-shrink-0";

  const btnResume = document.createElement("button");
  btnResume.className = "px-3 py-1 bg-green-600 text-white rounded font-medium text-xs hover:bg-green-700 transition";
  btnResume.textContent = "繼續作答";
  btnResume.onclick = () => {
    applyRestoredDraft(draft);
    banner.classList.add("hidden");
  };

  const btnDiscard = document.createElement("button");
  btnDiscard.className = "px-3 py-1 bg-gray-200 text-gray-700 rounded font-medium text-xs hover:bg-gray-300 transition";
  btnDiscard.textContent = "重新開始";
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

// 嚴格安全 DOM 構造器
function renderQuestions() {
  const container = document.getElementById("questions-list");
  container.innerHTML = "";

  questionsData.forEach((q, idx) => {
    const card = document.createElement("div");
    card.id = `q-card-${idx}`;
    card.setAttribute("data-qidx", idx);
    card.setAttribute("tabindex", "0");
    card.setAttribute("role", "group");
    card.setAttribute("aria-label", `第 ${idx + 1} 題卡片，按 1 至 4 鍵選最符合，按 Q 至 R 鍵選最不符`);

    const isComplete = userAnswers[idx]?.most && userAnswers[idx]?.least;
    card.className = `p-4 rounded-xl border transition duration-150 keyboard-focus ${
      isComplete 
        ? 'border-green-300 bg-green-50 bg-opacity-40 shadow-sm' 
        : 'border-gray-200 bg-gray-50 bg-opacity-50 hover:bg-gray-50'
    }`;

    const headerRow = document.createElement("div");
    headerRow.className = "flex items-center justify-between mb-3 border-b border-gray-200 border-opacity-60 pb-2";

    const titleSpan = document.createElement("span");
    titleSpan.className = "font-semibold text-gray-700 text-sm";
    titleSpan.textContent = `第 ${idx + 1} 題`;

    const legendDiv = document.createElement("div");
    legendDiv.className = "flex gap-6 text-xs font-semibold";

    const mostLabel = document.createElement("span");
    mostLabel.className = "w-14 text-center text-blue-600";
    mostLabel.textContent = "[+] 最符合";

    const leastLabel = document.createElement("span");
    leastLabel.className = "w-14 text-center text-red-500";
    leastLabel.textContent = "[-] 最不符";

    legendDiv.appendChild(mostLabel);
    legendDiv.appendChild(leastLabel);
    headerRow.appendChild(titleSpan);
    headerRow.appendChild(legendDiv);
    card.appendChild(headerRow);

    q.options.forEach((opt, optIdx) => {
      const isMost = userAnswers[idx]?.most === opt.d;
      const isLeast = userAnswers[idx]?.least === opt.d;

      const row = document.createElement("div");
      row.className = "flex items-center justify-between py-2 border-b border-gray-100 last:border-0";

      const textWrap = document.createElement("div");
      textWrap.className = "text-sm text-gray-700 pr-2 flex-1";

      const zhSpan = document.createElement("span");
      zhSpan.textContent = `${optIdx + 1}. ${opt.zh}`;
      const enSpan = document.createElement("span");
      enSpan.className = "block text-xs text-gray-400 mt-0.5";
      enSpan.textContent = opt.en;

      textWrap.appendChild(zhSpan);
      textWrap.appendChild(enSpan);

      const actionWrap = document.createElement("div");
      actionWrap.className = "flex gap-6 flex-shrink-0";

      // Most Radio
      const mostBox = document.createElement("label");
      mostBox.className = "w-14 flex justify-center cursor-pointer p-2";
      const mostInput = document.createElement("input");
      mostInput.type = "radio";
      mostInput.name = `most_${idx}`;
      mostInput.value = opt.d;
      mostInput.checked = isMost;
      mostInput.tabIndex = -1;
      mostInput.className = "accent-blue-600 h-4 w-4";
      mostInput.setAttribute("aria-label", `第 ${idx + 1} 題第 ${optIdx + 1} 項選為最符合`);
      mostInput.onchange = () => handleOptionSelect(idx, "most", opt.d);
      mostBox.appendChild(mostInput);

      // Least Radio
      const leastBox = document.createElement("label");
      leastBox.className = "w-14 flex justify-center cursor-pointer p-2";
      const leastInput = document.createElement("input");
      leastInput.type = "radio";
      leastInput.name = `least_${idx}`;
      leastInput.value = opt.d;
      leastInput.checked = isLeast;
      leastInput.tabIndex = -1;
      leastInput.className = "accent-red-500 h-4 w-4";
      leastInput.setAttribute("aria-label", `第 ${idx + 1} 題第 ${optIdx + 1} 項選為最不符`);
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
    card.className = "p-4 rounded-xl border border-green-300 bg-green-50 bg-opacity-40 shadow-sm transition duration-150 keyboard-focus";
  } else {
    card.className = "p-4 rounded-xl border border-gray-200 bg-gray-50 bg-opacity-50 hover:bg-gray-50 transition duration-150 keyboard-focus";
  }
}

function updateProgressUI() {
  const total = questionsData.length;
  let done = 0;
  for (let i = 0; i < total; i++) {
    if (userAnswers[i]?.most && userAnswers[i]?.least) done++;
  }

  const pct = Math.round((done / total) * 100);
  document.getElementById("progress-text").textContent = `${done} / ${total} 題 (${pct}%)`;
  document.getElementById("progress-bar").style.width = `${pct}%`;
  document.getElementById("submit-btn").disabled = (done !== total);
}

function populateJumpSelector() {
  const selector = document.getElementById("jump-select");
  selector.innerHTML = "";
  const defOpt = document.createElement("option");
  defOpt.value = "";
  defOpt.textContent = "跳至題號...";
  selector.appendChild(defOpt);

  questionsData.forEach((_, idx) => {
    const opt = document.createElement("option");
    opt.value = idx;
    opt.textContent = `第 ${idx + 1} 題`;
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
  submitBtn.textContent = "正在計算標準化向量與風格模型...";

  setTimeout(async () => {
    const auditResult = timeAuditor.audit();
    const currentEvaluation = runComprehensiveEvaluation();

    const previousResult = await SecureStorage.getItem(STORAGE_KEY);
    await SecureStorage.setItem(STORAGE_KEY, currentEvaluation);
    sessionStorage.removeItem("disc_progress_draft");

    renderResultView(currentEvaluation, auditResult, previousResult);
    submitBtn.textContent = "計算分析結果";
  }, 350);
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

  const fallbackProfile = {
    titleZh: "多維平衡風格",
    titleEn: "Balanced Style",
    descZh: "您的各項風格特質在測量中表現較為均衡，能在不同情境中自如切換。",
    dos: ["溝通時保持客觀與靈活性", "依專案階段調整協作模式"],
    donts: ["避免強行將行為模式臉譜化", "不要忽視不同情境的特殊要求"]
  };
  const profileData = PROFILE_REGISTRY[profileKey] || PROFILE_REGISTRY[first[0]] || fallbackProfile;

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

  const costLabels = {
    social: "外向人際摩擦（被指責強硬）",
    professional: "形象約束放鬆（被指責話多不沉穩）",
    internal: "個人訴求妥協（自我妥協壓抑）",
    efficiency: "進度阻礙責難（因吹毛求疵拖慢進度）"
  };

  return {
    distribution: costScores,
    isSignificant,
    highestCostType: topType,
    highestCount: topCount,
    highestLabel: costLabels[topType],
    lowestCostType: lowestType,
    lowestCount: lowestCount,
    lowestLabel: costLabels[lowestType]
  };
}

function formatPauseDuration(minutes) {
  if (minutes < 60) return `約 ${minutes} 分鐘`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `約 ${hours} 小時 ${remainingMinutes} 分鐘（跨夜或長時間離開）`;
}

function renderResultView(res, auditResult, previousResult) {
  document.getElementById("quiz-container").classList.add("hidden");
  const resultBox = document.getElementById("result-container");
  resultBox.classList.remove("hidden");

  // 1. 信度提示
  const warningContainer = document.getElementById("quality-warning");
  warningContainer.innerHTML = "";
  let hasWarning = false;

  if (auditResult.warningZh) {
    const p1 = document.createElement("div");
    p1.textContent = auditResult.warningZh;
    warningContainer.appendChild(p1);
    hasWarning = true;
  }
  if (auditResult.hadLongPause) {
    const p2 = document.createElement("div");
    p2.className = "mt-1 text-xs text-gray-500";
    p2.textContent = `※ 系統已自動扣除您切離分頁/休眠的時段（${formatPauseDuration(auditResult.pauseMinutes)}），該時間不計入節奏指標。`;
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
    strong.textContent = "深度反覆斟酌觀察：";
    const span = document.createElement("span");
    span.textContent = `您在第 ${auditResult.conflictedQuestions.join("、")} 題上進行了多次更改，顯示該題的特質代價在您的工作環境中存在較顯著的抉擇拉扯。`;
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
    tensionBox.textContent = `【對極動態張力組合】您排名前二的特質（${res.pairCode}）在經典 DISC 圓環中處於對立軸線。這代表您在不同工作情境中展現出矛盾而深刻的切換能力，此種雙高常伴隨較高的內在決策代價。`;
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

  const categoryNames = {
    CO_DOMINANT: "共顯平衡型",
    ACCENT: "主導兼具副色",
    STRONG_PRIMARY: "強主導型",
    CLEAR_SINGLE: "極致單一型"
  };

  const h3 = document.createElement("h3");
  h3.className = "text-base font-bold text-gray-900 border-b border-gray-300 pb-2 mb-3";
  h3.textContent = "主管協作與溝通摘要 (Executive Summary)";

  const grid = document.createElement("div");
  grid.className = "grid grid-cols-1 md:grid-cols-3 gap-3 text-xs leading-relaxed";

  const card1 = document.createElement("div");
  card1.className = "p-3 bg-gray-100 rounded-lg";
  const c1Label = document.createElement("span");
  c1Label.className = "block font-semibold text-gray-700";
  c1Label.textContent = "核心風格判定：";
  const c1Val = document.createElement("span");
  c1Val.className = "text-gray-900 font-bold";
  c1Val.textContent = res.profileData.titleZh;
  const c1Sub = document.createElement("span");
  c1Sub.className = "text-gray-500 block mt-0.5";
  c1Sub.textContent = `（${categoryNames[res.categoryKey]}）`;
  card1.appendChild(c1Label);
  card1.appendChild(c1Val);
  card1.appendChild(c1Sub);

  const card2 = document.createElement("div");
  card2.className = "p-3 bg-gray-100 rounded-lg";
  const c2Label = document.createElement("span");
  c2Label.className = "block font-semibold text-green-800";
  c2Label.textContent = "關鍵溝通要訣 (Do)：";
  const c2Val = document.createElement("span");
  c2Val.className = "text-gray-700";
  c2Val.textContent = res.profileData.dos[0] || "保持直率客觀";
  card2.appendChild(c2Label);
  card2.appendChild(c2Val);

  const card3 = document.createElement("div");
  card3.className = "p-3 bg-gray-100 rounded-lg";
  const c3Label = document.createElement("span");
  c3Label.className = "block font-semibold text-red-800";
  c3Label.textContent = "行為防禦底線 (Don't)：";
  const c3Val = document.createElement("span");
  c3Val.className = "text-gray-700";
  c3Val.textContent = `最抗拒承擔「${res.costAnalysis.lowestLabel}」`;
  card3.appendChild(c3Label);
  card3.appendChild(c3Val);

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

  const categoryNames = {
    CO_DOMINANT: "共顯平衡型",
    ACCENT: "主導兼具副色",
    STRONG_PRIMARY: "強主導型",
    CLEAR_SINGLE: "極致單一型"
  };

  titleElem.textContent = `${res.profileData.titleZh} · ${categoryNames[res.categoryKey]}`;

  descElem.innerHTML = "";
  const mainDesc = document.createElement("p");
  mainDesc.className = "leading-relaxed";
  mainDesc.textContent = res.profileData.descZh;
  descElem.appendChild(mainDesc);

  if (res.categoryKey === "STRONG_PRIMARY") {
    const secondary = res.ranked[1][0];
    const secondaryMap = {
      D: "D（掌控與推進）",
      I: "I（激勵與社交）",
      S: "S（耐性與和諧）",
      C: "C（嚴謹與規範）"
    };

    const secDiv = document.createElement("div");
    secDiv.className = "mt-3 pt-3 border-t border-gray-200 text-xs text-gray-600";
    const secStrong = document.createElement("strong");
    secStrong.textContent = `次要色彩觀察（附帶 ${secondary} 特質）：`;
    const secText = document.createTextNode(
      ` 雖然您的 ${res.ranked[0][0]} 主導特質極為突出，但同時保留了顯著的 ${secondaryMap[secondary]} 色彩。在極限高壓或複雜跨部門協作時，此項特質會成為您的第二防線。`
    );
    secDiv.appendChild(secStrong);
    secDiv.appendChild(secText);
    descElem.appendChild(secDiv);
  }

  dosList.innerHTML = "";
  res.profileData.dos.forEach(item => {
    const li = document.createElement("li");
    li.textContent = `✓ ${item}`;
    dosList.appendChild(li);
  });

  dontsList.innerHTML = "";
  res.profileData.donts.forEach(item => {
    const li = document.createElement("li");
    li.textContent = `✕ ${item}`;
    dontsList.appendChild(li);
  });
}

function renderCostInsights(cost) {
  const container = document.getElementById("cost-summary");
  container.innerHTML = "";

  const titleP = document.createElement("p");
  titleP.className = "font-medium text-gray-800";
  titleP.textContent = cost.isSignificant ? `主要願受代價：${cost.highestLabel}` : "代價承受傾向均衡";

  const subP = document.createElement("p");
  subP.className = "text-xs text-gray-600 mt-1";
  subP.textContent = cost.isSignificant
    ? `您最願意承受此項代價以達成工作成果（選擇了 ${cost.highestCount} 次）。`
    : "前兩項代價差距小於 2 票，表明您在不同挑戰下能彈性切換承受維度。";

  const boundaryDiv = document.createElement("div");
  boundaryDiv.className = "mt-3 pt-3 border-t border-yellow-200 border-opacity-60 text-xs text-yellow-900";
  const bStrong = document.createElement("strong");
  bStrong.textContent = "行為防禦底線（最抗拒承擔）：";
  const bText = document.createTextNode(` 相較之下，您最不願妥協或承受的是「${cost.lowestLabel}」（僅出現 ${cost.lowestCount} 次）。此處通常反映了您在職場中最不可逾越的價值邊界。`);
  boundaryDiv.appendChild(bStrong);
  boundaryDiv.appendChild(bText);

  container.appendChild(titleP);
  container.appendChild(subP);
  container.appendChild(boundaryDiv);
}

function renderRadarChart(norm) {
  const ctx = document.getElementById("discChart").getContext("2d");
  if (chartInstance) chartInstance.destroy();

  chartInstance = new Chart(ctx, {
    type: "radar",
    data: {
      labels: ["D 支配型", "I 影響型", "S 穩健型", "C 謹慎型"],
      datasets: [
        {
          label: "標準化淨偏好指標 (NNPI, 0–100)",
          data: [norm.D, norm.I, norm.S, norm.C],
          borderColor: "#2563eb",
          backgroundColor: "rgba(37, 99, 235, 0.25)",
          borderWidth: 2.5,
          pointBackgroundColor: "#2563eb",
          pointRadius: 4.5
        },
        {
          label: "相對平均基準線 (Baseline = 50)",
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
    const dateStr = new Date(prev.timestamp).toLocaleDateString();
    noticeElem.innerHTML = "";
    const span = document.createElement("span");
    span.textContent = `系統偵測到您曾於 ${dateStr} 完成過自評。本次測試提交後將提供雙向軌跡對比。`;
    noticeElem.appendChild(span);
    noticeElem.classList.remove("hidden");
  }
}

function renderHistoryDiff(currentNorm, prev) {
  const diffBox = document.getElementById("history-diff-box");
  if (!diffBox) return;

  if (!prev || !prev.normalized) {
    diffBox.classList.add("hidden");
    return;
  }

  const ageInDays = (Date.now() - prev.timestamp) / (1000 * 60 * 60 * 24);
  const lastDate = new Date(prev.timestamp).toLocaleDateString();

  diffBox.innerHTML = "";

  if (ageInDays > 90) {
    const expireNote = document.createElement("div");
    expireNote.className = "p-3 bg-gray-100 rounded-lg text-xs text-gray-500 leading-relaxed";
    expireNote.textContent = `歷史對比提示：您上次測評於 ${lastDate}（距今已逾 ${Math.round(ageInDays)} 天）。因跨度較長，風格變化可能更多源自環境與歷練變遷，故本系統不進行逐點分值相減。`;
    diffBox.appendChild(expireNote);
    diffBox.classList.remove("hidden");
    return;
  }

  const title = document.createElement("h3");
  title.className = "font-semibold text-gray-700 text-xs mb-3";
  title.textContent = `與上次測評（${lastDate}）之分值變化對比：`;
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
    dimSpan.textContent = `${dim} 維度`;

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
  if (!confirm("確定要重新進行評測嗎？本次計算的詳細分析畫面將被清空（您在本地的加密歷史記錄仍會保留）。")) {
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
