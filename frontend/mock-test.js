const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => root.querySelectorAll(selector);

const MAX_ATTEMPTS_UNLIMITED = 999;
const OPTION_LABELS = ["A", "B", "C", "D"];
const MODAL_VIEWS = ["confirmView", "examView", "submitConfirmView", "resultView"];
const BADGE_MAP = {
  available: ["badge-green", "Available"],
  scheduled: ["badge-amber", "Scheduled"],
  completed: ["badge-blue", "Completed"],
};

const testsData = [
  {
    id: 1,
    title: "BUET Admission Full Mock",
    status: "available",
    featured: true,
    duration: 60,
    questions: 10,
    subjects: ["Physics", "Chemistry", "Math"],
    attempts: 3,
    maxAttempts: 5,
    description: "Complete admission mock covering all three core subjects.",
    tags: ["BUET", "Full Mock"],
    free: false,
  },
  {
    id: 2,
    title: "DU Ka Unit - Physics Only",
    status: "available",
    duration: 45,
    questions: 8,
    subjects: ["Physics"],
    attempts: 1,
    maxAttempts: 5,
    description: "Focus test on Physics for Dhaka University Ka unit.",
    tags: ["DU", "Physics"],
    free: true,
  },
  {
    id: 3,
    title: "Math Practice Set #4",
    status: "available",
    duration: 30,
    questions: 6,
    subjects: ["Math"],
    attempts: 0,
    maxAttempts: MAX_ATTEMPTS_UNLIMITED,
    description: "Algebra and Calculus intensive - unlimited attempts.",
    tags: ["Math", "Practice"],
    free: true,
  },
  {
    id: 4,
    title: "Chemistry Full Chapter Mock",
    status: "scheduled",
    duration: 50,
    questions: 8,
    subjects: ["Chemistry"],
    attempts: 0,
    maxAttempts: 3,
    description: "Organic and Inorganic chemistry comprehensive test.",
    tags: ["Chemistry", "BUET"],
    free: false,
    schedDate: "Apr 15, 2025",
  },
  {
    id: 5,
    title: "Biology for Medical Admission",
    status: "scheduled",
    duration: 60,
    questions: 8,
    subjects: ["Biology"],
    attempts: 0,
    maxAttempts: 3,
    description: "Covers cell biology, genetics, and human physiology.",
    tags: ["Biology", "Medical"],
    free: false,
    schedDate: "Apr 18, 2025",
  },
  {
    id: 6,
    title: "Chemistry Mock #2",
    status: "completed",
    duration: 50,
    questions: 6,
    subjects: ["Chemistry"],
    attempts: 2,
    maxAttempts: 3,
    description: "Review your result and understand weak areas.",
    tags: ["Chemistry", "Review"],
    free: false,
    score: 72,
  },
  {
    id: 7,
    title: "Physics Wave and Optics",
    status: "completed",
    duration: 35,
    questions: 6,
    subjects: ["Physics"],
    attempts: 1,
    maxAttempts: 3,
    description: "Focused test on wave motion and optics chapter.",
    tags: ["Physics", "Chapter"],
    free: true,
    score: 85,
  },
  {
    id: 8,
    title: "DU Kha Unit Full Mock",
    status: "available",
    duration: 75,
    questions: 10,
    subjects: ["Physics", "Math", "Biology"],
    attempts: 0,
    maxAttempts: 3,
    description: "Comprehensive mock for DU Kha unit aspirants.",
    tags: ["DU", "Full Mock"],
    free: false,
  },
];

const questionBankData = {
  Physics: [
    {
      text: "A particle moves with displacement s = 2t^3 - 3t^2 + 1 m. What is the velocity at t = 2s?",
      opts: ["12 m/s", "18 m/s", "6 m/s", "24 m/s"],
      ans: 1,
    },
    {
      text: "A body is thrown vertically upward with velocity 20 m/s. Maximum height reached (g = 10 m/s^2) is:",
      opts: ["10 m", "20 m", "30 m", "40 m"],
      ans: 1,
    },
    {
      text: "The SI unit of electric potential is:",
      opts: ["Joule", "Coulomb", "Volt", "Ampere"],
      ans: 2,
    },
  ],
  Chemistry: [
    {
      text: "Which of the following is an example of a Lewis acid?",
      opts: ["NH3", "H2O", "BF3", "NaOH"],
      ans: 2,
    },
    {
      text: "The number of moles in 44g of CO2 (Molar mass = 44 g/mol) is:",
      opts: ["0.5 mol", "1 mol", "2 mol", "44 mol"],
      ans: 1,
    },
  ],
  Math: [
    {
      text: "The derivative of f(x) = 3x^4 - 5x^2 + 2 at x = 1 is:",
      opts: ["2", "-2", "4", "-4"],
      ans: 0,
    },
    { text: "If log2(x) = 5, then x equals:", opts: ["10", "25", "32", "64"], ans: 2 },
    {
      text: "The sum of the infinite geometric series 1 + 1/2 + 1/4 + ... is:",
      opts: ["1", "1.5", "2", "2.5"],
      ans: 2,
    },
  ],
  Biology: [
    {
      text: "The powerhouse of the cell is:",
      opts: ["Nucleus", "Ribosome", "Mitochondria", "Chloroplast"],
      ans: 2,
    },
    {
      text: "DNA replication occurs in which phase of the cell cycle?",
      opts: ["G1", "S", "G2", "M"],
      ans: 1,
    },
  ],
};

let currentTest = null;
let questions = [];
let answers = [];
let currentQ = 0;
let timerInterval = null;
let secondsLeft = 0;
let activeFilter = "all";
let activeSearch = "";

const stopTimer = () => {
  clearInterval(timerInterval);
  timerInterval = null;
};

const isUnlimited = (maxAttempts) => maxAttempts >= MAX_ATTEMPTS_UNLIMITED;

function buildQuestions(subjects, count) {
  const merged = [];
  subjects.forEach((subject) => {
    if (!questionBankData[subject]) return;
    questionBankData[subject].forEach((item) => merged.push({ ...item, subject }));
  });
  return merged.sort(() => Math.random() - 0.5).slice(0, Math.min(count, merged.length));
}

function getAttemptProgress(test) {
  if (isUnlimited(test.maxAttempts)) return test.attempts > 0 ? 50 : 0;
  return (test.attempts / test.maxAttempts) * 100;
}

function renderTests(filter = "all", search = "") {
  const grid = $("#testsGrid");
  if (!grid) return;

  const searchText = search.trim().toLowerCase();
  let list = testsData;
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
              ? `<button class="btn btn-sm btn-scheduled">${test.schedDate}</button>`
              : `<div class="score-box"><p class="score-label">Score</p><p class="score-value">${test.score}%</p></div>`
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

  $("#confirmTitle").textContent = currentTest.title;
  $("#confirmSubtitle").textContent = `${currentTest.questions} questions · ${currentTest.duration} minutes`;
  $("#ci-duration").textContent = `${currentTest.duration} min`;
  $("#ci-questions").textContent = currentTest.questions;
  $("#ci-subjects").textContent = currentTest.subjects.length;
  showView("confirmView");
  $("#examModal").classList.add("open");
}

function closeModal() {
  stopTimer();
  $("#examModal").classList.remove("open");
  showView("confirmView");
}

function startExam() {
  if (!currentTest) return;

  questions = buildQuestions(currentTest.subjects, currentTest.questions);
  answers = new Array(questions.length).fill(null);
  currentQ = 0;
  secondsLeft = currentTest.duration * 60;

  $("#examTitle").textContent = currentTest.title;
  showView("examView");
  buildPalette();
  renderQuestion();
  startTimer();
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
  stopTimer();

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
}

renderTests();

const openTestFromQuery = () => {
  const params = new URLSearchParams(window.location.search);
  const testId = Number(params.get("openTest"));
  if (!testId) return;

  const matchedTest = testsData.find((test) => test.id === testId);
  if (!matchedTest) return;

  openTestConfirm(testId);
};

openTestFromQuery();
