const { API_BASE_URL, getStoredUser, getStudentId, escapeHTML, requireRole, setupLogoutHandlers, setupTabSync, setupAccountStatusGuard } = window.EduMateShared;

function toDisplayPercent(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "0";
  return Number.isInteger(num) ? String(num) : num.toFixed(1);
}

function formatDateTime(value) {
  return new Date(value).toLocaleString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function updatePageHeader() {
  const user = getStoredUser();
  const heading = document.querySelector(".page-header h1");
  if (heading && user?.fullName) {
    heading.textContent = `Welcome back, ${user.fullName}`;
  }
}

async function loadDashboardStats() {
  try {
    const studentId = getStudentId();
    if (!studentId) return;

    const response = await fetch(`${API_BASE_URL}/student/${studentId}/dashboard`);
    const result = await response.json();
    if (!result.success || !result.data) return;

    const data = result.data;
    const statCards = document.querySelectorAll(".stat-row .stat-card");
    if (statCards.length < 4) return;

    const completedMocks = Number(data.mockTestsCompleted ?? data.completedMocks ?? 0);
    const totalAttempts = Number(data.totalTests ?? data.totalAttempts ?? 0);

    statCards[0].innerHTML = `
      <p class="s-label">Mock Tests</p>
      <p class="s-val">${completedMocks} Completed</p>
      <p class="s-sub">${totalAttempts} total attempts</p>
    `;

    statCards[1].innerHTML = `
      <p class="s-label">Average Score</p>
      <p class="s-val text-primary">${toDisplayPercent(data.averageScore)}%</p>
      <p class="s-sub">Best: ${toDisplayPercent(data.bestScore)}%</p>
    `;

    statCards[2].innerHTML = `
      <p class="s-label">Accuracy</p>
      <p class="s-val">${toDisplayPercent(data.accuracy)}%</p>
      <p class="s-sub">${Number(data.studyDays || 0)} study days</p>
    `;

    statCards[3].innerHTML = data.lastTest
      ? `
        <p class="s-label">Last Test</p>
        <p class="s-val">${escapeHTML(data.lastTest.subject)}</p>
        <p class="s-sub">${escapeHTML(data.lastTest.name || "Recent test")}</p>
      `
      : `
        <p class="s-label">Last Test</p>
        <p class="s-val">No Data</p>
        <p class="s-sub">Take a mock test to update this.</p>
      `;
  } catch (error) {
    console.error("Error loading dashboard stats:", error);
  }
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
  const status = String(test?.status || "").toLowerCase();
  if (status === "completed" || status === "missed") return "completed";

  const { start, end } = getExamWindow(test);
  if (!start || !end) return status === "available" ? "available" : "scheduled";
  if (now > end) return "completed";
  if (isTestJoinAvailable(test, now)) return "available";
  return "scheduled";
}

function formatScheduleLabel(test) {
  const { start } = getExamWindow(test);
  if (!start) return test.schedDate || "Scheduled";
  return start.toLocaleString([], {
    weekday: "short",
    month: "short",
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

function renderUpcomingExams(exams = []) {
  const tracker = document.getElementById("upcomingExamTracker");
  if (!tracker) return;

  const upcoming = exams
    .map((exam) => ({
      id: Number(exam.id),
      title: String(exam.title || exam.subject || "Exam").trim(),
      subject: String(exam.subject || exam.title || "General").trim(),
      status: deriveLiveTestStatus(exam),
      duration: Number(exam.duration || exam.durationMinutes || 0),
      startTime: exam.startTime || null,
      endTime: exam.endTime || null,
      joinWindowMinutes: Number(exam.joinWindowMinutes || 15),
      batchName: String(exam.batchName || "General").trim(),
    }))
    .filter((exam) => ["scheduled", "available"].includes(exam.status))
    .sort((left, right) => {
      const leftTime = getExamWindow(left).start?.getTime() || Number.MAX_SAFE_INTEGER;
      const rightTime = getExamWindow(right).start?.getTime() || Number.MAX_SAFE_INTEGER;
      return leftTime - rightTime;
    })
    .slice(0, 4);

  if (!upcoming.length) {
    tracker.innerHTML = '<div class="upcoming-exams-empty">No upcoming exams are scheduled right now.</div>';
    return;
  }

  tracker.innerHTML = upcoming
    .map((exam) => {
      const { start } = getExamWindow(exam);
      const isLive = exam.status === "available";
      const statusLabel = isLive ? "Open now" : "Scheduled";
      const statusClass = isLive ? "is-live" : "is-scheduled";
      const actionMarkup = isLive
        ? `<a class="btn btn-small btn-primary" href="mock-test.html?examId=${encodeURIComponent(exam.id)}">Start test</a>`
        : `<span class="upcoming-exam-pill">Opens ${start ? formatScheduleLabel(exam) : exam.batchName}</span>`;

      return `
        <div class="list-item upcoming-exam-item">
          <div class="upcoming-exam-main">
            <div class="upcoming-exam-meta">
              <span class="upcoming-exam-pill ${statusClass}">${statusLabel}</span>
              <span class="upcoming-exam-pill">${exam.duration || 0} min</span>
              <span class="upcoming-exam-pill">${escapeHTML(exam.batchName)}</span>
            </div>
            <h4>${escapeHTML(exam.title)}</h4>
            <span>${escapeHTML(formatExamWindow(exam))} - ${escapeHTML(exam.subject)}</span>
          </div>
          <div class="upcoming-exam-actions">${actionMarkup}</div>
        </div>
      `;
    })
    .join("");
}

async function loadUpcomingExams() {
  try {
    const studentId = getStudentId();
    if (!studentId) return;

    const response = await fetch(`${API_BASE_URL}/student/${studentId}/exams`);
    const payload = await response.json();
    const exams = payload.success ? payload.data?.exams || [] : [];
    renderUpcomingExams(exams);
  } catch (error) {
    console.error("Error loading upcoming exams:", error);
    const tracker = document.getElementById("upcomingExamTracker");
    if (tracker) {
      tracker.innerHTML = '<div class="upcoming-exams-empty">Could not load upcoming exams right now.</div>';
    }
  }
}

function renderAnnouncements(announcements = []) {
  const announcementsTracker = document.getElementById("announcementsTracker");
  if (!announcementsTracker) return;

  if (!announcements || announcements.length === 0) {
    announcementsTracker.innerHTML = '<div class="upcoming-exams-empty">No announcements yet. Check back soon for updates from your instructors.</div>';
    return;
  }

  announcementsTracker.innerHTML = "";
  announcements.slice(0, 5).forEach((announcement) => {
    const item = document.createElement("div");
    item.className = "upcoming-exam";
    const createdRaw = announcement.created_at || announcement.createdAt || "";
    const createdParsed = new Date(createdRaw);
    const createdDate = Number.isNaN(createdParsed.getTime())
      ? "Recently posted"
      : createdParsed.toLocaleString([], {
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        });
    item.innerHTML = `
      <div class="exam-info">
        <h4>${escapeHTML(announcement.title)}</h4>
        <p>${escapeHTML((announcement.content || "").substring(0, 120))}${(announcement.content || "").length > 120 ? "..." : ""}</p>
        <span class="exam-time">by ${escapeHTML(announcement.instructor_name || "Instructor")} • ${escapeHTML(createdDate)}</span>
      </div>
    `;
    announcementsTracker.appendChild(item);
  });
}

async function loadAnnouncements() {
  try {
    const studentId = getStudentId();
    if (!studentId) return;

    const response = await fetch(`${API_BASE_URL}/student/${studentId}/announcements`);
    const payload = await response.json();
    const announcements = payload.success ? payload.data || [] : [];
    renderAnnouncements(announcements);
  } catch (error) {
    console.error("Error loading announcements:", error);
    const tracker = document.getElementById("announcementsTracker");
    if (tracker) {
      tracker.innerHTML = '<div class="upcoming-exams-empty">Could not load announcements right now.</div>';
    }
  }
}

document.addEventListener("DOMContentLoaded", () => {
  if (!requireRole("student")) return;
  setupAccountStatusGuard("student", { redirectTo: "index.html", intervalMs: 10000 });
  setupLogoutHandlers();

  const refreshStudentDashboard = () => {
    updatePageHeader();
    loadDashboardStats();
    loadUpcomingExams();
    loadAnnouncements();
  };

  refreshStudentDashboard();
  setupTabSync(refreshStudentDashboard, { minIntervalMs: 1000 });
});
