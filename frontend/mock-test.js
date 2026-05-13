const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => root.querySelectorAll(selector);
const { API_BASE_URL, getStudentId } = window.EduMateShared || {};

const MAX_ATTEMPTS_UNLIMITED = 999;
const OPTION_LABELS = ["A", "B", "C", "D"];
const MODAL_VIEWS = ["confirmView", "examView", "submitConfirmView", "resultView"];
const BADGE_MAP = {
  available: ["badge-green", "Available"],
  scheduled: ["badge-amber", "Scheduled"],
  completed: ["badge-blue", "Completed"],
};

let testsData = [];
const localTestsData = [];

let currentTest = null;
let questions = [];
let answers = [];
let currentQ = 0;
let timerInterval = null;
let secondsLeft = 0;
let activeFilter = "all";
let activeSearch = "";
let isExamSessionActive = false;
let disqualified = false;
let tabProctoringArmed = false;
let armTabProctoringTimeout = null;
let mockRefreshInterval = null;

const stopTimer = () => {
  clearInterval(timerInterval);
  timerInterval = null;
};

const clearTabProctoringTimer = () => {
  clearTimeout(armTabProctoringTimeout);
  armTabProctoringTimeout = null;
};

async function enterExamFullscreen() {
  const target = document.documentElement;
  if (!target.requestFullscreen) return false;
  try {
    await target.requestFullscreen();
    return true;
  } catch {
    return false;
  }
}

async function exitExamFullscreen() {
  if (!document.fullscreenElement || !document.exitFullscreen) return;
  try {
    await document.exitFullscreen();
  } catch {
    // Ignore fullscreen exit failure to keep flow stable.
  }
}

const teardownProctoring = () => {
  tabProctoringArmed = false;
  clearTabProctoringTimer();
  document.removeEventListener("visibilitychange", handleVisibilityViolation);
};

function getExamIdFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const raw = params.get("examId");
  const examId = Number(raw);
  return Number.isInteger(examId) && examId > 0 ? examId : null;
}

function showDisqualifiedResult(reason) {
  disqualified = true;
  isExamSessionActive = false;
  stopTimer();
  teardownProctoring();

  $("#resultTestName").textContent = `${currentTest?.title || "Mock Test"} - Disqualified`;
  $("#resultPct").textContent = "0%";
  $("#r-correct").textContent = "0";
  $("#r-wrong").textContent = String(questions.length || 0);
  $("#r-skipped").textContent = "0";
  $("#r-marks").textContent = "Disqualified";
  $("#resultFeedback").textContent = `You were disqualified: ${reason}`;
  $("#reviewList").innerHTML = '<div class="review-item"><p class="review-question">Result locked due to proctoring violation.</p></div>';
  showView("resultView");
}

function handleVisibilityViolation() {
  if (!isExamSessionActive || disqualified || !tabProctoringArmed) return;
  if (document.hidden) {
    showDisqualifiedResult("you switched tab/window during the exam.");
  }
}

const isUnlimited = (maxAttempts) => maxAttempts >= MAX_ATTEMPTS_UNLIMITED;

async function fetchApprovedQuestions(subjects, count, examId = null) {
  if (!API_BASE_URL || typeof getStudentId !== "function") return null;
  const studentId = getStudentId();
  if (!studentId) return null;

  try {
    const params = new URLSearchParams();
    normalizeSubjects(subjects).forEach((subject) => params.append("subjects", subject));
    params.set("count", String(count));
    if (examId) params.set("examId", String(examId));

    const response = await fetch(
      `${API_BASE_URL}/student/${studentId}/mock-questions?${params.toString()}`
    );
    const payload = await response.json();
    if (!response.ok || !payload?.success) return null;

    return (payload.data?.questions || [])
      .map((question) => ({
        text: String(question.text || ""),
        opts: Array.isArray(question.opts) ? question.opts : [],
        ans: Number(question.ans),
        subject: String(question.subject || "General"),
      }))
      .filter(
        (question) =>
          question.text &&
          question.opts.length >= 2 &&
          Number.isInteger(question.ans) &&
          question.ans >= 0 &&
          question.ans < question.opts.length
      );
  } catch {
    return null;
  }
}

function normalizeSubjects(subjectInput) {
  const source = Array.isArray(subjectInput) ? subjectInput : [subjectInput];
  const normalized = source
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .map((item) => {
      const key = item.toLowerCase();
      if (key.includes("physics")) return "Physics";
      if (key.includes("chem")) return "Chemistry";
      if (key.includes("math")) return "Math";
      if (key.includes("bio")) return "Biology";
      return item.charAt(0).toUpperCase() + item.slice(1);
    });

  return normalized.length ? normalized : ["Physics"];
}

function mapExamStatusToTestStatus(exam) {
  const status = String(exam?.status || "").toLowerCase();
  if (status === "completed" || status === "missed") return "completed";
  if (status === "upcoming" && !exam?.joinAvailable) return "scheduled";
  return "available";
}

function getExamWindow(test) {
  const start = test?.startTime ? new Date(test.startTime) : null;
  let end = test?.endTime ? new Date(test.endTime) : null;
  if (start && (!end || end <= start)) {
    const duration = Number(test?.duration || 0);
    if (duration > 0) {
      end = new Date(start.getTime() + duration * 60000);
    }
  }
  if (!start || Number.isNaN(start.getTime()) || !end || Number.isNaN(end.getTime())) {
    return { start: null, end: null };
  }
  return { start, end };
}

function isTestJoinAvailable(test, now = new Date()) {
  const { start, end } = getExamWindow(test);
  if (!start || !end) return false;
  const joinWindowMinutes = Number(test?.joinWindowMinutes || 15);
  const joinStart = new Date(start.getTime() - joinWindowMinutes * 60000);
  return now >= joinStart && now <= end;
}

function deriveLiveTestStatus(test, now = new Date()) {
  const backendStatus = String(test?.backendStatus || test?.status || "").toLowerCase();
  if (backendStatus === "completed" || backendStatus === "missed") return "completed";

  const { start, end } = getExamWindow(test);
  if (!start || !end) return backendStatus === "available" ? "available" : "scheduled";
  if (now > end) return "completed";
  if (isTestJoinAvailable(test, now)) return "available";
  return "scheduled";
}

function formatScheduleLabel(test) {
  const { start } = getExamWindow(test);
  if (!start) return test.schedDate || "Scheduled";
  return start.toLocaleString([], {
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatExamWindow(test) {
  const { start, end } = getExamWindow(test);
  if (!start || !end) return "End time will be set after schedule sync.";
  const startLabel = start.toLocaleString([], {
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  const endLabel = end.toLocaleString([], {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${startLabel} - ${endLabel}`;
}

function buildTestsFromExamRoutine(exams = []) {
  const mapped = exams
    .map((exam) => {
      const subjects = normalizeSubjects(exam.subject);
      const duration = Number(exam.durationMinutes || 30);
      const backendQuestionCount = Number(exam.questionCount || 0);
      const questionCount = Math.max(0, backendQuestionCount);
      const status = mapExamStatusToTestStatus(exam);
      const examTitle = String(exam.title || exam.subject || "Exam").trim();
      const cardTitle = /mock|test/i.test(examTitle) ? examTitle : `${examTitle} Mock`;
      return {
        id: Number(exam.id),
        title: cardTitle,
        status,
        featured: status === "available",
        duration,
        questions: questionCount,
        subjects,
        attempts: Math.max(0, Number(exam.attemptCount || 0)),
        maxAttempts: 3,
        description: exam.instructions || "Scheduled from exam routine.",
        tags: [String(exam.batchName || "General"), String(exam.status || "").toUpperCase()].filter(Boolean),
        free: true,
        schedDate: exam.startTime ? new Date(exam.startTime).toLocaleDateString() : "Scheduled",
        sourceExamId: Number(exam.id),
        startTime: exam.startTime || null,
        endTime: exam.endTime || null,
        joinWindowMinutes: Number(exam.joinWindowMinutes || 15),
        backendStatus: String(exam.status || "").toLowerCase(),
        joinAvailableFromApi: Boolean(exam.joinAvailable),
      };
    });

  if (mapped.length) return mapped;
  return [];
}

function updateMockStatsFromPerformance(items = []) {
  const cards = $$(".stat-row .stat-card");
  if (cards.length < 4) return;

  const mockItems = items.filter((item) => String(item.test_type || "").toLowerCase() === "mock");
  const completed = mockItems.length;
  const avg = completed
    ? Math.round(mockItems.reduce((sum, item) => sum + Number(item.score || 0), 0) / completed)
    : 0;
  const bestItem = mockItems.reduce(
    (best, item) => (Number(item.score || 0) > Number(best?.score || -1) ? item : best),
    null
  );

  const available = testsData.filter((test) => deriveLiveTestStatus(test) === "available").length;
  cards[0].querySelector(".s-val").textContent = String(available);
  cards[0].querySelector(".s-sub").textContent = "Synced from backend";
  cards[1].querySelector(".s-val").textContent = String(completed);
  cards[1].querySelector(".s-sub").textContent = completed ? "From performance records" : "No completed mocks yet";
  cards[2].querySelector(".s-val").textContent = `${avg}%`;
  cards[2].querySelector(".s-sub").textContent = "Average mock score";
  cards[3].querySelector(".s-val").textContent = `${Number(bestItem?.score || 0)}%`;
  cards[3].querySelector(".s-sub").textContent = bestItem?.test_name || "No test record yet";
}

function getAttemptProgress(test) {
  if (isUnlimited(test.maxAttempts)) return test.attempts > 0 ? 50 : 0;
  return (test.attempts / test.maxAttempts) * 100;
}

function renderTests(filter = "all", search = "") {
  const grid = $("#testsGrid");
  if (!grid) return;

  const searchText = search.trim().toLowerCase();
  let list = testsData.map((test) => {
    const liveStatus = deriveLiveTestStatus(test);
    return { ...test, status: liveStatus, featured: liveStatus === "available" };
  });
  if (filter !== "all") list = list.filter((test) => test.status === filter);
  if (searchText) {
    list = list.filter(
      (test) =>
        test.title.toLowerCase().includes(searchText) ||
        test.tags.some((tag) => tag.toLowerCase().includes(searchText))
    );
  }

  grid.innerHTML = "";
  if (!list.length) {
    grid.innerHTML = '<p class="no-tests-message">No tests found.</p>';
    return;
  }

  list.forEach((test) => {
    const pct = getAttemptProgress(test);
    const pctClass = pct >= 80 ? "red" : pct >= 50 ? "amber" : "";
    const [badgeClass, badgeLabel] = BADGE_MAP[test.status] || ["badge-gray", "Unknown"];
    const numericScore = Number(test.score);
    const scoreLabel = Number.isFinite(numericScore) ? `${Math.round(numericScore)}%` : "N/A";

    const card = document.createElement("div");
    card.className = `test-card${test.featured ? " featured" : ""}`;
    card.innerHTML = `
      <div class="tc-top">
        <div class="tc-badges">
          <span class="tc-badge ${badgeClass}">${badgeLabel}</span>
          ${test.free ? '<span class="tc-badge badge-green badge-free">Free</span>' : ""}
        </div>
        <span class="tc-duration">
          <svg fill="none" viewBox="0 0 24 24" stroke-width="2"><circle cx="12" cy="12" r="10"/><path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6l4 2"/></svg>
          ${test.duration} min
        </span>
      </div>
      <div>
        <p class="tc-title">${test.title}</p>
        <p class="tc-desc tc-desc-spaced">${test.description}</p>
        <p class="tc-window">Exam window: ${formatExamWindow(test)}</p>
      </div>
      <div class="tc-tags">
        ${test.subjects.map((subject) => `<span class="tag">${subject}</span>`).join("")}
        ${test.tags.map((tag) => `<span class="tag">${tag}</span>`).join("")}
      </div>
      <div class="tc-meta">
        <span>
          <svg fill="none" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
          ${test.questions} questions
        </span>
        <span>
          <svg fill="none" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
          ${isUnlimited(test.maxAttempts) ? "Unlimited" : `${test.attempts}/${test.maxAttempts} attempts`}
        </span>
      </div>
      <div class="tc-footer">
        ${
          isUnlimited(test.maxAttempts)
            ? '<div class="attempts-bar"><p class="attempts-note">Unlimited attempts</p></div>'
            : `
              <div class="attempts-bar">
                <div class="attempts-label"><span>Attempts</span><span>${test.attempts}/${test.maxAttempts}</span></div>
                <div class="progress"><div class="progress-fill ${pctClass}" data-width="${pct}"></div></div>
              </div>
            `
        }
        ${
          test.status === "available"
            ? `<button class="btn btn-primary btn-sm" onclick="event.stopPropagation();openTestConfirm(${test.id})">Start -&gt;</button>`
            : test.status === "scheduled"
              ? `<button class="btn btn-sm btn-scheduled">Starts ${formatScheduleLabel(test)}</button>`
              : `<div class="score-box"><p class="score-label">Score</p><p class="score-value">${scoreLabel}</p></div>`
        }
      </div>
    `;

    $$("[data-width]", card).forEach((fill) => {
      fill.style.width = `${fill.getAttribute("data-width")}%`;
    });

    grid.appendChild(card);
  });
}

function filterTests(filter, btn) {
  activeFilter = filter;
  $$(".filter-btn").forEach((button) => button.classList.remove("active"));
  btn.classList.add("active");
  renderTests(activeFilter, activeSearch);
}

function searchTests(value) {
  activeSearch = value;
  renderTests(activeFilter, activeSearch);
}

function showView(viewId) {
  MODAL_VIEWS.forEach((id) => {
    const view = document.getElementById(id);
    if (!view) return;
    view.style.display = "none";
  });

  const selectedView = document.getElementById(viewId);
  if (!selectedView) return;

  selectedView.style.display = viewId === "examView" ? "flex" : "block";
  selectedView.style.flexDirection = viewId === "examView" ? "column" : "";
  selectedView.style.height = viewId === "examView" ? "100%" : "";
}

function openTestConfirm(id) {
  currentTest = testsData.find((test) => test.id === id);
  if (!currentTest) return;
  if (!isUnlimited(currentTest.maxAttempts) && Number(currentTest.attempts || 0) >= Number(currentTest.maxAttempts || 0)) {
    window.alert("You have already used all attempts for this mock test.");
    return;
  }

  $("#confirmTitle").textContent = currentTest.title;
  $("#confirmSubtitle").textContent = `${currentTest.questions} questions · ${currentTest.duration} minutes`;
  $("#ci-duration").textContent = `${currentTest.duration} min`;
  $("#ci-questions").textContent = currentTest.questions;
  $("#ci-subjects").textContent = currentTest.subjects.length;
  showView("confirmView");
  $("#examModal").classList.add("open");
}

function closeModal() {
  isExamSessionActive = false;
  stopTimer();
  teardownProctoring();
  exitExamFullscreen().catch(() => null);
  $("#examModal").classList.remove("open");
  showView("confirmView");
}

async function startExam() {
  if (!currentTest) return;
  if (!isUnlimited(currentTest.maxAttempts) && Number(currentTest.attempts || 0) >= Number(currentTest.maxAttempts || 0)) {
    window.alert("You have already used all attempts for this mock test.");
    closeModal();
    return;
  }

  const fullscreenReady = await enterExamFullscreen();
  if (!fullscreenReady) {
    window.alert("Please allow fullscreen mode to start this mock test.");
    return;
  }

  disqualified = false;
  tabProctoringArmed = false;

  const backendQuestions = await fetchApprovedQuestions(
    currentTest.subjects,
    currentTest.questions,
    currentTest.sourceExamId || currentTest.id || null
  );
  questions = Array.isArray(backendQuestions) ? backendQuestions : [];
  if (!questions.length) {
    window.alert("No approved questions found for this subject yet. Please contact your instructor.");
    exitExamFullscreen().catch(() => null);
    return;
  }
  answers = new Array(questions.length).fill(null);
  currentQ = 0;
  secondsLeft = currentTest.duration * 60;

  $("#examTitle").textContent = currentTest.title;
  showView("examView");
  buildPalette();
  renderQuestion();
  startTimer();

  isExamSessionActive = true;
  document.addEventListener("visibilitychange", handleVisibilityViolation);
  clearTabProctoringTimer();
  armTabProctoringTimeout = setTimeout(() => {
    tabProctoringArmed = true;
  }, 1500);
}

function updateTimerDisplay() {
  const minutes = Math.floor(secondsLeft / 60);
  const seconds = secondsLeft % 60;
  $("#timerDisplay").textContent = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;

  const timerBadge = $("#timerBadge");
  if (!timerBadge) return;
  timerBadge.className = `timer-badge${secondsLeft < 60 ? " danger" : secondsLeft < 300 ? " warning" : ""}`;
}

function startTimer() {
  stopTimer();
  updateTimerDisplay();
  timerInterval = setInterval(() => {
    secondsLeft -= 1;
    updateTimerDisplay();
    if (secondsLeft <= 0) {
      stopTimer();
      submitExam();
    }
  }, 1000);
}

function renderQuestion() {
  const question = questions[currentQ];
  if (!question) return;

  $("#questionCounter").textContent = `Question ${currentQ + 1} of ${questions.length}`;
  $("#qNum").textContent = `${question.subject} - Q${currentQ + 1}`;
  $("#qSubject").textContent = question.subject;
  $("#questionText").textContent = question.text;
  $("#examProgress").style.width = `${((currentQ + 1) / questions.length) * 100}%`;

  const optionsContainer = $("#optionsContainer");
  optionsContainer.innerHTML = "";
  question.opts.forEach((option, index) => {
    const optionNode = document.createElement("div");
    optionNode.className = `option${answers[currentQ] === index ? " selected" : ""}`;
    optionNode.innerHTML = `<span class="opt-label">${OPTION_LABELS[index]}</span><span>${option}</span>`;
    optionNode.onclick = () => selectOption(index);
    optionsContainer.appendChild(optionNode);
  });

  const isLast = currentQ === questions.length - 1;
  $("#nextBtn").style.display = isLast ? "none" : "inline-flex";
  $("#submitBtn").style.display = isLast ? "inline-flex" : "none";

  updatePalette();
}

function selectOption(index) {
  answers[currentQ] = index;
  renderQuestion();
}

function nextQuestion() {
  if (answers[currentQ] === null) answers[currentQ] = -1;
  if (currentQ < questions.length - 1) {
    currentQ += 1;
    renderQuestion();
  }
}

function prevQuestion() {
  if (currentQ > 0) {
    currentQ -= 1;
    renderQuestion();
  }
}

function skipQuestion() {
  answers[currentQ] = -1;
  if (currentQ < questions.length - 1) {
    currentQ += 1;
    renderQuestion();
  }
}

function buildPalette() {
  const grid = $("#paletteGrid");
  if (!grid) return;
  grid.innerHTML = "";

  questions.forEach((_, index) => {
    const paletteItem = document.createElement("div");
    paletteItem.className = "palette-item";
    paletteItem.id = `pal_${index}`;
    paletteItem.textContent = index + 1;
    paletteItem.onclick = () => {
      currentQ = index;
      renderQuestion();
    };
    grid.appendChild(paletteItem);
  });
}

function updatePalette() {
  questions.forEach((_, index) => {
    const item = $(`#pal_${index}`);
    if (!item) return;
    item.className = "palette-item";
    if (index === currentQ) item.classList.add("current");
    else if (answers[index] !== null && answers[index] >= 0) item.classList.add("answered");
    else if (answers[index] === -1) item.classList.add("skipped");
  });
}

function showSubmitConfirm() {
  const answered = answers.filter((answer) => answer !== null && answer >= 0).length;
  const skipped = answers.filter((answer) => answer === -1).length;
  const unvisited = answers.filter((answer) => answer === null).length;

  $("#sc-answered").textContent = answered;
  $("#sc-skipped").textContent = skipped;
  $("#sc-unattempted").textContent = unvisited;
  showView("submitConfirmView");
}

function hideSubmitConfirm() {
  showView("examView");
}

function submitExam() {
  isExamSessionActive = false;
  stopTimer();
  teardownProctoring();
  exitExamFullscreen().catch(() => null);

  let correct = 0;
  let wrong = 0;
  let skipped = 0;
  questions.forEach((question, index) => {
    const answer = answers[index];
    if (answer === null || answer === -1) skipped += 1;
    else if (answer === question.ans) correct += 1;
    else wrong += 1;
  });

  const marks = correct * 4 - wrong;
  const total = questions.length * 4;
  const pct = Math.round((correct / questions.length) * 100);
  const feedback =
    pct >= 80
      ? "Excellent! Keep it up."
      : pct >= 60
        ? "Good job. Review weak areas."
        : "Keep practicing. You can do better!";

  $("#resultTestName").textContent = currentTest.title;
  $("#resultPct").textContent = `${pct}%`;
  $("#r-correct").textContent = correct;
  $("#r-wrong").textContent = wrong;
  $("#r-skipped").textContent = skipped;
  $("#r-marks").textContent = `${marks}/${total}`;
  $("#resultFeedback").textContent = feedback;

  const reviewList = $("#reviewList");
  reviewList.innerHTML = "";
  questions.forEach((question, index) => {
    const userAnswer = answers[index];
    const isCorrect = userAnswer === question.ans;
    const isSkipped = userAnswer === null || userAnswer === -1;
    const stateClass = isSkipped
      ? "review-state-skipped"
      : isCorrect
        ? "review-state-correct"
        : "review-state-wrong";

    const reviewItem = document.createElement("div");
    reviewItem.className = "review-item";
    reviewItem.innerHTML = `
      <div class="review-item-top">
        <p class="review-question">Q${index + 1}. ${question.text}</p>
        <span class="review-state ${stateClass}">${isSkipped ? "Skipped" : isCorrect ? "Correct" : "Wrong"}</span>
      </div>
      <p class="review-line">
        Correct: <strong class="review-correct">${OPTION_LABELS[question.ans]}. ${question.opts[question.ans]}</strong>
        ${
          !isSkipped && !isCorrect
            ? ` &nbsp;·&nbsp; Your answer: <strong class="review-wrong">${OPTION_LABELS[userAnswer]}. ${question.opts[userAnswer]}</strong>`
            : ""
        }
      </p>
    `;
    reviewList.appendChild(reviewItem);
  });

  showView("resultView");
  savePerformanceRecord({ correct, scorePercent: pct }).catch(() => null);
}

async function savePerformanceRecord({ correct, scorePercent }) {
  if (!API_BASE_URL || typeof getStudentId !== "function" || !currentTest || !questions.length) return;
  const studentId = getStudentId();
  if (!studentId) return;

  const primarySubject = normalizeSubjects(currentTest.subjects)[0] || "General";
  try {
    const examId = Number(currentTest?.sourceExamId || currentTest?.id || 0);
    const response = await fetch(`${API_BASE_URL}/student/${studentId}/performance`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        examId: Number.isInteger(examId) && examId > 0 ? examId : null,
        subject: primarySubject,
        testType: "mock",
        score: scorePercent,
        totalQuestions: questions.length,
        correctAnswers: correct,
        testName: currentTest.title,
        rank: null,
        totalParticipants: null,
      }),
    });

    if (!response.ok) return;

    if (Number.isInteger(examId) && examId > 0) {
      const targetTest = testsData.find((test) => Number(test.id) === examId || Number(test.sourceExamId) === examId);
      if (targetTest) {
        targetTest.attempts = Math.min(Number(targetTest.maxAttempts || 3), Math.max(0, Number(targetTest.attempts || 0)) + 1);
      }
      if (currentTest && (!targetTest || currentTest !== targetTest)) {
        currentTest.attempts = Math.min(Number(currentTest.maxAttempts || 3), Math.max(0, Number(currentTest.attempts || 0)) + 1);
      }
      renderTests(activeFilter, activeSearch);
    }
  } catch {
    // Keep exam experience smooth when API is temporarily unavailable.
  }
}

async function loadMockTestsFromBackend() {
  if (!API_BASE_URL || typeof getStudentId !== "function") return false;
  const studentId = getStudentId();
  if (!studentId) return false;

  try {
    const [routineRes, performanceRes] = await Promise.all([
      fetch(`${API_BASE_URL}/student/${studentId}/exams`),
      fetch(`${API_BASE_URL}/student/${studentId}/performance`),
    ]);

    const routinePayload = await routineRes.json();
    const performancePayload = await performanceRes.json();

    testsData = routineRes.ok && routinePayload?.success
      ? buildTestsFromExamRoutine(routinePayload.data?.exams || [])
      : [...localTestsData];

    if (performanceRes.ok && performancePayload?.success) {
      updateMockStatsFromPerformance(performancePayload.data || []);
    }

    return true;
  } catch {
    testsData = [];
    return false;
  }
}

function resolveTestIdFromQuery() {
  const params = new URLSearchParams(window.location.search);

  const openTestId = Number(params.get("openTest"));
  if (Number.isInteger(openTestId) && openTestId > 0) {
    const foundOpenTest = testsData.find((test) => test.id === openTestId);
    if (foundOpenTest) return foundOpenTest.id;
  }

  const demoExam = (params.get("demoExam") || "").trim().toLowerCase();
  if (demoExam) {
    const matchBySubject = testsData.find(
      (test) =>
        test.status === "available" &&
        test.subjects.some((subject) => subject.toLowerCase() === demoExam)
    );
    if (matchBySubject) return matchBySubject.id;
  }

  const examId = Number(params.get("examId"));
  if (Number.isInteger(examId) && examId > 0) {
    const foundExamTest = testsData.find((test) => test.id === examId);
    if (foundExamTest) return foundExamTest.id;
  }

  return null;
}

const openTestFromQuery = () => {
  const testId = resolveTestIdFromQuery();
  if (!testId) return;
  openTestConfirm(testId);
};

async function initMockTestPage() {
  await loadMockTestsFromBackend();
  renderTests(activeFilter, activeSearch);
  openTestFromQuery();

  if (mockRefreshInterval) clearInterval(mockRefreshInterval);
  mockRefreshInterval = setInterval(async () => {
    await loadMockTestsFromBackend();
    renderTests(activeFilter, activeSearch);
  }, 30000);
}

initMockTestPage();
