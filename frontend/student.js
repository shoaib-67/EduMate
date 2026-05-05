const { API_BASE_URL, getStoredUser, getStudentId, escapeHTML, requireRole, setupLogoutHandlers } = window.EduMateShared;

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

function formatDate(value) {
  if (!value) return "No deadline";
  return new Date(value).toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function getAssignmentDueState(deadline) {
  if (!deadline) return { label: "No deadline", className: "assignment-due-open" };
  const now = new Date();
  const due = new Date(deadline);
  if (Number.isNaN(due.getTime())) return { label: "No deadline", className: "assignment-due-open" };

  const diffDays = Math.ceil((due - now) / 86400000);
  if (diffDays < 0) return { label: "Overdue", className: "assignment-due-overdue" };
  if (diffDays === 0) return { label: "Due today", className: "assignment-due-soon" };
  if (diffDays <= 3) return { label: `Due in ${diffDays}d`, className: "assignment-due-soon" };
  return { label: formatDate(deadline), className: "assignment-due" };
}

function updateAssignmentSummary(assignments) {
  const activeCount = document.getElementById("assignmentActiveCount");
  const nextDue = document.getElementById("assignmentNextDue");
  const courseCount = document.getElementById("assignmentCourseCount");

  const datedAssignments = assignments
    .filter((assignment) => assignment.deadline && !Number.isNaN(new Date(assignment.deadline).getTime()))
    .sort((a, b) => new Date(a.deadline) - new Date(b.deadline));

  const uniqueCourses = new Set(
    assignments.map((assignment) => assignment.courseTitle || "General assignment")
  );

  if (activeCount) activeCount.textContent = String(assignments.length);
  if (nextDue) nextDue.textContent = datedAssignments.length ? formatDate(datedAssignments[0].deadline) : "None";
  if (courseCount) courseCount.textContent = String(uniqueCourses.size);
}

function updatePageHeader() {
  const user = getStoredUser();
  const heading = document.querySelector(".page-header h1");
  if (heading && user?.fullName) {
    heading.textContent = `Welcome back, ${user.fullName}`;
  }
}

async function loadAssignments() {
  const studentId = getStudentId();
  const assignmentList = document.getElementById("assignmentList");
  const assignmentCount = document.getElementById("assignmentCount");
  if (!studentId || !assignmentList) {
    updateAssignmentSummary([]);
    return;
  }

  try {
    const response = await fetch(`${API_BASE_URL}/student/${studentId}/assignments`);
    const payload = await response.json();
    if (!response.ok || !payload.success) {
      throw new Error(payload.message || "Could not load assignments.");
    }

    const assignments = payload.data || [];
    updateAssignmentSummary(assignments);
    if (assignmentCount) {
      assignmentCount.textContent = `${assignments.length} assignment${assignments.length === 1 ? "" : "s"}`;
    }

    assignmentList.innerHTML = assignments.length
      ? assignments
          .map(
            (assignment) => {
              const dueState = getAssignmentDueState(assignment.deadline);
              return `
              <article class="assignment-card">
                <div class="assignment-card-head">
                  <div>
                    <h3>${escapeHTML(assignment.title || "Untitled assignment")}</h3>
                    <span class="assignment-course">${escapeHTML(assignment.courseTitle || "General assignment")}</span>
                  </div>
                  <span class="chip ${dueState.className}">${escapeHTML(dueState.label)}</span>
                </div>
                <div class="assignment-instructions">
                  <span>Instructions</span>
                  <p>${escapeHTML(assignment.description || "No instructions provided.")}</p>
                </div>
                <div class="assignment-meta">
                  <span class="assignment-date">Deadline: ${escapeHTML(formatDate(assignment.deadline))}</span>
                </div>
              </article>
            `;
            }
          )
          .join("")
      : `
        <div class="empty-card">
          <strong>No assignments yet</strong>
          <span>Your assigned tasks will appear here.</span>
        </div>
      `;
  } catch (error) {
    console.error("Error loading assignments:", error);
    if (assignmentCount) {
      assignmentCount.textContent = "Unavailable";
    }
    updateAssignmentSummary([]);
    assignmentList.innerHTML = `
      <div class="empty-card">
        <strong>Could not load assignments</strong>
        <span>Try refreshing the dashboard after the server is ready.</span>
      </div>
    `;
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

    statCards[0].innerHTML = `
      <p class="s-label">Mock Tests</p>
      <p class="s-val">${Number(data.mockTestsCompleted || 0)} Completed</p>
      <p class="s-sub">${Number(data.totalTests || 0)} total attempts</p>
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

function setupUpcomingExamCards() {
  document.querySelectorAll(".upcoming-exam-item").forEach((card) => {
    const openExam = () => {
      const examId = card.getAttribute("data-exam-id") || card.getAttribute("data-mock-test-id");
      if (!examId) return;
      window.location.href = `exam-routine.html?examId=${encodeURIComponent(examId)}`;
    };

    card.style.cursor = "pointer";
    card.addEventListener("click", openExam);
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openExam();
      }
    });
  });
}

async function loadBellNotifications() {
  const studentId = getStudentId();
  if (!studentId) return;

  try {
    const response = await fetch(`${API_BASE_URL}/student/${studentId}/notifications`);
    const payload = await response.json();
    if (!response.ok || !payload.success) return;

    const items = payload.data?.items || [];
    const unreadCount = Number(payload.data?.unreadCount || 0);
    const bell = document.querySelector(".notif-btn");
    const dot = document.querySelector(".notif-dot");
    if (!bell) return;

    let panel = bell.querySelector(".notif-panel");
    if (!panel) {
      panel = document.createElement("div");
      panel.className = "notif-panel";
      panel.innerHTML = `<h3>Notifications</h3><div class="notif-panel-list"></div>`;
      bell.appendChild(panel);

      bell.addEventListener("click", (event) => {
        event.stopPropagation();
        panel.classList.toggle("is-open");
      });
      document.addEventListener("click", () => panel.classList.remove("is-open"));
    }

    const list = panel.querySelector(".notif-panel-list");
    list.innerHTML = items.length
      ? items
          .map(
            (item) => `
              <div class="list-item">
                <div>
                  <h4>${escapeHTML(item.title)}</h4>
                  <span>${escapeHTML(item.message)}</span>
                </div>
              </div>
            `
          )
          .join("")
      : `<div class="empty-state">No notifications yet.</div>`;

    if (dot) {
      dot.style.display = unreadCount > 0 ? "block" : "none";
    }
  } catch (error) {
    console.error("Error loading notifications:", error);
  }
}

async function loadUpcomingAndInsights() {
  const studentId = getStudentId();
  if (!studentId) return;

  const upcomingExamList = document.getElementById("upcomingExamList");
  const courseProgressList = document.getElementById("courseProgressList");
  const performanceSnapshotList = document.getElementById("performanceSnapshotList");

  try {
    const [routineRes, subjectsRes] = await Promise.all([
      fetch(`${API_BASE_URL}/student/${studentId}/exams`),
      fetch(`${API_BASE_URL}/student/${studentId}/performance/subjects`),
    ]);
    const routinePayload = await routineRes.json();
    const subjectsPayload = await subjectsRes.json();

    const routine = routinePayload.success ? routinePayload.data?.exams || [] : [];
    const subjects = subjectsPayload.success ? subjectsPayload.data || [] : [];

    if (upcomingExamList) {
      const activeExams = routine.filter((exam) => ["upcoming", "ongoing"].includes(String(exam.status || "").toLowerCase()));
      if (activeExams.length > 0) {
        upcomingExamList.innerHTML = activeExams
          .slice(0, 3)
          .map(
            (exam) => `
              <div class="list-item upcoming-exam-item" data-exam-id="${escapeHTML(String(exam.id))}" role="button" tabindex="0" aria-label="Open ${escapeHTML(exam.subject)}">
                <div>
                  <h4>${escapeHTML(exam.subject)}</h4>
                  <span>${escapeHTML(formatDateTime(exam.startTime))} - ${escapeHTML(exam.batchName || "General")}</span>
                </div>
                <span class="chip">${escapeHTML(exam.status === "ongoing" ? "Live" : "Upcoming")}</span>
              </div>
            `
          )
          .join("");
      } else {
        upcomingExamList.innerHTML = `
          <div class="list-item">
            <div><h4>No upcoming exams</h4><span>Your routine is clear right now.</span></div>
            <span class="chip">Free</span>
          </div>
        `;
      }
    }

    if (courseProgressList && subjects.length > 0) {
      courseProgressList.innerHTML = subjects
        .slice(0, 3)
        .map(
          (subject) => `
            <div class="list-item">
              <div>
                <h4>${escapeHTML(subject.subject)} Practice Track</h4>
                <span>${escapeHTML(String(subject.test_count))} tests completed</span>
              </div>
              <span class="chip">${escapeHTML(toDisplayPercent(subject.accuracy))}%</span>
            </div>
          `
        )
        .join("");
    }

    if (performanceSnapshotList && subjects.length > 0) {
      const sorted = [...subjects].sort((a, b) => Number(b.accuracy) - Number(a.accuracy));
      const top = sorted[0];
      const weak = sorted[sorted.length - 1];
      performanceSnapshotList.innerHTML = `
        <div class="list-item">
          <div>
            <h4>Top subject</h4>
            <span>${escapeHTML(top.subject)} - ${escapeHTML(toDisplayPercent(top.accuracy))}% average</span>
          </div>
          <span class="chip">Strong</span>
        </div>
        <div class="list-item">
          <div>
            <h4>Needs focus</h4>
            <span>${escapeHTML(weak.subject)} - target +10% improvement</span>
          </div>
          <span class="chip amber">Priority</span>
        </div>
        <div class="list-item">
          <div>
            <h4>Routine load</h4>
            <span>${escapeHTML(String(routine.length))} exams assigned in total</span>
          </div>
          <span class="chip blue">On track</span>
        </div>
      `;
    }
  } catch (error) {
    console.error("Error loading dashboard insights:", error);
  } finally {
    setupUpcomingExamCards();
  }
}

document.addEventListener("DOMContentLoaded", () => {
  if (!requireRole("student")) return;
  setupLogoutHandlers();
  updatePageHeader();
  loadDashboardStats();
  loadAssignments();
  loadUpcomingAndInsights();
  loadBellNotifications();
});
