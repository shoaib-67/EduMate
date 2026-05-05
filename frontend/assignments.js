const { API_BASE_URL, getStudentId, escapeHTML, requireRole, setupLogoutHandlers } = window.EduMateShared;

const assignmentState = {
  items: [],
  query: "",
  dueFilter: "all",
};

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

function matchesDueFilter(assignment) {
  const dueState = getAssignmentDueState(assignment.deadline);
  if (assignmentState.dueFilter === "all") return true;
  if (assignmentState.dueFilter === "soon") return dueState.className === "assignment-due-soon";
  if (assignmentState.dueFilter === "overdue") return dueState.className === "assignment-due-overdue";
  if (assignmentState.dueFilter === "open") return dueState.className === "assignment-due-open";
  return true;
}

function getFilteredAssignments() {
  const query = assignmentState.query.trim().toLowerCase();
  return assignmentState.items.filter((assignment) => {
    const searchable = [
      assignment.title,
      assignment.courseTitle,
      assignment.description,
      formatDate(assignment.deadline),
    ]
      .join(" ")
      .toLowerCase();
    return (!query || searchable.includes(query)) && matchesDueFilter(assignment);
  });
}

function renderAssignments() {
  const assignmentList = document.getElementById("assignmentList");
  const assignmentCount = document.getElementById("assignmentCount");
  if (!assignmentList) return;

  updateAssignmentSummary(assignmentState.items);

  const assignments = getFilteredAssignments();
  if (assignmentCount) {
    assignmentCount.textContent = `${assignments.length} shown`;
  }

  assignmentList.innerHTML = assignments.length
    ? assignments
        .map((assignment) => {
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
        })
        .join("")
    : `
      <div class="empty-card assignment-empty">
        <strong>No matching assignments</strong>
        <span>Try changing the search text or due status filter.</span>
      </div>
    `;
}

async function loadAssignments() {
  const studentId = getStudentId();
  const assignmentList = document.getElementById("assignmentList");
  const assignmentCount = document.getElementById("assignmentCount");
  if (!studentId || !assignmentList) {
    updateAssignmentSummary([]);
    if (assignmentCount) assignmentCount.textContent = "Login needed";
    if (assignmentList) {
      assignmentList.innerHTML = `
        <div class="empty-card assignment-empty">
          <strong>Login required</strong>
          <span>Please log in as a student to view assignments.</span>
        </div>
      `;
    }
    return;
  }

  try {
    const response = await fetch(`${API_BASE_URL}/student/${studentId}/assignments`);
    const payload = await response.json();
    if (!response.ok || !payload.success) {
      throw new Error(payload.message || "Could not load assignments.");
    }

    assignmentState.items = payload.data || [];
    renderAssignments();
  } catch (error) {
    console.error("Error loading assignments:", error);
    if (assignmentCount) {
      assignmentCount.textContent = "Unavailable";
    }
    updateAssignmentSummary([]);
    assignmentState.items = [];
    assignmentList.innerHTML = `
      <div class="empty-card assignment-empty">
        <strong>Could not load assignments</strong>
        <span>Try refreshing the dashboard after the server is ready.</span>
      </div>
    `;
  }
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

document.addEventListener("DOMContentLoaded", () => {
  if (!requireRole("student")) return;
  setupLogoutHandlers();

  document.getElementById("assignmentSearch")?.addEventListener("input", (event) => {
    assignmentState.query = event.target.value || "";
    renderAssignments();
  });

  document.getElementById("assignmentDueFilter")?.addEventListener("change", (event) => {
    assignmentState.dueFilter = event.target.value || "all";
    renderAssignments();
  });

  loadAssignments();
  loadBellNotifications();
});
