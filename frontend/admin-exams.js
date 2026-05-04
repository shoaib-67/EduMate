const { API_BASE_URL, getStoredUser, escapeHTML, requireRole, setupLogoutHandlers } = window.EduMateShared;

const state = {
  admin: null,
  students: [],
  exams: [],
};

function requireAdminAccess() {
  const user = requireRole("admin", { redirectTo: "admin-login.html" });
  if (!user) return false;
  state.admin = user;
  return true;
}

function setupLogout() {
  setupLogoutHandlers();
}

function setMessage(id, message, type = "neutral", hidden = false) {
  const node = document.getElementById(id);
  if (!node) return;
  node.textContent = message || "";
  node.className = `status-banner status-banner-${type}${hidden ? " is-hidden" : ""}`;
}

function formatDateTime(value) {
  if (!value) return "Unknown";
  return new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function getStatusBadgeClass(status) {
  const normalized = String(status || "").toLowerCase();
  if (normalized === "ongoing") return "badge-success";
  if (normalized === "completed") return "badge-danger";
  return "badge-info";
}

function collectBatchOptions() {
  const batches = [...new Set(state.students.map((student) => student.batch_name).filter(Boolean))];
  const select = document.getElementById("examBatchSelect");
  if (!select) return;

  select.innerHTML = batches
    .map((batch, index) => `<option value="${escapeHTML(batch)}"${index === 0 ? " selected" : ""}>${escapeHTML(batch)}</option>`)
    .join("");
}

function renderStudentChecklist() {
  const batch = document.getElementById("examBatchSelect")?.value || "";
  const checklist = document.getElementById("studentChecklist");
  if (!checklist) return;

  const filteredStudents = state.students.filter((student) => (student.batch_name || "") === batch);
  if (filteredStudents.length === 0) {
    checklist.innerHTML = `<p class="empty-inline-note">No students found in this batch yet.</p>`;
    return;
  }

  checklist.innerHTML = filteredStudents
    .map(
      (student) => `
        <label class="student-check-item">
          <input type="checkbox" name="specificStudentIds" value="${student.student_id}" />
          <span>
            <strong>${escapeHTML(student.name)}</strong>
            <small>${escapeHTML(student.email)} · ${escapeHTML(student.course_track || "Unassigned track")}</small>
          </span>
        </label>
      `
    )
    .join("");
}

function syncAssignmentMode() {
  const assignmentType = document.querySelector('input[name="assignmentType"]:checked')?.value || "batch";
  const block = document.getElementById("studentPickerBlock");
  if (!block) return;
  block.classList.toggle("is-disabled", assignmentType !== "specific");
}

async function loadStudents() {
  const response = await fetch(`${API_BASE_URL}/admin/students/targets`);
  const payload = await response.json();
  if (!response.ok || !payload.success) {
    throw new Error(payload.message || "Failed to load students.");
  }

  state.students = payload.data || [];
  collectBatchOptions();
  renderStudentChecklist();
  syncAssignmentMode();
}

function renderExamTable() {
  const tableBody = document.getElementById("examTableBody");
  if (!tableBody) return;

  if (state.exams.length === 0) {
    tableBody.innerHTML = `
      <tr>
        <td colspan="5">No exams scheduled yet.</td>
      </tr>
    `;
    return;
  }

  tableBody.innerHTML = state.exams
    .map(
      (exam) => `
        <tr>
          <td>
            <strong>${escapeHTML(exam.subject)}</strong><br />
            <small>${escapeHTML(exam.instructions || "No instructions")}</small>
          </td>
          <td>${escapeHTML(formatDateTime(exam.startTime))}<br /><small>${exam.durationMinutes} mins</small></td>
          <td>${escapeHTML(exam.batchName || "General")}</td>
          <td>${escapeHTML(exam.audienceType === "specific" ? `${exam.assignedStudentCount} students` : "Entire batch")}</td>
          <td><span class="badge ${getStatusBadgeClass(exam.status)}">${escapeHTML(exam.status)}</span></td>
        </tr>
      `
    )
    .join("");

  document.getElementById("upcomingExamCount").textContent = state.exams.filter((exam) => exam.status === "upcoming").length;
  document.getElementById("ongoingExamCount").textContent = state.exams.filter((exam) => exam.status === "ongoing").length;
  document.getElementById("completedExamCount").textContent = state.exams.filter((exam) => exam.status === "completed").length;
}

async function loadExams() {
  const response = await fetch(`${API_BASE_URL}/admin/exams`);
  const payload = await response.json();
  if (!response.ok || !payload.success) {
    throw new Error(payload.message || "Failed to load exams.");
  }

  state.exams = payload.data || [];
  renderExamTable();
}

function getSelectedStudentIds(form) {
  return [...form.querySelectorAll('input[name="specificStudentIds"]:checked')].map((input) => Number(input.value));
}

async function handleCreateExam(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const submitButton = document.getElementById("createExamButton");
  const formData = new FormData(form);
  const assignmentType = formData.get("assignmentType") || "batch";

  setMessage("examConflictMessage", "", "danger", true);
  setMessage("examFormMessage", "Saving exam schedule...", "neutral", false);
  submitButton.disabled = true;

  const payload = {
    subject: String(formData.get("subject") || "").trim(),
    batchName: String(formData.get("batchName") || "").trim(),
    date: formData.get("date"),
    time: formData.get("time"),
    duration: Number(formData.get("duration")),
    joinWindowMinutes: Number(formData.get("joinWindowMinutes")),
    instructions: String(formData.get("instructions") || "").trim(),
    assignmentType,
    specificStudentIds: assignmentType === "specific" ? getSelectedStudentIds(form) : [],
    adminId: state.admin?.id,
  };

  try {
    const response = await fetch(`${API_BASE_URL}/admin/exams`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await response.json();

    if (response.status === 409) {
      const conflict = result.conflict;
      const summary = conflict
        ? `Conflict with ${conflict.subject} (${formatDateTime(conflict.startTime)} to ${formatDateTime(conflict.endTime)}).`
        : result.message;
      setMessage("examConflictMessage", summary, "danger", false);
      setMessage("examFormMessage", "Please choose another time for this batch.", "warning", false);
      return;
    }

    if (!response.ok || !result.success) {
      throw new Error(result.message || "Failed to create exam.");
    }

    form.reset();
    document.querySelector('input[name="assignmentType"][value="batch"]').checked = true;
    collectBatchOptions();
    renderStudentChecklist();
    syncAssignmentMode();
    await loadExams();
    setMessage("examFormMessage", "Exam created and reminders queued successfully.", "success", false);
  } catch (error) {
    setMessage("examFormMessage", error.message, "danger", false);
  } finally {
    submitButton.disabled = false;
  }
}

function bindEvents() {
  document.getElementById("examBatchSelect")?.addEventListener("change", renderStudentChecklist);
  document.querySelectorAll('input[name="assignmentType"]').forEach((input) => {
    input.addEventListener("change", syncAssignmentMode);
  });
  document.getElementById("refreshExamList")?.addEventListener("click", () => {
    loadExams().catch((error) => setMessage("examFormMessage", error.message, "danger", false));
  });
  document.getElementById("examForm")?.addEventListener("submit", handleCreateExam);
}

document.addEventListener("DOMContentLoaded", async () => {
  if (!requireAdminAccess()) return;
  setupLogout();
  bindEvents();

  try {
    await loadStudents();
    await loadExams();
  } catch (error) {
    setMessage("examFormMessage", error.message, "danger", false);
  }
});
