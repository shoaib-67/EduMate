const { API_BASE_URL, getStoredUser, escapeHTML, requireRole, setupLogoutHandlers } = window.EduMateShared;

const state = {
  instructorId: null,
  feedbackTimer: null,
  workspace: {
    stats: { courseCount: 0, publishedExamCount: 0, managedStudentCount: 0, batchAverageScore: 0 },
    courseContent: [],
    questionBank: [],
    exams: [],
    students: [],
    communications: [],
    alerts: [],
    gradingQueue: [],
    exportsList: [],
    topicPerformance: [],
    scoreDistribution: [],
  },
};

function $(selector) {
  return document.querySelector(selector);
}

function getStatusChipClass(score) {
  if (score >= 80) return "chip";
  if (score >= 65) return "chip blue";
  if (score >= 50) return "chip amber";
  return "chip red";
}

function showConflict(message = "") {
  const banner = $("#conflictBanner");
  if (!banner) return;
  if (message) {
    banner.textContent = message;
    banner.classList.remove("is-hidden");
  } else {
    banner.textContent = "";
    banner.classList.add("is-hidden");
  }
}

function showBanner(message, type = "info", persistent = false) {
  const banner = $("#workspaceBanner");
  const healthBadge = $("#workspaceHealthBadge");
  if (!banner) return;

  banner.textContent = message;
  banner.className = `workspace-banner is-visible is-${type}`;

  if (healthBadge) {
    healthBadge.textContent =
      type === "error" ? "Connection issue" : type === "success" ? "Workspace ready" : "Workspace update";
  }

  if (state.feedbackTimer) {
    clearTimeout(state.feedbackTimer);
    state.feedbackTimer = null;
  }

  if (!persistent) {
    state.feedbackTimer = window.setTimeout(() => {
      banner.className = "workspace-banner";
      banner.textContent = "";
    }, 3600);
  }
}

function renderEmptyCard(title, note) {
  return `<div class="empty-card"><strong>${escapeHTML(title)}</strong><span>${escapeHTML(note)}</span></div>`;
}

function formatExamMoment(exam) {
  const date = String(exam?.date || "").trim();
  const time = String(exam?.time || "").trim();
  return [date, time].filter(Boolean).join(" ");
}

function getNextExam(exams) {
  const now = Date.now();
  return exams
    .map((exam) => ({
      ...exam,
      startsAt: Date.parse(`${exam.date}T${exam.time || "00:00"}`),
    }))
    .filter((exam) => Number.isFinite(exam.startsAt) && exam.startsAt >= now)
    .sort((left, right) => left.startsAt - right.startsAt)[0] || null;
}

function buildAttentionItems() {
  const exams = state.workspace.exams || [];
  const alerts = state.workspace.alerts || [];
  const gradingQueue = state.workspace.gradingQueue || [];
  const upcoming = exams.filter((exam) => exam.status === "Upcoming");
  const drafts = exams.filter((exam) => exam.state === "Draft");
  const urgentAlerts = alerts.filter((item) => item.level === "urgent");

  return [
    {
      title: `${upcoming.length} upcoming exam${upcoming.length === 1 ? "" : "s"}`,
      note: upcoming.length ? "Check access windows and publishing state before the next batch sits." : "No upcoming exams are waiting on you right now.",
    },
    {
      title: `${gradingQueue.length} answer${gradingQueue.length === 1 ? "" : "s"} in manual review`,
      note: gradingQueue.length ? "Short answers and essays still need instructor judgment." : "Manual grading queue is clear.",
    },
    {
      title: `${urgentAlerts.length} urgent alert${urgentAlerts.length === 1 ? "" : "s"}`,
      note: urgentAlerts.length ? "Submissions, violations, or questions need a fast look." : "Nothing urgent is flashing at the moment.",
    },
    {
      title: `${drafts.length} draft exam${drafts.length === 1 ? "" : "s"}`,
      note: drafts.length ? "Preview and publish when the schedule is confirmed." : "No draft exams are waiting to be published.",
    },
  ];
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const payload = await response.json();
  if (!response.ok || !payload.success) {
    const error = new Error(payload.message || "Request failed.");
    error.payload = payload;
    error.status = response.status;
    throw error;
  }
  return payload;
}

async function loadWorkspace() {
  showBanner("Refreshing instructor workspace data.", "info", true);
  const payload = await fetchJson(`${API_BASE_URL}/instructor/${state.instructorId}/workspace`);
  state.workspace = payload.data || state.workspace;
  renderAll();
  showBanner("Instructor workspace is up to date.", "success");
}

function renderStats() {
  const stats = state.workspace.stats || {};
  $("#courseCount").textContent = String(stats.courseCount || 0);
  $("#publishedExamCount").textContent = String(stats.publishedExamCount || 0);
  $("#managedStudentCount").textContent = String(stats.managedStudentCount || 0);
  $("#batchAverageScore").textContent = `${Number(stats.batchAverageScore || 0)}%`;
}

function renderWorkspaceOverview() {
  const exams = state.workspace.exams || [];
  const alerts = state.workspace.alerts || [];
  const nextExam = getNextExam(exams);
  const urgentAlerts = alerts.filter((item) => item.level === "urgent").length;
  const drafts = exams.filter((exam) => exam.state === "Draft").length;

  $("#workspaceHeadline").textContent = nextExam
    ? `Next exam: ${nextExam.title}`
    : "No upcoming exams on the board";
  $("#workspaceSummary").textContent = nextExam
    ? `${nextExam.batch} is scheduled for ${formatExamMoment(nextExam)}. Keep the join window, rules, and publish state aligned before students arrive.`
    : "Your batches are clear right now. This is a good moment to upload materials, clear grading, or set the next mock test.";
  $("#nextExamPill").textContent = nextExam
    ? `${nextExam.batch} · ${formatExamMoment(nextExam)}`
    : "No scheduled upcoming exam";
  $("#attentionPill").textContent = urgentAlerts
    ? `${urgentAlerts} urgent alert${urgentAlerts === 1 ? "" : "s"} to review`
    : drafts
      ? `${drafts} draft exam${drafts === 1 ? "" : "s"} waiting to publish`
      : "No urgent blockers";

  $("#attentionList").innerHTML = buildAttentionItems()
    .map(
      (item) => `
        <div class="attention-item">
          <strong>${escapeHTML(item.title)}</strong>
          <span>${escapeHTML(item.note)}</span>
        </div>
      `
    )
    .join("");
}

function renderCourseContent() {
  const items = state.workspace.courseContent || [];
  $("#courseContentList").innerHTML = items.length
    ? items
        .map(
          (item) => `
        <div class="list-item">
          <div>
            <h4>${escapeHTML(item.title)}</h4>
            <span>${escapeHTML(item.course)} - ${escapeHTML(item.batch)} - ${escapeHTML(item.type)}</span>
            <span>${escapeHTML(item.summary)}</span>
            <span>${item.deadline ? `Deadline: ${escapeHTML(item.deadline)}` : "No deadline"}</span>
          </div>
          <span class="chip">${escapeHTML(item.type)}</span>
        </div>
      `
        )
        .join("")
    : renderEmptyCard("No study materials yet", "Your course items will show up here once you save the first PDF, note, assignment, or announcement.");
}

function renderQuestionBank() {
  const items = state.workspace.questionBank || [];
  $("#questionBankList").innerHTML = items.length
    ? items
        .map(
          (item, index) => `
        <div class="list-item">
          <div>
            <h4>Q${index + 1} - ${escapeHTML(item.subject)} (${escapeHTML(item.type)})</h4>
            <span>${escapeHTML(item.text)}</span>
            <span>${escapeHTML(item.options)}</span>
            <span>Answer key: ${escapeHTML(item.answerKey)}</span>
          </div>
          <span class="chip blue">${escapeHTML(item.type)}</span>
        </div>
      `
        )
        .join("")
    : renderEmptyCard("Question bank is empty", "Add reusable MCQ, short answer, or essay items so new exams are faster to assemble.");
}

function renderExams() {
  const exams = state.workspace.exams || [];
  $("#examList").innerHTML = exams.length
    ? exams
        .map(
          (exam) => `
        <div class="list-item">
          <div>
            <h4>${escapeHTML(exam.title)}</h4>
            <span>${escapeHTML(exam.batch)} - ${escapeHTML(exam.examType)} - ${escapeHTML(exam.date)} ${escapeHTML(exam.time)}</span>
            <span>${escapeHTML(String(exam.duration))} min - Join window ${escapeHTML(String(exam.joinWindow))} min - ${escapeHTML(exam.shuffleMode)}</span>
            <span>${escapeHTML(exam.rules || "No extra rules added.")}</span>
          </div>
          <div class="list-item-actions">
            <span class="chip ${exam.state === "Published" ? "" : exam.state === "Draft" ? "amber" : "blue"}">${escapeHTML(exam.state)}</span>
            <span class="chip ${exam.status === "Upcoming" ? "blue" : exam.status === "Ongoing" ? "" : "red"}">${escapeHTML(exam.status)}</span>
          </div>
        </div>
      `
        )
        .join("")
    : renderEmptyCard("No exams created yet", "Create a mock test or batch exam to start filling the assessment board.");
}

function renderRoutine() {
  const exams = state.workspace.exams || [];
  $("#upcomingRoutineCount").textContent = String(exams.filter((exam) => exam.status === "Upcoming").length);
  $("#ongoingRoutineCount").textContent = String(exams.filter((exam) => exam.status === "Ongoing").length);
  $("#completedRoutineCount").textContent = String(exams.filter((exam) => exam.status === "Completed").length);

  $("#routineList").innerHTML = exams.length
    ? exams
        .map(
          (exam) => `
        <div class="list-item">
          <div>
            <h4>${escapeHTML(exam.title)}</h4>
            <span>${escapeHTML(exam.batch)} - ${escapeHTML(exam.date)} ${escapeHTML(exam.time)}</span>
            <span>${escapeHTML(exam.status)} - ${escapeHTML(exam.state)} - Access window ${escapeHTML(String(exam.joinWindow))} minutes</span>
          </div>
          <span class="chip ${exam.status === "Upcoming" ? "blue" : exam.status === "Ongoing" ? "" : "red"}">${escapeHTML(exam.status)}</span>
        </div>
      `
        )
        .join("")
    : renderEmptyCard("Routine is clear", "Scheduled exams appear here with live status once you add them.");
}

function renderStudents() {
  const students = state.workspace.students || [];
  $("#studentTableBody").innerHTML = students.length
    ? students
        .map(
          (student) => `
        <tr>
          <td>${escapeHTML(student.name)}</td>
          <td>${escapeHTML(student.batch)}</td>
          <td>${escapeHTML(student.progress)}</td>
          <td><span class="${getStatusChipClass(Number(student.score || 0))}">${escapeHTML(String(student.score || 0))}%</span></td>
          <td>${escapeHTML(student.note)}</td>
        </tr>
      `
        )
        .join("")
    : `<tr><td colspan="5">${renderEmptyCard("No assigned students yet", "Student profiles and progress rows will appear here when the batch roster is available.")}</td></tr>`;
}

function renderAnalytics() {
  const scoreDistribution = state.workspace.scoreDistribution || [];
  const gradingQueue = state.workspace.gradingQueue || [];
  const topicPerformance = state.workspace.topicPerformance || [];
  const exportsList = state.workspace.exportsList || [];

  $("#distributionList").innerHTML = scoreDistribution.length
    ? scoreDistribution
        .map((item) => `<div class="list-item"><div><h4>${escapeHTML(item.band)}</h4><span>Students in this range</span></div><span class="chip">${escapeHTML(String(item.count || 0))}</span></div>`)
        .join("")
    : renderEmptyCard("No score distribution yet", "Once students take an objective exam, performance bands will appear here.");

  $("#gradingQueueList").innerHTML = gradingQueue.length
    ? gradingQueue
        .map((item) => `<div class="list-item"><div><h4>${escapeHTML(item.exam)}</h4><span>${escapeHTML(item.item)}</span></div><span class="chip amber">${escapeHTML(item.owner)}</span></div>`)
        .join("")
    : renderEmptyCard("Manual grading queue is clear", "Short answers and essay responses waiting for review will appear here.");

  $("#topicPerformanceList").innerHTML = topicPerformance.length
    ? topicPerformance
        .map((item) => `<div class="list-item"><div><h4>${escapeHTML(item.topic)}</h4><span>${escapeHTML(item.note)}</span></div><span class="${getStatusChipClass(Number(item.score || 0))}">${escapeHTML(String(item.score || 0))}%</span></div>`)
        .join("")
    : renderEmptyCard("No topic analytics yet", "Batch-level strengths and weak spots show up here after enough exam data exists.");

  $("#exportList").innerHTML = exportsList.length
    ? exportsList
        .map((item) => `<div class="list-item"><div><h4>${escapeHTML(item.label)}</h4><span>${escapeHTML(item.format)} export package</span></div><span class="chip ${item.status === "Ready" ? "" : "amber"}">${escapeHTML(item.status)}</span></div>`)
        .join("")
    : renderEmptyCard("No exports queued", "Ready CSV and PDF result packages will be listed here.");
}

function renderCommunications() {
  const items = state.workspace.communications || [];
  $("#communicationList").innerHTML = items.length
    ? items
        .map(
          (item) => `
        <div class="list-item">
          <div>
            <h4>${escapeHTML(item.title)}</h4>
            <span>${escapeHTML(item.type)} - ${escapeHTML(item.audience)}</span>
            <span>${escapeHTML(item.body)}</span>
          </div>
          <span class="chip blue">${escapeHTML(item.type)}</span>
        </div>
      `
        )
        .join("")
    : renderEmptyCard("No messages posted yet", "Announcements, discussion starters, and direct notices will appear here after you send them.");
}

function renderAlerts() {
  const items = state.workspace.alerts || [];
  $("#alertList").innerHTML = items.length
    ? items
        .map(
          (item) => `
        <div class="list-item">
          <div>
            <h4>${escapeHTML(item.title)}</h4>
            <span>${escapeHTML(item.note)}</span>
          </div>
          <span class="chip ${item.level === "urgent" ? "red" : "blue"}">${item.level === "urgent" ? "Urgent" : "Info"}</span>
        </div>
      `
        )
        .join("")
    : renderEmptyCard("No active alerts", "Submission events, student questions, and exam reminders will show up here.");
}

function renderAll() {
  renderWorkspaceOverview();
  renderStats();
  renderCourseContent();
  renderQuestionBank();
  renderExams();
  renderRoutine();
  renderStudents();
  renderAnalytics();
  renderCommunications();
  renderAlerts();
}

async function submitForm(button, task) {
  const originalLabel = button?.textContent || "";
  if (button) {
    button.disabled = true;
    button.textContent = "Saving...";
  }

  try {
    await task();
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = originalLabel;
    }
  }
}

async function handleCourseSubmit(event) {
  event.preventDefault();
  const formData = new FormData(event.currentTarget);
  const submitButton = event.currentTarget.querySelector('button[type="submit"]');
  await submitForm(submitButton, async () => {
    await fetchJson(`${API_BASE_URL}/instructor/${state.instructorId}/course-items`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        course: String(formData.get("courseTitle") || "").trim(),
        batch: String(formData.get("courseBatch") || "").trim(),
        type: String(formData.get("contentType") || "").trim(),
        title: String(formData.get("contentTitle") || "").trim(),
        summary: String(formData.get("contentSummary") || "").trim(),
        deadline: String(formData.get("contentDeadline") || "").trim(),
      }),
    });
    event.currentTarget.reset();
    await loadWorkspace();
    showBanner("Course content saved and sent to admin for approval.", "success");
  });
}

async function handleExamSubmit(event) {
  event.preventDefault();
  showConflict("");
  const formData = new FormData(event.currentTarget);
  const submitButton = event.currentTarget.querySelector('button[type="submit"]');

  try {
    await submitForm(submitButton, async () => {
      await fetchJson(`${API_BASE_URL}/instructor/${state.instructorId}/exams`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: String(formData.get("examTitle") || "").trim(),
          batch: String(formData.get("examBatch") || "").trim(),
          date: String(formData.get("examDate") || "").trim(),
          time: String(formData.get("examTime") || "").trim(),
          duration: Number(formData.get("examDuration") || 0),
          joinWindow: Number(formData.get("joinWindow") || 15),
          negativeMarking: String(formData.get("negativeMarking") || "").trim(),
          shuffleMode: String(formData.get("shuffleMode") || "").trim(),
          examType: String(formData.get("examType") || "").trim(),
          state: String(formData.get("publishState") || "").trim(),
          rules: String(formData.get("examRules") || "").trim(),
        }),
      });
      event.currentTarget.reset();
      await loadWorkspace();
      showBanner("Exam saved and added to the routine board.", "success");
    });
  } catch (error) {
    if (error.status === 409 && error.payload?.conflict) {
      const conflict = error.payload.conflict;
      showConflict(`${conflict.title} overlaps for ${conflict.batch} on ${conflict.date} ${conflict.time}. Please adjust the schedule.`);
      showBanner("That exam was not saved because the batch already has an overlapping schedule.", "error");
      return;
    }
    throw error;
  }
}

async function handleQuestionSubmit(event) {
  event.preventDefault();
  const formData = new FormData(event.currentTarget);
  const submitButton = event.currentTarget.querySelector('button[type="submit"]');
  await submitForm(submitButton, async () => {
    await fetchJson(`${API_BASE_URL}/instructor/${state.instructorId}/question-bank`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        subject: String(formData.get("questionSubject") || "").trim(),
        type: String(formData.get("questionType") || "").trim(),
        text: String(formData.get("questionText") || "").trim(),
        options: String(formData.get("optionSet") || "").trim(),
        answerKey: String(formData.get("answerKey") || "").trim(),
      }),
    });
    event.currentTarget.reset();
    await loadWorkspace();
    showBanner("Question saved to the reusable bank.", "success");
  });
}

async function handleStudentActionSubmit(event) {
  event.preventDefault();
  const formData = new FormData(event.currentTarget);
  const submitButton = event.currentTarget.querySelector('button[type="submit"]');
  await submitForm(submitButton, async () => {
    await fetchJson(`${API_BASE_URL}/instructor/${state.instructorId}/student-actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        studentName: String(formData.get("studentName") || "").trim(),
        batch: String(formData.get("studentBatch") || "").trim(),
        action: String(formData.get("studentAction") || "").trim(),
        progress: String(formData.get("studentProgress") || "").trim(),
        note: String(formData.get("studentMessage") || "").trim(),
      }),
    });
    event.currentTarget.reset();
    await loadWorkspace();
    showBanner("Student action recorded for this batch.", "success");
  });
}

async function handleCommunicationSubmit(event) {
  event.preventDefault();
  const formData = new FormData(event.currentTarget);
  const submitButton = event.currentTarget.querySelector('button[type="submit"]');
  await submitForm(submitButton, async () => {
    await fetchJson(`${API_BASE_URL}/instructor/${state.instructorId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: String(formData.get("messageType") || "").trim(),
        audience: String(formData.get("messageAudience") || "").trim(),
        title: String(formData.get("messageTitle") || "").trim(),
        body: String(formData.get("messageBody") || "").trim(),
      }),
    });
    event.currentTarget.reset();
    await loadWorkspace();
    showBanner("Message posted to the communication hub.", "success");
  });
}

function bindEvents() {
  $("#courseForm")?.addEventListener("submit", (event) => {
    handleCourseSubmit(event).catch((error) => showBanner(error.message, "error"));
  });
  $("#examForm")?.addEventListener("submit", (event) => {
    handleExamSubmit(event).catch((error) => showBanner(error.message, "error"));
  });
  $("#questionBankForm")?.addEventListener("submit", (event) => {
    handleQuestionSubmit(event).catch((error) => showBanner(error.message, "error"));
  });
  $("#studentActionForm")?.addEventListener("submit", (event) => {
    handleStudentActionSubmit(event).catch((error) => showBanner(error.message, "error"));
  });
  $("#communicationForm")?.addEventListener("submit", (event) => {
    handleCommunicationSubmit(event).catch((error) => showBanner(error.message, "error"));
  });
}

function bindSectionNav() {
  const sections = [
    "#overviewSection",
    "#coursesSection",
    "#examSection",
    "#routineSection",
    "#studentsSection",
    "#resultsSection",
    "#communicationSection",
    "#alertsSection",
  ]
    .map((selector) => document.querySelector(selector))
    .filter(Boolean);
  const navItems = Array.from(document.querySelectorAll('.nav-item[href^="#"]'));

  if (!sections.length || !navItems.length || typeof IntersectionObserver !== "function") return;

  const navMap = new Map(navItems.map((item) => [item.getAttribute("href"), item]));
  const observer = new IntersectionObserver(
    (entries) => {
      const visibleEntry = entries
        .filter((entry) => entry.isIntersecting)
        .sort((left, right) => right.intersectionRatio - left.intersectionRatio)[0];

      if (!visibleEntry?.target?.id) return;
      const activeHref = `#${visibleEntry.target.id}`;

      navItems.forEach((item) => item.classList.toggle("active", item.getAttribute("href") === activeHref));
    },
    {
      rootMargin: "-25% 0px -55% 0px",
      threshold: [0.2, 0.4, 0.6],
    }
  );

  sections.forEach((section) => observer.observe(section));
  navMap.get("#overviewSection")?.classList.add("active");
}

document.addEventListener("DOMContentLoaded", async () => {
  const user = requireRole("instructor");
  if (!user) return;

  setupLogoutHandlers();
  state.instructorId = Number(user?.id || 1);
  bindEvents();
  bindSectionNav();

  try {
    await loadWorkspace();
  } catch (error) {
    showBanner(`Instructor workspace could not load: ${error.message}`, "error", true);
  }
});
