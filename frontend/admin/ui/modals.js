import { API_BASE_URL, escapeHTML } from "../shared.js";
import { showToast } from "./toast.js";

let reportNoteState = {
  id: null,
  action: null,
  trigger: null,
};

export function createReportNoteModal({ onComplete }) {
  const existing = document.getElementById("reportNoteModal");
  if (existing) return;

  const modal = document.createElement("div");
  modal.id = "reportNoteModal";
  modal.className = "user-modal";

  modal.innerHTML = `
    <div class="user-modal-dialog">
      <div class="user-modal-header">
        <h2 id="reportNoteTitle">Resolve report</h2>
        <button class="modal-close-btn" type="button" aria-label="Close">&times;</button>
      </div>
      <div class="user-modal-content">
        <p id="reportNoteSummary" class="modal-summary">Add a note for this action.</p>
        <label class="modal-field">
          <span>Admin note (optional)</span>
          <textarea id="reportNoteInput" rows="4" placeholder="Add context for the report owner..."></textarea>
        </label>
      </div>
      <div class="user-modal-actions">
        <button class="btn btn-light" type="button" id="reportNoteCancel">Cancel</button>
        <button class="btn btn-primary" type="button" id="reportNoteConfirm">Confirm</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  const closeModal = () => {
    modal.classList.remove("is-open");
    reportNoteState = { id: null, action: null, trigger: null };
    const input = document.getElementById("reportNoteInput");
    if (input) input.value = "";
  };

  modal.querySelector(".modal-close-btn")?.addEventListener("click", closeModal);
  modal.querySelector("#reportNoteCancel")?.addEventListener("click", closeModal);
  modal.addEventListener("click", (event) => {
    if (event.target === modal) closeModal();
  });

  modal.querySelector("#reportNoteConfirm")?.addEventListener("click", async () => {
    const { id, action, trigger } = reportNoteState;
    if (!id || !action) return;

    const confirmBtn = document.getElementById("reportNoteConfirm");
    const originalLabel = confirmBtn?.textContent || "Confirm";
    const note = String(document.getElementById("reportNoteInput")?.value || "").trim();

    if (confirmBtn) {
      confirmBtn.disabled = true;
      confirmBtn.textContent = action.busyLabel || "Saving...";
    }

    try {
      const response = await fetch(`${API_BASE_URL}/admin/reports/${id}/${action.endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.success) {
        throw new Error(payload.message || "Could not update report.");
      }

      showToast(action.successMessage || "Report updated.", "success");
      closeModal();
      if (trigger) trigger.disabled = true;
      onComplete?.();
    } catch (error) {
      showToast(error.message, "error");
    } finally {
      if (confirmBtn) {
        confirmBtn.disabled = false;
        confirmBtn.textContent = originalLabel;
      }
    }
  });
}

export function openReportNoteModal({ report, action, trigger }) {
  const modal = document.getElementById("reportNoteModal");
  if (!modal) return;
  reportNoteState = { id: report.id, action, trigger };

  const title = document.getElementById("reportNoteTitle");
  const summary = document.getElementById("reportNoteSummary");
  const input = document.getElementById("reportNoteInput");
  if (title) title.textContent = action.label || "Update report";
  if (summary) summary.textContent = `Report: ${report.title}`;
  if (input) input.value = "";

  modal.classList.add("is-open");
  input?.focus();
}

export function createContentModal() {
  const existing = document.getElementById("contentDetailModal");
  if (existing) return;

  const modal = document.createElement("div");
  modal.id = "contentDetailModal";
  modal.className = "user-modal";
  modal.innerHTML = `
    <div class="user-modal-dialog">
      <div class="user-modal-header">
        <h2>Content details</h2>
        <button class="modal-close-btn" type="button" aria-label="Close">&times;</button>
      </div>
      <div class="user-modal-content" id="contentModalContent"></div>
    </div>
  `;

  document.body.appendChild(modal);
  const close = () => modal.classList.remove("is-open");
  modal.querySelector(".modal-close-btn")?.addEventListener("click", close);
  modal.addEventListener("click", (event) => {
    if (event.target === modal) close();
  });
}

export function showContentDetail(content) {
  const modal = document.getElementById("contentDetailModal");
  const modalContent = document.getElementById("contentModalContent");
  if (!modal || !modalContent) return;

  modalContent.innerHTML = `
    <div class="detail-grid">
      <div><strong>Title</strong><span>${escapeHTML(content.title)}</span></div>
      <div><strong>Type</strong><span>${escapeHTML(content.type)}</span></div>
      <div><strong>Course</strong><span>${escapeHTML(content.courseTitle || "N/A")}</span></div>
      <div><strong>Batch</strong><span>${escapeHTML(content.batchName || "N/A")}</span></div>
      <div><strong>Instructor</strong><span>${escapeHTML(content.instructorName || "N/A")}</span></div>
      <div><strong>Status</strong><span>${escapeHTML(content.status)}</span></div>
      <div class="detail-full"><strong>Description</strong><span>${escapeHTML(content.description || "")}</span></div>
      <div><strong>Deadline</strong><span>${escapeHTML(content.deadline || "N/A")}</span></div>
      <div><strong>Created</strong><span>${escapeHTML(content.created_at || "")}</span></div>
    </div>
  `;

  modal.classList.add("is-open");
}

export function createUserModal() {
  const existing = document.getElementById("userDetailModal");
  if (existing) return;

  const modal = document.createElement("div");
  modal.id = "userDetailModal";
  modal.className = "user-modal";
  modal.innerHTML = `
    <div class="user-modal-dialog">
      <div class="user-modal-header">
        <h2>User details</h2>
        <button class="modal-close-btn" type="button" aria-label="Close">&times;</button>
      </div>
      <div class="user-modal-content" id="userModalContent"></div>
    </div>
  `;
  document.body.appendChild(modal);
  const close = () => modal.classList.remove("is-open");
  modal.querySelector(".modal-close-btn")?.addEventListener("click", close);
  modal.addEventListener("click", (event) => {
    if (event.target === modal) close();
  });
}

export function showUserDetail(user) {
  const modal = document.getElementById("userDetailModal");
  const modalContent = document.getElementById("userModalContent");
  if (!modal || !modalContent) return;

  const getRoleColor = (role) => {
    const clean = String(role || "").toLowerCase();
    if (clean === "admin") return "#6d28d9";
    if (clean === "instructor") return "#2563eb";
    return "#0f766e";
  };

  const getStatusColor = (status) => {
    const clean = String(status || "").toLowerCase();
    if (clean === "frozen") return "#b91c1c";
    return "#047857";
  };

  modalContent.innerHTML = `
    <div style="display:flex; flex-direction:column; gap: 10px;">
      <div style="display:flex; align-items:center; gap:12px;">
        <div class="avatar-circle" style="width:42px; height:42px;">${escapeHTML(
          String(user.name || "U").trim().slice(0, 1).toUpperCase()
        )}</div>
        <div>
          <div style="font-weight:700;">${escapeHTML(user.name)}</div>
          <div style="opacity:.8;">${escapeHTML(user.email)}</div>
        </div>
      </div>
      <div class="detail-grid">
        <div><strong>Role</strong><span style="color:${getRoleColor(user.role)};">${escapeHTML(user.role)}</span></div>
        <div><strong>Status</strong><span style="color:${getStatusColor(user.accountStatus)};">${escapeHTML(
          user.status || user.accountStatus
        )}</span></div>
        <div><strong>Phone</strong><span>${escapeHTML(user.phoneNumber || "N/A")}</span></div>
        <div><strong>Created</strong><span>${escapeHTML(user.createdAt || "N/A")}</span></div>
      </div>
    </div>
  `;

  modal.classList.add("is-open");
}

