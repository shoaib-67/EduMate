import { getStoredUser, requireRole, setupLogoutHandlers } from "./shared.js";
import { state } from "./state.js";
import { showToast } from "./ui/toast.js";
import {
  createUserModal,
  createContentModal,
  createReportNoteModal,
} from "./ui/modals.js";
import { loadUsers, renderUsers, bindUserCreateForm } from "./features/users.js";
import { loadContent, renderContent, startContentAutoRefresh, stopContentAutoRefresh } from "./features/content.js";
import { loadReports, renderReports } from "./features/reports.js";
import { loadActivityLogs, renderActivityLogs } from "./features/activity.js";
import { updateStats, startStatsAutoRefresh, stopStatsAutoRefresh } from "./features/stats.js";

function requireAdminAccess() {
  return Boolean(requireRole("admin", { redirectTo: "admin-login.html" }));
}

function setupFilters() {
  document.getElementById("userSearch")?.addEventListener("input", (event) => {
    state.filters.users.query = event.target.value || "";
    renderUsers();
  });
  document.getElementById("userRoleFilter")?.addEventListener("change", (event) => {
    state.filters.users.role = event.target.value || "all";
    renderUsers();
  });
  document.getElementById("userStatusFilter")?.addEventListener("change", (event) => {
    state.filters.users.status = event.target.value || "all";
    renderUsers();
  });

  document.getElementById("contentSearch")?.addEventListener("input", (event) => {
    state.filters.content.query = event.target.value || "";
    renderContent();
  });
  document.getElementById("contentTypeFilter")?.addEventListener("change", (event) => {
    state.filters.content.type = event.target.value || "all";
    renderContent();
  });

  document.getElementById("reportSearch")?.addEventListener("input", (event) => {
    state.filters.reports.query = event.target.value || "";
    renderReports();
  });
  document.getElementById("reportStatusFilter")?.addEventListener("change", (event) => {
    state.filters.reports.status = event.target.value || "open";
    renderReports();
  });
  document.getElementById("reportPriorityFilter")?.addEventListener("change", (event) => {
    state.filters.reports.priority = event.target.value || "all";
    renderReports();
  });
  document.getElementById("reportCategoryFilter")?.addEventListener("change", (event) => {
    state.filters.reports.category = event.target.value || "all";
    renderReports();
  });
}

export async function initAdminDashboard() {
  if (!requireAdminAccess()) return;
  setupLogoutHandlers();

  createUserModal();
  createContentModal();
  createReportNoteModal({
    onComplete: async () => {
      await loadReports();
      renderReports();
    },
  });

  setupFilters();

  // Users page
  document.getElementById("toggleAddUserForm")?.addEventListener("click", () => {
    document.getElementById("addUserForm")?.classList.toggle("is-hidden");
  });
  bindUserCreateForm({
    onCreated: async () => {
      await loadUsers();
      renderUsers();
    },
  });

  // Content page buttons
  document.getElementById("refreshContent")?.addEventListener("click", async () => {
    try {
      await loadContent();
      renderContent();
      showToast("Content refreshed.", "success");
    } catch (error) {
      showToast(error.message, "error");
    }
  });

  document.getElementById("approveAll")?.addEventListener("click", async () => {
    // Keep existing behavior minimal: just refresh content list; per-item approve remains.
    showToast("Approve-all is not automated in this refactor.", "info");
  });

  // Reports page refresh
  document.getElementById("refreshReports")?.addEventListener("click", async () => {
    try {
      await loadReports();
      renderReports();
      showToast("Reports refreshed.", "success");
    } catch (error) {
      showToast(error.message, "error");
    }
  });

  // Initial loads based on which page sections exist
  try {
    if (document.getElementById("userTableBody")) {
      await loadUsers();
      renderUsers();
    }
    if (document.getElementById("contentList")) {
      await loadContent();
      renderContent();
      startContentAutoRefresh();
    }
    if (document.getElementById("reportCards")) {
      await loadReports();
      renderReports();
    }
    if (document.getElementById("activityLogList")) {
      await loadActivityLogs();
      renderActivityLogs();
    }
    if (document.getElementById("userCount")) {
      await updateStats();
      startStatsAutoRefresh();
    }
  } catch (error) {
    showToast(error.message, "error");
  }

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      stopStatsAutoRefresh();
      stopContentAutoRefresh();
      return;
    }

    if (document.getElementById("userCount")) startStatsAutoRefresh();
    if (document.getElementById("contentList")) {
      loadContent()
        .then(() => renderContent())
        .catch(() => {});
      startContentAutoRefresh();
    }
  });
}

