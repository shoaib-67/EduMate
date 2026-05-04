const {
  API_BASE_URL,
  getStoredUser,
  requireRole,
  setupLogoutHandlers: setupSharedLogoutHandlers,
  escapeHTML,
} = window.EduMateShared;

const isAdminUser = (user) => String(user?.role || "").toLowerCase() === "admin";

const requireAdminAccess = () => {
  return Boolean(requireRole("admin", { redirectTo: "admin-login.html" }));
};

const setupLogoutHandlers = () => {
  setupSharedLogoutHandlers();
};

let users = [];
let pendingContent = [];
let reports = [];
let activityLogs = [];
const filters = {
  users: { query: "", role: "all", status: "all" },
  content: { query: "", type: "all" },
  reports: { query: "", status: "open", priority: "all", category: "all" },
};
const MANAGEABLE_ROLES = new Set(["Student", "Instructor"]);

const roleToApiParam = (role) => String(role || "").trim().toLowerCase();

const setUserFormMessage = (message, type = "neutral") => {
  const userFormMessage = document.getElementById("userFormMessage");
  if (!userFormMessage) return;
  userFormMessage.textContent = message || "";
  userFormMessage.dataset.type = type;
};

const getInitials = (name) =>
  String(name || "U")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("") || "U";

const showToast = (message, type = "info") => {
  let toastStack = document.getElementById("toastStack");
  if (!toastStack) {
    toastStack = document.createElement("div");
    toastStack.id = "toastStack";
    toastStack.className = "toast-stack";
    document.body.appendChild(toastStack);
  }

  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  toastStack.appendChild(toast);

  setTimeout(() => {
    toast.classList.add("is-leaving");
    setTimeout(() => toast.remove(), 220);
  }, 3200);
};

const REPORT_ACTIONS = {
  resolve: {
    label: "Resolve report",
    actionLabel: "Resolve",
    busyLabel: "Resolving...",
    endpoint: "resolve",
    successMessage: "Report resolved.",
  },
  deny: {
    label: "Dismiss report",
    actionLabel: "Dismiss",
    busyLabel: "Dismissing...",
    endpoint: "deny",
    successMessage: "Report dismissed.",
  },
};

let reportNoteState = {
  id: null,
  action: null,
  trigger: null,
};

function createReportNoteModal() {
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
      <div class="user-modal-footer">
        <button class="btn btn-small btn-secondary" type="button" id="reportNoteCancel">Cancel</button>
        <button class="btn btn-small" type="button" id="reportNoteConfirm">Resolve report</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  const closeModal = () => {
    modal.style.display = "none";
    modal.classList.remove("is-open");
    reportNoteState = { id: null, action: null, trigger: null };
  };

  modal.querySelector(".modal-close-btn")?.addEventListener("click", closeModal);
  modal.querySelector("#reportNoteCancel")?.addEventListener("click", closeModal);
  modal.addEventListener("click", (event) => {
    if (event.target === modal) closeModal();
  });

  modal.querySelector("#reportNoteConfirm")?.addEventListener("click", async () => {
    const { id, action, trigger } = reportNoteState;
    if (!id || !action) return;
    const config = REPORT_ACTIONS[action] || REPORT_ACTIONS.resolve;
    const noteInput = document.getElementById("reportNoteInput");
    const note = String(noteInput?.value || "").trim();
    const confirmButton = document.getElementById("reportNoteConfirm");

    if (confirmButton) {
      confirmButton.disabled = true;
      confirmButton.textContent = config.busyLabel;
    }
    if (trigger) {
      trigger.disabled = true;
      trigger.textContent = config.busyLabel;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/admin/reports/${id}/${config.endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note }),
      });
      const payload = await response.json();

      if (!response.ok || !payload.success) {
        showToast(payload.message || "Failed to update report.", "error");
        return;
      }

      closeModal();
      await loadReports();
      await updateStats();
      await loadActivityLogs();
      showToast(payload.message || config.successMessage, "success");
    } catch (error) {
      showToast("Failed to update report: " + error.message, "error");
    } finally {
      if (confirmButton) {
        confirmButton.disabled = false;
        confirmButton.textContent = config.label;
      }
      if (trigger) {
        trigger.disabled = false;
        trigger.textContent = config.actionLabel;
      }
    }
  });
}

function openReportNoteModal({ id, action, title, trigger }) {
  const modal = document.getElementById("reportNoteModal");
  if (!modal) return;
  const config = REPORT_ACTIONS[action] || REPORT_ACTIONS.resolve;
  const summary = document.getElementById("reportNoteSummary");
  const titleElement = document.getElementById("reportNoteTitle");
  const confirmButton = document.getElementById("reportNoteConfirm");
  const noteInput = document.getElementById("reportNoteInput");

  if (titleElement) titleElement.textContent = config.label;
  if (confirmButton) confirmButton.textContent = config.label;
  if (summary) {
    summary.textContent = title
      ? `${config.label} for "${title}".`
      : `${config.label} for the selected report.`;
  }
  if (noteInput) noteInput.value = "";

  reportNoteState = { id, action, trigger };
  modal.style.display = "flex";
  modal.classList.add("is-open");
  noteInput?.focus();
}

function createContentModal() {
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
      <div id="contentDetailBody" class="user-modal-content"></div>
      <div class="user-modal-footer">
        <button class="btn btn-small btn-secondary" type="button" id="contentDetailClose">Close</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  const closeModal = () => {
    modal.style.display = "none";
    modal.classList.remove("is-open");
  };

  modal.querySelector(".modal-close-btn")?.addEventListener("click", closeModal);
  modal.querySelector("#contentDetailClose")?.addEventListener("click", closeModal);
  modal.addEventListener("click", (event) => {
    if (event.target === modal) closeModal();
  });
}

function showContentDetail(item) {
  const modal = document.getElementById("contentDetailModal");
  const body = document.getElementById("contentDetailBody");
  if (!modal || !body) return;

  const createdAt = item?.created_at ? new Date(item.created_at).toLocaleString() : "Unknown";
  const status = item?.status ? String(item.status).toUpperCase() : "PENDING";

  body.innerHTML = `
    <div class="modal-grid">
      <div class="modal-block">
        <p class="modal-label">Title</p>
        <p class="modal-value">${escapeHTML(item?.title || "Untitled")}</p>
      </div>
      <div class="modal-block">
        <p class="modal-label">Type</p>
        <p class="modal-value">${escapeHTML(item?.type || "Unknown")}</p>
      </div>
      <div class="modal-block">
        <p class="modal-label">Status</p>
        <p class="modal-value">${escapeHTML(status)}</p>
      </div>
    </div>
    <p class="modal-meta">Submitted: ${escapeHTML(createdAt)}</p>
  `;

  modal.style.display = "flex";
  modal.classList.add("is-open");
}

// Create modal for user details
function createUserModal() {
  const existing = document.getElementById("userDetailModal");
  if (existing) return;
  
  const modal = document.createElement("div");
  modal.id = "userDetailModal";
  modal.className = "user-modal";
  
  modal.innerHTML = `
    <div class="user-modal-dialog">
      <div class="user-modal-header">
        <h2 id="modalTitle">User details</h2>
        <button id="closeModal" class="modal-close-btn" type="button" aria-label="Close">&times;</button>
      </div>
      <div id="modalContent" class="user-modal-content"></div>
      <div class="user-modal-footer">
        <button id="closeModalBtn" class="btn btn-small btn-secondary" type="button">Close</button>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  const closeModal = document.getElementById("closeModal");
  const closeModalBtn = document.getElementById("closeModalBtn");
  
  closeModal.addEventListener("click", () => {
    modal.style.display = "none";
    modal.classList.remove("is-open");
  });
  
  closeModalBtn.addEventListener("click", () => {
    modal.style.display = "none";
    modal.classList.remove("is-open");
  });
  
  modal.addEventListener("click", (e) => {
    if (e.target === modal) {
      modal.style.display = "none";
      modal.classList.remove("is-open");
    }
  });
}

function showUserDetail(user) {
  const modal = document.getElementById("userDetailModal");
  if (!modal) return;
  
  const getRoleColor = (role) => {
    switch(role) {
      case "Student": return "#3498db";
      case "Instructor": return "#2ecc71";
      case "Admin": return "#e74c3c";
      default: return "#95a5a6";
    }
  };
  
  const getStatusColor = (status) => {
    switch(status) {
      case "Active": return "#27ae60";
      case "Pending": return "#f39c12";
      case "Inactive": return "#e74c3c";
      case "Frozen": return "#6c5ce7";
      default: return "#95a5a6";
    }
  };
  
  const modalContent = document.getElementById("modalContent");
  modalContent.innerHTML = `
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 20px;">
      <div>
        <p style="margin: 0 0 8px 0; color: #666; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px;">Full Name</p>
        <p style="margin: 0; font-size: 18px; font-weight: 600; color: #333;">${escapeHTML(user.name)}</p>
      </div>
      <div>
        <p style="margin: 0 0 8px 0; color: #666; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px;">User ID</p>
        <p style="margin: 0; font-size: 18px; font-weight: 600; color: #667eea;">#${user.id}</p>
      </div>
    </div>
    
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 20px;">
      <div>
        <p style="margin: 0 0 8px 0; color: #666; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px;">Email Address</p>
        <p style="margin: 0; font-size: 14px; color: #555; word-break: break-all;">${escapeHTML(user.email)}</p>
      </div>
      <div>
        <p style="margin: 0 0 8px 0; color: #666; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px;">Role</p>
        <span style="display: inline-block; background: ${getRoleColor(user.role)}; color: white; padding: 6px 12px; border-radius: 20px; font-size: 12px; font-weight: 600;">${escapeHTML(user.role)}</span>
      </div>
    </div>
    
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 20px; padding: 15px; background: rgba(102, 126, 234, 0.05); border-radius: 8px; border-left: 4px solid ${getRoleColor(user.role)};">
      <div>
        <p style="margin: 0 0 8px 0; color: #666; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px;">Account Status</p>
        <span style="display: inline-block; background: ${getStatusColor(user.status)}; color: white; padding: 6px 12px; border-radius: 20px; font-size: 12px; font-weight: 600;">● ${escapeHTML(user.status)}</span>
      </div>
      <div>
        <p style="margin: 0 0 8px 0; color: #666; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px;">Account Type</p>
        <p style="margin: 0; font-size: 14px; font-weight: 500; color: #333;">${escapeHTML(user.role)} Account</p>
      </div>
    </div>
    
    <div style="background: #f0f4ff; padding: 15px; border-radius: 8px; margin-top: 15px;">
      <p style="margin: 0; color: #667eea; font-size: 12px; font-weight: 600;">ℹ️ Last Updated: ${new Date().toLocaleTimeString()}</p>
    </div>
  `;
  
  modal.style.display = "flex";
}



const renderUsers = () => {
  const userTableBody = document.getElementById("userTableBody");
  if (!userTableBody) return;
  const query = filters.users.query.trim().toLowerCase();
  const filteredUsers = users.filter((user) => {
    const matchQuery =
      !query ||
      user.name?.toLowerCase().includes(query) ||
      user.email?.toLowerCase().includes(query);
    const matchRole = filters.users.role === "all" || user.role === filters.users.role;
    const matchStatus = filters.users.status === "all" || user.status === filters.users.status;
    return matchQuery && matchRole && matchStatus;
  });

  if (!filteredUsers.length) {
    userTableBody.innerHTML = `
      <tr>
        <td colspan="4"><div class="empty-state">No users match your filters.</div></td>
      </tr>
    `;
    return;
  }

  userTableBody.innerHTML = filteredUsers
    .map((user) => {
      const canManage = MANAGEABLE_ROLES.has(user.role);
      const frozen = user.status === "Frozen";
      const statusClass = frozen ? "status-badge status-frozen" : "status-badge status-active";
      const roleClass = `role-pill role-${roleToApiParam(user.role)}`;

      return `
      <tr>
        <td data-label="Name">
          <div class="user-cell">
            <span class="user-avatar-sm">${escapeHTML(getInitials(user.name))}</span>
            <span class="user-meta">
              <strong>${escapeHTML(user.name)}</strong>
              <span class="user-email">${escapeHTML(user.email)}</span>
            </span>
          </div>
        </td>
        <td data-label="Role"><span class="${roleClass}">${escapeHTML(user.role)}</span></td>
        <td data-label="Status"><span class="${statusClass}">${escapeHTML(user.status)}</span></td>
        <td data-label="Actions">
          <div class="user-action-group">
            <button class="btn btn-small btn-quiet user-view-btn" data-user-id="${user.id}" data-user-role="${user.role}">Details</button>
            ${
              canManage
                ? `<button class="btn btn-small btn-quiet user-status-btn" data-user-id="${user.id}" data-user-role="${user.role}" data-next-status="${frozen ? "active" : "frozen"}">${frozen ? "Unfreeze" : "Freeze"}</button>
                   <button class="btn btn-small btn-quiet btn-text-danger user-delete-btn" data-user-id="${user.id}" data-user-role="${user.role}">Delete</button>`
                : ""
            }
          </div>
        </td>
      </tr>`;
    })
    .join("");
  
  // Add event listeners for view buttons
  userTableBody?.querySelectorAll(".user-view-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = Number(btn.getAttribute("data-user-id"));
      const role = btn.getAttribute("data-user-role");
      const user = users.find((item) => item.id === id && item.role === role);
      if (user) showUserDetail(user);
    });
  });

  userTableBody?.querySelectorAll(".user-status-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-user-id");
      const role = btn.getAttribute("data-user-role");
      const nextStatus = btn.getAttribute("data-next-status");
      btn.disabled = true;
      btn.textContent = nextStatus === "frozen" ? "Freezing..." : "Unfreezing...";

      try {
        const response = await fetch(`${API_BASE_URL}/admin/users/${roleToApiParam(role)}/${id}/status`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: nextStatus }),
        });
        const payload = await response.json();

        if (!response.ok || !payload.success) {
          showToast(payload.message || "Failed to update account status.", "error");
          renderUsers();
          return;
        }

        await loadUsers();
        await updateStats();
        await loadActivityLogs();
        showToast(payload.message || "Account status updated.", "success");
      } catch (error) {
        showToast("Failed to update account status: " + error.message, "error");
        renderUsers();
      }
    });
  });

  userTableBody?.querySelectorAll(".user-delete-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-user-id");
      const role = btn.getAttribute("data-user-role");
      const user = users.find((item) => String(item.id) === String(id) && item.role === role);
      const label = user ? `${user.name} (${user.role})` : `${role} #${id}`;

      if (!window.confirm(`Delete ${label}? This cannot be undone.`)) {
        return;
      }

      btn.disabled = true;
      btn.textContent = "Deleting...";

      try {
        const response = await fetch(`${API_BASE_URL}/admin/users/${roleToApiParam(role)}/${id}`, {
          method: "DELETE",
        });
        const payload = await response.json();

        if (!response.ok || !payload.success) {
          showToast(payload.message || "Failed to delete account.", "error");
          renderUsers();
          return;
        }

        await loadUsers();
        await updateStats();
        await loadActivityLogs();
        showToast(payload.message || "Account deleted.", "success");
      } catch (error) {
        showToast("Failed to delete account: " + error.message, "error");
        renderUsers();
      }
    });
  });
};

const renderContent = () => {
  const contentList = document.getElementById("contentList");
  if (!contentList) return;
  
  // Filter to show only pending content
  const pendingItems = pendingContent.filter((item) => item.status === "pending");
  const query = filters.content.query.trim().toLowerCase();
  const typeFilter = filters.content.type;
  const filteredItems = pendingItems.filter((item) => {
    const matchQuery = !query || item.title?.toLowerCase().includes(query);
    const matchType = typeFilter === "all" || (item.type || "").toLowerCase() === typeFilter;
    return matchQuery && matchType;
  });

  const contentTypeFilter = document.getElementById("contentTypeFilter");
  if (contentTypeFilter) {
    const availableTypes = [...new Set(pendingItems.map((item) => (item.type || "").trim()).filter(Boolean))];
    const current = filters.content.type;
    contentTypeFilter.innerHTML =
      '<option value="all">All types</option>' +
      availableTypes.map((type) => `<option value="${type.toLowerCase()}">${type}</option>`).join("");
    contentTypeFilter.value = availableTypes.some((t) => t.toLowerCase() === current) ? current : "all";
  }
  
  if (filteredItems.length === 0) {
    contentList.innerHTML = '<li><div class="empty-state">No pending content matches your filters.</div></li>';
    return;
  }
  
  contentList.innerHTML = filteredItems
    .map(
      (item) => `
      <li>
        <div class="content-item-body">
          <h3>${item.title}</h3>
          <p>${item.type} submission awaiting review</p>
        </div>
        <div class="content-item-actions">
          <button class="btn btn-small btn-quiet content-view-btn" data-id="${item.id}">Details</button>
          <button class="btn btn-small btn-approve approve-btn" data-id="${item.id}">Approve</button>
          <button class="btn btn-small btn-muted deny-btn" data-id="${item.id}">Deny</button>
        </div>
      </li>`
    )
    .join("");

  contentList?.querySelectorAll(".content-view-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-id");
      const item = pendingContent.find((entry) => String(entry.id) === String(id));
      if (item) showContentDetail(item);
    });
  });
  
  // Add event listeners for approve buttons
  contentList?.querySelectorAll(".approve-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-id");
      btn.textContent = "Approving...";
      btn.disabled = true;
      try {
        const response = await fetch(`${API_BASE_URL}/admin/content/${id}/approve`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        });
        const payload = await response.json();
        if (response.ok && payload.success) {
          // Reload content after approval
          await loadContent();
          await updateStats();
          await loadActivityLogs();
          showToast(payload.message || "Content approved.", "success");
        } else {
          showToast(payload.message || "Failed to approve content.", "error");
          btn.textContent = "Approve";
          btn.disabled = false;
        }
      } catch (_error) {
        showToast("Failed to approve content: " + _error.message, "error");
        btn.textContent = "Approve";
        btn.disabled = false;
      }
    });
  });
  
  // Add event listeners for deny buttons
  contentList?.querySelectorAll(".deny-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-id");
      btn.textContent = "Denying...";
      btn.disabled = true;
      try {
        const response = await fetch(`${API_BASE_URL}/admin/content/${id}/deny`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        });
        const payload = await response.json();
        if (response.ok && payload.success) {
          // Reload content after denial
          await loadContent();
          await updateStats();
          await loadActivityLogs();
          showToast(payload.message || "Content denied.", "success");
        } else {
          showToast(payload.message || "Failed to deny content.", "error");
          btn.textContent = "Deny";
          btn.disabled = false;
        }
      } catch (_error) {
        showToast("Failed to deny content: " + _error.message, "error");
        btn.textContent = "Deny";
        btn.disabled = false;
      }
    });
  });
};

const renderReports = () => {
  const reportCards = document.getElementById("reportCards");
  if (!reportCards) return;
  
  const query = filters.reports.query.trim().toLowerCase();
  const statusFilter = filters.reports.status;
  const priorityFilter = filters.reports.priority;
  const categoryFilter = filters.reports.category;
  const filteredReports = reports.filter((item) => {
    const haystack = `${item.title || ""} ${item.description || ""} ${item.reporterName || ""} ${item.reporterEmail || ""}`.toLowerCase();
    const matchQuery = !query || haystack.includes(query);
    const matchStatus = statusFilter === "all" || (item.status || "").toLowerCase() === statusFilter;
    const matchPriority = priorityFilter === "all" || (item.priority || "").toLowerCase() === priorityFilter;
    const matchCategory = categoryFilter === "all" || (item.category || "").toLowerCase() === categoryFilter;
    return matchQuery && matchStatus && matchPriority && matchCategory;
  });
  
  const getStatusColor = (status) => {
    switch(status?.toLowerCase()) {
      case "open": return "#e74c3c";
      case "completed": return "#27ae60";
      case "denied": return "#95a5a6";
      case "pending": return "#f39c12";
      default: return "#95a5a6";
    }
  };
  
  if (filteredReports.length === 0) {
    reportCards.innerHTML = '<div class="empty-state" style="grid-column: 1/-1;">No reports match your filters.</div>';
    return;
  }
  
  reportCards.innerHTML = filteredReports
    .map(
      (item) => `
      <article class="report-card report-card-${escapeHTML((item.category || "bug").toLowerCase())}">
        <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 12px;">
          <strong style="color: #333; font-size: 16px;">${escapeHTML(item.title)}</strong>
          <span class="report-priority priority-${escapeHTML((item.priority || "normal").toLowerCase())}">${escapeHTML(item.priority || "normal")}</span>
        </div>
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; flex: 1;">
          <span style="background: ${getStatusColor(item.status)}; color: white; padding: 4px 12px; border-radius: 12px; font-size: 11px; font-weight: 600; text-transform: uppercase;">${escapeHTML(item.status)}</span>
          <span style="color: #667eea; font-weight: 700; font-size: 14px;">${escapeHTML(item.category || item.value || "report")}</span>
        </div>
        <p style="color: #5f7895; font-size: 13px; margin: 0 0 12px;">${escapeHTML(item.description || "No description provided.")}</p>
        <div class="report-actions">
          <button class="btn btn-small btn-approve report-resolve-btn" data-id="${item.id}">Resolve</button>
          <button class="btn btn-small btn-muted report-deny-btn" data-id="${item.id}">Dismiss</button>
        </div>
      </article>`
    )
    .join("");
  
  // Add hover effects
  reportCards.querySelectorAll(".report-card").forEach((card) => {
    card.addEventListener("mouseover", function() {
      this.style.transform = "translateY(-4px)";
      this.style.boxShadow = "0 8px 20px rgba(0,0,0,0.12)";
    });
    
    card.addEventListener("mouseout", function() {
      this.style.transform = "translateY(0)";
      this.style.boxShadow = "0 2px 8px rgba(0,0,0,0.08)";
    });
  });
  
  // Add event listeners for resolve buttons
  reportCards?.querySelectorAll(".report-resolve-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const id = btn.getAttribute("data-id");
      const report = reports.find((entry) => String(entry.id) === String(id));
      openReportNoteModal({ id, action: "resolve", title: report?.title, trigger: btn });
    });
  });
  
  // Add event listeners for deny buttons
  reportCards?.querySelectorAll(".report-deny-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const id = btn.getAttribute("data-id");
      const report = reports.find((entry) => String(entry.id) === String(id));
      openReportNoteModal({ id, action: "deny", title: report?.title, trigger: btn });
    });
  });
};

const loadUsers = async () => {
  try {
    const response = await fetch(`${API_BASE_URL}/admin/users`);
    const payload = await response.json();
    if (payload.success) {
      users = payload.data || [];
      renderUsers();
    }
  } catch (_error) {
    console.error("Failed to load users");
  }
};

const setupUserForm = () => {
  const addUserForm = document.getElementById("addUserForm");
  const addUserButton = document.getElementById("addUserButton");
  const toggleAddUserForm = document.getElementById("toggleAddUserForm");

  if (!addUserForm || addUserForm.dataset.ready === "true") return;
  addUserForm.dataset.ready = "true";

  if (toggleAddUserForm) {
    toggleAddUserForm.addEventListener("click", () => {
      const isHidden = addUserForm.classList.toggle("is-hidden");
      toggleAddUserForm.textContent = isHidden ? "Add account" : "Close form";
      if (!isHidden) {
        addUserForm.querySelector("input[name='fullName']")?.focus();
      }
    });
  }

  addUserForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    setUserFormMessage("");

    const formData = new FormData(addUserForm);
    const payload = {
      fullName: formData.get("fullName"),
      email: formData.get("email"),
      phone: formData.get("phone"),
      role: formData.get("role"),
      password: formData.get("password"),
    };

    if (addUserButton) {
      addUserButton.disabled = true;
      addUserButton.textContent = "Adding...";
    }

    try {
      const response = await fetch(`${API_BASE_URL}/admin/users`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json();

      if (!response.ok || !result.success) {
        setUserFormMessage(result.message || "Could not add account.", "error");
        return;
      }

      addUserForm.reset();
      setUserFormMessage(result.message || "Account added.", "success");
      await loadUsers();
      await updateStats();
      await loadActivityLogs();
      showToast(result.message || "Account added.", "success");
    } catch (error) {
      setUserFormMessage("Cannot connect to backend: " + error.message, "error");
      showToast("Cannot connect to backend: " + error.message, "error");
    } finally {
      if (addUserButton) {
        addUserButton.disabled = false;
        addUserButton.textContent = "Create account";
      }
    }
  });
};

const formatActivityAction = (action) =>
  String(action || "")
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

const renderActivityLogs = () => {
  const activityLogList = document.getElementById("activityLogList");
  if (!activityLogList) return;

  if (!activityLogs.length) {
    activityLogList.innerHTML = '<li><div class="empty-state">No admin activity yet.</div></li>';
    return;
  }

  activityLogList.innerHTML = activityLogs
    .slice(0, 8)
    .map((log) => {
      const created = log.createdAt ? new Date(log.createdAt).toLocaleString() : "";
      return `
        <li class="activity-item">
          <div>
            <strong>${escapeHTML(formatActivityAction(log.action))}</strong>
            <span>${escapeHTML(log.targetLabel || log.targetType || "System")}</span>
          </div>
          <time>${escapeHTML(created)}</time>
        </li>`;
    })
    .join("");
};

const loadActivityLogs = async () => {
  try {
    const response = await fetch(`${API_BASE_URL}/admin/activity-logs`);
    const payload = await response.json();
    if (payload.success) {
      activityLogs = payload.data || [];
      renderActivityLogs();
    }
  } catch (_error) {
    console.error("Failed to load activity logs");
  }
};

const loadContent = async () => {
  try {
    const response = await fetch(`${API_BASE_URL}/admin/content`);
    const payload = await response.json();
    if (payload.success) {
      pendingContent = payload.data || [];
      renderContent();
    }
  } catch (_error) {
    console.error("Failed to load content");
  }
};

const loadReports = async () => {
  try {
    const response = await fetch(`${API_BASE_URL}/admin/reports`);
    const payload = await response.json();
    if (payload.success) {
      reports = payload.data || [];
      renderReports();
      
      // Update report stats dynamically
      const openReports = reports.filter(r => r.status === 'open').length;
      const reportCountElement = document.getElementById("reportCount");
      const reportBadgeElement = document.getElementById("reportBadge");
      
      if (reportCountElement) {
        const oldValue = parseInt(reportCountElement.textContent) || 0;
        if (oldValue !== openReports) {
          reportCountElement.textContent = openReports;
          reportCountElement.closest(".stat-card").style.animation = "none";
          setTimeout(() => {
            reportCountElement.closest(".stat-card").style.animation = "pulse 0.6s ease-in-out";
          }, 10);
        }
      }
      if (reportBadgeElement) {
        reportBadgeElement.textContent = `${openReports} open`;
      }
    }
  } catch (_error) {
    console.error("Failed to load reports");
  }
};

const updateStats = async () => {
  try {
    const response = await fetch(`${API_BASE_URL}/admin/overview`);
    const payload = await response.json();
    if (payload.success) {
      const data = payload.data;
      
      // Animate stat updates with visual feedback
      const animateValue = (element, newValue, parent) => {
        if (!element) return;
        const oldValue = parseInt(element.textContent) || 0;
        
        // Add pulse animation when value changes
        if (oldValue !== newValue) {
          if (parent) {
            parent.style.animation = "none";
            setTimeout(() => {
              parent.style.animation = "pulse 0.6s ease-in-out";
            }, 10);
          }
        }
        
        const increment = (newValue - oldValue) / 15;
        let current = oldValue;
        
        const counter = setInterval(() => {
          current += increment;
          if ((increment > 0 && current >= newValue) || (increment < 0 && current <= newValue)) {
            element.textContent = newValue;
            clearInterval(counter);
          } else {
            element.textContent = Math.round(current);
          }
        }, 40);
      };
      
      // Create animation styles if not present
      if (!document.getElementById("adminAnimationStyles")) {
        const style = document.createElement("style");
        style.id = "adminAnimationStyles";
        style.textContent = `
          @keyframes pulse {
            0% { transform: scale(1); }
            50% { transform: scale(1.05); }
            100% { transform: scale(1); }
          }
          @keyframes glow {
            0%, 100% { box-shadow: 0 0 5px rgba(102, 126, 234, 0.3); }
            50% { box-shadow: 0 0 15px rgba(102, 126, 234, 0.6); }
          }
          .stat-card:hover {
            box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12) !important;
          }
        `;
        document.head.appendChild(style);
      }
      
      const userCountElement = document.getElementById("userCount");
      const newSignupCountElement = document.getElementById("newSignupCount");
      const reportCountElement = document.getElementById("reportCount");
      const contentCountElement = document.getElementById("contentCount");
      const reportBadgeElement = document.getElementById("reportBadge");
      
      const userCountParent = userCountElement?.closest(".stat-card");
      const newSignupParent = newSignupCountElement?.closest(".stat-card");
      const reportParent = reportCountElement?.closest(".stat-card");
      const contentParent = contentCountElement?.closest(".stat-card");
      
      if (userCountElement) {
        animateValue(userCountElement, data.activeUsers || 0, userCountParent);
      }
      if (newSignupCountElement) {
        animateValue(newSignupCountElement, data.newSignups || 0, newSignupParent);
      }
      if (reportCountElement) {
        animateValue(reportCountElement, data.pendingReports || 0, reportParent);
      }
      if (contentCountElement) {
        animateValue(contentCountElement, data.contentUpdates || 0, contentParent);
      }
      if (reportBadgeElement) {
        reportBadgeElement.textContent = `${data.pendingReports || 0} open`;
      }
    }
  } catch (_error) {
    console.error("Failed to load stats");
  }
};

// Auto-refresh stats every 10 seconds
let statsRefreshInterval;

const startStatsAutoRefresh = () => {
  // Initial load
  updateStats();
  
  // Set up periodic refresh
  statsRefreshInterval = setInterval(() => {
    updateStats();
  }, 10000); // Refresh every 10 seconds
};

const stopStatsAutoRefresh = () => {
  if (statsRefreshInterval) {
    clearInterval(statsRefreshInterval);
  }
};

const setupFilters = () => {
  const userSearch = document.getElementById("userSearch");
  const userRoleFilter = document.getElementById("userRoleFilter");
  const userStatusFilter = document.getElementById("userStatusFilter");
  const contentSearch = document.getElementById("contentSearch");
  const contentTypeFilter = document.getElementById("contentTypeFilter");
  const reportSearch = document.getElementById("reportSearch");
  const reportStatusFilter = document.getElementById("reportStatusFilter");
  const reportPriorityFilter = document.getElementById("reportPriorityFilter");
  const reportCategoryFilter = document.getElementById("reportCategoryFilter");

  if (userSearch) {
    userSearch.addEventListener("input", (event) => {
      filters.users.query = event.target.value || "";
      renderUsers();
    });
  }
  if (userRoleFilter) {
    userRoleFilter.addEventListener("change", (event) => {
      filters.users.role = event.target.value || "all";
      renderUsers();
    });
  }
  if (userStatusFilter) {
    userStatusFilter.addEventListener("change", (event) => {
      filters.users.status = event.target.value || "all";
      renderUsers();
    });
  }

  if (contentSearch) {
    contentSearch.addEventListener("input", (event) => {
      filters.content.query = event.target.value || "";
      renderContent();
    });
  }
  if (contentTypeFilter) {
    contentTypeFilter.addEventListener("change", (event) => {
      filters.content.type = event.target.value || "all";
      renderContent();
    });
  }

  if (reportSearch) {
    reportSearch.addEventListener("input", (event) => {
      filters.reports.query = event.target.value || "";
      renderReports();
    });
  }
  if (reportStatusFilter) {
    reportStatusFilter.addEventListener("change", (event) => {
      filters.reports.status = event.target.value || "open";
      renderReports();
    });
  }
  if (reportPriorityFilter) {
    reportPriorityFilter.addEventListener("change", (event) => {
      filters.reports.priority = event.target.value || "all";
      renderReports();
    });
  }
  if (reportCategoryFilter) {
    reportCategoryFilter.addEventListener("change", (event) => {
      filters.reports.category = event.target.value || "all";
      renderReports();
    });
  }
};

// Load all data on page load
async function initAdminDashboard() {
  if (!requireAdminAccess()) return;

  // Get element references after DOM is ready
  const userTableBody = document.getElementById("userTableBody");
  const contentList = document.getElementById("contentList");
  const reportCards = document.getElementById("reportCards");
  const userCount = document.getElementById("userCount");
  const newSignupCount = document.getElementById("newSignupCount");
  const reportCount = document.getElementById("reportCount");
  const contentCount = document.getElementById("contentCount");
  const reportBadge = document.getElementById("reportBadge");
  const refreshContent = document.getElementById("refreshContent");
  const refreshReports = document.getElementById("refreshReports");
  const approveAll = document.getElementById("approveAll");
  const adminNavLinks = document.querySelectorAll(".sidebar .nav-item");
  
  // Setup nav links
  const setActiveAdminNav = (activeLink) => {
    adminNavLinks.forEach((link) => link.classList.toggle("active", link === activeLink));
  };

  adminNavLinks.forEach((link) => {
    link.addEventListener("click", () => {
      setActiveAdminNav(link);
    });
  });

  const currentPage = window.location.pathname.split("/").pop() || "admin.html";
  const currentPageLink = Array.from(adminNavLinks).find((link) => {
    try {
      return new URL(link.href).pathname.split("/").pop() === currentPage;
    } catch {
      return link.getAttribute("href") === currentPage;
    }
  });
  if (currentPageLink) {
    setActiveAdminNav(currentPageLink);
  }
  
  setupLogoutHandlers();
  createUserModal();
  createReportNoteModal();
  createContentModal();
  
  // Add update indicator
  const addUpdateIndicator = () => {
    if (!document.getElementById("updateIndicator")) {
      const topbar = document.querySelector(".topbar");
      if (topbar) {
        const indicator = document.createElement("span");
        indicator.id = "updateIndicator";
        indicator.style.cssText = `
          position: absolute;
          right: 150px;
          font-size: 12px;
          color: #999;
          font-weight: 500;
          display: flex;
          align-items: center;
          gap: 5px;
        `;
        indicator.innerHTML = `
          <span style="width: 8px; height: 8px; background: #4CAF50; border-radius: 50%; display: inline-block; animation: pulse 2s infinite;"></span>
          <span>Live</span>
        `;
        topbar.style.position = "relative";
        topbar.appendChild(indicator);
      }
    }
  };
  
  addUpdateIndicator();
  setupFilters();
  setupUserForm();
  
  // Attach event listeners to page action buttons
  if (refreshContent) {
    refreshContent.addEventListener("click", async () => {
      refreshContent.textContent = "Refreshing...";
      refreshContent.disabled = true;
      try {
        await loadContent();
        await updateStats();
      } catch (error) {
        console.error("Error refreshing content:", error);
        showToast("Failed to refresh content", "error");
      } finally {
        refreshContent.textContent = "Refresh";
        refreshContent.disabled = false;
      }
    });
  }

  if (refreshReports) {
    refreshReports.addEventListener("click", async () => {
      refreshReports.textContent = "Refreshing...";
      refreshReports.disabled = true;
      try {
        await loadReports();
        await updateStats();
      } catch (error) {
        console.error("Error refreshing reports:", error);
        showToast("Failed to refresh reports", "error");
      } finally {
        refreshReports.textContent = "Refresh";
        refreshReports.disabled = false;
      }
    });
  }

  if (approveAll) {
    approveAll.addEventListener("click", async () => {
      approveAll.textContent = "Approving...";
      approveAll.disabled = true;
      try {
        // Approve all pending content
        const pendingItems = pendingContent.filter((item) => item.status === "pending");
        for (const item of pendingItems) {
          try {
            await fetch(`${API_BASE_URL}/admin/content/${item.id}/approve`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
            });
          } catch (_error) {
            console.error("Failed to approve content");
          }
        }
        await loadContent();
        await updateStats();
        await loadActivityLogs();
        showToast("Pending content approved.", "success");
      } catch (error) {
        console.error("Error approving content:", error);
        showToast("Failed to approve content", "error");
      } finally {
        approveAll.textContent = "Approve all";
        approveAll.disabled = false;
      }
    });
  }
  
  await loadUsers();
  await loadContent();
  await loadReports();
  await loadActivityLogs();
  startStatsAutoRefresh();
  
  // Handle page visibility changes
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      stopStatsAutoRefresh();
    } else {
      startStatsAutoRefresh();
    }
  });
  
  // Clean up when leaving the page
  window.addEventListener("beforeunload", () => {
    stopStatsAutoRefresh();
  });
}

initAdminDashboard();
